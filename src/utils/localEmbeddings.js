import { getOllamaEmbeddings } from './llmClient'
import { setNoteEmbeddingSync, schedulePersist } from './db'
import { mergeSemanticSearchResults } from './searchCore'
import { loadSettings } from './storage'

const DEFAULT_MODEL = 'nomic-embed-text'
const MAX_NOTE_CHARS = 8000

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (!normA || !normB) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function getLocalEmbeddingConfig() {
  const settings = loadSettings()
  if (settings.embeddingProvider !== 'ollama') return null
  const token = settings.localAgentToken?.trim()
  if (!token) return null
  return {
    token,
    model: settings.ollamaEmbedModel?.trim() || DEFAULT_MODEL,
  }
}

export async function embedTextLocally(text, config) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed || !config) return null
  const embeddings = await getOllamaEmbeddings({
    token: config.token,
    model: config.model,
    input: trimmed.slice(0, MAX_NOTE_CHARS),
  })
  return embeddings?.[0] ?? null
}

export async function ensureLocalNoteEmbeddings(notes, config, { limit = 12 } = {}) {
  if (!config) return []
  const missing = (notes ?? [])
    .filter(note => note?.id && note.content?.trim() && !note.embedding?.length)
    .slice(0, limit)
  if (!missing.length) return notes

  const embeddings = await getOllamaEmbeddings({
    token: config.token,
    model: config.model,
    input: missing.map(note => String(note.content ?? '').slice(0, MAX_NOTE_CHARS)),
  })

  const byId = new Map()
  missing.forEach((note, index) => {
    const embedding = embeddings[index]
    if (!embedding?.length) return
    setNoteEmbeddingSync(note.id, embedding)
    byId.set(note.id, embedding)
  })
  if (byId.size) schedulePersist()

  return notes.map(note => byId.has(note.id) ? { ...note, embedding: byId.get(note.id) } : note)
}

export async function searchNotesWithLocalEmbeddings(localResults, notes, query) {
  const config = await getLocalEmbeddingConfig()
  if (!config) return localResults

  const notesWithEmbeddings = await ensureLocalNoteEmbeddings(notes, config)
  const queryEmbedding = await embedTextLocally(query, config)
  if (!queryEmbedding?.length) return localResults

  const semanticNotes = notesWithEmbeddings
    .filter(note => note.embedding?.length)
    .map(note => ({ note, score: cosineSimilarity(queryEmbedding, note.embedding) }))
    .filter(entry => entry.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  return mergeSemanticSearchResults(localResults, semanticNotes)
}
