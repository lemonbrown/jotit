export { initDB, schedulePersist, persist } from './db/core.js'
export {
  ensureDefaultCollection,
  getDefaultCollection,
  getAllCollections,
  getDirtyCollections,
  upsertCollectionSync,
  setCollectionPublic,
  setNoteCollectionExcluded,
  markCollectionPendingDelete,
  deleteCollectionSync,
  moveNoteToCollection,
  markCollectionsSynced,
  cleanupPendingCollectionDeletes,
} from './db/collections.js'
export {
  getAllNotes,
  getNotesForCollection,
  upsertNoteSync,
  markPendingDelete,
  cleanupPendingDeletes,
  getNote,
  getDirtyNotes,
  setSyncIncluded,
  setSyncExcluded,
  setAllSyncExcluded,
  markSynced,
  deleteNoteSync,
} from './db/notes.js'
export {
  replaceNoteSearchArtifacts,
  deleteNoteSearchArtifacts,
  getAllNoteChunks,
  getAllNoteEntities,
  getSearchMetadataMap,
} from './db/search.js'
export {
  getAllSnippets,
  upsertSnippetSync,
  deleteSnippetSync,
  getAllTemplates,
  upsertTemplateSync,
  deleteTemplateSync,
} from './db/snippets.js'
export {
  insertAttachment,
  getAttachmentsForNote,
  deleteAttachment,
  deleteAttachmentsForNote,
  pinNote,
  unpinNote,
  getAllPins,
  exportSQLite,
} from './db/attachments.js'
