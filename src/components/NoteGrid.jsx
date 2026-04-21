import { useRef, useEffect } from 'react'
import NoteCard from './NoteCard'

export default function NoteGrid({ notes, activeNoteId, aiProcessing, onSelectNote, searchQuery }) {
  const containerRef = useRef(null)
  const notesRef = useRef(notes)
  const activeIdRef = useRef(activeNoteId)
  const onSelectRef = useRef(onSelectNote)

  useEffect(() => { notesRef.current = notes }, [notes])
  useEffect(() => { activeIdRef.current = activeNoteId }, [activeNoteId])
  useEffect(() => { onSelectRef.current = onSelectNote }, [onSelectNote])

  // Mouse wheel navigation — navigate notes, not scroll the container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handler = (e) => {
      e.preventDefault()
      const list = notesRef.current
      if (!list.length) return
      const idx = list.findIndex(n => n.id === activeIdRef.current)
      const next = e.deltaY > 0
        ? Math.min(idx + 1, list.length - 1)
        : Math.max(idx - 1, 0)
      if (next !== idx) onSelectRef.current(list[next].id)
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
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
      {/* Wheel hint */}
      <div className="text-[10px] text-zinc-700 text-center mb-2 select-none">
        scroll to navigate · click to select
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
