import { understandQuery } from '../src/utils/queryUnderstanding.js'
import { mergeChunkSemanticResults, mergeSemanticSearchResults, searchNotesWithArtifacts } from '../src/utils/searchCore.js'
import { logServerError, sendJsonError } from './http.js'

export function registerSearchRoutes(app, { aiService, pgPool, requireAuth }) {
  app.get('/api/search', requireAuth, async (req, res) => {
    if (!pgPool) return sendJsonError(res, 503, 'Search not configured')

    const query = (req.query.q ?? '').trim()
    if (!query) return res.json({ results: [] })

    const limit = Math.min(parseInt(req.query.limit ?? '20', 10) || 20, 50)
    const userId = req.user.userId

    try {
      const queryInfo = understandQuery(query)
      const termPatterns = queryInfo.expandedTerms.slice(0, 12).map(t => `%${t}%`)

      // Broad recall: candidate notes matching any expanded term across artifact tables
      const { rows: candidateRows } = await pgPool.query(`
        SELECT DISTINCT n.id
        FROM notes n
        LEFT JOIN note_chunks nc ON nc.note_id = n.id AND nc.user_id = $1
        LEFT JOIN note_entities ne ON ne.note_id = n.id AND ne.user_id = $1
        LEFT JOIN search_metadata sm ON sm.note_id = n.id AND sm.user_id = $1
        WHERE n.user_id = $1
          AND n.deleted_at IS NULL
          AND (
            n.content ILIKE ANY($2)
            OR n.categories ILIKE ANY($2)
            OR nc.content ILIKE ANY($2)
            OR ne.normalized_value ILIKE ANY($2)
            OR sm.keywords ILIKE ANY($2)
            OR sm.facets ILIKE ANY($2)
          )
        LIMIT 200
      `, [userId, termPatterns])

      const noteIds = [...new Set(candidateRows.map(r => r.id))]
      const shouldAddSemanticCandidates = aiService?.isConfigured()
      const queryEmbedding = shouldAddSemanticCandidates ? await aiService.getEmbedding(query) : null

      if (!noteIds.length && !queryEmbedding?.length) {
        return res.json({ results: [], query: queryInfo.normalizedQuery })
      }

      if (queryEmbedding?.length) {
        const { rows: semanticCandidateRows } = await pgPool.query(
          `SELECT id
           FROM notes
           WHERE user_id = $1
             AND deleted_at IS NULL
             AND embedding IS NOT NULL
           ORDER BY updated_at DESC
           LIMIT 200`,
          [userId]
        )
        for (const row of semanticCandidateRows) {
          if (!noteIds.includes(row.id)) noteIds.push(row.id)
        }
      }

      // Fetch full note data + all artifacts for candidates
      const [notesResult, chunksResult, chunkEmbeddingsResult, entitiesResult, metadataResult] = await Promise.all([
        pgPool.query('SELECT * FROM notes WHERE user_id = $1 AND id = ANY($2)', [userId, noteIds]),
        pgPool.query('SELECT * FROM note_chunks WHERE user_id = $1 AND note_id = ANY($2)', [userId, noteIds]),
        pgPool.query('SELECT * FROM note_chunk_embeddings WHERE user_id = $1 AND note_id = ANY($2)', [userId, noteIds]),
        pgPool.query('SELECT * FROM note_entities WHERE user_id = $1 AND note_id = ANY($2)', [userId, noteIds]),
        pgPool.query('SELECT * FROM search_metadata WHERE user_id = $1 AND note_id = ANY($2)', [userId, noteIds]),
      ])

      const notes = notesResult.rows.map(deserializeNote)
      const chunks = chunksResult.rows.map(deserializeChunk)
      const chunkEmbeddings = chunkEmbeddingsResult.rows.map(deserializeChunkEmbedding)
      const entities = entitiesResult.rows.map(deserializeEntity)
      const metadataByNote = new Map(
        metadataResult.rows.map(row => {
          const md = deserializeMetadata(row)
          return [md.noteId, md]
        })
      )

      let ranked = searchNotesWithArtifacts(notes, query, { chunks, entities, metadataByNote })

      if (queryEmbedding?.length) {
        const chunkSemantic = chunkEmbeddings
          .map(entry => {
            const chunk = chunks.find(candidate => candidate.id === entry.chunkId)
            if (!chunk || !entry.embedding?.length) return null
            return {
              noteId: entry.noteId,
              chunkId: entry.chunkId,
              sectionTitle: chunk.sectionTitle ?? null,
              kind: chunk.kind ?? null,
              content: chunk.content,
              similarity: aiService.cosineSimilarity(queryEmbedding, entry.embedding),
            }
          })
          .filter(Boolean)
          .filter(entry => entry.similarity > 0.2)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 12)

        ranked = mergeChunkSemanticResults(
          ranked,
          chunkSemantic,
          new Map(notes.map(note => [note.id, note]))
        )

        if (aiService?.isConfigured()) {
          const semanticNotes = notes
            .filter(note => note.embedding?.length)
            .map(note => ({ note, score: aiService.cosineSimilarity(queryEmbedding, note.embedding) }))
            .filter(entry => entry.score > 0.25)
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(limit, 10))
            .map(entry => entry.note)

          ranked = mergeSemanticSearchResults(ranked, semanticNotes)
        }
      }

      const results = ranked.slice(0, limit).map(r => ({
        noteId: r.noteId,
        score: r.score,
        matchType: r.matchType,
        matchedSectionTitle: r.matchedSectionTitle,
        matchedChunkKind: r.matchedChunkKind,
        preview: r.preview,
        reasons: r.reasons,
        entityHits: r.entityHits,
        note: {
          id: r.note.id,
          content: r.note.content,
          categories: r.note.categories,
          noteType: r.note.noteType,
          createdAt: r.note.createdAt,
          updatedAt: r.note.updatedAt,
          isPublic: r.note.isPublic,
        },
      }))

      res.json({ results, query: queryInfo.normalizedQuery })
    } catch (e) {
      logServerError('[JotIt] Search error:', e)
      sendJsonError(res, 500, 'Search failed')
    }
  })
}

function deserializeNote(row) {
  return {
    id: row.id,
    content: row.content,
    categories: JSON.parse(row.categories ?? '[]'),
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
    noteType: row.note_type ?? 'text',
    noteData: row.note_data ? JSON.parse(row.note_data) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    isPublic: row.is_public === 1,
  }
}

function deserializeChunk(row) {
  return {
    id: row.id,
    noteId: row.note_id,
    content: row.content,
    kind: row.kind ?? 'prose',
    sectionTitle: row.section_title ?? null,
    startOffset: row.start_offset ?? 0,
    endOffset: row.end_offset ?? 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
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

function deserializeMetadata(row) {
  return {
    noteId: row.note_id,
    keywords: JSON.parse(row.keywords ?? '[]'),
    facets: JSON.parse(row.facets ?? '[]'),
    lastIndexedAt: Number(row.last_indexed_at ?? 0),
  }
}

function deserializeChunkEmbedding(row) {
  return {
    chunkId: row.chunk_id,
    noteId: row.note_id,
    embedding: JSON.parse(row.embedding ?? '[]'),
    model: row.model ?? 'text-embedding-3-small',
    updatedAt: Number(row.updated_at ?? 0),
  }
}
