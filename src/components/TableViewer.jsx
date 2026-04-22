import { useMemo, useState } from 'react'
import { parseCsvTable, serializeCsvTable } from '../utils/csvTable'

const numeric = (value) => {
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) && String(value).trim() !== '' ? n : null
}

export default function TableViewer({ csvText, onApply, onCancel }) {
  const initial = useMemo(() => parseCsvTable(csvText), [csvText])
  const [headers, setHeaders] = useState(initial.headers)
  const [rows, setRows] = useState(initial.rows)
  const [filters, setFilters] = useState({})
  const [sort, setSort] = useState({ col: null, dir: null })
  const [selectedRow, setSelectedRow] = useState(0)
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])

  const snapshot = () => ({ headers, rows })
  const restore = (state) => {
    setHeaders(state.headers)
    setRows(state.rows)
  }
  const commit = (mutator) => {
    setUndoStack(prev => [...prev.slice(-49), snapshot()])
    setRedoStack([])
    mutator()
  }

  const visibleRows = useMemo(() => {
    let indexed = rows.map((row, index) => ({ row, index }))
    indexed = indexed.filter(({ row }) =>
      headers.every((_, col) => {
        const filter = filters[col]?.trim().toLowerCase()
        if (!filter) return true
        return String(row[col] ?? '').toLowerCase().includes(filter)
      })
    )

    if (sort.col !== null && sort.dir) {
      indexed = [...indexed].sort((a, b) => {
        const av = a.row[sort.col] ?? ''
        const bv = b.row[sort.col] ?? ''
        const an = numeric(av)
        const bn = numeric(bv)
        const cmp = an !== null && bn !== null
          ? an - bn
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }

    return indexed
  }, [filters, headers, rows, sort])

  const summaries = useMemo(() => headers.map((_, col) => {
    const values = visibleRows.map(({ row }) => numeric(row[col])).filter(v => v !== null)
    if (!values.length) return null
    const sum = values.reduce((a, b) => a + b, 0)
    const avg = sum / values.length
    return { sum, avg, count: values.length }
  }), [headers, visibleRows])

  const updateCell = (rowIndex, colIndex, value) => {
    commit(() => {
      setRows(prev => prev.map((row, i) => i === rowIndex
        ? row.map((cell, c) => c === colIndex ? value : cell)
        : row
      ))
    })
  }

  const updateHeader = (colIndex, value) => {
    commit(() => setHeaders(prev => prev.map((h, i) => i === colIndex ? value : h)))
  }

  const addRow = () => {
    commit(() => {
      setRows(prev => [...prev, headers.map(() => '')])
      setSelectedRow(rows.length)
    })
  }

  const deleteRow = () => {
    if (!rows.length) return
    commit(() => {
      setRows(prev => prev.filter((_, i) => i !== selectedRow))
      setSelectedRow(i => Math.max(0, Math.min(i, rows.length - 2)))
    })
  }

  const cycleSort = (col) => {
    setSort(prev => {
      if (prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return { col: null, dir: null }
    })
  }

  const undo = () => {
    setUndoStack(prev => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]
      setRedoStack(r => [...r, snapshot()])
      restore(last)
      return prev.slice(0, -1)
    })
  }

  const redo = () => {
    setRedoStack(prev => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]
      setUndoStack(u => [...u, snapshot()])
      restore(last)
      return prev.slice(0, -1)
    })
  }

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault()
      redo()
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-950" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[11px] text-zinc-500 font-mono">
          Table: {rows.length} rows x {headers.length} columns
        </span>
        <button onClick={addRow} className="px-2 py-1 text-[11px] font-mono text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded bg-zinc-800">
          + Row
        </button>
        <button onClick={deleteRow} className="px-2 py-1 text-[11px] font-mono text-zinc-500 hover:text-red-300 border border-zinc-800 hover:border-red-800 rounded">
          Delete row
        </button>
        <button disabled={!undoStack.length} onClick={undo} className="px-2 py-1 text-[11px] font-mono text-zinc-400 border border-zinc-800 rounded disabled:text-zinc-800">
          Undo
        </button>
        <button disabled={!redoStack.length} onClick={redo} className="px-2 py-1 text-[11px] font-mono text-zinc-400 border border-zinc-800 rounded disabled:text-zinc-800">
          Redo
        </button>
        <button onClick={() => setFilters({})} className="px-2 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded">
          Clear filters
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => onApply(serializeCsvTable(headers, rows))} className="px-2.5 py-1 text-[11px] font-mono text-green-300 border border-green-800 hover:border-green-600 rounded bg-green-950/40">
            Apply
          </button>
          <button onClick={onCancel} className="px-2.5 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded">
            Cancel
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-950">
            <tr>
              <th className="w-10 border-b border-r border-zinc-800 bg-zinc-900 text-[10px] text-zinc-600 font-mono" />
              {headers.map((header, col) => (
                <th key={col} className="min-w-[160px] border-b border-r border-zinc-800 bg-zinc-900 p-1 align-top">
                  <div className="flex items-center gap-1">
                    <input
                      value={header}
                      onChange={e => updateHeader(col, e.target.value)}
                      className="min-w-0 flex-1 bg-zinc-950 border border-zinc-800 focus:border-zinc-600 rounded px-2 py-1 text-[12px] text-zinc-200 font-mono outline-none"
                    />
                    <button
                      onClick={() => cycleSort(col)}
                      title="Sort"
                      className={`w-7 h-7 text-[11px] font-mono rounded border ${
                        sort.col === col ? 'text-blue-300 border-blue-800 bg-blue-950/40' : 'text-zinc-600 border-zinc-800 hover:text-zinc-300'
                      }`}
                    >
                      {sort.col === col ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                    </button>
                  </div>
                  <input
                    value={filters[col] ?? ''}
                    onChange={e => setFilters(prev => ({ ...prev, [col]: e.target.value }))}
                    placeholder="filter"
                    className="mt-1 w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-600 rounded px-2 py-1 text-[11px] text-zinc-400 font-mono outline-none placeholder-zinc-700"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, index }, displayIndex) => (
              <tr key={index} className={selectedRow === index ? 'bg-blue-950/20' : displayIndex % 2 ? 'bg-zinc-950' : 'bg-zinc-900/30'}>
                <td className="border-r border-b border-zinc-800 px-2 text-right text-[11px] text-zinc-600 font-mono select-none">
                  {index + 1}
                </td>
                {headers.map((_, col) => (
                  <td key={col} className="border-r border-b border-zinc-800 p-0">
                    <input
                      value={row[col] ?? ''}
                      onFocus={() => setSelectedRow(index)}
                      onChange={e => updateCell(index, col, e.target.value)}
                      className="w-full min-w-[160px] bg-transparent focus:bg-zinc-800/80 px-2 py-1.5 text-[12px] text-zinc-300 font-mono outline-none"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-zinc-950">
            <tr>
              <td className="border-t border-r border-zinc-800 px-2 py-2 text-[10px] text-zinc-600 font-mono">Σ</td>
              {headers.map((_, col) => (
                <td key={col} className="border-t border-r border-zinc-800 px-2 py-2 text-[10px] text-zinc-500 font-mono">
                  {summaries[col]
                    ? `sum ${summaries[col].sum.toLocaleString(undefined, { maximumFractionDigits: 6 })} · avg ${summaries[col].avg.toLocaleString(undefined, { maximumFractionDigits: 6 })} · n ${summaries[col].count}`
                    : ' '}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
