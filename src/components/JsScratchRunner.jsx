import { useState, useCallback, useMemo } from 'react'
import { parseJsBlocks } from '../utils/jsRunner'
import { runJsInWorker } from '../utils/jsRunner'

function BlockPane({ block, index, notes, currentNote }) {
  const [output, setOutput] = useState(null) // { status, logs, result, error }

  const run = useCallback(() => {
    setOutput({ status: 'running', logs: [], result: undefined, error: undefined })
    const snapshot = {
      notes: (notes ?? []).map(n => ({ id: n.id, content: n.content ?? '' })),
      currentNote: { id: currentNote?.id, content: currentNote?.content ?? '' },
    }
    runJsInWorker(block.code, snapshot, (msg) => {
      if (msg.type === 'log') {
        setOutput(prev => ({ ...prev, logs: [...(prev?.logs ?? []), msg.line] }))
      } else if (msg.type === 'done') {
        setOutput(prev => ({ ...prev, status: 'done', result: msg.result }))
      } else if (msg.type === 'error') {
        setOutput(prev => ({ ...prev, status: 'error', error: msg.message }))
      }
    })
  }, [block.code, notes, currentNote])

  const clear = useCallback(() => setOutput(null), [])

  return (
    <div className="flex flex-col min-h-0 border-b border-zinc-800/60 last:border-0">
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            {block.lang} #{index + 1}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            {output && (
              <button
                onClick={clear}
                className="px-2 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded bg-transparent transition-colors"
              >
                clear
              </button>
            )}
            <button
              onClick={run}
              disabled={output?.status === 'running'}
              className="px-3 py-1 text-[11px] font-mono text-emerald-300 hover:text-emerald-100 border border-emerald-800 hover:border-emerald-500 rounded bg-emerald-950/40 hover:bg-emerald-950/70 transition-colors disabled:opacity-50 disabled:cursor-default"
            >
              {output?.status === 'running' ? 'running…' : 'Run'}
            </button>
          </div>
        </div>
        <pre className="text-[12px] font-mono text-zinc-300 bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre max-h-48 overflow-y-auto">
          {block.code}
        </pre>
      </div>

      {output && (
        <div className="mx-3 mb-3 rounded border border-zinc-700/60 bg-zinc-950 text-[11.5px] font-mono overflow-hidden">
          {output.status === 'running' && !output.logs.length && (
            <div className="px-3 py-2 text-zinc-500">running…</div>
          )}
          {output.logs.map((line, i) => (
            <div key={i} className="px-3 py-[3px] text-zinc-300 leading-relaxed border-b border-zinc-800/40 last:border-0 whitespace-pre-wrap break-all">{line}</div>
          ))}
          {output.status === 'done' && output.result !== undefined && (
            <div className="px-3 py-2 text-emerald-400 border-t border-zinc-800/60 whitespace-pre-wrap break-all">→ {output.result}</div>
          )}
          {output.status === 'done' && output.result === undefined && !output.logs.length && (
            <div className="px-3 py-2 text-zinc-600">→ (no output)</div>
          )}
          {output.status === 'error' && (
            <div className="px-3 py-2 text-red-400 border-t border-zinc-800/60 whitespace-pre-wrap break-all">✕ {output.error}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function JsScratchRunner({ noteContent, notes, currentNote }) {
  const blocks = useMemo(() => parseJsBlocks(noteContent ?? ''), [noteContent])

  if (!blocks.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] font-mono text-zinc-600">
        No JS/TS code blocks found in this note.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {blocks.map((block, i) => (
        <BlockPane key={i} block={block} index={i} notes={notes} currentNote={currentNote} />
      ))}
    </div>
  )
}
