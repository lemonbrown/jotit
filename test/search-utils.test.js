import assert from 'node:assert/strict'
import { chunkNoteContent } from '../src/utils/chunking.js'
import { extractEntities } from '../src/utils/entities.js'
import { createDeveloperSeedNotes } from '../src/utils/helpers.js'
import { understandQuery } from '../src/utils/queryUnderstanding.js'
import { buildNoteSearchArtifacts } from '../src/utils/searchIndex.js'
import {
  mergeChunkSemanticResults,
  mergeSemanticSearchResults,
  redactCredentialPreview,
  searchNotesWithArtifacts,
} from '../src/utils/searchCore.js'

async function testChunkNoteContentPreservesDeveloperSections() {
  const note = {
    id: 'note-1',
    content: `# Azure auth
AZURE_TENANT_ID=tenant-123

\`\`\`bash
az login --tenant tenant-123
\`\`\`

## Debug
401 unauthorized calling https://example.com/api/token`,
  }

  const chunks = chunkNoteContent(note)

  assert.equal(chunks.length, 3)
  assert.equal(chunks[0].sectionTitle, 'Azure auth')
  assert.equal(chunks[1].kind, 'code')
  assert.equal(chunks[2].sectionTitle, 'Debug')
}

async function testExtractEntitiesFindsDeveloperSignals() {
  const entities = extractEntities(
    'AZURE_TENANT_ID=tenant-123 https://example.com ghp_1234567890123456789012345 docker compose up',
    { noteId: 'note-1', chunkId: 'note-1:chunk:0' }
  )

  assert.ok(entities.some(entity => entity.entityType === 'env_var' && entity.normalizedValue === 'azure_tenant_id'))
  assert.ok(entities.some(entity => entity.entityType === 'url' && entity.normalizedValue === 'https://example.com'))
  assert.ok(entities.some(entity => entity.entityType === 'api_key_like'))
  assert.ok(entities.some(entity => entity.entityType === 'command' && entity.normalizedValue.includes('docker compose up')))
}

async function testBuildNoteSearchArtifactsAddsFacetsAndChunkEntities() {
  const note = {
    id: 'note-1',
    content: `# Staging postgres
DATABASE_URL=postgres://user:pass@db.internal:5432/app

Token for Azure API is in Key Vault`,
    categories: ['credentials', 'postgres'],
    createdAt: 10,
    updatedAt: 20,
  }

  const artifacts = buildNoteSearchArtifacts(note)

  assert.ok(artifacts.chunks.length >= 2)
  assert.ok(artifacts.entities.some(entity => entity.entityType === 'env_var'))
  assert.ok(artifacts.entities.some(entity => entity.entityType === 'cloud_provider'))
  assert.ok(artifacts.metadata.facets.includes('credentials'))
  assert.ok(artifacts.metadata.facets.includes('cloud'))
  assert.ok(artifacts.metadata.facets.includes('database'))
  assert.ok(artifacts.metadata.keywords.includes('postgres'))
}

async function testUnderstandQueryExpandsDeveloperAliasesAndFacets() {
  const understood = understandQuery('api token for azure')

  assert.equal(understood.intent, 'find-credentials')
  assert.ok(understood.expandedTerms.includes('entra'))
  assert.ok(understood.expandedTerms.includes('bearer'))
  assert.ok(understood.facets.includes('credentials'))
  assert.ok(understood.facets.includes('cloud'))
  assert.ok(understood.providerHints.includes('azure'))
  assert.ok(understood.entityTypesToBoost.includes('cloud_provider'))
}

async function testUnderstandQueryCoversDbAndInfraLanguage() {
  const dbQuery = understandQuery('mysql rds connection string staging')
  const infraQuery = understandQuery('terraform apply staging state')

  assert.equal(dbQuery.intent, 'find-config')
  assert.ok(dbQuery.facets.includes('database'))
  assert.ok(dbQuery.providerHints.includes('mysql'))
  assert.ok(dbQuery.expandedTerms.some(term => term.includes('connection')))

  assert.equal(infraQuery.intent, 'find-command')
  assert.ok(infraQuery.facets.includes('infra'))
  assert.ok(infraQuery.providerHints.includes('terraform'))
  assert.ok(infraQuery.expandedTerms.some(term => term === 'plan' || term === 'workspace'))
}

