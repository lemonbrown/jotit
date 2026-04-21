import { useState, useMemo, useEffect } from 'react'

// ── Diff algorithms ──────────────────────────────────────────────────────────

function lcs(a, b) {
  const m = a.length, n = b.length
  // Bail on huge inputs
  if (m * n > 200000) return null
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const ops = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: 'eq', v: a[i - 1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'add', v: b[j - 1] }); j--
    } else {
      ops.unshift({ type: 'del', v: a[i - 1] }); i--
    }
  }
  return ops
}

function diffLines(a, b) {
  return lcs(a.split('\n'), b.split('\n')) ?? fallbackDiff(a.split('\n'), b.split('\n'))
}

function fallbackDiff(a, b) {
  const setA = new Set(a)
  return [
    ...a.filter(l => !b.includes(l)).map(v => ({ type: 'del', v })),
    ...b.map(v => ({ type: setA.has(v) ? 'eq' : 'add', v })),
  ]
}

function diffChars(a, b) {
  if (a.length * b.length > 40000) return null
  return lcs(a.split(''), b.split('')).map(op => ({ ...op, v: op.v }))
}

// Group consecutive del+add sequences, pairing them for inline char diffs
function pairHunks(ops) {
  const out = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === 'eq') { out.push(ops[i]); i++; continue }
    const dels = [], adds = []
    while (i < ops.length && ops[i].type === 'del') { dels.push(ops[i].v); i++ }
    while (i < ops.length && ops[i].type === 'add') { adds.push(ops[i].v); i++ }
    const len = Math.max(dels.length, adds.length)
    for (let p = 0; p < len; p++) {
      const d = dels[p], a = adds[p]
      if (d !== undefined && a !== undefined) out.push({ type: 'change', del: d, add: a })
      else if (d !== undefined) out.push({ type: 'del', v: d })
      else out.push({ type: 'add', v: a })
    }
  }
  return out
}

// ── Render helpers ───────────────────────────────────────────────────────────

function InlineChars({ text, highlight, color }) {
  const chars = diffChars(
    color === 'red' ? text : highlight,
    color === 'red' ? highlight : text,
  )
  if (!chars) return <span>{text}</span>
  const relevant = color === 'red' ? ['eq', 'del'] : ['eq', 'add']
  return (
    <>
      {chars.filter(c => relevant.includes(c.type)).map((c, i) => (
        c.type === 'eq'
          ? <span key={i}>{c.v}</span>
          : <mark key={i} className={color === 'red' ? 'bg-red-500/40 text-red-200 rounded-[2px]' : 'bg-green-500/40 text-green-200 rounded-[2px]'}>{c.v}</mark>
      ))}
    </>
  )
}

function DiffLine({ op }) {
  if (op.type === 'eq') {
    return (
      <div className="flex font-mono text-[12px] leading-5">
        <span className="w-5 shrink-0 text-zinc-700 select-none"> </span>
        <span className="text-zinc-500 whitespace-pre-wrap break-all">{op.v}</span>
      </div>
    )
  }
  if (op.type === 'del') {
    return (
      <div className="flex font-mono text-[12px] leading-5 bg-red-950/30">
        <span className="w-5 shrink-0 text-red-600 select-none">−</span>
        <span className="text-red-300 whitespace-pre-wrap break-all">{op.v}</span>
      </div>
    )
  }
  if (op.type === 'add') {
    return (
      <div className="flex font-mono text-[12px] leading-5 bg-green-950/30">
        <span className="w-5 shrink-0 text-green-600 select-none">+</span>
        <span className="text-green-300 whitespace-pre-wrap break-all">{op.v}</span>
      </div>
    )
  }
  if (op.type === 'change') {
    return (
      <>
        <div className="flex font-mono text-[12px] leading-5 bg-red-950/30">
          <span className="w-5 shrink-0 text-red-600 select-none">−</span>
          <span className="text-red-300 whitespace-pre-wrap break-all">
            <InlineChars text={op.del} highlight={op.add} color="red" />
          </span>
        </div>
        <div className="flex font-mono text-[12px] leading-5 bg-green-950/30">
          <span className="w-5 shrink-0 text-green-600 select-none">+</span>
          <span className="text-green-300 whitespace-pre-wrap break-all">
            <InlineChars text={op.add} highlight={op.del} color="green" />
          </span>
        </div>
      </>
    )
  }
  return null
}

// ── Note picker ──────────────────────────────────────────────────────────────

