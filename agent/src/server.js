import crypto from 'node:crypto'
import { exec, execFile } from 'node:child_process'
import express from 'express'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'

const HOST = '127.0.0.1'
const PORT = 3210
const TOKEN_ENV = 'JOTIT_AGENT_TOKEN'
const CONFIG_PATH = path.join(os.homedir(), '.jotit-agent.json')
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024
const MAX_RESPONSE_BODY_BYTES = 25 * 1024 * 1024
const MAX_SHELL_OUTPUT_BYTES = 512 * 1024
const MAX_TIMEOUT_MS = 30000
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_REDIRECTS = 5
const HOP_BY_HOP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding'])
const IS_WINDOWS = process.platform === 'win32'

function resolveShell(lang) {
  const l = String(lang ?? '').toLowerCase()
  if (l === 'powershell' || l === 'pwsh') return IS_WINDOWS ? 'powershell.exe' : 'pwsh'
  if (l === 'cmd') return IS_WINDOWS ? 'cmd.exe' : '/bin/sh'
  return IS_WINDOWS ? 'powershell.exe' : '/bin/bash'
}
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function loadOrCreateToken() {
  const envToken = process.env[TOKEN_ENV]?.trim()
  if (envToken) return envToken

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      if (parsed?.token) return String(parsed.token)
    }
  } catch {}

  const token = crypto.randomBytes(24).toString('hex')
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ token }, null, 2), 'utf8')
  } catch {}
  return token
}

function readAgentConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {}
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveAgentConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  } catch {}
}

function getGitConfig() {
  const config = readAgentConfig()
  return {
    ...config,
    git: {
      defaultRepoId: config.git?.defaultRepoId ?? null,
      repos: config.git?.repos && typeof config.git.repos === 'object' ? config.git.repos : {},
    },
  }
}

function saveGitConfig(nextGit) {
  const config = readAgentConfig()
  saveAgentConfig({ ...config, git: nextGit })
}

function runGit(args, cwd, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      timeout: Math.min(timeoutMs, MAX_TIMEOUT_MS),
      maxBuffer: MAX_SHELL_OUTPUT_BYTES * 4,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(String(stderr || stdout || error.message || 'git failed').trim())
        err.exitCode = typeof error.code === 'number' ? error.code : 1
        reject(err)
        return
      }
      resolve(String(stdout ?? '').trimEnd())
    })
  })
}

function repoIdFromPath(repoPath, existingRepos = {}) {
  const name = path.basename(repoPath).replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/-+/g, '-')
  const base = name || 'repo'
  const hash = crypto.createHash('sha1').update(repoPath.toLowerCase()).digest('hex').slice(0, 6)
  const existing = existingRepos[base]
  if (!existing || path.resolve(existing.path) === path.resolve(repoPath)) return base
  return `${base}-${hash}`
}

function resolveRegisteredRepo(repoId) {
  const config = getGitConfig()
  const repo = config.git.repos[repoId]
  if (!repo) return { config, repo: null }
  return { config, repo }
}

async function readRepoInfo(repoPath, existingRepos = {}) {
  const resolvedInput = path.resolve(String(repoPath ?? '').trim())
  if (!resolvedInput || !fs.existsSync(resolvedInput)) {
    throw new Error('Repo path does not exist')
  }
  const stat = fs.statSync(resolvedInput)
  if (!stat.isDirectory()) throw new Error('Repo path must be a directory')

  const root = await runGit(['rev-parse', '--show-toplevel'], resolvedInput)
  if (!root) throw new Error('Not a git repository')
  const resolvedRoot = path.resolve(root)
  const branch = await runGit(['branch', '--show-current'], resolvedRoot).catch(() => '')
  const remotesText = await runGit(['remote'], resolvedRoot).catch(() => '')
  const remotes = remotesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const baseBranch = await runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], resolvedRoot)
    .then(value => value.replace(/^origin\//, ''))
    .catch(() => 'main')
  const id = repoIdFromPath(resolvedRoot, existingRepos)
  return {
    id,
    name: path.basename(resolvedRoot),
    displayName: path.basename(resolvedRoot),
    path: resolvedRoot,
    branch: branch || '(detached)',
    baseBranch,
    remote: remotes[0] ?? null,
    remotes,
    lastSeenAt: Date.now(),
  }
}

function normalizeHeaders(headers) {
  const normalized = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    const lower = String(key ?? '').toLowerCase().trim()
    if (!lower || HOP_BY_HOP_HEADERS.has(lower)) continue
    normalized[lower] = String(value ?? '')
  }
  return normalized
}

