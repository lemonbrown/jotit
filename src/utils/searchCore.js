import { understandQuery } from './queryUnderstanding.js'
import {
  buildPreview,
  createSemanticOnlyResult,
  mergeReasonLists,
  rankNoteCandidate,
  sortRankedResults,
  termAppearsInText,
} from './searchRanker.js'

function buildLocalArtifacts({ chunks = [], entities = [], metadataByNote = new Map() } = {}) {
  const chunksByNote = new Map()
  const entitiesByNote = new Map()

  for (const chunk of chunks) {
    const list = chunksByNote.get(chunk.noteId) ?? []
    list.push(chunk)
    chunksByNote.set(chunk.noteId, list)
  }

  for (const entity of entities) {
    const list = entitiesByNote.get(entity.noteId) ?? []
    list.push(entity)
    entitiesByNote.set(entity.noteId, list)
  }

  return { chunksByNote, entitiesByNote, metadataByNote }
}

export function searchNotesWithArtifacts(notes, query, artifacts = {}) {
  const queryInfo = understandQuery(query)
  if (!queryInfo.normalizedQuery) return []

  const { chunksByNote, entitiesByNote, metadataByNote } = buildLocalArtifacts(artifacts)

  return notes
    .map((note, index) => {
      return rankNoteCandidate({
        note,
        index,
        queryInfo,
        noteChunks: chunksByNote.get(note.id) ?? [],
        noteEntities: entitiesByNote.get(note.id) ?? [],
        metadata: metadataByNote.get(note.id),
      })
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
}

export function mergeSemanticSearchResults(localResults, semanticNotes) {
  if (!semanticNotes?.length) return localResults

  const seen = new Set(localResults.map(result => result.noteId))
  const merged = [...localResults]

  for (const entry of semanticNotes) {
    const note = entry?.note ?? entry
    const semanticScore = Number(entry?.score ?? 0.01)
    if (seen.has(note.id)) continue
    seen.add(note.id)
    merged.push(createSemanticOnlyResult(note, semanticScore))
  }

  return sortRankedResults(merged)
}

export function mergeChunkSemanticResults(localResults, chunkMatches, notesById) {
  if (!chunkMatches?.length) return localResults

  const merged = [...localResults]
  const byNoteId = new Map(localResults.map(result => [result.noteId, result]))

  for (const chunkMatch of chunkMatches) {
    const existing = byNoteId.get(chunkMatch.noteId)
    if (!existing) {
      const note = notesById.get(chunkMatch.noteId)
      if (!note) continue
      const inserted = {
        noteId: note.id,
        note,
        index: Number.MAX_SAFE_INTEGER,
        score: Math.round(chunkMatch.similarity * 100),
        matchType: 'semantic-chunk',
        matchedChunkId: chunkMatch.chunkId,
        matchedSectionTitle: chunkMatch.sectionTitle ?? null,
        matchedChunkKind: chunkMatch.kind ?? null,
        preview: buildPreview(note, chunkMatch),
        reasons: ['semantic chunk similarity'],
        entityHits: [],
      }
      merged.push(inserted)
      byNoteId.set(note.id, inserted)
      continue
    }

    if ((chunkMatch.similarity * 100) > existing.score) {
      existing.score = Math.max(existing.score, Math.round(chunkMatch.similarity * 100))
      existing.matchedChunkId = existing.matchedChunkId ?? chunkMatch.chunkId
      existing.matchedSectionTitle = existing.matchedSectionTitle ?? chunkMatch.sectionTitle ?? null
      existing.matchedChunkKind = existing.matchedChunkKind ?? chunkMatch.kind ?? null
      existing.preview = buildPreview(existing.note, chunkMatch)
    }

    existing.reasons = mergeReasonLists(existing.reasons, ['semantic chunk similarity'])
    if (existing.matchType === 'hybrid') existing.matchType = 'hybrid-semantic'
  }

  return sortRankedResults(merged)
}

const CREDENTIAL_RE = /\b(ghp_|npm_|sk-proj-|sk-)([A-Za-z0-9]{20,})\b|eyJ[A-Za-z0-9._-]{40,}/g

export function redactCredentialPreview(text) {
  return text.replace(CREDENTIAL_RE, (match, prefix) => {
    if (!prefix) return '[JWT REDACTED]'
    return `${prefix}[REDACTED]`
  })
}

export function searchSnippetsLocally(snippets, query) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  return snippets
    .map((snippet, index) => {
      const name = (snippet.name ?? '').toLowerCase()
      const content = snippet.content.toLowerCase()
      const preview = snippet.content.split('\n').find(line => line.trim()) ?? snippet.content
      let score = 0

      if (name === normalizedQuery) score += 300
      else if (name.startsWith(normalizedQuery)) score += 220
      else if (name.includes(normalizedQuery)) score += 160

      if (content.includes(normalizedQuery)) score += 70
      if (preview.toLowerCase().includes(normalizedQuery)) score += 35
      if (!score) return null

      return { item: snippet, index, score }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(result => result.item)
}
