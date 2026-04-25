function inferChunkKind(content) {
  const trimmed = content.trim()
  if (!trimmed) return 'prose'
  if (trimmed.startsWith('```')) return 'code'

  const lines = trimmed.split('\n').map(line => line.trim()).filter(Boolean)
  if (!lines.length) return 'prose'

  const commandish = lines.every(line =>
    line.startsWith('$') ||
    line.startsWith('>') ||
    line.startsWith('npm ') ||
    line.startsWith('pnpm ') ||
    line.startsWith('yarn ') ||
    line.startsWith('docker ') ||
    line.startsWith('kubectl ') ||
    line.startsWith('terraform ') ||
    line.startsWith('git ') ||
    line.startsWith('curl ')
  )
  if (commandish) return 'command'

  const configish = lines.some(line =>
    /^[A-Z0-9_]+\s*=/.test(line) ||
    /^[\w.-]+\s*:\s*.+/.test(line) ||
    line.startsWith('{') ||
    line.startsWith('[')
  )
  if (configish) return 'config'

  const tableish = lines.length >= 2 && lines.some(line => line.includes('|') || line.includes(','))
  if (tableish) return 'table'

  const logish = lines.some(line =>
    /\b(error|warn|exception|stack trace|traceback|timeout|unauthorized|forbidden)\b/i.test(line) ||
    /^\d{4}-\d{2}-\d{2}[ t]/i.test(line)
  )
  if (logish) return 'log'

  return 'prose'
}

function createChunk(noteId, index, content, sectionTitle, startOffset, endOffset) {
  const trimmed = content.trim()
  if (!trimmed) return null

  return {
    id: `${noteId}:chunk:${index}`,
    noteId,
    content: trimmed,
    kind: inferChunkKind(trimmed),
    sectionTitle: sectionTitle ?? null,
    startOffset,
    endOffset,
  }
}

export function chunkNoteContent(note) {
  const noteId = note?.id
  const rawContent = String(note?.content ?? '')
  const normalizedContent = rawContent.replace(/\r\n/g, '\n')
  if (!noteId || !normalizedContent.trim()) return []

  const lines = normalizedContent.split('\n')
  const chunks = []
  let currentLines = []
  let currentStartOffset = 0
  let cursor = 0
  let inFence = false
  let activeSectionTitle = null

  const flushChunk = (endOffset) => {
    const chunk = createChunk(
      noteId,
      chunks.length,
      currentLines.join('\n'),
      activeSectionTitle,
      currentStartOffset,
      endOffset
    )
    if (chunk) chunks.push(chunk)
    currentLines = []
    currentStartOffset = endOffset
  }

  for (const line of lines) {
    const lineStart = cursor
    const lineWithNewlineLength = line.length + 1
    cursor += lineWithNewlineLength

    if (!currentLines.length) currentStartOffset = lineStart

    const trimmed = line.trim()
    const isFence = trimmed.startsWith('```')
    const isHeading = !inFence && /^#{1,6}\s+/.test(trimmed)
    const isBlank = !inFence && trimmed === ''

    if (isHeading) {
      flushChunk(lineStart)
      activeSectionTitle = trimmed.replace(/^#{1,6}\s+/, '').trim() || activeSectionTitle
      currentLines.push(line)
      continue
    }

    currentLines.push(line)

    if (isFence) {
      inFence = !inFence
      continue
    }

    if (isBlank) flushChunk(cursor)
  }

  flushChunk(normalizedContent.length)
  return chunks
}
