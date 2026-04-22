import { useRef, useEffect } from 'react'
import NoteCard from './NoteCard'

export default function NoteGrid({ notes, activeNoteId, aiProcessing, onSelectNote, searchQuery, diffActive }) {
  const containerRef = useRef(null)
  const notesRef = useRef(notes)
  const activeIdRef = useRef(activeNoteId)
  const onSelectRef = useRef(onSelectNote)
  const velRef = useRef({ value: 0, lastTime: 0 })
  const scrollCoastRef = useRef({ velocity: 0, direction: 1, rafId: null })
  const didAltScrollRef = useRef(false)

  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { activeIdRef.current = activeNoteId }, [activeNoteId])
  useEffect(() => { onSelectRef.current = onSelectNote }, [onSelectNote])

  // Mouse wheel navigation — navigate notes, not scroll the container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handler = (e) => {
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
      e.preventDefault()
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
      const idx = list.findIndex(n => n.id === activeIdRef.current)
      const next = e.deltaY > 0
        ? Math.min(idx + skip, list.length - 1)
        : Math.max(idx - skip, 0)

      if (next === 0 || next === list.length - 1) velRef.current.value = 0 // kill momentum at boundaries
      if (next !== idx) onSelectRef.current(list[next].id)
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => {
      el.removeEventListener('wheel', handler)
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
      className="w-[420px] shrink-0 overflow-y-auto overflow-x-hidden border-r border-zinc-800 p-2"
      style={{ cursor: 'default' }}
    >
      {/* Hint */}
      <div className={`text-[10px] text-center mb-2 select-none transition-colors ${diffActive ? 'text-sky-700' : 'text-zinc-700'}`}>
        {diffActive ? '± click a note to load into diff' : 'scroll to navigate · alt+scroll to pan · click to select'}
      </div>

      <div className="card-grid">
        {notes.map(note => (
          <NoteCard
            key={note.id}
            note={note}
            isActive={note.id === activeNoteId}
            isProcessing={aiProcessing.has(note.id)}
            onSelect={onSelectNote}
            searchQuery={searchQuery}
          />
        ))}
      </div>
    </div>
  )
}
