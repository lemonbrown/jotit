import NotePreviewBody, { buildNotePreviewModel } from './NotePreviewBody'

export default function NoteHoverPreview({
  note,
  searchMatch,
  searchQuery,
  showMetadata = true,
  position,
}) {
  if (!note || !position) return null

  const model = buildNotePreviewModel(note, searchMatch, { expanded: true })

  return (
    <div
      className="pointer-events-none fixed z-40 w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl shadow-black"
      style={{ left: position.left, top: position.top }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.24em] text-blue-300">Alt preview</span>
        <span className="text-[10px] text-zinc-600">glance only</span>
      </div>
      <NotePreviewBody
        note={note}
        model={model}
        searchQuery={searchQuery}
        showMetadata={showMetadata}
      />
    </div>
  )
}
