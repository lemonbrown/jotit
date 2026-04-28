import YAML from 'yaml'

const MONTH_NUMS = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  january:1, february:2, march:3, april:4, june:6, july:7, august:8, september:9, october:10, november:11, december:12,
}

const FMT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function formatDateShort(date, showYear = false) {
  const base = `${FMT_MONTHS[date.getMonth()]} ${date.getDate()}`
  return showYear ? `${base} ${date.getFullYear()}` : base
}

const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS_LONG   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const ordinal = (n) => {
  if (n >= 11 && n <= 13) return `${n}th`
  const r = n % 10
  return `${n}${r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th'}`
}

export function getDateFormats(date) {
  const d = date.getDate(), mo = date.getMonth(), y = date.getFullYear()
  return [
    { label: 'readable', value: `${FMT_MONTHS[mo]} ${d}, ${y}` },
    { label: 'ISO',      value: `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` },
    { label: 'long',     value: `${DAYS_LONG[date.getDay()]}, ${MONTHS_LONG[mo]} ${ordinal(d)}` },
    { label: 'unix',     value: String(Math.floor(date.getTime() / 1000)) },
  ]
}

// Returns a Date if the text is a single date, null otherwise.
export function detectSingleDate(text) {
  const t = text.trim()
  if (!t) return null

  const dates = parseDates(t)
  if (dates.length === 1) {
    const m = dates[0]
    if (m.index <= 2 && m.index + m.text.length >= t.length - 2) return m.date
  }

  // MM/DD/YY (2-digit year — not covered by parseDates)
  const shortUs = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (shortUs) {
    const mo = +shortUs[1], d = +shortUs[2], y2 = +shortUs[3]
    const y = y2 < 50 ? 2000 + y2 : 1900 + y2
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(y, mo - 1, d)
  }

  // DD.MM.YYYY (European dot notation)
  const eu = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (eu) {
    const d = +eu[1], mo = +eu[2], y = +eu[3]
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(y, mo - 1, d)
  }

  return null
}

// --- Timezone conversion --------------------------------------------------------

const TZ_OFFSETS = {
  PST: -8, PDT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, EST: -5, EDT: -4,
  UTC: 0,  GMT: 0,  WET: 0,  BST: 1,  CET: 1,  CEST: 2, EET: 2,  MSK: 3,
  IST: 5.5, PKT: 5, ICT: 7, HKT: 8, SGT: 8, MYT: 8, AWST: 8,
  JST: 9, KST: 9, AEST: 10, AEDT: 11, NZST: 12, NZDT: 13,
}

const DISP_ZONES = [
  { label: 'Pacific', iana: 'America/Los_Angeles' },
  { label: 'Central', iana: 'America/Chicago' },
  { label: 'Eastern', iana: 'America/New_York' },
  { label: 'UTC',     iana: 'UTC' },
]

function tzFormatInZone(date, iana) {
  const isUtc = iana === 'UTC' || iana === 'Etc/UTC'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: iana, hour: 'numeric', minute: '2-digit',
    hour12: !isUtc, timeZoneName: 'short',
  }).formatToParts(date)
  const get = (t) => parts.find(p => p.type === t)?.value ?? ''
  const time = isUtc
    ? `${get('hour').padStart(2, '0')}:${get('minute')}`
    : `${get('hour')}:${get('minute')} ${get('dayPeriod')}`
  return { time: time.trim(), abbr: get('timeZoneName') }
}

function parseRawTime(h, min, ampmRaw, abbr) {
  let hour = h
  const ampm = ampmRaw?.toLowerCase().replace(/\./g, '')
  if (ampm === 'pm' && hour !== 12) hour += 12
  else if (ampm === 'am' && hour === 12) hour = 0
  const offset = TZ_OFFSETS[abbr]
  if (offset === undefined) return null
  const now = new Date()
  const utcMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    + (hour - offset) * 3600000 + min * 60000
  return { utcDate: new Date(utcMs), abbr }
}

const TZ_RE_SRC = Object.keys(TZ_OFFSETS).join('|')

