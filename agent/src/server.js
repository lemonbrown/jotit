import crypto from 'node:crypto'
import { exec } from 'node:child_process'
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
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024
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

app.listen(PORT, HOST, () => {
  console.log(`[jotit-agent] listening on http://${HOST}:${PORT}`)
  console.log(`[jotit-agent] token: ${token}`)
  console.log(`[jotit-agent] config: ${CONFIG_PATH}`)
  console.log('[jotit-agent] paste this token into jot.it Settings -> Local Agent Token')
})
