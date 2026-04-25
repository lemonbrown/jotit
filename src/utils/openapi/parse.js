import { normalizeOpenApiDocument } from './normalize.js'

export function parseOpenApiJson(rawText) {
  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error('OpenAPI import currently supports JSON files only')
  }

  const normalized = normalizeOpenApiDocument(parsed)
  return {
    rawText,
    spec: parsed,
    normalized,
  }
}

export function looksLikeOpenApiJsonFile(fileName, text) {
  if (!String(fileName ?? '').toLowerCase().endsWith('.json')) return false
  try {
    const parsed = JSON.parse(text)
    return typeof parsed?.openapi === 'string' && parsed.openapi.startsWith('3.')
  } catch {
    return false
  }
}