function clampTimeout(timeoutMs) {
  const parsed = Number(timeoutMs)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(parsed, MAX_TIMEOUT_MS)
}

function isLikelyBinary(contentType = '') {
  const normalized = String(contentType).toLowerCase()
  if (!normalized) return false
  return !(
    normalized.includes('json') ||
    normalized.includes('xml') ||
    normalized.includes('html') ||
    normalized.startsWith('text/') ||
    normalized.includes('javascript') ||
    normalized.includes('x-www-form-urlencoded')
  )
}

function requireToken(token) {
  return function tokenGuard(req, res, next) {
    const header = req.headers.authorization ?? ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (bearer !== token) {
      return res.status(401).json({ error: 'Invalid local agent token' })
    }
    next()
  }
}

function isLoopbackHostname(hostname = '') {
  const normalized = String(hostname).toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function normalizeResponseHeaders(headers) {
  const normalized = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) normalized[key] = value.join(', ')
    else if (value != null) normalized[key] = String(value)
  }
  return normalized
}

function executeNodeRequest(url, { method, headers, body, timeoutMs, followRedirects }, redirectCount = DEFAULT_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const transport = isHttps ? https : http
    const req = transport.request(parsedUrl, {
      method,
      headers,
      rejectUnauthorized: !(isHttps && isLoopbackHostname(parsedUrl.hostname)),
    }, res => {
      if (
        followRedirects !== false &&
        redirectCount > 0 &&
        REDIRECT_STATUSES.has(res.statusCode ?? 0) &&
        res.headers.location
      ) {
        const redirectedUrl = new URL(res.headers.location, parsedUrl).toString()
        res.resume()
        resolve(executeNodeRequest(redirectedUrl, { method, headers, body, timeoutMs, followRedirects }, redirectCount - 1))
        return
      }

      const chunks = []
      let size = 0

      res.on('data', chunk => {
        size += chunk.length
        if (size > MAX_RESPONSE_BODY_BYTES) {
          req.destroy(new Error('Response body exceeds size limit'))
          return
        }
        chunks.push(chunk)
      })

      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          headers: normalizeResponseHeaders(res.headers),
          bodyBuffer: Buffer.concat(chunks),
        })
      })
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }))
    })

    req.on('error', reject)

    if (body && !['GET', 'HEAD'].includes(method)) {
      req.write(body)
    }

    req.end()
  })
}

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '')
const REGEX_SYSTEM_PROMPT = `You are a JavaScript regular expression expert. Your job is to write, fix, and explain regular expressions for JotIt's browser regex tester.

Rules:
- Return a JavaScript RegExp-compatible pattern.
- Put the regex on its own first line in this exact format: /pattern/flags
- Use only these flags when needed: g, i, m, s.
- Do not stack quantifiers. For example, never write \\s*{3}; write (?:\\s*...){3} or another valid grouped form.
- Prefer non-capturing groups unless the captured value is intentionally useful.
- If JavaScript regex cannot match only the desired subpart, return a valid regex that captures the desired value and explain which capture group to use.
- Always provide a working regex. Do not ask clarifying questions. Make a reasonable assumption and note it briefly.

Example for "every 3rd word":
/(?:\\b\\w+\\b\\W+){2}(\\b\\w+\\b)/g
This matches each three-word span and captures the third word in group 1.`
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
- Return ONLY the commit message text — no preamble, no explanation, no markdown fences.
- First line: imperative mood subject, 72 characters max (e.g. "Add login rate limiting").
- If the changes warrant it, add a blank line then a short body (bullet points or prose, ≤5 lines).
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

function renderPromptTemplate(template, variables = {}) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = variables[key]
    return value == null ? '' : String(value)
  }).trim()
}

function promptOverride(promptOverrides, id, variables = {}) {
  const template = promptOverrides && typeof promptOverrides === 'object' ? promptOverrides[id] : ''
  return typeof template === 'string' && template.trim() ? renderPromptTemplate(template, variables) : ''
}

const token = loadOrCreateToken()
const app = express()

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204)
  }
  next()
})

app.use(express.json({ limit: `${MAX_REQUEST_BODY_BYTES}b` }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'jotit-agent', port: PORT })
})

