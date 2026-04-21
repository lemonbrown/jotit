import { useState, useCallback, useRef } from 'react'
import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import { parseRequests } from '../utils/httpParser'

hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function statusColor(code) {
  if (!code) return 'text-zinc-500'
  if (code < 300) return 'text-emerald-400'
  if (code < 400) return 'text-amber-400'
  if (code < 500) return 'text-orange-400'
  return 'text-red-400'
}

function statusBg(code) {
  if (!code) return 'bg-zinc-800 border-zinc-700'
  if (code < 300) return 'bg-emerald-950/50 border-emerald-800'
  if (code < 400) return 'bg-amber-950/50 border-amber-800'
  if (code < 500) return 'bg-orange-950/50 border-orange-800'
  return 'bg-red-950/50 border-red-800'
}

function highlightBody(text, contentType) {
  try {
    if (contentType?.includes('json')) {
      const pretty = JSON.stringify(JSON.parse(text), null, 2)
      return { text: pretty, html: hljs.highlight(pretty, { language: 'json' }).value }
    }
    if (contentType?.includes('xml') || contentType?.includes('html')) {
      return { text, html: hljs.highlight(text, { language: 'xml' }).value }
    }
  } catch { /* fall through */ }
  return { text, html: hljs.escapeHTML(text) }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeadersTable({ headers }) {
  const entries = Object.entries(headers)
  if (!entries.length) return <span className="text-zinc-600 text-xs font-mono">no headers</span>
  return (
    <table className="w-full text-[12px] font-mono border-collapse">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-b border-zinc-800 last:border-0">
            <td className="py-1 pr-4 text-zinc-500 whitespace-nowrap align-top">{k}</td>
            <td className="py-1 text-zinc-300 break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MethodBadge({ method }) {
  const colors = {
    GET: 'text-emerald-400 bg-emerald-950/50 border-emerald-800',
    POST: 'text-blue-400 bg-blue-950/50 border-blue-800',
    PUT: 'text-amber-400 bg-amber-950/50 border-amber-800',
    PATCH: 'text-purple-400 bg-purple-950/50 border-purple-800',
    DELETE: 'text-red-400 bg-red-950/50 border-red-800',
    HEAD: 'text-cyan-400 bg-cyan-950/50 border-cyan-800',
    OPTIONS: 'text-zinc-400 bg-zinc-800 border-zinc-700',
  }
  const cls = colors[method] ?? 'text-zinc-400 bg-zinc-800 border-zinc-700'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono font-bold rounded border ${cls}`}>
      {method}
    </span>
  )
}

// ── RequestPane — shows one parsed request ────────────────────────────────────

function RequestPane({ req, idx, total }) {
  const [activeTab, setActiveTab] = useState('response')
  const [response, setResponse] = useState(null) // { status, statusText, headers, body, contentType, elapsed, size }
  const [loading, setLoading] = useState(false)
  const [netError, setNetError] = useState(null)
  const [respTab, setRespTab] = useState('body')
  const [copied, setCopied] = useState(false)
  const abortRef = useRef(null)

  const send = useCallback(async () => {
    if (req.error) return
    setLoading(true)
    setNetError(null)
    setResponse(null)
    setRespTab('body')
    abortRef.current = new AbortController()
    const t0 = performance.now()
    try {
      const fetchOpts = {
        method: req.method,
        headers: req.headers,
        signal: abortRef.current.signal,
      }
      if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
        fetchOpts.body = req.body
      }
      const res = await fetch(req.url, fetchOpts)
      const elapsed = Math.round(performance.now() - t0)
      const contentType = res.headers.get('content-type') ?? ''
      const bodyText = await res.text()
      const size = new Blob([bodyText]).size
      const respHeaders = {}
      res.headers.forEach((v, k) => { respHeaders[k] = v })
      setResponse({ status: res.status, statusText: res.statusText, headers: respHeaders, body: bodyText, contentType, elapsed, size })
    } catch (e) {
      if (e.name === 'AbortError') return
      const elapsed = Math.round(performance.now() - t0)
      let msg = e.message ?? String(e)
      if (msg === 'Failed to fetch') {
        msg = 'Request failed — likely a CORS restriction or network error. The target server must allow requests from this origin.'
      }
      setNetError({ msg, elapsed })
    } finally {
      setLoading(false)
    }
  }, [req])

  const cancel = () => { abortRef.current?.abort(); setLoading(false) }

  const copyBody = async () => {
    if (!response?.body) return
    await navigator.clipboard.writeText(response.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const { text: prettyBody, html: highlightedBody } = response
    ? highlightBody(response.body, response.contentType)
    : { text: '', html: '' }

  const tabs = ['request', 'response']

  return (
    <div className="flex flex-col h-full">
      {/* Request selector breadcrumb */}
      {total > 1 && (
        <div className="px-3 py-1 bg-zinc-900/60 border-b border-zinc-800 text-[11px] text-zinc-500 font-mono shrink-0">
          Request {idx + 1} of {total}
          {!req.error && (
            <span className="ml-2 text-zinc-600">— {req.method} {req.url.length > 60 ? req.url.slice(0, 60) + '…' : req.url}</span>
          )}
        </div>
      )}

      {/* Parse error banner */}
      {req.error && (
        <div className="mx-3 mt-3 px-3 py-2 bg-red-950/50 border border-red-800 rounded-lg text-[12px] text-red-300 font-mono shrink-0">
          ✗ {req.error}
        </div>
      )}

      {/* Parsed summary + send */}
      {!req.error && (
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0 flex items-center gap-2 flex-wrap">
          <MethodBadge method={req.method} />
          <span className="text-[12px] text-zinc-300 font-mono flex-1 min-w-0 truncate" title={req.url}>
            {req.url}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {loading ? (
              <button
                onClick={cancel}
                className="px-3 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-400 rounded bg-zinc-900 transition-colors"
              >
                ✕ cancel
              </button>
            ) : (
              <button
                onClick={send}
                className="px-3 py-1 text-[11px] font-mono text-amber-300 hover:text-amber-100 border border-amber-800 hover:border-amber-500 rounded bg-amber-950/40 hover:bg-amber-950/70 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
                Send
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      {!req.error && (
        <div className="flex items-center gap-0 px-3 pt-2 border-b border-zinc-800 shrink-0">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1 text-[11px] font-mono rounded-t transition-colors capitalize ${
                activeTab === t
                  ? 'text-amber-300 border-b-2 border-amber-500 -mb-px bg-zinc-900'
                  : 'text-zinc-600 hover:text-zinc-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Tab: request details */}
      {!req.error && activeTab === 'request' && (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          <div>
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Headers Sent</div>
            <HeadersTable headers={req.headers} />
          </div>
          {req.body && (
            <div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Body</div>
              <pre className="text-[12px] font-mono text-zinc-300 bg-zinc-900 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-all">
                {req.body}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Tab: response */}
      {!req.error && activeTab === 'response' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Loading */}
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-500">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" />
              </svg>
              <span className="text-[12px] font-mono">Sending…</span>
            </div>
          )}

          {/* Network error */}
          {!loading && netError && (
            <div className="m-3 p-3 bg-red-950/50 border border-red-800 rounded-lg text-[12px] text-red-300 font-mono space-y-1">
              <div className="font-semibold text-red-400">✗ Network error ({netError.elapsed}ms)</div>
              <div className="text-red-400/80">{netError.msg}</div>
            </div>
          )}

          {/* Idle */}
          {!loading && !netError && !response && (
            <div className="flex-1 flex items-center justify-center text-zinc-700 text-[12px] font-mono">
              Press Send to execute the request
            </div>
          )}

          {/* Response */}
          {!loading && response && (
            <>
              {/* Status bar */}
              <div className={`mx-3 mt-3 px-3 py-2 rounded-lg border flex items-center gap-3 text-[12px] font-mono shrink-0 ${statusBg(response.status)}`}>
                <span className={`font-bold text-sm ${statusColor(response.status)}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-zinc-500">•</span>
                <span className="text-zinc-400">{response.elapsed}ms</span>
                <span className="text-zinc-500">•</span>
                <span className="text-zinc-400">{formatBytes(response.size)}</span>
                {response.contentType && (
                  <>
                    <span className="text-zinc-500">•</span>
                    <span className="text-zinc-500">{response.contentType.split(';')[0]}</span>
                  </>
                )}
              </div>

              {/* Response sub-tabs */}
              <div className="flex items-center gap-0 px-3 pt-2 shrink-0">
                {['body', 'headers'].map(t => (
                  <button
                    key={t}
                    onClick={() => setRespTab(t)}
                    className={`px-3 py-0.5 text-[11px] font-mono rounded-t transition-colors capitalize ${
                      respTab === t ? 'text-zinc-200 border-b border-zinc-500 -mb-px' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
                <button
                  onClick={copyBody}
                  className="ml-auto text-[11px] font-mono text-zinc-600 hover:text-zinc-300 px-2 py-0.5 transition-colors"
                >
                  {copied ? '✓ copied' : '📋 copy body'}
                </button>
              </div>

              {/* Body */}
              {respTab === 'body' && (
                <div className="flex-1 overflow-auto p-3">
                  {response.body ? (
                    <pre
                      className="hljs rounded-lg p-3 text-[12px] leading-relaxed overflow-x-auto"
                      style={{ background: '#0d1117', margin: 0 }}
                    >
                      <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedBody }} />
                    </pre>
                  ) : (
                    <span className="text-zinc-600 text-[12px] font-mono">empty body</span>
                  )}
                </div>
              )}

              {/* Response Headers */}
              {respTab === 'headers' && (
                <div className="flex-1 overflow-auto p-3">
                  <HeadersTable headers={response.headers} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function HttpRunner({ noteContent, initialText }) {
  // If the user highlighted text before clicking HTTP, use that; they can dismiss
  const hasSelection = initialText && initialText.trim().length > 0
  const [useSelection, setUseSelection] = useState(hasSelection)

  const activeContent = useSelection && hasSelection ? initialText : noteContent
  const requests = parseRequests(activeContent)
  const [activeIdx, setActiveIdx] = useState(0)

  if (!requests.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-[13px] font-mono">
        No HTTP request detected in this note
      </div>
    )
  }

  const active = requests[activeIdx] ?? requests[0]

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Selection scope banner */}
      {hasSelection && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-900/50 bg-amber-950/20 shrink-0">
          <span className="text-[10px] font-mono text-amber-500 flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            {useSelection ? 'Using selection' : 'Using full note'}
          </span>
          <span className="text-[10px] text-amber-700 font-mono">
            {useSelection ? `${initialText.trim().length} chars` : `${noteContent.trim().length} chars`}
          </span>
          <button
            onClick={() => { setUseSelection(v => !v); setActiveIdx(0) }}
            className="ml-auto text-[10px] font-mono text-amber-600 hover:text-amber-300 transition-colors px-1.5 py-0.5 border border-amber-900/60 hover:border-amber-700 rounded"
          >
            {useSelection ? '→ use full note' : '→ use selection'}
          </button>
        </div>
      )}

      {/* Multi-request navigator */}
      {requests.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60 shrink-0 overflow-x-auto">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 mr-1">{requests.length} requests</span>
          {requests.map((r, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
                i === activeIdx
                  ? 'text-amber-300 bg-amber-950/40 border-amber-800'
                  : r.error
                    ? 'text-red-400 bg-red-950/20 border-red-900 hover:border-red-700'
                    : 'text-zinc-400 bg-zinc-900 border-zinc-700 hover:border-zinc-500 hover:text-zinc-100'
              }`}
            >
              {r.error ? '✗' : <span className="text-[10px] font-bold mr-1" style={{
                color: { GET:'#34d399',POST:'#60a5fa',PUT:'#fbbf24',PATCH:'#a78bfa',DELETE:'#f87171' }[r.method] ?? '#9ca3af'
              }}>{r.method}</span>}
              {!r.error && (r.url.replace(/^https?:\/\//, '').slice(0, 30))}
              {r.error && 'parse error'}
            </button>
          ))}
        </div>
      )}

      {/* Active request pane */}
      <RequestPane req={active} idx={activeIdx} total={requests.length} />
    </div>
  )
}
