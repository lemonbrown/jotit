import { getDb } from './_instance.js'

function deserializeSnippet(row) {
  return {
    id: row.id,
    name: row.name ?? '',
    content: row.content,
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
    sourceNoteId: row.source_note_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function deserializeTemplate(row) {
  return {
    id:        row.id,
    command:   row.command,
    name:      row.name ?? '',
    body:      row.body ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getAllSnippets() {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT * FROM snippets ORDER BY updated_at DESC')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const snippet = {}
    columns.forEach((col, i) => { snippet[col] = row[i] })
    return deserializeSnippet(snippet)
  })
}

export function upsertSnippetSync(snippet) {
  const db = getDb()
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO snippets
       (id, name, content, embedding, source_note_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      snippet.id,
      snippet.name?.trim() ? snippet.name.trim() : null,
      snippet.content,
      snippet.embedding ? JSON.stringify(snippet.embedding) : null,
      snippet.sourceNoteId ?? null,
      snippet.createdAt,
      snippet.updatedAt,
    ]
  )
}

export function deleteSnippetSync(id) {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM snippets WHERE id = ?', [id])
}

export function getAllTemplates() {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT * FROM templates ORDER BY updated_at DESC')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const t = {}
    columns.forEach((col, i) => { t[col] = row[i] })
    return deserializeTemplate(t)
  })
}

export function upsertTemplateSync(template) {
  const db = getDb()
  if (!db || !template?.id || !template.command?.trim()) return
  db.run(
    `INSERT OR REPLACE INTO templates (id, command, name, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      template.id,
      template.command.trim(),
      template.name?.trim() ?? '',
      template.body ?? '',
      template.createdAt,
      template.updatedAt,
    ]
  )
}

export function deleteTemplateSync(id) {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM templates WHERE id = ?', [id])
}
