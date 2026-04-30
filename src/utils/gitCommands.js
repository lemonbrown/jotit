export const GIT_COMMAND_PREFIX = '/git'

export const GIT_COMMAND_SUGGESTIONS = [
  {
    command: 'connect',
    insertText: '/git connect "',
    detail: 'Register a local git repository',
    usage: '/git connect "C:\\path\\to\\repo"',
  },
  {
    command: 'repos',
    insertText: '/git repos',
    detail: 'List known repositories',
    usage: '/git repos',
  },
  {
    command: 'use',
    insertText: '/git use ',
    detail: 'Link a known repo to this note',
    usage: '/git use <repo-id>',
  },
  {
    command: 'status',
    insertText: '/git status',
    detail: 'Show status for the resolved repo',
    usage: '/git status [repo-id]',
  },
  {
    command: 'diff',
    insertText: '/git diff',
    detail: 'Show diff for the resolved repo',
    usage: '/git diff [repo-id]',
  },
  {
    command: 'summary',
    insertText: '/git summary',
    detail: 'AI summary of current changes',
    usage: '/git summary [repo-id]',
  },
  {
    command: 'summary commit',
    insertText: '/git summary commit',
    detail: 'Generate a git commit message',
    usage: '/git summary commit [repo-id]',
  },
  {
    command: 'pr',
    insertText: '/git pr ',
    detail: 'View a pull request by number',
    usage: '/git pr <number> [--base <branch>]',
  },
]

function tokenizeArgs(input) {
  const tokens = []
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g
  let match
  while ((match = pattern.exec(input)) != null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? ''
    tokens.push(raw.replace(/\\(["'\\])/g, '$1'))
  }
  return tokens
}

function unquote(value) {
  const text = String(value ?? '').trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).replace(/\\(["'\\])/g, '$1')
  }
  return text
}

export function parseGitCommand(line) {
  const text = String(line ?? '').trim()
  if (text !== GIT_COMMAND_PREFIX && !text.startsWith(`${GIT_COMMAND_PREFIX} `)) return null
  const rest = text.slice(GIT_COMMAND_PREFIX.length).trim()
  if (!rest) return { command: 'help' }

  const firstSpace = rest.search(/\s/)
  const command = (firstSpace === -1 ? rest : rest.slice(0, firstSpace)).toLowerCase()
  const argsText = firstSpace === -1 ? '' : rest.slice(firstSpace).trim()
  const args = tokenizeArgs(argsText)

  if (command === 'connect') {
    return { command, path: unquote(argsText) }
  }
  if (command === 'repos') return { command }
  if (command === 'use') {
    return {
      command,
      repoId: args.find(arg => !arg.startsWith('--')) ?? '',
      setDefault: args.includes('--default') || args.includes('--all-notes'),
    }
  }
  if (command === 'status' || command === 'diff') {
    return { command, repoId: args.find(arg => !arg.startsWith('--')) ?? '' }
  }
  if (command === 'summary') {
    const firstArgIdx = args.findIndex(arg => !arg.startsWith('--'))
    const firstArg = firstArgIdx === -1 ? '' : args[firstArgIdx]
    if (firstArg === 'commit') {
      const repoId = args.slice(firstArgIdx + 1).find(a => !a.startsWith('--')) ?? ''
      return { command: 'summary-commit', repoId }
    }
    return { command, repoId: firstArg }
  }
  if (command === 'pr') {
    const number = args.find(a => /^\d+$/.test(a))
    const baseIdx = args.indexOf('--base')
    const base = baseIdx !== -1 ? (args[baseIdx + 1] ?? '') : ''
    return { command: 'pr-view', number: number ? Number(number) : null, base }
  }
  return { command: 'unknown', raw: text }
}

export function getGitCommandTrigger(text, cursor) {
  const value = String(text ?? '')
  const pos = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  const lineStart = value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
  const lineEnd = value.indexOf('\n', pos)
  const end = lineEnd === -1 ? value.length : lineEnd
  if (pos > end) return null

  const lineBeforeCursor = value.slice(lineStart, pos)
  if (!lineBeforeCursor.startsWith(GIT_COMMAND_PREFIX)) return null
  if (lineBeforeCursor.length > GIT_COMMAND_PREFIX.length && !lineBeforeCursor.startsWith(`${GIT_COMMAND_PREFIX} `)) return null

  return {
    start: lineStart,
    end: pos,
    query: lineBeforeCursor.slice(GIT_COMMAND_PREFIX.length).trimStart(),
  }
}

export function getGitCommandSuggestions(query = '', repos = []) {
  const normalized = String(query ?? '').trimStart()
  const [commandPart = '', repoPart = ''] = normalized.split(/\s+/, 2)
  const command = commandPart.toLowerCase()

  if (!normalized || !normalized.includes(' ')) {
    return GIT_COMMAND_SUGGESTIONS
      .filter(item => !command || item.command.startsWith(command))
      .map(item => ({ kind: 'command', ...item }))
  }

  if (!['use', 'status', 'diff', 'summary'].includes(command)) return []

  const repoQuery = repoPart.toLowerCase()
  const repoSuggestions = repos
    .filter(repo => {
      const id = String(repo.id ?? '').toLowerCase()
      const name = String(repo.displayName ?? repo.name ?? '').toLowerCase()
      return !repoQuery || id.includes(repoQuery) || name.includes(repoQuery)
    })
    .slice(0, 8)
    .map(repo => ({
      kind: 'repo',
      command,
      repo,
      insertText: `/git ${command} ${repo.id}`,
      detail: repo.path ?? '',
      usage: `${repo.displayName ?? repo.name ?? repo.id} (${repo.branch ?? 'unknown branch'})`,
    }))

  if (command === 'summary' && 'commit'.startsWith(repoQuery)) {
    const commitOption = {
      kind: 'command',
      command: 'summary commit',
      insertText: '/git summary commit',
      detail: 'Generate a git commit message',
      usage: '/git summary commit [repo-id]',
    }
    return [commitOption, ...repoSuggestions]
  }

  return repoSuggestions
}

export function parsePrCommand(line) {
  const text = String(line ?? '').trim()
  if (text !== '/pr' && !text.startsWith('/pr ')) return null
  const rest = text.slice('/pr'.length).trim()
  if (!rest) return { command: 'help' }

  const firstSpace = rest.search(/\s/)
  const command = (firstSpace === -1 ? rest : rest.slice(0, firstSpace)).toLowerCase()
  const argsText = firstSpace === -1 ? '' : rest.slice(firstSpace).trim()
  const args = tokenizeArgs(argsText)

  if (command === 'draft') {
    return { command, repoId: args.find(arg => !arg.startsWith('--')) ?? '' }
  }
  return { command: 'unknown', raw: text }
}

export function formatGitRepo(repo) {
  if (!repo) return 'unknown repo'
  const branch = repo.branch ? `\nBranch: ${repo.branch}` : ''
  const base = repo.baseBranch ? `\nBase: ${repo.baseBranch}` : ''
  const path = repo.path ? `\nPath: ${repo.path}` : ''
  return `${repo.displayName ?? repo.name ?? repo.id}${branch}${base}${path}`
}

export function formatGitCommandResult(title, body = '') {
  const trimmed = String(body ?? '').trimEnd()
  return trimmed ? `${title}\n\n${trimmed}` : title
}
