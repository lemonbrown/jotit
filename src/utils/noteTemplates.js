import { generateId } from './helpers.js'

// Tab stop syntax: ${N:placeholder text}
const TAB_STOP_RE = /\$\{(\d+):([^}]*)\}/g

export function parseTabStops(body) {
  const raw = String(body ?? '')
  const matches = []
  let m

  const re = /\$\{(\d+):([^}]*)\}/g
  while ((m = re.exec(raw)) !== null) {
    matches.push({
      tabIndex: parseInt(m[1], 10),
      placeholder: m[2],
      rawStart: m.index,
      rawLen: m[0].length,
    })
  }

  // Build clean text processing left-to-right, tracking positions as we go
  const byPosition = [...matches].sort((a, b) => a.rawStart - b.rawStart)
  let cleanText = ''
  let lastRawEnd = 0
  const stopsByPosition = []

  for (const match of byPosition) {
    cleanText += raw.slice(lastRawEnd, match.rawStart)
    const start = cleanText.length
    cleanText += match.placeholder
    const end = cleanText.length
    stopsByPosition.push({ tabIndex: match.tabIndex, start, end, placeholder: match.placeholder })
    lastRawEnd = match.rawStart + match.rawLen
  }
  cleanText += raw.slice(lastRawEnd)

  // Sort by tabIndex so Tab cycles in declared order
  stopsByPosition.sort((a, b) => a.tabIndex - b.tabIndex)

  return { text: cleanText, stops: stopsByPosition }
}

export function expandTemplate(template, { args = '', selection = '' } = {}) {
  let body = template.body

  // Replace ${sel} with selection text (not a tab stop, just a token)
  body = body.replace(/\$\{sel\}/g, selection || '')

  const { text, stops } = parseTabStops(body)

  if (args.trim() && stops.length > 0) {
    // Auto-fill the first tab stop with the provided args
    const first = stops[0]
    const filled = text.slice(0, first.start) + args + text.slice(first.end)
    const delta = args.length - (first.end - first.start)
    const remainingStops = stops.slice(1).map(s => ({
      ...s,
      start: s.start + delta,
      end: s.end + delta,
    }))
    return { text: filled, stops: remainingStops }
  }

  return { text, stops }
}

// "bug login failure" → { command: "bug", args: "login failure" }
export function parseTemplateQuery(query) {
  const space = query.indexOf(' ')
  if (space === -1) return { command: query, args: '' }
  return { command: query.slice(0, space), args: query.slice(space + 1) }
}

export function matchTemplates(templates, query) {
  if (!query) return templates.slice(0, 6)
  const { command } = parseTemplateQuery(query)
  const lower = command.toLowerCase()
  return templates.filter(t => t.command.toLowerCase().startsWith(lower)).slice(0, 6)
}

export const BUILTIN_TEMPLATES = [
  {
    id: '__builtin_bug',
    command: 'bug',
    name: 'Bug report',
    builtin: true,
    body: `Bug: \${1:title}

Steps to reproduce
\${2:1. step}

Expected
\${3:what should happen}

Actual
\${4:what actually happens}

Environment
\${5:OS / browser / version}`,
  },
  {
    id: '__builtin_ticket',
    command: 'ticket',
    name: 'Work item',
    builtin: true,
    body: `\${1:Title}

Type: \${2:feature / bug / chore}

Description
\${3:what and why}

Acceptance criteria
- \${4:criterion}

Notes
\${5:}`,
  },
  {
    id: '__builtin_api',
    command: 'api',
    name: 'API endpoint',
    builtin: true,
    body: `\${1:GET} \${2:/path}

Description
\${3:what this endpoint does}

Parameters
\${4:none}

Request body
\${5:none}

Responses
- 200: \${6:success}
- 4xx: \${7:client error}`,
  },
  {
    id: '__builtin_note',
    command: 'note',
    name: 'Dev note',
    builtin: true,
    body: `\${1:Topic}

Context
\${2:background / why this matters}

Decision
\${3:what was decided or done}

Follow-ups
- \${4:}`,
  },
]

export function createTemplateDraft({ command, name, body }) {
  const now = Date.now()
  return {
    id: generateId(),
    command: String(command ?? '').trim().replace(/^!+/, ''),
    name: String(name ?? '').trim(),
    body: String(body ?? ''),
    createdAt: now,
    updatedAt: now,
  }
}