export function detectTimeWithZone(text) {
  const m = text.trim().match(new RegExp(`^(\\d{1,2})(?::(\\d{2}))?\\s*([ap]\\.?m\\.?)?\\s+(${TZ_RE_SRC})$`, 'i'))
  if (!m || (!m[2] && !m[3])) return null
  return parseRawTime(+m[1], m[2] ? +m[2] : 0, m[3], m[4].toUpperCase())
}

export function getTimeConversions(utcDate) {
  const userIana = Intl.DateTimeFormat().resolvedOptions().timeZone
  const inStandard = DISP_ZONES.some(z => z.iana === userIana)
  const results = []
  if (!inStandard) {
    const { time, abbr } = tzFormatInZone(utcDate, userIana)
    results.push({ label: 'you', abbr, value: `${time} ${abbr}`, isUser: true })
  }
  for (const z of DISP_ZONES) {
    const { time, abbr } = tzFormatInZone(utcDate, z.iana)
    results.push({ label: z.label, abbr, value: `${time} ${abbr}`, isUser: z.iana === userIana })
  }
  return results
}

export function getUserLocalTime(utcDate) {
  const iana = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { time, abbr } = tzFormatInZone(utcDate, iana)
  return `${time} ${abbr}`
}

// Returns all time+tz spans in text with position info, for hover detection.
export function findTimesWithZone(text) {
  const re = new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?\\s*([ap]\\.?m\\.?)?\\s+(${TZ_RE_SRC})\\b`, 'gi')
  const results = []
  let m
  while ((m = re.exec(text)) !== null) {
    if (!m[2] && !m[3]) continue
    const parsed = parseRawTime(+m[1], m[2] ? +m[2] : 0, m[3], m[4].toUpperCase())
    if (!parsed) continue
    results.push({ ...parsed, index: m.index, length: m[0].length,
      line: text.slice(0, m.index).split('\n').length - 1, matchText: m[0] })
  }
  return results
}

// --- Timestamp conversion -------------------------------------------------------

function relativeTime(date) {
  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff), fut = diff > 0
  const fmt = (n, u) => fut ? `in ${n}${u}` : `${n}${u} ago`
  if (abs < 60000)            return 'just now'
  if (abs < 3600000)          return fmt(Math.round(abs / 60000), 'min')
  if (abs < 86400000)         return fmt(Math.round(abs / 3600000), 'hr')
  if (abs < 30 * 86400000)    return fmt(Math.round(abs / 86400000), 'd')
  if (abs < 365 * 86400000)   return fmt(Math.round(abs / (30 * 86400000)), 'mo')
  return fmt(Math.round(abs / (365 * 86400000)), 'yr')
}

export function detectTimestamp(text) {
  const t = text.trim()
  let date
  if (/^\d{13}$/.test(t)) {
    date = new Date(+t)
  } else if (/^\d{9,10}$/.test(t)) {
    date = new Date(+t * 1000)
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) {
    date = new Date(t)
  } else {
    return null
  }
  const y = date.getFullYear()
  return y >= 1990 && y <= 2100 ? date : null
}

export function getTimestampFormats(date) {
  const sec = Math.floor(date.getTime() / 1000)
  const ms = date.getTime()
  const mo = date.getUTCMonth(), d = date.getUTCDate(), y = date.getUTCFullYear()
  const h = date.getUTCHours(), min = date.getUTCMinutes(), s = date.getUTCSeconds()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  const pad = (n) => String(n).padStart(2, '0')
  return [
    { label: 'readable', value: `${FMT_MONTHS[mo]} ${d}, ${y} ${h12}:${pad(min)}:${pad(s)} ${ampm} UTC` },
    { label: 'ISO',      value: date.toISOString() },
    { label: 'unix sec', value: String(sec) },
    { label: 'unix ms',  value: String(ms) },
    { label: 'relative', value: relativeTime(date) },
  ]
}

function parseIsoLikeDateTime(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null

  const normalized = raw
    .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)\s*(Z|[+-]\d{2}:?\d{2}|GMT[+-]\d{2}:?\d{2})?$/i, (_, date, time, zone = '') => {
      const normalizedZone = zone
        .replace(/^GMT/i, '')
        .replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
      return `${date}T${time}${normalizedZone}`
    })
    .replace(/\s+(UTC|GMT)$/i, 'Z')

  const date = new Date(normalized)
  const year = date.getFullYear()
  return Number.isNaN(date.getTime()) || year < 1990 || year > 2100 ? null : date
}

function formatDateTimeInZone(date, iana) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  })
  const parts = formatter.formatToParts(date)
  const get = (type) => parts.find(part => part.type === type)?.value ?? ''
  const zone = get('timeZoneName') || iana
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${zone}`
}

