export const TRANSFORMS = [
  { id: 'base64e',   label: 'Base64 ↑',   title: 'Base64 Encode' },
  { id: 'base64d',   label: 'Base64 ↓',   title: 'Base64 Decode' },
  { id: 'urld',      label: 'URL ↓',       title: 'URL Decode' },
  { id: 'jwt',       label: 'JWT ↓',       title: 'JWT Decode + Expiry Check' },
  { id: 'json',      label: 'JSON {}',     title: 'Prettify JSON' },
  { id: 'hex2asc',   label: 'Hex→ASCII',   title: 'Hex to ASCII' },
  { id: 'asc2hex',   label: 'ASCII→Hex',   title: 'ASCII to Hex' },
  { id: 'htmld',     label: 'HTML ↓',      title: 'HTML Entity Decode' },
  { id: 'unicode',   label: 'Unicode ↓',   title: 'Unicode Escape Decode (\\uXXXX, \\u{X}, &#x;)' },
  { id: 'qs',        label: 'QS→{}',       title: 'Query String → Object' },
  { id: 'csv2json',  label: 'CSV→JSON',    title: 'CSV to JSON Array' },
  { id: 'toSnake',   label: '→snake',      title: 'Convert to snake_case' },
  { id: 'toCamel',   label: '→camel',      title: 'Convert to camelCase' },
  { id: 'toPascal',  label: '→Pascal',     title: 'Convert to PascalCase' },
  { id: 'logfmt',    label: 'logfmt',      title: 'Parse Log Line' },
  { id: 'guidval',   label: 'GUID?',       title: 'Validate GUID / UUID' },
  { id: 'guidstrip', label: 'GUID bare',   title: 'GUID Strip Formatting (→ bare hex)' },
  { id: 'guidfmt',   label: 'GUID fmt',    title: 'GUID Format (add dashes)' },
  { id: 'jsonpath',  label: 'JSON→',       title: 'Extract JSON path', interactive: true },
]

