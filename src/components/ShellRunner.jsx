import { useState, useCallback, useEffect, useRef } from 'react'
import { parseShellBlocks } from '../utils/shellParser'
import { loadSettings } from '../utils/storage'

const LOCAL_AGENT_ORIGIN = 'http://127.0.0.1:3210'

const LANG_LABEL = {
  bash: 'bash', sh: 'sh', shell: 'shell', zsh: 'zsh',
  powershell: 'ps1', pwsh: 'ps1', cmd: 'cmd',
}

function exitCodeColor(code) {
  if (code === null) return 'text-zinc-500'
  return code === 0 ? 'text-emerald-400' : 'text-red-400'
}

function BlockPane({ block, agentStatus, runTrigger = 0, onCreateNoteFromContent }) {
  const [cwd, setCwd] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef(null)
  const runRef = useRef(null)
  const deferredRunRef = useRef(false)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    abortRef.current = new AbortController()

    const settings = loadSettings()

    if (!agentStatus.available) {
      setError('Local agent not detected on 127.0.0.1:3210. Start it with: jot serve')
      setLoading(false)
      return
    }
    if (!settings.localAgentToken?.trim()) {
      setError('Local agent token is missing. Paste the token into Settings.')
      setLoading(false)
      return
    }

    try {
      const agentRes = await fetch(`${LOCAL_AGENT_ORIGIN}/shell`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.localAgentToken.trim()}`,
        },
        body: JSON.stringify({
          command: block.command,
          lang: block.lang,
          cwd: cwd.trim() || undefined,
        }),
        signal: abortRef.current.signal,
      })

      const data = await agentRes.json()
      if (!agentRes.ok && data.error) throw new Error(data.error)
      setResult(data)
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(e.message ?? 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [agentStatus.available, block.command, cwd])

  useEffect(() => { runRef.current = run })

  useEffect(() => {
    if (runTrigger > 0) {
      if (!agentStatus.checking) {
        runRef.current()
      } else {
        deferredRunRef.current = true
      }
    }
  }, [runTrigger]) // agentStatus.checking intentionally excluded — handled below

  useEffect(() => {
    if (!agentStatus.checking && deferredRunRef.current) {
      deferredRunRef.current = false
      runRef.current()
    }
  }, [agentStatus.checking])

  const cancel = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  const copyStdout = async () => {
    if (!result?.stdout) return
    await navigator.clipboard.writeText(result.stdout)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const createNote = () => {
    if (!result) return
    const lines = [`Shell: ${block.command.split('\n')[0].trim()}`, '']
    lines.push(`\`\`\`${block.lang}`, block.command, '```', '')
    if (result.stdout) lines.push('stdout:', '```', result.stdout, '```', '')
    if (result.stderr) lines.push('stderr:', '```', result.stderr, '```', '')
    lines.push(`exit ${result.exitCode} · ${result.elapsed}ms`)
    onCreateNoteFromContent?.(lines.join('\n'))
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Command preview */}
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest shrink-0">
            {LANG_LABEL[block.lang] ?? block.lang}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            {loading ? (
              <button
                onClick={cancel}
                className="px-3 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-400 rounded bg-zinc-900 transition-colors"
              >
                cancel
              </button>
            ) : (
              <button
                onClick={run}
                className="px-3 py-1 text-[11px] font-mono text-emerald-300 hover:text-emerald-100 border border-emerald-800 hover:border-emerald-500 rounded bg-emerald-950/40 hover:bg-emerald-950/70 transition-colors"
              >
                Run
              </button>
            )}
          </div>
        </div>
        <pre className="text-[12px] font-mono text-zinc-300 bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre">
          {block.command}
        </pre>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-zinc-600 shrink-0">cwd</span>
          <input
            type="text"
            value={cwd}
            onChange={e => setCwd(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && run()}
            placeholder="working directory (default: home)"
            spellCheck={false}
            className="flex-1 bg-zinc-800/60 border border-zinc-700 rounded px-2 py-1 text-[11px] font-mono text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
          />
        </div>
      </div>

      {/* Output */}
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3 space-y-2">
        {loading && (
          <div className="flex items-center gap-2 text-zinc-500 text-[12px] font-mono py-2">
            <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" />
            </svg>
            Running...
          </div>
        )}

        {!loading && error && (
          <div className="px-3 py-2 bg-red-950/50 border border-red-800 rounded-lg text-[12px] font-mono text-red-300">
            {error}
          </div>
        )}

        {!loading && result && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className={`font-bold ${exitCodeColor(result.exitCode)}`}>
                exit {result.exitCode}
              </span>
              <span className="text-zinc-600">{result.elapsed}ms</span>
              {result.timedOut && <span className="text-amber-400">timed out</span>}
              <div className="ml-auto flex items-center gap-1.5">
                {result.stdout && (
                  <button
                    onClick={copyStdout}
                    className="px-2 py-0.5 text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded transition-colors"
                  >
                    {copied ? 'copied' : 'copy stdout'}
                  </button>
                )}
                <button
                  onClick={createNote}
                  className="px-2 py-0.5 text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded transition-colors"
                >
                  new note
                </button>
              </div>
            </div>

            {result.stdout && (
              <div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">stdout</div>
                <pre className="text-[12px] font-mono text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-words">
                  {result.stdout}
                </pre>
              </div>
            )}

            {result.stderr && (
              <div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">stderr</div>
                <pre className="text-[12px] font-mono text-amber-300/80 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-words">
                  {result.stderr}
                </pre>
              </div>
            )}

            {!result.stdout && !result.stderr && (
              <span className="text-zinc-600 text-[12px] font-mono">no output</span>
            )}
          </div>
        )}

        {!loading && !error && !result && (
          <div className="text-zinc-700 text-[12px] font-mono py-2">
            Press Run to execute the command
          </div>
        )}
      </div>
    </div>
  )
}

