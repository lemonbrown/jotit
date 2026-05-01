import { timeAgo } from '../utils/helpers'
import { redactCredentialPreview } from '../utils/searchCore'
import CategoryBadge from './CategoryBadge'
import { isOpenApiNote, isPublicClone, isSQLiteNote } from '../utils/noteTypes'

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

export function buildNotePreviewModel(note, searchMatch = null, { expanded = false } = {}) {
  const lines = note.content.split('\n').filter(line => line.trim())
  const firstLine = lines[0] ?? ''
  const defaultRest = lines.slice(1, expanded ? 14 : 4).join('\n')
  const rawPreview = searchMatch?.preview ?? defaultRest
  const rest = searchMatch?.preview ? redactCredentialPreview(rawPreview) : defaultRest
  const badges = note.categories.slice(0, expanded ? 6 : 3)
  const searchHeading = searchMatch?.matchedSectionTitle || firstLine
  const chunkKindBadge = searchMatch?.matchedChunkKind && searchMatch.matchedChunkKind !== 'prose'
    ? searchMatch.matchedChunkKind
    : null
  const entityTypePills = [...new Set((searchMatch?.entityHits ?? []).map(entity => entity.entityType))]
    .slice(0, expanded ? 4 : 2)
  const isSemantic = ['semantic', 'hybrid-semantic', 'semantic-chunk'].includes(searchMatch?.matchType)
  const reasons = (searchMatch?.reasons ?? []).filter(reason => !reason.startsWith('section:')).slice(0, expanded ? 4 : 2)
  const matchCount = searchMatch?.matchType === 'plain' ? (searchMatch.matchCount ?? null) : null
  const showMatchContext = !!(searchMatch && (chunkKindBadge || entityTypePills.length || isSemantic || reasons.length || matchCount != null))
  const documentBadge = isOpenApiNote(note) ? 'openapi' : isSQLiteNote(note) ? 'sqlite' : null
  const cloned = isPublicClone(note)
  const isE2EEncrypted = Number(note.encryptionTier ?? 0) === 2

  return {
    badges,
    chunkKindBadge,
    cloned,
    documentBadge,
    entityTypePills,
    firstLine,
    isE2EEncrypted,
    isSemantic,
    matchCount,
    reasons,
    rest,
    searchHeading,
    showMatchContext,
  }
}

export function highlight(text, query) {
  if (!query || !text || typeof text !== 'string') return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text

  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-yellow-400/30 text-yellow-200">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function NotePreviewBody({
  note,
  model,
  searchQuery,
  showMetadata = true,
  compact = false,
}) {
  return (
    <>
      <div className={`flex items-baseline gap-1.5 min-w-0 ${compact ? 'mb-1' : 'mb-2'}`}>
        <div className={`note-content truncate flex-1 min-w-0 font-medium ${compact ? 'text-[11px]' : 'text-[13px]'} ${model.firstLine ? 'text-zinc-200' : 'italic text-zinc-700'}`}>
          {model.searchHeading ? highlight(model.searchHeading, searchQuery) : 'empty'}
        </div>
        {showMetadata && model.isE2EEncrypted && (
          <span
            className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border border-amber-800/70 bg-amber-950/40 text-amber-300"
            title="End-to-end encrypted"
            aria-label="End-to-end encrypted"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
          </span>
        )}
        {showMetadata && model.chunkKindBadge && (
          <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1 py-px font-mono text-[9px] leading-none text-zinc-500">
            {model.chunkKindBadge}
          </span>
        )}
        {showMetadata && model.documentBadge && (
          <span className="shrink-0 rounded border border-cyan-900/60 bg-cyan-950/40 px-1 py-px font-mono text-[9px] leading-none text-cyan-300">
            {model.documentBadge}
          </span>
        )}
      </div>

      <div className={`note-content flex-1 leading-relaxed text-zinc-500 ${compact ? 'line-clamp-3 text-[10px]' : 'text-[12px] whitespace-pre-wrap overflow-hidden max-h-[16rem]'}`}>
        {model.rest ? highlight(model.rest, searchQuery) : null}
      </div>

      {showMetadata && model.showMatchContext && (
        <div className={`mt-2 flex flex-wrap items-center gap-1 ${compact ? '' : 'min-h-[1.5rem]'}`}>
          {model.matchCount != null && (
            <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              {model.matchCount}x
            </span>
          )}
          {model.entityTypePills.map(type => (
            <span
              key={type}
              className="rounded border border-emerald-900/40 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300"
            >
              {ENTITY_TYPE_LABELS[type] ?? type}
            </span>
          ))}
          {model.isSemantic && (
            <span className="rounded border border-purple-900/40 bg-purple-950/40 px-1.5 py-0.5 text-[10px] text-purple-300">
              semantic
            </span>
          )}
          {model.reasons.map(reason => (
            <span
              key={reason}
              className="rounded border border-blue-900/60 bg-blue-950/40 px-1.5 py-0.5 text-[10px] text-blue-200"
            >
              {reason}
            </span>
          ))}
        </div>
      )}

      <div className={`mt-2 flex items-end gap-1 flex-wrap ${compact ? '' : 'pt-1 border-t border-zinc-800/80'}`}>
        {showMetadata && model.badges.map(category => <CategoryBadge key={category} category={category} size="xs" />)}
        {showMetadata && note.categories.length > model.badges.length && (
          <span className="text-[10px] text-zinc-600">+{note.categories.length - model.badges.length}</span>
        )}
        {showMetadata && note.isPublic && (
          <span className="rounded border border-emerald-900/40 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
            public
          </span>
        )}
        {showMetadata && model.cloned && (
          <span className="rounded border border-blue-900/60 bg-blue-950/40 px-1.5 py-0.5 text-[10px] text-blue-200">
            cloned
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-zinc-700">{timeAgo(note.updatedAt)}</span>
      </div>
    </>
  )
}