app.post('/execute', requireToken(token), async (req, res) => {
  const startedAt = Date.now()
  const { method, url, headers, body, timeoutMs, followRedirects } = req.body ?? {}

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' })
  }

  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only http and https URLs are supported' })
  }

  const normalizedMethod = String(method ?? 'GET').toUpperCase()
  const normalizedHeaders = normalizeHeaders(headers)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), clampTimeout(timeoutMs))

  try {
    const response = await executeNodeRequest(url, {
      method: normalizedMethod,
      headers: normalizedHeaders,
      body: body && !['GET', 'HEAD'].includes(normalizedMethod) ? body : undefined,
      timeoutMs: clampTimeout(timeoutMs),
      followRedirects,
    })

    const contentType = response.headers['content-type'] ?? ''
    const contentLength = Number(response.headers['content-length'] ?? '0') || 0
    if (contentLength > MAX_RESPONSE_BODY_BYTES) {
      return res.status(413).json({ error: 'Response body exceeds size limit' })
    }

    const size = response.bodyBuffer.byteLength
    if (size > MAX_RESPONSE_BODY_BYTES) {
      return res.status(413).json({ error: 'Response body exceeds size limit' })
    }

    const isBinary = isLikelyBinary(contentType)
    const payload = {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      contentType,
      elapsed: Date.now() - startedAt,
      size,
      isBinary,
    }

    if (isBinary) {
      payload.bodyBase64 = response.bodyBuffer.toString('base64')
    } else {
      payload.body = response.bodyBuffer.toString('utf8')
    }

    res.json(payload)
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'Request timed out' })
    }
    res.status(502).json({ error: error.message ?? 'Request failed' })
  } finally {
    clearTimeout(timeout)
  }
})

app.post('/shell', requireToken(token), (req, res) => {
  const startedAt = Date.now()
  const { command, cwd, timeoutMs, lang } = req.body ?? {}

  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ error: 'command is required' })
  }

  const resolvedCwd = (typeof cwd === 'string' && cwd.trim()) ? cwd.trim() : os.homedir()
  const resolvedTimeout = clampTimeout(timeoutMs)

  exec(command.trim(), {
    cwd: resolvedCwd,
    timeout: resolvedTimeout,
    maxBuffer: MAX_SHELL_OUTPUT_BYTES * 2,
    shell: resolveShell(lang),
  }, (error, stdout, stderr) => {
    const elapsed = Date.now() - startedAt
    const timedOut = error?.killed === true
    const exitCode = error == null ? 0 : (typeof error.code === 'number' ? error.code : 1)
    res.json({
      ok: error == null,
      exitCode,
      stdout: String(stdout ?? '').slice(0, MAX_SHELL_OUTPUT_BYTES),
      stderr: String(stderr ?? '').slice(0, MAX_SHELL_OUTPUT_BYTES),
      elapsed,
      timedOut,
    })
  })
})

app.post('/git/connect', requireToken(token), async (req, res) => {
  const { path: repoPath } = req.body ?? {}
  if (!repoPath || typeof repoPath !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }

  try {
    const config = getGitConfig()
    const repo = await readRepoInfo(repoPath, config.git.repos)
    const repos = { ...config.git.repos, [repo.id]: repo }
    const git = { ...config.git, repos }
    saveGitConfig(git)
    res.json({ ok: true, repo })
  } catch (error) {
    res.status(400).json({ error: error.message ?? 'Could not connect repo' })
  }
})

app.get('/git/repos', requireToken(token), async (_req, res) => {
  const config = getGitConfig()
  const repos = Object.values(config.git.repos)
  res.json({ ok: true, defaultRepoId: config.git.defaultRepoId, repos })
})

app.post('/git/use', requireToken(token), (req, res) => {
  const { repoId, setDefault } = req.body ?? {}
  const config = getGitConfig()
  const repo = config.git.repos[String(repoId ?? '')]
  if (!repo) return res.status(404).json({ error: 'Repo not found' })
  const git = setDefault ? { ...config.git, defaultRepoId: repo.id } : config.git
  if (setDefault) saveGitConfig(git)
  res.json({ ok: true, repo, defaultRepoId: git.defaultRepoId })
})

app.get('/git/status', requireToken(token), async (req, res) => {
  const repoId = String(req.query.repoId ?? '')
  const { repo } = resolveRegisteredRepo(repoId)
  if (!repo) return res.status(404).json({ error: 'Repo not found' })

  try {
    const branch = await runGit(['branch', '--show-current'], repo.path).catch(() => repo.branch)
    const statusText = await runGit(['status', '--short', '--branch'], repo.path)
    const porcelain = await runGit(['status', '--porcelain'], repo.path)
    res.json({
      ok: true,
      repo: { ...repo, branch: branch || repo.branch, lastSeenAt: Date.now() },
      dirty: Boolean(porcelain.trim()),
      status: statusText,
    })
  } catch (error) {
    res.status(500).json({ error: error.message ?? 'Could not read git status' })
  }
})

