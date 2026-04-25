import {
  getAllNoteChunks,
  getAllNoteEntities,
  getSearchMetadataMap,
} from './db.js'
import {
  mergeSemanticSearchResults,
  searchNotesWithArtifacts,
  searchSnippetsLocally,
} from './searchCore.js'

export { mergeSemanticSearchResults, searchSnippetsLocally }

export function searchNotesLocallyDetailed(notes, query) {
  return searchNotesWithArtifacts(notes, query, {
    chunks: getAllNoteChunks(),
    entities: getAllNoteEntities(),
    metadataByNote: getSearchMetadataMap(),
  })
}

export function searchNotesLocally(notes, query) {
  return searchNotesLocallyDetailed(notes, query).map(result => result.note)
}
