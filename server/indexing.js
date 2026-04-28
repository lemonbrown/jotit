import { buildNoteSearchArtifacts } from '../src/utils/searchIndex.js'
import { getOpenApiDocument, getOpenApiSearchText, isOpenApiNote } from '../src/utils/noteTypes.js'

export async function deleteNoteArtifacts(pgPool, noteId, userId) {
  await pgPool.query('DELETE FROM note_chunks WHERE note_id = $1 AND user_id = $2', [noteId, userId])
  await pgPool.query('DELETE FROM note_chunk_embeddings WHERE note_id = $1 AND user_id = $2', [noteId, userId])
  await pgPool.query('DELETE FROM note_entities WHERE note_id = $1 AND user_id = $2', [noteId, userId])
  await pgPool.query('DELETE FROM search_metadata WHERE note_id = $1 AND user_id = $2', [noteId, userId])
}

export async function persistArtifactSet(pgPool, userId, artifactSet) {
  const { noteId, chunks = [], entities = [], metadata = null } = artifactSet ?? {}
  if (!noteId || typeof noteId !== 'string') return false

  await deleteNoteArtifacts(pgPool, noteId, userId)

  for (const chunk of chunks) {
    await pgPool.query(
      `INSERT INTO note_chunks
         (id, note_id, user_id, content, kind, section_title, start_offset, end_offset, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        chunk.id, noteId, userId,
        chunk.content, chunk.kind ?? 'prose', chunk.sectionTitle ?? null,
        chunk.startOffset ?? 0, chunk.endOffset ?? 0,
        chunk.createdAt ?? Date.now(), chunk.updatedAt ?? Date.now(),
      ]
    )
  }

  for (const entity of entities) {
    await pgPool.query(
      `INSERT INTO note_entities
         (id, note_id, user_id, chunk_id, entity_type, entity_value, normalized_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entity.id, noteId, userId,
        entity.chunkId ?? null,
        entity.entityType, entity.entityValue, entity.normalizedValue,
      ]
    )
  }

  if (metadata) {
    await pgPool.query(
      `INSERT INTO search_metadata (note_id, user_id, keywords, facets, last_indexed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        noteId, userId,
        JSON.stringify(metadata.keywords ?? []),
        JSON.stringify(metadata.facets ?? []),
        metadata.lastIndexedAt ?? Date.now(),
      ]
    )
  }

  return true
}

async function persistChunkEmbeddings(pgPool, userId, noteId, chunkEmbeddings = []) {
  if (!noteId) return

  for (const chunk of chunkEmbeddings) {
    if (!chunk.embedding?.length) continue
    await pgPool.query(
      `INSERT INTO note_chunk_embeddings
         (chunk_id, note_id, user_id, embedding, model, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        chunk.chunkId,
        noteId,
        userId,
        JSON.stringify(chunk.embedding),
        chunk.model ?? 'text-embedding-3-small',
        chunk.updatedAt ?? Date.now(),
      ]
    )
  }
}

export async function indexNoteOnServer(pgPool, aiService, userId, note) {
  if (!pgPool || !note?.id || typeof note.id !== 'string') return null

  const normalizedNote = {
    id: note.id,
    content: String(note.content ?? ''),
    categories: JSON.parse(note.categories ?? '[]'),
    noteType: note.note_type ?? 'text',
    noteData: note.note_data ? JSON.parse(note.note_data) : null,
    createdAt: note.created_at ?? Date.now(),
    updatedAt: note.updated_at ?? Date.now(),
  }

  const artifacts = buildNoteSearchArtifacts(normalizedNote)
  await persistArtifactSet(pgPool, userId, { noteId: note.id, ...artifacts })

  let noteEmbedding = null
  let chunkEmbeddings = []
  const embeddingSource = isOpenApiNote(normalizedNote)
    ? `${normalizedNote.content}\n${getOpenApiSearchText(getOpenApiDocument(normalizedNote)?.document)}`.trim()
    : normalizedNote.content

  if (aiService?.isConfigured() && embeddingSource.trim()) {
    noteEmbedding = await aiService.getEmbedding(embeddingSource)

    const chunkVectors = await aiService.getEmbeddings(artifacts.chunks.map(chunk => chunk.content))
    chunkEmbeddings = artifacts.chunks
      .map((chunk, index) => {
        const embedding = chunkVectors[index] ?? null
        if (!embedding) return null
        return {
          chunkId: chunk.id,
          embedding,
          model: aiService.embeddingModel?.() ?? 'text-embedding-3-small',
          updatedAt: normalizedNote.updatedAt,
        }
      })
      .filter(Boolean)
  }

  await persistChunkEmbeddings(pgPool, userId, note.id, chunkEmbeddings)
  await pgPool.query(
    'UPDATE notes SET embedding = $1 WHERE id = $2 AND user_id = $3',
    [noteEmbedding ? JSON.stringify(noteEmbedding) : null, note.id, userId]
  )

  return {
    noteEmbedding,
    artifacts,
    chunkEmbeddings,
  }
}
