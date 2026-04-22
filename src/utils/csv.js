import { generateId } from './helpers.js'

// Handles quoted fields (embedded commas, newlines, doubled-quote escapes), CRLF + LF
function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  const pushField = () => { row.push(field); field = '' }
  const pushRow   = () => {
    pushField()
    if (row.some(f => f !== '')) rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch   = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i += 2; continue }
      if (ch === '"')                 { inQuotes = false; i++; continue }
      field += ch
    } else {
      if (ch === '"')                         { inQuotes = true; i++; continue }
      if (ch === ',')                         { pushField(); i++; continue }
      if (ch === '\r' && next === '\n')       { pushRow(); i += 2; continue }
      if (ch === '\r' || ch === '\n')         { pushRow(); i++; continue }
      field += ch
    }
    i++
  }

  if (field || row.length) pushRow()
  return rows
}

function parseTimestamp(val) {
  if (!val) return null
  const n = Number(val)
  if (!isNaN(n) && n > 0) return n
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.getTime()
}

// Map CSV rows → note objects.
// Recognises common column names; falls back to first column as content.
export function csvToNotes(text) {
  const rows = parseCSV(text)
  if (rows.length < 2) return []

  const headers = rows[0].map(h => h.toLowerCase().trim().replace(/\s+/g, '_'))
  const dataRows = rows.slice(1)

  const pick = (record, ...keys) => {
    for (const k of keys) if (record[k] !== undefined && record[k] !== '') return record[k]
    return ''
  }

  return dataRows.flatMap(row => {
    const r = {}
    headers.forEach((h, i) => { r[h] = (row[i] ?? '').trim() })

    const body  = pick(r, 'content', 'body', 'text', 'note', 'message', 'description')
    const title = pick(r, 'title', 'name', 'subject')
    // If no recognised content column, use the first non-empty value
    const rawContent = body || Object.values(r).find(v => v) || ''
    const content = title && !rawContent.startsWith(title)
      ? `${title}\n${rawContent}`
      : rawContent

    if (!content.trim()) return []

    const createdAt = parseTimestamp(pick(r, 'created_at', 'createdat', 'created', 'date', 'timestamp')) ?? Date.now()
    const updatedAt = parseTimestamp(pick(r, 'updated_at', 'updatedat', 'updated', 'modified')) ?? createdAt

    const catsRaw = pick(r, 'categories', 'tags', 'labels')
    let categories = []
    if (catsRaw) {
      try { categories = JSON.parse(catsRaw) }
      catch { categories = catsRaw.split(/[,;|]/).map(c => c.trim()).filter(Boolean) }
    }

    return [{
      id:         generateId(),
      content,
      categories,
      embedding:  null,
      isPublic:   false,
      createdAt,
      updatedAt,
    }]
  })
}
