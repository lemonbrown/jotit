import { useState, useMemo } from 'react'

// ── JSON path extractor ─────────────────────────────────────────────────────

function parsePathSegments(path) {
  const cleaned = path.trim().replace(/^\$?\.?/, '')
  const segments = []
  let rem = cleaned
  while (rem) {
    const bracket = rem.match(/^\[(\d*)\]\.?/)
    if (bracket) {
      segments.push(bracket[1] === '' ? '[]' : bracket[1])
      rem = rem.slice(bracket[0].length)
      continue
    }
    const dot = rem.match(/^([^.[]+)\.?/)
    if (dot) {
      segments.push(dot[1])
      rem = rem.slice(dot[0].length)
      continue
    }
    break
  }
  return segments
}

function walkPath(data, segments) {
  if (segments.length === 0) return [data]
  const [head, ...rest] = segments
  if (head === '[]') {
    if (!Array.isArray(data)) throw new Error(`Expected array, got ${typeof data}`)
    return data.flatMap(item => walkPath(item, rest))
  }
  if (/^\d+$/.test(head)) {
    if (!Array.isArray(data)) throw new Error(`Expected array for index [${head}]`)
    const item = data[parseInt(head)]
    if (item === undefined) throw new Error(`Index [${head}] out of bounds (length ${data.length})`)
    return walkPath(item, rest)
  }
  if (typeof data !== 'object' || data === null) throw new Error(`Cannot access .${head} on ${typeof data}`)
  if (!(head in data)) throw new Error(`.${head} not found`)
  return walkPath(data[head], rest)
}

function JsonPanel({ initialText }) {
  const [json, setJson] = useState(initialText || '')
  const [path, setPath] = useState('')
  const [copied, setCopied] = useState(false)

  const result = useMemo(() => {
    if (!json.trim()) return null
    let parsed
    try { parsed = JSON.parse(json) } catch (e) { return { error: `JSON parse error: ${e.message}` } }
    if (!path.trim()) return { preview: parsed }
    try {
      const segments = parsePathSegments(path)
      const values = walkPath(parsed, segments)
      const out = values.length === 1 ? values[0] : values
      return { values: out }
    } catch (e) {
      return { error: e.message }
    }
  }, [json, path])

  const outputText = result?.values !== undefined
    ? (typeof result.values === 'string' ? result.values : JSON.stringify(result.values, null, 2))
    : result?.preview !== undefined
      ? JSON.stringify(result.preview, null, 2)
      : ''

  const copy = async () => {
    await navigator.clipboard.writeText(outputText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Path row */}
      <div className="px-4 py-2.5 border-b border-zinc-800 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-600 font-mono shrink-0">path</span>
          <input
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder=".data.items[].title"
            spellCheck={false}
            className={`flex-1 bg-zinc-800 border rounded px-2.5 py-1.5 text-sm font-mono text-zinc-200 outline-none transition-colors ${
              result?.error ? 'border-red-800 focus:border-red-600' : 'border-zinc-700 focus:border-zinc-500'
            }`}
          />
          {outputText && (
            <button
              onClick={copy}
              className="px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded bg-zinc-900 transition-colors shrink-0"
            >
              {copied ? '✓ copied' : 'copy'}
            </button>
          )}
        </div>
        {result?.error && (
          <div className="text-[11px] text-red-400 font-mono bg-red-950/30 border border-red-900/40 rounded px-2.5 py-1">
            {result.error}
          </div>
        )}
        <p className="text-[10px] text-zinc-700 font-mono">
          examples: <span className="text-zinc-600">.data.items[].name &nbsp; [0].id &nbsp; .results</span>
        </p>
      </div>

      {/* Split: JSON input | output */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <textarea
          value={json}
          onChange={e => setJson(e.target.value)}
          placeholder="Paste JSON here…"
          spellCheck={false}
          className="note-content text-sm text-zinc-400 bg-transparent p-4 resize-none outline-none placeholder-zinc-800 overflow-y-auto border-b border-zinc-800"
          style={{ flex: '0 0 45%' }}
        />
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {outputText ? (
            <>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">
                {result?.values !== undefined ? 'Extracted' : 'Preview'}
              </div>
              <pre className="note-content text-[13px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
                {outputText}
              </pre>
            </>
          ) : (
            <div className="text-[12px] text-zinc-700 font-mono">
              {json.trim() ? 'enter a path above ↑' : 'paste JSON above ↑'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── GUID / UUID tools ───────────────────────────────────────────────────────

function uuid4() {
  return crypto.randomUUID()
}

function GuidPanel() {
  const [guids, setGuids] = useState(() => [uuid4()])
  const [count, setCount] = useState(1)
  const [upper, setUpper] = useState(false)
  const [braces, setBraces] = useState(false)
  const [noDashes, setNoDashes] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState(null)
  const [allCopied, setAllCopied] = useState(false)
  const [validateInput, setValidateInput] = useState('')

  const format = (g) => {
    let s = g
    if (noDashes) s = s.replace(/-/g, '')
    if (braces) s = `{${s}}`
    if (upper) s = s.toUpperCase()
    return s
  }

  const generate = () => {
    const n = Math.max(1, Math.min(100, count))
    setGuids(Array.from({ length: n }, uuid4))
  }

  const copyOne = async (idx) => {
    await navigator.clipboard.writeText(format(guids[idx]))
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  const copyAll = async () => {
    await navigator.clipboard.writeText(guids.map(format).join('\n'))
    setAllCopied(true)
    setTimeout(() => setAllCopied(false), 1500)
  }

  const validation = useMemo(() => {
    const t = validateInput.trim()
    if (!t) return null
    const bare = t.replace(/[{}()\-\s]/g, '')
    const valid = /^[0-9a-fA-F]{32}$/.test(bare)
    if (!valid) return { ok: false, msg: 'Not a valid GUID/UUID' }
    const ver = parseInt(bare[12], 16)
    const varNib = parseInt(bare[16], 16)
    const variant = varNib >= 0xe ? 'Reserved' : varNib >= 0xc ? 'Microsoft' : varNib >= 0x8 ? 'RFC 4122' : 'NCS'
    const fmt = `${bare.slice(0,8)}-${bare.slice(8,12)}-${bare.slice(12,16)}-${bare.slice(16,20)}-${bare.slice(20)}`
    return { ok: true, version: ver, variant, formatted: fmt, bare }
  }, [validateInput])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 gap-5">
      {/* Generate section */}
      <div className="space-y-3">
        <div className="text-[11px] text-zinc-500 uppercase tracking-widest font-mono">Generate</div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-600 font-mono">count</span>
            <input
              type="number"
              value={count}
              min={1}
              max={100}
              onChange={e => setCount(parseInt(e.target.value) || 1)}
              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm font-mono text-zinc-200 outline-none focus:border-zinc-500"
            />
          </div>
          {[
            { label: 'UPPER', state: upper, set: setUpper },
            { label: '{braces}', state: braces, set: setBraces },
            { label: 'no-dashes', state: noDashes, set: setNoDashes },
          ].map(({ label, state, set }) => (
            <button
              key={label}
              onClick={() => set(v => !v)}
              className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
                state
                  ? 'bg-blue-900/70 text-blue-300 border-blue-700'
                  : 'text-zinc-500 border-zinc-700 hover:text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={generate}
            className="px-3 py-1 text-[11px] font-mono bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
          >
            Generate
          </button>
          {guids.length > 1 && (
            <button
              onClick={copyAll}
              className="px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded bg-zinc-900 transition-colors"
            >
              {allCopied ? '✓ all copied' : 'copy all'}
            </button>
          )}
        </div>

        {/* Generated GUIDs */}
        <div className="space-y-1">
          {guids.map((g, i) => (
            <div key={i} className="flex items-center gap-2 group">
              <code className="flex-1 text-[13px] font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 select-all">
                {format(g)}
              </code>
              <button
                onClick={() => copyOne(i)}
                className="opacity-0 group-hover:opacity-100 px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded transition-all"
              >
                {copiedIdx === i ? '✓' : 'copy'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Validate section */}
      <div className="space-y-2">
        <div className="text-[11px] text-zinc-500 uppercase tracking-widest font-mono">Validate / Inspect</div>
        <input
          value={validateInput}
          onChange={e => setValidateInput(e.target.value)}
          placeholder="Paste a GUID to validate…"
          spellCheck={false}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm font-mono text-zinc-200 outline-none focus:border-zinc-500 placeholder-zinc-700"
        />
        {validation && (
          <div className={`rounded border px-3 py-2.5 space-y-1 text-[12px] font-mono ${
            validation.ok
              ? 'bg-green-950/30 border-green-900/40'
              : 'bg-red-950/30 border-red-900/40'
          }`}>
            {validation.ok ? (
              <>
                <div className="text-green-400">VALID ✓</div>
                <div className="text-zinc-400">Formatted: <span className="text-zinc-200">{validation.formatted}</span></div>
                <div className="text-zinc-400">Bare hex:  <span className="text-zinc-200">{validation.bare}</span></div>
                <div className="text-zinc-400">Version {validation.version} · {validation.variant}</div>
              </>
            ) : (
              <div className="text-red-400">{validation.msg}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main DevTools panel ─────────────────────────────────────────────────────

export default function DevTools({ noteContent, initialText }) {
  const [tab, setTab] = useState('guid')

  const isJson = (() => {
    const t = (initialText || noteContent || '').trim()
    return t.startsWith('{') || t.startsWith('[')
  })()

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-800 shrink-0 px-3 gap-1 pt-1.5">
        {[
          { id: 'guid', label: 'GUID / UUID' },
          { id: 'json', label: 'JSON Path' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-[11px] font-mono rounded-t border-b-2 transition-colors ${
              tab === t.id
                ? 'text-zinc-200 border-indigo-500 bg-zinc-800/50'
                : 'text-zinc-600 border-transparent hover:text-zinc-400'
            }`}
          >
            {t.label}
          </button>
        ))}
        {tab === 'json' && isJson && (
          <span className="ml-auto self-center text-[10px] text-zinc-600 font-mono pb-1.5">
            pre-filled from note
          </span>
        )}
      </div>

      {tab === 'guid' && <GuidPanel />}
      {tab === 'json' && (
        <JsonPanel
          key={isJson ? 'note' : 'empty'}
          initialText={isJson ? (initialText || noteContent || '') : ''}
        />
      )}
    </div>
  )
}
