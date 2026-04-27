import { existsSync, readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import { ensureUserBucketName, sanitizeBucketName } from './auth.js'
import { sendJsonError } from './http.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{2,40}$/

function loadJson(filePath) {
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function saveJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function generatePublicSlug(existing) {
  for (let i = 0; i < 10; i += 1) {
    const slug = crypto.randomBytes(9).toString('base64url')
    if (!existing[slug]) return slug
  }
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

async function pgGenerateSlug(pgPool) {
  for (let i = 0; i < 10; i += 1) {
    const slug = crypto.randomBytes(9).toString('base64url')
    const { rows } = await pgPool.query('SELECT 1 FROM public_notes WHERE slug = $1', [slug])
    if (!rows.length) return slug
  }
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

function normalizeCollectionSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stripMarkdownPreview(content) {
  return String(content ?? '')
    .replace(/\[img:\/\/[^\]]+\]/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_~[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getNoteCardMeta(note) {
  const raw = String(note?.content ?? '')
  const title = raw.split('\n').find(line => line.trim())?.trim() ?? 'Untitled note'
  const preview = stripMarkdownPreview(raw).slice(0, 220)
  return { title, preview }
}

function normalizePublicNote(slug, shared) {
  if (!shared) return null
  return {
    slug,
    publishedAt: Number(shared.publishedAt ?? 0),
    note: {
      id: shared.note?.id ?? null,
      content: String(shared.note?.content ?? ''),
      categories: Array.isArray(shared.note?.categories) ? shared.note.categories : [],
      updatedAt: Number(shared.note?.updatedAt ?? 0),
      viewMode: shared.note?.viewMode ?? null,
    },
  }
}

function summarizeSharedNote(slug, shared) {
  const normalized = normalizePublicNote(slug, shared)
  const { title, preview } = getNoteCardMeta(normalized?.note)

  return {
    slug,
    url: `/n/${slug}`,
    noteId: normalized?.note.id ?? null,
    title,
    preview,
    viewMode: normalized?.note.viewMode ?? null,
    publishedAt: Number(normalized?.publishedAt ?? 0),
    updatedAt: Number(normalized?.note.updatedAt ?? 0),
  }
}

function serializeNoteForPublicPage(note) {
  const normalized = {
    id: note?.id ?? null,
    content: String(note?.content ?? ''),
    categories: Array.isArray(note?.categories) ? note.categories : [],
    createdAt: Number(note?.createdAt ?? 0),
    updatedAt: Number(note?.updatedAt ?? 0),
    noteType: note?.noteType ?? 'text',
    noteData: note?.noteData ?? null,
    viewMode: note?.viewMode ?? null,
    collectionId: note?.collectionId ?? null,
    collectionName: note?.collectionName ?? '',
    collectionIsPublic: Boolean(note?.collectionIsPublic),
    collectionSlug: note?.collectionSlug ?? '',
    slug: note?.slug ?? null,
  }

  return {
    ...getNoteCardMeta(normalized),
    ...normalized,
  }
}

async function pgGetPublicNote(pgPool, slug) {
  const { rows } = await pgPool.query('SELECT * FROM public_notes WHERE slug = $1', [slug])
  if (!rows.length) return null

  const row = rows[0]
  return normalizePublicNote(slug, {
    publishedAt: row.published_at,
    note: {
      id: row.note_id,
      content: row.content,
      categories: parseJson(row.categories, []),
      updatedAt: row.updated_at,
      viewMode: row.view_mode ?? null,
    },
  })
}

async function pgFindPublicNoteByNoteId(pgPool, noteId) {
  const { rows } = await pgPool.query(
    'SELECT * FROM public_notes WHERE note_id = $1 ORDER BY published_at DESC LIMIT 1',
    [noteId]
  )
  if (!rows.length) return null

  const row = rows[0]
  return normalizePublicNote(row.slug, {
    publishedAt: row.published_at,
    note: {
      id: row.note_id,
      content: row.content,
      categories: parseJson(row.categories, []),
      updatedAt: row.updated_at,
      viewMode: row.view_mode ?? null,
    },
  })
}

async function pgSavePublicNote(pgPool, slug, note) {
  await pgPool.query(
    `INSERT INTO public_notes (slug, note_id, content, categories, view_mode, published_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      slug,
      note.id,
      note.content,
      JSON.stringify(note.categories ?? []),
      note.viewMode ?? null,
      Date.now(),
      note.updatedAt ?? Date.now(),
    ],
  )
}

async function pgUpdatePublicNote(pgPool, slug, note, publishedAt) {
  await pgPool.query(
    `UPDATE public_notes
        SET content = $2,
            categories = $3,
            view_mode = $4,
            published_at = $5,
            updated_at = $6
      WHERE slug = $1`,
    [
      slug,
      note.content,
      JSON.stringify(note.categories ?? []),
      note.viewMode ?? null,
      publishedAt ?? Date.now(),
      note.updatedAt ?? Date.now(),
    ],
  )
}

async function pgListPublicNotes(pgPool) {
  const { rows } = await pgPool.query(
    'SELECT slug, note_id, content, view_mode, published_at, updated_at FROM public_notes ORDER BY published_at DESC'
  )

  return rows.map(row => summarizeSharedNote(row.slug, {
    publishedAt: row.published_at,
    note: {
      id: row.note_id,
      content: row.content,
      updatedAt: row.updated_at,
      viewMode: row.view_mode ?? null,
    },
  }))
}

async function pgDeletePublicNote(pgPool, slug) {
  const result = await pgPool.query('DELETE FROM public_notes WHERE slug = $1 RETURNING slug', [slug])
  return Boolean(result.rows?.length)
}

function findExistingSharedSlug(publicNotes, noteId) {
  return Object.entries(publicNotes)
    .filter(([, shared]) => shared?.note?.id === noteId)
    .sort((a, b) => Number(b[1]?.publishedAt ?? 0) - Number(a[1]?.publishedAt ?? 0))[0]?.[0] ?? null
}

async function pgGetBucketOwner(userDb, bucketName) {
  const normalized = sanitizeBucketName(bucketName)
  if (!normalized) return null

  const owner = userDb.prepare('SELECT id, email, bucket_name FROM users WHERE bucket_name = ?').get(normalized)
  if (!owner) return null

  return {
    userId: owner.id,
    email: owner.email,
    bucketName: owner.bucket_name,
    ownerLabel: owner.email,
  }
}

async function pgListPublicCollectionsForBucket(pgPool, owner) {
  const { rows } = await pgPool.query(
    `SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
            COUNT(n.id) FILTER (
              WHERE n.deleted_at IS NULL
                AND n.collection_excluded != 1
                AND n.encryption_tier = 0
            ) AS note_count,
            MAX(n.updated_at) FILTER (
              WHERE n.deleted_at IS NULL
                AND n.collection_excluded != 1
                AND n.encryption_tier = 0
            ) AS last_note_updated
       FROM collections c
       LEFT JOIN notes n
         ON n.user_id = c.user_id
        AND n.collection_id = c.id
      WHERE c.user_id = $1
        AND c.deleted_at IS NULL
        AND c.is_public = 1
      GROUP BY c.id, c.name, c.description, c.created_at, c.updated_at
      ORDER BY COALESCE(MAX(n.updated_at) FILTER (
        WHERE n.deleted_at IS NULL
          AND n.collection_excluded != 1
          AND n.encryption_tier = 0
      ), c.updated_at) DESC`,
    [owner.userId]
  )

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastUpdatedAt: Number(row.last_note_updated ?? row.updated_at ?? 0),
    noteCount: Number(row.note_count ?? 0),
    slug: normalizeCollectionSlug(row.name),
  }))
}

async function pgGetPublicCollectionNotes(pgPool, ownerUserId, collectionId) {
  const { rows } = await pgPool.query(
    `SELECT id, content, categories, created_at, updated_at, note_type, note_data
       FROM notes
      WHERE user_id = $1
        AND collection_id = $2
        AND deleted_at IS NULL
        AND collection_excluded != 1
        AND encryption_tier = 0
      ORDER BY updated_at DESC`,
    [ownerUserId, collectionId]
  )

  return rows.map(row => serializeNoteForPublicPage({
    id: row.id,
    content: row.content,
    categories: parseJson(row.categories, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    noteType: row.note_type ?? 'text',
    noteData: parseJson(row.note_data, null),
  }))
}

async function pgListDirectPublicNotesForBucket(pgPool, ownerUserId) {
  const { rows } = await pgPool.query(
    `SELECT n.id, n.content, n.categories, n.created_at, n.updated_at, n.collection_id,
            c.name AS collection_name,
            c.is_public AS collection_is_public,
            (
              SELECT pn.slug
                FROM public_notes pn
               WHERE pn.note_id = n.id
               ORDER BY pn.published_at DESC
               LIMIT 1
            ) AS shared_slug
       FROM notes n
       LEFT JOIN collections c
         ON c.user_id = n.user_id
        AND c.id = n.collection_id
        AND c.deleted_at IS NULL
      WHERE n.user_id = $1
        AND n.deleted_at IS NULL
        AND n.is_public = 1
        AND n.encryption_tier = 0
      ORDER BY n.updated_at DESC`,
    [ownerUserId]
  )

  return rows.map(row => serializeNoteForPublicPage({
    id: row.id,
    content: row.content,
    categories: parseJson(row.categories, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    collectionId: row.collection_id ?? null,
    collectionName: row.collection_name ?? '',
    collectionIsPublic: row.collection_is_public === 1,
    collectionSlug: row.collection_name ? normalizeCollectionSlug(row.collection_name) : '',
    slug: row.shared_slug ?? null,
  }))
}

function getFileBucketPage(bucketName, bucket) {
  if (!bucket) return null
  const notes = Array.isArray(bucket.notes) ? bucket.notes : []
  return {
    kind: 'bucket',
    bucket: {
      bucketName,
      ownerLabel: bucketName,
      publishedAt: Number(bucket.publishedAt ?? 0),
    },
    collections: [],
    directNotes: notes.map(note => serializeNoteForPublicPage(note)),
  }
}

async function getPublicBucketPage({ bucketName, loadBuckets, pgPool, userDb }) {
  if (pgPool && userDb) {
    const owner = await pgGetBucketOwner(userDb, bucketName)
    if (!owner) return null
    return {
      kind: 'bucket',
      bucket: {
        bucketName: owner.bucketName,
        ownerLabel: owner.ownerLabel,
      },
      collections: await pgListPublicCollectionsForBucket(pgPool, owner),
      directNotes: await pgListDirectPublicNotesForBucket(pgPool, owner.userId),
    }
  }

  return getFileBucketPage(bucketName, loadBuckets()[bucketName])
}

async function getPublicCollectionPage({ bucketName, collectionSlug, pgPool, userDb }) {
  if (!pgPool || !userDb) return null

  const owner = await pgGetBucketOwner(userDb, bucketName)
  if (!owner) return null

  const collections = await pgListPublicCollectionsForBucket(pgPool, owner)
  const collection = collections.find(item => item.slug === collectionSlug)
  if (!collection) return null

  return {
    kind: 'collection',
    bucket: {
      bucketName: owner.bucketName,
      ownerLabel: owner.ownerLabel,
    },
    collection,
    notes: await pgGetPublicCollectionNotes(pgPool, owner.userId, collection.id),
  }
}

export function registerPublicSharing(app, { bucketsFile, publicNotesFile, pgPool, requireAuth, userDb }) {
  const loadBuckets = () => loadJson(bucketsFile)
  const loadPublicNotes = () => loadJson(publicNotesFile)
  const savePublicNotes = (data) => saveJson(publicNotesFile, data)

  app.get('/api/bucket/me', requireAuth, async (req, res) => {
    if (!pgPool || !userDb) return sendJsonError(res, 503, 'Public buckets not configured')

    try {
      const bucketName = ensureUserBucketName(userDb, req.user.userId)
      if (!bucketName) return sendJsonError(res, 500, 'Failed to initialize bucket name')

      const owner = await pgGetBucketOwner(userDb, bucketName)
      const collections = owner ? await pgListPublicCollectionsForBucket(pgPool, owner) : []
      const publicNotes = owner ? await pgListDirectPublicNotesForBucket(pgPool, owner.userId) : []
      res.json({ bucketName, publicCollections: collections, publicNotes })
    } catch (e) {
      sendJsonError(res, 500, `Bucket lookup failed: ${e.message}`)
    }
  })

  app.put('/api/bucket/name', requireAuth, (req, res) => {
    if (!userDb) return sendJsonError(res, 503, 'Public buckets not configured')

    const nextBucketName = sanitizeBucketName(req.body?.bucketName)
    if (!nextBucketName || !SLUG_RE.test(nextBucketName)) {
      return sendJsonError(res, 400, 'Invalid bucket name - use 2-40 lowercase letters, numbers, hyphens')
    }

    try {
      const existing = userDb.prepare('SELECT id FROM users WHERE bucket_name = ?').get(nextBucketName)
      if (existing && existing.id !== req.user.userId) {
        return sendJsonError(res, 409, 'Bucket name is already taken')
      }

      userDb.prepare('UPDATE users SET bucket_name = ? WHERE id = ?').run(nextBucketName, req.user.userId)
      const user = userDb.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId)
      res.json({ ok: true, bucketName: user?.bucket_name ?? nextBucketName })
    } catch (e) {
      sendJsonError(res, 500, `Bucket update failed: ${e.message}`)
    }
  })

  app.put('/api/collections/:id/visibility', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Public buckets not configured')

    const id = String(req.params.id ?? '').trim()
    const isPublic = req.body?.isPublic ? 1 : 0
    if (!id) return sendJsonError(res, 400, 'Collection id is required')

    try {
      const result = await pgPool.query(
        `UPDATE collections
            SET is_public = $3,
                updated_at = $4
          WHERE id = $1 AND user_id = $2
          RETURNING id, name, is_public, updated_at`,
        [id, req.user.userId, isPublic, Date.now()]
      )
      if (!result.rows.length) return sendJsonError(res, 404, 'Collection not found')

      const bucketName = userDb ? ensureUserBucketName(userDb, req.user.userId) : null
      const row = result.rows[0]
      res.json({
        ok: true,
        collection: {
          id: row.id,
          name: row.name,
          isPublic: row.is_public === 1,
          updatedAt: Number(row.updated_at),
          slug: normalizeCollectionSlug(row.name),
          url: bucketName ? `/b/${bucketName}/${normalizeCollectionSlug(row.name)}` : null,
        },
      })
    } catch (e) {
      sendJsonError(res, 500, `Collection visibility update failed: ${e.message}`)
    }
  })

  app.put('/api/notes/:id/collection-visibility', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Public buckets not configured')

    const id = String(req.params.id ?? '').trim()
    const collectionExcluded = req.body?.collectionExcluded ? 1 : 0
    if (!id) return sendJsonError(res, 400, 'Note id is required')

    try {
      const result = await pgPool.query(
        `UPDATE notes
            SET collection_excluded = $3,
                updated_at = $4
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
          RETURNING id, collection_id, collection_excluded, updated_at`,
        [id, req.user.userId, collectionExcluded, Date.now()]
      )
      if (!result.rows.length) return sendJsonError(res, 404, 'Note not found')

      const row = result.rows[0]
      res.json({
        ok: true,
        note: {
          id: row.id,
          collectionId: row.collection_id,
          collectionExcluded: row.collection_excluded === 1,
          updatedAt: Number(row.updated_at),
        },
      })
    } catch (e) {
      sendJsonError(res, 500, `Note visibility update failed: ${e.message}`)
    }
  })

  app.post('/api/public-note/publish', async (req, res) => {
    const { note } = req.body ?? {}
    if (!note || typeof note !== 'object') return sendJsonError(res, 400, 'note is required')
    if (typeof note.content !== 'string' || !note.content.trim()) {
      return sendJsonError(res, 400, 'Cannot publish an empty note')
    }

    if (pgPool) {
      try {
        const existing = note.id ? await pgFindPublicNoteByNoteId(pgPool, note.id) : null
        if (existing?.slug) {
          await pgUpdatePublicNote(pgPool, existing.slug, note, existing.publishedAt)
          return res.json({ ok: true, url: `/n/${existing.slug}`, slug: existing.slug, reused: true })
        }

        const slug = await pgGenerateSlug(pgPool)
        await pgSavePublicNote(pgPool, slug, note)
        return res.json({ ok: true, url: `/n/${slug}`, slug, reused: false })
      } catch (e) {
        return sendJsonError(res, 500, `Database error: ${e.message}`)
      }
    }

    const publicNotes = loadPublicNotes()
    const existingSlug = note.id ? findExistingSharedSlug(publicNotes, note.id) : null
    const slug = existingSlug ?? generatePublicSlug(publicNotes)
    const existingPublishedAt = existingSlug ? Number(publicNotes[existingSlug]?.publishedAt ?? Date.now()) : Date.now()
    publicNotes[slug] = {
      publishedAt: existingPublishedAt,
      note: {
        id: note.id,
        content: note.content,
        categories: note.categories ?? [],
        updatedAt: note.updatedAt ?? Date.now(),
        viewMode: note.viewMode ?? null,
      },
    }
    savePublicNotes(publicNotes)
    res.json({ ok: true, url: `/n/${slug}`, slug, reused: Boolean(existingSlug) })
  })

  app.get('/api/public-note/:slug', async (req, res) => {
    if (pgPool) {
      try {
        const shared = await pgGetPublicNote(pgPool, req.params.slug)
        if (!shared) return sendJsonError(res, 404, 'Not found')
        return res.json(shared)
      } catch (e) {
        return sendJsonError(res, 500, `Database error: ${e.message}`)
      }
    }

    const shared = normalizePublicNote(req.params.slug, loadPublicNotes()[req.params.slug])
    if (!shared) return sendJsonError(res, 404, 'Not found')
    res.json(shared)
  })

  app.get('/api/public-pages/n/:slug', async (req, res) => {
    try {
      const shared = pgPool
        ? await pgGetPublicNote(pgPool, req.params.slug)
        : normalizePublicNote(req.params.slug, loadPublicNotes()[req.params.slug])
      if (!shared) return sendJsonError(res, 404, 'Public note not found')
      return res.json({ kind: 'note', ...shared })
    } catch (e) {
      return sendJsonError(res, 500, `Public note lookup failed: ${e.message}`)
    }
  })

  app.get('/api/public-pages/b/:bucket/:collectionSlug', async (req, res) => {
    try {
      const page = await getPublicCollectionPage({
        bucketName: req.params.bucket,
        collectionSlug: req.params.collectionSlug,
        pgPool,
        userDb,
      })
      if (!page) return sendJsonError(res, 404, 'Public collection not found')
      return res.json(page)
    } catch (e) {
      return sendJsonError(res, 500, `Public collection lookup failed: ${e.message}`)
    }
  })

  app.get('/api/public-pages/b/:bucket', async (req, res) => {
    try {
      const page = await getPublicBucketPage({
        bucketName: req.params.bucket,
        loadBuckets,
        pgPool,
        userDb,
      })
      if (!page) return sendJsonError(res, 404, 'Public bucket not found')
      return res.json(page)
    } catch (e) {
      return sendJsonError(res, 500, `Public bucket lookup failed: ${e.message}`)
    }
  })

  app.get('/api/public-notes', async (_req, res) => {
    if (pgPool) {
      try {
        const links = await pgListPublicNotes(pgPool)
        return res.json({ links })
      } catch (e) {
        return sendJsonError(res, 500, `Database error: ${e.message}`)
      }
    }

    const links = Object.entries(loadPublicNotes())
      .map(([slug, shared]) => summarizeSharedNote(slug, shared))
      .sort((a, b) => b.publishedAt - a.publishedAt)

    return res.json({ links })
  })

  app.delete('/api/public-note/:slug', async (req, res) => {
    if (pgPool) {
      try {
        const deleted = await pgDeletePublicNote(pgPool, req.params.slug)
        if (!deleted) return sendJsonError(res, 404, 'Not found')
        return res.json({ ok: true, slug: req.params.slug })
      } catch (e) {
        return sendJsonError(res, 500, `Database error: ${e.message}`)
      }
    }

    const publicNotes = loadPublicNotes()
    if (!publicNotes[req.params.slug]) return sendJsonError(res, 404, 'Not found')
    delete publicNotes[req.params.slug]
    savePublicNotes(publicNotes)
    return res.json({ ok: true, slug: req.params.slug })
  })
}