function NotePicker({ notes, currentNoteId, onLoad }) {
  return (
    <select
      onChange={e => e.target.value && onLoad(e.target.value)}
      value=""
      className="text-[11px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400 rounded px-2 py-0.5 outline-none focus:border-zinc-500 cursor-pointer max-w-[160px]"
    >
      <option value="">load from note…</option>
      {notes.map(n => (
        <option key={n.id} value={n.id} disabled={n.id === currentNoteId}>
          {n.content.split('\n')[0].slice(0, 40) || '(empty)'}
          {n.id === currentNoteId ? ' ← current' : ''}
        </option>
      ))}
    </select>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DiffViewer({ noteContent, initialA = '', initialB = '', notes = [], currentNoteId, pendingNote, onPendingNoteConsumed }) {
  const [textA, setTextA] = useState(initialA || noteContent || '')
  const [textB, setTextB] = useState(initialB)

  // Auto-load notes clicked from the sidebar: fill A first, then B
  useEffect(() => {
    if (!pendingNote) return
    if (!textA) setTextA(pendingNote.content)
    else setTextB(pendingNote.content)
    onPendingNoteConsumed?.()
  }, [pendingNote])
  const [copied, setCopied] = useState(false)

  const diff = useMemo(() => {
    if (!textA && !textB) return null
    return pairHunks(diffLines(textA, textB))
  }, [textA, textB])

  const stats = useMemo(() => {
    if (!diff) return null
    let adds = 0, dels = 0, changes = 0, eq = 0
    for (const op of diff) {
      if (op.type === 'add') adds++
      else if (op.type === 'del') dels++
      else if (op.type === 'change') changes++
      else eq++
    }
    return { adds, dels, changes, eq }
  }, [diff])

  const identical = diff && diff.every(op => op.type === 'eq')

  const copyDiff = async () => {
    if (!diff) return
    const text = diff.map(op => {
      if (op.type === 'eq') return `  ${op.v}`
      if (op.type === 'del') return `- ${op.v}`
      if (op.type === 'add') return `+ ${op.v}`
      if (op.type === 'change') return `- ${op.del}\n+ ${op.add}`
      return ''
    }).join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── Inputs ── */}
      <div className="flex flex-1 min-h-0 border-b border-zinc-800" style={{ maxHeight: '40%' }}>
        {/* Side A */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-zinc-800">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">A</span>
            <NotePicker
              notes={notes}
              currentNoteId={currentNoteId}
              onLoad={id => {
                const n = notes.find(n => n.id === id)
                if (n) setTextA(n.content)
              }}
            />
            {textA && (
              <button onClick={() => setTextA('')} className="ml-auto text-[10px] text-zinc-700 hover:text-zinc-400 transition-colors">
                clear
              </button>
            )}
          </div>
          <textarea
            value={textA}
            onChange={e => setTextA(e.target.value)}
            placeholder="Paste text A, or load a note above…"
            spellCheck={false}
            className="flex-1 bg-transparent text-zinc-300 note-content text-sm p-3 resize-none outline-none placeholder-zinc-800 overflow-y-auto"
          />
        </div>

        {/* Side B */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
            <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">B</span>
            <NotePicker
              notes={notes}
              currentNoteId={currentNoteId}
              onLoad={id => {
                const n = notes.find(n => n.id === id)
                if (n) setTextB(n.content)
              }}
            />
            {textB && (
              <button onClick={() => setTextB('')} className="ml-auto text-[10px] text-zinc-700 hover:text-zinc-400 transition-colors">
                clear
              </button>
            )}
          </div>
          <textarea
            value={textB}
            onChange={e => setTextB(e.target.value)}
            placeholder="Paste text B, or load a note above…"
            spellCheck={false}
            className="flex-1 bg-transparent text-zinc-300 note-content text-sm p-3 resize-none outline-none placeholder-zinc-800 overflow-y-auto"
          />
        </div>
      </div>

      {/* ── Diff output ── */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Stats bar */}
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/40 shrink-0">
          {stats ? (
            <>
              {identical ? (
                <span className="text-[11px] text-zinc-500 font-mono">identical</span>
              ) : (
                <>
                  {(stats.adds + stats.changes) > 0 && (
                    <span className="text-[11px] text-green-500 font-mono">
                      +{stats.adds + stats.changes}
                    </span>
                  )}
                  {(stats.dels + stats.changes) > 0 && (
                    <span className="text-[11px] text-red-500 font-mono">
                      −{stats.dels + stats.changes}
                    </span>
                  )}
                  <span className="text-[11px] text-zinc-600 font-mono">{stats.eq} unchanged</span>
                </>
              )}
              <button
                onClick={copyDiff}
                className="ml-auto text-[11px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {copied ? '✓ copied' : 'copy diff'}
              </button>
            </>
          ) : (
            <span className="text-[11px] text-zinc-700 font-mono">enter text in both panes to diff</span>
          )}
        </div>

        {/* Diff lines */}
        <div className="flex-1 overflow-y-auto p-3 space-y-0">
          {diff && !identical && diff.map((op, i) => <DiffLine key={i} op={op} />)}
          {identical && (
            <div className="text-[12px] text-zinc-600 font-mono py-4 text-center">no differences found</div>
          )}
          {!diff && (
            <div className="text-[12px] text-zinc-700 font-mono py-4 text-center">↑ fill both panes above</div>
          )}
        </div>
      </div>
    </div>
  )
}
