import * as sqlJsModule from 'sql.js'
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url'
import { setDb, getDb } from './_instance.js'
import { ensureDefaultCollection } from './collections.js'
import { upsertNoteSync } from './notes.js'

const initSqlJs = sqlJsModule.default ?? sqlJsModule

const IDB_NAME = 'jotit_db'
const IDB_STORE = 'sqlite'
const IDB_KEY = 'main'

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

// ── Schema ─────────────────────────────────────────────────────────────────────

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

  CREATE TABLE IF NOT EXISTS note_pins (
    note_id       TEXT    NOT NULL,
    collection_id TEXT    NOT NULL,
    pinned_at     INTEGER NOT NULL,
    PRIMARY KEY (note_id, collection_id)
  );

  CREATE TABLE IF NOT EXISTS templates (
    id         TEXT    PRIMARY KEY,
    command    TEXT    NOT NULL UNIQUE,
    name       TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

// ── Init ───────────────────────────────────────────────────────────────────────

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

export async function initDB() {
  const SQL = await initSqlJs({ locateFile: () => sqlWasm })
  const saved = await loadBytes()

  const instance = saved ? new SQL.Database(saved) : new SQL.Database()
  setDb(instance)
  instance.run(SCHEMA)

  try { instance.run('ALTER TABLE notes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0') } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1') } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN pending_delete INTEGER NOT NULL DEFAULT 0') } catch {}
  try { instance.run(`ALTER TABLE notes ADD COLUMN note_type TEXT NOT NULL DEFAULT 'text'`) } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN note_data TEXT') } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN encryption_tier INTEGER NOT NULL DEFAULT 0') } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN collection_id TEXT') } catch {}
  try { instance.run('CREATE INDEX IF NOT EXISTS idx_notes_collection_id ON notes(collection_id)') } catch {}
  try { instance.run('ALTER TABLE collections ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0') } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN collection_excluded INTEGER NOT NULL DEFAULT 0') } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN secrets_cleared_hash TEXT') } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN sync_included INTEGER DEFAULT NULL') } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN sync_excluded INTEGER NOT NULL DEFAULT 0') } catch {}
  try { instance.run(`CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, command TEXT NOT NULL UNIQUE, name TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`) } catch {}
  try { instance.run('ALTER TABLE notes ADD COLUMN kanban_status TEXT') } catch {}
  try { instance.run('ALTER TABLE collections ADD COLUMN kanban_columns TEXT') } catch {}

  ensureDefaultCollection()

  const count = instance.exec('SELECT COUNT(*) as n FROM notes')[0]?.values[0][0] ?? 0
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

  return instance
}

// ── Persistence ────────────────────────────────────────────────────────────────

let persistTimer = null

export function schedulePersist() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(persist, 800)
}

export async function persist() {
  const db = getDb()
  if (!db) return
  const data = db.export()
  await saveBytes(data)
}
