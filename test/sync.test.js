import assert from 'node:assert/strict'
import { registerSyncRoutes } from '../server/sync.js'
import { createMockApp, createMockResponse, runHandlers } from './helpers.js'

function allowAuth(req, _res, next) {
  req.user = { userId: 42, email: 'tester@example.com' }
  return next()
}

function aiDisabled() {
  return {
    isConfigured() {
      return false
    },
  }
}

async function testSyncPushRejectsWhenNotConfigured() {
  const app = createMockApp()
  registerSyncRoutes(app, { aiService: aiDisabled(), pgPool: null, requireAuth: allowAuth })

  const handlers = app.routes.post.get('/api/sync/push')
  const res = createMockResponse()
  await runHandlers(handlers, { body: { notes: [] } }, res)

  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.jsonBody, { error: 'Sync not configured' })
}

async function testSyncPushPersistsNonDeletedNotes() {
  const queries = []
  const pgPool = {
    async query(sql, params) {
      queries.push({ sql, params })
      return { rows: [] }
    },
  }
  const app = createMockApp()
  registerSyncRoutes(app, { aiService: aiDisabled(), pgPool, requireAuth: allowAuth })

  const handlers = app.routes.post.get('/api/sync/push')
  const req = {
    body: {
      notes: [
        {
          id: 'note-1',
          content: 'hello',
          categories: '[]',
          embedding: null,
          created_at: 1,
          updated_at: 2,
          is_public: false,
        },
      ],
    },
  }
  const res = createMockResponse()
  await runHandlers(handlers, req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { ok: true, pushed: 1 })
  assert.ok(queries.some(entry => /INSERT INTO notes/.test(entry.sql)))
  assert.ok(queries.some(entry => /INSERT INTO note_chunks/.test(entry.sql)))
  assert.ok(queries.some(entry => /INSERT INTO search_metadata/.test(entry.sql)))
  assert.ok(queries.some(entry => /UPDATE notes SET embedding = \$1/.test(entry.sql)))
}

async function testSyncPullReturnsRowsAndServerTime() {
  const pgPool = {
    async query() {
      return { rows: [{ id: 'note-1' }] }
    },
  }
  const app = createMockApp()
  registerSyncRoutes(app, { aiService: aiDisabled(), pgPool, requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/sync/pull')
  const req = { query: { since: '5' } }
  const res = createMockResponse()
  await runHandlers(handlers, req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody.notes, [{ id: 'note-1' }])
  assert.equal(typeof res.jsonBody.serverTime, 'number')
}

async function testSyncPushDeletedNoteClearsArtifacts() {
  const queries = []
  const pgPool = {
    async query(sql, params) {
      queries.push({ sql: sql.trim(), params })
      return { rows: [] }
    },
  }
  const app = createMockApp()
  registerSyncRoutes(app, { aiService: aiDisabled(), pgPool, requireAuth: allowAuth })

  const handlers = app.routes.post.get('/api/sync/push')
  const req = { body: { notes: [{ id: 'note-1', deleted: true }] } }
  const res = createMockResponse()
  await runHandlers(handlers, req, res)

  assert.equal(res.statusCode, 200)
  const sqls = queries.map(q => q.sql)
  assert.ok(sqls.some(s => s.startsWith('INSERT INTO notes')), 'should mark note deleted')
  assert.ok(sqls.some(s => s.startsWith('DELETE FROM note_chunks')), 'should delete chunks')
  assert.ok(sqls.some(s => s.startsWith('DELETE FROM note_chunk_embeddings')), 'should delete chunk embeddings')
  assert.ok(sqls.some(s => s.startsWith('DELETE FROM note_entities')), 'should delete entities')
  assert.ok(sqls.some(s => s.startsWith('DELETE FROM search_metadata')), 'should delete metadata')
}

export default [
  ['sync push rejects when sync is not configured', testSyncPushRejectsWhenNotConfigured],
  ['sync push persists non-deleted notes', testSyncPushPersistsNonDeletedNotes],
  ['sync push deleted note clears artifacts', testSyncPushDeletedNoteClearsArtifacts],
  ['sync pull returns rows and server time', testSyncPullReturnsRowsAndServerTime],
]
