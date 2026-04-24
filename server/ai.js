import OpenAI from 'openai'
import { indexNoteOnServer } from './indexing.js'
import { sendJsonError } from './http.js'

function cosineSimilarity(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    na += a[index] * a[index]
    nb += b[index] * b[index]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function createAiService(apiKey) {
  const normalizedKey = apiKey?.trim() ?? ''
  const client = normalizedKey ? new OpenAI({ apiKey: normalizedKey }) : null

  return {
    isConfigured() {
      return client !== null
    },

    async getEmbedding(text) {
      if (!client || !String(text ?? '').trim()) return null

      try {
        const response = await client.embeddings.create({
          model: 'text-embedding-3-small',
          input: String(text).trim().slice(0, 8000),
        })
        return response.data?.[0]?.embedding ?? null
      } catch {
        return null
      }
    },

    async getEmbeddings(texts) {
      if (!client) return []

      const prepared = (texts ?? [])
        .map(text => String(text ?? '').trim())
        .filter(Boolean)

      if (!prepared.length) return []

      try {
        const response = await client.embeddings.create({
          model: 'text-embedding-3-small',
          input: prepared.map(text => text.slice(0, 8000)),
        })
        return response.data
          .sort((a, b) => a.index - b.index)
          .map(entry => entry.embedding ?? null)
      } catch {
        return []
      }
    },

    cosineSimilarity,
  }
}

export function registerAiRoutes(app, { aiService, pgPool, requireAuth }) {
  app.get('/api/ai/status', requireAuth, (_req, res) => {
    res.json({ available: aiService.isConfigured() })
  })

  app.get('/api/ai/status/public', (_req, res) => {
    if (!aiService.isConfigured()) return sendJsonError(res, 503, 'AI not configured')
    res.json({ available: true })
  })

  app.post('/api/ai/reindex', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Sync not configured')

    const userId = req.user.userId
    try {
      const { rows } = await pgPool.query(
        `SELECT id, content, categories, created_at, updated_at
         FROM notes
         WHERE user_id = $1
           AND deleted_at IS NULL`,
        [userId]
      )

      let reindexed = 0
      for (const note of rows) {
        await indexNoteOnServer(pgPool, aiService, userId, note)
        reindexed += 1
      }

      res.json({ ok: true, reindexed })
    } catch {
      sendJsonError(res, 500, 'Reindex failed')
    }
  })
}
