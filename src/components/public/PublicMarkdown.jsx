import { useEffect, useMemo, useState } from 'react'
import { escapeHtml, parseCsvRows, parseContentSegments, renderPublicMarkdown } from '../../utils/publicContent'

function PublicTable({ content }) {
  const rows = useMemo(() => parseCsvRows(content), [content])
  if (rows.length < 2) {
    return <pre><code>{content}</code></pre>
  }

  const width = Math.max(...rows.map(row => row.length))
  const headers = rows[0].map((header, index) => header.trim() || `Column ${index + 1}`)
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`)

  return (
    <table>
      <thead>
        <tr>{headers.map((header, index) => <th key={`${header}:${index}`}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.slice(1).map((row, rowIndex) => {
          const normalized = [...row]
          while (normalized.length < width) normalized.push('')
          return (
            <tr key={rowIndex}>
              {normalized.slice(0, width).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const numericVal = v => {
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) && String(v).trim() !== '' ? n : null
}

function PublicCsvTable({ csvText }) {
  const parsed = useMemo(() => {
    const rows = parseCsvRows(csvText)
    if (rows.length < 2) return null
    const width = Math.max(...rows.map(r => r.length))
    const headers = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`)
    while (headers.length < width) headers.push(`Column ${headers.length + 1}`)
    const data = rows.slice(1).map(r => {
      const next = [...r]
      while (next.length < width) next.push('')
      return next.slice(0, width)
    })
    return { headers, data }
  }, [csvText])

  const [view, setView] = useState('table')
  const [sort, setSort] = useState({ col: null, dir: null })
  const [filters, setFilters] = useState({})

  const visibleRows = useMemo(() => {
    if (!parsed) return []
    let rows = parsed.data.filter(row =>
      parsed.headers.every((_, col) => {
        const f = (filters[col] ?? '').trim().toLowerCase()
        return !f || String(row[col] ?? '').toLowerCase().includes(f)
      })
    )
    if (sort.col !== null && sort.dir) {
      rows = [...rows].sort((a, b) => {
        const av = a[sort.col] ?? '', bv = b[sort.col] ?? ''
        const an = numericVal(av), bn = numericVal(bv)
        const cmp = an !== null && bn !== null
          ? an - bn
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return rows
  }, [parsed, filters, sort])

  const cycleSort = col => setSort(prev => {
    if (prev.col !== col) return { col, dir: 'asc' }
    if (prev.dir === 'asc') return { col, dir: 'desc' }
    return { col: null, dir: null }
  })

  const hasFilters = Object.values(filters).some(f => f?.trim())

  if (!parsed) return <pre><code>{csvText}</code></pre>

  const { headers, data } = parsed

  return (
    <div className="my-4 overflow-hidden rounded border border-zinc-800 text-sm">
      <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
        <span className="font-mono text-[11px] text-zinc-500">
          {visibleRows.length !== data.length ? `${visibleRows.length} of ${data.length}` : `${data.length}`} rows
        </span>
        {hasFilters && (
          <button
            onClick={() => setFilters({})}
            className="font-mono text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setView('table')}
            className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${view === 'table' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Table
          </button>
          <button
            onClick={() => setView('raw')}
            className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${view === 'raw' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Raw
          </button>
        </div>
      </div>

      {view === 'raw' ? (
        <pre className="overflow-auto p-3 font-mono text-xs text-zinc-400 bg-zinc-950">{csvText}</pre>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-full border-collapse">
            <thead className="bg-zinc-900 sticky top-0">
              <tr>
                {headers.map((h, col) => (
                  <th key={col} className="border-b border-r border-zinc-800 p-1 align-top min-w-[120px]">
                    <button
                      onClick={() => cycleSort(col)}
                      className={`flex w-full items-center gap-1 px-1 py-0.5 font-mono text-[12px] font-semibold text-left transition-colors ${sort.col === col ? 'text-blue-300' : 'text-zinc-300 hover:text-zinc-100'}`}
                    >
                      <span className="flex-1">{h}</span>
                      <span className="text-[10px] shrink-0">
                        {sort.col === col ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                    <input
                      value={filters[col] ?? ''}
                      onChange={e => setFilters(prev => ({ ...prev, [col]: e.target.value }))}
                      placeholder="filter…"
                      className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-[11px] text-zinc-400 outline-none placeholder-zinc-700 focus:border-zinc-600"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, i) => (
                <tr key={i} className={i % 2 ? 'bg-zinc-950' : 'bg-zinc-900/30'}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-b border-r border-zinc-800 px-3 py-1.5 font-mono text-[12px] text-zinc-300">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={headers.length} className="px-3 py-4 text-center font-mono text-[11px] text-zinc-600">
                    no rows match filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function PublicMarkdown({ content, viewMode = null, onHeadings }) {
  const segments = useMemo(() => {
    if (viewMode === 'code' || viewMode === 'table') return null
    return parseContentSegments(content)
  }, [content, viewMode])

  const renderedSegments = useMemo(() => {
    if (!segments) return null
    return segments.map(seg =>
      seg.type === 'csv' ? null : renderPublicMarkdown(seg.content)
    )
  }, [segments])

  useEffect(() => {
    if (!onHeadings) return
    onHeadings(renderedSegments ? renderedSegments.flatMap(r => r?.headings ?? []) : [])
  }, [renderedSegments, onHeadings])

  if (viewMode === 'code') {
    return (
      <article className="md-prose public-prose">
        <pre><code dangerouslySetInnerHTML={{ __html: escapeHtml(content) }} /></pre>
      </article>
    )
  }

  if (viewMode === 'table') {
    return (
      <article className="md-prose public-prose">
        <PublicTable content={content} />
      </article>
    )
  }

  return (
    <article className="md-prose public-prose">
      {segments.map((seg, i) =>
        seg.type === 'csv'
          ? <PublicCsvTable key={i} csvText={seg.content} />
          : <div key={i} dangerouslySetInnerHTML={{ __html: renderedSegments[i]?.html ?? '' }} />
      )}
    </article>
  )
}
