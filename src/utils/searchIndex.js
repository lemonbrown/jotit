import { chunkNoteContent } from './chunking.js'
import { extractEntities } from './entities.js'
import { getOpenApiDocument, getOpenApiSearchText, isOpenApiNote } from './noteTypes.js'

const FACET_RULES = [
  ['credentials', /\b(api key|token|secret|password|credential|client secret|bearer|jwt|ssh key)\b/i],
  ['cloud', /\b(azure|entra|aad|aws|iam|sts|gcp|google cloud|service account|key vault)\b/i],
  ['database', /\b(postgres|postgresql|mysql|mssql|sql server|redis|mongodb|database url|connection string)\b/i],
  ['infra', /\b(docker|docker compose|kubernetes|k8s|kubectl|helm|terraform|ansible)\b/i],
  ['api', /\b(api|endpoint|rest|graphql|webhook|oauth|oidc|authorization|bearer)\b/i],
  ['debugging', /\b(error|exception|stacktrace|traceback|timeout|debug|incident|repro)\b/i],
]

function collectKeywords(note, chunks, entities) {
  const openApiText = isOpenApiNote(note) ? getOpenApiSearchText(getOpenApiDocument(note)?.document) : ''
  const baseText = [note.content, openApiText, ...(note.categories ?? [])].join('\n').toLowerCase()
  const tokens = new Set()
  for (const match of baseText.matchAll(/\b[a-z][a-z0-9_-]{2,}\b/g)) {
    tokens.add(match[0])
    if (tokens.size >= 40) break
  }

  for (const entity of entities) {
    tokens.add(entity.normalizedValue)
    if (tokens.size >= 60) break
  }

  for (const chunk of chunks) {
    if (chunk.sectionTitle) tokens.add(chunk.sectionTitle.toLowerCase())
    if (tokens.size >= 70) break
  }

  return Array.from(tokens)
}

function collectFacets(note) {
  const content = `${note.content}\n${(note.categories ?? []).join(' ')}`
  const facets = FACET_RULES
    .filter(([, pattern]) => pattern.test(content))
    .map(([facet]) => facet)
  if (isOpenApiNote(note)) facets.push('api', 'openapi')
  return [...new Set(facets)]
}

export function buildNoteSearchArtifacts(note) {
  const sourceNote = isOpenApiNote(note)
    ? {
        ...note,
        content: `${note.content}\n${getOpenApiSearchText(getOpenApiDocument(note)?.document)}`.trim(),
      }
    : note

  const chunks = chunkNoteContent(sourceNote)
  const entities = chunks.flatMap(chunk => extractEntities(chunk.content, {
    noteId: note.id,
    chunkId: chunk.id,
  }))

  const metadata = {
    noteId: note.id,
    keywords: collectKeywords(note, chunks, entities),
    facets: collectFacets(note),
    lastIndexedAt: Date.now(),
  }

  return {
    chunks: chunks.map(chunk => ({
      ...chunk,
      createdAt: note.createdAt ?? note.updatedAt ?? Date.now(),
      updatedAt: note.updatedAt ?? Date.now(),
    })),
    entities,
    metadata,
  }
}
