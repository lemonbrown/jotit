import assert from 'node:assert/strict'
import { createRequireAuth } from '../server/auth.js'
import { createAiService, registerAiRoutes } from '../server/ai.js'
import { registerSearchRoutes } from '../server/search.js'
import { createMockApp, createMockResponse, runHandlers } from './helpers.js'

function allowAuth(req, _res, next) {
  req.user = { userId: 42, email: 'tester@example.com' }
  return next()
}

function makePgPool(overrides = {}) {
  return {
    async query(sql) {
      if (overrides[sql.trim().split('\n')[0].trim()]) {
        return overrides[sql.trim().split('\n')[0].trim()]()
      }
      if (sql.includes('DISTINCT n.id')) return { rows: [{ id: 'note-1' }] }
      if (sql.includes('FROM notes') && sql.includes('embedding IS NOT NULL')) return { rows: [{ id: 'note-1' }] }
      if (sql.includes('FROM notes ')) {
        return {
          rows: [{
            id: 'note-1',
            content: 'Azure staging API auth\nAZURE_TENANT_ID=abc bearer token Key Vault',
            categories: '["azure","credentials","token"]',
            embedding: '[0.9,0.1]',
            created_at: 1,
            updated_at: 2,
            is_public: 0,
            deleted_at: null,
          }],
        }
      }
      if (sql.includes('FROM note_chunks')) {
        return {
          rows: [{
            id: 'note-1:chunk:0',
            note_id: 'note-1',
            content: 'AZURE_TENANT_ID=abc bearer token',
            kind: 'config',
            section_title: 'Azure auth',
            start_offset: 0,
            end_offset: 32,
            created_at: 1,
            updated_at: 2,
          }],
        }
      }
      if (sql.includes('FROM note_chunk_embeddings')) {
        return {
          rows: [{
            chunk_id: 'note-1:chunk:0',
            note_id: 'note-1',
            embedding: '[0.9,0.1]',
            model: 'text-embedding-3-small',
            updated_at: 2,
          }],
        }
      }
      if (sql.includes('FROM note_entities')) {
        return {
          rows: [{
            id: 'ent-1',
            note_id: 'note-1',
            chunk_id: 'note-1:chunk:0',
            entity_type: 'cloud_provider',
            entity_value: 'azure',
            normalized_value: 'azure',
          }],
        }
      }
      if (sql.includes('FROM search_metadata')) {
        return {
          rows: [{
            note_id: 'note-1',
            keywords: '["azure","token","bearer"]',
            facets: '["cloud","credentials"]',
            last_indexed_at: 2,
          }],
        }
      }
      return { rows: [] }
    },
  }
}

async function testServerSearchRejectsWhenNotConfigured() {
  const app = createMockApp()
  registerSearchRoutes(app, { aiService: createAiService(''), pgPool: null, requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { query: { q: 'azure token' } }, res)

  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.jsonBody, { error: 'Search not configured' })
}

