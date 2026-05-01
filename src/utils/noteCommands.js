export const NOW_COMMAND = '/now'
export const NIB_COMMAND = '/nib'
export const SQL_COMMAND = '/sql'
export const URL_COMMAND = '/url'

const NIB_SUGGESTIONS = [
  {
    id: 'nib-url',
    label: '/nib url',
    detail: 'fetch a URL as readable page text',
    usage: '/nib url https://docs.example.com',
    insertText: '/nib url ',
  },
  {
    id: 'nib-url-summary',
    label: '/nib --summary url',
    detail: 'fetch a URL and summarize it',
    usage: '/nib --summary url https://docs.example.com',
    insertText: '/nib --summary url ',
  },
  {
    id: 'nib-url-markdown',
    label: '/nib --markdown url',
    detail: 'fetch a URL and have Nib convert it to markdown',
    usage: '/nib --markdown url https://docs.example.com',
    insertText: '/nib --markdown url ',
  },
  {
    id: 'nib-url-terse',
    label: '/nib --terse url',
    detail: 'extract only the requested URL items',
    usage: '/nib --commands --terse url https://docs.example.com',
    insertText: '/nib --terse url ',
  },
  {
    id: 'nib-url-commands',
    label: '/nib --commands url',
    detail: 'extract CLI commands from a URL',
    usage: '/nib --commands url https://docs.example.com',
    insertText: '/nib --commands url ',
  },
  {
    id: 'nib-url-routes',
    label: '/nib --routes url',
    detail: 'extract API routes from a URL',
    usage: '/nib --routes url https://docs.example.com',
    insertText: '/nib --routes url ',
  },
  {
    id: 'nib-sql',
    label: '/nib sql',
    detail: 'query the attached sqlite db with natural language',
    usage: '/nib sql find all users',
    insertText: '/nib sql ',
  },
  {
    id: 'nib-sql-db',
    label: '/nib sql @db',
    detail: 'query a specific sqlite db with natural language',
    usage: '/nib sql @mydb find all users',
    insertText: '/nib sql @',
  },
  {
    id: 'nib-template',
    label: '/nib !',
    detail: 'draft from a template',
    usage: '/nib !bug',
    insertText: '/nib !',
  },
  {
    id: 'nib-note',
    label: '/nib --note',
    detail: 'write the response to a new note',
    usage: '/nib --note !bug',
    insertText: '/nib --note ',
  },
  {
    id: 'nib-inline',
    label: '/nib --inline',
    detail: 'insert the response inline into the note',
    usage: '/nib --inline sql find all users',
    insertText: '/nib --inline ',
  },
  {
    id: 'nib-summary',
    label: '/nib summarize',
    detail: 'summarize the current note inline',
    usage: '/nib summarize this note',
    insertText: '/nib summarize this note',
  },
  {
    id: 'nib-actions',
    label: '/nib actions',
    detail: 'extract actions from the current note inline',
    usage: '/nib extract action items',
    insertText: '/nib extract action items',
  },
]

const SLASH_COMMANDS = [
  {
    id: 'slash-nib',
    label: '/nib',
    detail: 'run Nib against this note',
    usage: '/nib !bug',
    insertText: '/nib ',
  },
  {
    id: 'slash-sql',
    label: '/sql',
    detail: 'run a SQL query against an attached sqlite db',
    usage: '/sql SELECT * FROM users',
    insertText: '/sql ',
  },
  {
    id: 'slash-url',
    label: '/url',
    detail: 'fetch a URL as readable text without Nib',
    usage: '/url --markdown --note https://docs.example.com',
    insertText: '/url ',
  },
  {
    id: 'slash-git',
    label: '/git',
    detail: 'run git workspace commands',
    usage: '/git status',
    insertText: '/git ',
  },
  {
    id: 'slash-pr',
    label: '/pr',
    detail: 'draft PR notes from git state',
    usage: '/pr draft',
    insertText: '/pr ',
  },
  {
    id: 'slash-tips',
    label: '/tips',
    detail: 'create the jot.it tips note',
    usage: '/tips',
    insertText: '/tips',
  },
  {
    id: 'slash-now',
    label: '/now',
    detail: 'insert the current local timestamp',
    usage: '/now',
    insertText: '/now',
  },
]

function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

