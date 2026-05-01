import { memo } from 'react'
import NotePreviewBody, { buildNotePreviewModel, highlight } from './NotePreviewBody'
import CategoryBadge from './CategoryBadge'
import { timeAgo } from '../utils/helpers'

function buildSnippets(content, query, maxSnippets = 6, contextChars = 60) {
  if (!content || !query || typeof content !== 'string' || typeof query !== 'string') return []
  const q = query.toLowerCase()
  const lower = content.toLowerCase()
  const firstNewline = content.indexOf('\n')
  const bodyStart = firstNewline === -1 ? content.length : firstNewline + 1
  const snippets = []
  let searchFrom = bodyStart

  while (snippets.length < maxSnippets) {
    const idx = lower.indexOf(q, searchFrom)
    if (idx === -1) break
    const start = Math.max(bodyStart, idx - contextChars)
    const end = Math.min(content.length, idx + query.length + contextChars)
    let text = content.slice(start, end).replace(/\n+/g, ' ').trim()
    if (start > bodyStart) text = '…' + text
    if (end < content.length) text += '…'
    snippets.push({ text, offset: idx })
    searchFrom = idx + query.length
  }

  return snippets
}

function NoteCard({
  note,
  isActive,
  isProcessing,
  onSelect,
  searchMatch = null,
  searchQuery,
  expanded = false,
  oneLine = false,
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
  shareSelected = false,
  onToggleShareSelection,
}) {
  const model = buildNotePreviewModel(note, searchMatch, { expanded })
  const title = model.searchHeading || model.firstLine || 'empty'
  const snippets = oneLine && searchQuery ? buildSnippets(note.content, searchQuery) : []

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
      className={oneLine ? [
        'relative flex flex-col cursor-pointer select-none transition-colors duration-100',
        'border-b border-zinc-800/70',
        isActive
          ? 'bg-zinc-800/60 border-b-zinc-700'
          : 'hover:bg-zinc-800/30',
      ].join(' ') : [
        'relative flex rounded-lg border cursor-pointer select-none',
        'transition-all duration-150 overflow-hidden',
        `flex-col p-3 ${expanded ? 'h-[230px]' : 'h-[148px]'}`,
        isActive
          ? 'bg-slate-900 border-blue-500 shadow-lg shadow-blue-950/50 ring-1 ring-blue-500/30'
          : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/80',
      ].join(' ')}
    >
      {isProcessing && (
        <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
      )}
      {onToggleShareSelection && !oneLine && (
        <button
          title={shareSelected ? 'Remove from multi-note share' : 'Add to multi-note share'}
          onClick={(e) => { e.stopPropagation(); onToggleShareSelection?.() }}
          className={`absolute top-2 right-2 z-10 flex h-5 w-5 items-center justify-center rounded border transition-colors ${
            shareSelected
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-zinc-700 bg-zinc-950/80 text-transparent hover:text-zinc-400'
          }`}
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.415 0l-3.25-3.25A1.004 1.004 0 116.21 9.29l2.542 2.543 6.543-6.543a1 1 0 011.409 0z" clipRule="evenodd" />
          </svg>
        </button>
      )}
      {oneLine ? (
        <>
          <div className="flex items-center gap-3 h-8 px-2">
            {onToggleShareSelection && (
              <button
                title={shareSelected ? 'Remove from multi-note share' : 'Add to multi-note share'}
                onClick={(e) => { e.stopPropagation(); onToggleShareSelection?.() }}
                className={`shrink-0 flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                  shareSelected
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-zinc-700 text-transparent hover:text-zinc-400'
                }`}
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.415 0l-3.25-3.25A1.004 1.004 0 116.21 9.29l2.542 2.543 6.543-6.543a1 1 0 011.409 0z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            {(isPinned || onTogglePin) && (
              <button
                title={isPinned ? 'Unpin from this collection' : 'Pin to top of this collection'}
                onClick={(e) => { e.stopPropagation(); onTogglePin?.() }}
                className={`shrink-0 p-0.5 rounded transition-colors ${
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
            <div className={`note-content truncate flex-1 min-w-0 text-[11px] font-medium ${model.firstLine ? 'text-zinc-200' : 'italic text-zinc-700'}`}>
              {title}
            </div>
            {showMetadata && model.documentBadge && (
              <span className="shrink-0 rounded border border-cyan-900/60 bg-cyan-950/40 px-1 py-px font-mono text-[9px] leading-none text-cyan-300">
                {model.documentBadge}
              </span>
            )}
            {showMetadata && model.badges.slice(0, 1).map(category => <CategoryBadge key={category} category={category} size="xs" />)}
            {!syncEnabled && (
              <button
                title={note.syncIncluded ? 'Syncing - click to stop syncing this note' : 'Not syncing - click to sync this note'}
                onClick={(e) => { e.stopPropagation(); onToggleSync?.(note.id, !note.syncIncluded) }}
                className={`shrink-0 p-0.5 rounded transition-colors ${
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
            <span className="shrink-0 w-[52px] text-right text-[10px] text-zinc-600">{timeAgo(note.updatedAt)}</span>
          </div>
          {snippets.map((snippet, i) => (
            <div
              key={i}
              onClick={(e) => { e.stopPropagation(); onSelect(note.id, { matchOffset: snippet.offset, matchLength: searchQuery.length }) }}
              className="px-2 pb-1.5 text-[10px] text-zinc-500 font-mono truncate leading-snug hover:text-zinc-300 transition-colors"
            >
              {highlight(snippet.text, searchQuery)}
            </div>
          ))}
        </>
      ) : (
        <>
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
        </>
      )}
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
  prevProps.oneLine === nextProps.oneLine &&
  prevProps.showMetadata === nextProps.showMetadata &&
  prevProps.onHoverStart === nextProps.onHoverStart &&
  prevProps.onHoverMove === nextProps.onHoverMove &&
  prevProps.onHoverEnd === nextProps.onHoverEnd &&
  prevProps.onDragStart === nextProps.onDragStart &&
  prevProps.onDragEnd === nextProps.onDragEnd &&
  prevProps.syncEnabled === nextProps.syncEnabled &&
  prevProps.onToggleSync === nextProps.onToggleSync &&
  prevProps.isPinned === nextProps.isPinned &&
  prevProps.onTogglePin === nextProps.onTogglePin &&
  prevProps.shareSelected === nextProps.shareSelected &&
  prevProps.onToggleShareSelection === nextProps.onToggleShareSelection
))
