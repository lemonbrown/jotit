import { useRef, useEffect } from 'react'
import NoteCard from './NoteCard'

export default function NoteGrid({ notes, activeNoteId, onSelectNote, searchMatches, searchQuery, diffActive, isPeekOpen, onPeekOpenChange }) {
  const containerRef = useRef(null)
  const notesRef = useRef(notes)
  const activeIdRef = useRef(activeNoteId)
  const onSelectRef = useRef(onSelectNote)
  const onPeekOpenChangeRef = useRef(onPeekOpenChange)
  const velRef = useRef({ value: 0, lastTime: 0 })
  const scrollCoastRef = useRef({ velocity: 0, direction: 1, rafId: null })
  const didAltScrollRef = useRef(false)

  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { activeIdRef.current = activeNoteId }, [activeNoteId])
  useEffect(() => { onSelectRef.current = onSelectNote }, [onSelectNote])
  useEffect(() => { onPeekOpenChangeRef.current = onPeekOpenChange }, [onPeekOpenChange])

  // Mouse wheel navigation — navigate notes, not scroll the container
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

      if (timeDelta > 200) velRef.current.value = 0 // user paused — reset momentum

      const rawSpeed = Math.abs(e.deltaY) / Math.max(timeDelta, 8) // px/ms, floor at 8ms
      velRef.current.value = velRef.current.value * 0.7 + rawSpeed * 0.3 // exponential smooth

      const skip = Math.min(Math.floor(velRef.current.value * 0.08) + 1, 8)
      const idx = Math.max(0, list.findIndex(n => n.id === activeIdRef.current))
      const next = e.deltaY > 0
        ? Math.min(idx + skip, list.length - 1)
        : Math.max(idx - skip, 0)

      if (next === 0 || next === list.length - 1) velRef.current.value = 0 // kill momentum at boundaries
      if (next !== idx) onSelectRef.current(list[next].id)
    }

    const handler = (e) => {
      if (e.shiftKey && !e.altKey) {
        e.preventDefault()
        onPeekOpenChangeRef.current?.(true)
        selectByWheel(e)
        return
      }

      if (e.altKey) {
        e.preventDefault()
        const sc = scrollCoastRef.current
        const dir = e.deltaY > 0 ? 1 : -1

        didAltScrollRef.current = true
        if (dir !== sc.direction) sc.velocity = 0 // direction reversal resets momentum
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
    }

    const closePeek = (e) => {
      if (e.key === 'Shift' || e.key === 'Escape') onPeekOpenChangeRef.current?.(false)
    }
    const closePeekOnBlur = () => onPeekOpenChangeRef.current?.(false)

    el.addEventListener('wheel', handler, { passive: false })
    window.addEventListener('keyup', closePeek)
    window.addEventListener('blur', closePeekOnBlur)
    return () => {
      el.removeEventListener('wheel', handler)
      window.removeEventListener('keyup', closePeek)
      window.removeEventListener('blur', closePeekOnBlur)
      const sc = scrollCoastRef.current
      if (sc.rafId) { cancelAnimationFrame(sc.rafId); sc.rafId = null }
    }
  }, [])

  // Scroll active card into view
  useEffect(() => {
    if (!activeNoteId) return
    const el = document.getElementById(`note-card-${activeNoteId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeNoteId])

  if (!notes.length) {
    return (
      <div className="w-[420px] shrink-0 flex items-center justify-center border-r border-zinc-800 text-zinc-600 text-sm">
        {searchQuery ? 'No results' : 'No notes yet'}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onMouseLeave={() => onPeekOpenChange?.(false)}
      className={[
        'overflow-y-auto overflow-x-hidden border-r border-zinc-800 p-2 bg-zinc-950',
        'transition-[width,box-shadow,border-color] duration-150 ease-out',
        isPeekOpen
          ? 'absolute inset-0 z-30 w-full border-blue-900/70 shadow-2xl shadow-black/70'
          : 'relative w-[420px] shrink-0',
      ].join(' ')}
      style={{ cursor: 'default' }}
    >
      {/* Hint */}
      <div className={`text-[10px] text-center mb-2 select-none transition-colors ${diffActive ? 'text-sky-700' : 'text-zinc-700'}`}>
        {diffActive ? '± click a note to load into diff' : 'scroll to navigate · ctrl+click opens pane · shift+scroll to peek · alt+scroll to pan'}
      </div>

      <div className={isPeekOpen ? 'card-grid card-grid-peek' : 'card-grid'}>
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
          />
        ))}
      </div>
    </div>
  )
}