export function detectDateTimeInstant(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null

  const timestampDate = detectTimestamp(raw)
  if (timestampDate) return { date: timestampDate, source: 'timestamp' }

  const singleDate = detectSingleDate(raw)
  if (singleDate) return { date: singleDate, source: 'date' }

  const isoDate = parseIsoLikeDateTime(raw)
  if (isoDate) return { date: isoDate, source: 'datetime' }

  const zonedTime = detectTimeWithZone(raw)
  if (zonedTime) return { date: zonedTime.utcDate, source: 'time' }

  return null
}

export function getDateTimeCommandOptions(date) {
  if (!date || Number.isNaN(date.getTime())) return null

  const localIana = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const zones = [
    { label: 'Local', iana: localIana, isUser: true },
    { label: 'UTC', iana: 'UTC' },
    { label: 'Pacific', iana: 'America/Los_Angeles' },
    { label: 'Mountain', iana: 'America/Denver' },
    { label: 'Central', iana: 'America/Chicago' },
    { label: 'Eastern', iana: 'America/New_York' },
  ]
  const seen = new Set()
  const timezoneOptions = []
  for (const zone of zones) {
    if (seen.has(zone.iana)) continue
    seen.add(zone.iana)
    timezoneOptions.push({
      ...zone,
      value: formatDateTimeInZone(date, zone.iana),
    })
  }

  return {
    timezoneOptions,
    timestampOptions: [
      { label: 'epoch sec', value: String(Math.floor(date.getTime() / 1000)) },
      { label: 'epoch ms', value: String(date.getTime()) },
      { label: 'ISO', value: date.toISOString() },
    ],
  }
}

