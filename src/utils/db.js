import * as sqlJsModule from 'sql.js'
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url'
import { createDefaultCollectionDraft, DEFAULT_COLLECTION_NAME, LEGACY_DEFAULT_COLLECTION_NAME } from './collectionFactories.js'

const initSqlJs = sqlJsModule.default ?? sqlJsModule

const IDB_NAME = 'jotit_db'
const IDB_STORE = 'sqlite'
const IDB_KEY = 'main'

let db = null

// ── IndexedDB helpers ──────────────────────────────────────────────────────────

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadBytes() {
  try {
    const idb = await openIDB()
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

async function saveBytes(data) {
  try {
    const idb = await openIDB()
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(data, IDB_KEY)
      tx.oncomplete = resolve
      tx.onerror = resolve
    })
  } catch {}
}

// ── Schema & init ──────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS notes (
    id                  TEXT PRIMARY KEY,
    collection_id       TEXT,
    content             TEXT    NOT NULL DEFAULT '',
    categories          TEXT    NOT NULL DEFAULT '[]',
    embedding           TEXT,
    note_type           TEXT    NOT NULL DEFAULT 'text',
    note_data           TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    is_public           INTEGER NOT NULL DEFAULT 0,
    encryption_tier     INTEGER NOT NULL DEFAULT 0,
    collection_excluded INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS snippets (
    id             TEXT PRIMARY KEY,
    name           TEXT,
    content        TEXT    NOT NULL DEFAULT '',
    embedding      TEXT,
    source_note_id TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS note_chunks (
    id            TEXT PRIMARY KEY,
    note_id       TEXT NOT NULL,
    content       TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'prose',
    section_title TEXT,
    start_offset  INTEGER NOT NULL DEFAULT 0,
    end_offset    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_note_chunks_note_id ON note_chunks(note_id);

  CREATE TABLE IF NOT EXISTS note_entities (
    id               TEXT PRIMARY KEY,
    note_id          TEXT NOT NULL,
    chunk_id         TEXT,
    entity_type      TEXT NOT NULL,
    entity_value     TEXT NOT NULL,
    normalized_value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_note_entities_note_id ON note_entities(note_id);
  CREATE INDEX IF NOT EXISTS idx_note_entities_normalized_value ON note_entities(normalized_value);

  CREATE TABLE IF NOT EXISTS collections (
    id             TEXT PRIMARY KEY,
    name           TEXT    NOT NULL,
    description    TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    is_default     INTEGER NOT NULL DEFAULT 0,
    dirty          INTEGER NOT NULL DEFAULT 1,
    pending_delete INTEGER NOT NULL DEFAULT 0,
    is_public      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS search_metadata (
    note_id         TEXT PRIMARY KEY,
    keywords        TEXT NOT NULL DEFAULT '[]',
    facets          TEXT NOT NULL DEFAULT '[]',
    last_indexed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id         TEXT PRIMARY KEY,
    note_id    TEXT    NOT NULL,
    mime_type  TEXT    NOT NULL,
    data       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments(note_id);
`

export async function initDB() {
  const SQL = await initSqlJs({ locateFile: () => sqlWasm })
  const saved = await loadBytes()

  db = saved ? new SQL.Database(saved) : new SQL.Database()
  db.run(SCHEMA)
  // Migrate: add columns if missing (safe to run on existing DBs)
  try { db.run('ALTER TABLE notes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1') } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN pending_delete INTEGER NOT NULL DEFAULT 0') } catch {}
  try { db.run(`ALTER TABLE notes ADD COLUMN note_type TEXT NOT NULL DEFAULT 'text'`) } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN note_data TEXT') } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN encryption_tier INTEGER NOT NULL DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN collection_id TEXT') } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_notes_collection_id ON notes(collection_id)') } catch {}
  try { db.run('ALTER TABLE collections ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE notes ADD COLUMN collection_excluded INTEGER NOT NULL DEFAULT 0') } catch {}

  ensureDefaultCollection()

  // Migrate from localStorage if SQLite is empty and localStorage has data
  const count = db.exec('SELECT COUNT(*) as n FROM notes')[0]?.values[0][0] ?? 0
  if (count === 0) {
    try {
      const raw = localStorage.getItem('jotit_notes')
      if (raw) {
        const notes = JSON.parse(raw)
        for (const n of notes) migrateNote(n)
        await persist()
        localStorage.removeItem('jotit_notes')
        console.info(`[jot.it] Migrated ${notes.length} notes from localStorage → SQLite`)
      }
    } catch (e) {
      console.warn('[jot.it] Migration failed:', e)
    }
  }

  return db
}

// Handles old notes that had a title field
function migrateNote(n) {
  let content = n.content ?? ''
  if (n.title && !content.startsWith(n.title)) {
    content = n.title + (content ? '\n' + content : '')
  }
  upsertNoteSync({
    id: n.id,
    content,
    categories: n.categories ?? [],
    embedding: n.embedding ?? null,
    noteType: n.noteType ?? 'text',
    noteData: n.noteData ?? null,
    createdAt: n.createdAt ?? Date.now(),
    updatedAt: n.updatedAt ?? Date.now(),
  })
}

// ── Persistence ────────────────────────────────────────────────────────────────

let persistTimer = null

export function schedulePersist() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(persist, 800)
}

export async function persist() {
  if (!db) return
  const data = db.export()
  await saveBytes(data)
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export function ensureDefaultCollection() {
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
  if (!db || !collection?.id || !collection.name?.trim()) return
  db.run(
    `INSERT OR REPLACE INTO collections
       (id, name, description, created_at, updated_at, is_default, dirty, pending_delete, is_public)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      collection.id,
      collection.name.trim(),
      collection.description ?? '',
      collection.createdAt,
      collection.updatedAt,
      collection.isDefault ? 1 : 0,
      dirty,
      collection.isPublic ? 1 : 0,
    ]
  )
}

export function setCollectionPublic(id, isPublic) {
  if (!db) return
  db.run('UPDATE collections SET is_public = ?, dirty = 1, updated_at = ? WHERE id = ?', [isPublic ? 1 : 0, Date.now(), id])
}

export function setNoteCollectionExcluded(noteId, excluded) {
  if (!db) return
  db.run('UPDATE notes SET collection_excluded = ?, dirty = 1, updated_at = ? WHERE id = ?', [excluded ? 1 : 0, Date.now(), noteId])
}

export function markCollectionPendingDelete(id) {
  if (!db) return
  const fallback = getDefaultCollection()
  if (fallback && fallback.id !== id) {
    db.run('UPDATE notes SET collection_id = ?, dirty = 1, updated_at = ? WHERE collection_id = ?', [fallback.id, Date.now(), id])
  }
  db.run('UPDATE collections SET pending_delete = 1, dirty = 1, updated_at = ? WHERE id = ? AND is_default = 0', [Date.now(), id])
}

export function deleteCollectionSync(id) {
  if (!db) return
  const fallback = getDefaultCollection()
  if (fallback && fallback.id !== id) {
    db.run('UPDATE notes SET collection_id = ? WHERE collection_id = ?', [fallback.id, id])
  }
  db.run('DELETE FROM collections WHERE id = ? AND is_default = 0', [id])
}

export function moveNoteToCollection(noteId, collectionId) {
  if (!db || !noteId || !collectionId) return
  db.run('UPDATE notes SET collection_id = ?, dirty = 1, updated_at = ? WHERE id = ?', [collectionId, Date.now(), noteId])
}

export function markCollectionsSynced(ids) {
  if (!db || !ids.length) return
  const stmt = db.prepare('UPDATE collections SET dirty = 0 WHERE id = ?')
  for (const id of ids) stmt.run([id])
  stmt.free()
}

export function cleanupPendingCollectionDeletes() {
  if (!db) return
  db.run('DELETE FROM collections WHERE pending_delete = 1 AND is_default = 0')
}

export function getAllNotes() {
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
  if (!db) return
  const collectionId = note.collectionId ?? getDefaultCollection()?.id ?? 'default'
  db.run(
    `INSERT OR REPLACE INTO notes
       (id, collection_id, content, categories, embedding, note_type, note_data, created_at, updated_at, is_public, dirty, pending_delete, encryption_tier, collection_excluded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      note.id,
      collectionId,
      note.content,
      JSON.stringify(note.categories ?? []),
      note.embedding ? JSON.stringify(note.embedding) : null,
      note.noteType ?? 'text',
      note.noteData ? JSON.stringify(note.noteData) : null,
      note.createdAt,
      note.updatedAt,
      note.isPublic ? 1 : 0,
      dirty,
      note.encryptionTier ?? 0,
      note.collectionExcluded ? 1 : 0,
    ]
  )
}

export function markPendingDelete(id) {
  if (!db) return
  db.run('UPDATE notes SET pending_delete = 1, dirty = 1 WHERE id = ?', [id])
}

export function cleanupPendingDeletes() {
  if (!db) return
  db.run('DELETE FROM notes WHERE pending_delete = 1')
}

export function getNote(id) {
  if (!db) return null
  const result = db.exec('SELECT * FROM notes WHERE id = ?', [id])
  if (!result.length || !result[0].values.length) return null
  const { columns, values } = result[0]
  const row = {}
  columns.forEach((col, i) => { row[col] = values[0][i] })
  return deserialize(row)
}

export function getDirtyNotes() {
  if (!db) return []
  const result = db.exec('SELECT * FROM notes WHERE dirty = 1')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const note = {}
    columns.forEach((col, i) => { note[col] = row[i] })
    return deserialize(note)
  })
}

export function markSynced(ids) {
  if (!db || !ids.length) return
  const stmt = db.prepare('UPDATE notes SET dirty = 0 WHERE id = ?')
  for (const id of ids) stmt.run([id])
  stmt.free()
}

export function deleteNoteSync(id) {
  if (!db) return
  db.run('DELETE FROM notes WHERE id = ?', [id])
  db.run('DELETE FROM attachments WHERE note_id = ?', [id])
  deleteNoteSearchArtifacts(id)
}

export function replaceNoteSearchArtifacts(noteId, { chunks = [], entities = [], metadata = null }) {
  if (!db || !noteId) return

  db.run('DELETE FROM note_chunks WHERE note_id = ?', [noteId])
  db.run('DELETE FROM note_entities WHERE note_id = ?', [noteId])
  db.run('DELETE FROM search_metadata WHERE note_id = ?', [noteId])

  for (const chunk of chunks) {
    db.run(
      `INSERT INTO note_chunks
         (id, note_id, content, kind, section_title, start_offset, end_offset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chunk.id,
        chunk.noteId,
        chunk.content,
        chunk.kind,
        chunk.sectionTitle ?? null,
        chunk.startOffset ?? 0,
        chunk.endOffset ?? 0,
        chunk.createdAt ?? Date.now(),
        chunk.updatedAt ?? Date.now(),
      ]
    )
  }

  for (const entity of entities) {
    db.run(
      `INSERT INTO note_entities
         (id, note_id, chunk_id, entity_type, entity_value, normalized_value)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entity.id,
        entity.noteId,
        entity.chunkId ?? null,
        entity.entityType,
        entity.entityValue,
        entity.normalizedValue,
      ]
    )
  }

  if (metadata) {
    db.run(
      `INSERT INTO search_metadata
         (note_id, keywords, facets, last_indexed_at)
       VALUES (?, ?, ?, ?)`,
      [
        metadata.noteId,
        JSON.stringify(metadata.keywords ?? []),
        JSON.stringify(metadata.facets ?? []),
        metadata.lastIndexedAt ?? Date.now(),
      ]
    )
  }
}

export function deleteNoteSearchArtifacts(noteId) {
  if (!db) return
  db.run('DELETE FROM note_chunks WHERE note_id = ?', [noteId])
  db.run('DELETE FROM note_entities WHERE note_id = ?', [noteId])
  db.run('DELETE FROM search_metadata WHERE note_id = ?', [noteId])
}

export function getAllNoteChunks() {
  if (!db) return []
  const result = db.exec('SELECT * FROM note_chunks')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const chunk = {}
    columns.forEach((col, i) => { chunk[col] = row[i] })
    return deserializeChunk(chunk)
  })
}

export function getAllNoteEntities() {
  if (!db) return []
  const result = db.exec('SELECT * FROM note_entities')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const entity = {}
    columns.forEach((col, i) => { entity[col] = row[i] })
    return deserializeEntity(entity)
  })
}

export function getSearchMetadataMap() {
  if (!db) return new Map()
  const result = db.exec('SELECT * FROM search_metadata')
  if (!result.length) return new Map()
  const { columns, values } = result[0]
  return new Map(values.map(row => {
    const metadata = {}
    columns.forEach((col, i) => { metadata[col] = row[i] })
    const deserialized = deserializeSearchMetadata(metadata)
    return [deserialized.noteId, deserialized]
  }))
}

export function getAllSnippets() {
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
  if (!db) return
  db.run('DELETE FROM snippets WHERE id = ?', [id])
}

// ── Attachments ────────────────────────────────────────────────────────────────

export function insertAttachment(attachment) {
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO attachments (id, note_id, mime_type, data, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [attachment.id, attachment.noteId, attachment.mimeType, attachment.data, attachment.createdAt]
  )
}

export function getAttachmentsForNote(noteId) {
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
  if (!db) return
  db.run('DELETE FROM attachments WHERE id = ?', [id])
}

export function deleteAttachmentsForNote(noteId) {
  if (!db) return
  db.run('DELETE FROM attachments WHERE note_id = ?', [noteId])
}

// Export the raw .sqlite file as a download
export function exportSQLite() {
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function deserialize(row) {
  return {
    id:                 row.id,
    collectionId:       row.collection_id ?? 'default',
    content:            row.content,
    categories:         JSON.parse(row.categories ?? '[]'),
    embedding:          row.embedding ? JSON.parse(row.embedding) : null,
    noteType:           row.note_type ?? 'text',
    noteData:           row.note_data ? JSON.parse(row.note_data) : null,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
    isPublic:           row.is_public === 1,
    dirty:              row.dirty,
    pendingDelete:      row.pending_delete === 1,
    encryptionTier:     Number(row.encryption_tier ?? 0),
    collectionExcluded: row.collection_excluded === 1,
  }
}

function deserializeCollection(row) {
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
  }
}

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

function deserializeChunk(row) {
  return {
    id: row.id,
    noteId: row.note_id,
    content: row.content,
    kind: row.kind ?? 'prose',
    sectionTitle: row.section_title ?? null,
    startOffset: row.start_offset ?? 0,
    endOffset: row.end_offset ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function deserializeEntity(row) {
  return {
    id: row.id,
    noteId: row.note_id,
    chunkId: row.chunk_id ?? null,
    entityType: row.entity_type,
    entityValue: row.entity_value,
    normalizedValue: row.normalized_value,
  }
}

function deserializeSearchMetadata(row) {
  return {
    noteId: row.note_id,
    keywords: JSON.parse(row.keywords ?? '[]'),
    facets: JSON.parse(row.facets ?? '[]'),
    lastIndexedAt: row.last_indexed_at ?? 0,
  }
}

function deserializeAttachment(row) {
  return {
    id:        row.id,
    noteId:    row.note_id,
    mimeType:  row.mime_type,
    data:      row.data,
    createdAt: row.created_at,
  }
}