export function formatCurrentDateTime(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offset = `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    `GMT${offset}`,
  ].join(' ')
}

export function getInlineCommandRange(text, cursor, command) {
  const value = String(text ?? '')
  const end = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  const normalizedCommand = String(command ?? '')
  if (!normalizedCommand) return null

  const start = end - normalizedCommand.length
  if (start < 0 || value.slice(start, end) !== normalizedCommand) return null
  const before = start > 0 ? value[start - 1] : ''
  if (before && !/\s|[([{]/.test(before)) return null
  return { start, end }
}

function parseUrlFlags(text) {
  const parts = String(text ?? '').trim().split(/\s+/).filter(Boolean)
  const body = []
  let output = null
  let markdown = false

  for (const part of parts) {
    if (part === '--note' || part === '--new-note' || part === '-n') {
      output = 'note'
    } else if (part === '--inline' || part === '-i') {
      output = 'inline'
    } else if (part === '--markdown' || part === '--md' || part === '-m') {
      markdown = true
    } else {
      body.push(part)
    }
  }

  return { text: body.join(' '), output, markdown }
}

export function parseUrlCommand(line) {
  const text = String(line ?? '').trim()
  if (text !== URL_COMMAND && !text.startsWith(`${URL_COMMAND} `)) return null
  const rest = text.slice(URL_COMMAND.length).trim()
  const { text: commandText, output, markdown } = parseUrlFlags(rest)
  const spaceIdx = commandText.indexOf(' ')
  const url = spaceIdx === -1 ? commandText : commandText.slice(0, spaceIdx)
  return { command: 'url', url, markdown, output: output ?? 'panel' }
}

function parseSqlSubcommandRest(rest) {
  const s = String(rest ?? '').trim()
  if (s.startsWith('@')) {
    const spaceIdx = s.indexOf(' ')
    if (spaceIdx === -1) return { db: s.slice(1), query: '' }
    return { db: s.slice(1, spaceIdx), query: s.slice(spaceIdx + 1).trim() }
  }
  return { db: null, query: s }
}

export function parseNibCommand(line) {
  const text = String(line ?? '').trim()
  if (text !== NIB_COMMAND && !text.startsWith(`${NIB_COMMAND} `)) return null
  const rest = text.slice(NIB_COMMAND.length).trim()
  const { text: commandText, output: flagOutput, markdown, terse, urlMode } = parseNibFlags(rest)
  if (!commandText) return { command: 'ask', prompt: '', templateCommand: '', templateArgs: '', output: flagOutput ?? 'inline' }

  if (commandText === 'url' || commandText.startsWith('url ')) {
    const rest = commandText.slice(3).trim()
    const spaceIdx = rest.indexOf(' ')
    const url = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)
    const hint = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim()
    return { command: 'url', url, hint, urlMode, markdown, terse, templateCommand: '', templateArgs: '', output: flagOutput ?? 'panel' }
  }

  if (commandText === 'sql' || commandText.startsWith('sql ')) {
    const { db, query } = parseSqlSubcommandRest(commandText.slice(3).trim())
    return { command: 'sql', db, prompt: query, templateCommand: '', templateArgs: '', output: flagOutput ?? 'panel' }
  }

  if (!commandText.startsWith('!')) {
    return { command: 'ask', prompt: commandText, templateCommand: '', templateArgs: '', output: flagOutput ?? 'inline' }
  }

  const templateQuery = commandText.slice(1).trim()
  const space = templateQuery.indexOf(' ')
  return {
    command: 'template',
    prompt: '',
    templateCommand: space === -1 ? templateQuery : templateQuery.slice(0, space),
    templateArgs: space === -1 ? '' : templateQuery.slice(space + 1).trim(),
    output: flagOutput ?? 'notes',
  }
}

function parseNibFlags(text) {
  const parts = String(text ?? '').trim().split(/\s+/).filter(Boolean)
  const body = []
  let output = null
  let markdown = false
  let terse = false
  let urlMode = 'structure'

  for (const part of parts) {
    if (part === '--note' || part === '--new-note' || part === '-n') {
      output = 'note'
    } else if (part === '--inline' || part === '-i') {
      output = 'inline'
    } else if (part === '--markdown' || part === '--md' || part === '-m') {
      markdown = true
    } else if (part === '--terse' || part === '-t') {
      terse = true
    } else if (part === '--summary' || part === '--summarize') {
      urlMode = 'summary'
    } else if (part === '--commands' || part === '--command') {
      urlMode = 'commands'
    } else if (part === '--routes' || part === '--api' || part === '--endpoints') {
      urlMode = 'routes'
    } else {
      body.push(part)
    }
  }

  return { text: body.join(' '), output, markdown, terse, urlMode }
}

export function buildNibBatchTemplatePrompt(template, noteContent, { args = '' } = {}) {
  const body = normalizeTemplateForNib(template?.body)
  const extra = String(args ?? '').trim()
  const rawItems = String(noteContent ?? '').trim().split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
  const count = rawItems.length
  const numberedItems = rawItems.map((item, i) => `${i + 1}. ${item}`).join('\n')
  return [
    `The text below contains exactly ${count} item${count !== 1 ? 's' : ''}. Produce exactly ${count} filled-out version${count !== 1 ? 's' : ''} of the template, one per item.`,
    `Separate each result with a line containing only: ===`,
    `Output only the filled templates — no preamble, no labels, no explanation, no extra commentary.`,
    `Each result must start directly with the first field of the template — do not add a heading or label above it.`,
    extra ? `Additional direction: ${extra}` : null,
    `Replace every placeholder with relevant content from each item. Do not output tab-stop syntax, dollar-brace placeholders, or placeholder braces. Leave unknown details as concise TODOs.`,
    '',
    'Template:',
    body,
    '',
    `Items (${count} total):`,
    numberedItems,
  ].filter(v => v !== null).join('\n')
}

export function buildNibTemplatePrompt(template, { args = '' } = {}) {
  const body = normalizeTemplateForNib(template?.body)
  const name = String(template?.name ?? template?.command ?? 'template').trim()
  const extra = String(args ?? '').trim()
  return [
    `Draft a ${name} from the note content.`,
    extra ? `Use this additional direction: ${extra}` : null,
    'Use this template as the target structure. Replace every placeholder with final prose from the note content. Do not output snippet markers, tab-stop syntax, dollar-brace placeholders, or placeholder braces. Leave unknown details as concise TODOs.',
    '',
    body,
  ].filter(Boolean).join('\n')
}

export function normalizeTemplateForNib(body) {
  return String(body ?? '')
    .replace(/\$\{\s*\d+\s*:\s*([^}]*)\}/g, (_, placeholder) => {
      const value = String(placeholder ?? '').trim()
      return value ? `[${value}]` : '[TODO]'
    })
    .replace(/\$\{sel\}/g, '[selected text]')
    .trim()
}

export function getNibCommandTrigger(text, cursor) {
  return getSlashCommandTrigger(text, cursor)
}

export function getSlashCommandTrigger(text, cursor) {
  const value = String(text ?? '')
  const end = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  const lineStart = value.lastIndexOf('\n', Math.max(0, end - 1)) + 1
  const lineEnd = value.indexOf('\n', end)
  const currentLineEnd = lineEnd === -1 ? value.length : lineEnd
  const lineToCursor = value.slice(lineStart, end)
  const fullLine = value.slice(lineStart, currentLineEnd)

  if (!lineToCursor.startsWith('/')) return null
  if (lineToCursor.includes('!')) return null
  if (lineToCursor.includes('://')) return null
  if (/\s/.test(lineToCursor) && !lineToCursor.startsWith(`${NIB_COMMAND} `) && !lineToCursor.startsWith(`${URL_COMMAND} `)) return null
  if (parseNibCommand(fullLine) && lineToCursor.trim() !== NIB_COMMAND && !lineToCursor.startsWith(`${NIB_COMMAND} `)) return null
  if (parseUrlCommand(fullLine) && lineToCursor.trim() !== URL_COMMAND && !lineToCursor.startsWith(`${URL_COMMAND} `)) return null

  return {
    start: lineStart,
    end,
    query: lineToCursor.slice(1),
  }
}

export function getNibCommandSuggestions(query) {
  return getSlashCommandSuggestions(query)
}

export function getSlashCommandSuggestions(query) {
  const normalized = String(query ?? '').trim().toLowerCase()
  if (!normalized) return SLASH_COMMANDS
  if (!normalized || normalized === 'nib') return NIB_SUGGESTIONS

  if (!normalized.startsWith('nib ')) {
    return SLASH_COMMANDS.filter(item => {
      const command = item.label.slice(1)
      const haystack = `${command} ${item.detail} ${item.usage}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }

  const withoutCommand = normalized.startsWith('nib')
    ? normalized.slice(3).trim()
    : normalized

  return NIB_SUGGESTIONS
    .filter(item => {
      const haystack = `${item.label} ${item.detail} ${item.usage}`.toLowerCase()
      return haystack.includes(withoutCommand)
    })
}
