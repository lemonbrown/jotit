import { generateId } from './helpers.js'
import { NOTE_TYPE_SQLITE } from './noteTypes.js'

const SQLITE_MARKER_RE = /\[sqlite:\/\/([A-Za-z0-9_-]+)\]/

function fileLabel(fileName = 'database.sqlite') {
  return fileName.trim() || 'database.sqlite'
}

export function buildSQLiteMarker(assetId) {
  return `[sqlite://${assetId}]`
}

export function extractSQLiteAssetRef(content = '') {
  const match = content.match(SQLITE_MARKER_RE)
  if (!match) return null
  return { assetId: match[1] }
}

export function createImportedSQLiteNote(fileName, assetId) {
  const now = Date.now()
  const label = fileLabel(fileName)
  return {
    id: generateId(),
    content: `${label}\n${buildSQLiteMarker(assetId)}\n\nLocal SQLite database file.\nOpen SQLite view to inspect schema and tables.`,
    categories: ['sqlite'],
    embedding: null,
    isPublic: false,
    noteType: NOTE_TYPE_SQLITE,
    noteData: null,
    createdAt: now,
    updatedAt: now,
  }
}
