import { getDb } from './_instance.js'

function deserializeChunk(row) {
  return {
    id: row.id,
    noteId: row.note_id,
    content: row.content,
    kind: row.kind ?? 'prose',
    sectionTitle: row.section_title ?? null,
    startOffset: row.start_offset ?? 0,
    endOffset: row.end_offset ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function deserializeEntity(row) {
  return {
    id: row.id,
    noteId: row.note_id,
    chunkId: row.chunk_id ?? null,
    entityType: row.entity_type,
    entityValue: row.entity_value,
    normalizedValue: row.normalized_value,
  }
}

function deserializeSearchMetadata(row) {
  return {
    noteId: row.note_id,
    keywords: JSON.parse(row.keywords ?? '[]'),
    facets: JSON.parse(row.facets ?? '[]'),
    lastIndexedAt: row.last_indexed_at ?? 0,
  }
}

export function replaceNoteSearchArtifacts(noteId, { chunks = [], entities = [], metadata = null }) {
  const db = getDb()
  if (!db || !noteId) return

  db.run('DELETE FROM note_chunks WHERE note_id = ?', [noteId])
  db.run('DELETE FROM note_entities WHERE note_id = ?', [noteId])
  db.run('DELETE FROM search_metadata WHERE note_id = ?', [noteId])

  for (const chunk of chunks) {
    db.run(
      `INSERT INTO note_chunks
         (id, note_id, content, kind, section_title, start_offset, end_offset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chunk.id,
        chunk.noteId,
        chunk.content,
        chunk.kind,
        chunk.sectionTitle ?? null,
        chunk.startOffset ?? 0,
        chunk.endOffset ?? 0,
        chunk.createdAt ?? Date.now(),
        chunk.updatedAt ?? Date.now(),
      ]
    )
  }

  for (const entity of entities) {
    db.run(
      `INSERT INTO note_entities
         (id, note_id, chunk_id, entity_type, entity_value, normalized_value)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entity.id,
        entity.noteId,
        entity.chunkId ?? null,
        entity.entityType,
        entity.entityValue,
        entity.normalizedValue,
      ]
    )
  }

  if (metadata) {
    db.run(
      `INSERT INTO search_metadata
         (note_id, keywords, facets, last_indexed_at)
       VALUES (?, ?, ?, ?)`,
      [
        metadata.noteId,
        JSON.stringify(metadata.keywords ?? []),
        JSON.stringify(metadata.facets ?? []),
        metadata.lastIndexedAt ?? Date.now(),
      ]
    )
  }
}

export function deleteNoteSearchArtifacts(noteId) {
  const db = getDb()
  if (!db) return
  db.run('DELETE FROM note_chunks WHERE note_id = ?', [noteId])
  db.run('DELETE FROM note_entities WHERE note_id = ?', [noteId])
  db.run('DELETE FROM search_metadata WHERE note_id = ?', [noteId])
}

export function getAllNoteChunks() {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT * FROM note_chunks')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const chunk = {}
    columns.forEach((col, i) => { chunk[col] = row[i] })
    return deserializeChunk(chunk)
  })
}

export function getAllNoteEntities() {
  const db = getDb()
  if (!db) return []
  const result = db.exec('SELECT * FROM note_entities')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const entity = {}
    columns.forEach((col, i) => { entity[col] = row[i] })
    return deserializeEntity(entity)
  })
}

export function getSearchMetadataMap() {
  const db = getDb()
  if (!db) return new Map()
  const result = db.exec('SELECT * FROM search_metadata')
  if (!result.length) return new Map()
  const { columns, values } = result[0]
  return new Map(values.map(row => {
    const metadata = {}
    columns.forEach((col, i) => { metadata[col] = row[i] })
    const deserialized = deserializeSearchMetadata(metadata)
    return [deserialized.noteId, deserialized]
  }))
}
