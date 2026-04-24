import { understandQuery } from './queryUnderstanding.js'

function countTermHits(text, terms) {
  const haystack = String(text ?? '').toLowerCase()
  let hits = 0
  for (const term of terms) {
    if (haystack.includes(term)) hits += 1
  }
  return hits
}

function summarizeReasons({ exactCategory, categoryHit, bestChunk, entityHitCount, facetHits, keywordHits, semantic = false }) {
  const reasons = []
  if (exactCategory) reasons.push('exact category match')
  else if (categoryHit) reasons.push('matching category')
  if (bestChunk?.sectionTitle) reasons.push(`section: ${bestChunk.sectionTitle}`)
  else if (bestChunk?.kind && bestChunk.kind !== 'prose') reasons.push(`${bestChunk.kind} chunk match`)
  if (entityHitCount > 0) reasons.push(`${entityHitCount} entity hit${entityHitCount !== 1 ? 's' : ''}`)
  if (facetHits > 0) reasons.push('matching search facets')
  if (keywordHits > 0) reasons.push('keyword overlap')
  if (semantic) reasons.push('semantic note similarity')
  return reasons.slice(0, 3)
}

function findBestChunk(noteChunks, terms) {
  let best = null

  for (const chunk of noteChunks) {
    const contentHits = countTermHits(chunk.content, terms)
    const sectionHits = countTermHits(chunk.sectionTitle, terms)
    const score = (contentHits * 18) + (sectionHits * 24)
    if (!score) continue
    if (!best || score > best.score) best = { ...chunk, score }
  }

  return best
}

function buildPreview(note, bestChunk) {
  const previewSource = bestChunk?.content ?? note.content
  const collapsed = String(previewSource ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')

  return collapsed.slice(0, 220)
}

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

function mergeReasonLists(...reasonSets) {
  return [...new Set(reasonSets.flat().filter(Boolean))].slice(0, 4)
}

export function searchNotesWithArtifacts(notes, query, artifacts = {}) {
  const queryInfo = understandQuery(query)
  if (!queryInfo.normalizedQuery) return []

  const terms = queryInfo.expandedTerms
  const { chunksByNote, entitiesByNote, metadataByNote } = buildLocalArtifacts(artifacts)

  return notes
    .map((note, index) => {
      const content = note.content.toLowerCase()
      const categories = note.categories.map(category => String(category).toLowerCase())
      const noteChunks = chunksByNote.get(note.id) ?? []
      const noteEntities = entitiesByNote.get(note.id) ?? []
      const metadata = metadataByNote.get(note.id)

      const exactCategory = categories.some(category => category === queryInfo.normalizedQuery)
      const coreCategoryHits = categories.reduce((sum, category) => sum + (queryInfo.coreTerms.some(term => category.includes(term)) ? 1 : 0), 0)
      const categoryHit = categories.some(category => terms.some(term => category.includes(term)))
      const coreContentHits = countTermHits(content, queryInfo.coreTerms)
      const contentTermHits = countTermHits(content, terms)
      const bestChunk = findBestChunk(noteChunks, terms)
      const chunkHits = bestChunk ? bestChunk.score / 18 : 0
      const entityMatches = noteEntities.filter(entity => {
        if (terms.some(term => entity.normalizedValue.includes(term))) return true
        if (queryInfo.entityTypesToBoost.includes(entity.entityType)) return true
        return false
      })
      const entityHitCount = entityMatches.length
      const facetHits = (metadata?.facets ?? []).reduce(
        (sum, facet) => sum + (queryInfo.facets.includes(facet) || terms.some(term => facet.includes(term)) ? 1 : 0),
        0
      )
      const keywordHits = (metadata?.keywords ?? []).reduce((sum, keyword) => sum + (terms.some(term => keyword.includes(term) || term.includes(keyword)) ? 1 : 0), 0)
      const providerHits = queryInfo.providerHints.reduce((sum, provider) => sum + (content.includes(provider) ? 1 : 0), 0)
      const providerCategoryHits = queryInfo.providerHints.reduce((sum, provider) => sum + (categories.some(category => category.includes(provider)) ? 1 : 0), 0)
      const intentBoost =
        (queryInfo.intent === 'find-credentials' && entityHitCount ? 35 : 0) +
        (queryInfo.intent === 'find-config' && bestChunk?.kind === 'config' ? 24 : 0) +
        (queryInfo.intent === 'find-command' && bestChunk?.kind === 'command' ? 24 : 0) +
        (queryInfo.intent === 'debug-issue' && ['log', 'config'].includes(bestChunk?.kind) ? 24 : 0) +
        (queryInfo.intent === 'ci-workflow' && (categories.some(category => ['github', 'ci'].includes(category)) || content.includes('workflow')) ? 28 : 0)

      const score =
        (exactCategory ? 140 : 0) +
        (coreCategoryHits * 48) +
        (categoryHit ? 90 : 0) +
        (coreContentHits * 26) +
        (contentTermHits * 16) +
        (chunkHits * 18) +
        (entityHitCount * 38) +
        (facetHits * 20) +
        (providerHits * 18) +
        (providerCategoryHits * 42) +
        intentBoost +
        Math.min(keywordHits, 6) * 8

      if (!score) return null

      return {
        noteId: note.id,
        note,
        index,
        score,
        matchType: 'hybrid',
        matchedChunkId: bestChunk?.id ?? null,
        matchedSectionTitle: bestChunk?.sectionTitle ?? null,
        matchedChunkKind: bestChunk?.kind ?? null,
        preview: buildPreview(note, bestChunk),
        reasons: summarizeReasons({ exactCategory, categoryHit, bestChunk, entityHitCount, facetHits, keywordHits }),
        entityHits: entityMatches.slice(0, 5),
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
}

export function mergeSemanticSearchResults(localResults, semanticNotes) {
  if (!semanticNotes?.length) return localResults

  const seen = new Set(localResults.map(result => result.noteId))
  const merged = [...localResults]

  for (const note of semanticNotes) {
    if (seen.has(note.id)) continue
    seen.add(note.id)
    merged.push({
      noteId: note.id,
      note,
      index: Number.MAX_SAFE_INTEGER,
      score: 1,
      matchType: 'semantic',
      matchedChunkId: null,
      matchedSectionTitle: null,
      matchedChunkKind: null,
      preview: buildPreview(note, null),
      reasons: summarizeReasons({ semantic: true }),
      entityHits: [],
    })
  }

  return merged
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

  return merged.sort((a, b) => b.score - a.score || a.index - b.index)
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
