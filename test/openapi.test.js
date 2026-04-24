import assert from 'node:assert/strict'
import { importFiles } from '../src/utils/importNotes.js'
import { parseOpenApiJson } from '../src/utils/openapi/parse.js'
import { formatRequestAsHttpBlock, generateRequestFromOperation } from '../src/utils/openapi/examples.js'
import { validateResponseAgainstOperation } from '../src/utils/openapi/validate.js'
import { buildNoteSearchArtifacts } from '../src/utils/searchIndex.js'
import { NOTE_TYPE_OPENAPI } from '../src/utils/noteTypes.js'

const SAMPLE_SPEC = JSON.stringify({
  openapi: '3.0.3',
  info: {
    title: 'Users API',
    version: '1.0.0',
    description: 'Simple user service',
  },
  servers: [{ url: 'https://localhost:7026' }],
  paths: {
    '/users': {
      get: {
        operationId: 'getUsers',
        summary: 'List users',
        tags: ['Users'],
        responses: {
          200: {
            description: 'User list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'name'],
                    properties: {
                      id: { type: 'integer' },
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUserById',
        summary: 'Get user by id',
        tags: ['Users'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer', example: 123 },
          },
        ],
        responses: {
          200: {
            description: 'Single user',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}, null, 2)

async function testParseOpenApiJsonNormalizesOperations() {
  const parsed = parseOpenApiJson(SAMPLE_SPEC)

  assert.equal(parsed.normalized.title, 'Users API')
  assert.equal(parsed.normalized.operations.length, 2)
  assert.equal(parsed.normalized.operations[0].method, 'GET')
}

async function testImportFilesCreatesOpenApiNote() {
  const file = {
    name: 'swagger.json',
    size: SAMPLE_SPEC.length,
    async text() { return SAMPLE_SPEC },
  }

  const upserted = []
  const notes = await importFiles([file], 1024 * 1024, {
    upsertNote(note) { upserted.push(note) },
  })

  assert.equal(notes.length, 1)
  assert.equal(notes[0].noteType, NOTE_TYPE_OPENAPI)
  assert.equal(notes[0].noteData.document.title, 'Users API')
  assert.equal(upserted.length, 1)
}

async function testGenerateRequestFromOperationBuildsRunnableRequest() {
  const parsed = parseOpenApiJson(SAMPLE_SPEC)
  const operation = parsed.normalized.operations.find(entry => entry.id === 'getUserById')
  const request = generateRequestFromOperation(operation, { serverUrl: parsed.normalized.servers[0] })

  assert.equal(request.method, 'GET')
  assert.equal(request.url, 'https://localhost:7026/users/123')
  assert.equal(formatRequestAsHttpBlock(request), 'GET https://localhost:7026/users/123')
}

async function testGenerateRequestFromOperationTrimsServerTrailingSlash() {
  const parsed = parseOpenApiJson(SAMPLE_SPEC)
  const operation = parsed.normalized.operations.find(entry => entry.id === 'getUsers')
  const request = generateRequestFromOperation(operation, { serverUrl: 'https://localhost:7026/' })

  assert.equal(request.url, 'https://localhost:7026/users')
}

async function testValidateResponseAgainstOperationDetectsSchemaMismatch() {
  const parsed = parseOpenApiJson(SAMPLE_SPEC)
  const operation = parsed.normalized.operations.find(entry => entry.id === 'getUserById')
  const validation = validateResponseAgainstOperation(operation, {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 'oops' }),
  })

  assert.equal(validation.ok, false)
  assert.ok(validation.issues.some(issue => issue.includes('Missing required field $.name')))
  assert.ok(validation.issues.some(issue => issue.includes('Expected $.id to be integer')))
}

async function testBuildNoteSearchArtifactsIndexesOpenApiOperations() {
  const parsed = parseOpenApiJson(SAMPLE_SPEC)
  const note = {
    id: 'openapi-1',
    content: 'Users API\nOpenAPI 1.0.0',
    categories: ['openapi', 'api-spec'],
    noteType: NOTE_TYPE_OPENAPI,
    noteData: {
      rawText: SAMPLE_SPEC,
      document: parsed.normalized,
    },
    createdAt: 1,
    updatedAt: 2,
  }

  const artifacts = buildNoteSearchArtifacts(note)

  assert.ok(artifacts.metadata.facets.includes('openapi'))
  assert.ok(artifacts.metadata.keywords.includes('getusers') || artifacts.metadata.keywords.includes('users'))
  assert.ok(artifacts.chunks.some(chunk => chunk.content.toLowerCase().includes('/users/{id}')))
}

export default [
  ['parseOpenApiJson normalizes operations', testParseOpenApiJsonNormalizesOperations],
  ['importFiles creates OpenAPI note', testImportFilesCreatesOpenApiNote],
  ['generateRequestFromOperation builds runnable request', testGenerateRequestFromOperationBuildsRunnableRequest],
  ['generateRequestFromOperation trims server trailing slash', testGenerateRequestFromOperationTrimsServerTrailingSlash],
  ['validateResponseAgainstOperation detects schema mismatch', testValidateResponseAgainstOperationDetectsSchemaMismatch],
  ['buildNoteSearchArtifacts indexes OpenAPI operations', testBuildNoteSearchArtifactsIndexesOpenApiOperations],
]
