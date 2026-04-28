import fs from 'node:fs'
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

function readAiConfig(configFile) {
  try {
    return JSON.parse(fs.readFileSync(configFile, 'utf8'))
  } catch {
    return {}
  }
}

function writeAiConfig(configFile, config) {
  try {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8')
  } catch (err) {
    console.error('[jot.it] Failed to write AI config:', err.message)
  }
}

async function ollamaEmbed({ agentUrl, agentToken, model, texts }) {
  const response = await fetch(`${agentUrl}/ollama/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${agentToken}`,
    },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error')
    throw new Error(`Ollama embed failed: ${text}`)
  }

  const data = await response.json()
  return data.embeddings ?? []
}

export function createAiService(apiKey, { embeddingProvider, ollamaEmbedModel, agentUrl, agentToken, configFile } = {}) {
  const normalizedKey = apiKey?.trim() ?? ''
  const openaiClient = normalizedKey ? new OpenAI({ apiKey: normalizedKey }) : null

  // Runtime config — starts from env vars, overridden by config file, mutable via setConfig()
  const cfg = {
    embeddingProvider: embeddingProvider === 'ollama' ? 'ollama' : 'openai',
    ollamaEmbedModel: ollamaEmbedModel?.trim() || 'nomic-embed-text',
    agentUrl: agentUrl?.trim() || 'http://127.0.0.1:3210',
    agentToken: agentToken?.trim() || '',
  }

  if (configFile) {
    const saved = readAiConfig(configFile)
    if (saved.embeddingProvider === 'ollama' || saved.embeddingProvider === 'openai') {
      cfg.embeddingProvider = saved.embeddingProvider
    }
    if (saved.ollamaEmbedModel?.trim()) cfg.ollamaEmbedModel = saved.ollamaEmbedModel.trim()
  }

  const service = {
    isConfigured() {
      if (cfg.embeddingProvider === 'ollama') return !!(cfg.agentUrl && cfg.agentToken)
      return openaiClient !== null
    },

    embeddingModel() {
      return cfg.embeddingProvider === 'ollama' ? cfg.ollamaEmbedModel : 'text-embedding-3-small'
    },

    getConfig() {
      return {
        embeddingProvider: cfg.embeddingProvider,
        ollamaEmbedModel: cfg.ollamaEmbedModel,
      }
    },

    setConfig(updates) {
      if (updates.embeddingProvider === 'ollama' || updates.embeddingProvider === 'openai') {
        cfg.embeddingProvider = updates.embeddingProvider
      }
      if (updates.ollamaEmbedModel?.trim()) cfg.ollamaEmbedModel = updates.ollamaEmbedModel.trim()
      if (configFile) {
        writeAiConfig(configFile, { embeddingProvider: cfg.embeddingProvider, ollamaEmbedModel: cfg.ollamaEmbedModel })
      }
    },

    async getEmbedding(text) {
      const trimmed = String(text ?? '').trim()
      if (!trimmed) return null

      if (cfg.embeddingProvider === 'ollama') {
        if (!cfg.agentUrl || !cfg.agentToken) return null
        try {
          const results = await ollamaEmbed({ agentUrl: cfg.agentUrl, agentToken: cfg.agentToken, model: cfg.ollamaEmbedModel, texts: [trimmed.slice(0, 8000)] })
          return results[0] ?? null
        } catch {
          return null
        }
      }

      if (!openaiClient) return null
      try {
        const response = await openaiClient.embeddings.create({
          model: 'text-embedding-3-small',
          input: trimmed.slice(0, 8000),
        })
        return response.data?.[0]?.embedding ?? null
      } catch {
        return null
      }
    },

    async getEmbeddings(texts) {
      const prepared = (texts ?? [])
        .map(text => String(text ?? '').trim())
        .filter(Boolean)

      if (!prepared.length) return []

      if (cfg.embeddingProvider === 'ollama') {
        if (!cfg.agentUrl || !cfg.agentToken) return []
        try {
          return await ollamaEmbed({ agentUrl: cfg.agentUrl, agentToken: cfg.agentToken, model: cfg.ollamaEmbedModel, texts: prepared.map(t => t.slice(0, 8000)) })
        } catch {
          return []
        }
      }

      if (!openaiClient) return []
      try {
        const response = await openaiClient.embeddings.create({
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

  return service
}

export function registerAiRoutes(app, { aiService, pgPool, requireAuth }) {
  app.get('/api/ai/status', requireAuth, (_req, res) => {
    res.json({ available: aiService.isConfigured() })
  })

  app.get('/api/ai/status/public', (_req, res) => {
    if (!aiService.isConfigured()) return sendJsonError(res, 503, 'AI not configured')
    res.json({ available: true })
  })

  app.get('/api/ai/config', (_req, res) => {
    res.json(aiService.getConfig())
  })

  app.post('/api/ai/config', (req, res) => {
    const { embeddingProvider, ollamaEmbedModel } = req.body ?? {}
    if (embeddingProvider !== undefined && embeddingProvider !== 'openai' && embeddingProvider !== 'ollama') {
      return sendJsonError(res, 400, 'embeddingProvider must be "openai" or "ollama"')
    }
    aiService.setConfig({
      ...(embeddingProvider !== undefined ? { embeddingProvider } : {}),
      ...(ollamaEmbedModel !== undefined ? { ollamaEmbedModel } : {}),
    })
    res.json({ ok: true, ...aiService.getConfig() })
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
