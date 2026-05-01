import { buildNibPrompt, getNibPromptOverrides } from './nibPrompts.js'
import { loadSettings } from './storage.js'

const AGENT_BASE = 'http://localhost:3210'
const KEY_MODEL = 'jotit_llm_model'
const KEY_PROVIDER = 'jotit_llm_provider'
const KEY_REMOTE_BASE_URL = 'jotit_llm_remote_base_url'
const KEY_REMOTE_API_KEY = 'jotit_llm_remote_api_key'
const KEY_REMOTE_MODEL = 'jotit_llm_remote_model'

const REGEX_SYSTEM_PROMPT = `You are a JavaScript regular expression expert. Your job is to write, fix, and explain regular expressions for JotIt's browser regex tester.

Rules:
- Return a JavaScript RegExp-compatible pattern.
- Put the regex on its own first line in this exact format: /pattern/flags
- Use only these flags when needed: g, i, m, s.
- Do not stack quantifiers. For example, never write \\s*{3}; write (?:\\s*...){3} or another valid grouped form.
- Prefer non-capturing groups unless the captured value is intentionally useful.
- If JavaScript regex cannot match only the desired subpart, return a valid regex that captures the desired value and explain which capture group to use.
- Always provide a working regex. Do not ask clarifying questions. Make a reasonable assumption and note it briefly.`
const SQLITE_SYSTEM_PROMPT = `You are a SQLite query expert. Your job is to write read-only SQLite SELECT queries for JotIt's full-database SQLite query runner.

Rules:
- Return a single SQLite SELECT query.
- Put the SQL query first, preferably inside a fenced sql code block.
- Do not return INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, PRAGMA, ATTACH, DETACH, VACUUM, or multiple statements.
- Use the entire provided database schema. Join across tables and views when the request calls for it.
- Use only tables, views, and columns shown in the provided database schema.
- Quote identifiers with double quotes when they contain spaces, punctuation, or could be reserved words.
- Add a reasonable LIMIT unless the user explicitly asks for aggregate-only results.
- Do not ask clarifying questions. Make a reasonable assumption and note it briefly after the query.`
const SEARCH_PLAN_SYSTEM_PROMPT = `You help improve JotIt note search. Return compact JSON only.

For query planning, return:
{
  "rewrittenQuery": "short improved search query",
  "synonyms": [],
  "facets": [],
  "intent": "general-search",
  "mustHave": [],
  "shouldHave": []
}

Use only available facets from context. Keep arrays short. Do not include prose.`
const SEARCH_RERANK_SYSTEM_PROMPT = `You rerank JotIt search results. Return compact JSON only.

Rules:
- Use only candidate IDs provided in context.
- Do not invent IDs.
- Do not drop relevant candidates unless they are outside the returned top order.
- Prefer exact title/phrase matches, useful semantic matches, and results that answer the user's query.

Return:
{
  "results": [
    { "id": "candidate-id", "reason": "short reason" }
  ]
}`
const GIT_SUMMARY_SYSTEM_PROMPT = `You are a developer assistant that summarizes git changes concisely.

Rules:
- Begin with 1-2 sentences describing the overall intent or theme of the changes.
- Then list the key changes as short bullet points grouped by type (features, fixes, refactoring, etc.).
- Keep the total summary under 15 bullets.
- Do not quote or repeat raw diff hunks.
- Use plain markdown (bullets, inline code spans). No extra headers needed.
- If the diff is empty or the working tree is clean, say so briefly.`
const GIT_COMMIT_MSG_SYSTEM_PROMPT = `You are a developer assistant that writes git commit messages.

Rules:
- Return ONLY the commit message text - no preamble, no explanation, no markdown fences.
- First line: imperative mood subject, 72 characters max.
- If the changes warrant it, add a blank line then a short body.
- Do not mention file names unless essential for clarity.
- If the diff is empty or the working tree is clean, say so in one sentence instead.`
const SECRET_SCAN_SYSTEM_PROMPT = `You review notes for likely secrets and credentials.

Rules:
- Return compact JSON only.
- Do not repeat complete secret values.
- Prefer provider-specific credentials, API keys, tokens, private keys, passwords, database URLs, and cloud credentials.
- Ignore obvious placeholders, examples, and public identifiers.
- If uncertain, include the finding with severity "low".

Return:
{
  "matches": [
    {
      "label": "short credential type",
      "severity": "high|medium|low",
      "redacted": "first4***last2",
      "reason": "short reason"
    }
  ]
}`

function agentHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export async function getLLMStatus(token) {
  try {
    const res = await fetch(`${AGENT_BASE}/ollama/status`, {
      headers: agentHeaders(token),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { available: false }
    return res.json()
  } catch {
    return { available: false }
  }
}

export async function getLLMModels(token) {
  const res = await fetch(`${AGENT_BASE}/ollama/models`, {
    headers: agentHeaders(token),
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error('Could not load models')
  return res.json()
}

export async function getOllamaEmbeddings({ token, model, input }) {
  const res = await fetch(`${AGENT_BASE}/ollama/embed`, {
    method: 'POST',
    headers: agentHeaders(token),
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(65000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Could not generate embeddings')
  return data.embeddings ?? []
}

function buildSystemContent(context = '', contextMode = '', promptOverrides = {}) {
  const ctx = context?.trim() ?? ''
  if (contextMode === 'regex') return buildNibPrompt(promptOverrides, 'system.regex', { context: ctx })
  if (contextMode === 'sqlite') return buildNibPrompt(promptOverrides, 'system.sqlite', { context: ctx })
  if (contextMode === 'search') return buildNibPrompt(promptOverrides, 'system.search', { context: ctx })
  if (contextMode === 'search-rerank') return buildNibPrompt(promptOverrides, 'system.searchRerank', { context: ctx })
  if (contextMode === 'all') return ctx
    ? buildNibPrompt(promptOverrides, 'system.all', { context: ctx })
    : buildNibPrompt(promptOverrides, 'system.empty')
  if (contextMode === 'selection') return ctx
    ? buildNibPrompt(promptOverrides, 'system.selection', { context: ctx })
    : buildNibPrompt(promptOverrides, 'system.empty')
  if (contextMode === 'git-summary') return buildNibPrompt(promptOverrides, 'system.gitSummary', { context: ctx })
  if (contextMode === 'git-commit-msg') return buildNibPrompt(promptOverrides, 'system.gitCommitMessage', { context: ctx })
  if (contextMode === 'secret-scan') return buildNibPrompt(promptOverrides, 'system.secretScan', { context: ctx })
  return ctx
    ? buildNibPrompt(promptOverrides, 'system.note', { context: ctx })
    : buildNibPrompt(promptOverrides, 'system.empty')
}

export function buildRemoteMessages(messages, context, contextMode, images = [], promptOverrides = {}) {
  const systemMessage = { role: 'system', content: buildSystemContent(context, contextMode, promptOverrides) }
  const normalizedMessages = (messages ?? []).map((message, index, list) => {
    if (!images.length || message.role !== 'user' || index !== list.length - 1) return message
    return {
      ...message,
      content: [
        { type: 'text', text: String(message.content ?? '') },
        ...images.map(image => ({
          type: 'image_url',
          image_url: { url: image.dataUrl },
        })),
      ],
    }
  })
  return [systemMessage, ...normalizedMessages]
}

async function streamRemoteChat({ messages, context, contextMode, images = [], promptOverrides = {} }, onChunk, onDone, onError) {
  const baseUrl = (localStorage.getItem(KEY_REMOTE_BASE_URL) || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
  const apiKey = localStorage.getItem(KEY_REMOTE_API_KEY) || ''
  const activeModel = localStorage.getItem(KEY_REMOTE_MODEL) || ''

  if (!apiKey.trim()) { onError('Remote LLM API key is missing. Add it in Settings.'); return }
  if (!activeModel.trim()) { onError('Remote LLM model is missing. Add it in Settings.'); return }

  let res
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': 'https://jotit.local',
        'X-Title': 'JotIt',
      },
      body: JSON.stringify({
        model: activeModel.trim(),
        messages: buildRemoteMessages(messages, context, contextMode, images, promptOverrides),
        stream: true,
      }),
    })
  } catch (err) {
    onError(err.message ?? 'Could not reach remote LLM provider')
    return
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null)
    onError(data?.error?.message ?? data?.error ?? `Remote LLM error: ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') { onDone(); return }
        try {
          const parsed = JSON.parse(payload)
          const token = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? ''
          if (token) onChunk(token)
        } catch {}
      }
    }
  } catch (err) {
    onError(err.message ?? 'Remote stream interrupted')
    return
  }

  onDone()
}

export async function streamLLMChat({ token, model, messages, context, contextMode, images = [] }, onChunk, onDone, onError) {
  const provider = localStorage.getItem(KEY_PROVIDER) || 'ollama'
  const promptOverrides = getNibPromptOverrides(loadSettings())
  if (provider !== 'ollama') {
    return streamRemoteChat({ messages, context, contextMode, images, promptOverrides }, onChunk, onDone, onError)
  }

  const activeModel = model || localStorage.getItem(KEY_MODEL)
  let res
  try {
    res = await fetch(`${AGENT_BASE}/ollama/chat`, {
      method: 'POST',
      headers: agentHeaders(token),
      body: JSON.stringify({ model: activeModel, messages, context, contextMode, promptOverrides }),
    })
  } catch (err) {
    onError(err.message ?? 'Could not reach jotit-agent')
    return
  }

  if (!res.ok) {
    onError(`Agent error: ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          onDone()
          return
        }
        try {
          const parsed = JSON.parse(payload)
          if (parsed.error) { onError(parsed.error); return }
          if (parsed.token) onChunk(parsed.token)
        } catch {}
      }
    }
  } catch (err) {
    onError(err.message ?? 'Stream interrupted')
    return
  }

  onDone()
}
