import assert from 'node:assert/strict'
import { createCollectionDraft, createDefaultCollectionDraft, DEFAULT_COLLECTION_NAME, normalizeCollectionSlug } from '../src/utils/collectionFactories.js'
import { importFiles } from '../src/utils/importNotes.js'
import { createPublicCloneNote } from '../src/utils/noteFactories.js'
import { getPublicCloneInfo, isPublicClone } from '../src/utils/noteTypes.js'

async function testCollectionFactoryCreatesCollectionShape() {
  const collection = createCollectionDraft({ name: ' Projects ', description: ' Client work ' })

  assert.ok(collection.id)
  assert.equal(collection.name, 'Projects')
  assert.equal(collection.description, 'Client work')
  assert.equal(collection.isDefault, false)
  assert.equal(typeof collection.createdAt, 'number')
  assert.equal(collection.createdAt, collection.updatedAt)
}

async function testCollectionFactoryRejectsBlankName() {
  assert.equal(createCollectionDraft({ name: '   ' }), null)
}

async function testDefaultCollectionFactoryUsesStableId() {
  const collection = createDefaultCollectionDraft()

  assert.equal(collection.id, 'default')
  assert.equal(collection.name, DEFAULT_COLLECTION_NAME)
  assert.equal(collection.isDefault, true)
}

async function testNormalizeCollectionSlug() {
  assert.equal(normalizeCollectionSlug(' Client Notes 2026! '), 'client-notes-2026')
  assert.equal(normalizeCollectionSlug('---Ops___Runbook---'), 'opsrunbook')
  assert.equal(normalizeCollectionSlug(null), '')
}

async function testImportFilesAssignsCollectionId() {
  const file = {
    name: 'notes.txt',
    size: 12,
    async text() {
      return 'hello world'
    },
  }
  const upserted = []

  const notes = await importFiles([file], 1024 * 1024, {
    collectionId: 'collection-1',
    upsertNote: note => upserted.push(note),
    createTextNote: (fileName, text) => ({
      id: 'note-1',
      content: `${fileName}\n${text}`,
      categories: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  })

  assert.equal(notes.length, 1)
  assert.equal(notes[0].collectionId, 'collection-1')
  assert.deepEqual(upserted, notes)
}

async function testPublicCloneNoteStoresCloneMetadata() {
  const note = createPublicCloneNote({
    slug: 'shared-1',
    collectionId: 'collection-1',
    shared: {
      publishedAt: 123,
      note: {
        id: 'source-note',
        content: '# Shared\nBody',
        categories: ['docs'],
        updatedAt: 456,
        viewMode: 'markdown',
      },
    },
  })

  assert.ok(note.id)
  assert.equal(note.collectionId, 'collection-1')
  assert.equal(note.content, '# Shared\nBody')
  assert.deepEqual(note.categories, ['docs'])
  assert.equal(note.isPublic, false)
  assert.equal(isPublicClone(note), true)
  assert.deepEqual(getPublicCloneInfo(note), {
    slug: 'shared-1',
    url: '/n/shared-1',
    sourceNoteId: 'source-note',
    publishedAt: 123,
    sourceUpdatedAt: 456,
    clonedAt: note.createdAt,
  })
}

export default [
  ['collection factory creates collection shape', testCollectionFactoryCreatesCollectionShape],
  ['collection factory rejects blank name', testCollectionFactoryRejectsBlankName],
  ['default collection factory uses stable id', testDefaultCollectionFactoryUsesStableId],
  ['normalize collection slug', testNormalizeCollectionSlug],
  ['import files assigns collection id', testImportFilesAssignsCollectionId],
  ['public clone note stores clone metadata', testPublicCloneNoteStoresCloneMetadata],
]
