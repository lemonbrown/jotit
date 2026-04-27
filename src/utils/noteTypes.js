export const NOTE_TYPE_TEXT = 'text'
export const NOTE_TYPE_SQLITE = 'sqlite'
export const NOTE_TYPE_OPENAPI = 'openapi'

const VALID_NOTE_TYPES = new Set([NOTE_TYPE_TEXT, NOTE_TYPE_SQLITE, NOTE_TYPE_OPENAPI])

export function normalizeNoteType(noteType) {
  return VALID_NOTE_TYPES.has(noteType) ? noteType : NOTE_TYPE_TEXT
}

export function isSQLiteNote(note) {
  return normalizeNoteType(note?.noteType) === NOTE_TYPE_SQLITE
}

export function isOpenApiNote(note) {
  return normalizeNoteType(note?.noteType) === NOTE_TYPE_OPENAPI
}

export function getPublicCloneInfo(note) {
  const clone = note?.noteData?.publicClone
  return clone && typeof clone === 'object' ? clone : null
}

export function isPublicClone(note) {
  return Boolean(getPublicCloneInfo(note))
}

export function getOpenApiDocument(note) {
  if (!isOpenApiNote(note) || !note?.noteData || typeof note.noteData !== 'object') return null
  return note.noteData
}

export function getNoteTitle(note) {
  if (!note) return 'empty'

  const openApiDoc = getOpenApiDocument(note)
  if (openApiDoc?.title?.trim()) return openApiDoc.title.trim()

  const lines = String(note.content ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  return lines[0] ?? 'empty'
}

export function getOpenApiSearchText(document) {
  if (!document) return ''

  const lines = [
    document.title,
    document.version ? `Version ${document.version}` : '',
    document.description ?? '',
    ...(document.tags ?? []),
    ...(document.operations ?? []).flatMap(operation => [
      operation.id,
      operation.summary,
      operation.description,
      operation.method,
      operation.path,
      ...(operation.tags ?? []),
      ...(operation.parameters ?? []).map(param => `${param.in} ${param.name}`),
      ...(operation.responses ? Object.keys(operation.responses).map(code => `response ${code}`) : []),
    ]),
  ]

  return lines.filter(Boolean).join('\n')
}