async function testUnderstandQueryCoversCiAndDebugLanguage() {
  const ciQuery = understandQuery('github actions npm publish token')
  const debugQuery = understandQuery('jwt middleware unauthorized bug')

  assert.equal(ciQuery.intent, 'find-credentials')
  assert.ok(ciQuery.expandedTerms.includes('workflow'))
  assert.ok(ciQuery.expandedTerms.includes('registry'))
  assert.ok(ciQuery.providerHints.includes('github'))

  assert.equal(debugQuery.intent, 'debug-issue')
  assert.ok(debugQuery.expandedTerms.includes('authorization'))
  assert.ok(debugQuery.expandedTerms.includes('401'))
  assert.ok(debugQuery.facets.includes('debugging'))
}

async function testSearchNotesWithArtifactsReturnsStructuredChunkAwareMatches() {
  const note = {
    id: 'note-1',
    content: `# Azure auth\nAZURE_TENANT_ID=tenant-123\n\nUse bearer token from Key Vault`,
    categories: ['credentials'],
    createdAt: 10,
    updatedAt: 20,
  }

  const artifacts = buildNoteSearchArtifacts(note)
  const results = searchNotesWithArtifacts([note], 'api token for azure', {
    chunks: artifacts.chunks,
    entities: artifacts.entities,
    metadataByNote: new Map([[note.id, artifacts.metadata]]),
  })

  assert.equal(results.length, 1)
  assert.equal(results[0].noteId, note.id)
  assert.equal(results[0].note, note)
  assert.ok(results[0].preview.toLowerCase().includes('token'))
  assert.ok(results[0].reasons.length > 0)
}

async function testSearchNotesWithArtifactsUsesQueryUnderstandingBoosts() {
  const note = {
    id: 'note-1',
    content: `Azure staging API auth\nAZURE_CLIENT_SECRET=super-secret\nUse bearer token from Key Vault`,
    categories: ['config'],
    createdAt: 10,
    updatedAt: 20,
  }

  const artifacts = buildNoteSearchArtifacts(note)
  const results = searchNotesWithArtifacts([note], 'api token for azure', {
    chunks: artifacts.chunks,
    entities: artifacts.entities,
    metadataByNote: new Map([[note.id, artifacts.metadata]]),
  })

  assert.equal(results.length, 1)
  assert.ok(results[0].score > 100)
  assert.ok(results[0].entityHits.length > 0)
}

async function testMergeSemanticSearchResultsPreservesLocalMatchesAndAppendsFallbacks() {
  const local = [{
    noteId: 'note-1',
    note: { id: 'note-1', content: 'azure token', categories: [], updatedAt: 1 },
    score: 10,
    reasons: ['entity hit'],
  }]
  const semantic = [
    { id: 'note-1', content: 'azure token', categories: [], updatedAt: 1 },
    { id: 'note-2', content: 'entra service principal', categories: [], updatedAt: 2 },
  ]

  const merged = mergeSemanticSearchResults(local, semantic)

  assert.equal(merged.length, 2)
  assert.equal(merged[0].noteId, 'note-1')
  assert.equal(merged[1].noteId, 'note-2')
  assert.equal(merged[1].matchType, 'semantic')
  assert.ok(merged[1].reasons.includes('semantic note similarity'))
}

async function testMergeChunkSemanticResultsAddsSemanticChunkReasonAndPreview() {
  const note = {
    id: 'note-1',
    content: 'fallback note body',
    categories: [],
    updatedAt: 1,
  }

  const merged = mergeChunkSemanticResults(
    [{
      noteId: 'note-1',
      note,
      index: 0,
      score: 40,
      matchType: 'hybrid',
      matchedChunkId: null,
      matchedSectionTitle: null,
      matchedChunkKind: null,
      preview: 'fallback note body',
      reasons: ['entity hit'],
      entityHits: [],
    }],
    [{
      noteId: 'note-1',
      chunkId: 'note-1:chunk:0',
      sectionTitle: 'Azure auth',
      kind: 'config',
      content: 'AZURE_TENANT_ID=tenant-123 bearer token',
      similarity: 0.72,
    }],
    new Map([[note.id, note]])
  )

  assert.equal(merged.length, 1)
  assert.equal(merged[0].matchType, 'hybrid-semantic')
  assert.equal(merged[0].matchedSectionTitle, 'Azure auth')
  assert.ok(merged[0].preview.includes('AZURE_TENANT_ID'))
  assert.ok(merged[0].reasons.includes('semantic chunk similarity'))
}

