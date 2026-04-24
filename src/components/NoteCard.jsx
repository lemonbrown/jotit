import { memo } from 'react'
import { timeAgo } from '../utils/helpers'
import { redactCredentialPreview } from '../utils/searchCore'
import CategoryBadge from './CategoryBadge'
import { isOpenApiNote, isSQLiteNote } from '../utils/noteTypes'

const ENTITY_TYPE_LABELS = {
  env_var: 'env var',
  api_key_like: 'api key',
  jwt_like: 'jwt',
  url: 'url',
  cloud_provider: 'cloud',
  command: 'cmd',
  port: 'port',
  ip: 'ip',
  hostname: 'host',
  uuid: 'uuid',
  file_path: 'path',
  http_method: 'http',
  status_code: 'status',
}

function NoteCard({ note, isActive, isProcessing, onSelect, searchMatch = null, searchQuery, expanded = false }) {
  const lines = note.content.split('\n').filter(l => l.trim())
  const firstLine = lines[0] ?? ''
  const defaultRest = lines.slice(1, expanded ? 10 : 4).join('\n')

  const rawPreview = searchMatch?.preview ?? defaultRest
  const rest = searchMatch?.preview ? redactCredentialPreview(rawPreview) : defaultRest

  const badges = note.categories.slice(0, 3)
  const searchHeading = searchMatch?.matchedSectionTitle || firstLine

  // Chunk-aware search context
  const chunkKindBadge = searchMatch?.matchedChunkKind && searchMatch.matchedChunkKind !== 'prose'
    ? searchMatch.matchedChunkKind
    : null
  const entityTypePills = [...new Set((searchMatch?.entityHits ?? []).map(e => e.entityType))].slice(0, 2)
  const isSemantic = ['semantic', 'hybrid-semantic', 'semantic-chunk'].includes(searchMatch?.matchType)
  const fallbackReasons = (!chunkKindBadge && !entityTypePills.length && !isSemantic)
    ? (searchMatch?.reasons ?? []).filter(r => !r.startsWith('section:')).slice(0, 2)
    : []
  const showMatchContext = searchMatch && (chunkKindBadge || entityTypePills.length || isSemantic || fallbackReasons.length)
  const documentBadge = isOpenApiNote(note) ? 'openapi' : isSQLiteNote(note) ? 'sqlite' : null

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

      {/* Heading — matched section title or first line */}
      <div className="flex items-baseline gap-1.5 mb-1 min-w-0">
        <div className={`note-content text-[12px] font-medium truncate flex-1 min-w-0 ${firstLine ? 'text-zinc-200' : 'text-zinc-700 italic'}`}>
          {searchHeading ? highlight(searchHeading, searchQuery) : 'empty'}
        </div>
        {chunkKindBadge && (
          <span className="shrink-0 text-[9px] px-1 py-px rounded bg-zinc-800 text-zinc-500 border border-zinc-700 font-mono leading-none">
            {chunkKindBadge}
          </span>
        )}
        {documentBadge && (
          <span className="shrink-0 text-[9px] px-1 py-px rounded bg-cyan-950/40 text-cyan-300 border border-cyan-900/60 font-mono leading-none">
            {documentBadge}
          </span>
        )}
      </div>

      {/* Preview */}
      <div className={`note-content text-[11px] text-zinc-500 flex-1 leading-relaxed ${expanded ? 'line-clamp-8' : 'line-clamp-3'}`}>
        {rest ? highlight(rest, searchQuery) : null}
      </div>

      {/* Chunk-aware match context */}
      {showMatchContext && (
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {entityTypePills.map(type => (
            <span
              key={type}
              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-900/40"
            >
              {ENTITY_TYPE_LABELS[type] ?? type}
            </span>
          ))}
          {isSemantic && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/40 text-purple-300 border border-purple-900/40">
              ≈ semantic
            </span>
          )}
          {fallbackReasons.map(reason => (
            <span
              key={reason}
              className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950/40 text-blue-200 border border-blue-900/60"
            >
              {reason}
            </span>
          ))}
        </div>
      )}

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

export default memo(NoteCard, (prevProps, nextProps) => (
  prevProps.note === nextProps.note &&
  prevProps.isActive === nextProps.isActive &&
  prevProps.isProcessing === nextProps.isProcessing &&
  prevProps.onSelect === nextProps.onSelect &&
  prevProps.searchMatch === nextProps.searchMatch &&
  prevProps.searchQuery === nextProps.searchQuery &&
  prevProps.expanded === nextProps.expanded
))
