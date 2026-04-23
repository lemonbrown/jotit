import OpenAI from 'openai'
import KEYWORD_DATA from '../embedding_keywords.json'
import { looksLikeCsvTable } from './csvTable.js'

let client = null
let categoryEmbeddings = null // Array<{ id, name, vector }> — loaded once per session

export function initOpenAI(apiKey) {
  client = apiKey?.trim() ? new OpenAI({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true }) : null
  if (!client) categoryEmbeddings = null // reset if key removed
}

export function isOpenAIReady() {
  return client !== null
}

export async function testConnection() {
  if (!client) return false
  try {
    await client.models.list()
    return true
  } catch {
    return false
  }
}

export async function categorizeNote(content) {
  if (!client || !content.trim()) return []
  try {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Categorize this note. Return a JSON array of 3-8 lowercase tag strings.
Tag types to consider:
- Content type: password, token, api-key, credentials, config, snippet, command, url, error-log, sql, csv, table, spreadsheet
- Technology: github, aws, docker, postgres, nginx, npm, python, node, openai, etc.
- Purpose: authentication, deployment, debugging, reference
Return ONLY valid JSON array, no explanation.`,
        },
        {
          role: 'user',
          content: content.slice(0, 2000),
        },
      ],
      max_tokens: 120,
      temperature: 0.2,
    })
    const text = res.choices[0]?.message?.content?.trim() ?? ''
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.slice(0, 8).map(t => String(t).toLowerCase()) : []
  } catch {
    return []
  }
}

export async function getEmbedding(text) {
  if (!client || !text.trim()) return null
  try {
    const res = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    })
    return res.data[0]?.embedding ?? null
  } catch {
    return null
  }
}

// ── Embedding-based categorization ───────────────────────────────────────────

/** Text fed to the embedding model to represent each category */
function categoryText(cat) {
  return `${cat.name}: ${cat.description} Keywords: ${cat.keywords.join(', ')}`
}

/** Simple fingerprint of the JSON — cache is invalidated when this changes */
function cacheVersion() {
  return KEYWORD_DATA.categories.map(c => `${c.id}:${c.keywords.length}`).join('|')
}

const EMBED_CACHE_KEY = 'jotit:catembeds:v1'

/**
 * Pre-computes one embedding vector per category from embedding_keywords.json.
 * Persists to localStorage so it's only fetched once (or when the JSON changes).
 * Must be called after initOpenAI().
 */
export async function initCategoryEmbeddings() {
  if (categoryEmbeddings) return // already warm
  if (!client) return

  // Try cache first
  try {
    const raw = localStorage.getItem(EMBED_CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (cached.version === cacheVersion()) {
        categoryEmbeddings = cached.embeddings
        console.log('[JotIt] Category embeddings loaded from cache')
        return
      }
    }
  } catch { /* corrupt cache — recompute */ }

  // Compute fresh — one API call per category (10 calls, ~$0.000002 total)
  console.log('[JotIt] Computing category embeddings…')
  try {
    const results = await Promise.all(
      KEYWORD_DATA.categories.map(async cat => {
        const res = await client.embeddings.create({
          model: 'text-embedding-3-small',
          input: categoryText(cat),
        })
        const vector = res.data[0]?.embedding ?? null
        return vector ? { id: cat.id, name: cat.name, vector } : null
      })
    )
    categoryEmbeddings = results.filter(Boolean)
    localStorage.setItem(EMBED_CACHE_KEY, JSON.stringify({
      version: cacheVersion(),
      embeddings: categoryEmbeddings,
    }))
    console.log(`[JotIt] Category embeddings ready (${categoryEmbeddings.length} categories)`)
  } catch (e) {
    console.warn('[JotIt] Failed to compute category embeddings:', e)
  }
}

/** True once category reference vectors are in memory */
export function areCategoryEmbeddingsReady() {
  return categoryEmbeddings !== null && categoryEmbeddings.length > 0
}

/**
 * Classifies a note embedding against the pre-computed category vectors.
 * @param {number[]} noteEmbedding - vector from getEmbedding()
 * @param {number} threshold - minimum cosine similarity to assign a tag (default 0.35)
 * @param {number} maxTags - maximum tags to return (default 4)
 * @returns {string[]} - category name strings, e.g. ["Secrets / Credentials"]
 */
export function categorizeByEmbedding(noteEmbedding, threshold = 0.35, maxTags = 4) {
  if (!categoryEmbeddings?.length || !noteEmbedding?.length) return []
  return categoryEmbeddings
    .map(cat => ({ name: cat.name, score: cosineSimilarity(noteEmbedding, cat.vector) }))
    .filter(x => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTags)
    .map(x => x.name)
}

/** Pattern-based categorization using regex patterns from embedding_keywords.json */
export function categorizeByPatterns(content) {
  const matched = []
  if (looksLikeCsvTable(content)) matched.push('CSV / Tables')
  for (const cat of KEYWORD_DATA.categories) {
    if (matched.includes(cat.name)) continue
    if (!cat.patterns?.length) continue
    for (const pattern of cat.patterns) {
      const hit = new RegExp(pattern).test(content)
      console.log(`[JotIt] pattern "${pattern}" vs content[0:40]="${content.slice(0,40)}" → ${hit}`)
      if (hit) {
        matched.push(cat.name)
        break
      }
    }
  }
  return matched
}

/** Combine pattern + embedding results, pattern matches take priority */
export function categorize(content, noteEmbedding, { threshold = 0.35, maxTags = 4 } = {}) {
  const patternMatches = categorizeByPatterns(content)
  const embedMatches = categorizeByEmbedding(noteEmbedding, threshold, maxTags)
  const merged = [...new Set([...patternMatches, ...embedMatches])]
  return merged.slice(0, maxTags)
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export async function semanticSearch(query, notes, topK = 15) {
  if (!client) return null
  try {
    const qEmbed = await getEmbedding(query)
    if (!qEmbed) return null
    const withEmbed = notes.filter(n => n.embedding?.length)
    if (!withEmbed.length) return null
    const scored = withEmbed
      .map(n => ({ n, s: cosineSimilarity(qEmbed, n.embedding) }))
      .sort((a, b) => b.s - a.s)
      .filter(x => x.s > 0.25)
      .slice(0, topK)
      .map(x => x.n)
    return scored
  } catch {
    return null
  }
}

export async function semanticSearchItems(query, items, topK = 10, threshold = 0.2) {
  if (!client) return null
  try {
    const qEmbed = await getEmbedding(query)
    if (!qEmbed) return null
    const withEmbed = items.filter(item => item.embedding?.length)
    if (!withEmbed.length) return null
    return withEmbed
      .map(item => ({ item, score: cosineSimilarity(qEmbed, item.embedding) }))
      .filter(entry => entry.score > threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(entry => entry.item)
  } catch {
    return null
  }
}
