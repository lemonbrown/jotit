export function parseCsvTable(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0

  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => {
    pushField()
    if (row.some(f => f !== '')) rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]

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

  if (inQuotes) throw new Error('Unclosed quote in CSV')
  if (field || row.length) pushRow()
  if (rows.length < 2) throw new Error('Need at least a header row and one data row')

  const width = Math.max(...rows.map(r => r.length))
  const headers = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`)
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`)

  const data = rows.slice(1).map(r => {
    const next = [...r]
    while (next.length < width) next.push('')
    return next.slice(0, width)
  })

  return { headers, rows: data }
}

function escapeCsvField(value) {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function serializeCsvTable(headers, rows) {
  return [headers, ...rows]
    .map(row => row.map(escapeCsvField).join(','))
    .join('\n')
}

export function looksLikeCsvTable(text) {
  try {
    const parsed = parseCsvTable(text)
    return parsed.headers.length > 1 && parsed.rows.length > 0
  } catch {
    return false
  }
}
