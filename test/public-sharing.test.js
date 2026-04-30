import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerPublicSharing } from '../server/publicSharing.js'
import { createMockApp, createMockResponse, runHandlers } from './helpers.js'

function makeTempFiles() {
  const dir = mkdtempSync(path.join(tmpdir(), 'jotit-public-sharing-'))
  return {
    dir,
    bucketsFile: path.join(dir, 'buckets.json'),
    publicNotesFile: path.join(dir, 'public-notes.json'),
  }
}

async function testPublicNoteListIncludesPublishedLinks() {
  const files = makeTempFiles()
  try {
    const app = createMockApp()
    registerPublicSharing(app, { ...files, pgPool: null })

    const publishHandlers = app.routes.post.get('/api/public-note/publish')
    const publishRes = createMockResponse()
    await runHandlers(publishHandlers, {
      body: {
        note: {
          id: 'note-1',
          content: '# Shared title\nBody copy',
          categories: [],
          updatedAt: 123,
          viewMode: 'markdown',
        },
      },
    }, publishRes)

    assert.equal(publishRes.statusCode, 200)

    const listHandlers = app.routes.get.get('/api/public-notes')
    const listRes = createMockResponse()
    await runHandlers(listHandlers, {}, listRes)

    assert.equal(listRes.statusCode, 200)
    assert.equal(listRes.jsonBody.links.length, 1)
    assert.equal(listRes.jsonBody.links[0].noteId, 'note-1')
    assert.equal(listRes.jsonBody.links[0].title, '# Shared title')
    assert.match(listRes.jsonBody.links[0].url, /^\/n\//)
  } finally {
    rmSync(files.dir, { recursive: true, force: true })
  }
}

async function testDeletePublicNoteRemovesPublishedLink() {
  const files = makeTempFiles()
  try {
    const app = createMockApp()
    registerPublicSharing(app, { ...files, pgPool: null })

    const publishHandlers = app.routes.post.get('/api/public-note/publish')
    const publishRes = createMockResponse()
    await runHandlers(publishHandlers, {
      body: {
        note: {
          id: 'note-2',
          content: 'Standalone shared note',
          categories: [],
          updatedAt: 456,
          viewMode: null,
        },
      },
    }, publishRes)

    const slug = publishRes.jsonBody.slug
    const deleteHandlers = app.routes.delete.get('/api/public-note/:slug')
    const deleteRes = createMockResponse()
    await runHandlers(deleteHandlers, { params: { slug } }, deleteRes)

    assert.equal(deleteRes.statusCode, 200)
    assert.deepEqual(deleteRes.jsonBody, { ok: true, slug })

    const listHandlers = app.routes.get.get('/api/public-notes')
    const listRes = createMockResponse()
    await runHandlers(listHandlers, {}, listRes)

    assert.equal(listRes.statusCode, 200)
    assert.deepEqual(listRes.jsonBody.links, [])
  } finally {
    rmSync(files.dir, { recursive: true, force: true })
  }
}

async function testRepublishReusesExistingPublicLink() {
  const files = makeTempFiles()
  try {
    const app = createMockApp()
    registerPublicSharing(app, { ...files, pgPool: null })

    const publishHandlers = app.routes.post.get('/api/public-note/publish')

    const firstRes = createMockResponse()
    await runHandlers(publishHandlers, {
      body: {
        note: {
          id: 'note-3',
          content: 'Original body',
          categories: [],
          updatedAt: 100,
          viewMode: null,
        },
      },
    }, firstRes)

    const secondRes = createMockResponse()
    await runHandlers(publishHandlers, {
      body: {
        note: {
          id: 'note-3',
          content: 'Updated body',
          categories: ['updated'],
          updatedAt: 200,
          viewMode: 'code',
        },
      },
    }, secondRes)

    assert.equal(firstRes.statusCode, 200)
    assert.equal(secondRes.statusCode, 200)
    assert.equal(secondRes.jsonBody.slug, firstRes.jsonBody.slug)
    assert.equal(secondRes.jsonBody.reused, true)

    const listHandlers = app.routes.get.get('/api/public-notes')
    const listRes = createMockResponse()
    await runHandlers(listHandlers, {}, listRes)

    assert.equal(listRes.statusCode, 200)
    assert.equal(listRes.jsonBody.links.length, 1)
    assert.equal(listRes.jsonBody.links[0].slug, firstRes.jsonBody.slug)
    assert.equal(listRes.jsonBody.links[0].viewMode, 'code')
    assert.match(listRes.jsonBody.links[0].preview, /Updated body/)
  } finally {
    rmSync(files.dir, { recursive: true, force: true })
  }
}

async function testPublicNotePageApiReturnsSharedNoteData() {
  const files = makeTempFiles()
  try {
    const app = createMockApp()
    registerPublicSharing(app, { ...files, pgPool: null })

    const publishHandlers = app.routes.post.get('/api/public-note/publish')
    const publishRes = createMockResponse()
    await runHandlers(publishHandlers, {
      body: {
        note: {
          id: 'note-page-1',
          content: '# Public page\nBody copy',
          categories: ['docs'],
          updatedAt: 789,
          viewMode: 'markdown',
        },
      },
    }, publishRes)

    const pageHandlers = app.routes.get.get('/api/public-pages/n/:slug')
    const pageRes = createMockResponse()
    await runHandlers(pageHandlers, { params: { slug: publishRes.jsonBody.slug } }, pageRes)

    assert.equal(pageRes.statusCode, 200)
    assert.equal(pageRes.jsonBody.kind, 'note')
    assert.equal(pageRes.jsonBody.slug, publishRes.jsonBody.slug)
    assert.equal(pageRes.jsonBody.note.id, 'note-page-1')
    assert.equal(pageRes.jsonBody.note.content, '# Public page\nBody copy')
    assert.deepEqual(pageRes.jsonBody.note.categories, ['docs'])
  } finally {
    rmSync(files.dir, { recursive: true, force: true })
  }
}

async function testPublishBundleCreatesSinglePublicLinkForMultipleNotes() {
  const files = makeTempFiles()
  try {
    const app = createMockApp()
    registerPublicSharing(app, { ...files, pgPool: null })

    const publishHandlers = app.routes.post.get('/api/public-note/publish-bundle')
    const publishRes = createMockResponse()
    await runHandlers(publishHandlers, {
      body: {
        title: 'Release notes',
        notes: [
          { id: 'bundle-note-1', content: '# First\nBody one', categories: ['a'], updatedAt: 111, viewMode: 'markdown' },
          { id: 'bundle-note-2', content: '# Second\nBody two', categories: ['b'], updatedAt: 222, viewMode: null },
        ],
      },
    }, publishRes)

    assert.equal(publishRes.statusCode, 200)
    assert.equal(publishRes.jsonBody.noteCount, 2)
    assert.match(publishRes.jsonBody.url, /^\/n\//)

    const listHandlers = app.routes.get.get('/api/public-notes')
    const listRes = createMockResponse()
    await runHandlers(listHandlers, {}, listRes)

    assert.equal(listRes.statusCode, 200)
    assert.equal(listRes.jsonBody.links.length, 1)
    assert.equal(listRes.jsonBody.links[0].title, 'Release notes')
    assert.equal(listRes.jsonBody.links[0].viewMode, 'bundle')
    assert.equal(listRes.jsonBody.links[0].noteCount, 2)

    const pageHandlers = app.routes.get.get('/api/public-pages/n/:slug')
    const pageRes = createMockResponse()
    await runHandlers(pageHandlers, { params: { slug: publishRes.jsonBody.slug } }, pageRes)

    assert.equal(pageRes.statusCode, 200)
    assert.equal(pageRes.jsonBody.kind, 'note')
    assert.equal(pageRes.jsonBody.title, 'Release notes')
    assert.equal(pageRes.jsonBody.notes.length, 2)
    assert.equal(pageRes.jsonBody.notes[0].id, 'bundle-note-1')
    assert.equal(pageRes.jsonBody.notes[1].content, '# Second\nBody two')
  } finally {
    rmSync(files.dir, { recursive: true, force: true })
  }
}

async function testMissingPublicNotePageApiReturnsJson404() {
  const files = makeTempFiles()
  try {
    const app = createMockApp()
    registerPublicSharing(app, { ...files, pgPool: null })

    const pageHandlers = app.routes.get.get('/api/public-pages/n/:slug')
    const pageRes = createMockResponse()
    await runHandlers(pageHandlers, { params: { slug: 'missing-note' } }, pageRes)

    assert.equal(pageRes.statusCode, 404)
    assert.deepEqual(pageRes.jsonBody, { error: 'Public note not found' })
  } finally {
    rmSync(files.dir, { recursive: true, force: true })
  }
}

async function testFileBucketPageApiReturnsDirectNotes() {
  const files = makeTempFiles()
  try {
    const app = createMockApp()
    registerPublicSharing(app, { ...files, pgPool: null })

    const buckets = {
      docs: {
        publishedAt: 1000,
        notes: [
          {
            id: 'bucket-note-1',
            content: '# Bucket note\nBody',
            categories: ['bucket'],
            updatedAt: 999,
          },
        ],
      },
    }
    writeFileSync(files.bucketsFile, JSON.stringify(buckets))

    const pageHandlers = app.routes.get.get('/api/public-pages/b/:bucket')
    const pageRes = createMockResponse()
    await runHandlers(pageHandlers, { params: { bucket: 'docs' } }, pageRes)

    assert.equal(pageRes.statusCode, 200)
    assert.equal(pageRes.jsonBody.kind, 'bucket')
    assert.equal(pageRes.jsonBody.bucket.bucketName, 'docs')
    assert.equal(pageRes.jsonBody.collections.length, 0)
    assert.equal(pageRes.jsonBody.directNotes.length, 1)
    assert.equal(pageRes.jsonBody.directNotes[0].id, 'bucket-note-1')
  } finally {
    rmSync(files.dir, { recursive: true, force: true })
  }
}

async function testServerDoesNotRegisterPublicHtmlRoutes() {
  const files = makeTempFiles()
  try {
    const app = createMockApp()
    registerPublicSharing(app, { ...files, pgPool: null })

    assert.equal(app.routes.get.has('/n/:slug'), false)
    assert.equal(app.routes.get.has('/b/:bucket'), false)
    assert.equal(app.routes.get.has('/b/:bucket/:collectionSlug'), false)
  } finally {
    rmSync(files.dir, { recursive: true, force: true })
  }
}

export default [
  ['public sharing lists published note links', testPublicNoteListIncludesPublishedLinks],
  ['public sharing deletes published note links', testDeletePublicNoteRemovesPublishedLink],
  ['public sharing reuses an existing note link on republish', testRepublishReusesExistingPublicLink],
  ['public note page api returns shared note data', testPublicNotePageApiReturnsSharedNoteData],
  ['public bundle creates one link for multiple notes', testPublishBundleCreatesSinglePublicLinkForMultipleNotes],
  ['missing public note page api returns json 404', testMissingPublicNotePageApiReturnsJson404],
  ['file bucket page api returns direct notes', testFileBucketPageApiReturnsDirectNotes],
  ['public sharing does not register html page routes', testServerDoesNotRegisterPublicHtmlRoutes],
]
