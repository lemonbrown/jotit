import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { marked } from 'marked'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT ?? 3001
const BUCKETS_FILE = join(__dirname, 'buckets.json')
const PUBLIC_NOTES_FILE = join(__dirname, 'public-notes.json')
const JWT_SECRET = process.env.JWT_SECRET ?? 'jotit-dev-secret-change-in-prod'

// ── Postgres ─────────────────────────────────────────────────────────────────

const { Pool } = pg
let pgPool = null

if (process.env.DATABASE_URL) {
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL })
  pgPool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id          TEXT    NOT NULL,
      user_id     INTEGER NOT NULL,
      content     TEXT    NOT NULL DEFAULT '',
      categories  TEXT    NOT NULL DEFAULT '[]',
      embedding   TEXT,
      created_at  BIGINT  NOT NULL,
      updated_at  BIGINT  NOT NULL,
      is_public   INTEGER NOT NULL DEFAULT 0,
      deleted_at  BIGINT,
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS notes_user_updated ON notes (user_id, updated_at);
    CREATE INDEX IF NOT EXISTS notes_user_deleted ON notes (user_id, deleted_at);
    CREATE TABLE IF NOT EXISTS public_notes (
      slug         TEXT PRIMARY KEY,
      note_id      TEXT NOT NULL,
      content      TEXT NOT NULL DEFAULT '',
      categories   TEXT NOT NULL DEFAULT '[]',
      view_mode    TEXT,
      published_at BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL
    );
  `).then(() => console.log('[JotIt] Postgres ready'))
    .catch(err => console.error('[JotIt] Postgres init failed:', err.message))
} else {
  console.log('[JotIt] DATABASE_URL not set — sync disabled')
}

app.use(express.json({ limit: '10mb' }))
app.get('/env.mjs', (_req, res) => {
  res.type('application/javascript').send(
    "const env = Object.freeze({});\nglobalThis.__JOTIT_ENV__ = env;\nexport { env };\nexport default env;\n"
  )
})
app.use(express.static(join(__dirname, 'dist')))

// ── User DB ──────────────────────────────────────────────────────────────────

const userDb = new Database(join(__dirname, 'users.db'))
userDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`)

function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ── Auth API ─────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }
  try {
    const hash = await bcrypt.hash(password, 10)
    const stmt = userDb.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    const result = stmt.run(email.toLowerCase().trim(), hash)
    const token = jwt.sign({ userId: result.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, user: { id: result.lastInsertRowid, email } })
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'An account with that email already exists' })
    res.status(500).json({ error: 'Registration failed' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' })
  const user = userDb.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim())
  if (!user) return res.status(401).json({ error: 'Invalid email or password' })
  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' })
  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' })
  res.json({ token, user: { id: user.id, email: user.email } })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.userId, email: req.user.email } })
})

// ── Bucket store ─────────────────────────────────────────────────────────────

function loadBuckets() {
  if (!existsSync(BUCKETS_FILE)) return {}
  try { return JSON.parse(readFileSync(BUCKETS_FILE, 'utf8')) } catch { return {} }
}

function saveBuckets(data) {
  writeFileSync(BUCKETS_FILE, JSON.stringify(data, null, 2))
}

function loadPublicNotes() {
  if (!existsSync(PUBLIC_NOTES_FILE)) return {}
  try { return JSON.parse(readFileSync(PUBLIC_NOTES_FILE, 'utf8')) } catch { return {} }
}

