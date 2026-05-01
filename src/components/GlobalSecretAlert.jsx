export default function GlobalSecretAlert({
  flaggedCount = 0,
  flaggedNoteIds,
  idFilter = null,
  onFilterByIds,
  onClearFilter,
}) {
  const active = Boolean(idFilter)
  const filteredCount = active
    ? [...idFilter].filter(id => flaggedNoteIds?.has(id)).length
    : 0
  const count = active ? filteredCount : flaggedCount

  if (!count && !active) return null

  return (
    <div className="flex items-center min-w-0">
      <button
        type="button"
        onClick={() => {
          if (active) {
            onClearFilter?.()
          } else {
            onFilterByIds?.(flaggedNoteIds ?? [])
          }
        }}
        title={active ? 'Clear secret note filter' : 'Show notes with potential secrets'}
        className={`inline-flex h-7 max-w-full items-center gap-1.5 px-2.5 text-[11px] rounded-md border transition-colors ${
          active
            ? 'border-amber-700/70 bg-amber-950/60 text-amber-200 hover:bg-amber-950'
            : 'border-amber-800/70 bg-amber-950/30 text-amber-300 hover:bg-amber-950/60'
        }`}
      >
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <span className="truncate">
          {active
            ? `Showing ${count} flagged note${count !== 1 ? 's' : ''}`
            : `${count} note${count !== 1 ? 's' : ''} with potential secrets`}
        </span>
        {active && (
          <span className="hidden sm:inline text-amber-500">Clear</span>
        )}
      </button>
    </div>
  )
}
