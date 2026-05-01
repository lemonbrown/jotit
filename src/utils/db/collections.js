import { getDb } from './_instance.js'
import { createDefaultCollectionDraft, DEFAULT_COLLECTION_NAME, LEGACY_DEFAULT_COLLECTION_NAME } from '../collectionFactories.js'

const DEFAULT_KANBAN_COLUMNS = ['Backlog', 'In Progress', 'Review', 'Done']

function deserializeCollection(row) {
  let kanbanColumns = DEFAULT_KANBAN_COLUMNS
  if (row.kanban_columns) {
    try { kanbanColumns = JSON.parse(row.kanban_columns) } catch {}
  }
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description ?? '',
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
    isDefault:     row.is_default === 1,
    isPublic:      row.is_public === 1,
    dirty:         row.dirty,
    pendingDelete: row.pending_delete === 1,
    kanbanColumns,
  }
}

export function ensureDefaultCollection() {
  const db = getDb()
  if (!db) return null

  const existingDefault = getDefaultCollection()
  const collection = existingDefault ?? createDefaultCollectionDraft()

  if (!existingDefault) {
    upsertCollectionSync(collection)
  } else if (existingDefault.name === LEGACY_DEFAULT_COLLECTION_NAME) {
    upsertCollectionSync({ ...existingDefault, name: DEFAULT_COLLECTION_NAME, updatedAt: Date.now() })
  }

  db.run('UPDATE notes SET collection_id = ? WHERE collection_id IS NULL OR collection_id = ?', [collection.id, ''])
  return collection
}

export function getDefaultCollection() {
  const db = getDb()
  if (!db) return null
  const result = db.exec(
    'SELECT * FROM collections WHERE pending_delete = 0 AND is_default = 1 ORDER BY created_at ASC LIMIT 1'
  )
  if (!result.length || !result[0].values.length) return null
  const { columns, values } = result[0]
  const row = {}
  columns.forEach((col, i) => { row[col] = values[0][i] })
  return deserializeCollection(row)
}

export function getAllCollections() {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT * FROM collections WHERE pending_delete = 0 ORDER BY is_default DESC, updated_at DESC')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const collection = {}
    columns.forEach((col, i) => { collection[col] = row[i] })
    return deserializeCollection(collection)
  })
}

export function getDirtyCollections() {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT * FROM collections WHERE dirty = 1')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const collection = {}
    columns.forEach((col, i) => { collection[col] = row[i] })
    return deserializeCollection(collection)
  })
}

export function upsertCollectionSync(collection, dirty = 1) {
  const db = getDb()
  if (!db || !collection?.id || !collection.name?.trim()) return
  db.run(
    `INSERT OR REPLACE INTO collections
       (id, name, description, created_at, updated_at, is_default, dirty, pending_delete, is_public, kanban_columns)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      collection.id,
      collection.name.trim(),
      collection.description ?? '',
      collection.createdAt,
      collection.updatedAt,
      collection.isDefault ? 1 : 0,
      dirty,
      collection.isPublic ? 1 : 0,
      collection.kanbanColumns ? JSON.stringify(collection.kanbanColumns) : null,
    ]
  )
}

export function setCollectionPublic(id, isPublic) {
  const db = getDb()
  if (!db) return
  db.run('UPDATE collections SET is_public = ?, dirty = 1, updated_at = ? WHERE id = ?', [isPublic ? 1 : 0, Date.now(), id])
}

export function setNoteCollectionExcluded(noteId, excluded) {
  const db = getDb()
  if (!db) return
  db.run('UPDATE notes SET collection_excluded = ?, dirty = 1, updated_at = ? WHERE id = ?', [excluded ? 1 : 0, Date.now(), noteId])
}

export function markCollectionPendingDelete(id) {
  const db = getDb()
  if (!db) return
  const fallback = getDefaultCollection()
  if (fallback && fallback.id !== id) {
    db.run('UPDATE notes SET collection_id = ?, dirty = 1, updated_at = ? WHERE collection_id = ?', [fallback.id, Date.now(), id])
  }
  db.run('UPDATE collections SET pending_delete = 1, dirty = 1, updated_at = ? WHERE id = ? AND is_default = 0', [Date.now(), id])
}

export function deleteCollectionSync(id) {
  const db = getDb()
  if (!db) return
  const fallback = getDefaultCollection()
  if (fallback && fallback.id !== id) {
    db.run('UPDATE notes SET collection_id = ? WHERE collection_id = ?', [fallback.id, id])
  }
  db.run('DELETE FROM collections WHERE id = ? AND is_default = 0', [id])
}

export function moveNoteToCollection(noteId, collectionId) {
  const db = getDb()
  if (!db || !noteId || !collectionId) return
  db.run('UPDATE notes SET collection_id = ?, dirty = 1, updated_at = ? WHERE id = ?', [collectionId, Date.now(), noteId])
}

export function markCollectionsSynced(ids) {
  const db = getDb()
  if (!db || !ids.length) return
  const stmt = db.prepare('UPDATE collections SET dirty = 0 WHERE id = ?')
  for (const id of ids) stmt.run([id])
  stmt.free()
}

export function setCollectionKanbanColumns(collectionId, columns) {
  const db = getDb()
  if (!db || !collectionId) return
  db.run('UPDATE collections SET kanban_columns = ?, dirty = 1, updated_at = ? WHERE id = ?', [
    JSON.stringify(columns),
    Date.now(),
    collectionId,
  ])
}

export function cleanupPendingCollectionDeletes() {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM collections WHERE pending_delete = 1 AND is_default = 0')
}