function generatePublicSlug(existing) {
  for (let i = 0; i < 10; i++) {
    const slug = crypto.randomBytes(9).toString('base64url')
    if (!existing[slug]) return slug
  }
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

async function pgGenerateSlug() {
  for (let i = 0; i < 10; i++) {
    const slug = crypto.randomBytes(9).toString('base64url')
    const { rows } = await pgPool.query('SELECT 1 FROM public_notes WHERE slug = $1', [slug])
    if (!rows.length) return slug
  }
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

async function pgGetPublicNote(slug) {
  const { rows } = await pgPool.query('SELECT * FROM public_notes WHERE slug = $1', [slug])
  if (!rows.length) return null
  const r = rows[0]
  return {
    publishedAt: Number(r.published_at),
    note: {
      id: r.note_id,
      content: r.content,
      categories: JSON.parse(r.categories || '[]'),
      updatedAt: Number(r.updated_at),
      viewMode: r.view_mode ?? null,
    },
  }
}

async function pgSavePublicNote(slug, note) {
  await pgPool.query(
    `INSERT INTO public_notes (slug, note_id, content, categories, view_mode, published_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [slug, note.id, note.content, JSON.stringify(note.categories ?? []),
     note.viewMode ?? null, Date.now(), note.updatedAt ?? Date.now()]
  )
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{2,40}$/

// ── Bucket API ───────────────────────────────────────────────────────────────

app.post('/api/bucket/publish', (req, res) => {
  const { bucketName, notes } = req.body ?? {}
  if (!bucketName || !SLUG_RE.test(bucketName)) {
    return res.status(400).json({ error: 'Invalid bucket name — use 2–40 lowercase letters, numbers, hyphens' })
  }
  if (!Array.isArray(notes)) {
    return res.status(400).json({ error: 'notes must be an array' })
  }
  const buckets = loadBuckets()
  buckets[bucketName] = {
    publishedAt: Date.now(),
    notes: notes.map(n => ({
      id:         n.id,
      content:    n.content,
      categories: n.categories ?? [],
      updatedAt:  n.updatedAt,
    })),
  }
  saveBuckets(buckets)
  res.json({ ok: true, count: notes.length, url: `/b/${bucketName}` })
})

app.get('/api/bucket/:name', (req, res) => {
  const bucket = loadBuckets()[req.params.name]
  if (!bucket) return res.status(404).json({ error: 'Not found' })
  res.json(bucket)
})

app.post('/api/public-note/publish', async (req, res) => {
  const { note } = req.body ?? {}
  if (!note || typeof note !== 'object') return res.status(400).json({ error: 'note is required' })
  if (typeof note.content !== 'string' || !note.content.trim()) {
    return res.status(400).json({ error: 'Cannot publish an empty note' })
  }

  if (pgPool) {
    try {
      const slug = await pgGenerateSlug()
      await pgSavePublicNote(slug, note)
      return res.json({ ok: true, url: `/n/${slug}`, slug })
    } catch (e) {
      return res.status(500).json({ error: 'Database error: ' + e.message })
    }
  }

  const publicNotes = loadPublicNotes()
  const slug = generatePublicSlug(publicNotes)
  publicNotes[slug] = {
    publishedAt: Date.now(),
    note: {
      id: note.id,
      content: note.content,
      categories: note.categories ?? [],
      updatedAt: note.updatedAt ?? Date.now(),
      viewMode: note.viewMode ?? null,
    },
  }
  writeFileSync(PUBLIC_NOTES_FILE, JSON.stringify(publicNotes, null, 2))
  res.json({ ok: true, url: `/n/${slug}`, slug })
})

app.get('/api/public-note/:slug', async (req, res) => {
  if (pgPool) {
    try {
      const shared = await pgGetPublicNote(req.params.slug)
      if (!shared) return res.status(404).json({ error: 'Not found' })
      return res.json(shared)
    } catch (e) {
      return res.status(500).json({ error: 'Database error: ' + e.message })
    }
  }
  const shared = loadPublicNotes()[req.params.slug]
  if (!shared) return res.status(404).json({ error: 'Not found' })
  res.json(shared)
})

// ── Public bucket page ───────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60)   return 'just now'
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function renderDiagramSvg(jsonText) {
  let diagram
  try { diagram = JSON.parse(jsonText) } catch { return `<pre><code>${esc(jsonText)}</code></pre>` }
  const nodes = Array.isArray(diagram.nodes) ? diagram.nodes : []
  const edges = Array.isArray(diagram.edges) ? diagram.edges : []
  if (!nodes.length) return '<div class="diagram-empty">Empty diagram</div>'

  const byId = Object.fromEntries(nodes.map(n => [String(n.id), n]))
  const minX = Math.min(...nodes.map(n => Number(n.x ?? 0))) - 32
  const minY = Math.min(...nodes.map(n => Number(n.y ?? 0))) - 32
  const maxX = Math.max(...nodes.map(n => Number(n.x ?? 0) + Number(n.w ?? 140))) + 32
  const maxY = Math.max(...nodes.map(n => Number(n.y ?? 0) + Number(n.h ?? 70))) + 32

  const edgeEls = edges.map(edge => {
    const from = byId[String(edge.from)]
    const to = byId[String(edge.to)]
    if (!from || !to) return ''
    const x1 = Number(from.x ?? 0) + Number(from.w ?? 140) / 2
    const y1 = Number(from.y ?? 0) + Number(from.h ?? 70) / 2
    const x2 = Number(to.x ?? 0) + Number(to.w ?? 140) / 2
    const y2 = Number(to.y ?? 0) + Number(to.h ?? 70) / 2
    const label = edge.label
      ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" class="diagram-edge-label">${esc(edge.label)}</text>`
      : ''
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="diagram-edge" marker-end="url(#arrow)" />${label}`
  }).join('')

  const nodeEls = nodes.map(node => {
    const x = Number(node.x ?? 0)
    const y = Number(node.y ?? 0)
    const w = Number(node.w ?? 140)
    const h = Number(node.h ?? 70)
    const cx = x + w / 2
    const cy = y + h / 2
    const fill = esc(node.fill ?? '#18181b')
    const stroke = esc(node.stroke ?? '#52525b')
    let shape
    if (node.type === 'circle') shape = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" />`
    else if (node.type === 'diamond') shape = `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fill}" stroke="${stroke}" />`
    else if (node.type === 'round') shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}" />`
    else if (node.type === 'text') shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" stroke="transparent" />`
    else shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" />`
    return `<g class="diagram-node">${shape}<foreignObject x="${x + 8}" y="${y + 8}" width="${Math.max(20, w - 16)}" height="${Math.max(20, h - 16)}"><div xmlns="http://www.w3.org/1999/xhtml" class="diagram-label">${esc(node.text ?? '')}</div></foreignObject></g>`
  }).join('')

  return `<div class="diagram-wrap"><svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img" aria-label="JotIt diagram">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#71717a" /></marker></defs>
    ${edgeEls}${nodeEls}
  </svg></div>`
}

