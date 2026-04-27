import { understandQuery } from './queryUnderstanding.js'

const SIMPLE_TERM_RE = /^[a-z0-9_]+$/
const SEPARATOR_RE = /[_-]+/g
const HIGH_CONFIDENCE_BOOST_ENTITY_TYPES = new Set(['api_key_like', 'jwt_like'])

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function termAppearsInText(text, term) {
  const haystack = String(text ?? '').toLowerCase()
  const needle = String(term ?? '').toLowerCase().trim()
  if (!needle) return false

  if (!SIMPLE_TERM_RE.test(needle)) return haystack.includes(needle)

  const pattern = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(needle)}($|[^a-z0-9_])`)
  return pattern.test(haystack)
}

function countTermHits(text, terms) {
  let hits = 0
  for (const term of terms) {
    if (termAppearsInText(text, term)) hits += 1
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

function entityValueMatchesTerms(entity, terms) {
  const normalizedValue = String(entity.normalizedValue ?? '')
  const separatedValue = normalizedValue.replace(SEPARATOR_RE, ' ')
  return terms.some(term => (
    termAppearsInText(normalizedValue, term) ||
    termAppearsInText(separatedValue, term)
  ))
}

function isEntityRelevantToQuery(entity, queryInfo) {
  if (entityValueMatchesTerms(entity, queryInfo.expandedTerms)) return true
  if (!queryInfo.entityTypesToBoost.includes(entity.entityType)) return false

  // Form imports can create many env_var-like entities from uppercase labels.
  // Only type-boost high-confidence credential entities without a value match.
  return HIGH_CONFIDENCE_BOOST_ENTITY_TYPES.has(entity.entityType)
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
      const coreCategoryHits = categories.reduce((sum, category) => sum + (queryInfo.coreTerms.some(term => termAppearsInText(category, term)) ? 1 : 0), 0)
      const categoryHit = categories.some(category => terms.some(term => termAppearsInText(category, term)))
      const coreContentHits = countTermHits(content, queryInfo.coreTerms)
      const contentTermHits = countTermHits(content, terms)
      const bestChunk = findBestChunk(noteChunks, terms)
      const chunkHits = bestChunk ? bestChunk.score / 18 : 0
      const entityMatches = noteEntities.filter(entity => isEntityRelevantToQuery(entity, queryInfo))
      const entityHitCount = entityMatches.length
      const entityScoreHits = Math.min(entityHitCount, 6)
      const facetHits = (metadata?.facets ?? []).reduce(
        (sum, facet) => sum + (queryInfo.facets.includes(facet) || terms.some(term => termAppearsInText(facet, term)) ? 1 : 0),
        0
      )
      const keywordHits = (metadata?.keywords ?? []).reduce((sum, keyword) => sum + (terms.some(term => termAppearsInText(keyword, term) || termAppearsInText(term, keyword)) ? 1 : 0), 0)
      const providerHits = queryInfo.providerHints.reduce((sum, provider) => sum + (termAppearsInText(content, provider) ? 1 : 0), 0)
      const providerCategoryHits = queryInfo.providerHints.reduce((sum, provider) => sum + (categories.some(category => termAppearsInText(category, provider)) ? 1 : 0), 0)
      const intentBoost =
        (queryInfo.intent === 'find-credentials' && entityHitCount ? 35 : 0) +
        (queryInfo.intent === 'find-config' && bestChunk?.kind === 'config' ? 24 : 0) +
        (queryInfo.intent === 'find-command' && bestChunk?.kind === 'command' ? 24 : 0) +
        (queryInfo.intent === 'debug-issue' && ['log', 'config'].includes(bestChunk?.kind) ? 24 : 0) +
        (queryInfo.intent === 'ci-workflow' && (categories.some(category => ['github', 'ci'].includes(category)) || termAppearsInText(content, 'workflow')) ? 28 : 0)

      const score =
        (exactCategory ? 140 : 0) +
        (coreCategoryHits * 48) +
        (categoryHit ? 90 : 0) +
        (coreContentHits * 26) +
        (contentTermHits * 16) +
        (chunkHits * 18) +
        (entityScoreHits * 38) +
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
