import { useCallback, useRef, useState } from 'react'
import { generateId } from '../utils/helpers'

export function useNoteWorkspace() {
  const [activeNoteId, setActiveNoteId] = useState(null)
  const [editorPanes, setEditorPanes] = useState([])
  const [activePaneId, setActivePaneId] = useState(null)
  const [restoreLocation, setRestoreLocation] = useState(null)
  const [locationHistory, setLocationHistory] = useState([])
  const [locationHistoryIndex, setLocationHistoryIndex] = useState(-1)

  const locationHistoryRef = useRef(locationHistory)
  const locationHistoryIndexRef = useRef(locationHistoryIndex)
  const suppressLocationCaptureRef = useRef(false)

  const commitLocationHistory = useCallback((next, nextIndex) => {
    locationHistoryRef.current = next
    locationHistoryIndexRef.current = nextIndex
    setLocationHistory(next)
    setLocationHistoryIndex(nextIndex)
  }, [])

  const resetWorkspace = useCallback(() => {
    setActiveNoteId(null)
    setEditorPanes([])
    setActivePaneId(null)
    setRestoreLocation(null)
    locationHistoryRef.current = []
    locationHistoryIndexRef.current = -1
    setLocationHistory([])
    setLocationHistoryIndex(-1)
  }, [])

  const showSinglePaneForNote = useCallback((noteId) => {
    setActiveNoteId(noteId)
    if (!noteId) {
      setEditorPanes([])
      setActivePaneId(null)
      return
    }

    const paneId = generateId()
    setEditorPanes([{ id: paneId, type: 'note', noteId }])
    setActivePaneId(paneId)
  }, [])

  const recordLocation = useCallback((location, { replaceCurrent = false } = {}) => {
    if (suppressLocationCaptureRef.current || !location?.noteId) return

    const now = Date.now()
    const nextLocation = {
      noteId: location.noteId,
      cursorStart: location.cursorStart ?? 0,
      cursorEnd: location.cursorEnd ?? location.cursorStart ?? 0,
      scrollTop: location.scrollTop ?? 0,
      at: now,
    }

    const index = locationHistoryIndexRef.current
    const existing = locationHistoryRef.current
    const base = index < existing.length - 1 ? existing.slice(0, index + 1) : existing.slice()
    const current = base[base.length - 1]

    if (current && current.noteId === nextLocation.noteId && now - current.at < 120) {
      const next = [...base.slice(0, -1), nextLocation]
      locationHistoryRef.current = next
      locationHistoryIndexRef.current = next.length - 1
      return
    }

    if (
      current &&
      current.noteId === nextLocation.noteId &&
      current.cursorStart === nextLocation.cursorStart &&
      current.cursorEnd === nextLocation.cursorEnd &&
      Math.abs(current.scrollTop - nextLocation.scrollTop) < 16
    ) {
      return
    }

    const shouldReplace =
      replaceCurrent ||
      (current && current.noteId === nextLocation.noteId && now - current.at < 900)

    const next = shouldReplace && base.length
      ? [...base.slice(0, -1), nextLocation]
      : [...base, nextLocation]
    const trimmed = next.slice(-100)
    commitLocationHistory(trimmed, trimmed.length - 1)
  }, [commitLocationHistory])

  const openNoteInPane = useCallback((noteId, { newPane = false, matchOffset, matchLength = 0 } = {}) => {
    recordLocation({ noteId }, { replaceCurrent: false })
    setActiveNoteId(noteId)

    if (matchOffset != null) {
      setRestoreLocation({ noteId, cursorStart: matchOffset, cursorEnd: matchOffset + matchLength, scrollToOffset: matchOffset, token: Date.now() })
    }

    setEditorPanes(prev => {
      if (newPane) {
        const existing = prev.find(pane => (pane.type ?? 'note') === 'note' && pane.noteId === noteId)
        if (existing) {
          setActivePaneId(existing.id)
          return prev
        }

        const paneId = generateId()
        setActivePaneId(paneId)
        return [...prev, { id: paneId, type: 'note', noteId }]
      }

      if (!prev.length) {
        const paneId = generateId()
        setActivePaneId(paneId)
        return [{ id: paneId, type: 'note', noteId }]
      }

      const activePane = activePaneId ? prev.find(pane => pane.id === activePaneId) : null
      const fallbackNotePane = prev.find(pane => (pane.type ?? 'note') === 'note')
      const paneId = activePane && (activePane.type ?? 'note') === 'note'
        ? activePane.id
        : fallbackNotePane?.id

      if (!paneId) {
        const nextPaneId = generateId()
        setActivePaneId(nextPaneId)
        return [...prev, { id: nextPaneId, type: 'note', noteId }]
      }

      setActivePaneId(paneId)
      return prev.map(pane => pane.id === paneId ? { ...pane, type: 'note', noteId } : pane)
    })
  }, [activePaneId, recordLocation])

  const openKanbanPane = useCallback(() => {
    setEditorPanes(prev => {
      const existing = prev.find(pane => pane.type === 'kanban')
      if (existing) {
        setActivePaneId(existing.id)
        return prev
      }
      const paneId = generateId()
      setActivePaneId(paneId)
      return [...prev, { id: paneId, type: 'kanban' }]
    })
  }, [])

  const openNibPane = useCallback((payload = {}) => {
    const sourceNoteId = payload.noteId ?? activeNoteId
    if (sourceNoteId) setActiveNoteId(sourceNoteId)
    const initialMessageNonce = payload.initialMessage != null ? generateId() : undefined

    setEditorPanes(prev => {
      const existing = payload.reuseExisting
        ? prev.find(pane => pane.type === 'nib')
        : prev.find(pane => pane.type === 'nib' && pane.sourceNoteId === sourceNoteId)
      if (existing) {
        setActivePaneId(existing.id)
        return prev.map(pane => pane.id === existing.id ? {
          ...pane,
          ...payload,
          type: 'nib',
          sourceNoteId,
          ...(initialMessageNonce ? { initialMessageNonce } : {}),
        } : pane)
      }

      const paneId = generateId()
      setActivePaneId(paneId)
      return [...prev, {
        id: paneId,
        type: 'nib',
        sourceNoteId,
        ...payload,
        ...(initialMessageNonce ? { initialMessageNonce } : {}),
      }]
    })
  }, [activeNoteId])

  const closeEditorPane = useCallback((paneId) => {
    setEditorPanes(prev => {
      const idx = prev.findIndex(pane => pane.id === paneId)
      const next = prev.filter(pane => pane.id !== paneId)
      if (!next.length) {
        setActivePaneId(null)
        setActiveNoteId(null)
        return []
      }

      if (activePaneId === paneId) {
        const replacement = next[Math.max(0, idx - 1)] ?? next[0]
        setActivePaneId(replacement.id)
        if ((replacement.type ?? 'note') === 'note') setActiveNoteId(replacement.noteId)
      }

      return next
    })
  }, [activePaneId])

  const removeNoteFromWorkspace = useCallback((noteId, fallbackId) => {
    setEditorPanes(prev => {
      const remaining = prev.filter(pane => pane.noteId !== noteId && pane.sourceNoteId !== noteId)
      if (remaining.length) {
        if (!remaining.some(pane => pane.id === activePaneId)) setActivePaneId(remaining[0].id)
        return remaining
      }

      if (!fallbackId) {
        setActivePaneId(null)
        return []
      }

      const paneId = generateId()
      setActivePaneId(paneId)
      return [{ id: paneId, type: 'note', noteId: fallbackId }]
    })
    setActiveNoteId(fallbackId)
  }, [activePaneId])

  const navigateLocationHistory = useCallback((direction) => {
    const history = locationHistoryRef.current
    const index = locationHistoryIndexRef.current
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= history.length) return

    const location = history[nextIndex]
    suppressLocationCaptureRef.current = true
    locationHistoryIndexRef.current = nextIndex
    setLocationHistoryIndex(nextIndex)
    setActiveNoteId(location.noteId)

    setEditorPanes(prev => {
      const existing = prev.find(pane => (pane.type ?? 'note') === 'note' && pane.noteId === location.noteId)
      if (existing) {
        setActivePaneId(existing.id)
        return prev
      }

      if (!prev.length) {
        const paneId = generateId()
        setActivePaneId(paneId)
        return [{ id: paneId, type: 'note', noteId: location.noteId }]
      }

      const activePane = activePaneId ? prev.find(pane => pane.id === activePaneId) : null
      const fallbackNotePane = prev.find(pane => (pane.type ?? 'note') === 'note')
      const paneId = activePane && (activePane.type ?? 'note') === 'note'
        ? activePane.id
        : fallbackNotePane?.id

      if (!paneId) {
        const nextPaneId = generateId()
        setActivePaneId(nextPaneId)
        return [...prev, { id: nextPaneId, type: 'note', noteId: location.noteId }]
      }

      setActivePaneId(paneId)
      return prev.map(pane => pane.id === paneId ? { ...pane, type: 'note', noteId: location.noteId } : pane)
    })

    setRestoreLocation({ ...location, token: Date.now() })
    window.setTimeout(() => { suppressLocationCaptureRef.current = false }, 250)
  }, [activePaneId])

  return {
    activeNoteId,
    activePaneId,
    closeEditorPane,
    editorPanes,
    locationHistory,
    locationHistoryIndex,
    navigateLocationHistory,
    openKanbanPane,
    openNibPane,
    openNoteInPane,
    recordLocation,
    removeNoteFromWorkspace,
    resetWorkspace,
    restoreLocation,
    setActiveNoteId,
    setActivePaneId,
    showSinglePaneForNote,
  }
}
