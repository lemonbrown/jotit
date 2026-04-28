import { streamLLMChat } from './llmClient.js'

const SEARCH_FACETS = ['auth', 'credentials', 'cloud', 'database', 'infra', 'api', 'debugging', 'llm', 'regex', 'sqlite', 'openapi']

function collectStreamedResponse(params) {
  return new Promise((resolve, reject) => {
    let text = ''
    streamLLMChat(
      params,
      chunk => { text += chunk },
      () => resolve(text),
      error => reject(new Error(error || 'Nib search request failed')),
    )
  })
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced?.[1] ?? text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function cleanStringArray(value, max = 12) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => String(item ?? '').trim()).filter(Boolean))].slice(0, max)
}

export function validateNibSearchPlan(value) {
  if (!value || typeof value !== 'object') return null

  const facets = cleanStringArray(value.facets)
    .filter(facet => SEARCH_FACETS.includes(facet))

  return {
    rewrittenQuery: String(value.rewrittenQuery ?? '').trim(),
    synonyms: cleanStringArray(value.synonyms),
    facets,
    intent: String(value.intent ?? 'general-search').trim() || 'general-search',
    mustHave: cleanStringArray(value.mustHave, 6),
    shouldHave: cleanStringArray(value.shouldHave),
  }
}

export async function requestNibSearchPlan({ token, model, query }) {
  const response = await collectStreamedResponse({
    token,
    model,
    contextMode: 'search',
    context: `Available facets: ${SEARCH_FACETS.join(', ')}`,
    messages: [{ role: 'user', content: `Plan this search query:\n${query}` }],
  })
  return validateNibSearchPlan(extractJson(response))
}

function compactCandidate(result, index) {
  const title = String(result.note?.content ?? '').split('\n').find(line => line.trim())?.trim() ?? 'Untitled'
  return {
    id: result.noteId ?? result.note?.id,
    index,
    title,
    preview: String(result.preview ?? '').slice(0, 240),
    score: result.score ?? 0,
    reasons: result.reasons ?? [],
    matchType: result.matchType ?? 'unknown',
  }
}

function validateRerankResponse(value, allowedIds) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.results)) return null
  const seen = new Set()
  const results = []

  for (const entry of value.results) {
    const id = String(entry?.id ?? '').trim()
    if (!id || !allowedIds.has(id) || seen.has(id)) continue
    seen.add(id)
    results.push({
      id,
      reason: String(entry?.reason ?? 'Nib reranked').trim().slice(0, 120),
    })
  }

  return results.length ? results : null
}

export function applyNibRerank(results, reranked) {
  if (!reranked?.length) return results

  const originalTopScore = Number(results[0]?.score ?? 0)
  const resultById = new Map(results.map(result => [String(result.noteId ?? result.note?.id), result]))
  const originalIndexById = new Map(results.map((result, index) => [String(result.noteId ?? result.note?.id), index]))
  const used = new Set()
  const reordered = []

  for (const entry of reranked) {
    const result = resultById.get(entry.id)
    if (!result) continue

    const score = Number(result.score ?? 0)
    const originalIndex = originalIndexById.get(entry.id) ?? Number.MAX_SAFE_INTEGER
    const isWeakPromotion = originalIndex > 0 && originalTopScore >= 120 && score < originalTopScore * 0.65
    if (isWeakPromotion) continue

    used.add(entry.id)
    reordered.push({
      ...result,
      matchType: result.matchType === 'semantic' ? 'semantic-nib' : 'hybrid-nib',
      reasons: [...new Set(['Nib reranked', entry.reason, ...(result.reasons ?? [])])].slice(0, 5),
    })
  }

  for (const result of results) {
    const id = String(result.noteId ?? result.note?.id)
    if (!used.has(id)) reordered.push(result)
  }

  return reordered
}

export async function rerankResultsWithNib({ token, model, query, results, limit = 20 }) {
  const candidates = results.slice(0, limit).map(compactCandidate).filter(candidate => candidate.id)
  if (candidates.length < 2) return results

  const response = await collectStreamedResponse({
    token,
    model,
    contextMode: 'search-rerank',
    context: JSON.stringify({ query, candidates }, null, 2),
    messages: [{ role: 'user', content: 'Rerank these search results for relevance. Return only JSON.' }],
  })

  const reranked = validateRerankResponse(extractJson(response), new Set(candidates.map(candidate => candidate.id)))
  return reranked ? applyNibRerank(results, reranked) : results
}
