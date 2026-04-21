/**
 * httpParser.js
 * Detects and parses HTTP requests written in a note as:
 *   1. curl command  (curl -X METHOD url -H "..." -d "...")
 *   2. HTTP block    (METHOD url\nHeaders\n\nbody)
 *   3. PowerShell    (Invoke-WebRequest / Invoke-RestMethod)
 *
 * Multi-request blocks separated by "###" are supported; returns an array.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function trimLines(str) {
  return str.replace(/\\\s*\n\s*/g, ' ').trim()
}

/** Remove surrounding quotes from a shell token */
function unquote(s) {
  s = s.trim()
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

/** Very small shell-token splitter — handles single/double-quoted strings */
function shellTokens(str) {
  const tokens = []
  let cur = ''
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue }
    if (c === ' ' && !inSingle && !inDouble) {
      if (cur) { tokens.push(cur); cur = '' }
      continue
    }
    cur += c
  }
  if (cur) tokens.push(cur)
  return tokens
}

// ── curl parser ───────────────────────────────────────────────────────────────

function parseCurl(raw) {
  // Join line continuations
  const flat = trimLines(raw)
  const tokens = shellTokens(flat)

  if (tokens[0]?.toLowerCase() !== 'curl') throw new Error('Not a curl command')

  let method = 'GET'
  let url = null
  const headers = {}
  let body = null

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '-X' || t === '--request') {
      method = tokens[++i]?.toUpperCase() ?? method
    } else if (t === '-H' || t === '--header') {
      const hdr = unquote(tokens[++i] ?? '')
      const colon = hdr.indexOf(':')
      if (colon > 0) {
        const key = hdr.slice(0, colon).trim()
        const val = hdr.slice(colon + 1).trim()
        headers[key] = val
      }
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-ascii') {
      body = unquote(tokens[++i] ?? '')
      if (method === 'GET') method = 'POST'
    } else if (t === '--data-urlencode') {
      const val = unquote(tokens[++i] ?? '')
      body = body ? body + '&' + val : val
      if (method === 'GET') method = 'POST'
    } else if (t === '-u' || t === '--user') {
      const creds = unquote(tokens[++i] ?? '')
      headers['Authorization'] = 'Basic ' + btoa(creds)
    } else if (t === '--json') {
      const val = unquote(tokens[++i] ?? '')
      body = val
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
      headers['Accept'] = headers['Accept'] ?? 'application/json'
      if (method === 'GET') method = 'POST'
    } else if (t === '-F' || t === '--form') {
      // Multipart — not truly executable in browser but parse for display
      const val = unquote(tokens[++i] ?? '')
      body = body ? body + '\n' + val : val
      headers['Content-Type'] = headers['Content-Type'] ?? 'multipart/form-data'
      if (method === 'GET') method = 'POST'
    } else if (t === '-G' || t === '--get') {
      method = 'GET'
    } else if (t === '-I' || t === '--head') {
      method = 'HEAD'
    } else if (t === '-k' || t === '--insecure' || t === '-L' || t === '--location'
            || t === '-s' || t === '--silent' || t === '-v' || t === '--verbose'
            || t === '-i' || t === '--include' || t === '-f' || t === '--fail'
            || t === '--compressed') {
      // Flags we acknowledge but don't act on
    } else if (t.startsWith('-')) {
      // Unknown flag — skip its argument if the next token doesn't look like a flag or URL
      const next = tokens[i + 1]
      if (next && !next.startsWith('-') && !next.startsWith('http')) i++
    } else if (!url && (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('/'))) {
      url = t
    } else if (!url) {
      // Bare word that's probably the URL (e.g. quoted URL already unquoted)
      url = t
    }
  }

  if (!url) throw new Error('No URL found in curl command')
  return { method, url, headers, body }
}

// ── HTTP block parser ─────────────────────────────────────────────────────────

const HTTP_METHODS = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','TRACE','CONNECT']

