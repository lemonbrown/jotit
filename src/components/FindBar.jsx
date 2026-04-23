export default function FindBar({
  query, onQueryChange, mode, onModeChange,
  matchIndex, matchCount, onNext, onPrev, onClose,
  regexError, inputRef,
  sectionMatches, onJumpToSection,
  scope,
}) {
  // Show in:code / in:text autocomplete while the user is still typing the directive
  const typingDirective = query.toLowerCase().startsWith('in:') && !query.slice(3).includes(' ')
  const directivePrefix = typingDirective ? query.slice(3).toLowerCase() : ''
  const scopeOptions = typingDirective
    ? ['code', 'text'].filter(s => s.startsWith(directivePrefix)).map(s => 'in:' + s)
    : []

  return (
    <div className="flex flex-col border-b border-zinc-800 bg-zinc-950/80 shrink-0">

      {/* ── Main row ── */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[10px] text-zinc-600 font-mono shrink-0">find</span>

        {/* Input + scope autocomplete */}
        <div className="relative">
          <input
            ref={inputRef}
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onNext() }
              if (e.key === 'Enter' && e.shiftKey)  { e.preventDefault(); onPrev() }
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            placeholder="search… or in:code / in:text"
            spellCheck={false}
            className={`w-60 bg-zinc-800 border rounded px-2.5 py-1 text-sm font-mono text-zinc-200 outline-none transition-colors placeholder-zinc-700 ${
              regexError ? 'border-red-700 focus:border-red-600' : 'border-zinc-700 focus:border-zinc-500'
            }`}
          />
          {regexError && !typingDirective && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-red-500 font-mono pointer-events-none">
              invalid
            </span>
          )}
          {scopeOptions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 z-20 flex flex-col bg-zinc-900 border border-zinc-700 rounded shadow-xl overflow-hidden min-w-max">
              {scopeOptions.map(opt => (
                <button
                  key={opt}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    onQueryChange(opt + ' ')
                    inputRef?.current?.focus()
                  }}
                  className="flex items-center gap-3 px-3 py-1.5 text-[11px] font-mono text-left text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
                >
                  <span className="text-zinc-100">{opt}</span>
                  <span className="text-zinc-600">
                    {opt === 'in:code' ? 'inside code blocks' : 'in prose text'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Scope badge — shown when an in:code or in:text scope is active */}
        {scope && scope !== 'all' && (
          <span
            title={`Searching ${scope === 'code' ? 'inside' : 'outside'} code blocks. Clear query to remove.`}
            className={`px-1.5 py-0.5 text-[10px] font-mono rounded border shrink-0 ${
              scope === 'code'
                ? 'text-blue-300 border-blue-800 bg-blue-950/40'
                : 'text-amber-300 border-amber-800 bg-amber-950/40'
            }`}
          >
            {scope.toUpperCase()}
          </span>
        )}

        {/* Mode pills */}
        <div className="flex items-center border border-zinc-700 rounded overflow-hidden shrink-0">
          {[
            { id: 'exact', label: 'Aa', title: 'Exact match (case-insensitive)' },
            { id: 'fuzzy', label: '~',  title: 'Fuzzy match (character sequence)' },
            { id: 'regex', label: '.*', title: 'Regular expression' },
          ].map(({ id, label, title }, i) => (
            <button
              key={id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onModeChange(id)}
              title={title}
              className={`px-2.5 py-0.5 text-[11px] font-mono transition-colors ${
                i > 0 ? 'border-l border-zinc-700' : ''
              } ${
                mode === id
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="text-[11px] text-zinc-500 font-mono shrink-0 min-w-[4rem] text-right">
          {matchCount === 0
            ? (query && !regexError && !typingDirective ? 'no match' : '')
            : `${matchIndex + 1} / ${matchCount}`}
        </span>

        <button
          onMouseDown={e => e.preventDefault()}
          onClick={onPrev}
          disabled={matchCount === 0}
          title="Previous match (Shift+Enter)"
          className="text-zinc-500 hover:text-zinc-200 disabled:text-zinc-700 transition-colors shrink-0 text-base leading-none"
        >↑</button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={onNext}
          disabled={matchCount === 0}
          title="Next match (Enter)"
          className="text-zinc-500 hover:text-zinc-200 disabled:text-zinc-700 transition-colors shrink-0 text-base leading-none"
        >↓</button>

        <button
          onMouseDown={e => e.preventDefault()}
          onClick={onClose}
          title="Close (Esc)"
          className="ml-1 text-zinc-600 hover:text-zinc-300 transition-colors text-sm leading-none shrink-0"
        >✕</button>
      </div>

      {/* ── Section breakdown ── */}
      {sectionMatches && sectionMatches.length > 0 && (
        <div className="flex items-center gap-1 px-3 pb-2 flex-wrap">
          <span className="text-[10px] text-zinc-700 font-mono shrink-0 mr-0.5">in:</span>
          {sectionMatches.map((s, i) => (
            <button
              key={i}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onJumpToSection(s.firstMatchResultIdx)}
              title={`Jump to first match in "${s.title}"`}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded bg-transparent hover:bg-zinc-800/40 transition-colors whitespace-nowrap"
            >
              <span className="text-zinc-700">{'#'.repeat(s.level)}</span>
              {s.title}
              <span className="text-zinc-700 ml-0.5">({s.matchCount})</span>
            </button>
          ))}
        </div>
      )}

    </div>
  )
}