function buildCorpusArtifacts(notes) {
  const chunks = []
  const entities = []
  const metadataByNote = new Map()

  for (const note of notes) {
    const artifacts = buildNoteSearchArtifacts(note)
    chunks.push(...artifacts.chunks)
    entities.push(...artifacts.entities)
    metadataByNote.set(note.id, artifacts.metadata)
  }

  return { chunks, entities, metadataByNote }
}

async function testDeveloperCorpusBenchmarksRankExpectedTopNotes() {
  const notes = createDeveloperSeedNotes()
  const artifacts = buildCorpusArtifacts(notes)

  const expectations = [
    ['api token for azure', 'Azure staging API auth'],
    ['postgres password staging', 'Postgres staging connection'],
    ['docker env local api', 'Docker local API env'],
    ['aws s3 write role', 'AWS S3 write role'],
    ['redis host for prod', 'Redis prod host'],
    ['github actions npm publish token', 'GitHub Actions npm publish token'],
    ['jwt middleware unauthorized bug', 'JWT middleware debugging'],
    ['kubernetes restart staging api', 'Kubernetes restart commands'],
    ['gcp service account json', 'GCP service account key'],
    ['mysql rds connection string', 'MySQL RDS connection'],
    ['terraform apply staging state', 'Terraform staging state'],
  ]

  for (const [query, expectedTitle] of expectations) {
    const results = searchNotesWithArtifacts(notes, query, artifacts)
    assert.ok(results.length > 0, `expected results for query "${query}"`)
    const topTitle = results[0].note.content.split('\n')[0]
    assert.equal(topTitle, expectedTitle, `unexpected top match for query "${query}"`)
  }
}

async function testRedactCredentialPreviewMasksTokens() {
  const preview = 'Use token ghp_abcdefghij1234567890abcde to publish. npm_secret1234567890abcdefghijk for registry.'
  const redacted = redactCredentialPreview(preview)

  assert.ok(!redacted.includes('ghp_abcdefghij'), 'should redact github token body')
  assert.ok(!redacted.includes('npm_secret'), 'should redact npm token body')
  assert.ok(redacted.includes('ghp_'), 'should preserve github prefix')
  assert.ok(redacted.includes('npm_'), 'should preserve npm prefix')
  assert.ok(redacted.includes('[REDACTED]'), 'should include redaction marker')
  assert.ok(redacted.includes('Use token'), 'should preserve surrounding text')
}

export default [
  ['chunkNoteContent preserves developer sections', testChunkNoteContentPreservesDeveloperSections],
  ['extractEntities finds developer signals', testExtractEntitiesFindsDeveloperSignals],
  ['buildNoteSearchArtifacts adds facets and chunk entities', testBuildNoteSearchArtifactsAddsFacetsAndChunkEntities],
  ['understandQuery expands developer aliases and facets', testUnderstandQueryExpandsDeveloperAliasesAndFacets],
  ['understandQuery covers CI and debug language', testUnderstandQueryCoversCiAndDebugLanguage],
  ['understandQuery covers DB and infra language', testUnderstandQueryCoversDbAndInfraLanguage],
  ['searchNotesWithArtifacts returns structured chunk-aware matches', testSearchNotesWithArtifactsReturnsStructuredChunkAwareMatches],
  ['searchNotesWithArtifacts uses query understanding boosts', testSearchNotesWithArtifactsUsesQueryUnderstandingBoosts],
  ['developer corpus benchmarks rank expected top notes', testDeveloperCorpusBenchmarksRankExpectedTopNotes],
  ['mergeChunkSemanticResults adds semantic chunk reason and preview', testMergeChunkSemanticResultsAddsSemanticChunkReasonAndPreview],
  ['mergeSemanticSearchResults preserves local matches and appends fallbacks', testMergeSemanticSearchResultsPreservesLocalMatchesAndAppendsFallbacks],
  ['redactCredentialPreview masks token patterns', testRedactCredentialPreviewMasksTokens],
]
