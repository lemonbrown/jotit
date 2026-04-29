import { useState, useCallback, useRef, useEffect } from 'react'
import { parseRequests } from '../utils/httpParser'
import { buildOpenApiDiscoveryUrls, extractOpenApiDiscoveryUrls, getOpenApiSpecFileName } from '../utils/openapi/discovery'
import { parseOpenApiJson } from '../utils/openapi/parse'
import { loadSettings } from '../utils/storage'
import HttpRequestPane, { LOCAL_AGENT_ORIGIN, isAgentEnabled } from './HttpRequestPane'

function getRequestOrigin(req) {
  if (!req?.url || req.error) return ''
  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}

async function fetchTextForDiscovery(url, { settings, agentStatus }) {
  if (isAgentEnabled(settings)) {
    if (!agentStatus.available) {
      throw new Error('Local agent not detected on 127.0.0.1:3210')
    }
    if (!settings.localAgentToken?.trim()) {
      throw new Error('Local agent token is missing')
    }

    const agentRes = await fetch(`${LOCAL_AGENT_ORIGIN}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.localAgentToken.trim()}`,
      },
      body: JSON.stringify({
        url,
        method: 'GET',
        headers: { Accept: 'application/json, application/vnd.oai.openapi+json;q=0.9, */*;q=0.1' },
        timeoutMs: 8000,
      }),
    })

    const data = await agentRes.json()
    if (!agentRes.ok && data.error) throw new Error(data.error)
    if (data.status < 200 || data.status >= 300) throw new Error(`HTTP ${data.status}`)
    if (data.isBinary) throw new Error('Spec response was binary')
    return data.body ?? ''
  }

  const res = await fetch(url, {
    headers: { Accept: 'application/json, application/vnd.oai.openapi+json;q=0.9, */*;q=0.1' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export default function HttpRunner({
  noteContent,
  initialText,
  requestsOverride = null,
  title = null,
  onCopyRequestToNewNote = null,
  onCreateOpenApiNote = null,
  onResponseChange = null,
}) {
  const hasSelection = initialText && initialText.trim().length > 0
  const [useSelection, setUseSelection] = useState(hasSelection)
  const [agentStatus, setAgentStatus] = useState({ checking: true, available: false })

  useEffect(() => {
    let cancelled = false
    fetch(`${LOCAL_AGENT_ORIGIN}/health`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(() => {
        if (!cancelled) setAgentStatus({ checking: false, available: true })
      })
      .catch(() => {
        if (!cancelled) setAgentStatus({ checking: false, available: false })
      })
    return () => { cancelled = true }
  }, [])

  const activeContent = useSelection && hasSelection ? initialText : noteContent
  const requests = requestsOverride?.length ? requestsOverride : parseRequests(activeContent)
  const [activeIdx, setActiveIdx] = useState(0)
  const active = requests[activeIdx] ?? requests[0]
  const [specInput, setSpecInput] = useState('')
  const [specStatus, setSpecStatus] = useState(null)
  const [specLoading, setSpecLoading] = useState(false)
  const settings = loadSettings()

  useEffect(() => {
    setSpecStatus(null)
  }, [active?.url])

  const discoverOpenApiSpec = useCallback(async () => {
    if (!onCreateOpenApiNote || !active || active.error || specLoading) return

    const input = specInput.trim() || getRequestOrigin(active) || active.url
    const candidates = buildOpenApiDiscoveryUrls(input)
    if (!candidates.length) {
      setSpecStatus({ type: 'error', text: 'Enter a server URL or OpenAPI JSON URL.' })
      return
    }

    setSpecLoading(true)
    setSpecStatus({ type: 'info', text: `Checking ${candidates.length} possible spec URL${candidates.length === 1 ? '' : 's'}...` })

    const failures = []
    try {
      for (let index = 0; index < candidates.length; index += 1) {
        const url = candidates[index]
        try {
          const rawText = await fetchTextForDiscovery(url, { settings, agentStatus })
          let document
          try {
            document = parseOpenApiJson(rawText)
          } catch (parseError) {
            const discoveredUrls = extractOpenApiDiscoveryUrls(rawText, url)
            for (const discoveredUrl of discoveredUrls) {
              if (!candidates.includes(discoveredUrl)) candidates.push(discoveredUrl)
            }
            throw parseError
          }
          const fileName = getOpenApiSpecFileName(url, document)
          onCreateOpenApiNote(fileName, document)
          setSpecInput(url)
          setSpecStatus({ type: 'success', text: `Imported OpenAPI spec from ${url}` })
          return
        } catch (error) {
          failures.push(`${url} (${error.message ?? 'failed'})`)
        }
      }
      setSpecStatus({
        type: 'error',
        text: `No OpenAPI JSON spec found. Tried ${candidates.length} URL${candidates.length === 1 ? '' : 's'}.`,
        title: failures.join('\n'),
      })
    } finally {
      setSpecLoading(false)
    }
  }, [active, agentStatus, onCreateOpenApiNote, settings, specInput, specLoading])

  if (!requests.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-[13px] font-mono">
        No HTTP request detected in this note
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60 shrink-0 text-[10px] font-mono">
        {title && <span className="text-zinc-500">{title}</span>}
        <span className={agentStatus.available ? 'text-emerald-400' : 'text-zinc-600'}>
          {agentStatus.checking ? 'Checking local agent...' : agentStatus.available ? 'Local agent connected' : 'Local agent not detected'}
        </span>
        {isAgentEnabled(settings) && (
          <span className="text-amber-400">
            {settings.localAgentToken?.trim() ? 'Local agent mode enabled' : 'Add local agent token in Settings'}
          </span>
        )}
        {onCopyRequestToNewNote && active && !active.error && (
          <button
            onClick={() => onCopyRequestToNewNote(active)}
            className="ml-auto text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            copy to new note
          </button>
        )}
      </div>

      {onCreateOpenApiNote && active && !active.error && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/40 shrink-0">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0">OpenAPI</span>
          <input
            value={specInput}
            onChange={event => setSpecInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') discoverOpenApiSpec()
            }}
            placeholder={getRequestOrigin(active) || 'https://localhost:7026'}
            className="min-w-0 flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 font-mono outline-none focus:border-amber-700"
          />
          <button
            onClick={discoverOpenApiSpec}
            disabled={specLoading}
            className="px-2.5 py-1 text-[11px] font-mono text-amber-300 hover:text-amber-100 disabled:text-zinc-600 border border-amber-900 hover:border-amber-600 disabled:border-zinc-800 rounded bg-amber-950/20 disabled:bg-zinc-950 transition-colors shrink-0"
          >
            {specLoading ? 'checking...' : 'find spec'}
          </button>
          {specStatus && (
            <span
              title={specStatus.title || specStatus.text}
              className={`text-[10px] font-mono truncate max-w-[38%] ${
                specStatus.type === 'success'
                  ? 'text-emerald-400'
                  : specStatus.type === 'error'
                    ? 'text-red-400'
                    : 'text-zinc-500'
              }`}
            >
              {specStatus.text}
            </span>
          )}
        </div>
      )}

      {hasSelection && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-900/50 bg-amber-950/20 shrink-0">
          <span className="text-[10px] font-mono text-amber-500">{useSelection ? 'Using selection' : 'Using full note'}</span>
          <span className="text-[10px] text-amber-700 font-mono">{useSelection ? `${initialText.trim().length} chars` : `${noteContent.trim().length} chars`}</span>
          <button onClick={() => { setUseSelection(v => !v); setActiveIdx(0) }} className="ml-auto text-[10px] font-mono text-amber-600 hover:text-amber-300 transition-colors px-1.5 py-0.5 border border-amber-900/60 hover:border-amber-700 rounded">
            {useSelection ? 'use full note' : 'use selection'}
          </button>
        </div>
      )}

      {requests.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60 shrink-0 overflow-x-auto">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 mr-1">{requests.length} requests</span>
          {requests.map((r, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${i === activeIdx ? 'text-amber-300 bg-amber-950/40 border-amber-800' : r.error ? 'text-red-400 bg-red-950/20 border-red-900 hover:border-red-700' : 'text-zinc-400 bg-zinc-900 border-zinc-700 hover:border-zinc-500 hover:text-zinc-100'}`}
            >
              {r.error ? 'parse error' : `${r.method} ${r.url.replace(/^https?:\/\//, '').slice(0, 30)}`}
            </button>
          ))}
        </div>
      )}

      <HttpRequestPane
        req={active}
        idx={activeIdx}
        total={requests.length}
        agentStatus={agentStatus}
        onResponseChange={onResponseChange}
      />
    </div>
  )
}

