import { getDb } from './_instance.js'
import { getDefaultCollection } from './collections.js'
import { deleteNoteSearchArtifacts } from './search.js'

function deserialize(row) {
  const noteData = row.note_data ? JSON.parse(row.note_data) : null
  return {
    id:                 row.id,
    collectionId:       row.collection_id ?? 'default',
    content:            row.content,
    categories:         JSON.parse(row.categories ?? '[]'),
    embedding:          row.embedding ? JSON.parse(row.embedding) : null,
    noteType:           row.note_type ?? 'text',
    noteData,
    git:                noteData?.git ?? null,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
    isPublic:           row.is_public === 1,
    dirty:              row.dirty,
    pendingDelete:      row.pending_delete === 1,
    encryptionTier:     Number(row.encryption_tier ?? 0),
    collectionExcluded: row.collection_excluded === 1,
    secretsClearedHash: row.secrets_cleared_hash ?? null,
    syncIncluded:       row.sync_included === 1,
    syncExcluded:       row.sync_excluded === 1,
    kanbanStatus:       row.kanban_status ?? null,
  }
}

export function getAllNotes() {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT * FROM notes WHERE pending_delete = 0 ORDER BY updated_at DESC')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const note = {}
    columns.forEach((col, i) => { note[col] = row[i] })
    return deserialize(note)
  })
}

export function getNotesForCollection(collectionId) {
  const db = getDb()
  if (!db || !collectionId) return []
  const result = db.exec(
    'SELECT * FROM notes WHERE pending_delete = 0 AND collection_id = ? ORDER BY updated_at DESC',
    [collectionId]
  )
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const note = {}
    columns.forEach((col, i) => { note[col] = row[i] })
    return deserialize(note)
  })
}

export function upsertNoteSync(note, dirty = 1) {
  const db = getDb()
  if (!db) return
  const collectionId = note.collectionId ?? getDefaultCollection()?.id ?? 'default'
  const baseNoteData = note.noteData && typeof note.noteData === 'object' ? { ...note.noteData } : {}
  if (note.git) baseNoteData.git = note.git
  else if ('git' in baseNoteData) delete baseNoteData.git
  const noteDataForStorage = Object.keys(baseNoteData).length ? baseNoteData : null
  db.run(
    `INSERT OR REPLACE INTO notes
       (id, collection_id, content, categories, embedding, note_type, note_data, created_at, updated_at, is_public, dirty, pending_delete, encryption_tier, collection_excluded, secrets_cleared_hash, sync_included, sync_excluded, kanban_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      note.id,
      collectionId,
      note.content,
      JSON.stringify(note.categories ?? []),
      note.embedding ? JSON.stringify(note.embedding) : null,
      note.noteType ?? 'text',
      noteDataForStorage ? JSON.stringify(noteDataForStorage) : null,
      note.createdAt,
      note.updatedAt,
      note.isPublic ? 1 : 0,
      dirty,
      note.encryptionTier ?? 0,
      note.collectionExcluded ? 1 : 0,
      note.secretsClearedHash ?? null,
      note.syncIncluded ? 1 : null,
      note.syncExcluded ? 1 : 0,
      note.kanbanStatus ?? null,
    ]
  )
}

export function setNoteEmbeddingSync(noteId, embedding) {
  const db = getDb()
  if (!db || !noteId) return
  db.run('UPDATE notes SET embedding = ? WHERE id = ?', [
    embedding?.length ? JSON.stringify(embedding) : null,
    noteId,
  ])
}

export function markPendingDelete(id) {
  const db = getDb()
  if (!db) return
  db.run('UPDATE notes SET pending_delete = 1, dirty = 1 WHERE id = ?', [id])
}

export function cleanupPendingDeletes() {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM notes WHERE pending_delete = 1')
}

export function getNote(id) {
  const db = getDb()
  if (!db) return null
  const result = db.exec('SELECT * FROM notes WHERE id = ?', [id])
  if (!result.length || !result[0].values.length) return null
  const { columns, values } = result[0]
  const row = {}
  columns.forEach((col, i) => { row[col] = values[0][i] })
  return deserialize(row)
}

export function getDirtyNotes(syncEnabled = true) {
  const db = getDb()
  if (!db) return []
  const sql = syncEnabled
    ? 'SELECT * FROM notes WHERE dirty = 1 AND sync_excluded = 0'
    : 'SELECT * FROM notes WHERE dirty = 1 AND sync_excluded = 0 AND (pending_delete = 1 OR sync_included = 1)'
  const result = db.exec(sql)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const note = {}
    columns.forEach((col, i) => { note[col] = row[i] })
    return deserialize(note)
  })
}

export function setSyncIncluded(noteId, included) {
  const db = getDb()
  if (!db) return
  const val = included ? 1 : null
  db.run('UPDATE notes SET sync_included = ?, dirty = 1, updated_at = ? WHERE id = ?', [val, Date.now(), noteId])
}

export function setSyncExcluded(noteId) {
  const db = getDb()
  if (!db) return
  db.run('UPDATE notes SET sync_excluded = 1, dirty = 0 WHERE id = ?', [noteId])
}

export function setAllSyncExcluded() {
  const db = getDb()
  if (!db) return
  db.run('UPDATE notes SET sync_excluded = 1, dirty = 0 WHERE pending_delete = 0')
}

export function markSynced(ids) {
  const db = getDb()
  if (!db || !ids.length) return
  const stmt = db.prepare('UPDATE notes SET dirty = 0 WHERE id = ?')
  for (const id of ids) stmt.run([id])
  stmt.free()
}

export function setNoteKanbanStatus(noteId, status) {
  const db = getDb()
  if (!db || !noteId) return
  db.run('UPDATE notes SET kanban_status = ?, dirty = 1, updated_at = ? WHERE id = ?', [status ?? null, Date.now(), noteId])
}

export function deleteNoteSync(id) {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM notes WHERE id = ?', [id])
  db.run('DELETE FROM attachments WHERE note_id = ?', [id])
  deleteNoteSearchArtifacts(id)
}