function renderNoteMarkdown(content) {
  const withDiagrams = String(content ?? '').replace(/```jotit-diagram\s*\n([\s\S]*?)\n```/g, (_, json) => renderDiagramSvg(json))
  return marked.parse(withDiagrams)
}

function renderPage(bucketName, bucket) {
  const { notes, publishedAt } = bucket
  const noteCards = notes.map(n => {
    const html = renderNoteMarkdown(n.content || '')
    const cats = (n.categories ?? []).slice(0, 5)
      .map(c => `<span class="badge">${esc(c)}</span>`).join('')
    return `
      <article class="card">
        <div class="card-body prose">${html}</div>
        <footer class="card-footer">
          <div class="badges">${cats}</div>
          <span class="ts">${timeAgo(n.updatedAt)}</span>
        </footer>
      </article>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(bucketName)} · JotIt</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      background: #09090b; color: #a1a1aa;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 14px; line-height: 1.6; min-height: 100vh;
    }
    a { color: #60a5fa }
    header {
      border-bottom: 1px solid #27272a;
      padding: 14px 24px;
      display: flex; align-items: center; gap: 12px;
    }
    .wordmark { font-weight: 700; color: #f4f4f5; font-size: 15px; letter-spacing: -.3px }
    .sep { color: #3f3f46 }
    .bucket-name { font-family: ui-monospace, monospace; color: #a1a1aa; font-size: 13px }
    .meta { margin-left: auto; font-size: 11px; color: #52525b }
    main { max-width: 760px; margin: 0 auto; padding: 32px 24px; }
    .grid { display: grid; gap: 16px; }
    .card {
      background: #18181b; border: 1px solid #27272a;
      border-radius: 10px; overflow: hidden;
    }
    .card-body { padding: 18px 20px 12px; }
    .card-footer {
      padding: 8px 20px 12px;
      display: flex; align-items: center; gap: 6px;
      border-top: 1px solid #27272a;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 4px; flex: 1 }
    .badge {
      font-size: 10px; padding: 1px 6px; border-radius: 4px;
      background: #27272a; color: #71717a; border: 1px solid #3f3f46;
      font-family: ui-monospace, monospace;
    }
    .ts { font-size: 10px; color: #3f3f46; white-space: nowrap }
    /* Prose */
    .prose { color: #d4d4d8; }
    .prose h1,.prose h2,.prose h3 { color: #f4f4f5; font-weight: 600; margin: .75em 0 .4em; line-height: 1.3 }
    .prose h1 { font-size: 1.25em } .prose h2 { font-size: 1.1em } .prose h3 { font-size: 1em }
    .prose p { margin-bottom: .75em; color: #a1a1aa }
    .prose ul,.prose ol { margin: .5em 0 .75em 1.25em; color: #a1a1aa }
    .prose li { margin-bottom: .2em }
    .prose code {
      font-family: ui-monospace, monospace; font-size: .85em;
      background: #27272a; border: 1px solid #3f3f46;
      padding: .1em .3em; border-radius: 3px; color: #e4e4e7;
    }
    .prose pre {
      background: #0d1117; border: 1px solid #27272a; border-radius: 6px;
      padding: 12px 14px; overflow-x: auto; margin: .75em 0;
    }
    .prose pre code { background: none; border: none; padding: 0; font-size: .82em; color: #c9d1d9 }
    .prose blockquote {
      border-left: 3px solid #3f3f46; padding-left: 12px;
      color: #71717a; margin: .75em 0;
    }
    .prose a { color: #60a5fa }
    .prose strong { color: #e4e4e7 }
    .prose hr { border: none; border-top: 1px solid #27272a; margin: 1em 0 }
    .empty { text-align: center; padding: 64px 0; color: #3f3f46; font-size: 13px }
    footer.page-footer {
      border-top: 1px solid #27272a; padding: 16px 24px;
      text-align: center; font-size: 11px; color: #3f3f46; margin-top: 40px;
    }
  </style>
</head>
<body>
  <header>
    <span class="wordmark">JotIt</span>
    <span class="sep">/</span>
    <span class="bucket-name">${esc(bucketName)}</span>
    <span class="meta">${notes.length} note${notes.length !== 1 ? 's' : ''} · published ${timeAgo(publishedAt)}</span>
  </header>
  <main>
    ${notes.length ? `<div class="grid">${noteCards}</div>` : '<div class="empty">No notes in this bucket yet.</div>'}
  </main>
  <footer class="page-footer">built with JotIt</footer>
</body>
</html>`
}

function renderCsvTableHtml(text) {
  const rows = []
  let row = [], field = '', inQuotes = false, i = 0
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); if (row.some(f => f !== '')) rows.push(row); row = [] }
  while (i < text.length) {
    const ch = text[i], next = text[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i += 2; continue }
      if (ch === '"') { inQuotes = false; i++; continue }
      field += ch
    } else {
      if (ch === '"') { inQuotes = true; i++; continue }
      if (ch === ',') { pushField(); i++; continue }
      if (ch === '\r' && next === '\n') { pushRow(); i += 2; continue }
      if (ch === '\r' || ch === '\n') { pushRow(); i++; continue }
      field += ch
    }
    i++
  }
  if (field || row.length) pushRow()
  if (rows.length < 2) return `<pre><code>${esc(text)}</code></pre>`
  const width = Math.max(...rows.map(r => r.length))
  const headers = rows[0].map((h, idx) => h.trim() || `Column ${idx + 1}`)
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`)
  const data = rows.slice(1).map(r => { const nr = [...r]; while (nr.length < width) nr.push(''); return nr.slice(0, width) })
  const thead = `<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${data.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}

