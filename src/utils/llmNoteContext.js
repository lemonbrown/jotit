import { isOpenApiNote } from './noteTypes.js'

export const MAX_NOTE_CONTEXT_CHARS = 120000
export const MAX_ALL_NOTES_CONTEXT_CHARS = 80000

function truncateContext(text, maxChars = MAX_NOTE_CONTEXT_CHARS) {
  const value = String(text ?? '')
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n_(context truncated at ${maxChars} characters)_`
}

function getOpenApiRawText(note) {
  const data = note?.noteData
  if (!data || typeof data !== 'object') return ''
  if (typeof data.rawText === 'string' && data.rawText.trim()) return data.rawText
  if (data.spec) {
    try {
      return JSON.stringify(data.spec, null, 2)
    } catch {}
  }
  if (data.document) {
    try {
      return JSON.stringify(data.document, null, 2)
    } catch {}
  }
  return ''
}

export function buildNoteLLMContext(note, { maxChars = MAX_NOTE_CONTEXT_CHARS } = {}) {
  if (!note) return ''

  const summary = String(note.content ?? '').trim()
  if (!isOpenApiNote(note)) return truncateContext(summary, maxChars)

  const rawText = getOpenApiRawText(note).trim()
  if (!rawText) return truncateContext(summary, maxChars)

  const fileName = note.noteData?.fileName ? `File: ${note.noteData.fileName}\n\n` : ''
  const context = [
    summary ? `OpenAPI note summary:\n${summary}` : '',
    `${fileName}OpenAPI JSON specification:\n\`\`\`json\n${rawText}\n\`\`\``,
  ].filter(Boolean).join('\n\n')

  return truncateContext(context, maxChars)
}

export function buildAllNotesLLMContext(notes, { maxChars = MAX_ALL_NOTES_CONTEXT_CHARS } = {}) {
  const parts = []
  let total = 0

  for (const note of (notes ?? [])) {
    const context = buildNoteLLMContext(note)
    if (!context.trim()) continue
    const title = String(note.content ?? '').split('\n')[0].slice(0, 80) || 'Untitled'
    const entry = `### ${title}\n\n${context.trim()}\n\n---\n\n`
    if (total + entry.length > maxChars) {
      parts.push('_(additional notes omitted - context limit reached)_')
      break
    }
    parts.push(entry)
    total += entry.length
  }

  return parts.join('')
}
