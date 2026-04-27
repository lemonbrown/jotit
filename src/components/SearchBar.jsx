import { useRef } from 'react'

export default function SearchBar({ value, onChange, isSearching, aiEnabled, inputRef: externalRef, searchMode, onToggleMode }) {
  const internalRef = useRef(null)
  const inputRef = externalRef ?? internalRef

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
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={aiEnabled ? 'Search all of your notes…' : 'Search notes…'}
          className="w-full pl-8 pr-8 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 focus:bg-zinc-800 transition-colors"
        />
        {value && (
          <button
            onClick={() => onChange('')}
            className="absolute right-2 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>
      {value && (
        <button
          onClick={onToggleMode}
          title={searchMode === 'plain' ? 'Plain text search — click for smart search' : 'Smart search — click for plain text'}
          className={`shrink-0 px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors ${
            searchMode === 'plain'
              ? 'border-blue-500 text-blue-400 bg-blue-950/50'
              : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500'
          }`}
        >
          Aa
        </button>
      )}
    </div>
  )
}
