import { memo } from 'react'
import NotePreviewBody, { buildNotePreviewModel } from './NotePreviewBody'

function NoteCard({
  note,
  isActive,
  isProcessing,
  onSelect,
  searchMatch = null,
  searchQuery,
  expanded = false,
  showMetadata = true,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  onDragStart,
  onDragEnd,
}) {
  const model = buildNotePreviewModel(note, searchMatch, { expanded })

  return (
    <div
      id={`note-card-${note.id}`}
      draggable
      onClick={(e) => onSelect(note.id, { newPane: e.ctrlKey || e.metaKey })}
      onMouseEnter={(e) => onHoverStart?.(note.id, e.currentTarget, e)}
      onMouseMove={(e) => onHoverMove?.(note.id, e.currentTarget, e)}
      onMouseLeave={() => onHoverEnd?.()}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'all'
        e.dataTransfer.setData('text/plain', note.id)
        e.dataTransfer.setData('application/x-jotit-note-id', note.id)
        onDragStart?.(note.id)
      }}
      onDragEnd={() => onDragEnd?.()}
      className={[
        'relative flex flex-col p-3 rounded-lg border cursor-pointer select-none',
        'transition-all duration-150 overflow-hidden',
        expanded ? 'h-[230px]' : 'h-[148px]',
        isActive
          ? 'bg-slate-900 border-blue-500 shadow-lg shadow-blue-950/50 ring-1 ring-blue-500/30'
          : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/80',
      ].join(' ')}
    >
      {isProcessing && (
        <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
      )}
      <NotePreviewBody
        note={note}
        model={model}
        searchQuery={searchQuery}
        showMetadata={showMetadata}
        compact
      />
    </div>
  )
}

export default memo(NoteCard, (prevProps, nextProps) => (
  prevProps.note === nextProps.note &&
  prevProps.isActive === nextProps.isActive &&
  prevProps.isProcessing === nextProps.isProcessing &&
  prevProps.onSelect === nextProps.onSelect &&
  prevProps.searchMatch === nextProps.searchMatch &&
  prevProps.searchQuery === nextProps.searchQuery &&
  prevProps.expanded === nextProps.expanded &&
  prevProps.showMetadata === nextProps.showMetadata &&
  prevProps.onHoverStart === nextProps.onHoverStart &&
  prevProps.onHoverMove === nextProps.onHoverMove &&
  prevProps.onHoverEnd === nextProps.onHoverEnd &&
  prevProps.onDragStart === nextProps.onDragStart &&
  prevProps.onDragEnd === nextProps.onDragEnd
))
