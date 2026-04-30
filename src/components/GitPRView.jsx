import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { parseDiff, parseNumstat } from '../utils/parseDiff'

// ── Primitives ────────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-blue-500 text-zinc-100'
          : 'border-transparent text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  )
}

function Pill({ children, color = 'zinc' }) {
  const colors = {
    zinc: 'bg-zinc-700 text-zinc-400',
    green: 'bg-emerald-900/80 text-emerald-300',
    red: 'bg-red-900/80 text-red-300',
    blue: 'bg-blue-900/80 text-blue-300',
  }
  return (
    <span className={`inline-block px-1.5 py-px rounded text-[10px] font-mono leading-tight ${colors[color]}`}>
      {children}
    </span>
  )
}

// ── Commits tab ───────────────────────────────────────────────────────────────

function CommitsTab({ log }) {
  const commits = useMemo(() =>
    String(log ?? '').split('\n').filter(Boolean).map(line => {
      const sp = line.indexOf(' ')
      return { hash: line.slice(0, sp), message: line.slice(sp + 1) }
    }),
    [log]
  )

  if (!commits.length) {
    return <p className="px-5 py-6 text-sm text-zinc-500">No commits found.</p>
  }

  return (
    <div className="divide-y divide-zinc-800/60">
      {commits.map((c, i) => (
        <div key={i} className="flex items-baseline gap-3 px-5 py-2.5 hover:bg-zinc-900/40">
          <span className="font-mono text-[11px] text-blue-400 shrink-0 select-all">{c.hash}</span>
          <span className="text-sm text-zinc-200 leading-snug">{c.message}</span>
        </div>
      ))}
    </div>
  )
}

// ── Files tab ─────────────────────────────────────────────────────────────────