function parseHttpBlock(raw) {
  const lines = raw.split('\n')
  let i = 0

  // Skip blank lines / comments at top
  while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith('//'))) i++

  const firstLine = lines[i]?.trim() ?? ''
  if (!firstLine) throw new Error('Empty HTTP block')

  // First line: METHOD URL  or  URL (default GET)
  let method = 'GET'
  let url = ''
  const parts = firstLine.split(/\s+/)
  if (HTTP_METHODS.includes(parts[0].toUpperCase())) {
    method = parts[0].toUpperCase()
    url = parts.slice(1).join(' ')
  } else if (parts[0].startsWith('http')) {
    url = parts[0]
  } else {
    throw new Error(`Unrecognised first line: ${firstLine}`)
  }

  if (!url) throw new Error('No URL on first line')
  i++

  // Headers: lines until first blank
  const headers = {}
  while (i < lines.length && lines[i].trim() !== '') {
    const line = lines[i].trim()
    if (!line.startsWith('//') && !line.startsWith('#')) {
      const colon = line.indexOf(':')
      if (colon > 0) {
        headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
      }
    }
    i++
  }

  // Body: everything after the first blank line
  i++ // skip blank
  const body = lines.slice(i).join('\n').trimEnd() || null

  return { method, url, headers, body: body || null }
}

// ── PowerShell IWR / IRM parser ───────────────────────────────────────────────

function parsePowerShell(raw) {
  const flat = raw.replace(/`\s*\n\s*/g, ' ').trim()

  if (!/Invoke-(WebRequest|RestMethod)/i.test(flat)) {
    throw new Error('Not an Invoke-WebRequest / Invoke-RestMethod command')
  }

  const method = /-Method\s+(['"]?)(\w+)\1/i.exec(flat)?.[2]?.toUpperCase() ?? 'GET'

  const urlMatch = /-Uri\s+(['"]?)([^\s'"]+)\1/i.exec(flat)
  if (!urlMatch) throw new Error('No -Uri found')
  const url = urlMatch[2]

  const headers = {}
  // PowerShell hashtable: @{"Key"="Val"; "Key2"="Val2"}  or @{Key="Val"}
  const hdrBlock = /-Headers\s+@\{([^}]+)\}/i.exec(flat)?.[1]
  if (hdrBlock) {
    for (const pair of hdrBlock.split(';')) {
      const eq = pair.indexOf('=')
      if (eq > 0) {
        headers[unquote(pair.slice(0, eq).trim())] = unquote(pair.slice(eq + 1).trim())
      }
    }
  }

  const bodyMatch = /-Body\s+('[^']*'|"[^"]*"|\{[^}]*\})/i.exec(flat)
  const body = bodyMatch ? unquote(bodyMatch[1]) : null

  const ctMatch = /-ContentType\s+(['"]?)([^\s'"]+)\1/i.exec(flat)
  if (ctMatch) headers['Content-Type'] = ctMatch[2]

  return { method, url, headers, body }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the detected format: 'curl' | 'http' | 'ps' | null
 */
export function detectRequestType(content) {
  if (!content?.trim()) return null
  const t = content.trim()
  if (/^curl\s/i.test(t)) return 'curl'
  if (/Invoke-(WebRequest|RestMethod)/i.test(t)) return 'ps'
  const firstLine = t.split('\n')[0].trim()
  const parts = firstLine.split(/\s+/)
  if (HTTP_METHODS.includes(parts[0].toUpperCase()) && parts.length >= 2) return 'http'
  if (parts[0].startsWith('http://') || parts[0].startsWith('https://')) return 'http'
  return null
}

/**
 * Split note content on "###" separators and parse each block.
 * Returns an array of { method, url, headers, body, raw, error }.
 */
export function parseRequests(content) {
  if (!content?.trim()) return []

  // Split on ### separator (VS Code REST Client convention)
  const blocks = content.split(/^###[^\n]*\n?/m).map(b => b.trim()).filter(Boolean)

  return blocks.map(raw => {
    try {
      const type = detectRequestType(raw)
      if (!type) return { raw, error: 'Could not detect request format — expected curl, HTTP block, or Invoke-WebRequest' }
      let parsed
      if (type === 'curl') parsed = parseCurl(raw)
      else if (type === 'ps') parsed = parsePowerShell(raw)
      else parsed = parseHttpBlock(raw)
      return { ...parsed, raw, error: null }
    } catch (e) {
      return { raw, error: e.message ?? String(e) }
    }
  })
}
