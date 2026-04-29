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
  syncEnabled = true,
  onToggleSync,
  isPinned = false,
  onTogglePin,
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
      {(isPinned || onTogglePin) && (
        <button
          title={isPinned ? 'Unpin from this collection' : 'Pin to top of this collection'}
          onClick={(e) => { e.stopPropagation(); onTogglePin?.() }}
          className={`absolute bottom-2 left-2 z-10 p-0.5 rounded transition-colors ${
            isPinned
              ? 'text-amber-400 hover:text-amber-300'
              : 'text-zinc-700 hover:text-zinc-500'
          }`}
        >
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
          </svg>
        </button>
      )}
      {!syncEnabled && (
        <button
          title={note.syncIncluded ? 'Syncing — click to stop syncing this note' : 'Not syncing — click to sync this note'}
          onClick={(e) => { e.stopPropagation(); onToggleSync?.(note.id, !note.syncIncluded) }}
          className={`absolute bottom-2 right-2 z-10 p-0.5 rounded transition-colors ${
            note.syncIncluded
              ? 'text-blue-400 hover:text-blue-300'
              : 'text-zinc-700 hover:text-zinc-500'
          }`}
        >
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.5 17a4.5 4.5 0 01-1.44-8.765 4.5 4.5 0 018.302-3.046 3.5 3.5 0 014.504 4.272A4 4 0 0115 17H5.5zm3.75-2.75a.75.75 0 001.5 0V9.66l1.95 2.1a.75.75 0 101.1-1.02l-3.25-3.5a.75.75 0 00-1.1 0l-3.25 3.5a.75.75 0 101.1 1.02l1.95-2.1v4.59z" clipRule="evenodd" />
          </svg>
        </button>
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
  prevProps.onDragEnd === nextProps.onDragEnd &&
  prevProps.syncEnabled === nextProps.syncEnabled &&
  prevProps.onToggleSync === nextProps.onToggleSync &&
  prevProps.isPinned === nextProps.isPinned &&
  prevProps.onTogglePin === nextProps.onTogglePin
))
