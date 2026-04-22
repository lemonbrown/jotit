import * as sqlJsModule from 'sql.js'
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url'

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
    id          TEXT PRIMARY KEY,
    content     TEXT    NOT NULL DEFAULT '',
    categories  TEXT    NOT NULL DEFAULT '[]',
    embedding   TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    is_public   INTEGER NOT NULL DEFAULT 0
  );
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
        console.info(`[JotIt] Migrated ${notes.length} notes from localStorage → SQLite`)
      }
    } catch (e) {
      console.warn('[JotIt] Migration failed:', e)
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

export function upsertNoteSync(note, dirty = 1) {
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO notes
       (id, content, categories, embedding, created_at, updated_at, is_public, dirty, pending_delete)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      note.id,
      note.content,
      JSON.stringify(note.categories ?? []),
      note.embedding ? JSON.stringify(note.embedding) : null,
      note.createdAt,
      note.updatedAt,
      note.isPublic ? 1 : 0,
      dirty,
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
    id:            row.id,
    content:       row.content,
    categories:    JSON.parse(row.categories ?? '[]'),
    embedding:     row.embedding ? JSON.parse(row.embedding) : null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
    isPublic:      row.is_public === 1,
    dirty:         row.dirty,
    pendingDelete: row.pending_delete === 1,
  }
}
