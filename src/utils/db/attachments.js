import { getDb } from './_instance.js'

function deserializeAttachment(row) {
  return {
    id:        row.id,
    noteId:    row.note_id,
    mimeType:  row.mime_type,
    data:      row.data,
    createdAt: row.created_at,
  }
}

export function insertAttachment(attachment) {
  const db = getDb()
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO attachments (id, note_id, mime_type, data, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [attachment.id, attachment.noteId, attachment.mimeType, attachment.data, attachment.createdAt]
  )
}

export function getAttachmentsForNote(noteId) {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT * FROM attachments WHERE note_id = ? ORDER BY created_at ASC', [noteId])
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const att = {}
    columns.forEach((col, i) => { att[col] = row[i] })
    return deserializeAttachment(att)
  })
}

export function deleteAttachment(id) {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM attachments WHERE id = ?', [id])
}

export function deleteAttachmentsForNote(noteId) {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM attachments WHERE note_id = ?', [noteId])
}

export function pinNote(noteId, collectionId) {
  const db = getDb()
  if (!db) return
  db.run(
    'INSERT OR REPLACE INTO note_pins (note_id, collection_id, pinned_at) VALUES (?, ?, ?)',
    [noteId, collectionId, Date.now()]
  )
}

export function unpinNote(noteId, collectionId) {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM note_pins WHERE note_id = ? AND collection_id = ?', [noteId, collectionId])
}

export function getAllPins() {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT note_id, collection_id, pinned_at FROM note_pins ORDER BY pinned_at ASC')
  if (!result.length) return []
  return result[0].values.map(([noteId, collectionId, pinnedAt]) => ({ noteId, collectionId, pinnedAt }))
}

export function exportSQLite() {
  const db = getDb()
  if (!db) return
  const data = db.export()
  const blob = new Blob([data], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `jotit-${new Date().toISOString().slice(0, 10)}.sqlite`
  a.click()
  URL.revokeObjectURL(url)
}
