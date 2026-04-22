import { timeAgo } from '../utils/helpers'
import CategoryBadge from './CategoryBadge'

export default function NoteCard({ note, isActive, isProcessing, onSelect, searchQuery, expanded = false }) {
  const lines = note.content.split('\n').filter(l => l.trim())
  const firstLine = lines[0] ?? ''
  const rest = lines.slice(1, expanded ? 10 : 4).join('\n')
  const badges = note.categories.slice(0, 3)

  const highlight = (text, query) => {
    if (!query || !text) return text
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-400/30 text-yellow-200 rounded-sm">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  return (
    <div
      id={`note-card-${note.id}`}
      onClick={(e) => onSelect(note.id, { newPane: e.ctrlKey || e.metaKey })}
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
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      )}
      {note.isPublic && !isProcessing && (
        <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-500" title="Public" />
      )}

      {/* First line as heading */}
      <div className={`note-content text-[12px] font-medium truncate mb-1 ${firstLine ? 'text-zinc-200' : 'text-zinc-700 italic'}`}>
        {firstLine ? highlight(firstLine, searchQuery) : 'empty'}
      </div>

      {/* Remaining lines as preview */}
      <div className={`note-content text-[11px] text-zinc-500 flex-1 leading-relaxed ${expanded ? 'line-clamp-8' : 'line-clamp-3'}`}>
        {rest ? highlight(rest, searchQuery) : null}
      </div>

      {/* Footer */}
      <div className="flex items-end gap-1 mt-1.5 flex-wrap">
        {badges.map(c => <CategoryBadge key={c} category={c} size="xs" />)}
        {note.categories.length > 3 && (
          <span className="text-[10px] text-zinc-600">+{note.categories.length - 3}</span>
        )}
        <span className="ml-auto text-[10px] text-zinc-700 shrink-0">{timeAgo(note.updatedAt)}</span>
      </div>
    </div>
  )
}