function FilesTab({ fileStats, parsedFiles, onFileClick }) {
  const files = useMemo(() => {
    if (fileStats.length) return fileStats
    return parsedFiles.map(f => ({
      path: f.toPath || f.fromPath,
      additions: f.hunks.reduce((s, h) => s + h.lines.filter(l => l.type === 'add').length, 0),
      deletions: f.hunks.reduce((s, h) => s + h.lines.filter(l => l.type === 'del').length, 0),
      isBinary: f.isBinary,
    }))
  }, [fileStats, parsedFiles])

  const maxChanges = useMemo(() =>
    Math.max(...files.map(f => (f.additions ?? 0) + (f.deletions ?? 0)), 1),
    [files]
  )

  if (!files.length) {
    return <p className="px-5 py-6 text-sm text-zinc-500">No files changed.</p>
  }

  return (
    <div className="divide-y divide-zinc-800/60">
      {files.map((f, i) => {
        const adds = f.additions ?? 0
        const dels = f.deletions ?? 0
        const total = adds + dels
        const filled = Math.min(Math.round((total / maxChanges) * 10), 10)
        const addBlocks = total ? Math.round((adds / total) * filled) : 0

        return (
          <button
            key={i}
            onClick={() => onFileClick(f.path)}
            className="w-full flex items-center gap-3 px-5 py-2 hover:bg-zinc-900/50 transition-colors text-left"
          >
            <span className="flex-1 font-mono text-xs text-zinc-300 truncate min-w-0">{f.path}</span>
            {f.isBinary ? (
              <Pill>binary</Pill>
            ) : (
              <>
                <span className="font-mono text-[11px] text-emerald-400 w-8 text-right shrink-0">+{adds}</span>
                <span className="font-mono text-[11px] text-red-400 w-8 text-right shrink-0">-{dels}</span>
                <div className="flex gap-px shrink-0">
                  {Array.from({ length: 10 }).map((_, j) => (
                    <div
                      key={j}
                      className={`w-2 h-3 rounded-sm ${
                        j < addBlocks ? 'bg-emerald-500' :
                        j < filled   ? 'bg-red-500' :
                                       'bg-zinc-700'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Diff tab ──────────────────────────────────────────────────────────────────

function DiffHunk({ hunk }) {
  return (
    <div>
      <div className="px-4 py-1 bg-blue-950/25 border-y border-blue-900/30 font-mono text-[11px] text-blue-400/60 flex gap-2 overflow-x-auto">
        <span className="shrink-0">{hunk.header}</span>
        {hunk.context && <span className="text-zinc-600 truncate">{hunk.context}</span>}
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {hunk.lines.map((line, i) => {
            const isAdd  = line.type === 'add'
            const isDel  = line.type === 'del'
            const isNoeol = line.type === 'noeol'
            return (
              <tr
                key={i}
                className={
                  isAdd  ? 'bg-emerald-950/40 hover:bg-emerald-950/60' :
                  isDel  ? 'bg-red-950/40 hover:bg-red-950/60' :
                           'hover:bg-zinc-800/30'
                }
              >
                <td className="w-10 px-2 text-right font-mono text-[10px] text-zinc-600 select-none border-r border-zinc-800/80 bg-zinc-950/50 leading-5">
                  {line.oldLine ?? ''}
                </td>
                <td className="w-10 px-2 text-right font-mono text-[10px] text-zinc-600 select-none border-r border-zinc-800/80 bg-zinc-950/50 leading-5">
                  {line.newLine ?? ''}
                </td>
                <td className={`w-5 text-center font-mono text-[11px] select-none leading-5 ${
                  isAdd ? 'text-emerald-400' : isDel ? 'text-red-400' : 'text-zinc-700'
                }`}>
                  {isAdd ? '+' : isDel ? '-' : isNoeol ? '\\' : ' '}
                </td>
                <td className={`px-2 py-0 font-mono text-xs whitespace-pre leading-5 ${
                  isAdd   ? 'text-emerald-200' :
                  isDel   ? 'text-red-300' :
                  isNoeol ? 'text-zinc-500 italic text-[10px]' :
                            'text-zinc-400'
                }`}>
                  {isNoeol ? '\ No newline at end of file' : line.content}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DiffFile({ file, fileRef, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const path = file.toPath || file.fromPath
  const addCount = useMemo(() =>
    file.hunks.reduce((s, h) => s + h.lines.filter(l => l.type === 'add').length, 0),
    [file.hunks]
  )
  const delCount = useMemo(() =>
    file.hunks.reduce((s, h) => s + h.lines.filter(l => l.type === 'del').length, 0),
    [file.hunks]
  )

  return (
    <div ref={fileRef} className="border border-zinc-800 rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800/80 transition-colors text-left"
      >
        <span className="text-zinc-500 text-[10px] select-none">{expanded ? '▾' : '▸'}</span>
        <span className="flex-1 font-mono text-xs text-zinc-200 truncate min-w-0">{path}</span>
        {file.isNew     && <Pill color="green">new</Pill>}
        {file.isDeleted && <Pill color="red">deleted</Pill>}
        {file.isBinary  && <Pill>binary</Pill>}
        {!file.isBinary && (
          <span className="font-mono text-[11px] shrink-0">
            <span className="text-emerald-400">+{addCount}</span>
            <span className="text-zinc-600 mx-1">/</span>
            <span className="text-red-400">-{delCount}</span>
          </span>
        )}
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-zinc-800/60">
          {file.isBinary ? (
            <p className="px-4 py-3 font-mono text-xs text-zinc-500">Binary file — not shown.</p>
          ) : file.hunks.length === 0 ? (
            <p className="px-4 py-3 font-mono text-xs text-zinc-500">No textual diff.</p>
          ) : (
            file.hunks.map((hunk, i) => <DiffHunk key={i} hunk={hunk} />)
          )}
        </div>
      )}
    </div>
  )
}

function DiffTab({ files, scrollToPath, onScrolled }) {
  const fileEls = useRef({})
  const totalLines = useMemo(() =>
    files.reduce((s, f) => s + f.hunks.reduce((hs, h) => hs + h.lines.length, 0), 0),
    [files]
  )
  const defaultExpanded = totalLines <= 500

  useEffect(() => {
    if (!scrollToPath) return
    const el = fileEls.current[scrollToPath]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      onScrolled()
    }
  }, [scrollToPath, onScrolled])

  if (!files.length) {
    return <p className="px-5 py-6 text-sm text-zinc-500">No diff available.</p>
  }

  return (
    <div className="py-3 px-3">
      {files.map((file, i) => {
        const path = file.toPath || file.fromPath
        return (
          <DiffFile
            key={path || i}
            file={file}
            fileRef={el => { fileEls.current[path] = el }}
            defaultExpanded={defaultExpanded}
          />
        )
      })}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function GitPRView({ prData, onClose }) {
  const [tab, setTab] = useState('files')
  const [scrollToPath, setScrollToPath] = useState(null)

  const { prNumber, base, log, numstat: numstatRaw, diff: diffRaw, repo } = prData
  const repoName = repo?.displayName ?? repo?.name ?? ''

  const parsedFiles = useMemo(() => parseDiff(diffRaw ?? ''), [diffRaw])
  const fileStats   = useMemo(() => parseNumstat(numstatRaw ?? ''), [numstatRaw])

  const commitCount = String(log ?? '').split('\n').filter(Boolean).length
  const fileCount   = fileStats.length || parsedFiles.length

  const jumpToFile = useCallback((path) => {
    setTab('diff')
    setScrollToPath(path)
  }, [])

  return (
    <div className="h-full flex flex-col bg-zinc-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="font-mono text-[11px] text-zinc-500 shrink-0">PR #{prNumber}</span>
        <span className="text-sm font-medium text-zinc-200 truncate">{repoName}</span>
        <span className="text-[11px] text-zinc-600 shrink-0 hidden sm:block">← {base}</span>
        <button
          onClick={onClose}
          aria-label="Close PR view"
          className="ml-auto shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-900/60 shrink-0 overflow-x-auto">
        <TabBtn active={tab === 'commits'} onClick={() => setTab('commits')}>
          Commits{' '}
          <span className="ml-1 px-1.5 py-px rounded bg-zinc-700 text-zinc-400 text-[10px]">
            {commitCount}
          </span>
        </TabBtn>
        <TabBtn active={tab === 'files'} onClick={() => setTab('files')}>
          Files{' '}
          <span className="ml-1 px-1.5 py-px rounded bg-zinc-700 text-zinc-400 text-[10px]">
            {fileCount}
          </span>
        </TabBtn>
        <TabBtn active={tab === 'diff'} onClick={() => setTab('diff')}>
          Diff
        </TabBtn>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'commits' && <CommitsTab log={log} />}
        {tab === 'files' && (
          <FilesTab
            fileStats={fileStats}
            parsedFiles={parsedFiles}
            onFileClick={jumpToFile}
          />
        )}
        {tab === 'diff' && (
          <DiffTab
            files={parsedFiles}
            scrollToPath={scrollToPath}
            onScrolled={() => setScrollToPath(null)}
          />
        )}
      </div>
    </div>
  )
}
