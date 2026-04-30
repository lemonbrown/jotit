import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { parseDiff, parseNumstat } from '../utils/parseDiff'

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
    <div className="h-full overflow-auto divide-y divide-zinc-800/60">
      {commits.map((c, i) => (
        <div key={i} className="flex items-baseline gap-3 px-5 py-2.5 hover:bg-zinc-900/40">
          <span className="font-mono text-[11px] text-blue-400 shrink-0 select-all">{c.hash}</span>
          <span className="text-sm text-zinc-200 leading-snug">{c.message}</span>
        </div>
      ))}
    </div>
  )
}

function FilesTab({ fileStats, parsedFiles, onFileClick }) {
  const files = useMemo(() => {
    if (fileStats.length) return fileStats
    return parsedFiles.map(f => ({
      path: getFilePath(f),
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
    <div className="h-full overflow-auto divide-y divide-zinc-800/60">
      {files.map((f, i) => {
        const adds = f.additions ?? 0
        const dels = f.deletions ?? 0
        const total = adds + dels
        const filled = Math.min(Math.round((total / maxChanges) * 10), 10)
        const addBlocks = total ? Math.round((adds / total) * filled) : 0

        return (
          <button
            key={`${f.path}:${i}`}
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
                        j < filled ? 'bg-red-500' :
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

function getFilePath(file) {
  return file.toPath || file.fromPath || '(unknown file)'
}

function getFileCounts(file) {
  return file.hunks.reduce((counts, hunk) => {
    for (const line of hunk.lines) {
      if (line.type === 'add') counts.additions += 1
      if (line.type === 'del') counts.deletions += 1
    }
    return counts
  }, { additions: 0, deletions: 0 })
}

function buildDiffRows(files, expandedPaths) {
  const rows = []
  for (const file of files) {
    const path = getFilePath(file)
    const expanded = expandedPaths.has(path)
    rows.push({ type: 'file', key: `file:${path}`, file, path, expanded, ...getFileCounts(file) })

    if (!expanded) continue
    if (file.isBinary) {
      rows.push({ type: 'message', key: `binary:${path}`, text: 'Binary file - not shown.' })
      continue
    }
    if (!file.hunks.length) {
      rows.push({ type: 'message', key: `empty:${path}`, text: 'No textual diff.' })
      continue
    }

    file.hunks.forEach((hunk, hunkIndex) => {
      rows.push({ type: 'hunk', key: `hunk:${path}:${hunkIndex}`, hunk })
      hunk.lines.forEach((line, lineIndex) => {
        rows.push({ type: 'line', key: `line:${path}:${hunkIndex}:${lineIndex}`, line })
      })
    })
  }
  return rows
}

function DiffLineRow({ line }) {
  const isAdd = line.type === 'add'
  const isDel = line.type === 'del'
  const isNoeol = line.type === 'noeol'
  return (
    <div className={`grid grid-cols-[40px_40px_20px_minmax(max-content,1fr)] min-w-max ${
      isAdd ? 'bg-emerald-950/40 hover:bg-emerald-950/60' :
      isDel ? 'bg-red-950/40 hover:bg-red-950/60' :
      'hover:bg-zinc-800/30'
    }`}>
      <div className="px-2 text-right font-mono text-[10px] text-zinc-600 select-none border-r border-zinc-800/80 bg-zinc-950/50 leading-5">
        {line.oldLine ?? ''}
      </div>
      <div className="px-2 text-right font-mono text-[10px] text-zinc-600 select-none border-r border-zinc-800/80 bg-zinc-950/50 leading-5">
        {line.newLine ?? ''}
      </div>
      <div className={`text-center font-mono text-[11px] select-none leading-5 ${
        isAdd ? 'text-emerald-400' : isDel ? 'text-red-400' : 'text-zinc-700'
      }`}>
        {isAdd ? '+' : isDel ? '-' : isNoeol ? '\\' : ' '}
      </div>
      <div className={`px-2 py-0 font-mono text-xs whitespace-pre leading-5 ${
        isAdd ? 'text-emerald-200' :
        isDel ? 'text-red-300' :
        isNoeol ? 'text-zinc-500 italic text-[10px]' :
        'text-zinc-400'
      }`}>
        {isNoeol ? '\\ No newline at end of file' : line.content}
      </div>
    </div>
  )
}

function DiffRow({ row, onToggleFile }) {
  if (row.type === 'file') {
    return (
      <button
        onClick={() => onToggleFile(row.path)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800/80 transition-colors text-left border-y border-zinc-800"
      >
        <span className="text-zinc-500 text-[10px] select-none">{row.expanded ? 'v' : '>'}</span>
        <span className="flex-1 font-mono text-xs text-zinc-200 truncate min-w-0">{row.path}</span>
        {row.file.isNew && <Pill color="green">new</Pill>}
        {row.file.isDeleted && <Pill color="red">deleted</Pill>}
        {row.file.isBinary && <Pill>binary</Pill>}
        {!row.file.isBinary && (
          <span className="font-mono text-[11px] shrink-0">
            <span className="text-emerald-400">+{row.additions}</span>
            <span className="text-zinc-600 mx-1">/</span>
            <span className="text-red-400">-{row.deletions}</span>
          </span>
        )}
      </button>
    )
  }

  if (row.type === 'hunk') {
    return (
      <div className="px-4 py-1 bg-blue-950/25 border-y border-blue-900/30 font-mono text-[11px] text-blue-400/60 flex gap-2 min-w-max">
        <span className="shrink-0">{row.hunk.header}</span>
        {row.hunk.context && <span className="text-zinc-600">{row.hunk.context}</span>}
      </div>
    )
  }

  if (row.type === 'message') {
    return <div className="px-4 py-3 font-mono text-xs text-zinc-500 min-w-max">{row.text}</div>
  }

  return <DiffLineRow line={row.line} />
}

function DiffTab({ files, scrollToPath, onScrolled }) {
  const scrollRef = useRef(null)
  const [expandedPaths, setExpandedPaths] = useState(() => new Set(files.map(getFilePath)))

  useEffect(() => {
    setExpandedPaths(new Set(files.map(getFilePath)))
  }, [files])

  const rows = useMemo(() => buildDiffRows(files, expandedPaths), [expandedPaths, files])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => {
      const row = rows[index]
      if (row?.type === 'file') return 37
      if (row?.type === 'hunk') return 26
      if (row?.type === 'message') return 42
      return 20
    },
    overscan: 24,
  })

  useEffect(() => {
    if (!scrollToPath) return
    setExpandedPaths(prev => {
      if (prev.has(scrollToPath)) return prev
      const next = new Set(prev)
      next.add(scrollToPath)
      return next
    })
  }, [scrollToPath])

  useEffect(() => {
    if (!scrollToPath) return
    const index = rows.findIndex(row => row.type === 'file' && row.path === scrollToPath)
    if (index !== -1) {
      virtualizer.scrollToIndex(index, { align: 'start' })
      onScrolled()
    }
  }, [onScrolled, rows, scrollToPath, virtualizer])

  const toggleFile = useCallback((path) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  if (!files.length) {
    return <p className="px-5 py-6 text-sm text-zinc-500">No diff available.</p>
  }

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div className="relative min-w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index]
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <DiffRow row={row} onToggleFile={toggleFile} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function GitPRView({ prData, onClose }) {
  const [tab, setTab] = useState('files')
  const [scrollToPath, setScrollToPath] = useState(null)

  const { prNumber, base, log, numstat: numstatRaw, diff: diffRaw, repo, viewType } = prData
  const repoName = repo?.displayName ?? repo?.name ?? ''
  const isPR = viewType !== 'diff'
  const headerLabel = isPR ? `PR #${prNumber}` : 'Git diff'
  const baseLabel = isPR ? base : (repo?.branch ? `working tree on ${repo.branch}` : 'working tree')

  const parsedFiles = useMemo(() => parseDiff(diffRaw ?? ''), [diffRaw])
  const fileStats = useMemo(() => parseNumstat(numstatRaw ?? ''), [numstatRaw])

  const commitCount = String(log ?? '').split('\n').filter(Boolean).length
  const fileCount = fileStats.length || parsedFiles.length

  useEffect(() => {
    if (!isPR && tab === 'commits') setTab('files')
  }, [isPR, tab])

  const jumpToFile = useCallback((path) => {
    setTab('diff')
    setScrollToPath(path)
  }, [])

  return (
    <div className="h-full flex flex-col bg-zinc-950 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="font-mono text-[11px] text-zinc-500 shrink-0">{headerLabel}</span>
        <span className="text-sm font-medium text-zinc-200 truncate">{repoName}</span>
        {baseLabel && <span className="text-[11px] text-zinc-600 shrink-0 hidden sm:block">{isPR ? '<- ' : ''}{baseLabel}</span>}
        <button
          onClick={onClose}
          aria-label={isPR ? 'Close PR view' : 'Close git diff view'}
          className="ml-auto shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <div className="flex border-b border-zinc-800 bg-zinc-900/60 shrink-0 overflow-x-auto">
        {isPR && (
          <TabBtn active={tab === 'commits'} onClick={() => setTab('commits')}>
            Commits{' '}
            <span className="ml-1 px-1.5 py-px rounded bg-zinc-700 text-zinc-400 text-[10px]">
              {commitCount}
            </span>
          </TabBtn>
        )}
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

      <div className="flex-1 min-h-0">
        {isPR && tab === 'commits' && <CommitsTab log={log} />}
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
