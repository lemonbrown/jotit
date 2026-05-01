import { isOpenApiNote } from './noteTypes.js'
import { extractMarkerIds } from './attachments.js'

export const MAX_NOTE_CONTEXT_CHARS = 120000
export const MAX_ALL_NOTES_CONTEXT_CHARS = 80000
export const MAX_IMAGE_CONTEXT_BYTES = 5 * 1024 * 1024
export const MAX_VISION_IMAGES = 3

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

function buildAttachmentMap(attachments = []) {
  return new Map((attachments ?? []).map(attachment => [attachment.id, attachment]))
}

export function collectImageAttachments(content, attachments = [], { maxBytes = MAX_IMAGE_CONTEXT_BYTES, maxImages = Infinity } = {}) {
  const markerIds = extractMarkerIds(content)
  if (!markerIds.length) return { images: [], notices: [] }

  const attachmentMap = buildAttachmentMap(attachments)
  const images = []
  const notices = []
  let totalBytes = 0

  for (const id of markerIds) {
    const attachment = attachmentMap.get(id)
    if (!attachment?.data) {
      notices.push(`- ${id}: missing image attachment`)
      continue
    }

    if (images.length >= maxImages) {
      notices.push(`- ${id}: omitted because image count exceeds ${maxImages}`)
      continue
    }

    const imageBytes = attachment.data.length
    if (totalBytes + imageBytes > maxBytes) {
      notices.push(`- ${id}: omitted because image context exceeds ${Math.round(maxBytes / (1024 * 1024))} MB`)
      continue
    }

    totalBytes += imageBytes
    images.push({
      id,
      mimeType: attachment.mimeType ?? 'image/*',
      dataUrl: attachment.data,
      bytes: imageBytes,
    })
  }

  return { images, notices }
}

export function buildImageAttachmentContext(content, attachments = [], { maxBytes = MAX_IMAGE_CONTEXT_BYTES, maxImages = Infinity, includeImageData = true } = {}) {
  const { images, notices } = collectImageAttachments(content, attachments, { maxBytes, maxImages })
  const parts = [
    ...images.map(image => [
      `- ${image.id}`,
      `  MIME: ${image.mimeType}`,
      includeImageData ? `  Data URL: ${image.dataUrl}` : '  Data URL: sent as structured vision input',
    ].join('\n')),
    ...notices,
  ]

  return parts.length ? `[Attached Images]\n${parts.join('\n')}` : ''
}

export function appendImageAttachmentContext(context, content, attachments, options) {
  const imageContext = buildImageAttachmentContext(content, attachments, options)
  if (!imageContext) return context
  return context ? `${context}\n\n${imageContext}` : imageContext
}

export function buildNoteLLMContext(note, { maxChars = MAX_NOTE_CONTEXT_CHARS, attachments = [], includeImageData = true } = {}) {
  if (!note) return ''

  const summary = String(note.content ?? '').trim()
  if (!isOpenApiNote(note)) {
    return appendImageAttachmentContext(truncateContext(summary, maxChars), summary, attachments, { includeImageData })
  }

  const rawText = getOpenApiRawText(note).trim()
  if (!rawText) return appendImageAttachmentContext(truncateContext(summary, maxChars), summary, attachments, { includeImageData })

  const fileName = note.noteData?.fileName ? `File: ${note.noteData.fileName}\n\n` : ''
  const context = [
    summary ? `OpenAPI note summary:\n${summary}` : '',
    `${fileName}OpenAPI JSON specification:\n\`\`\`json\n${rawText}\n\`\`\``,
  ].filter(Boolean).join('\n\n')

  return appendImageAttachmentContext(truncateContext(context, maxChars), summary, attachments, { includeImageData })
}

const MAX_REFERENCED_NOTE_CHARS = 6000

export function buildReferencedNotesContext(notes, { getAttachmentsForNote = () => [], includeImageData = true } = {}) {
  if (!notes?.length) return ''
  const parts = notes.map(note => {
    const title = String(note.content ?? '').split('\n')[0].slice(0, 80) || 'Untitled'
    const content = String(note.content ?? '').trim()
    const body = appendImageAttachmentContext(
      truncateContext(content, MAX_REFERENCED_NOTE_CHARS),
      content,
      getAttachmentsForNote(note) ?? [],
      { includeImageData }
    )
    return `=== ${title} ===\n${body}\n===`
  })
  return `[Referenced Notes]\n\n${parts.join('\n\n')}`
}

export function buildAllNotesLLMContext(notes, { maxChars = MAX_ALL_NOTES_CONTEXT_CHARS, getAttachmentsForNote = () => [], includeImageData = true } = {}) {
  const parts = []
  let total = 0

  for (const note of (notes ?? [])) {
    const context = buildNoteLLMContext(note, { attachments: getAttachmentsForNote(note) ?? [], includeImageData })
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