function looksLikeYaml(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  let signalCount = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (/^[A-Za-z0-9_.'"-]+\s*:\s*(?:$|[^\[{/])/.test(line)) signalCount += 1
    if (/^-\s+/.test(line)) signalCount += 1
    if (/^---$|^\.\.\.$/.test(line)) signalCount += 1
    if (line.includes(': ') && !line.includes('{') && !line.includes('}')) signalCount += 1
    if (signalCount >= 2) return true
  }

  return false
}

function prettifyYamlLike(input) {
  try {
    const doc = YAML.parseDocument(String(input ?? ''))
    if (doc.errors?.length) {
      throw doc.errors[0]
    }
    return String(doc.toString({ indent: 2, lineWidth: 0 })).trimEnd()
  } catch (parseError) {
    // Fall back to heuristic normalization for YAML-like text that is not valid YAML yet.
  }

  const rawLines = String(input ?? '').replace(/\r\n/g, '\n').split('\n')
  if (!rawLines.some(line => line.trim())) throw new Error('No YAML content')
  if (!looksLikeYaml(input)) throw new Error('Does not look like YAML')

  const indentWidths = [...new Set(
    rawLines
      .filter(line => line.trim() && !line.trimStart().startsWith('#'))
      .map(line => (line.match(/^ */)?.[0].length ?? 0))
      .filter(width => width > 0)
  )].sort((a, b) => a - b)

  const normalizedIndent = new Map(indentWidths.map((width, index) => [width, '  '.repeat(index + 1)]))

  return rawLines.map(rawLine => {
    const trimmedRight = rawLine.replace(/[ \t]+$/g, '')
    const trimmed = trimmedRight.trim()
    if (!trimmed) return ''
    if (trimmed === '---' || trimmed === '...') return trimmed

    const indentWidth = trimmedRight.match(/^ */)?.[0].length ?? 0
    const nextIndent = indentWidth > 0 ? (normalizedIndent.get(indentWidth) ?? '') : ''

    if (trimmed.startsWith('#')) {
      return `${nextIndent}${trimmed}`
    }

    return `${nextIndent}${trimmed}`
  }).join('\n')
}

// --- Date parsing ---------------------------------------------------------------

// Returns [{date, text, index, line}] sorted by text position, overlaps removed.
export function parseDates(text) {
  const currentYear = new Date().getFullYear()
  const raw = []
  let m

  const isoRe = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g
  while ((m = isoRe.exec(text)) !== null) {
    const y = +m[1], mo = +m[2], d = +m[3]
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      raw.push({ date: new Date(y, mo - 1, d), text: m[0], index: m.index })
  }

  const namedRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+(\d{1,2})(?:[,\s]+(\d{4}))?\b/gi
  while ((m = namedRe.exec(text)) !== null) {
    const mo = MONTH_NUMS[m[1].toLowerCase()]
    const d = +m[2]
    const y = m[3] ? +m[3] : currentYear
    if (d >= 1 && d <= 31)
      raw.push({ date: new Date(y, mo - 1, d), text: m[0], index: m.index })
  }

  const usRe = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g
  while ((m = usRe.exec(text)) !== null) {
    const mo = +m[1], d = +m[2], y = +m[3]
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      raw.push({ date: new Date(y, mo - 1, d), text: m[0], index: m.index })
  }

  raw.sort((a, b) => a.index - b.index)
  const final = []
  let lastEnd = -1
  for (const item of raw) {
    if (item.index >= lastEnd && !isNaN(item.date.getTime())) {
      final.push({ ...item, line: text.slice(0, item.index).split('\n').length - 1 })
      lastEnd = item.index + item.text.length
    }
  }
  return final
}

export const TRANSFORMS = [
  { id: 'base64e',   label: 'Base64 ↑',   title: 'Base64 Encode' },
  { id: 'base64d',   label: 'Base64 ↓',   title: 'Base64 Decode' },
  { id: 'urld',      label: 'URL ↓',       title: 'URL Decode' },
  { id: 'jwt',       label: 'JWT ↓',       title: 'JWT Decode + Expiry Check' },
  { id: 'json',      label: 'JSON {}',     title: 'Prettify JSON' },
  { id: 'yaml',      label: 'YAML {}',     title: 'Prettify YAML / YML' },
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
  { id: 'oneliner',  label: '1-liner',     title: 'Collapse to one line (join \\ continuations)' },
  { id: 'dategap',   label: 'Dates ↕',    title: 'Date Gaps — find all dates and compute gaps' },
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

    case 'yaml': {
      return prettifyYamlLike(input)
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

    case 'dategap': {
      const dates = parseDates(input)
      if (dates.length === 0) throw new Error('No dates found in text')
      if (dates.length === 1) throw new Error('Only one date found — need 2 or more')
      const sorted = [...dates].sort((a, b) => a.date - b.date)
      const multiYear = new Set(sorted.map(d => d.date.getFullYear())).size > 1
      const fmt = (d) => formatDateShort(d.date, multiYear)
      const rows = []
      for (let i = 1; i < sorted.length; i++) {
        const days = Math.round((sorted[i].date - sorted[i - 1].date) / 86400000)
        if (days === 0) continue
        rows.push(`  ${fmt(sorted[i - 1])}  →  ${fmt(sorted[i])}  (${days} day${days !== 1 ? 's' : ''})`)
      }
      if (rows.length === 0) throw new Error('All dates are the same day')
      const totalDays = Math.round((sorted[sorted.length - 1].date - sorted[0].date) / 86400000)
      const footer = sorted.length > 2
        ? `\n\n  Total span: ${totalDays} days  (${fmt(sorted[0])} → ${fmt(sorted[sorted.length - 1])})`
        : ''
      return `${sorted.length} dates found\n\n${rows.join('\n')}${footer}`
    }

    case 'oneliner': {
      return input
        .replace(/[ \t]*\\[ \t]*\r?\n[ \t]*/g, ' ')
        .replace(/\r?\n/g, ' ')
        .replace(/  +/g, ' ')
        .trim()
    }

    default:
      throw new Error(`Unknown transform: ${id}`)
  }
}
