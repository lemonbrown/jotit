import { generateId } from './helpers.js'
import { NOTE_TYPE_OPENAPI, NOTE_TYPE_TEXT } from './noteTypes.js'

export function createEmptyNote({ collectionId = null } = {}) {
  const now = Date.now()

  return {
    id: generateId(),
    content: '',
    categories: [],
    embedding: null,
    isPublic: false,
    collectionId,
    noteType: NOTE_TYPE_TEXT,
    noteData: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function createSnippetDraft({ content, name = '', sourceNoteId = null }) {
  const text = content?.trim()
  if (!text) return null

  const now = Date.now()

  return {
    id: generateId(),
    name: name.trim(),
    content: text,
    embedding: null,
    sourceNoteId,
    createdAt: now,
    updatedAt: now,
  }
}

export function createImportedDocxNote(fileName, text) {
  const now = Date.now()
  return {
    id: generateId(),
    content: `${fileName}\n${text}`,
    categories: [],
    embedding: null,
    isPublic: false,
    collectionId: null,
    noteType: NOTE_TYPE_TEXT,
    noteData: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function createImportedTextNote(fileName, text) {
  const now = Date.now()

  return {
    id: generateId(),
    content: `${fileName}\n${text}`,
    categories: [],
    embedding: null,
    isPublic: false,
    collectionId: null,
    noteType: NOTE_TYPE_TEXT,
    noteData: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function createImportedOpenApiNote(fileName, document) {
  const now = Date.now()
  const title = document.normalized?.title?.trim() || fileName
  const operationCount = document.normalized?.operations?.length ?? 0
  const tagText = document.normalized?.tags?.length ? `Tags: ${document.normalized.tags.join(', ')}` : ''
  const summaryLines = [
    title,
    document.normalized?.version ? `OpenAPI ${document.normalized.version}` : 'OpenAPI document',
    `${operationCount} operation${operationCount === 1 ? '' : 's'}`,
    tagText,
  ].filter(Boolean)

  return {
    id: generateId(),
    content: summaryLines.join('\n'),
    categories: ['openapi', 'api-spec'],
    embedding: null,
    isPublic: false,
    collectionId: null,
    noteType: NOTE_TYPE_OPENAPI,
    noteData: {
      fileName,
      rawText: document.rawText,
      document: document.normalized,
    },
    createdAt: now,
    updatedAt: now,
  }
}
