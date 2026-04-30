import { extractSQLiteAssetRef } from './sqliteNote.js'

export function parseSqlCommand(line) {
  const text = String(line ?? '').trim()
  if (text !== '/sql' && !text.startsWith('/sql ')) return null
  const rest = text.slice(4).trim()
  return parseSqlRest(rest)
}

export function parseSqlRest(rest) {
  const s = String(rest ?? '').trim()
  if (s.startsWith('@')) {
    const spaceIdx = s.indexOf(' ')
    if (spaceIdx === -1) return { db: s.slice(1), query: '' }
    return { db: s.slice(1, spaceIdx), query: s.slice(spaceIdx + 1).trim() }
  }
  return { db: null, query: s }
}

export function getSqlDbAtTrigger(text, cursor) {
  const before = String(text ?? '').slice(0, cursor)
  const lineStart = before.lastIndexOf('\n') + 1
  const line = before.slice(lineStart)

  if (!line.startsWith('/sql ') && !line.startsWith('/nib sql ')) return null

  const atIdx = line.lastIndexOf('@')
  if (atIdx === -1) return null

  const afterAt = line.slice(atIdx + 1)
  if (/\s/.test(afterAt)) return null

  return {
    atStart: lineStart + atIdx,
    start: lineStart + atIdx + 1,
    end: cursor,
    query: afterAt,
  }
}

export function filterSqliteNotes(notes, query = '') {
  const q = String(query ?? '').trim().toLowerCase()
  return (notes ?? [])
    .filter(n => extractSQLiteAssetRef(n.content))
    .filter(n => !q || (n.content.split('\n')[0] ?? '').toLowerCase().includes(q))
    .slice(0, 20)
}

export function resolveSqliteNoteByRef(notes, ref) {
  if (!ref) return null
  return notes.find(n => n.id === ref) ||
    notes.find(n => extractSQLiteAssetRef(n.content) && n.content.split('\n')[0].trim().toLowerCase().includes(ref.toLowerCase())) ||
    null
}

export function formatSqlResultText(result) {
  const { columns = [], rows = [], rowCount = 0 } = result

  if (!columns.length || !rows.length) {
    return `(${rowCount} row${rowCount === 1 ? '' : 's'})`
  }

  const widths = columns.map(col =>
    Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length))
  )
  const pad = (s, w) => String(s ?? '').padEnd(w)
  const sep = widths.map(w => '-'.repeat(w)).join('-+-')

  return [
    `${rowCount} row${rowCount === 1 ? '' : 's'}`,
    columns.map((col, i) => pad(col, widths[i])).join(' | '),
    sep,
    ...rows.map(row => columns.map((col, i) => pad(row[col], widths[i])).join(' | ')),
  ].join('\n')
}

export function extractSqlFromLLMResponse(text) {
  const s = String(text ?? '').trim()
  const fenceMatch = s.match(/```(?:sql)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  return s
}

export function buildNibSqlPrompt(schemaText, prompt) {
  return [
    'You are a SQLite expert. Given the following database schema, write a single SQL SELECT query to answer the request.',
    'Return only the SQL query with no explanation, no markdown, and no code fences.',
    '',
    'Schema:',
    schemaText,
    '',
    'Request: ' + String(prompt ?? ''),
  ].join('\n')
}

export function formatSchemaForPrompt(schema) {
  return (schema?.objects ?? [])
    .map(obj => obj.sql || `-- ${obj.type} ${obj.name}`)
    .filter(Boolean)
    .join(';\n\n')
}
