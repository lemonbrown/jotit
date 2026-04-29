import { useCallback, useRef, useState } from 'react'
import { escapeHtml } from '../utils/escapeHtml'
import { hljs } from '../utils/highlight'
import { loadSettings } from '../utils/storage'

export const LOCAL_AGENT_ORIGIN = 'http://127.0.0.1:3210'

export function isAgentEnabled(settings) {
  return Boolean(settings.serverProxy)
}

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
  } catch {}
  return { text, html: escapeHtml(text) }
}

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
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono font-bold rounded border ${cls}`}>{method}</span>
}

export default function HttpRequestPane({ req, idx, total, agentStatus, onResponseChange = null }) {
  const [activeTab, setActiveTab] = useState('response')
  const [response, setResponse] = useState(null)
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
    const settings = loadSettings()

    try {
      let status
      let statusText
      let respHeaders
      let bodyText = ''
      let contentType = ''
      let elapsed
      let size = 0
      let isBinary = false
      let downloadBlob = null
      let via = 'browser'

      if (isAgentEnabled(settings)) {
        via = 'local-agent'
        if (!agentStatus.available) {
          throw new Error('Local agent not detected on 127.0.0.1:3210. Start jotit-agent or disable local agent mode.')
        }
        if (!settings.localAgentToken?.trim()) {
          throw new Error('Local agent token is missing. Paste the token into Settings.')
        }

        const agentRes = await fetch(`${LOCAL_AGENT_ORIGIN}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.localAgentToken.trim()}`,
          },
          body: JSON.stringify({ url: req.url, method: req.method, headers: req.headers, body: req.body }),
          signal: abortRef.current.signal,
        })

        const data = await agentRes.json()
        if (!agentRes.ok && data.error) throw new Error(data.error)
        elapsed = data.elapsed ?? Math.round(performance.now() - t0)
        status = data.status
        statusText = data.statusText
        respHeaders = data.headers ?? {}
        contentType = data.contentType ?? respHeaders['content-type'] ?? ''
        size = data.size ?? 0
        isBinary = Boolean(data.isBinary)

        if (isBinary) {
          const bytes = Uint8Array.from(atob(data.bodyBase64 ?? ''), c => c.charCodeAt(0))
          downloadBlob = new Blob([bytes], { type: contentType || 'application/octet-stream' })
        } else {
          bodyText = data.body ?? ''
          size = size || new Blob([bodyText]).size
        }
      } else {
        const fetchOpts = {
          method: req.method,
          headers: req.headers,
          signal: abortRef.current.signal,
        }
        if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
          fetchOpts.body = req.body
        }
        const res = await fetch(req.url, fetchOpts)
        elapsed = Math.round(performance.now() - t0)
        contentType = res.headers.get('content-type') ?? ''
        bodyText = await res.text()
        status = res.status
        statusText = res.statusText
        respHeaders = {}
        res.headers.forEach((v, k) => { respHeaders[k] = v })
        size = new Blob([bodyText]).size
      }

      setResponse({
        status,
        statusText,
        headers: respHeaders,
        body: bodyText,
        contentType,
        elapsed,
        size,
        via,
        isBinary,
        downloadBlob,
      })
      onResponseChange?.({
        status,
        statusText,
        headers: respHeaders,
        body: bodyText,
        contentType,
        elapsed,
        size,
        via,
        isBinary,
      })
    } catch (e) {
      if (e.name === 'AbortError') return
      const elapsed = Math.round(performance.now() - t0)
      let msg = e.message ?? String(e)
      if (msg === 'Failed to fetch') {
        msg = 'Request failed - likely a CORS restriction or network error. Enable local agent mode in Settings to route through jotit-agent.'
      }
      setNetError({ msg, elapsed })
      onResponseChange?.(null)
    } finally {
      setLoading(false)
    }
  }, [agentStatus.available, onResponseChange, req])

  const cancel = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  const copyBody = async () => {
    if (!response?.body) return
    await navigator.clipboard.writeText(response.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const downloadBinary = () => {
    if (!response?.downloadBlob) return
    const url = URL.createObjectURL(response.downloadBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jotit-response-${response.status || 'download'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const { html: highlightedBody } = response && !response.isBinary
    ? highlightBody(response.body, response.contentType)
    : { text: '', html: '' }

  const tabs = ['request', 'response']

  return (
    <div className="flex flex-col h-full min-h-0">
      {total > 1 && (
        <div className="px-3 py-1 bg-zinc-900/60 border-b border-zinc-800 text-[11px] text-zinc-500 font-mono shrink-0">
          Request {idx + 1} of {total}
          {!req.error && <span className="ml-2 text-zinc-600">- {req.method} {req.url.length > 60 ? `${req.url.slice(0, 60)}...` : req.url}</span>}
        </div>
      )}

      {req.error && (
        <div className="mx-3 mt-3 px-3 py-2 bg-red-950/50 border border-red-800 rounded-lg text-[12px] text-red-300 font-mono shrink-0">
          x {req.error}
        </div>
      )}

      {!req.error && (
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0 flex items-center gap-2 flex-wrap">
          <MethodBadge method={req.method} />
          <span className="text-[12px] text-zinc-300 font-mono flex-1 min-w-0 truncate" title={req.url}>{req.url}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {loading ? (
              <button onClick={cancel} className="px-3 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-400 rounded bg-zinc-900 transition-colors">
                x cancel
              </button>
            ) : (
              <button onClick={send} className="px-3 py-1 text-[11px] font-mono text-amber-300 hover:text-amber-100 border border-amber-800 hover:border-amber-500 rounded bg-amber-950/40 hover:bg-amber-950/70 transition-colors flex items-center gap-1.5">
                Send
              </button>
            )}
          </div>
        </div>
      )}

      {!req.error && (
        <div className="flex items-center gap-0 px-3 pt-2 border-b border-zinc-800 shrink-0">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1 text-[11px] font-mono rounded-t transition-colors capitalize ${activeTab === t ? 'text-amber-300 border-b-2 border-amber-500 -mb-px bg-zinc-900' : 'text-zinc-600 hover:text-zinc-300'}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {!req.error && activeTab === 'request' && (
        <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
          <div>
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Headers Sent</div>
            <HeadersTable headers={req.headers} />
          </div>
          {req.body && (
            <div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Body</div>
              <pre className="text-[12px] font-mono text-zinc-300 bg-zinc-900 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-all">{req.body}</pre>
            </div>
          )}
        </div>
      )}

      {!req.error && activeTab === 'response' && (
        <div className="flex flex-col flex-1 min-h-0">
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-500">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" />
              </svg>
              <span className="text-[12px] font-mono">Sending...</span>
            </div>
          )}

          {!loading && netError && (
            <div className="m-3 p-3 bg-red-950/50 border border-red-800 rounded-lg text-[12px] text-red-300 font-mono space-y-1">
              <div className="font-semibold text-red-400">x Network error ({netError.elapsed}ms)</div>
              <div className="text-red-400/80">{netError.msg}</div>
            </div>
          )}

          {!loading && !netError && !response && (
            <div className="flex-1 flex items-center justify-center text-zinc-700 text-[12px] font-mono">
              Press Send to execute the request
            </div>
          )}

          {!loading && response && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className={`mx-3 mt-3 px-3 py-2 rounded-lg border flex items-center gap-3 text-[12px] font-mono shrink-0 ${statusBg(response.status)}`}>
                <span className={`font-bold text-sm ${statusColor(response.status)}`}>{response.status} {response.statusText}</span>
                <span className="text-zinc-500">-</span>
                <span className="text-zinc-400">{response.elapsed}ms</span>
                <span className="text-zinc-500">-</span>
                <span className="text-zinc-400">{formatBytes(response.size)}</span>
                {response.contentType && (
                  <>
                    <span className="text-zinc-500">-</span>
                    <span className="text-zinc-500">{response.contentType.split(';')[0]}</span>
                  </>
                )}
                <span className="ml-auto text-zinc-500">{response.via === 'local-agent' ? 'via local agent' : 'via browser'}</span>
              </div>

              <div className="flex items-center gap-0 px-3 pt-2 shrink-0">
                {['body', 'headers'].map(t => (
                  <button
                    key={t}
                    onClick={() => setRespTab(t)}
                    className={`px-3 py-0.5 text-[11px] font-mono rounded-t transition-colors capitalize ${respTab === t ? 'text-zinc-200 border-b border-zinc-500 -mb-px' : 'text-zinc-600 hover:text-zinc-300'}`}
                  >
                    {t}
                  </button>
                ))}
                {response.isBinary ? (
                  <button onClick={downloadBinary} className="ml-auto text-[11px] font-mono text-zinc-600 hover:text-zinc-300 px-2 py-0.5 transition-colors">
                    download binary
                  </button>
                ) : (
                  <button onClick={copyBody} className="ml-auto text-[11px] font-mono text-zinc-600 hover:text-zinc-300 px-2 py-0.5 transition-colors">
                    {copied ? 'copied' : 'copy body'}
                  </button>
                )}
              </div>

              {respTab === 'body' && (
                <div className="flex-1 min-h-0 overflow-auto p-3">
                  {response.isBinary ? (
                    <div className="rounded-lg p-3 bg-zinc-900 text-[12px] font-mono text-zinc-300 space-y-2">
                      <div>Binary response available.</div>
                      <div>Content-Type: {response.contentType || 'application/octet-stream'}</div>
                      <div>Size: {formatBytes(response.size)}</div>
                      <button onClick={downloadBinary} className="px-3 py-1 text-[11px] border border-zinc-700 rounded hover:border-zinc-500 transition-colors">
                        Download
                      </button>
                    </div>
                  ) : response.body ? (
                    <pre className="hljs rounded-lg p-3 text-[12px] leading-relaxed overflow-x-auto" style={{ background: '#0d1117', margin: 0 }}>
                      <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedBody }} />
                    </pre>
                  ) : (
                    <span className="text-zinc-600 text-[12px] font-mono">empty body</span>
                  )}
                </div>
              )}

              {respTab === 'headers' && (
                <div className="flex-1 min-h-0 overflow-auto p-3">
                  <HeadersTable headers={response.headers} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