export default function ShellRunner({ noteContent, initialText, runTrigger = 0, onCreateNoteFromContent }) {
  const hasSelection = initialText && initialText.trim().length > 0
  const [useSelection, setUseSelection] = useState(hasSelection)
  const [agentStatus, setAgentStatus] = useState({ checking: true, available: false })

  useEffect(() => {
    let cancelled = false
    fetch(`${LOCAL_AGENT_ORIGIN}/health`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(() => { if (!cancelled) setAgentStatus({ checking: false, available: true }) })
      .catch(() => { if (!cancelled) setAgentStatus({ checking: false, available: false }) })
    return () => { cancelled = true }
  }, [])

  const activeContent = useSelection && hasSelection ? initialText : noteContent
  const blocks = parseShellBlocks(activeContent)
  const [activeIdx, setActiveIdx] = useState(0)

  if (!blocks.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-[13px] font-mono">
        No shell blocks detected. Wrap commands in ```bash ... ``` fences.
      </div>
    )
  }

  const active = blocks[activeIdx] ?? blocks[0]

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60 shrink-0 text-[10px] font-mono">
        <span className={agentStatus.available ? 'text-emerald-400' : 'text-zinc-600'}>
          {agentStatus.checking ? 'Checking local agent...' : agentStatus.available ? 'Local agent connected' : 'Local agent not detected'}
        </span>
      </div>

      {/* Selection toggle */}
      {hasSelection && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-900/50 bg-amber-950/20 shrink-0">
          <span className="text-[10px] font-mono text-amber-500">{useSelection ? 'Using selection' : 'Using full note'}</span>
          <button
            onClick={() => { setUseSelection(v => !v); setActiveIdx(0) }}
            className="ml-auto text-[10px] font-mono text-amber-600 hover:text-amber-300 transition-colors px-1.5 py-0.5 border border-amber-900/60 hover:border-amber-700 rounded"
          >
            {useSelection ? 'use full note' : 'use selection'}
          </button>
        </div>
      )}

      {/* Block tabs */}
      {blocks.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60 shrink-0 overflow-x-auto">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 mr-1">{blocks.length} blocks</span>
          {blocks.map((b, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
                i === activeIdx
                  ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800'
                  : 'text-zinc-400 bg-zinc-900 border-zinc-700 hover:border-zinc-500 hover:text-zinc-100'
              }`}
            >
              {LANG_LABEL[b.lang] ?? b.lang} {i + 1}
            </button>
          ))}
        </div>
      )}

      <BlockPane key={`${activeIdx}-${active.command}`} block={active} agentStatus={agentStatus} runTrigger={runTrigger} onCreateNoteFromContent={onCreateNoteFromContent} />
    </div>
  )
}
