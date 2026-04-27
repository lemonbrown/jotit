import pg from 'pg'
import { deleteNoteArtifacts, indexNoteOnServer } from './indexing.js'
import { logServerError, sendJsonError } from './http.js'
import { encryptNoteRow, decryptNoteRow, getDataKeyForUser, hasMasterKey } from './encryption.js'

export function createSyncPool(databaseUrl) {
  if (!databaseUrl) {
    console.log('[jot.it] DATABASE_URL not set - sync disabled')
    return null
  }

  const { Pool } = pg
  const pgPool = new Pool({ connectionString: databaseUrl })
  const migrations = [
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_type TEXT NOT NULL DEFAULT 'text'`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_data TEXT`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS encryption_tier INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_iv TEXT`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_tag TEXT`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_data_iv TEXT`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_data_tag TEXT`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS collection_id TEXT`,
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS collection_excluded INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE collections ADD COLUMN IF NOT EXISTS is_public INTEGER NOT NULL DEFAULT 0`,
  ]

  pgPool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id                  TEXT    NOT NULL,
      user_id             INTEGER NOT NULL,
      collection_id       TEXT,
      content             TEXT    NOT NULL DEFAULT '',
      categories          TEXT    NOT NULL DEFAULT '[]',
      embedding           TEXT,
      note_type           TEXT    NOT NULL DEFAULT 'text',
      note_data           TEXT,
      created_at          BIGINT  NOT NULL,
      updated_at          BIGINT  NOT NULL,
      is_public           INTEGER NOT NULL DEFAULT 0,
      deleted_at          BIGINT,
      encryption_tier     INTEGER NOT NULL DEFAULT 0,
      content_iv          TEXT,
      content_tag         TEXT,
      note_data_iv        TEXT,
      note_data_tag       TEXT,
      collection_excluded INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (id, user_id)
    );
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS collection_id TEXT;
    CREATE INDEX IF NOT EXISTS notes_user_updated ON notes (user_id, updated_at);
    CREATE INDEX IF NOT EXISTS notes_user_deleted ON notes (user_id, deleted_at);
    CREATE INDEX IF NOT EXISTS notes_user_collection_updated ON notes (user_id, collection_id, updated_at);

    CREATE TABLE IF NOT EXISTS collections (
      id          TEXT    NOT NULL,
      user_id     INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      description TEXT,
      created_at  BIGINT  NOT NULL,
      updated_at  BIGINT  NOT NULL,
      is_default  INTEGER NOT NULL DEFAULT 0,
      is_public   INTEGER NOT NULL DEFAULT 0,
      deleted_at  BIGINT,
      PRIMARY KEY (id, user_id)
    );
    CREATE INDEX IF NOT EXISTS collections_user_updated ON collections (user_id, updated_at);

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

    CREATE TABLE IF NOT EXISTS note_keys (
      note_id               TEXT    NOT NULL,
      user_id               INTEGER NOT NULL,
      encrypted_content_key TEXT    NOT NULL,
      added_at              BIGINT  NOT NULL,
      PRIMARY KEY (note_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS note_keys_note ON note_keys (note_id);
  `).then(async () => {
    for (const sql of migrations) {
      await pgPool.query(sql).catch(err => console.error('[jot.it] Migration failed:', err.message))
    }
    console.log('[jot.it] Postgres ready')
  }).catch(err => console.error('[jot.it] Postgres init failed:', err.message))

  return pgPool
}

export function registerSyncRoutes(app, { aiService, pgPool, requireAuth, userDb }) {
  app.post('/api/sync/push', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Sync not configured')

    const { collections = [], notes } = req.body ?? {}
    if (!Array.isArray(collections)) return sendJsonError(res, 400, 'collections must be an array')
    if (!Array.isArray(notes)) return sendJsonError(res, 400, 'notes must be an array')

    const userId = req.user.userId
    const dbUser = userDb?.prepare('SELECT encrypted_data_key, data_key_iv FROM users WHERE id = ?').get(userId)
    const dataKey = hasMasterKey() ? getDataKeyForUser(dbUser) : null

    try {
      for (const collection of collections) {
        if (!collection.id || typeof collection.id !== 'string') continue

        if (collection.deleted) {
          await pgPool.query(
            `UPDATE collections
             SET deleted_at = $3, updated_at = $3
             WHERE id = $1 AND user_id = $2 AND is_default = 0`,
            [collection.id, userId, Date.now()]
          )
          continue
        }

        await pgPool.query(
          `INSERT INTO collections
             (id, user_id, name, description, created_at, updated_at, is_default, is_public, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
           ON CONFLICT (id, user_id) DO UPDATE SET
             name        = EXCLUDED.name,
             description = EXCLUDED.description,
             updated_at  = EXCLUDED.updated_at,
             is_default  = EXCLUDED.is_default,
             is_public   = EXCLUDED.is_public,
             deleted_at  = NULL
           WHERE collections.updated_at < EXCLUDED.updated_at`,
          [
            collection.id,
            userId,
            collection.name?.trim() || 'Untitled',
            collection.description ?? '',
            collection.created_at ?? Date.now(),
            collection.updated_at ?? Date.now(),
            collection.is_default ? 1 : 0,
            collection.is_public ? 1 : 0,
          ]
        )
      }

      for (const note of notes) {
        if (!note.id || typeof note.id !== 'string') continue

        if (note.deleted) {
          await pgPool.query(
            `INSERT INTO notes (id, user_id, content, categories, embedding, note_type, note_data, created_at, updated_at, is_public, deleted_at, collection_excluded)
             VALUES ($1, $2, '', '[]', NULL, 'text', NULL, $3, $3, 0, $3, 0)
             ON CONFLICT (id, user_id) DO UPDATE SET deleted_at = $3, updated_at = $3`,
            [note.id, userId, Date.now()]
          )
          await deleteNoteArtifacts(pgPool, note.id, userId)
          continue
        }

        const tier = Number(note.encryption_tier ?? 0)

        let row = {
          id: note.id,
          content: note.content ?? '',
          categories: note.categories ?? '[]',
          collection_id: note.collection_id ?? 'default',
          note_type: note.note_type ?? 'text',
          note_data: note.note_data ?? null,
          created_at: note.created_at ?? Date.now(),
          updated_at: note.updated_at ?? Date.now(),
          is_public: note.is_public ? 1 : 0,
          collection_excluded: note.collection_excluded ? 1 : 0,
          encryption_tier: 0,
          content_iv: null,
          content_tag: null,
          note_data_iv: null,
          note_data_tag: null,
        }

        if (tier === 2) {
          // Tier 2: client already encrypted — store the blobs as-is
          row.encryption_tier = 2
          row.content_iv = note.content_iv ?? null
          row.content_tag = note.content_tag ?? null
          row.note_data_iv = note.note_data_iv ?? null
          row.note_data_tag = note.note_data_tag ?? null

          if (note.encrypted_content_key) {
            await pgPool.query(
              `INSERT INTO note_keys (note_id, user_id, encrypted_content_key, added_at)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (note_id, user_id) DO UPDATE SET encrypted_content_key = EXCLUDED.encrypted_content_key`,
              [note.id, userId, note.encrypted_content_key, Date.now()]
            )
          }
        } else if (dataKey) {
          // Tier 1: server-side AES-256-GCM encryption
          row = encryptNoteRow(row, dataKey)
        }

        await pgPool.query(
          `INSERT INTO notes
             (id, user_id, content, categories, embedding, note_type, note_data,
              created_at, updated_at, is_public, encryption_tier, collection_id,
              content_iv, content_tag, note_data_iv, note_data_tag, collection_excluded)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (id, user_id) DO UPDATE SET
             content         = EXCLUDED.content,
             categories      = EXCLUDED.categories,
             embedding       = NULL,
             note_type       = EXCLUDED.note_type,
             note_data       = EXCLUDED.note_data,
             updated_at      = EXCLUDED.updated_at,
             is_public       = EXCLUDED.is_public,
             deleted_at      = NULL,
             encryption_tier = EXCLUDED.encryption_tier,
             collection_id   = EXCLUDED.collection_id,
             content_iv      = EXCLUDED.content_iv,
             content_tag     = EXCLUDED.content_tag,
             note_data_iv    = EXCLUDED.note_data_iv,
             note_data_tag   = EXCLUDED.note_data_tag,
             collection_excluded = EXCLUDED.collection_excluded
           WHERE notes.updated_at < EXCLUDED.updated_at`,
          [
            row.id, userId, row.content, row.categories, null,
            row.note_type, row.note_data, row.created_at, row.updated_at, row.is_public,
            row.encryption_tier, row.collection_id, row.content_iv, row.content_tag, row.note_data_iv, row.note_data_tag, row.collection_excluded,
          ]
        )

        // Only index plaintext notes — encrypted content can't be searched server-side
        if (row.encryption_tier === 0) {
          await indexNoteOnServer(pgPool, aiService, userId, note)
        }
      }

      res.json({ ok: true, pushed: notes.length, collectionsPushed: collections.length })
    } catch (e) {
      logServerError('[jot.it] Sync push error:', e)
      sendJsonError(res, 500, 'Sync failed')
    }
  })

  app.get('/api/sync/pull', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Sync not configured')

    const userId = req.user.userId
    const since = Math.max(0, parseInt(req.query.since ?? '0', 10) || 0)
    const serverTime = Date.now()

    const dbUser = userDb?.prepare('SELECT encrypted_data_key, data_key_iv FROM users WHERE id = ?').get(userId)
    const dataKey = hasMasterKey() ? getDataKeyForUser(dbUser) : null

    try {
      // LEFT JOIN note_keys so Tier 2 notes include the caller's encrypted content key
      const { rows } = await pgPool.query(
        `SELECT n.*, nk.encrypted_content_key
         FROM notes n
         LEFT JOIN note_keys nk ON nk.note_id = n.id AND nk.user_id = $1
         WHERE n.user_id = $1
           AND (n.updated_at > $2 OR (n.deleted_at IS NOT NULL AND n.deleted_at > $2))`,
        [userId, since]
      )

      const { rows: collectionRows } = await pgPool.query(
        `SELECT *
         FROM collections
         WHERE user_id = $1
           AND (updated_at > $2 OR (deleted_at IS NOT NULL AND deleted_at > $2))`,
        [userId, since]
      )

      const notes = rows.map(row => {
        // Separate the JOIN column so it doesn't pollute non-E2E rows
        const { encrypted_content_key, ...noteRow } = row
        const decrypted = dataKey ? decryptNoteRow(noteRow, dataKey) : noteRow
        if (Number(noteRow.encryption_tier) !== 2) return decrypted
        return { ...decrypted, encrypted_content_key: encrypted_content_key ?? null }
      })

      res.json({ collections: collectionRows, notes, serverTime })
    } catch (e) {
      logServerError('[jot.it] Sync pull error:', e)
      sendJsonError(res, 500, 'Sync failed')
    }
  })

  // Grant another user access to a Tier 2 (E2E) note by adding their encrypted content key.
  app.post('/api/notes/:id/grant', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Sync not configured')

    const { userId: recipientUserId, encryptedContentKey } = req.body ?? {}
    if (!recipientUserId || !encryptedContentKey) {
      return sendJsonError(res, 400, 'userId and encryptedContentKey are required')
    }

    try {
      const { rows } = await pgPool.query(
        'SELECT user_id FROM notes WHERE id = $1 AND user_id = $2 AND encryption_tier = 2',
        [req.params.id, req.user.userId]
      )
      if (!rows.length) return sendJsonError(res, 403, 'Note not found or not owned by you')

      await pgPool.query(
        `INSERT INTO note_keys (note_id, user_id, encrypted_content_key, added_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (note_id, user_id) DO UPDATE SET encrypted_content_key = EXCLUDED.encrypted_content_key`,
        [req.params.id, recipientUserId, encryptedContentKey, Date.now()]
      )
      res.json({ ok: true })
    } catch (e) {
      logServerError('[jot.it] Grant access error:', e)
      sendJsonError(res, 500, 'Grant failed')
    }
  })
}
