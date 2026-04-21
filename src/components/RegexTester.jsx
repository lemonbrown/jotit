import { useState, useMemo } from 'react'

function esc(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function RegexTester({ noteContent, initialTestString = '' }) {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testStr, setTestStr] = useState(initialTestString)

  const toggleFlag = (f) =>
    setFlags(prev => prev.includes(f) ? prev.replace(f, '') : prev + f)

  const result = useMemo(() => {
    if (!pattern) return null
    let re
    try {
      const f = flags.includes('g') ? flags : flags + 'g'
      re = new RegExp(pattern, f)
    } catch (e) {
      return { error: e.message }
    }
    if (!testStr) return { error: null, matches: [], html: '' }

    const allMatches = []
    const segments = []
    let lastIdx = 0

    for (const m of testStr.matchAll(re)) {
      allMatches.push(m)
      if (m.index > lastIdx) segments.push({ t: 'text', s: testStr.slice(lastIdx, m.index) })
      segments.push({ t: 'match', s: m[0] || '∅', m })
      lastIdx = m.index + (m[0].length || 1)
      if (lastIdx > testStr.length) break
    }
    if (lastIdx < testStr.length) segments.push({ t: 'text', s: testStr.slice(lastIdx) })

    const html = segments.map(seg =>
      seg.t === 'match'
        ? `<mark class="rx-match">${esc(seg.s)}</mark>`
        : esc(seg.s)
    ).join('')

    const matches = allMatches.map((m, i) => ({
      i,
      full: m[0],
      index: m.index,
      groups: [...m].slice(1),
      named: m.groups ?? null,
    }))

    return { error: null, matches, html }
  }, [pattern, flags, testStr])

  const matchCount = result?.matches?.length ?? null
  const hasError = result?.error

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Pattern row */}
      <div className="px-4 py-2.5 border-b border-zinc-800 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-600 font-mono shrink-0">pattern</span>
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none select-none">/</span>
            <input
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              placeholder="regex pattern"
              spellCheck={false}
              className={`w-full bg-zinc-800 border rounded px-6 py-1.5 text-sm font-mono text-zinc-200 outline-none transition-colors ${
                hasError ? 'border-red-800 focus:border-red-600' : 'border-zinc-700 focus:border-zinc-500'
              }`}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none select-none">/{flags}</span>
          </div>

          {/* Flags */}
          <div className="flex gap-0.5 shrink-0">
            {['g','i','m','s'].map(f => (
              <button
                key={f}
                onClick={() => toggleFlag(f)}
                title={{ g: 'global', i: 'case insensitive', m: 'multiline', s: 'dot-all' }[f]}
                className={`w-6 h-6 text-[11px] font-mono rounded border transition-colors ${
                  flags.includes(f)
                    ? 'bg-blue-900/70 text-blue-300 border-blue-700'
                    : 'text-zinc-600 border-zinc-700 hover:text-zinc-400 hover:border-zinc-600'
                }`}
              >{f}</button>
            ))}
          </div>

          {/* Match count */}
          {!hasError && matchCount !== null && testStr && (
            <span className={`text-[11px] font-mono shrink-0 ${matchCount > 0 ? 'text-green-400' : 'text-zinc-600'}`}>
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </span>
          )}
        </div>

        {hasError && (
          <div className="text-[11px] text-red-400 font-mono bg-red-950/30 border border-red-900/40 rounded px-2.5 py-1">
            {result.error}
          </div>
        )}
      </div>

      {/* Test string + results */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Input */}
        <textarea
          value={testStr}
          onChange={e => setTestStr(e.target.value)}
          placeholder="Paste test string here…"
          spellCheck={false}
          className="note-content text-sm text-zinc-400 bg-transparent p-4 resize-none outline-none placeholder-zinc-800 overflow-y-auto border-b border-zinc-800"
          style={{ flex: '0 0 40%' }}
        />

        {/* Output */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {testStr && !hasError && (
            <>
              {/* Highlighted text */}
              <div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">Highlighted</div>
                <pre
                  className="note-content text-[13px] text-zinc-400 leading-relaxed whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: result.html || esc(testStr) }}
                />
              </div>

              {/* Match details */}
              {result.matches.length > 0 && (
                <div>
                  <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">Matches</div>
                  <div className="space-y-1.5">
                    {result.matches.map(m => (
                      <div key={m.i} className="text-[12px] font-mono bg-zinc-900 border border-zinc-800 rounded px-3 py-2 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
                        <span className="text-zinc-600 shrink-0">[{m.i}]</span>
                        <span className="text-amber-300">"{m.full}"</span>
                        {m.groups.map((g, gi) => (
                          <span key={gi} className="text-[11px]">
                            <span className="text-zinc-600">group {gi + 1}: </span>
                            <span className="text-blue-400">{g == null ? <span className="text-zinc-600">undefined</span> : `"${g}"`}</span>
                          </span>
                        ))}
                        {m.named && Object.entries(m.named).map(([k, v]) => (
                          <span key={k} className="text-[11px]">
                            <span className="text-zinc-600">?&lt;{k}&gt;: </span>
                            <span className="text-purple-400">"{v}"</span>
                          </span>
                        ))}
                        <span className="text-zinc-700 text-[10px] ml-auto">index {m.index}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.matches.length === 0 && testStr && pattern && (
                <div className="text-[12px] text-zinc-600 font-mono">no matches</div>
              )}
            </>
          )}

          {!testStr && (
            <div className="text-[12px] text-zinc-700 font-mono">paste a test string above ↑</div>
          )}
        </div>
      </div>
    </div>
  )
}
