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

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT ?? 3001
const BUCKETS_FILE = join(__dirname, 'buckets.json')
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
  `).then(() => console.log('[JotIt] Postgres ready'))
    .catch(err => console.error('[JotIt] Postgres init failed:', err.message))
} else {
  console.log('[JotIt] DATABASE_URL not set — sync disabled')
}

app.use(express.json({ limit: '10mb' }))
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

function renderPage(bucketName, bucket) {
  const { notes, publishedAt } = bucket
  const noteCards = notes.map(n => {
    const html = marked.parse(n.content || '')
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
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`jotit server → http://127.0.0.1:${PORT}`)
})
