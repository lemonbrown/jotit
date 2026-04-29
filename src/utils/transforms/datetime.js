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

// ── Timezone conversion ────────────────────────────────────────────────────────

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

// ── Timestamp ──────────────────────────────────────────────────────────────────

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
