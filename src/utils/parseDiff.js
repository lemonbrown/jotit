export function parseNumstat(raw) {
  const files = []
  for (const line of String(raw ?? '').split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m) continue
    files.push({
      path: m[3].trim(),
      additions: m[1] === '-' ? null : Number(m[1]),
      deletions: m[2] === '-' ? null : Number(m[2]),
      isBinary: m[1] === '-',
    })
  }
  return files
}

function parseHunkHeader(header) {
  const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
  return {
    oldStart: m ? Number(m[1]) : 1,
    newStart: m ? Number(m[2]) : 1,
    context: m ? m[3].trim() : '',
  }
}

export function parseDiff(raw) {
  const files = []
  let current = null
  let currentHunk = null
  let oldLine = 0
  let newLine = 0

  for (const line of String(raw ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      const m = line.match(/diff --git a\/(.*?) b\/(.*)$/)
      current = {
        fromPath: m?.[1] ?? '',
        toPath: m?.[2] ?? '',
        hunks: [],
        isNew: false,
        isDeleted: false,
        isBinary: false,
      }
      currentHunk = null
    } else if (line.startsWith('new file')) {
      if (current) current.isNew = true
    } else if (line.startsWith('deleted file')) {
      if (current) current.isDeleted = true
    } else if (line.startsWith('Binary files')) {
      if (current) current.isBinary = true
    } else if (line.startsWith('@@ ')) {
      const { oldStart, newStart, context } = parseHunkHeader(line)
      oldLine = oldStart
      newLine = newStart
      currentHunk = { header: line, oldStart, newStart, context, lines: [] }
      if (current) current.hunks.push(currentHunk)
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newLine++ })
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'del', content: line.slice(1), oldLine: oldLine++, newLine: null })
      } else if (line.startsWith('\\')) {
        currentHunk.lines.push({ type: 'noeol', content: line, oldLine: null, newLine: null })
      } else {
        const content = line.startsWith(' ') ? line.slice(1) : line
        currentHunk.lines.push({ type: 'ctx', content, oldLine: oldLine++, newLine: newLine++ })
      }
    }
  }

  if (current) files.push(current)
  return files
}