function parsePathSegments(path) {
  const cleaned = path.trim().replace(/^\$?\.?/, '')
  const segments = []
  let rem = cleaned
  while (rem) {
    const bracket = rem.match(/^\[(\d*)\]\.?/)
    if (bracket) {
      segments.push(bracket[1] === '' ? '[]' : bracket[1])
      rem = rem.slice(bracket[0].length)
      continue
    }
    const dot = rem.match(/^([^.[]+)\.?/)
    if (dot) {
      segments.push(dot[1])
      rem = rem.slice(dot[0].length)
      continue
    }
    break
  }
  return segments
}

function walkPath(data, segments) {
  if (segments.length === 0) return [data]
  const [head, ...rest] = segments
  if (head === '[]') {
    if (!Array.isArray(data)) throw new Error(`Expected array, got ${typeof data}`)
    return data.flatMap(item => walkPath(item, rest))
  }
  if (/^\d+$/.test(head)) {
    if (!Array.isArray(data)) throw new Error(`Expected array for index [${head}]`)
    const item = data[parseInt(head)]
    if (item === undefined) throw new Error(`Index [${head}] out of bounds (length ${data.length})`)
    return walkPath(item, rest)
  }
  if (typeof data !== 'object' || data === null) throw new Error(`Cannot access .${head} on ${typeof data}`)
  if (!(head in data)) throw new Error(`.${head} not found`)
  return walkPath(data[head], rest)
}

export function applyTransform(id, input, param = '') {
  switch (id) {
    case 'base64e': {
      try { return btoa(input) }
      catch { throw new Error('Cannot encode — contains non-Latin1 characters (try UTF-8 first)') }
    }

    case 'base64d': {
      try {
        const decoded = atob(input.trim())
        try { return JSON.stringify(JSON.parse(decoded), null, 2) } catch { return decoded }
      } catch {
        throw new Error('Invalid Base64')
      }
    }

    case 'urld': {
      try {
        return decodeURIComponent(input.trim())
      } catch {
        // eslint-disable-next-line no-undef
        try { return unescape(input.trim()) } catch { throw new Error('Invalid URL encoding') }
      }
    }

    case 'jwt': {
      const parts = input.trim().split('.')
      if (parts.length < 2 || parts.length > 3) throw new Error('Not a valid JWT (expected header.payload.signature)')
      const decodeB64url = (str) => {
        const padded = str + '='.repeat((4 - str.length % 4) % 4)
        const bytes = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
        try { return JSON.parse(bytes) } catch { return bytes }
      }
      const header  = decodeB64url(parts[0])
      const payload = decodeB64url(parts[1])
      const sig     = parts[2] ?? '(none)'
      let expiryBlock = ''
      if (payload && typeof payload === 'object' && payload.exp) {
        const exp = new Date(payload.exp * 1000)
        const now = new Date()
        const expired = exp < now
        const diff = Math.abs(exp.getTime() - now.getTime())
        const totalMins = Math.floor(diff / 60000)
        const days = Math.floor(totalMins / 1440)
        const hours = Math.floor((totalMins % 1440) / 60)
        const mins = totalMins % 60
        const parts = []
        if (days)  parts.push(`${days}d`)
        if (hours) parts.push(`${hours}h`)
        parts.push(`${mins}m`)
        const timeStr = parts.join(' ')
        expiryBlock = `\n\n── EXPIRY ──\n${exp.toISOString()}\n${expired ? `⚠ EXPIRED ${timeStr} ago` : `✓ Valid — expires in ${timeStr}`}`
        if (payload.iat) {
          expiryBlock += `\nIssued: ${new Date(payload.iat * 1000).toISOString()}`
        }
        if (payload.nbf) {
          const nbf = new Date(payload.nbf * 1000)
          expiryBlock += `\nNot before: ${nbf.toISOString()}${now < nbf ? ' ⚠ NOT YET VALID' : ''}`
        }
      }
      return `── HEADER ──\n${JSON.stringify(header, null, 2)}\n\n── PAYLOAD ──\n${JSON.stringify(payload, null, 2)}${expiryBlock}\n\n── SIGNATURE ──\n${sig}`
    }

    case 'json': {
      try { return JSON.stringify(JSON.parse(input.trim()), null, 2) }
      catch { throw new Error('Invalid JSON') }
    }

    case 'hex2asc': {
      const raw = input.trim()
      // Space-separated bytes: "48 65 6c 6c 6f"
      const spaced = raw.split(/\s+/)
      if (spaced.length > 1 && spaced.every(h => /^[0-9a-fA-F]{1,2}$/.test(h))) {
        return spaced.map(h => String.fromCharCode(parseInt(h, 16))).join('')
      }
      // Continuous hex: "48656c6c6f" or "0x48656c6c6f"
      const cont = raw.replace(/^0x/i, '').replace(/\s/g, '')
      if (/^[0-9a-fA-F]+$/.test(cont) && cont.length % 2 === 0) {
        const chars = []
        for (let i = 0; i < cont.length; i += 2)
          chars.push(String.fromCharCode(parseInt(cont.slice(i, i + 2), 16)))
        return chars.join('')
      }
      throw new Error('Invalid hex — use "48 65 6c" or "48656c"')
    }

    case 'asc2hex': {
      return Array.from(input)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(' ')
    }

    case 'htmld': {
      const doc = new DOMParser().parseFromString(input, 'text/html')
      return doc.documentElement.textContent ?? input
    }

    case 'unicode': {
      return input
        .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, cp) => String.fromCodePoint(parseInt(cp, 16)))
        .replace(/\\u([0-9a-fA-F]{4})/g,    (_, c)  => String.fromCharCode(parseInt(c, 16)))
        .replace(/\\U([0-9a-fA-F]{8})/g,    (_, cp) => String.fromCodePoint(parseInt(cp, 16)))
        .replace(/&#x([0-9a-fA-F]+);/g,     (_, cp) => String.fromCodePoint(parseInt(cp, 16)))
        .replace(/&#([0-9]+);/g,            (_, n)  => String.fromCodePoint(parseInt(n, 10)))
    }

    case 'qs': {
      const t = input.trim().replace(/^\?/, '').replace(/^[^?]*\?/, '')
      if (!t) throw new Error('No query string found')
      const obj = {}
      for (const [k, v] of new URLSearchParams(t)) {
        if (k in obj) {
          obj[k] = Array.isArray(obj[k]) ? [...obj[k], v] : [obj[k], v]
        } else {
          obj[k] = v
        }
      }
      return JSON.stringify(obj, null, 2)
    }

    case 'csv2json': {
      const lines = input.trim().split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) throw new Error('Need at least a header row and one data row')
      const parseRow = (line) => {
        const result = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
          const c = line[i]
          if (c === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
            else inQuotes = !inQuotes
          } else if (c === ',' && !inQuotes) {
            result.push(current)
            current = ''
          } else {
            current += c
          }
        }
        result.push(current)
        return result
      }
      const headers = parseRow(lines[0])
      const rows = lines.slice(1).map(line => {
        const vals = parseRow(line)
        const obj = {}
        headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim() })
        return obj
      })
      return JSON.stringify(rows, null, 2)
    }

    case 'toSnake':
    case 'toCamel':
    case 'toPascal': {
      const toWords = (str) =>
        str
          .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
          .replace(/([a-z\d])([A-Z])/g, '$1 $2')
          .replace(/[-_\s]+/g, ' ')
          .trim()
          .toLowerCase()
          .split(' ')
          .filter(Boolean)
      const convertLine = (line) => {
        const words = toWords(line)
        if (!words.length) return line
        if (id === 'toSnake') return words.join('_')
        if (id === 'toCamel') return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join('')
        return words.map(w => w[0].toUpperCase() + w.slice(1)).join('')
      }
      return input.split('\n').map(convertLine).join('\n')
    }

    case 'logfmt': {
      const t = input.trim()
      // JSON log line
      if (t.startsWith('{')) {
        try {
          const obj = JSON.parse(t)
          const ts = obj.time ?? obj.timestamp ?? obj.ts ?? obj['@timestamp'] ?? null
          const level = obj.level ?? obj.severity ?? obj.lvl ?? null
          const msg = obj.msg ?? obj.message ?? obj.text ?? null
          return JSON.stringify({ timestamp: ts, level, message: msg, ...obj }, null, 2)
        } catch {}
      }
      // ISO / RFC timestamp at the start
      const isoRe = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s*/
      const isoMatch = t.match(isoRe)
      let rest = isoMatch ? t.slice(isoMatch[0].length) : t
      const ts = isoMatch ? isoMatch[1] : null
      // Level: [INFO], INFO:, INFO |
      const levelMatch = rest.match(/^\[?(\w+)\]?[\s:|]\s*/)
      const level = levelMatch ? levelMatch[1].toUpperCase() : null
      if (levelMatch) rest = rest.slice(levelMatch[0].length)
      // key=value pairs in the remainder
      const kvPairs = {}
      const kvRe = /(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g
      let kv
      let msgCandidate = rest
      while ((kv = kvRe.exec(rest)) !== null) {
        kvPairs[kv[1]] = kv[2].replace(/^"|"$/g, '')
        msgCandidate = ''
      }
      const result = {
        timestamp: ts,
        level,
        message: msgCandidate.trim() || kvPairs.msg || kvPairs.message || null,
      }
      if (Object.keys(kvPairs).length) Object.assign(result, kvPairs)
      return JSON.stringify(result, null, 2)
    }

    case 'guidval': {
      const t = input.trim()
      const bare = t.replace(/[{}()\-\s]/g, '')
      const valid = /^[0-9a-fA-F]{32}$/.test(bare)
      if (!valid) {
        return `INVALID — not a GUID/UUID\n\nInput: "${t}"\nExpected 32 hex chars (with optional dashes/braces)`
      }
      const fmt = `${bare.slice(0,8)}-${bare.slice(8,12)}-${bare.slice(12,16)}-${bare.slice(16,20)}-${bare.slice(20)}`
      const version = parseInt(bare[12], 16)
      const variantNib = parseInt(bare[16], 16)
      const variant = variantNib >= 0xe ? 'Reserved' : variantNib >= 0xc ? 'Microsoft (legacy)' : variantNib >= 0x8 ? 'RFC 4122' : 'NCS (legacy)'
      return `VALID ✓\n\nFormatted: ${fmt}\nUppercase: ${fmt.toUpperCase()}\nBare:      ${bare}\nVersion:   ${version}\nVariant:   ${variant}`
    }

    case 'guidstrip': {
      const bare = input.trim().replace(/[{}()\-\s]/g, '')
      if (!/^[0-9a-fA-F]{32}$/.test(bare)) throw new Error('Not a valid GUID (need 32 hex chars, with or without dashes)')
      return bare.toLowerCase()
    }

    case 'guidfmt': {
      const bare = input.trim().replace(/[{}()\-\s]/g, '')
      if (!/^[0-9a-fA-F]{32}$/.test(bare)) throw new Error('Not a valid GUID (need 32 hex chars)')
      return `${bare.slice(0,8)}-${bare.slice(8,12)}-${bare.slice(12,16)}-${bare.slice(16,20)}-${bare.slice(20)}`.toLowerCase()
    }

    case 'jsonpath': {
      let parsed
      try { parsed = JSON.parse(input.trim()) } catch (e) { throw new Error(`JSON parse error: ${e.message}`) }
      if (!param.trim()) throw new Error('Enter a path — e.g. .data.items[].title')
      const segments = parsePathSegments(param)
      const values = walkPath(parsed, segments)
      const out = values.length === 1 ? values[0] : values
      return typeof out === 'string' ? out : JSON.stringify(out, null, 2)
    }

    default:
      throw new Error(`Unknown transform: ${id}`)
  }
}
