import { useEffect } from 'react'
import {
  getAllNotes,
  getSearchMetadataMap,
  getAllSnippets,
  initDB,
  replaceNoteSearchArtifacts,
  schedulePersist,
  upsertNoteSync,
} from '../utils/db'
import { scheduleSyncPush, syncAll, syncPull } from '../utils/sync'
import {
  categorizeByPatterns,
} from '../utils/patternCategories'
import { NOTE_TYPE_TEXT } from '../utils/noteTypes'
import { buildNoteSearchArtifacts } from '../utils/searchIndex'
import { ALL_COLLECTION_ID } from '../utils/collectionFactories'

export function useAppLifecycle({
  dbReady,
  notesRef,
  setDbReady,
  setNotes,
  setSnippets,
  settings,
  showSinglePaneForNote,
  snippetsRef,
  user,
  loadCollections,
  refreshCollections,
}) {
  useEffect(() => {
    initDB().then(() => {
      const collectionState = loadCollections?.()
      const loaded = getAllNotes()
      setNotes(loaded)
      setSnippets(getAllSnippets())
      const activeCollectionId = collectionState?.activeCollectionId
      const firstNote = activeCollectionId && activeCollectionId !== ALL_COLLECTION_ID
        ? loaded.find(note => note.collectionId === activeCollectionId)
        : loaded[0]
      showSinglePaneForNote(firstNote?.id ?? null)
      setDbReady(true)
    }).catch(err => {
      console.error('[jot.it] DB init failed:', err)
      setDbReady(true)
    })
  }, [loadCollections, setDbReady, setNotes, setSnippets, showSinglePaneForNote])

  useEffect(() => {
    if (!dbReady) return

    const metadataByNoteId = getSearchMetadataMap()
    const staleNotes = notesRef.current.filter(note => {
      const metadata = metadataByNoteId.get(note.id)
      return !metadata || metadata.lastIndexedAt < (note.updatedAt ?? 0)
    })

    if (!staleNotes.length) return

    let cancelled = false
    const batchSize = 25

    const processBatch = (startIndex = 0) => {
      if (cancelled) return

      const batch = staleNotes.slice(startIndex, startIndex + batchSize)
      for (const note of batch) {
        const artifacts = buildNoteSearchArtifacts(note)
        replaceNoteSearchArtifacts(note.id, artifacts)
      }

      schedulePersist()

      if (startIndex + batchSize < staleNotes.length) {
        setTimeout(() => processBatch(startIndex + batchSize), 0)
      }
    }

    processBatch()
    return () => { cancelled = true }
  }, [dbReady, notesRef])

  useEffect(() => {
    if (!dbReady) return

    const uncategorized = notesRef.current.filter(
      note => (note.noteType ?? NOTE_TYPE_TEXT) === NOTE_TYPE_TEXT && !note.categories.length && note.content.trim()
    )
    if (!uncategorized.length) return

    const changes = []
    for (const note of uncategorized) {
      const categories = categorizeByPatterns(note.content)
      if (!categories.length) continue
      const updated = { ...note, categories }
      upsertNoteSync(updated)
      const patternArtifacts = buildNoteSearchArtifacts(updated)
      replaceNoteSearchArtifacts(updated.id, patternArtifacts)
      changes.push(updated)
    }

    if (!changes.length) return

    const byId = Object.fromEntries(changes.map(note => [note.id, note]))
    setNotes(prev => prev.map(note => byId[note.id] ?? note))
    schedulePersist()
    scheduleSyncPush()
  }, [dbReady, notesRef, setNotes])

  useEffect(() => {
    if (!dbReady || !user) return
    syncAll().then(() => {
      refreshCollections?.()
      setNotes(getAllNotes())
    })
  }, [dbReady, refreshCollections, setNotes, user])

  useEffect(() => {
    if (!user) return
    const onFocus = () => syncPull().then(() => {
      refreshCollections?.()
      setNotes(getAllNotes())
    })
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshCollections, setNotes, user])
}
