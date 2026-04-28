import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadSQLiteAsset, getSQLiteAsset, replaceSQLiteAssetBytes, replaceSQLiteAssetFromFile } from '../utils/sqliteAssets'
import { executeSQLiteQuery, inspectSQLiteDatabase, readSQLiteTable, updateSQLiteRow } from '../utils/externalSqlite'
import { validateSelectQuery } from '../utils/externalSqliteCore'
import { streamLLMChat } from '../utils/llmClient'

const PAGE_SIZE = 100
const DEFAULT_QUERY = `SELECT type, name, sql
FROM sqlite_master
WHERE type IN ('table', 'view')
  AND name NOT LIKE 'sqlite_%'
ORDER BY type, name`
const HIDDEN_ROW_ID = '__jotit_rowid'

function extractSQLFromResponse(text) {
  const fenced = text.match(/```(?:sql|sqlite)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const lines = text.split('\n')
  const startIndex = lines.findIndex(line => /^\s*select\b/i.test(line))
  if (startIndex === -1) return ''

  const sqlLines = []
  for (const line of lines.slice(startIndex)) {
    if (!line.trim()) break
    sqlLines.push(line)
    if (line.trim().endsWith(';')) break
  }
  return sqlLines.join('\n').trim()
}

function buildSQLiteNibContext({ overview, queryText }) {
  const parts = []
  if (overview?.objects?.length) {
    parts.push('Full database schema:')
    for (const entry of overview.objects) {
      const count = entry.type === 'table' && entry.rowCount != null ? ` (${entry.rowCount} rows)` : ''
      parts.push(`- ${entry.type} ${entry.name}${count}`)
      if (entry.sql) parts.push(entry.sql)
    }
  }
  if (queryText?.trim()) parts.push(`Current query:\n${queryText.trim()}`)
  return parts.join('\n\n')
}

function validateSQLSuggestion(sql) {
  if (!sql) return 'Nib did not return a SQL query.'
  try {
    validateSelectQuery(sql)
    return ''
  } catch (error) {
    return error.message || 'Invalid SQL suggestion.'
  }
}

function SQLiteResultsTable({ columns, rows, emptyLabel, onSelectRow, selectedRowIndex }) {
  if (!columns?.length) {
    return (
      <div className="px-4 py-4 text-[11px] font-mono text-zinc-600">{emptyLabel}</div>
    )
  }

  return (
    <table className="min-w-full border-separate border-spacing-0">
      <thead className="sticky top-0 z-10 bg-zinc-950">
        <tr>
          {columns.map(column => (
            <th
              key={column}
              className="border-b border-zinc-800 px-3 py-2 text-left text-[11px] font-mono text-zinc-400"
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => {
          const interactive = typeof onSelectRow === 'function'
          const selected = selectedRowIndex === rowIndex

          return (
            <tr
              key={row[HIDDEN_ROW_ID] ?? rowIndex}
              className={`${interactive ? 'cursor-pointer' : ''} ${selected ? 'bg-emerald-950/20' : 'odd:bg-zinc-950/20'}`}
              onClick={interactive ? () => onSelectRow(row, rowIndex) : undefined}
            >
              {columns.map(column => (
                <td
                  key={`${rowIndex}:${column}`}
                  className="max-w-[360px] border-b border-zinc-900 px-3 py-2 align-top text-[12px] text-zinc-300"
                >
                  <span className="whitespace-pre-wrap break-words">
                    {row[column] == null ? <span className="font-mono text-zinc-600">NULL</span> : String(row[column])}
                  </span>
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function SQLiteViewer({ assetId, llmEnabled = false, agentToken = '', ollamaModel = '' }) {
  const fileInputRef = useRef(null)
  const nibInputRef = useRef(null)
  const nibResponseRef = useRef('')
  const [asset, setAsset] = useState(null)
  const [overview, setOverview] = useState(null)
  const [activeTab, setActiveTab] = useState('browse')
  const [selectedName, setSelectedName] = useState('')
  const [selectedType, setSelectedType] = useState('table')
  const [tableData, setTableData] = useState(null)
  const [queryText, setQueryText] = useState('')
  const [queryResult, setQueryResult] = useState(null)
  const [page, setPage] = useState(0)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [runningQuery, setRunningQuery] = useState(false)
  const [replacingAsset, setReplacingAsset] = useState(false)
  const [savingRow, setSavingRow] = useState(false)
  const [viewerError, setViewerError] = useState('')
  const [queryError, setQueryError] = useState('')
  const [selectedRowIndex, setSelectedRowIndex] = useState(null)
  const [selectedRow, setSelectedRow] = useState(null)
  const [editDraft, setEditDraft] = useState({})
  const [nibMode, setNibMode] = useState(false)
  const [nibRequest, setNibRequest] = useState('')
  const [nibStreaming, setNibStreaming] = useState(false)
  const [nibSuggestion, setNibSuggestion] = useState('')
  const [nibError, setNibError] = useState('')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!assetId) {
        setViewerError('No SQLite asset is linked to this note.')
        setLoadingOverview(false)
        return
      }

      setLoadingOverview(true)
      setViewerError('')
      setQueryError('')
      setAsset(null)
      setOverview(null)
      setActiveTab('browse')
      setSelectedName('')
      setSelectedType('table')
      setTableData(null)
      setQueryText('')
      setQueryResult(null)
      setNibMode(false)
      setNibRequest('')
      setNibStreaming(false)
      setNibSuggestion('')
      setNibError('')
      setPage(0)
      setSelectedRowIndex(null)
      setSelectedRow(null)
      setEditDraft({})

      try {
        const nextAsset = await getSQLiteAsset(assetId)
        if (!nextAsset) throw new Error('SQLite asset not found in local storage.')
        const nextOverview = await inspectSQLiteDatabase(nextAsset.bytes)
        if (cancelled) return
        setAsset(nextAsset)
        setOverview(nextOverview)
        const firstObject = nextOverview.objects.find(entry => entry.type === 'table') ?? nextOverview.objects[0] ?? null
        setSelectedName(firstObject?.name ?? '')
        setSelectedType(firstObject?.type ?? 'table')
        setQueryText(DEFAULT_QUERY)
      } catch (e) {
        if (cancelled) return
        setViewerError(e.message ?? 'Unable to load SQLite database.')
      } finally {
        if (!cancelled) setLoadingOverview(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [assetId])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (!asset?.bytes || !selectedName || !['table', 'view'].includes(selectedType)) {
        setTableData(null)
        setSelectedRowIndex(null)
        setSelectedRow(null)
        setEditDraft({})
        return
      }

      setLoadingRows(true)
      try {
        const result = await readSQLiteTable(asset.bytes, selectedName, PAGE_SIZE, page * PAGE_SIZE)
        if (cancelled) return
        setTableData(result)
        setSelectedRowIndex(null)
        setSelectedRow(null)
        setEditDraft({})
      } catch (e) {
        if (cancelled) return
        setViewerError(e.message ?? 'Unable to read table rows.')
        setTableData(null)
      } finally {
        if (!cancelled) setLoadingRows(false)
      }
    }

    run()
    return () => { cancelled = true }
  }, [asset, page, selectedName, selectedType])

  const selectedObject = useMemo(() => {
    return overview?.objects.find(entry => entry.name === selectedName && entry.type === selectedType) ?? null
  }, [overview, selectedName, selectedType])

  const pageCount = tableData ? Math.max(1, Math.ceil(tableData.totalRows / PAGE_SIZE)) : 1
  const editableColumns = (tableData?.columnInfo ?? []).filter(column => !column.isPrimaryKey)

  const dismissNibSuggestion = useCallback(() => {
    setNibSuggestion('')
    setNibError('')
  }, [])

  const acceptNibSuggestion = useCallback(() => {
    if (!nibSuggestion) return
    setQueryText(nibSuggestion)
    setNibSuggestion('')
    setNibError('')
  }, [nibSuggestion])

  const toggleNibMode = useCallback(() => {
    setNibSuggestion('')
    setNibError('')
    setNibMode(prev => {
      const next = !prev
      if (next) setTimeout(() => nibInputRef.current?.focus(), 0)
      return next
    })
  }, [])

  const sendToNib = useCallback(() => {
    if (!nibRequest.trim() || nibStreaming) return

    nibResponseRef.current = ''
    setNibStreaming(true)
    setNibMode(false)
    setNibSuggestion('')
    setNibError('')

    streamLLMChat(
      {
        token: agentToken,
        model: ollamaModel,
        messages: [{ role: 'user', content: nibRequest.trim() }],
        context: buildSQLiteNibContext({ overview, queryText }),
        contextMode: 'sqlite',
      },
      (chunk) => { nibResponseRef.current += chunk },
      () => {
        setNibStreaming(false)
        const extracted = extractSQLFromResponse(nibResponseRef.current)
        const validationError = validateSQLSuggestion(extracted)
        if (validationError) {
          setNibError(`Nib returned an invalid query: ${validationError}`)
        } else {
          setNibSuggestion(validateSelectQuery(extracted))
        }
        setNibRequest('')
      },
      (error) => {
        setNibStreaming(false)
        setNibError(error || 'Nib could not build a query.')
        setNibRequest('')
      },
    )
  }, [agentToken, nibRequest, nibStreaming, ollamaModel, overview, queryText])

  function handleNibKeyDown(event) {
    if (event.key === 'Escape') {
      setNibMode(false)
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      sendToNib()
    }
  }

  function handleQueryKeyDown(event) {
    if (!nibSuggestion) return
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      acceptNibSuggestion()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      dismissNibSuggestion()
    }
  }

  async function reloadAsset(nextSelectedName = selectedName, nextSelectedType = selectedType) {
    if (!assetId) return

    setLoadingOverview(true)
    setViewerError('')

    try {
      const nextAsset = await getSQLiteAsset(assetId)
      if (!nextAsset) throw new Error('SQLite asset not found in local storage.')
      const nextOverview = await inspectSQLiteDatabase(nextAsset.bytes)
      setAsset(nextAsset)
      setOverview(nextOverview)

      const matchingObject = nextOverview.objects.find(entry => entry.name === nextSelectedName && entry.type === nextSelectedType)
      const firstTable = nextOverview.objects.find(entry => entry.type === 'table')
      const firstObject = matchingObject ?? firstTable ?? nextOverview.objects[0] ?? null
      setSelectedName(firstObject?.name ?? '')
      setSelectedType(firstObject?.type ?? 'table')
      setPage(0)
      setSelectedRowIndex(null)
      setSelectedRow(null)
      setEditDraft({})
    } catch (e) {
      setViewerError(e.message ?? 'Unable to reload SQLite database.')
    } finally {
      setLoadingOverview(false)
    }
  }

  async function runQuery() {
    if (!asset?.bytes) return

    setRunningQuery(true)
    setQueryError('')

    try {
      const result = await executeSQLiteQuery(asset.bytes, queryText)
      setQueryResult(result)
    } catch (e) {
      setQueryError(e.message ?? 'Unable to run query.')
      setQueryResult(null)
    } finally {
      setRunningQuery(false)
    }
  }

  async function handleReplaceAsset(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !assetId) return

    setReplacingAsset(true)
    setViewerError('')

    try {
      await replaceSQLiteAssetFromFile(assetId, file)
      await reloadAsset()
    } catch (e) {
      setViewerError(e.message ?? 'Unable to replace SQLite asset.')
    } finally {
      setReplacingAsset(false)
    }
  }

  function handleSelectRow(row, rowIndex) {
    setSelectedRowIndex(rowIndex)
    setSelectedRow(row)
    const draft = {}
    for (const column of editableColumns) {
      draft[column.name] = row[column.name] == null ? '' : String(row[column.name])
    }
    setEditDraft(draft)
  }

  async function handleSaveRow() {
    if (!asset?.bytes || !selectedRow || !selectedName || !assetId) return
    const rowId = selectedRow[HIDDEN_ROW_ID]
    if (rowId == null) {
      setViewerError('This row cannot be edited because no stable row identifier is available.')
      return
    }

    setSavingRow(true)
    setViewerError('')

    try {
      const result = await updateSQLiteRow(asset.bytes, selectedName, rowId, editDraft)
      await replaceSQLiteAssetBytes(assetId, result.bytes)
      await reloadAsset(selectedName, selectedType)
    } catch (e) {
      setViewerError(e.message ?? 'Unable to save row changes.')
    } finally {
      setSavingRow(false)
    }
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <aside className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-950/50 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-zinc-800">
          <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest">SQLite</div>
          <div className="mt-1 text-sm text-zinc-200 truncate" title={asset?.fileName ?? ''}>{asset?.fileName ?? 'loading...'}</div>
          {overview && (
            <div className="mt-2 text-[11px] font-mono text-zinc-600">
              {overview.tableCount} table{overview.tableCount !== 1 ? 's' : ''} | {overview.viewCount} view{overview.viewCount !== 1 ? 's' : ''}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => asset && downloadSQLiteAsset(asset)}
              disabled={!asset}
              className="rounded border border-zinc-700 px-2.5 py-1 text-[10px] font-mono text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200 disabled:border-zinc-900 disabled:text-zinc-800"
            >
              Export
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!asset || replacingAsset}
              className="rounded border border-zinc-700 px-2.5 py-1 text-[10px] font-mono text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200 disabled:border-zinc-900 disabled:text-zinc-800"
            >
              {replacingAsset ? 'Replacing...' : 'Replace'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sqlite,.sqlite3,.db"
              className="hidden"
              onChange={handleReplaceAsset}
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-2 py-2">
          {loadingOverview ? (
            <div className="px-2 py-3 text-[11px] font-mono text-zinc-600">loading schema...</div>
          ) : overview?.objects?.length ? (
            overview.objects.map(entry => (
              <button
                key={`${entry.type}:${entry.name}`}
                onClick={() => {
                  setSelectedName(entry.name)
                  setSelectedType(entry.type)
                  setPage(0)
                  setViewerError('')
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  selectedName === entry.name && selectedType === entry.type
                    ? 'bg-blue-950/40 border-blue-800/70'
                    : 'bg-transparent border-transparent hover:bg-zinc-900/70'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono uppercase ${entry.type === 'table' ? 'text-cyan-400' : 'text-amber-400'}`}>
                    {entry.type}
                  </span>
                  <span className="min-w-0 truncate text-sm text-zinc-200">{entry.name}</span>
                </div>
                {entry.type === 'table' && (
                  <div className="mt-1 text-[10px] font-mono text-zinc-600">
                    {entry.rowCount == null ? 'rows: unknown' : `rows: ${entry.rowCount}`}
                  </div>
                )}
              </button>
            ))
          ) : (
            <div className="px-2 py-3 text-[11px] font-mono text-zinc-600">no tables or views</div>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/30">
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => setActiveTab('browse')}
              className={`rounded border px-2.5 py-1 text-[11px] font-mono transition-colors ${
                activeTab === 'browse'
                  ? 'border-cyan-800 bg-cyan-950/40 text-cyan-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              Browse
            </button>
            <button
              onClick={() => setActiveTab('query')}
              className={`rounded border px-2.5 py-1 text-[11px] font-mono transition-colors ${
                activeTab === 'query'
                  ? 'border-fuchsia-800 bg-fuchsia-950/40 text-fuchsia-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              Query
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div>
              <div className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                {activeTab === 'query' ? 'database query' : selectedObject?.type ?? 'object'}
              </div>
              <div className="text-sm text-zinc-200">
                {activeTab === 'query' ? 'Read-only SELECT runner for the full database' : selectedObject?.name ?? 'Select a table'}
              </div>
            </div>
            {activeTab === 'browse' && ['table', 'view'].includes(selectedType) && tableData && (
              <div className="ml-auto text-[11px] font-mono text-zinc-600">
                {tableData.totalRows} row{tableData.totalRows !== 1 ? 's' : ''}
              </div>
            )}
            {activeTab === 'query' && queryResult && (
              <div className="ml-auto text-[11px] font-mono text-zinc-600">
                {queryResult.rowCount} row{queryResult.rowCount !== 1 ? 's' : ''} returned
              </div>
            )}
          </div>

          {activeTab === 'browse' && selectedObject?.sql && (
            <pre className="mt-3 whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-400">
              {selectedObject.sql}
            </pre>
          )}

          {activeTab === 'browse' && viewerError && (
            <div className="mt-3 rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-[11px] font-mono text-red-400">
              {viewerError}
            </div>
          )}

          {activeTab === 'query' && (
            <div className="mt-3 space-y-3">
              <textarea
                value={nibSuggestion || queryText}
                onChange={(e) => {
                  dismissNibSuggestion()
                  setQueryText(e.target.value)
                }}
                onKeyDown={handleQueryKeyDown}
                spellCheck={false}
                readOnly={nibStreaming}
                className={`min-h-[120px] w-full rounded border bg-zinc-950 px-3 py-2 font-mono text-[12px] outline-none transition-colors ${
                  nibSuggestion
                    ? 'border-violet-700 text-violet-200 focus:border-violet-500'
                    : nibStreaming
                      ? 'border-zinc-800 text-zinc-600'
                      : 'border-zinc-800 text-zinc-200 focus:border-fuchsia-700'
                }`}
                placeholder={nibStreaming ? 'Nib is building a query...' : DEFAULT_QUERY}
              />
              {nibMode && (
                <textarea
                  ref={nibInputRef}
                  value={nibRequest}
                  onChange={(e) => setNibRequest(e.target.value)}
                  onKeyDown={handleNibKeyDown}
                  spellCheck={false}
                  className="min-h-[72px] w-full rounded border border-violet-700 bg-violet-950/30 px-3 py-2 font-mono text-[12px] text-violet-200 outline-none transition-colors placeholder-violet-800 focus:border-violet-500"
                  placeholder="Ask Nib for a query based on this database... (Ctrl+Enter to send)"
                />
              )}
              <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                <button
                  onClick={runQuery}
                  disabled={runningQuery || !asset}
                  className="rounded border border-fuchsia-800 bg-fuchsia-950/40 px-3 py-1 text-fuchsia-300 transition-colors hover:border-fuchsia-700 disabled:border-zinc-900 disabled:bg-zinc-950 disabled:text-zinc-700"
                >
                  {runningQuery ? 'Running...' : 'Run query'}
                </button>
                <button
                  onClick={() => {
                    setQueryText(DEFAULT_QUERY)
                    setQueryError('')
                  }}
                  className="rounded border border-zinc-700 px-3 py-1 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200 disabled:border-zinc-900 disabled:text-zinc-800"
                >
                  Show schema
                </button>
                {llmEnabled && (
                  <button
                    onClick={nibStreaming ? undefined : toggleNibMode}
                    disabled={nibStreaming}
                    title={nibStreaming ? 'Nib is building a query...' : nibMode ? 'Back to SQL input' : 'Ask Nib to write a query'}
                    className={`rounded border px-3 py-1 transition-colors ${
                      nibStreaming
                        ? 'border-violet-900 text-violet-600'
                        : nibMode
                          ? 'border-violet-700 bg-violet-950/50 text-violet-300'
                          : 'border-violet-900 bg-violet-950/20 text-violet-500 hover:border-violet-700 hover:text-violet-300'
                    }`}
                  >
                    Nib
                  </button>
                )}
                {nibMode && (
                  <button
                    onClick={sendToNib}
                    disabled={!nibRequest.trim() || nibStreaming}
                    className="rounded border border-violet-800 bg-violet-950/40 px-3 py-1 text-violet-300 transition-colors hover:border-violet-700 disabled:border-zinc-900 disabled:bg-zinc-950 disabled:text-zinc-700"
                  >
                    Send
                  </button>
                )}
                <span className="ml-auto text-zinc-700">SELECT only</span>
              </div>
              {nibSuggestion && (
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="text-violet-400">Nib suggestion</span>
                  <span className="text-zinc-600">-</span>
                  <button onClick={acceptNibSuggestion} className="text-violet-300 transition-colors hover:text-violet-100">Tab / Enter to accept</button>
                  <span className="text-zinc-700">.</span>
                  <button onClick={dismissNibSuggestion} className="text-zinc-600 transition-colors hover:text-zinc-400">Esc to dismiss</button>
                </div>
              )}
              {nibError && !nibSuggestion && (
                <div className="rounded border border-violet-900/40 bg-violet-950/30 px-3 py-2 text-[11px] font-mono text-violet-300">
                  {nibError}
                </div>
              )}
              {queryError && (
                <div className="rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-[11px] font-mono text-red-400">
                  {queryError}
                </div>
              )}
            </div>
          )}
        </div>

        {activeTab === 'query' && (
          <div className="flex-1 min-h-0 overflow-auto">
            {runningQuery ? (
              <div className="px-4 py-4 text-[11px] font-mono text-zinc-600">running query...</div>
            ) : queryResult ? (
              <SQLiteResultsTable
                columns={queryResult.columns}
                rows={queryResult.rows}
                emptyLabel="query returned no rows"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] font-mono text-zinc-600">
                Run a SELECT query to inspect results.
              </div>
            )}
          </div>
        )}

        {activeTab === 'browse' && !selectedName && !loadingOverview && (
          <div className="flex-1 flex items-center justify-center text-[12px] font-mono text-zinc-600">
            Select a table to inspect it.
          </div>
        )}

        {activeTab === 'browse' && ['table', 'view'].includes(selectedType) && selectedName && (
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-auto">
              {loadingRows ? (
                <div className="px-4 py-4 text-[11px] font-mono text-zinc-600">loading rows...</div>
              ) : (
                <SQLiteResultsTable
                  columns={tableData?.columns ?? []}
                  rows={tableData?.rows ?? []}
                  emptyLabel="table has no rows"
                  onSelectRow={selectedType === 'table' && tableData?.editable ? handleSelectRow : null}
                  selectedRowIndex={selectedRowIndex}
                />
              )}
            </div>

            {selectedType === 'table' && tableData?.editable && (
              <aside className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-950/40 p-4 overflow-auto">
                <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Row editor</div>
                {selectedRow ? (
                  <div className="mt-3 space-y-3">
                    {editableColumns.length ? editableColumns.map(column => (
                      <label key={column.name} className="block">
                        <div className="mb-1 text-[11px] font-mono text-zinc-500">
                          {column.name}
                          {column.type ? ` | ${column.type}` : ''}
                        </div>
                        <input
                          value={editDraft[column.name] ?? ''}
                          onChange={(e) => setEditDraft(prev => ({ ...prev, [column.name]: e.target.value }))}
                          className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[12px] text-zinc-200 outline-none transition-colors focus:border-emerald-700"
                        />
                      </label>
                    )) : (
                      <div className="text-[12px] font-mono text-zinc-600">No editable columns available.</div>
                    )}
                    <button
                      onClick={handleSaveRow}
                      disabled={savingRow || !editableColumns.length}
                      className="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-mono text-emerald-300 transition-colors hover:border-emerald-700 disabled:border-zinc-900 disabled:bg-zinc-950 disabled:text-zinc-700"
                    >
                      {savingRow ? 'Saving...' : 'Save row'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 text-[12px] font-mono text-zinc-600">
                    Select a row to edit simple non-primary-key fields.
                  </div>
                )}
              </aside>
            )}

            <div className="absolute bottom-0 left-0 right-0 hidden" />
          </div>
        )}

        {activeTab === 'browse' && ['table', 'view'].includes(selectedType) && selectedName && (
          <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2 text-[11px] font-mono text-zinc-500">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-zinc-700 px-2 py-1 transition-colors hover:border-zinc-500 disabled:border-zinc-900 disabled:text-zinc-800"
            >
              Prev
            </button>
            <span>Page {page + 1} / {pageCount}</span>
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={page + 1 >= pageCount}
              className="rounded border border-zinc-700 px-2 py-1 transition-colors hover:border-zinc-500 disabled:border-zinc-900 disabled:text-zinc-800"
            >
              Next
            </button>
            <span className="ml-auto text-zinc-700">
              {selectedType === 'view' ? 'read-only view' : tableData?.editable ? 'simple row editing' : 'read-only table'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
