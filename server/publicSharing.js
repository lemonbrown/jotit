import { existsSync, readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import { marked } from 'marked'
import { sendJsonError } from './http.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{2,40}$/

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function slugifyHeading(text, fallbackIndex) {
  const base = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  return base || `section-${fallbackIndex + 1}`
}

function extractMarkdownHeadings(content) {
  const headings = []
  const seen = new Map()

  String(content ?? '').split('\n').forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)/)
    if (!match) return

    const title = match[2].trim()
    const baseId = slugifyHeading(title, index)
    const count = seen.get(baseId) ?? 0
    seen.set(baseId, count + 1)

    headings.push({
      title,
      level: match[1].length,
      id: count ? `${baseId}-${count + 1}` : baseId,
    })
  })

  return headings
}

function injectHeadingAnchors(html, headings) {
  let headingIndex = 0
  return html.replace(/<h([1-6])(\b[^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level, attrs, inner) => {
    const heading = headings[headingIndex]
    if (!heading || heading.level !== Number(level)) return match
    headingIndex += 1
    const nextAttrs = attrs?.includes('id=')
      ? attrs
      : `${attrs ?? ''} id="${heading.id}" data-heading-index="${headingIndex - 1}"`
    return `<h${level}${nextAttrs}>${inner}</h${level}>`
  })
}

function loadJson(filePath) {
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function saveJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function generatePublicSlug(existing) {
  for (let i = 0; i < 10; i += 1) {
    const slug = crypto.randomBytes(9).toString('base64url')
    if (!existing[slug]) return slug
  }
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

async function pgGenerateSlug(pgPool) {
  for (let i = 0; i < 10; i += 1) {
    const slug = crypto.randomBytes(9).toString('base64url')
    const { rows } = await pgPool.query('SELECT 1 FROM public_notes WHERE slug = $1', [slug])
    if (!rows.length) return slug
  }
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

async function pgGetPublicNote(pgPool, slug) {
  const { rows } = await pgPool.query('SELECT * FROM public_notes WHERE slug = $1', [slug])
  if (!rows.length) return null

  const row = rows[0]
  return {
    publishedAt: Number(row.published_at),
    note: {
      id: row.note_id,
      content: row.content,
      categories: JSON.parse(row.categories || '[]'),
      updatedAt: Number(row.updated_at),
      viewMode: row.view_mode ?? null,
    },
  }
}

async function pgFindPublicNoteByNoteId(pgPool, noteId) {
  const { rows } = await pgPool.query(
    'SELECT * FROM public_notes WHERE note_id = $1 ORDER BY published_at DESC LIMIT 1',
    [noteId]
  )
  if (!rows.length) return null

  const row = rows[0]
  return {
    slug: row.slug,
    publishedAt: Number(row.published_at),
    note: {
      id: row.note_id,
      content: row.content,
      categories: JSON.parse(row.categories || '[]'),
      updatedAt: Number(row.updated_at),
      viewMode: row.view_mode ?? null,
    },
  }
}

async function pgSavePublicNote(pgPool, slug, note) {
  await pgPool.query(
    `INSERT INTO public_notes (slug, note_id, content, categories, view_mode, published_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      slug,
      note.id,
      note.content,
      JSON.stringify(note.categories ?? []),
      note.viewMode ?? null,
      Date.now(),
      note.updatedAt ?? Date.now(),
    ],
  )
}

async function pgUpdatePublicNote(pgPool, slug, note, publishedAt) {
  await pgPool.query(
    `UPDATE public_notes
        SET content = $2,
            categories = $3,
            view_mode = $4,
            published_at = $5,
            updated_at = $6
      WHERE slug = $1`,
    [
      slug,
      note.content,
      JSON.stringify(note.categories ?? []),
      note.viewMode ?? null,
      publishedAt ?? Date.now(),
      note.updatedAt ?? Date.now(),
    ],
  )
}

function summarizeSharedNote(slug, shared) {
  const content = String(shared?.note?.content ?? '')
  const firstLine = content.split('\n').find(line => line.trim())?.trim() ?? ''
  const preview = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 180)

  return {
    slug,
    url: `/n/${slug}`,
    noteId: shared?.note?.id ?? null,
    title: firstLine || 'Untitled note',
    preview,
    viewMode: shared?.note?.viewMode ?? null,
    publishedAt: Number(shared?.publishedAt ?? 0),
    updatedAt: Number(shared?.note?.updatedAt ?? 0),
  }
}

async function pgListPublicNotes(pgPool) {
  const { rows } = await pgPool.query(
    'SELECT slug, note_id, content, view_mode, published_at, updated_at FROM public_notes ORDER BY published_at DESC'
  )

  return rows.map(row => summarizeSharedNote(row.slug, {
    publishedAt: row.published_at,
    note: {
      id: row.note_id,
      content: row.content,
      updatedAt: row.updated_at,
      viewMode: row.view_mode ?? null,
    },
  }))
}

async function pgDeletePublicNote(pgPool, slug) {
  const result = await pgPool.query('DELETE FROM public_notes WHERE slug = $1 RETURNING slug', [slug])
  return Boolean(result.rows?.length)
}

function findExistingSharedSlug(publicNotes, noteId) {
  return Object.entries(publicNotes)
    .filter(([, shared]) => shared?.note?.id === noteId)
    .sort((a, b) => Number(b[1]?.publishedAt ?? 0) - Number(a[1]?.publishedAt ?? 0))[0]?.[0] ?? null
}

function renderDiagramSvg(jsonText) {
  let diagram
  try {
    diagram = JSON.parse(jsonText)
  } catch {
    return `<pre><code>${esc(jsonText)}</code></pre>`
  }

  const nodes = Array.isArray(diagram.nodes) ? diagram.nodes : []
  const edges = Array.isArray(diagram.edges) ? diagram.edges : []
  if (!nodes.length) return '<div class="diagram-empty">Empty diagram</div>'

  const byId = Object.fromEntries(nodes.map(node => [String(node.id), node]))
  const minX = Math.min(...nodes.map(node => Number(node.x ?? 0))) - 32
  const minY = Math.min(...nodes.map(node => Number(node.y ?? 0))) - 32
  const maxX = Math.max(...nodes.map(node => Number(node.x ?? 0) + Number(node.w ?? 140))) + 32
  const maxY = Math.max(...nodes.map(node => Number(node.y ?? 0) + Number(node.h ?? 70))) + 32

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

function renderBucketPage(bucketName, bucket) {
  const { notes, publishedAt } = bucket
  const noteCards = notes.map(note => {
    const html = renderNoteMarkdown(note.content || '')
    const cats = (note.categories ?? []).slice(0, 5)
      .map(category => `<span class="badge">${esc(category)}</span>`)
      .join('')

    return `
      <article class="card">
        <div class="card-body prose">${html}</div>
        <footer class="card-footer">
          <div class="badges">${cats}</div>
          <span class="ts">${timeAgo(note.updatedAt)}</span>
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
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    if (row.some(item => item !== '')) rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i += 2; continue }
      if (ch === '"') { inQuotes = false; i += 1; continue }
      field += ch
    } else {
      if (ch === '"') { inQuotes = true; i += 1; continue }
      if (ch === ',') { pushField(); i += 1; continue }
      if (ch === '\r' && next === '\n') { pushRow(); i += 2; continue }
      if (ch === '\r' || ch === '\n') { pushRow(); i += 1; continue }
      field += ch
    }
    i += 1
  }

  if (field || row.length) pushRow()
  if (rows.length < 2) return `<pre><code>${esc(text)}</code></pre>`

  const width = Math.max(...rows.map(item => item.length))
  const headers = rows[0].map((header, index) => header.trim() || `Column ${index + 1}`)
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`)

  const data = rows.slice(1).map(item => {
    const normalized = [...item]
    while (normalized.length < width) normalized.push('')
    return normalized.slice(0, width)
  })

  const thead = `<thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${data.map(item => `<tr>${item.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}

function renderPublicNotePage(slug, shared) {
  const note = shared.note
  const isMarkdown = note.viewMode !== 'table' && note.viewMode !== 'code'
  const headings = isMarkdown ? extractMarkdownHeadings(note.content || '') : []
  let html
  if (note.viewMode === 'table') html = renderCsvTableHtml(note.content || '')
  else if (note.viewMode === 'code') html = `<pre><code>${esc(note.content || '')}</code></pre>`
  else html = renderNoteMarkdown(note.content || '')
  if (headings.length) html = injectHeadingAnchors(html, headings)

  const headingNav = headings.length
    ? `<nav class="quick-nav" aria-label="Note headings">
        <div class="quick-nav-label">Jump to</div>
        <div class="quick-nav-links">
          ${headings.map((heading, index) => `<button class="quick-nav-link level-${heading.level}" data-target-heading="${heading.id}" data-heading-jump="${index}">${esc(heading.title)}</button>`).join('')}
        </div>
      </nav>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shared note · JotIt</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
    body {
      background: #09090b;
      color: #e4e4e7;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.65;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none }
    .topbar {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px;
      border-bottom: 1px solid #27272a;
      background: rgba(24, 24, 27, 0.8);
      backdrop-filter: blur(10px);
    }
    .topbar-brand {
      color: #f4f4f5;
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -.02em;
    }
    .topbar-path {
      color: #71717a;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
    }
    .topbar-meta {
      margin-left: auto;
      color: #52525b;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      white-space: nowrap;
    }
    .topbar-cta {
      margin-left: 8px;
      border: 1px solid #2563eb;
      background: #2563eb;
      color: #ffffff;
      border-radius: 6px;
      padding: 6px 10px;
      font: 600 12px Inter, ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      transition: background .15s ease, border-color .15s ease;
    }
    .topbar-cta:hover { background: #3b82f6; border-color: #3b82f6; }
    main { max-width: 1040px; margin: 0 auto; padding: 28px 24px 64px; }
    .shared-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
    .content-shell { min-width: 0; }
    .shared-meta {
      margin-bottom: 24px; display: flex; align-items: center; gap: 10px;
      color: #52525b; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .wordmark { color: #a1a1aa; font-weight: 700; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 13px }
    .quick-nav {
      display: flex; flex-direction: column; gap: 10px;
      padding: 14px;
      border: 1px solid #27272a;
      border-radius: 12px;
      background: rgba(24, 24, 27, 0.7);
      height: fit-content;
    }
    .quick-nav-label {
      color: #71717a;
      font: 700 10px ui-monospace, SFMono-Regular, Menlo, monospace;
      text-transform: uppercase;
      letter-spacing: .12em;
    }
    .quick-nav-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .quick-nav-link {
      border: 1px solid #27272a;
      background: #18181b;
      color: #d4d4d8;
      border-radius: 999px;
      padding: 6px 10px;
      font: 500 11px ui-monospace, SFMono-Regular, Menlo, monospace;
      cursor: pointer;
      transition: border-color .15s ease, color .15s ease, background .15s ease;
    }
    .quick-nav-link:hover,
    .quick-nav-link.active {
      border-color: #3b82f6;
      color: #eff6ff;
      background: rgba(37, 99, 235, 0.18);
    }
    .quick-nav-link.selected {
      border-color: #60a5fa;
      color: #eff6ff;
      background: rgba(96, 165, 250, 0.22);
      box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.2) inset;
    }
    .quick-nav-link.level-2 { padding-left: 14px; }
    .quick-nav-link.level-3,
    .quick-nav-link.level-4,
    .quick-nav-link.level-5,
    .quick-nav-link.level-6 { padding-left: 18px; }
    .prose {
      font-size: 14px;
      line-height: 1.7;
      color: #d4d4d8;
    }
    .prose h1,.prose h2,.prose h3,.prose h4,.prose h5,.prose h6 {
      color: #f4f4f5;
      font-weight: 600;
      margin: 1.25em 0 0.5em;
      line-height: 1.3;
      scroll-margin-top: 84px;
    }
    .prose h1 { font-size: 1.6em; border-bottom: 1px solid #3f3f46; padding-bottom: 0.3em; }
    .prose h2 { font-size: 1.3em; border-bottom: 1px solid #27272a; padding-bottom: 0.2em; }
    .prose h3 { font-size: 1.1em; }
    .prose h4 { font-size: 1em; }
    .prose p { margin: 0.75em 0; color: #d4d4d8; }
    .prose ul,.prose ol { margin: 0.5em 0 0.75em 1.5em; padding: 0; color: #d4d4d8; }
    .prose li { margin: 0.25em 0; }
    .prose a { color: #60a5fa; text-decoration: underline; }
    .prose a:hover { color: #93c5fd; }
    .prose strong { color: #f4f4f5; font-weight: 600; }
    .prose em { color: #d4d4d8; }
    .prose hr { border: none; border-top: 1px solid #3f3f46; margin: 1.25em 0; }
    .prose code {
      font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
      font-size: 0.85em;
      background: #18181b;
      border: 1px solid #3f3f46;
      padding: 0.1em 0.35em;
      border-radius: 3px;
      color: #e2c08d;
    }
    .prose pre {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 1em;
      overflow-x: auto;
      margin: 0.75em 0;
    }
    .prose pre code { background: none; border: none; padding: 0; color: #e2e8f0; font-size: 0.85em }
    .prose blockquote {
      border-left: 3px solid #52525b;
      margin: 0.75em 0;
      padding: 0.25em 0.75em;
      color: #a1a1aa;
    }
    .prose table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
    .prose th,.prose td { border: 1px solid #3f3f46; padding: 0.4em 0.75em; text-align: left; }
    .prose th { background: #27272a; color: #f4f4f5; font-weight: 600 }
    .prose tr:nth-child(even) td { background: #18181b; }
    .diagram-wrap {
      margin: 1em 0; border: 1px solid #30363d; border-radius: 8px;
      background: #0f0f12; overflow: hidden;
    }
    .diagram-wrap svg { display: block; width: 100%; min-height: 260px; }
    .diagram-node rect,.diagram-node ellipse,.diagram-node polygon { stroke-width: 1.5px; }
    .diagram-edge { stroke: #71717a; stroke-width: 1.8px; }
    .diagram-edge-label { fill: #a1a1aa; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .diagram-label {
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      color: #e4e4e7; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center;
      white-space: pre-wrap; overflow: hidden; padding: 2px;
    }
    .diagram-empty { color: #52525b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; padding: 20px; border: 1px solid #27272a; border-radius: 8px; }
    .outline-overlay {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding: 40px 16px;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(1px);
    }
    .outline-overlay.open {
      display: flex;
    }
    .outline-dialog {
      width: min(100%, 760px);
      max-height: min(70vh, 680px);
      overflow: hidden;
      border: 1px solid #3f3f46;
      border-radius: 16px;
      background: rgba(9, 9, 11, 0.98);
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
    }
    .outline-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid #27272a;
    }
    .outline-header-copy {
      min-width: 0;
    }
    .outline-title {
      color: #d4d4d8;
      font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace;
      text-transform: lowercase;
    }
    .outline-meta {
      color: #71717a;
      font: 500 10px ui-monospace, SFMono-Regular, Menlo, monospace;
      margin-top: 2px;
    }
    .outline-count {
      margin-left: auto;
      color: #71717a;
      font: 500 10px ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: nowrap;
    }
    .outline-filter-wrap {
      padding: 14px 16px;
      border-bottom: 1px solid #18181b;
    }
    .outline-filter {
      width: 100%;
      border: 1px solid #3f3f46;
      border-radius: 10px;
      background: #18181b;
      color: #e4e4e7;
      padding: 10px 12px;
      font: 500 13px 'JetBrains Mono', 'Fira Code', Consolas, monospace;
      outline: none;
    }
    .outline-filter::placeholder {
      color: #71717a;
    }
    .outline-filter:focus {
      border-color: #60a5fa;
    }
    .outline-list {
      max-height: min(52vh, 520px);
      overflow: auto;
      padding: 10px;
    }
    .outline-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1px solid transparent;
      border-radius: 12px;
      background: transparent;
      color: #e4e4e7;
      padding: 10px 12px;
      cursor: pointer;
      text-align: left;
      transition: background .15s ease, border-color .15s ease;
    }
    .outline-item:hover {
      background: rgba(39, 39, 42, 0.7);
    }
    .outline-item.selected {
      background: rgba(30, 58, 138, 0.35);
      border-color: rgba(96, 165, 250, 0.7);
    }
    .outline-level {
      color: #71717a;
      font: 600 10px ui-monospace, SFMono-Regular, Menlo, monospace;
      flex: 0 0 auto;
    }
    .outline-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
    }
    .outline-empty {
      padding: 28px 16px;
      text-align: center;
      color: #71717a;
      font: 500 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    @media (min-width: 980px) {
      .shared-layout {
        grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
        align-items: start;
      }
      .quick-nav {
        position: sticky;
        top: 76px;
      }
      .quick-nav-links {
        flex-direction: column;
        align-items: stretch;
      }
      .quick-nav-link {
        text-align: left;
        border-radius: 10px;
      }
    }
    @media (max-width: 760px) {
      .topbar { flex-wrap: wrap; }
      .topbar-meta { margin-left: 0; width: 100%; order: 4; }
      .topbar-cta { margin-left: auto; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <a href="/" class="topbar-brand">JotIt</a>
    <span class="topbar-path">/n/${esc(slug)}</span>
    <span class="topbar-meta">published ${timeAgo(shared.publishedAt)}</span>
    <a href="/?new=1" class="topbar-cta">+ New</a>
  </header>
  <main>
      <div class="shared-layout">
        ${headingNav}
        <div class="content-shell">
          <div class="shared-meta">
            <span>published ${timeAgo(shared.publishedAt)}</span>
            ${headings.length ? '<span>shift+wheel moves | enter jumps | esc resets</span>' : ''}
          </div>
          <article class="prose" id="shared-note-content">${html}</article>
        </div>
    </div>
  </main>
  ${headings.length ? `
  <div class="outline-overlay" id="outline-overlay" aria-hidden="true">
    <div class="outline-dialog" role="dialog" aria-modal="true" aria-labelledby="outline-title">
      <div class="outline-header">
        <div class="outline-header-copy">
          <div class="outline-title" id="outline-title">document outline</div>
          <div class="outline-meta">shift+wheel moves · enter jumps · esc closes</div>
        </div>
        <div class="outline-count"><span id="outline-visible-count">${headings.length}</span>/${headings.length}</div>
      </div>
      <div class="outline-filter-wrap">
        <input id="outline-filter" class="outline-filter" type="text" placeholder="Filter headings..." spellcheck="false" />
      </div>
      <div class="outline-list" id="outline-list">
        ${headings.map((heading, index) => `
          <button
            class="outline-item"
            data-outline-index="${index}"
            data-outline-heading="${heading.id}"
            data-outline-title="${esc(heading.title.toLowerCase())}"
            style="padding-left:${12 + heading.level * 14}px"
          >
            <span class="outline-level">${'#'.repeat(heading.level)}</span>
            <span class="outline-text">${esc(heading.title)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  </div>` : ''}
  <script>
    (() => {
      const navButtons = [...document.querySelectorAll('[data-target-heading]')]
      const headings = [...document.querySelectorAll('#shared-note-content [data-heading-index]')]
      if (!navButtons.length || !headings.length) return
      const outlineOverlay = document.getElementById('outline-overlay')
      const outlineFilter = document.getElementById('outline-filter')
      const outlineList = document.getElementById('outline-list')
      const outlineItems = [...document.querySelectorAll('[data-outline-index]')]
      const outlineVisibleCount = document.getElementById('outline-visible-count')

      let activeIndex = 0
      let selectedIndex = 0
      let outlineOpen = false
      let filteredIndexes = outlineItems.map((_, index) => index)

      const syncNavButtonStyles = () => {
        navButtons.forEach((button, buttonIndex) => {
          button.classList.toggle('active', buttonIndex === activeIndex)
          button.classList.toggle('selected', outlineOpen && buttonIndex === selectedIndex)
        })
      }

      const syncOutlineStyles = () => {
        outlineItems.forEach((item, itemIndex) => {
          item.classList.toggle('selected', outlineOpen && itemIndex === selectedIndex)
        })
        if (outlineVisibleCount) outlineVisibleCount.textContent = String(filteredIndexes.length)
      }

      const updateActive = (index) => {
        activeIndex = Math.max(0, Math.min(index, headings.length - 1))
        if (!outlineOpen) selectedIndex = activeIndex
        syncNavButtonStyles()
        syncOutlineStyles()
      }

      const jumpToHeading = (index) => {
        const heading = headings[index]
        if (!heading) return
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
        selectedIndex = index
        closeOutline(false)
        updateActive(index)
      }

      const ensureSelectionVisible = () => {
        navButtons[selectedIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        outlineItems[selectedIndex]?.scrollIntoView({ block: 'nearest' })
      }

      const applyOutlineFilter = () => {
        const query = String(outlineFilter?.value ?? '').trim().toLowerCase()
        filteredIndexes = []
        outlineItems.forEach((item, itemIndex) => {
          const matches = !query || item.dataset.outlineTitle.includes(query)
          item.hidden = !matches
          if (matches) filteredIndexes.push(itemIndex)
        })
        if (!filteredIndexes.length) {
          selectedIndex = activeIndex
        } else if (!filteredIndexes.includes(selectedIndex)) {
          selectedIndex = filteredIndexes[0]
        }
        syncOutlineStyles()
        syncNavButtonStyles()
        ensureSelectionVisible()
      }

      const openOutline = (step = 0) => {
        outlineOpen = true
        selectedIndex = Math.max(0, Math.min(activeIndex + step, headings.length - 1))
        outlineOverlay?.classList.add('open')
        outlineOverlay?.setAttribute('aria-hidden', 'false')
        if (outlineFilter) outlineFilter.value = ''
        applyOutlineFilter()
        syncNavButtonStyles()
        requestAnimationFrame(() => {
          outlineFilter?.focus()
          outlineFilter?.select()
          ensureSelectionVisible()
        })
      }

      const closeOutline = (restoreSelection = true) => {
        outlineOpen = false
        outlineOverlay?.classList.remove('open')
        outlineOverlay?.setAttribute('aria-hidden', 'true')
        if (restoreSelection) selectedIndex = activeIndex
        if (outlineFilter) outlineFilter.value = ''
        filteredIndexes = outlineItems.map((_, index) => index)
        outlineItems.forEach(item => { item.hidden = false })
        syncNavButtonStyles()
        syncOutlineStyles()
      }

      navButtons.forEach((button, index) => {
        button.addEventListener('click', () => jumpToHeading(index))
      })

      outlineItems.forEach((item, index) => {
        item.addEventListener('mousedown', (event) => event.preventDefault())
        item.addEventListener('click', () => jumpToHeading(index))
      })

      outlineFilter?.addEventListener('input', () => {
        applyOutlineFilter()
      })

      outlineFilter?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeOutline()
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          moveSelection(1)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          moveSelection(-1)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          jumpToHeading(selectedIndex)
        }
      })

      outlineOverlay?.addEventListener('click', (event) => {
        if (event.target === outlineOverlay) closeOutline()
      })

      const moveSelection = (step) => {
        if (!filteredIndexes.length) return
        if (!outlineOpen) {
          openOutline(step)
          return
        }
        const currentPosition = Math.max(0, filteredIndexes.indexOf(selectedIndex))
        const nextPosition = Math.max(0, Math.min(currentPosition + step, filteredIndexes.length - 1))
        selectedIndex = filteredIndexes[nextPosition]
        syncNavButtonStyles()
        syncOutlineStyles()
        ensureSelectionVisible()
      }

      window.addEventListener('wheel', (event) => {
        if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
        event.preventDefault()
        moveSelection(event.deltaY > 0 ? 1 : -1)
      }, { passive: false })

      window.addEventListener('keydown', (event) => {
        if (!outlineOpen) return
        if (event.key === 'Enter') {
          event.preventDefault()
          jumpToHeading(selectedIndex)
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          closeOutline()
        }
      })

      const observer = new IntersectionObserver((entries) => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (!visible.length) return
        const nextIndex = Number(visible[0].target.dataset.headingIndex || 0)
        updateActive(nextIndex)
      }, { rootMargin: '-10% 0px -75% 0px', threshold: [0, 1] })

      headings.forEach(heading => observer.observe(heading))
      updateActive(0)
      syncOutlineStyles()
    })()
  </script>
</body>
</html>`
}

function renderNotFoundPage(kind, pathValue) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not found · JotIt</title>
    <style>body{background:#09090b;color:#52525b;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
    h1{color:#f4f4f5;font-size:1.2em;margin-bottom:.5em}</style></head>
    <body><div><h1>${kind} not found</h1><p>${pathValue} doesn't exist or hasn't been published yet.</p></div></body></html>`
}

export function registerPublicSharing(app, { bucketsFile, publicNotesFile, pgPool }) {
  const loadBuckets = () => loadJson(bucketsFile)
  const saveBuckets = (data) => saveJson(bucketsFile, data)
  const loadPublicNotes = () => loadJson(publicNotesFile)
  const savePublicNotes = (data) => saveJson(publicNotesFile, data)

  app.post('/api/bucket/publish', (req, res) => {
    const { bucketName, notes } = req.body ?? {}
    if (!bucketName || !SLUG_RE.test(bucketName)) {
      return sendJsonError(res, 400, 'Invalid bucket name - use 2-40 lowercase letters, numbers, hyphens')
    }
    if (!Array.isArray(notes)) {
      return sendJsonError(res, 400, 'notes must be an array')
    }

    const buckets = loadBuckets()
    buckets[bucketName] = {
      publishedAt: Date.now(),
      notes: notes.map(note => ({
        id: note.id,
        content: note.content,
        categories: note.categories ?? [],
        updatedAt: note.updatedAt,
      })),
    }
    saveBuckets(buckets)
    res.json({ ok: true, count: notes.length, url: `/b/${bucketName}` })
  })

  app.get('/api/bucket/:name', (req, res) => {
    const bucket = loadBuckets()[req.params.name]
    if (!bucket) return sendJsonError(res, 404, 'Not found')
    res.json(bucket)
  })

  app.post('/api/public-note/publish', async (req, res) => {
    const { note } = req.body ?? {}
    if (!note || typeof note !== 'object') return sendJsonError(res, 400, 'note is required')
    if (typeof note.content !== 'string' || !note.content.trim()) {
      return sendJsonError(res, 400, 'Cannot publish an empty note')
    }

    if (pgPool) {
      try {
        const existing = note.id ? await pgFindPublicNoteByNoteId(pgPool, note.id) : null
        if (existing?.slug) {
          await pgUpdatePublicNote(pgPool, existing.slug, note, existing.publishedAt)
          return res.json({ ok: true, url: `/n/${existing.slug}`, slug: existing.slug, reused: true })
        }

        const slug = await pgGenerateSlug(pgPool)
        await pgSavePublicNote(pgPool, slug, note)
        return res.json({ ok: true, url: `/n/${slug}`, slug, reused: false })
      } catch (e) {
        return sendJsonError(res, 500, `Database error: ${e.message}`)
      }
    }

    const publicNotes = loadPublicNotes()
    const existingSlug = note.id ? findExistingSharedSlug(publicNotes, note.id) : null
    const slug = existingSlug ?? generatePublicSlug(publicNotes)
    const existingPublishedAt = existingSlug ? Number(publicNotes[existingSlug]?.publishedAt ?? Date.now()) : Date.now()
    publicNotes[slug] = {
      publishedAt: existingPublishedAt,
      note: {
        id: note.id,
        content: note.content,
        categories: note.categories ?? [],
        updatedAt: note.updatedAt ?? Date.now(),
        viewMode: note.viewMode ?? null,
      },
    }
    savePublicNotes(publicNotes)
    res.json({ ok: true, url: `/n/${slug}`, slug, reused: Boolean(existingSlug) })
  })

  app.get('/api/public-note/:slug', async (req, res) => {
    if (pgPool) {
      try {
        const shared = await pgGetPublicNote(pgPool, req.params.slug)
        if (!shared) return sendJsonError(res, 404, 'Not found')
        return res.json(shared)
      } catch (e) {
        return sendJsonError(res, 500, `Database error: ${e.message}`)
      }
    }

    const shared = loadPublicNotes()[req.params.slug]
    if (!shared) return sendJsonError(res, 404, 'Not found')
    res.json(shared)
  })

  app.get('/api/public-notes', async (_req, res) => {
    if (pgPool) {
      try {
        const links = await pgListPublicNotes(pgPool)
        return res.json({ links })
      } catch (e) {
        return sendJsonError(res, 500, `Database error: ${e.message}`)
      }
    }

    const links = Object.entries(loadPublicNotes())
      .map(([slug, shared]) => summarizeSharedNote(slug, shared))
      .sort((a, b) => b.publishedAt - a.publishedAt)

    return res.json({ links })
  })

  app.delete('/api/public-note/:slug', async (req, res) => {
    if (pgPool) {
      try {
        const deleted = await pgDeletePublicNote(pgPool, req.params.slug)
        if (!deleted) return sendJsonError(res, 404, 'Not found')
        return res.json({ ok: true, slug: req.params.slug })
      } catch (e) {
        return sendJsonError(res, 500, `Database error: ${e.message}`)
      }
    }

    const publicNotes = loadPublicNotes()
    if (!publicNotes[req.params.slug]) return sendJsonError(res, 404, 'Not found')
    delete publicNotes[req.params.slug]
    savePublicNotes(publicNotes)
    return res.json({ ok: true, slug: req.params.slug })
  })

  app.get('/b/:name', (req, res) => {
    const bucket = loadBuckets()[req.params.name]
    if (!bucket) {
      return res.status(404).send(renderNotFoundPage('Bucket', `/b/${esc(req.params.name)}`))
    }
    res.send(renderBucketPage(req.params.name, bucket))
  })

  app.get('/n/:slug', async (req, res) => {
    let shared
    if (pgPool) {
      try {
        shared = await pgGetPublicNote(pgPool, req.params.slug)
      } catch {
        return res.status(500).send('Database error')
      }
    } else {
      shared = loadPublicNotes()[req.params.slug]
    }

    if (!shared) {
      return res.status(404).send(renderNotFoundPage('Note', `/n/${esc(req.params.slug)}`))
    }

    res.send(renderPublicNotePage(req.params.slug, shared))
  })
}
