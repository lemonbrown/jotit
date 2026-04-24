import pg from 'pg'
import { deleteNoteArtifacts, indexNoteOnServer } from './indexing.js'
import { logServerError, sendJsonError } from './http.js'

export function createSyncPool(databaseUrl) {
  if (!databaseUrl) {
    console.log('[JotIt] DATABASE_URL not set - sync disabled')
    return null
  }

  const { Pool } = pg
  const pgPool = new Pool({ connectionString: databaseUrl })
  pgPool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id          TEXT    NOT NULL,
      user_id     INTEGER NOT NULL,
      content     TEXT    NOT NULL DEFAULT '',
      categories  TEXT    NOT NULL DEFAULT '[]',
      embedding   TEXT,
      note_type   TEXT    NOT NULL DEFAULT 'text',
      note_data   TEXT,
      created_at  BIGINT  NOT NULL,
      updated_at  BIGINT  NOT NULL,
      is_public   INTEGER NOT NULL DEFAULT 0,
      deleted_at  BIGINT,
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS notes_user_updated ON notes (user_id, updated_at);
    CREATE INDEX IF NOT EXISTS notes_user_deleted ON notes (user_id, deleted_at);

    CREATE TABLE IF NOT EXISTS note_chunks (
      id            TEXT    NOT NULL,
      note_id       TEXT    NOT NULL,
      user_id       INTEGER NOT NULL,
      content       TEXT    NOT NULL,
      kind          TEXT    NOT NULL DEFAULT 'prose',
      section_title TEXT,
      start_offset  INTEGER NOT NULL DEFAULT 0,
      end_offset    INTEGER NOT NULL DEFAULT 0,
      created_at    BIGINT  NOT NULL,
      updated_at    BIGINT  NOT NULL,
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS note_chunks_user_note ON note_chunks (user_id, note_id);

    CREATE TABLE IF NOT EXISTS note_chunk_embeddings (
      chunk_id    TEXT    NOT NULL,
      note_id     TEXT    NOT NULL,
      user_id     INTEGER NOT NULL,
      embedding   TEXT    NOT NULL,
      model       TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
      updated_at  BIGINT  NOT NULL,
      PRIMARY KEY (chunk_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS note_chunk_embeddings_user_note ON note_chunk_embeddings (user_id, note_id);

    CREATE TABLE IF NOT EXISTS note_entities (
      id               TEXT    NOT NULL,
      note_id          TEXT    NOT NULL,
      user_id          INTEGER NOT NULL,
      chunk_id         TEXT,
      entity_type      TEXT    NOT NULL,
      entity_value     TEXT    NOT NULL,
      normalized_value TEXT    NOT NULL,
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS note_entities_user_note ON note_entities (user_id, note_id);

    CREATE TABLE IF NOT EXISTS search_metadata (
      note_id         TEXT    NOT NULL,
      user_id         INTEGER NOT NULL,
      keywords        TEXT    NOT NULL DEFAULT '[]',
      facets          TEXT    NOT NULL DEFAULT '[]',
      last_indexed_at BIGINT  NOT NULL,
      PRIMARY KEY (note_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS public_notes (
      slug         TEXT PRIMARY KEY,
      note_id      TEXT NOT NULL,
      content      TEXT NOT NULL DEFAULT '',
      categories   TEXT    NOT NULL DEFAULT '[]',
      view_mode    TEXT,
      published_at BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL
    );
  `).then(() => console.log('[JotIt] Postgres ready'))
    .catch(err => console.error('[JotIt] Postgres init failed:', err.message))

  pgPool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_type TEXT NOT NULL DEFAULT 'text'`)
    .catch(err => console.error('[JotIt] Postgres note_type migration failed:', err.message))
  pgPool.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_data TEXT')
    .catch(err => console.error('[JotIt] Postgres note_data migration failed:', err.message))

  return pgPool
}

export function registerSyncRoutes(app, { aiService, pgPool, requireAuth }) {
  app.post('/api/sync/push', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Sync not configured')

    const { notes } = req.body ?? {}
    if (!Array.isArray(notes)) return sendJsonError(res, 400, 'notes must be an array')

    const userId = req.user.userId
    try {
      for (const note of notes) {
        if (!note.id || typeof note.id !== 'string') continue

        if (note.deleted) {
          await pgPool.query(
            `INSERT INTO notes (id, user_id, content, categories, embedding, note_type, note_data, created_at, updated_at, is_public, deleted_at)
             VALUES ($1, $2, '', '[]', NULL, 'text', NULL, $3, $3, 0, $3)
             ON CONFLICT (id, user_id) DO UPDATE SET deleted_at = $3, updated_at = $3`,
            [note.id, userId, Date.now()]
          )
          await deleteNoteArtifacts(pgPool, note.id, userId)
          continue
        }

        await pgPool.query(
          `INSERT INTO notes (id, user_id, content, categories, embedding, note_type, note_data, created_at, updated_at, is_public)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id, user_id) DO UPDATE SET
             content    = EXCLUDED.content,
             categories = EXCLUDED.categories,
             embedding  = NULL,
             note_type  = EXCLUDED.note_type,
             note_data  = EXCLUDED.note_data,
             updated_at = EXCLUDED.updated_at,
             is_public  = EXCLUDED.is_public,
             deleted_at = NULL
           WHERE notes.updated_at < EXCLUDED.updated_at`,
          [
            note.id,
            userId,
            note.content ?? '',
            note.categories ?? '[]',
            null,
            note.note_type ?? 'text',
            note.note_data ?? null,
            note.created_at ?? Date.now(),
            note.updated_at ?? Date.now(),
            note.is_public ? 1 : 0,
          ]
        )

        await indexNoteOnServer(pgPool, aiService, userId, note)
      }

      res.json({ ok: true, pushed: notes.length })
    } catch (e) {
      logServerError('[JotIt] Sync push error:', e)
      sendJsonError(res, 500, 'Sync failed')
    }
  })

  app.get('/api/sync/pull', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Sync not configured')

    const userId = req.user.userId
    const since = Math.max(0, parseInt(req.query.since ?? '0', 10) || 0)
    const serverTime = Date.now()

    try {
      const { rows } = await pgPool.query(
        `SELECT * FROM notes
         WHERE user_id = $1
           AND (updated_at > $2 OR (deleted_at IS NOT NULL AND deleted_at > $2))`,
        [userId, since]
      )
      res.json({ notes: rows, serverTime })
    } catch (e) {
      logServerError('[JotIt] Sync pull error:', e)
      sendJsonError(res, 500, 'Sync failed')
    }
  })

}
