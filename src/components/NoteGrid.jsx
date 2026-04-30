import { useRef, useEffect, useState, useCallback } from 'react'
import NoteCard from './NoteCard'
import NoteHoverPreview from './NoteHoverPreview'

const HOVER_PREVIEW_DELAY_MS = 40
const HOVER_PREVIEW_WIDTH = 544
const HOVER_PREVIEW_OFFSET = 14
const PREVIEW_MIN_MARGIN = 12
const PREVIEW_APPROX_HEIGHT = 320

export default function NoteGrid({
  notes,
  activeNoteId,
  onSelectNote,
  searchMatches,
  searchQuery,
  diffActive,
  isPeekOpen,
  onPeekOpenChange,
  noteMetadataHidden = false,
  onToggleNoteMetadata,
  oneLineMode = false,
  onToggleOneLineMode,
  onNoteDragStart,
  onNoteDragEnd,
  style,
  syncEnabled = true,
  onToggleNoteSync,
  pinnedIds,
  onTogglePin,
  selectedShareNoteIds,
  onToggleShareSelection,
  onClearShareSelection,
  onShareSelected,
  shareSelectedState,
  sharingSelected = false,
}) {
  const containerRef = useRef(null)
  const notesRef = useRef(notes)
  const activeIdRef = useRef(activeNoteId)
  const onSelectRef = useRef(onSelectNote)
  const onPeekOpenChangeRef = useRef(onPeekOpenChange)
  const velRef = useRef({ value: 0, lastTime: 0 })
  const scrollCoastRef = useRef({ velocity: 0, direction: 1, rafId: null })
  const didAltScrollRef = useRef(false)
  const altPressedRef = useRef(false)
  const hoverTimerRef = useRef(null)
  const hoveredCardRef = useRef(null)
  const pointerRef = useRef({ x: null, y: null })
  const pointerInsideRef = useRef(false)
  const draggingRef = useRef(false)
  const [hoverPreview, setHoverPreview] = useState(null)

  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { activeIdRef.current = activeNoteId }, [activeNoteId])
  useEffect(() => { onSelectRef.current = onSelectNote }, [onSelectNote])
  useEffect(() => { onPeekOpenChangeRef.current = onPeekOpenChange }, [onPeekOpenChange])

  const clearHoverTimer = useCallback(() => {
    if (!hoverTimerRef.current) return
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
  }, [])

  const closePreview = useCallback(() => {
    clearHoverTimer()
    setHoverPreview(null)
  }, [clearHoverTimer])

  const computePreviewPosition = useCallback((element) => {
    if (!element) return null

    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const preferredLeft = rect.right + HOVER_PREVIEW_OFFSET
    const fallbackLeft = rect.left - HOVER_PREVIEW_WIDTH - HOVER_PREVIEW_OFFSET
    const fitsRight = preferredLeft + HOVER_PREVIEW_WIDTH <= viewportWidth - PREVIEW_MIN_MARGIN
    const left = fitsRight
      ? preferredLeft
      : Math.max(PREVIEW_MIN_MARGIN, fallbackLeft)
    const maxTop = Math.max(PREVIEW_MIN_MARGIN, viewportHeight - PREVIEW_APPROX_HEIGHT)
    const top = Math.min(Math.max(PREVIEW_MIN_MARGIN, rect.top - 8), maxTop)

    return { left, top }
  }, [])

  const openPreviewForElement = useCallback((noteId, element, altOverride = altPressedRef.current) => {
    if (!altOverride || isPeekOpen || draggingRef.current) return

    const note = notesRef.current.find(item => item.id === noteId)
    const position = computePreviewPosition(element)

    if (!note || !position) return
    setHoverPreview({ noteId, position })
  }, [computePreviewPosition, isPeekOpen])

  const findCardFromTarget = useCallback((target) => {
    const card = target?.closest?.('[id^="note-card-"]')
    if (!card) return null

    const noteId = card.id.replace('note-card-', '')
    return noteId ? { noteId, element: card } : null
  }, [])

  const schedulePreview = useCallback((noteId, element, altOverride = altPressedRef.current) => {
    clearHoverTimer()
    if (!altOverride || isPeekOpen || draggingRef.current) return

    hoveredCardRef.current = { noteId, element }
    hoverTimerRef.current = setTimeout(() => {
      openPreviewForElement(noteId, element, altOverride)
    }, HOVER_PREVIEW_DELAY_MS)
  }, [clearHoverTimer, isPeekOpen, openPreviewForElement])

  const handleCardHoverEnd = useCallback(() => {
    clearHoverTimer()
    hoveredCardRef.current = null
    setHoverPreview(null)
  }, [clearHoverTimer])

  // Mouse wheel navigation navigates notes, not the container scroll.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const selectByWheel = (e) => {
      const list = notesRef.current
      if (!list.length) return

      if (didAltScrollRef.current) {
        didAltScrollRef.current = false
        document.getElementById(`note-card-${activeIdRef.current}`)
          ?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
      }

      const now = Date.now()
      const timeDelta = now - velRef.current.lastTime
      velRef.current.lastTime = now

      if (timeDelta > 200) velRef.current.value = 0

      const rawSpeed = Math.abs(e.deltaY) / Math.max(timeDelta, 8)
      velRef.current.value = velRef.current.value * 0.7 + rawSpeed * 0.3

      const skip = Math.min(Math.floor(velRef.current.value * 0.08) + 1, 8)
      const idx = Math.max(0, list.findIndex(n => n.id === activeIdRef.current))
      const next = e.deltaY > 0
        ? Math.min(idx + skip, list.length - 1)
        : Math.max(idx - skip, 0)

      if (next === 0 || next === list.length - 1) velRef.current.value = 0
      if (next !== idx) onSelectRef.current(list[next].id)
    }

    const handler = (e) => {
      if (e.shiftKey && !e.altKey) {
        e.preventDefault()
        closePreview()
        onPeekOpenChangeRef.current?.(true)
        selectByWheel(e)
        return
      }

      if (e.altKey) {
        e.preventDefault()
        closePreview()
        const sc = scrollCoastRef.current
        const dir = e.deltaY > 0 ? 1 : -1

        didAltScrollRef.current = true
        if (dir !== sc.direction) sc.velocity = 0
        sc.direction = dir
        const listScale = Math.max(1, el.scrollHeight / (el.clientHeight * 3))
        sc.velocity = Math.min(sc.velocity + Math.abs(e.deltaY) * 0.5 * listScale, 80 * listScale)

        if (!sc.rafId) {
          const coast = () => {
            sc.velocity *= 0.88
            el.scrollTop += sc.velocity * sc.direction
            if (sc.velocity < 0.5) { sc.rafId = null; return }
            sc.rafId = requestAnimationFrame(coast)
          }
          sc.rafId = requestAnimationFrame(coast)
        }
        return
      }

      onPeekOpenChangeRef.current?.(false)
      closePreview()
    }

    const closePeek = (e) => {
      if (e.key === 'Shift' || e.key === 'Escape') onPeekOpenChangeRef.current?.(false)
    }
    const closePeekOnBlur = () => onPeekOpenChangeRef.current?.(false)

    el.addEventListener('wheel', handler, { passive: false })
    el.addEventListener('scroll', closePreview)
    window.addEventListener('keyup', closePeek)
    window.addEventListener('blur', closePeekOnBlur)
    return () => {
      el.removeEventListener('wheel', handler)
      el.removeEventListener('scroll', closePreview)
      window.removeEventListener('keyup', closePeek)
      window.removeEventListener('blur', closePeekOnBlur)
      const sc = scrollCoastRef.current
      if (sc.rafId) { cancelAnimationFrame(sc.rafId); sc.rafId = null }
    }
  }, [closePreview])

  useEffect(() => {
    const findHoveredCardFromPointer = () => {
      const { x, y } = pointerRef.current
      if (x == null || y == null) return null

      const target = document.elementFromPoint(x, y)
      const container = containerRef.current
      if (!container || !target || !container.contains(target)) return null
      return findCardFromTarget(target)
    }

    const handleKeyDown = (e) => {
      if (e.key !== 'Alt') return
      altPressedRef.current = true
      if (!pointerInsideRef.current) return
      const hoveredCard = hoveredCardRef.current ?? findHoveredCardFromPointer()
      if (!hoveredCard) return

      hoveredCardRef.current = hoveredCard
      openPreviewForElement(hoveredCard.noteId, hoveredCard.element, true)
    }

    const handleKeyUp = (e) => {
      if (e.key !== 'Alt') return
      altPressedRef.current = false
      closePreview()
    }

    const handleWindowBlur = () => {
      altPressedRef.current = false
      closePreview()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [closePreview, findCardFromTarget, openPreviewForElement])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handlePointerMove = (e) => {
      pointerInsideRef.current = true
      altPressedRef.current = !!e.altKey
      pointerRef.current = { x: e.clientX, y: e.clientY }

      const hoveredCard = findCardFromTarget(e.target)
      hoveredCardRef.current = hoveredCard

      if (!hoveredCard) {
        if (hoverPreview) closePreview()
        return
      }

      if (!e.altKey) {
        if (hoverPreview) closePreview()
        return
      }

      if (hoverPreview?.noteId === hoveredCard.noteId) return

      clearHoverTimer()
      openPreviewForElement(hoveredCard.noteId, hoveredCard.element, true)
    }

    el.addEventListener('pointermove', handlePointerMove)
    return () => {
      el.removeEventListener('pointermove', handlePointerMove)
    }
  }, [clearHoverTimer, closePreview, findCardFromTarget, hoverPreview, openPreviewForElement])

  useEffect(() => {
    if (isPeekOpen) closePreview()
  }, [closePreview, isPeekOpen])

  useEffect(() => () => {
    clearHoverTimer()
  }, [clearHoverTimer])

  useEffect(() => {
    if (!activeNoteId) return
    const el = document.getElementById(`note-card-${activeNoteId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeNoteId])

  if (!notes.length) {
    return (
      <div
        className="w-full h-[34vh] md:h-auto md:w-[420px] shrink-0 flex items-center justify-center border-b md:border-b-0 md:border-r border-zinc-800 text-zinc-600 text-sm"
        style={{ ...style, maxWidth: '100%' }}
      >
        {searchQuery ? 'No results' : 'No notes yet'}
      </div>
    )
  }

  const previewNote = hoverPreview ? notes.find(note => note.id === hoverPreview.noteId) : null
  const selectedCount = selectedShareNoteIds?.size ?? 0

  return (
    <div
      ref={containerRef}
      onMouseEnter={(e) => {
        pointerInsideRef.current = true
        altPressedRef.current = !!e.altKey
        pointerRef.current = { x: e.clientX, y: e.clientY }
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false
        onPeekOpenChange?.(false)
        closePreview()
        hoveredCardRef.current = null
        pointerRef.current = { x: null, y: null }
        clearHoverTimer()
      }}
      className={[
        'overflow-y-auto overflow-x-hidden border-b md:border-b-0 md:border-r border-zinc-800 p-2 bg-zinc-950',
        'transition-[width,box-shadow,border-color] duration-150 ease-out',
        isPeekOpen
          ? 'absolute inset-0 z-30 w-full border-blue-900/70 shadow-2xl shadow-black/70'
          : 'relative w-full h-[38vh] md:h-auto md:w-[420px] shrink-0',
      ].join(' ')}
      style={{ cursor: 'default', ...(!isPeekOpen && style ? { ...style, maxWidth: '100%' } : {}) }}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className={`min-w-0 flex-1 text-center text-[10px] select-none transition-colors ${diffActive ? 'text-sky-700' : 'text-zinc-700'}`}>
          {diffActive ? 'diff mode active' : 'scroll to navigate · ctrl+click opens pane · shift+scroll to peek · alt+scroll to pan · alt+hover to preview'}
        </div>
        {onShareSelected && selectedCount > 0 && (
          <div className="flex min-w-0 items-center gap-1 rounded-md border border-blue-900/60 bg-blue-950/30 px-1.5 py-1">
            {shareSelectedState?.ok ? (
              <a href={shareSelectedState.url} target="_blank" rel="noreferrer" className="max-w-28 truncate font-mono text-[10px] text-emerald-300 hover:text-emerald-200">
                {shareSelectedState.url}
              </a>
            ) : (
              <span className="font-mono text-[10px] text-blue-200">{selectedCount} selected</span>
            )}
            <button
              type="button"
              onClick={onShareSelected}
              disabled={selectedCount < 2 || sharingSelected}
              title="Share selected notes in one public link"
              className="rounded border border-blue-800 bg-blue-900/50 px-2 py-0.5 text-[10px] font-medium text-blue-100 transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sharingSelected ? 'Sharing...' : shareSelectedState?.ok ? 'Copied' : 'Share'}
            </button>
            <button type="button" onClick={onClearShareSelection} title="Clear selected notes" className="px-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-200">
              x
            </button>
            {shareSelectedState?.error && (
              <span className="max-w-40 truncate font-mono text-[10px] text-red-300">{shareSelectedState.error}</span>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => onToggleNoteMetadata?.()}
          aria-pressed={noteMetadataHidden}
          title={`${noteMetadataHidden ? 'Show' : 'Hide'} note metadata badges (Ctrl+Shift+Alt+\\)`}
          className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
            noteMetadataHidden
              ? 'border-blue-800/70 bg-blue-950/40 text-blue-300 hover:bg-blue-950/70'
              : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-300'
          }`}
        >
          badges
        </button>
        <button
          type="button"
          onClick={() => onToggleOneLineMode?.()}
          aria-pressed={oneLineMode}
          title={oneLineMode ? 'Show note cards' : 'Show notes as one-line stacked rows'}
          className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
            oneLineMode
              ? 'border-blue-800/70 bg-blue-950/40 text-blue-300 hover:bg-blue-950/70'
              : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-300'
          }`}
        >
          rows
        </button>
      </div>

      <div className={oneLineMode && !isPeekOpen ? 'card-grid-list' : isPeekOpen ? 'card-grid card-grid-peek' : 'card-grid'}>
        {notes.map(note => (
          <NoteCard
            key={note.id}
            note={note}
            isActive={note.id === activeNoteId}
            isProcessing={false}
            onSelect={onSelectNote}
            searchMatch={searchMatches?.get(note.id) ?? null}
            searchQuery={searchQuery}
            expanded={isPeekOpen}
            oneLine={oneLineMode && !isPeekOpen}
            showMetadata={!noteMetadataHidden}
            onHoverEnd={handleCardHoverEnd}
            onDragStart={(noteId) => {
              draggingRef.current = true
              closePreview()
              onNoteDragStart?.(noteId)
            }}
            onDragEnd={() => {
              draggingRef.current = false
              onNoteDragEnd?.()
            }}
            syncEnabled={syncEnabled}
            onToggleSync={onToggleNoteSync}
            isPinned={pinnedIds?.has(note.id) ?? false}
            onTogglePin={onTogglePin ? () => onTogglePin(note.id, note.collectionId) : undefined}
            shareSelected={selectedShareNoteIds?.has(note.id) ?? false}
            onToggleShareSelection={onToggleShareSelection ? () => onToggleShareSelection(note.id) : undefined}
          />
        ))}
      </div>

      <NoteHoverPreview
        note={previewNote}
        searchMatch={hoverPreview ? searchMatches?.get(hoverPreview.noteId) ?? null : null}
        searchQuery={searchQuery}
        showMetadata={!noteMetadataHidden}
        position={hoverPreview?.position ?? null}
      />
    </div>
  )
}