async function testServerSearchReturnsEmptyForBlankQuery() {
  const app = createMockApp()
  registerSearchRoutes(app, { aiService: createAiService(''), pgPool: makePgPool(), requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { query: { q: '  ' } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { results: [] })
}

async function testServerSearchReturnsRankedResults() {
  const app = createMockApp()
  registerSearchRoutes(app, { aiService: createAiService(''), pgPool: makePgPool(), requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { query: { q: 'api token for azure' } }, res)

  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.jsonBody.results))
  assert.equal(res.jsonBody.results.length, 1)

  const top = res.jsonBody.results[0]
  assert.equal(top.noteId, 'note-1')
  assert.ok(top.score > 0)
  assert.equal(top.note.id, 'note-1')
  assert.ok(Array.isArray(top.note.categories))
  assert.ok(top.note.categories.includes('azure'))
  assert.equal(res.jsonBody.query, 'api token for azure')
}

async function testServerSearchCanReturnSemanticResultsWithoutLexicalCandidates() {
  const app = createMockApp()
  const aiService = {
    isConfigured() {
      return true
    },
    async getEmbedding() {
      return [1, 0]
    },
    cosineSimilarity(a, b) {
      return a[0] * b[0] + a[1] * b[1]
    },
  }

  const pgPool = makePgPool({
    'SELECT DISTINCT n.id': async () => ({ rows: [] }),
  })

  registerSearchRoutes(app, { aiService, pgPool, requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { query: { q: 'meaning only query' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.jsonBody.results.length, 1)
  assert.equal(res.jsonBody.results[0].noteId, 'note-1')
}

async function testServerSearchDoesNotBlockOnSlowSemanticEmbedding() {
  const app = createMockApp()
  const aiService = {
    isConfigured() {
      return true
    },
    async getEmbedding() {
      return new Promise(() => {})
    },
    cosineSimilarity() {
      return 0
    },
  }

  registerSearchRoutes(app, { aiService, pgPool: makePgPool(), requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  const started = Date.now()
  await runHandlers(handlers, { query: { q: 'api token for azure', semanticTimeoutMs: '1' } }, res)
  const elapsed = Date.now() - started

  assert.equal(res.statusCode, 200)
  assert.ok(elapsed < 250)
  assert.equal(res.jsonBody.results.length, 1)
  assert.equal(res.jsonBody.results[0].noteId, 'note-1')
}

async function testServerSearchReturnsEmptyWhenNoCandidates() {
  const pgPool = {
    async query() { return { rows: [] } },
  }
  const app = createMockApp()
  registerSearchRoutes(app, { aiService: createAiService(''), pgPool, requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { query: { q: 'something obscure' } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody.results, [])
}

async function testServerSearchRespectsLimitParam() {
  const pgPool = {
    async query(sql) {
      if (sql.includes('DISTINCT')) return { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
      if (sql.includes('FROM notes ')) {
        return {
          rows: ['a', 'b', 'c'].map(id => ({
            id,
            content: `Azure token note ${id}\nbearer token azure staging`,
            categories: '["azure","credentials"]',
            embedding: null,
            created_at: 1,
            updated_at: 2,
            is_public: 0,
          })),
        }
      }
      return { rows: [] }
    },
  }
  const app = createMockApp()
  registerSearchRoutes(app, { aiService: createAiService(''), pgPool, requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { query: { q: 'azure token', limit: '2' } }, res)

  assert.equal(res.statusCode, 200)
  assert.ok(res.jsonBody.results.length <= 2)
}

async function testAiStatusRequiresConfiguredServerKey() {
  const app = createMockApp()
  registerAiRoutes(app, { aiService: createAiService(''), pgPool: null, requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/ai/status')
  const res = createMockResponse()
  await runHandlers(handlers, {}, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { available: false })
}

async function testSearchRequiresAuth() {
  const app = createMockApp()
  const requireAuth = createRequireAuth('test-secret')
  registerSearchRoutes(app, { aiService: createAiService(''), pgPool: makePgPool(), requireAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { headers: {}, query: { q: 'azure token' } }, res)

  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.jsonBody, { error: 'Unauthorized' })
}

async function testServerSearchQueriesStayUserScoped() {
  const seenUserIds = []
  const pgPool = {
    async query(sql, params) {
      if (params?.[0] !== undefined) seenUserIds.push(params[0])
      if (sql.includes('DISTINCT n.id')) return { rows: [{ id: 'note-1' }] }
      if (sql.includes('embedding IS NOT NULL')) return { rows: [] }
      if (sql.includes('FROM notes ')) {
        return {
          rows: [{
            id: 'note-1',
            content: 'Azure token',
            categories: '["azure"]',
            embedding: null,
            created_at: 1,
            updated_at: 2,
            is_public: 0,
            deleted_at: null,
          }],
        }
      }
      return { rows: [] }
    },
  }

  const app = createMockApp()
  registerSearchRoutes(app, { aiService: createAiService(''), pgPool, requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { query: { q: 'azure token' } }, res)

  assert.equal(res.statusCode, 200)
  assert.ok(seenUserIds.length > 0)
  assert.ok(seenUserIds.every(id => id === 42))
}

async function testServerSearchFiltersByCollectionId() {
  const seen = []
  const pgPool = {
    async query(sql, params) {
      seen.push({ sql, params })
      if (sql.includes('DISTINCT n.id')) return { rows: [] }
      return { rows: [] }
    },
  }

  const app = createMockApp()
  registerSearchRoutes(app, { aiService: createAiService(''), pgPool, requireAuth: allowAuth })

  const handlers = app.routes.get.get('/api/search')
  const res = createMockResponse()
  await runHandlers(handlers, { query: { q: 'azure token', collectionId: 'collection-1' } }, res)

  assert.equal(res.statusCode, 200)
  const candidateQuery = seen.find(entry => entry.sql.includes('DISTINCT n.id'))
  assert.ok(candidateQuery)
  assert.equal(candidateQuery.params[2], 'collection-1')
  assert.ok(candidateQuery.sql.includes('n.collection_id = $3'))
}

async function testAiReindexRebuildsOnlyCurrentUserNotes() {
  const app = createMockApp()
  const queries = []
  const pgPool = {
    async query(sql, params) {
      queries.push({ sql: sql.trim(), params })
      if (sql.includes('FROM notes') && sql.includes('deleted_at IS NULL')) {
        return {
          rows: [{
            id: 'note-1',
            content: 'Azure staging API auth\nAZURE_TENANT_ID=abc bearer token Key Vault',
            categories: '["azure","credentials"]',
            created_at: 1,
            updated_at: 2,
          }],
        }
      }
      return { rows: [] }
    },
  }
  registerAiRoutes(app, { aiService: createAiService(''), pgPool, requireAuth: allowAuth })

  const handlers = app.routes.post.get('/api/ai/reindex')
  const res = createMockResponse()
  await runHandlers(handlers, {}, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { ok: true, reindexed: 1 })
  assert.ok(queries.some(entry => entry.sql.includes('WHERE user_id = $1') && entry.params?.[0] === 42))
  assert.ok(queries.some(entry => entry.sql.startsWith('INSERT INTO note_chunks')))
}

export default [
  ['server search rejects when not configured', testServerSearchRejectsWhenNotConfigured],
  ['server search returns empty for blank query', testServerSearchReturnsEmptyForBlankQuery],
  ['server search returns ranked results', testServerSearchReturnsRankedResults],
  ['server search can return semantic results without lexical candidates', testServerSearchCanReturnSemanticResultsWithoutLexicalCandidates],
  ['server search does not block on slow semantic embedding', testServerSearchDoesNotBlockOnSlowSemanticEmbedding],
  ['server search returns empty when no candidates', testServerSearchReturnsEmptyWhenNoCandidates],
  ['server search respects limit param', testServerSearchRespectsLimitParam],
  ['ai status reports configured availability', testAiStatusRequiresConfiguredServerKey],
  ['search requires auth', testSearchRequiresAuth],
  ['server search queries stay user scoped', testServerSearchQueriesStayUserScoped],
  ['server search filters by collection id', testServerSearchFiltersByCollectionId],
  ['ai reindex rebuilds only current user notes', testAiReindexRebuildsOnlyCurrentUserNotes],
]
