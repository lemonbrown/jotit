import { useCallback } from 'react'
import {
  deleteNoteSearchArtifacts,
  deleteNoteSync,
  deleteSnippetSync,
  markPendingDelete,
  replaceNoteSearchArtifacts,
  schedulePersist,
  upsertNoteSync,
  upsertSnippetSync,
} from '../utils/db'
import { scheduleSyncPush } from '../utils/sync'
import { createSnippetDraft } from '../utils/noteFactories'
import { buildNoteSearchArtifacts } from '../utils/searchIndex'
import { ALL_COLLECTION_ID } from '../utils/collectionFactories'

export function useNoteMutations({
  notesRef,
  resetWorkspace,
  removeNoteFromWorkspace,
  setNotes,
  setSnippets,
  user,
  activeCollectionId,
  newNoteCollectionId,
}) {
  const updateNote = useCallback((id, updates) => {
    setNotes(prev => {
      const next = prev.map(note => {
        if (note.id !== id) return note
        const updated = { ...note, ...updates, updatedAt: Date.now() }
        upsertNoteSync(updated)
        const searchArtifacts = buildNoteSearchArtifacts(updated)
        replaceNoteSearchArtifacts(updated.id, searchArtifacts)
        return updated
      })
      schedulePersist()
      scheduleSyncPush()
      return next
    })
  }, [setNotes])

  const createSnippet = useCallback(async ({ content, name = '', sourceNoteId = null }) => {
    const snippet = createSnippetDraft({ content, name, sourceNoteId })
    if (!snippet) return null

    upsertSnippetSync(snippet)
    schedulePersist()
    setSnippets(prev => [snippet, ...prev])

    return snippet
  }, [setSnippets])

  const updateSnippet = useCallback((id, updates) => {
    setSnippets(prev => {
      const next = prev.map(snippet => {
        if (snippet.id !== id) return snippet
        const updated = {
          ...snippet,
          ...updates,
          name: updates.name ?? snippet.name ?? '',
          updatedAt: Date.now(),
        }
        upsertSnippetSync(updated)
        return updated
      })
      schedulePersist()
      return next
    })
  }, [setSnippets])

  const deleteSnippet = useCallback((id) => {
    deleteSnippetSync(id)
    schedulePersist()
    setSnippets(prev => prev.filter(snippet => snippet.id !== id))
  }, [setSnippets])

  const deleteNote = useCallback((id) => {
    if (user) {
      markPendingDelete(id)
      deleteNoteSearchArtifacts(id)
      scheduleSyncPush()
    } else {
      deleteNoteSync(id)
    }

    schedulePersist()
    setNotes(prev => {
      const idx = prev.findIndex(note => note.id === id)
      const next = prev.filter(note => note.id !== id)
      const fallbackId = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null
      removeNoteFromWorkspace(id, fallbackId)
      return next
    })
  }, [removeNoteFromWorkspace, setNotes, user])

  const deleteAllNotes = useCallback(() => {
    const currentNotes = notesRef.current.filter(note => (
      !activeCollectionId ||
      activeCollectionId === ALL_COLLECTION_ID ||
      note.collectionId === activeCollectionId
    ))
    if (!currentNotes.length) return

    if (user) {
      for (const note of currentNotes) {
        markPendingDelete(note.id)
        deleteNoteSearchArtifacts(note.id)
      }
      scheduleSyncPush()
    } else {
      for (const note of currentNotes) {
        deleteNoteSync(note.id)
      }
    }

    schedulePersist()
    setNotes(prev => activeCollectionId === ALL_COLLECTION_ID
      ? []
      : prev.filter(note => activeCollectionId && note.collectionId !== activeCollectionId)
    )
    resetWorkspace()
  }, [activeCollectionId, notesRef, resetWorkspace, setNotes, user])

  const addNote = useCallback((note) => {
    const prepared = { ...note, collectionId: note.collectionId ?? newNoteCollectionId ?? activeCollectionId ?? 'default' }
    upsertNoteSync(prepared)
    schedulePersist()
    scheduleSyncPush()
    setNotes(prev => [prepared, ...prev])
    return prepared
  }, [activeCollectionId, newNoteCollectionId, setNotes])

  const seedNotes = useCallback((seedNotesInput) => {
    const prepared = (seedNotesInput ?? [])
      .filter(note => note?.id && note.content?.trim())
      .map(note => ({ ...note, collectionId: note.collectionId ?? newNoteCollectionId ?? activeCollectionId ?? 'default' }))
    if (!prepared.length) return []

    for (const note of prepared) {
      upsertNoteSync(note)
      const searchArtifacts = buildNoteSearchArtifacts(note)
      replaceNoteSearchArtifacts(note.id, searchArtifacts)
    }

    schedulePersist()
    scheduleSyncPush()
    setNotes(prev => [...prepared, ...prev])
    return prepared
  }, [activeCollectionId, newNoteCollectionId, setNotes])

  return {
    addNote,
    createSnippet,
    deleteAllNotes,
    deleteNote,
    deleteSnippet,
    seedNotes,
    updateNote,
    updateSnippet,
  }
}
