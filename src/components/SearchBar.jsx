import { useEffect, useRef, useState } from 'react'

export default function SearchBar({
  value,
  onChange,
  isSearching,
  aiEnabled,
  llmEnabled = false,
  isNibSearching = false,
  nibSearchApplied = false,
  inputRef: externalRef,
  searchMode,
  onToggleMode,
  onImproveWithNib,
}) {
  const internalRef = useRef(null)
  const inputRef = externalRef ?? internalRef
  const [draftValue, setDraftValue] = useState(value ?? '')
  const emitTimerRef = useRef(null)

  useEffect(() => {
    setDraftValue(value ?? '')
  }, [value])

  useEffect(() => () => clearTimeout(emitTimerRef.current), [])

  const scheduleChange = (nextValue) => {
    setDraftValue(nextValue)
    clearTimeout(emitTimerRef.current)
    emitTimerRef.current = setTimeout(() => {
      onChange(nextValue)
    }, 90)
  }

  const clearSearch = () => {
    clearTimeout(emitTimerRef.current)
    setDraftValue('')
    onChange('')
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex items-center flex-1">
        <span className="absolute left-2.5 text-zinc-600 text-sm pointer-events-none">
          {isSearching ? (
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 3a6 6 0 100 12A6 6 0 009 3zM1 9a8 8 0 1114.32 4.906l3.387 3.387a1 1 0 01-1.414 1.414l-3.387-3.387A8 8 0 011 9z" clipRule="evenodd" />
            </svg>
          )}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={draftValue}
          onChange={e => scheduleChange(e.target.value)}
          placeholder={aiEnabled ? 'Search all of your notes...' : 'Search notes...'}
          className="w-full pl-8 pr-8 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 focus:bg-zinc-800 transition-colors"
        />
        {draftValue && (
          <button
            onClick={clearSearch}
            className="absolute right-2 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
      <div className="shrink-0 inline-flex rounded-md border border-zinc-700 overflow-hidden bg-zinc-900">
        <button
          onClick={() => searchMode !== 'plain' && onToggleMode()}
          title="Plain text search"
          aria-pressed={searchMode === 'plain'}
          className={`px-2 py-1 text-[10px] font-mono transition-colors ${
            searchMode === 'plain'
              ? 'text-blue-300 bg-blue-950/60'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          Plain
        </button>
        <button
          onClick={() => searchMode === 'plain' && onToggleMode()}
          title="Smart search with local/server search intelligence"
          aria-pressed={searchMode !== 'plain'}
          className={`px-2 py-1 text-[10px] font-mono border-l border-zinc-700 transition-colors ${
            searchMode !== 'plain'
              ? 'text-emerald-300 bg-emerald-950/40'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          Smart
        </button>
      </div>
      {draftValue && searchMode !== 'plain' && (
        <button
          onClick={llmEnabled ? onImproveWithNib : undefined}
          disabled={!llmEnabled || isNibSearching}
          title={
            !llmEnabled
              ? 'Enable Nib in Settings to rerank smart search results'
              : nibSearchApplied
                ? 'Nib-ranked results'
                : 'Improve ranking with Nib'
          }
          className={`shrink-0 px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors ${
            !llmEnabled
              ? 'border-zinc-800 text-zinc-700 bg-zinc-900 cursor-not-allowed'
            : nibSearchApplied
              ? 'border-emerald-600 text-emerald-300 bg-emerald-950/50'
              : isNibSearching
                ? 'border-emerald-900 text-emerald-600 bg-emerald-950/20'
                : 'border-emerald-900 text-emerald-500 hover:text-emerald-300 hover:border-emerald-700 bg-emerald-950/20'
          }`}
        >
          {isNibSearching ? '...' : 'Nib'}
        </button>
      )}
    </div>
  )
}
