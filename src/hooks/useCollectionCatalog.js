import { useCallback, useMemo, useState } from 'react'
import {
  deleteCollectionSync,
  getAllCollections,
  getDefaultCollection,
  markCollectionPendingDelete,
  moveNoteToCollection as moveNoteToCollectionSync,
  schedulePersist,
  upsertCollectionSync,
} from '../utils/db'
import { ALL_COLLECTION_ID, createCollectionDraft } from '../utils/collectionFactories'
import { scheduleSyncPush } from '../utils/sync'

const ACTIVE_COLLECTION_KEY = 'jotit_active_collection_id'

export function useCollectionCatalog({ notesRef, setNotes, resetWorkspace, showSinglePaneForNote, user }) {
  const [collections, setCollections] = useState([])
  const [activeCollectionId, setActiveCollectionIdState] = useState(null)

  const activeCollection = useMemo(
    () => activeCollectionId === ALL_COLLECTION_ID
      ? { id: ALL_COLLECTION_ID, name: 'All notes', isVirtual: true }
      : collections.find(collection => collection.id === activeCollectionId) ?? collections[0] ?? null,
    [activeCollectionId, collections]
  )

  const setActiveCollectionId = useCallback((collectionId) => {
    setActiveCollectionIdState(collectionId)
    if (collectionId) localStorage.setItem(ACTIVE_COLLECTION_KEY, collectionId)
  }, [])

  const loadCollections = useCallback(() => {
    const loaded = getAllCollections()
    setCollections(loaded)

    const storedId = localStorage.getItem(ACTIVE_COLLECTION_KEY)
    const defaultId = getDefaultCollection()?.id ?? loaded[0]?.id ?? null
    const canUseAllNotes = loaded.length > 1
    const nextActiveId = storedId === ALL_COLLECTION_ID && canUseAllNotes
      ? ALL_COLLECTION_ID
      : loaded.some(collection => collection.id === storedId) ? storedId : defaultId
    setActiveCollectionIdState(nextActiveId)
    if (nextActiveId) localStorage.setItem(ACTIVE_COLLECTION_KEY, nextActiveId)
    return { collections: loaded, activeCollectionId: nextActiveId }
  }, [])

  const refreshCollections = useCallback(() => {
    setCollections(getAllCollections())
  }, [])

  const createCollection = useCallback((name) => {
    const collection = createCollectionDraft({ name })
    if (!collection) return null

    upsertCollectionSync(collection)
    schedulePersist()
    scheduleSyncPush()
    setCollections(prev => [collection, ...prev])
    setActiveCollectionId(collection.id)
    resetWorkspace()
    return collection
  }, [resetWorkspace, setActiveCollectionId])

  const renameCollection = useCallback((id, name) => {
    const trimmed = name?.trim()
    if (!id || !trimmed) return null

    let updated = null
    setCollections(prev => prev.map(collection => {
      if (collection.id !== id) return collection
      updated = { ...collection, name: trimmed, updatedAt: Date.now() }
      upsertCollectionSync(updated)
      return updated
    }))

    if (updated) {
      schedulePersist()
      scheduleSyncPush()
    }

    return updated
  }, [])

  const deleteCollection = useCallback((id) => {
    const target = collections.find(collection => collection.id === id)
    if (!target || target.isDefault) return null

    const fallback = collections.find(collection => collection.isDefault) ?? collections.find(collection => collection.id !== id)
    if (!fallback) return null

    if (user) {
      markCollectionPendingDelete(id)
    } else {
      deleteCollectionSync(id)
    }

    const now = Date.now()
    setNotes(prev => prev.map(note => note.collectionId === id ? { ...note, collectionId: fallback.id, updatedAt: now } : note))
    setCollections(prev => prev.filter(collection => collection.id !== id))
    setActiveCollectionId(fallback.id)
    resetWorkspace()
    showSinglePaneForNote(notesRef.current.find(note => note.collectionId === fallback.id)?.id ?? null)
    schedulePersist()
    scheduleSyncPush()
    return fallback
  }, [collections, notesRef, resetWorkspace, setActiveCollectionId, setNotes, showSinglePaneForNote, user])

  const moveNoteToCollection = useCallback((noteId, collectionId) => {
    if (!noteId || !collectionId) return
    const now = Date.now()
    moveNoteToCollectionSync(noteId, collectionId)
    setNotes(prev => prev.map(note => note.id === noteId ? { ...note, collectionId, updatedAt: now } : note))
    schedulePersist()
    scheduleSyncPush()
  }, [setNotes])

  return {
    activeCollection,
    activeCollectionId,
    collections,
    createCollection,
    deleteCollection,
    loadCollections,
    moveNoteToCollection,
    refreshCollections,
    renameCollection,
    setActiveCollectionId,
  }
}