app.get('/git/diff', requireToken(token), async (req, res) => {
  const repoId = String(req.query.repoId ?? '')
  const { repo } = resolveRegisteredRepo(repoId)
  if (!repo) return res.status(404).json({ error: 'Repo not found' })

  try {
    const [stat, numstat, patch] = await Promise.all([
      runGit(['diff', '--stat'], repo.path),
      runGit(['diff', '--numstat'], repo.path),
      runGit(['diff', '--', '.'], repo.path),
    ])
    res.json({ ok: true, repo, stat, numstat, diff: patch.slice(0, MAX_SHELL_OUTPUT_BYTES) })
  } catch (error) {
    res.status(500).json({ error: error.message ?? 'Could not read git diff' })
  }
})

app.get('/git/pr', requireToken(token), async (req, res) => {
  const repoId = String(req.query.repoId ?? '')
  const prNumber = Number(req.query.number)
  const base = String(req.query.base ?? '').trim()

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return res.status(400).json({ error: 'PR number must be a positive integer' })
  }

  const { repo } = resolveRegisteredRepo(repoId)
  if (!repo) return res.status(404).json({ error: 'Repo not found' })

  const baseBranch = base || repo.baseBranch || 'main'
  const prRef = `refs/pull/${prNumber}/head`

  try {
    await runGit(['fetch', 'origin', prRef], repo.path, 25000)

    const [log, stat, numstat, diff] = await Promise.all([
      runGit(['log', `${baseBranch}...FETCH_HEAD`, '--oneline', '--no-merges'], repo.path),
      runGit(['diff', '--stat', `${baseBranch}...FETCH_HEAD`], repo.path),
      runGit(['diff', '--numstat', `${baseBranch}...FETCH_HEAD`], repo.path),
      runGit(['diff', `${baseBranch}...FETCH_HEAD`], repo.path),
    ])

    res.json({
      ok: true,
      repo,
      prNumber,
      base: baseBranch,
      log,
      stat,
      numstat,
      diff: diff.slice(0, MAX_SHELL_OUTPUT_BYTES),
    })
  } catch (error) {
    res.status(500).json({ error: error.message ?? 'Could not fetch PR' })
  }
})

app.get('/ollama/status', requireToken(token), async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return res.json({ available: false, baseUrl: OLLAMA_BASE_URL })
    res.json({ available: true, baseUrl: OLLAMA_BASE_URL })
  } catch {
    res.json({ available: false, baseUrl: OLLAMA_BASE_URL })
  }
})

app.get('/ollama/models', requireToken(token), async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return res.status(502).json({ error: 'Ollama returned an error' })
    const data = await response.json()
    res.json({ models: data.models ?? [] })
  } catch (err) {
    res.status(502).json({ error: err.message ?? 'Could not reach Ollama' })
  }
})

app.post('/ollama/embed', requireToken(token), async (req, res) => {
  const { model, input } = req.body ?? {}

  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: 'model is required' })
  }
  if (!input || (typeof input !== 'string' && !Array.isArray(input))) {
    return res.status(400).json({ error: 'input must be a string or array of strings' })
  }

  try {
    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(60000),
    })

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text().catch(() => 'unknown error')
      return res.status(502).json({ error: text })
    }

    const data = await ollamaRes.json()
    res.json({ embeddings: data.embeddings ?? [] })
  } catch (err) {
    res.status(502).json({ error: err.message ?? 'Could not reach Ollama' })
  }
})

