import { marked } from 'marked'

export function timeAgo(ms) {
  const timestamp = Number(ms ?? 0)
  if (!timestamp) return 'unknown'

  const s = Math.floor((Date.now() - timestamp) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function slugifyHeading(text, fallbackIndex) {
  const base = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  return base || `section-${fallbackIndex + 1}`
}

export function extractMarkdownHeadings(content) {
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
    const index = headingIndex
    headingIndex += 1
    const nextAttrs = attrs?.includes('id=')
      ? attrs
      : `${attrs ?? ''} id="${heading.id}" data-heading-index="${index}"`
    return `<h${level}${nextAttrs}>${inner}</h${level}>`
  })
}

function renderDiagramSvg(jsonText) {
  let diagram
  try {
    diagram = JSON.parse(jsonText)
  } catch {
    return `<pre><code>${escapeHtml(jsonText)}</code></pre>`
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
      ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" class="diagram-edge-label">${escapeHtml(edge.label)}</text>`
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
    const fill = escapeHtml(node.fill ?? '#18181b')
    const stroke = escapeHtml(node.stroke ?? '#52525b')

    let shape
    if (node.type === 'circle') shape = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${stroke}" />`
    else if (node.type === 'diamond') shape = `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fill}" stroke="${stroke}" />`
    else if (node.type === 'round') shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}" />`
    else if (node.type === 'text') shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent" stroke="transparent" />`
    else shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" />`

    return `<g class="diagram-node">${shape}<foreignObject x="${x + 8}" y="${y + 8}" width="${Math.max(20, w - 16)}" height="${Math.max(20, h - 16)}"><div xmlns="http://www.w3.org/1999/xhtml" class="diagram-label">${escapeHtml(node.text ?? '')}</div></foreignObject></g>`
  }).join('')

  return `<div class="diagram-wrap"><svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img" aria-label="jot.it diagram">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#71717a" /></marker></defs>
    ${edgeEls}${nodeEls}
  </svg></div>`
}

export function parseContentSegments(rawContent) {
  const content = String(rawContent ?? '').replace(/\[img:\/\/[^\]]+\]/g, '')
  const segments = []
  const fenceRe = /```csv\s*\n([\s\S]*?)\n```/g
  let last = 0
  let match
  while ((match = fenceRe.exec(content)) !== null) {
    if (match.index > last) segments.push({ type: 'markdown', content: content.slice(last, match.index) })
    segments.push({ type: 'csv', content: match[1] })
    last = match.index + match[0].length
  }
  if (last < content.length) segments.push({ type: 'markdown', content: content.slice(last) })
  return segments
}

export function renderPublicMarkdown(content) {
  const stripped = String(content ?? '').replace(/\[img:\/\/[^\]]+\]/g, '')
  const withDiagrams = stripped.replace(/```jotit-diagram\s*\n([\s\S]*?)\n```/g, (_, json) => renderDiagramSvg(json))
  const headings = extractMarkdownHeadings(withDiagrams)
  return {
    headings,
    html: injectHeadingAnchors(marked.parse(withDiagrams), headings),
  }
}

export function parseCsvRows(text) {
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
  return rows
}
