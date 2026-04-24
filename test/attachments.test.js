import assert from 'node:assert/strict'
import {
  buildMarker,
  parseMarker,
  extractMarkerIds,
  isImgMarker,
  validateImageFile,
  ATTACHMENT_MAX_BYTES,
  SUPPORTED_MIME_TYPES,
} from '../src/utils/attachments.js'
import { extractEntities } from '../src/utils/entities.js'

// ── Marker helpers ─────────────────────────────────────────────────────────────

async function testBuildMarkerProducesExpectedFormat() {
  const marker = buildMarker('abc123')
  assert.equal(marker, '[img://abc123]')
}

async function testParseMarkerExtractsId() {
  assert.equal(parseMarker('[img://abc123]'), 'abc123')
  assert.equal(parseMarker('[img://z9k8k7a1b]'), 'z9k8k7a1b')
}

async function testParseMarkerRejectsNonMarkers() {
  assert.equal(parseMarker('hello'), null)
  assert.equal(parseMarker('[img://]'), null)   // empty id
  assert.equal(parseMarker('img://abc123'), null) // missing brackets
  assert.equal(parseMarker('[img://abc]extra'), null) // trailing content
}

async function testExtractMarkerIdsFindsAllIds() {
  const content = 'Some text\n[img://id1]\nMore text\n[img://id2]\ndone'
  const ids = extractMarkerIds(content)
  assert.deepEqual(ids, ['id1', 'id2'])
}

async function testExtractMarkerIdsReturnsEmptyForNoMarkers() {
  assert.deepEqual(extractMarkerIds('hello world'), [])
  assert.deepEqual(extractMarkerIds(''), [])
  assert.deepEqual(extractMarkerIds(null), [])
}

async function testIsImgMarkerReturnsTrueForMarkers() {
  assert.ok(isImgMarker('[img://abc123]'))
}

async function testIsImgMarkerReturnsFalseForOtherStrings() {
  assert.ok(!isImgMarker('hello'))
  assert.ok(!isImgMarker(''))
  assert.ok(!isImgMarker(null))
  assert.ok(!isImgMarker(42))
}

// ── Validation ─────────────────────────────────────────────────────────────────

async function testValidateImageFileAcceptsSupportedTypes() {
  for (const mime of SUPPORTED_MIME_TYPES) {
    const file = { type: mime, size: 1024 }
    assert.equal(validateImageFile(file), null, `Expected ${mime} to pass validation`)
  }
}

async function testValidateImageFileRejectsUnsupportedType() {
  const file = { type: 'image/tiff', size: 1024 }
  const err = validateImageFile(file)
  assert.ok(err, 'Expected an error for unsupported type')
  assert.ok(err.includes('Unsupported'), `Error should mention "Unsupported", got: ${err}`)
}

async function testValidateImageFileRejectsOversizedFile() {
  const file = { type: 'image/png', size: ATTACHMENT_MAX_BYTES + 1 }
  const err = validateImageFile(file)
  assert.ok(err, 'Expected an error for oversized file')
  assert.ok(err.includes('too large'), `Error should mention "too large", got: ${err}`)
}

async function testValidateImageFileRejectsNullInput() {
  const err = validateImageFile(null)
  assert.ok(err)
}

async function testValidateImageFileAcceptsFileSizeAtLimit() {
  const file = { type: 'image/png', size: ATTACHMENT_MAX_BYTES }
  assert.equal(validateImageFile(file), null)
}

// ── Entity extraction guard ────────────────────────────────────────────────────

async function testExtractEntitiesSkipsImgMarkers() {
  // The marker ID could match env_var or other patterns — it must be stripped
  const marker = buildMarker('AZURE_TOKEN_ABC123')
  const content = `DATABASE_URL=postgres://db:5432/app\n${marker}\nghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabc123`
  const entities = extractEntities(content, { noteId: 'n1' })

  const values = entities.map(e => e.entityValue)
  // The marker ID must not appear as any entity
  assert.ok(!values.some(v => v.includes('AZURE_TOKEN_ABC123')), 'Marker ID leaked into entities')
  assert.ok(!values.some(v => v.includes('img://')), 'img:// prefix leaked into entities')
  // Real entities outside the marker must still be found
  assert.ok(entities.some(e => e.entityType === 'env_var'), 'DATABASE_URL env_var entity should still be found')
  assert.ok(entities.some(e => e.entityType === 'api_key_like'), 'Real API key should still be found')
}

async function testExtractEntitiesHandlesMultipleMarkersInContent() {
  const content = buildMarker('id1') + '\n' + buildMarker('id2') + '\nsome text'
  const entities = extractEntities(content, { noteId: 'n1' })
  const values = entities.map(e => e.entityValue)
  assert.ok(!values.some(v => v.includes('id1') || v.includes('id2')))
}

// ── Test registry ──────────────────────────────────────────────────────────────

export default [
  ['attachments: buildMarker produces expected format',          testBuildMarkerProducesExpectedFormat],
  ['attachments: parseMarker extracts id',                       testParseMarkerExtractsId],
  ['attachments: parseMarker rejects non-markers',               testParseMarkerRejectsNonMarkers],
  ['attachments: extractMarkerIds finds all ids',                testExtractMarkerIdsFindsAllIds],
  ['attachments: extractMarkerIds returns empty for no markers', testExtractMarkerIdsReturnsEmptyForNoMarkers],
  ['attachments: isImgMarker returns true for markers',          testIsImgMarkerReturnsTrueForMarkers],
  ['attachments: isImgMarker returns false for other strings',   testIsImgMarkerReturnsFalseForOtherStrings],
  ['attachments: validate accepts supported types',              testValidateImageFileAcceptsSupportedTypes],
  ['attachments: validate rejects unsupported type',             testValidateImageFileRejectsUnsupportedType],
  ['attachments: validate rejects oversized file',               testValidateImageFileRejectsOversizedFile],
  ['attachments: validate rejects null input',                   testValidateImageFileRejectsNullInput],
  ['attachments: validate accepts file at size limit',           testValidateImageFileAcceptsFileSizeAtLimit],
  ['attachments: extractEntities skips img markers',             testExtractEntitiesSkipsImgMarkers],
  ['attachments: extractEntities handles multiple markers',      testExtractEntitiesHandlesMultipleMarkersInContent],
]