app.post('/ollama/chat', requireToken(token), async (req, res) => {
  const { model, messages, context, contextMode, promptOverrides } = req.body ?? {}

  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: 'model is required' })
  }
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' })
  }

  const ctx = context?.trim() ?? ''
  let systemContent
  if (contextMode === 'regex') {
    systemContent = promptOverride(promptOverrides, 'system.regex', { context: ctx }) || `${REGEX_SYSTEM_PROMPT}\n\n${ctx ? `Current regex state:\n${ctx}` : ''}`
  } else if (contextMode === 'sqlite') {
    systemContent = promptOverride(promptOverrides, 'system.sqlite', { context: ctx }) || `${SQLITE_SYSTEM_PROMPT}\n\n${ctx ? `Database context:\n${ctx}` : ''}`
  } else if (contextMode === 'search') {
    systemContent = promptOverride(promptOverrides, 'system.search', { context: ctx }) || `${SEARCH_PLAN_SYSTEM_PROMPT}\n\n${ctx ? `Search context:\n${ctx}` : ''}`
  } else if (contextMode === 'search-rerank') {
    systemContent = promptOverride(promptOverrides, 'system.searchRerank', { context: ctx }) || `${SEARCH_RERANK_SYSTEM_PROMPT}\n\n${ctx ? `Candidate context:\n${ctx}` : ''}`
  } else if (contextMode === 'all') {
    systemContent = ctx
      ? promptOverride(promptOverrides, 'system.all', { context: ctx }) || `You are a helpful assistant. The user has the following notes in their workspace:\n\n${ctx}\n\nAnswer questions about these notes concisely.`
      : promptOverride(promptOverrides, 'system.empty') || 'You are a helpful assistant.'
  } else if (contextMode === 'selection') {
    systemContent = ctx
      ? promptOverride(promptOverrides, 'system.selection', { context: ctx }) || `You are a helpful assistant. The user has selected the following text from a note:\n\n${ctx}\n\nAnswer questions about this selection concisely.`
      : promptOverride(promptOverrides, 'system.empty') || 'You are a helpful assistant.'
  } else if (contextMode === 'git-summary') {
    systemContent = ctx
      ? promptOverride(promptOverrides, 'system.gitSummary', { context: ctx }) || `${GIT_SUMMARY_SYSTEM_PROMPT}\n\nGit context:\n${ctx}`
      : promptOverride(promptOverrides, 'system.gitSummary', { context: '' }) || GIT_SUMMARY_SYSTEM_PROMPT
  } else if (contextMode === 'git-commit-msg') {
    systemContent = ctx
      ? promptOverride(promptOverrides, 'system.gitCommitMessage', { context: ctx }) || `${GIT_COMMIT_MSG_SYSTEM_PROMPT}\n\nGit context:\n${ctx}`
      : promptOverride(promptOverrides, 'system.gitCommitMessage', { context: '' }) || GIT_COMMIT_MSG_SYSTEM_PROMPT
  } else if (contextMode === 'secret-scan') {
    systemContent = ctx
      ? promptOverride(promptOverrides, 'system.secretScan', { context: ctx }) || `${SECRET_SCAN_SYSTEM_PROMPT}\n\nNote content:\n${ctx}`
      : promptOverride(promptOverrides, 'system.secretScan', { context: '' }) || SECRET_SCAN_SYSTEM_PROMPT
  } else {
    systemContent = ctx
      ? promptOverride(promptOverrides, 'system.note', { context: ctx }) || `You are a helpful assistant. The user is working on a note.\n\nNote:\n---\n${ctx}\n---\n\nAnswer questions about this note concisely. If the note doesn't contain relevant information, say so.`
      : promptOverride(promptOverrides, 'system.empty') || 'You are a helpful assistant.'
  }

  const systemMessage = { role: 'system', content: systemContent }

  const fullMessages = [systemMessage, ...messages]

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  let ollamaRes
  try {
    ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: fullMessages, stream: true }),
      signal: AbortSignal.timeout(120000),
    })
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message ?? 'Could not reach Ollama' })}\n\n`)
    return res.end()
  }

  if (!ollamaRes.ok) {
    const text = await ollamaRes.text().catch(() => 'unknown error')
    res.write(`data: ${JSON.stringify({ error: text })}\n\n`)
    return res.end()
  }

  const decoder = new TextDecoder()
  const reader = ollamaRes.body.getReader()

  const cleanup = () => reader.cancel().catch(() => {})
  req.on('close', cleanup)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          const token = parsed?.message?.content ?? ''
          if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`)
          if (parsed?.done) {
            res.write('data: [DONE]\n\n')
            return res.end()
          }
        } catch {}
      }
    }
  } catch {}

  res.write('data: [DONE]\n\n')
  res.end()
})

app.listen(PORT, HOST, () => {
  console.log(`[jotit-agent] listening on http://${HOST}:${PORT}`)
  console.log(`[jotit-agent] token: ${token}`)
  console.log(`[jotit-agent] config: ${CONFIG_PATH}`)
  console.log('[jotit-agent] paste this token into jot.it Settings -> Local Agent Token')
})
