const SIMPLE_TERM_RE = /^[a-z0-9_]+$/
const SEPARATOR_RE = /[_-]+/g
const HIGH_CONFIDENCE_BOOST_ENTITY_TYPES = new Set(['api_key_like', 'jwt_like'])

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function termAppearsInText(text, term) {
  const haystack = String(text ?? '').toLowerCase()
  const needle = String(term ?? '').toLowerCase().trim()
  if (!needle) return false

  if (!SIMPLE_TERM_RE.test(needle)) return haystack.includes(needle)

  const pattern = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(needle)}($|[^a-z0-9_])`)
  return pattern.test(haystack)
}

export function countTermHits(text, terms) {
  let hits = 0
  for (const term of terms) {
    if (termAppearsInText(text, term)) hits += 1
  }
  return hits
}

export function mergeReasonLists(...reasonSets) {
  return [...new Set(reasonSets.flat().filter(Boolean))].slice(0, 5)
}

export function buildPreview(note, bestChunk) {
  const previewSource = bestChunk?.content ?? note.content
  const collapsed = String(previewSource ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')

  return collapsed.slice(0, 220)
}

function getTitle(note) {
  return String(note.content ?? '').split('\n').find(line => line.trim())?.trim() ?? ''
}

function getFirstParagraph(note) {
  return String(note.content ?? '').split(/\n\s*\n/).find(part => part.trim()) ?? ''
}

function hasCredentialEvidence({ categories, content, entityHitCount, metadata }) {
  if (entityHitCount > 0) return true
  if (categories.some(category => ['credentials', 'credential', 'token', 'api-key', 'secret', 'github'].includes(category))) return true
  if ((metadata?.facets ?? []).includes('credentials')) return true
  return /\b(ghp_|ghs_|github_pat_|bearer\s+|api[_ -]?key|client secret|personal access token|token)\b/i.test(content)
}

function countPhraseHits(text, phrases) {
  return phrases.reduce((sum, phrase) => sum + (termAppearsInText(text, phrase) ? 1 : 0), 0)
}

function calculateProximityBoost(text, terms) {
  const haystack = String(text ?? '').toLowerCase()
  const positions = terms
    .map(term => ({ term, index: haystack.indexOf(String(term).toLowerCase()) }))
    .filter(entry => entry.index >= 0)
    .sort((a, b) => a.index - b.index)

  if (positions.length < 2) return 0
  const span = positions[positions.length - 1].index - positions[0].index
  if (span <= 80) return 30
  if (span <= 180) return 16
  return 0
}

function calculateRecencyBoost(note, now = Date.now()) {
  const updatedAt = Number(note.updatedAt ?? note.updated_at ?? 0)
  if (!updatedAt) return 0
  const ageDays = Math.max(0, (now - updatedAt) / 86400000)
  if (ageDays <= 7) return 14
  if (ageDays <= 30) return 9
  if (ageDays <= 90) return 4
  return 0
}

function entityValueMatchesTerms(entity, terms) {
  const normalizedValue = String(entity.normalizedValue ?? '')
  const separatedValue = normalizedValue.replace(SEPARATOR_RE, ' ')
  return terms.some(term => (
    termAppearsInText(normalizedValue, term) ||
    termAppearsInText(separatedValue, term)
  ))
}

export function isEntityRelevantToQuery(entity, queryInfo) {
  if (entityValueMatchesTerms(entity, queryInfo.expandedTerms)) return true
  if (!queryInfo.entityTypesToBoost.includes(entity.entityType)) return false

  // Form imports can create many env_var-like entities from uppercase labels.
  // Only type-boost high-confidence credential entities without a value match.
  return HIGH_CONFIDENCE_BOOST_ENTITY_TYPES.has(entity.entityType)
}

function summarizeReasons({
  exactCategory,
  categoryHit,
  titleExact,
  titleHits,
  phraseHits,
  proximityBoost,
  bestChunk,
  entityHitCount,
  facetHits,
  keywordHits,
  semantic = false,
}) {
  const reasons = []
  if (titleExact) reasons.push('exact title match')
  else if (titleHits > 0) reasons.push('title match')
  if (phraseHits > 0) reasons.push('exact phrase match')
  if (exactCategory) reasons.push('exact category match')
  else if (categoryHit) reasons.push('matching category')
  if (bestChunk?.sectionTitle) reasons.push(`section: ${bestChunk.sectionTitle}`)
  else if (bestChunk?.kind && bestChunk.kind !== 'prose') reasons.push(`${bestChunk.kind} chunk match`)
  if (proximityBoost > 0) reasons.push('nearby query terms')
  if (entityHitCount > 0) reasons.push(`${entityHitCount} entity hit${entityHitCount !== 1 ? 's' : ''}`)
  if (facetHits > 0) reasons.push('matching search facets')
  if (keywordHits > 0) reasons.push('keyword overlap')
  if (semantic) reasons.push('semantic note similarity')
  return reasons.slice(0, 4)
}

export function findBestChunk(noteChunks, terms) {
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

export function rankNoteCandidate({ note, index, queryInfo, noteChunks = [], noteEntities = [], metadata = null, semanticScore = 0 }) {
  const content = String(note.content ?? '').toLowerCase()
  const title = getTitle(note)
  const firstParagraph = getFirstParagraph(note)
  const categories = (note.categories ?? []).map(category => String(category).toLowerCase())
  const terms = queryInfo.expandedTerms

  const exactCategory = categories.some(category => category === queryInfo.normalizedQuery)
  const coreCategoryHits = categories.reduce((sum, category) => sum + (queryInfo.coreTerms.some(term => termAppearsInText(category, term)) ? 1 : 0), 0)
  const categoryHit = categories.some(category => terms.some(term => termAppearsInText(category, term)))
  const coreContentHits = countTermHits(content, queryInfo.coreTerms)
  const contentTermHits = countTermHits(content, terms)
  const mustHaveMisses = (queryInfo.mustHave ?? []).filter(term => !termAppearsInText(content, term))
  if (mustHaveMisses.length) return null
  const shouldHaveHits = countTermHits(content, queryInfo.shouldHave ?? [])
  const titleExact = title.toLowerCase() === queryInfo.normalizedQuery
  const titleHits = countTermHits(title, queryInfo.coreTerms)
  const firstParagraphHits = countTermHits(firstParagraph, queryInfo.coreTerms)
  const phraseHits = countPhraseHits(content, queryInfo.phrases ?? [])
  const proximityBoost = calculateProximityBoost(content, queryInfo.coreTerms)
  const recencyBoost = calculateRecencyBoost(note)
  const bestChunk = findBestChunk(noteChunks, terms)
  const chunkHits = bestChunk ? bestChunk.score / 18 : 0
  const entityMatches = noteEntities.filter(entity => isEntityRelevantToQuery(entity, queryInfo))
  const entityHitCount = entityMatches.length
  const credentialEvidence = hasCredentialEvidence({ categories, content, entityHitCount, metadata })
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
  const credentialIntentBoost = queryInfo.intent === 'find-credentials'
    ? (credentialEvidence ? 90 : -80)
    : 0

  const lexicalScore =
    (exactCategory ? 140 : 0) +
    (coreCategoryHits * 48) +
    (categoryHit ? 90 : 0) +
    (coreContentHits * 26) +
    (contentTermHits * 16) +
    (Math.min(shouldHaveHits, 6) * 10) +
    (chunkHits * 18) +
    (entityScoreHits * 38) +
    (facetHits * 20) +
    (providerHits * 18) +
    (providerCategoryHits * 42) +
    intentBoost +
    credentialIntentBoost +
    Math.min(keywordHits, 6) * 8

  const rankingBoost =
    (titleExact ? 120 : 0) +
    (titleHits * 34) +
    (firstParagraphHits * 12) +
    (phraseHits * 42) +
    proximityBoost +
    recencyBoost

  const score = Math.round((lexicalScore * 0.78) + (semanticScore * 0.35) + rankingBoost)
  if (!score) return null

  return {
    noteId: note.id,
    note,
    index,
    score,
    lexicalScore,
    semanticScore,
    matchType: semanticScore > 0 ? 'hybrid-semantic' : 'hybrid',
    matchedChunkId: bestChunk?.id ?? null,
    matchedSectionTitle: bestChunk?.sectionTitle ?? null,
    matchedChunkKind: bestChunk?.kind ?? null,
    preview: buildPreview(note, bestChunk),
    reasons: summarizeReasons({
      exactCategory,
      categoryHit,
      titleExact,
      titleHits,
      phraseHits,
      proximityBoost,
      bestChunk,
      entityHitCount,
      facetHits,
      keywordHits,
    }),
    entityHits: entityMatches.slice(0, 5),
  }
}

export function sortRankedResults(results) {
  return results.sort((a, b) => b.score - a.score || a.index - b.index)
}

export function createSemanticOnlyResult(note, semanticScore = 1) {
  return {
    noteId: note.id,
    note,
    index: Number.MAX_SAFE_INTEGER,
    score: Math.max(1, Math.round(semanticScore * 100)),
    lexicalScore: 0,
    semanticScore: Math.max(1, Math.round(semanticScore * 100)),
    matchType: 'semantic',
    matchedChunkId: null,
    matchedSectionTitle: null,
    matchedChunkKind: null,
    preview: buildPreview(note, null),
    reasons: summarizeReasons({ semantic: true }),
    entityHits: [],
  }
}