function renderPublicNotePage(slug, shared) {
  const note = shared.note
  let html
  if (note.viewMode === 'table') {
    html = renderCsvTableHtml(note.content || '')
  } else if (note.viewMode === 'code') {
    html = `<pre><code>${esc(note.content || '')}</code></pre>`
  } else {
    html = renderNoteMarkdown(note.content || '')
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shared note · JotIt</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      background: #09090b; color: #a1a1aa;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 14px; line-height: 1.65; min-height: 100vh;
    }
    main { max-width: 820px; margin: 0 auto; padding: 42px 24px 64px; }
    .shared-meta {
      margin-bottom: 24px; display: flex; align-items: center; gap: 10px;
      color: #52525b; font-size: 11px; font-family: ui-monospace, monospace;
    }
    .wordmark { color: #a1a1aa; font-weight: 700; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px }
    .prose { color: #d4d4d8; }
    .prose h1,.prose h2,.prose h3,.prose h4 { color: #f4f4f5; font-weight: 650; margin: 1.1em 0 .45em; line-height: 1.25 }
    .prose h1 { font-size: 1.7em } .prose h2 { font-size: 1.35em } .prose h3 { font-size: 1.1em }
    .prose p { margin-bottom: .85em; color: #c4c4cc }
    .prose ul,.prose ol { margin: .5em 0 .9em 1.4em; color: #c4c4cc }
    .prose li { margin-bottom: .25em }
    .prose a { color: #60a5fa }
    .prose strong { color: #f4f4f5 }
    .prose hr { border: none; border-top: 1px solid #27272a; margin: 1.4em 0 }
    .prose code {
      font-family: ui-monospace, monospace; font-size: .88em;
      background: #18181b; border: 1px solid #27272a;
      padding: .12em .35em; border-radius: 3px; color: #e4e4e7;
    }
    .prose pre {
      background: #0d1117; border: 1px solid #27272a; border-radius: 6px;
      padding: 13px 15px; overflow-x: auto; margin: .9em 0;
    }
    .prose pre code { background: none; border: none; padding: 0; color: #c9d1d9 }
    .prose blockquote {
      border-left: 3px solid #3f3f46; padding-left: 13px;
      color: #a1a1aa; margin: .9em 0;
    }
    .prose table { width: 100%; border-collapse: collapse; margin: 1em 0; }
    .prose th,.prose td { border: 1px solid #27272a; padding: .45em .65em; text-align: left; }
    .prose th { background: #18181b; color: #f4f4f5 }
    .diagram-wrap {
      margin: 1em 0; border: 1px solid #27272a; border-radius: 8px;
      background: #0f0f12; overflow: hidden;
    }
    .diagram-wrap svg { display: block; width: 100%; min-height: 260px; }
    .diagram-node rect,.diagram-node ellipse,.diagram-node polygon { stroke-width: 1.5px; }
    .diagram-edge { stroke: #71717a; stroke-width: 1.8px; }
    .diagram-edge-label { fill: #a1a1aa; font: 11px ui-monospace, monospace; }
    .diagram-label {
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      color: #e4e4e7; font: 12px ui-monospace, monospace; text-align: center;
      white-space: pre-wrap; overflow: hidden; padding: 2px;
    }
    .diagram-empty { color: #52525b; font-family: ui-monospace, monospace; padding: 20px; border: 1px solid #27272a; border-radius: 8px; }
  </style>
</head>
<body>
  <main>
    <div class="shared-meta">
      <span class="wordmark">JotIt</span>
      <span>/n/${esc(slug)}</span>
      <span>published ${timeAgo(shared.publishedAt)}</span>
    </div>
    <article class="prose">${html}</article>
  </main>
</body>
</html>`
}

app.get('/b/:name', (req, res) => {
  const bucket = loadBuckets()[req.params.name]
  if (!bucket) {
    return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found · JotIt</title>
    <style>body{background:#09090b;color:#52525b;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
    h1{color:#f4f4f5;font-size:1.2em;margin-bottom:.5em}</style></head>
    <body><div><h1>Bucket not found</h1><p>/b/${esc(req.params.name)} doesn't exist or hasn't been published yet.</p></div></body></html>`)
  }
  res.send(renderPage(req.params.name, bucket))
})

app.get('/n/:slug', async (req, res) => {
  let shared
  if (pgPool) {
    try {
      shared = await pgGetPublicNote(req.params.slug)
    } catch (e) {
      return res.status(500).send('Database error')
    }
  } else {
    shared = loadPublicNotes()[req.params.slug]
  }
  if (!shared) {
    return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found · JotIt</title>
    <style>body{background:#09090b;color:#52525b;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
    h1{color:#f4f4f5;font-size:1.2em;margin-bottom:.5em}</style></head>
    <body><div><h1>Note not found</h1><p>/n/${esc(req.params.slug)} doesn't exist or hasn't been published yet.</p></div></body></html>`)
  }
  res.send(renderPublicNotePage(req.params.slug, shared))
})

// ── Sync API ─────────────────────────────────────────────────────────────────

app.post('/api/sync/push', requireAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: 'Sync not configured' })
  const { notes } = req.body ?? {}
  if (!Array.isArray(notes)) return res.status(400).json({ error: 'notes must be an array' })
  const userId = req.user.userId
  try {
    for (const n of notes) {
      if (!n.id || typeof n.id !== 'string') continue
      if (n.deleted) {
        await pgPool.query(
          `INSERT INTO notes (id, user_id, content, categories, embedding, created_at, updated_at, is_public, deleted_at)
           VALUES ($1, $2, '', '[]', NULL, $3, $3, 0, $3)
           ON CONFLICT (id, user_id) DO UPDATE SET deleted_at = $3, updated_at = $3`,
          [n.id, userId, Date.now()]
        )
      } else {
        await pgPool.query(
          `INSERT INTO notes (id, user_id, content, categories, embedding, created_at, updated_at, is_public)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id, user_id) DO UPDATE SET
             content    = EXCLUDED.content,
             categories = EXCLUDED.categories,
             embedding  = EXCLUDED.embedding,
             updated_at = EXCLUDED.updated_at,
             is_public  = EXCLUDED.is_public,
             deleted_at = NULL
           WHERE notes.updated_at < EXCLUDED.updated_at`,
          [n.id, userId,
           n.content ?? '', n.categories ?? '[]', n.embedding ?? null,
           n.created_at ?? Date.now(), n.updated_at ?? Date.now(), n.is_public ? 1 : 0]
        )
      }
    }
    res.json({ ok: true, pushed: notes.length })
  } catch (e) {
    console.error('[JotIt] Sync push error:', e.message)
    res.status(500).json({ error: 'Sync failed' })
  }
})

app.get('/api/sync/pull', requireAuth, async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: 'Sync not configured' })
  const userId = req.user.userId
  const since = Math.max(0, parseInt(req.query.since ?? '0', 10) || 0)
  const serverTime = Date.now()
  try {
    const { rows } = await pgPool.query(
      `SELECT * FROM notes
       WHERE user_id = $1
         AND (updated_at > $2 OR (deleted_at IS NOT NULL AND deleted_at > $2))`,
      [userId, since]
    )
    res.json({ notes: rows, serverTime })
  } catch (e) {
    console.error('[JotIt] Sync pull error:', e.message)
    res.status(500).json({ error: 'Sync failed' })
  }
})

// ── HTTP proxy ───────────────────────────────────────────────────────────────

app.post('/proxy', async (req, res) => {
  const { url, method = 'GET', headers = {}, body } = req.body ?? {}

  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'url must be an http/https URL' })
  }

  const t0 = Date.now()
  try {
    const opts = { method, headers }
    if (body && method !== 'GET' && method !== 'HEAD') opts.body = body

    const upstream = await fetch(url, opts)
    const elapsed = Date.now() - t0
    const bodyText = await upstream.text()
    const respHeaders = {}
    upstream.headers.forEach((v, k) => { respHeaders[k] = v })

    res.json({
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
      body: bodyText,
      elapsed,
    })
  } catch (e) {
    res.status(502).json({ error: e.message ?? String(e), elapsed: Date.now() - t0 })
  }
})

// SPA fallback for production
app.get('*', (req, res) => {
  if (req.path.includes('.')) {
    return res.status(404).type('text/plain').send('Not found')
  }
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`jotit server → http://127.0.0.1:${PORT}`)
})
