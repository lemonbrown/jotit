import { useEffect, useMemo, useState } from 'react'

function isObjectLike(value) {
  return value !== null && typeof value === 'object'
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function formatPath(path) {
  if (!path.length) return '$'
  return path.reduce((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`
    return acc ? `${acc}.${segment}` : segment
  }, '')
}

function valueLabel(value) {
  if (Array.isArray(value)) return `Array(${value.length})`
  if (value === null) return 'null'
  return typeof value
}

function primitiveLiteral(value) {
  return JSON.stringify(value)
}

function matchText(query, ...parts) {
  if (!query) return true
  const normalized = query.toLowerCase()
  return parts.some(part => String(part ?? '').toLowerCase().includes(normalized))
}

function branchMatches(value, path, nodeKey, query) {
  const pathText = formatPath(path)
  if (!query) return true

  if (!isObjectLike(value)) {
    return matchText(query, nodeKey, pathText, primitiveLiteral(value))
  }

  if (matchText(query, nodeKey, pathText, valueLabel(value))) return true

  if (Array.isArray(value)) {
    return value.some((item, index) => branchMatches(item, [...path, index], index, query))
  }

  return Object.entries(value).some(([key, child]) => branchMatches(child, [...path, key], key, query))
}

function collectCollapsiblePaths(value, path = [], paths = new Set()) {
  if (!isObjectLike(value)) return paths
  paths.add(formatPath(path))
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCollapsiblePaths(item, [...path, index], paths))
    return paths
  }
  Object.entries(value).forEach(([key, child]) => collectCollapsiblePaths(child, [...path, key], paths))
  return paths
}

function getContainerAtPath(root, path) {
  let current = root
  for (let i = 0; i < path.length; i += 1) current = current[path[i]]
  return current
}

function updateValueAtPath(root, path, nextValue) {
  if (!path.length) return nextValue
  const nextRoot = cloneJson(root)
  const parent = getContainerAtPath(nextRoot, path.slice(0, -1))
  parent[path[path.length - 1]] = nextValue
  return nextRoot
}

function renameObjectKey(root, path, nextKey) {
  if (!path.length || typeof path[path.length - 1] !== 'string') return { value: root, error: 'Root key cannot be renamed' }
  const trimmed = nextKey.trim()
  if (!trimmed) return { value: root, error: 'Key cannot be empty' }

  const nextRoot = cloneJson(root)
  const parentPath = path.slice(0, -1)
  const oldKey = path[path.length - 1]
  const parent = getContainerAtPath(nextRoot, parentPath)

  if (trimmed !== oldKey && Object.prototype.hasOwnProperty.call(parent, trimmed)) {
    return { value: root, error: 'Key already exists' }
  }

  const replacement = {}
  Object.entries(parent).forEach(([key, value]) => {
    replacement[key === oldKey ? trimmed : key] = value
  })

  if (parentPath.length === 0) return { value: replacement, error: null }

  const container = getContainerAtPath(nextRoot, parentPath.slice(0, -1))
  container[parentPath[parentPath.length - 1]] = replacement
  return { value: nextRoot, error: null }
}

function highlightText(text, query) {
  if (!query || !text) return text
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  const index = lower.indexOf(needle)
  if (index === -1) return text
  const before = text.slice(0, index)
  const match = text.slice(index, index + query.length)
  const after = text.slice(index + query.length)
  return (
    <>
      {before}
      <mark className="json-inline-match">{match}</mark>
      {after}
    </>
  )
}

function JsonKeyInput({ value, query, onCommit }) {
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  return (
    <input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
      className="json-key-input"
      aria-label="JSON key"
    />
  )
}

function JsonLiteralInput({ value, onCommit }) {
  const [draft, setDraft] = useState(primitiveLiteral(value))

  useEffect(() => setDraft(primitiveLiteral(value)), [value])

  return (
    <input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== primitiveLiteral(value)) onCommit(draft)
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          setDraft(primitiveLiteral(value))
          e.currentTarget.blur()
        }
      }}
      className={`json-literal-input json-${value === null ? 'null' : typeof value}`}
      aria-label="JSON value"
    />
  )
}

function JsonNode({
  value,
  path,
  nodeKey,
  depth,
  collapsed,
  onToggle,
  onCopyPath,
  onRenameKey,
  onUpdateValue,
  query,
  forceExpanded,
}) {
  const pathText = formatPath(path)
  const containerMatch = branchMatches(value, path, nodeKey, query)

  if (!containerMatch) return null

  const isCollapsed = collapsed.has(pathText) && !forceExpanded
  const composite = isObjectLike(value)
  const isRoot = nodeKey === null
  const keyLabel = isRoot ? '$' : String(nodeKey)

  if (!composite) {
    return (
      <div className="json-row" style={{ paddingLeft: `${depth * 14}px` }}>
        <span className="json-spacer" />
        <button className="json-path-button" onClick={() => onCopyPath(pathText)} title={`Copy path ${pathText}`}>
          path
        </button>
        {typeof nodeKey === 'string' ? (
          <JsonKeyInput value={keyLabel} query={query} onCommit={nextKey => onRenameKey(path, nextKey)} />
        ) : (
          <span className="json-key">{highlightText(keyLabel, query)}</span>
        )}
        <span className="json-punc">: </span>
        <JsonLiteralInput value={value} onCommit={nextLiteral => onUpdateValue(path, nextLiteral)} />
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [index, item])
    : Object.entries(value)
  const openChar = Array.isArray(value) ? '[' : '{'
  const closeChar = Array.isArray(value) ? ']' : '}'

  return (
    <div>
      <div className="json-row" style={{ paddingLeft: `${depth * 14}px` }}>
        <button className="json-toggle" onClick={() => onToggle(pathText)} title={isCollapsed ? 'Expand' : 'Collapse'}>
          {isCollapsed ? '+' : '-'}
        </button>
        <button className="json-path-button" onClick={() => onCopyPath(pathText)} title={`Copy path ${pathText}`}>
          path
        </button>
        {typeof nodeKey === 'string' ? (
          <JsonKeyInput value={keyLabel} query={query} onCommit={nextKey => onRenameKey(path, nextKey)} />
        ) : (
          <span className="json-key">{highlightText(keyLabel, query)}</span>
        )}
        <span className="json-punc">: </span>
        <span className="json-punc">{openChar}</span>
        <span className="json-meta">
          {' '}
          {highlightText(valueLabel(value), query)}
        </span>
        {isCollapsed ? <span className="json-punc"> {closeChar}</span> : null}
      </div>
      {!isCollapsed && (
        <>
          {entries.map(([childKey, childValue]) => (
            <JsonNode
              key={`${pathText}:${String(childKey)}`}
              value={childValue}
              path={[...path, childKey]}
              nodeKey={childKey}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onCopyPath={onCopyPath}
              onRenameKey={onRenameKey}
              onUpdateValue={onUpdateValue}
              query={query}
              forceExpanded={forceExpanded}
            />
          ))}
          <div className="json-row" style={{ paddingLeft: `${depth * 14}px` }}>
            <span className="json-spacer" />
            <span className="json-spacer json-spacer-ghost" />
            <span className="json-punc">{closeChar}</span>
          </div>
        </>
      )}
    </div>
  )
}

export default function JsonBlockViewer({ rawJson, onChangeJson = null, onClose = null, scopeLabel = 'JSON' }) {
  const initialParsed = useMemo(() => {
    try {
      return JSON.parse(rawJson)
    } catch {
      return null
    }
  }, [rawJson])
  const [parsed, setParsed] = useState(initialParsed)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [copiedPath, setCopiedPath] = useState('')
  const [viewMode, setViewMode] = useState('tree')
  const [status, setStatus] = useState('')
  const [rawDraft, setRawDraft] = useState(rawJson)

  useEffect(() => {
    setParsed(initialParsed)
    setRawDraft(initialParsed === null ? rawJson : JSON.stringify(initialParsed, null, 2))
  }, [initialParsed, rawJson])

  const pretty = useMemo(() => {
    if (parsed === null) return rawJson
    return JSON.stringify(parsed, null, 2)
  }, [parsed, rawJson])
  const collapsiblePaths = useMemo(() => parsed === null ? new Set() : collectCollapsiblePaths(parsed), [parsed])
  const searchResults = useMemo(() => {
    if (!parsed || !search) return null
    return branchMatches(parsed, [], null, search)
  }, [parsed, search])

  const pushParsed = (nextParsed, nextStatus = '') => {
    const nextText = JSON.stringify(nextParsed, null, 2)
    setParsed(nextParsed)
    setRawDraft(nextText)
    setStatus(nextStatus)
    onChangeJson?.(nextText)
  }

  const copyText = async (text, copiedValue) => {
    await navigator.clipboard.writeText(text)
    setCopiedPath(copiedValue)
    window.setTimeout(() => setCopiedPath(current => (current === copiedValue ? '' : current)), 1200)
  }

  const togglePath = (pathText) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(pathText)) next.delete(pathText)
      else next.add(pathText)
      return next
    })
  }

  const handleLiteralUpdate = (path, draft) => {
    try {
      const nextValue = JSON.parse(draft)
      pushParsed(updateValueAtPath(parsed, path, nextValue), 'Value updated')
    } catch {
      setStatus('Value must be valid JSON literal')
    }
  }

  const handleKeyRename = (path, nextKey) => {
    const result = renameObjectKey(parsed, path, nextKey)
    if (result.error) {
      setStatus(result.error)
      return
    }
    pushParsed(result.value, 'Key renamed')
  }

  const applyFormat = () => {
    if (parsed === null) return
    const formatted = JSON.stringify(parsed, null, 2)
    setRawDraft(formatted)
    setStatus('JSON formatted')
    onChangeJson?.(formatted)
  }

  const applyRawDraft = () => {
    try {
      const nextParsed = JSON.parse(rawDraft)
      pushParsed(nextParsed, 'Raw JSON applied')
    } catch (error) {
      setStatus(`Raw JSON error: ${error.message}`)
    }
  }

  if (parsed === null) {
    return (
      <div className="json-block-viewer">
        <div className="json-toolbar">
          <span className="json-badge">JSON</span>
          <span className="json-scope-label">{scopeLabel}</span>
          {onClose && (
            <button className="json-toolbar-button" onClick={onClose}>
              Back to text
            </button>
          )}
        </div>
        <pre className="json-block-fallback">
          <code>{rawJson}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className="json-block-viewer json-inline-editor">
      <div className="json-toolbar">
        <span className="json-badge">JSON</span>
        <span className="json-scope-label">{scopeLabel}</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search keys, values, paths"
          className="json-search"
        />
        <button className="json-toolbar-button" onClick={() => setCollapsed(new Set())}>
          Expand all
        </button>
        <button className="json-toolbar-button" onClick={() => setCollapsed(new Set(collapsiblePaths))}>
          Collapse all
        </button>
        <button className="json-toolbar-button" onClick={() => copyText(pretty, 'pretty')}>
          {copiedPath === 'pretty' ? 'Copied pretty' : 'Copy pretty'}
        </button>
        <button className="json-toolbar-button" onClick={applyFormat}>
          Format JSON
        </button>
        <button className="json-toolbar-button" onClick={() => setViewMode(mode => mode === 'tree' ? 'raw' : 'tree')}>
          {viewMode === 'tree' ? 'Raw edit' : 'Tree edit'}
        </button>
        {onClose && (
          <button className="json-toolbar-button" onClick={onClose}>
            Back to text
          </button>
        )}
      </div>
      {status && <div className="json-status">{status}</div>}
      {search && !searchResults && viewMode === 'tree' && (
        <div className="json-empty-state">No matches for "{search}".</div>
      )}
      {viewMode === 'raw' ? (
        <div className="json-raw-panel">
          <textarea
            value={rawDraft}
            onChange={e => setRawDraft(e.target.value)}
            spellCheck={false}
            className="json-raw-textarea"
          />
          <div className="json-raw-actions">
            <button className="json-toolbar-button" onClick={applyRawDraft}>
              Apply raw
            </button>
            <button className="json-toolbar-button" onClick={() => setRawDraft(pretty)}>
              Reset raw
            </button>
          </div>
        </div>
      ) : (
        <div className="json-tree">
          <JsonNode
            value={parsed}
            path={[]}
            nodeKey={null}
            depth={0}
            collapsed={collapsed}
            onToggle={togglePath}
            onCopyPath={(pathText) => copyText(pathText, pathText)}
            onRenameKey={handleKeyRename}
            onUpdateValue={handleLiteralUpdate}
            query={search}
            forceExpanded={Boolean(search)}
          />
        </div>
      )}
    </div>
  )
}
