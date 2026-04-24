import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
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

export default [
  ['public sharing lists published note links', testPublicNoteListIncludesPublishedLinks],
  ['public sharing deletes published note links', testDeletePublicNoteRemovesPublishedLink],
  ['public sharing reuses an existing note link on republish', testRepublishReusesExistingPublicLink],
]
