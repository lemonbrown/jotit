import { useMemo, useState } from 'react'
import HttpRunner from './HttpRunner'
import { formatRequestAsHttpBlock, generateRequestFromOperation } from '../utils/openapi/examples'
import { validateResponseAgainstOperation } from '../utils/openapi/validate'

function SecurityPills({ operation, securitySchemes }) {
  const schemes = operation.security ?? []
  if (!schemes.length) return <span className="text-[11px] text-zinc-600">no auth declared</span>

  return (
    <div className="flex flex-wrap gap-1.5">
      {schemes.map(name => {
        const scheme = securitySchemes?.[name]
        const label = scheme?.type === 'apiKey'
          ? `${name} api key`
          : scheme?.scheme
            ? `${name} ${scheme.scheme}`
            : name
        return (
          <span key={name} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-400">
            {label}
          </span>
        )
      })}
    </div>
  )
}

function ValidationSummary({ result }) {
  if (!result) return <span className="text-[11px] text-zinc-600">Run a request to validate the response.</span>
  if (result.ok) return <span className="text-[11px] text-emerald-400">Response matches the declared schema.</span>
  return (
    <div className="space-y-1">
      {result.issues.map(issue => (
        <div key={issue} className="text-[11px] text-amber-300">{issue}</div>
      ))}
    </div>
  )
}

export default function OpenApiViewer({ note, onCopyRequestToNewNote }) {
  const document = note?.noteData?.document
  const [activeOperationId, setActiveOperationId] = useState(document?.operations?.[0]?.id ?? null)
  const [runnerOpen, setRunnerOpen] = useState(false)
  const [selectedServer, setSelectedServer] = useState(document?.servers?.[0] ?? '')
  const [validation, setValidation] = useState(null)

  const activeOperation = useMemo(
    () => document?.operations?.find(operation => operation.id === activeOperationId) ?? document?.operations?.[0] ?? null,
    [activeOperationId, document]
  )

  const generatedRequest = useMemo(
    () => (activeOperation ? generateRequestFromOperation(activeOperation, { serverUrl: selectedServer }) : null),
    [activeOperation, selectedServer]
  )

  if (!document) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] font-mono text-zinc-600">
        OpenAPI document data is missing.
      </div>
    )
  }

  if (runnerOpen && generatedRequest) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden border-r border-zinc-800">
          <HttpRunner
            requestsOverride={[{ ...generatedRequest, raw: formatRequestAsHttpBlock(generatedRequest), error: null }]}
            title={`${activeOperation.method} ${activeOperation.path}`}
            onCopyRequestToNewNote={(request) => onCopyRequestToNewNote?.(formatRequestAsHttpBlock(request), activeOperation)}
            onResponseChange={(response) => setValidation(validateResponseAgainstOperation(activeOperation, response))}
          />
        </div>
        <div className="w-[320px] shrink-0 overflow-auto bg-zinc-950/60 p-4 space-y-4">
          <button
            onClick={() => setRunnerOpen(false)}
            className="px-3 py-1.5 text-[12px] rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
          >
            Back to spec
          </button>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Validation</div>
            <ValidationSummary result={validation} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Operation</div>
            <div className="text-[12px] text-zinc-200 font-mono">{activeOperation.method} {activeOperation.path}</div>
            <div className="text-[11px] text-zinc-500 mt-1">{activeOperation.summary || activeOperation.id}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="w-[320px] shrink-0 border-r border-zinc-800 bg-zinc-950/60 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800">
          <div className="text-sm text-zinc-100 font-semibold truncate">{document.title}</div>
          <div className="text-[11px] text-zinc-500 font-mono">
            OpenAPI {document.version || document.openapi}
          </div>
        </div>
        <div className="px-3 py-2 border-b border-zinc-800">
          <label className="block text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Server</label>
          <select
            value={selectedServer}
            onChange={e => setSelectedServer(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-2 text-[12px] text-zinc-200"
          >
            <option value="">No server selected</option>
            {(document.servers ?? []).map(server => (
              <option key={server} value={server}>{server}</option>
            ))}
          </select>
        </div>
        <div className="overflow-auto flex-1">
          {document.operations.map(operation => (
            <button
              key={operation.id}
              onClick={() => {
                setActiveOperationId(operation.id)
                setRunnerOpen(false)
                setValidation(null)
              }}
              className={`w-full text-left px-3 py-2 border-b border-zinc-900/80 transition-colors ${
                operation.id === activeOperation?.id ? 'bg-zinc-900' : 'hover:bg-zinc-900/70'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-amber-400 shrink-0">{operation.method}</span>
                <span className="text-[12px] text-zinc-200 truncate">{operation.path}</span>
              </div>
              <div className="text-[11px] text-zinc-500 truncate mt-1">
                {operation.summary || operation.id}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-auto">
        {activeOperation ? (
          <div className="p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="px-2 py-1 text-[11px] font-mono rounded border border-amber-800 bg-amber-950/30 text-amber-300">
                {activeOperation.method}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg text-zinc-100 break-all">{activeOperation.path}</div>
                <div className="text-sm text-zinc-400 mt-1">{activeOperation.summary || activeOperation.id}</div>
                {activeOperation.description && (
                  <div className="text-[12px] text-zinc-500 mt-2 whitespace-pre-wrap">{activeOperation.description}</div>
                )}
              </div>
              <button
                onClick={() => {
                  setRunnerOpen(true)
                  setValidation(null)
                }}
                className="px-3 py-1.5 text-[12px] rounded bg-blue-600 hover:bg-blue-500 text-white"
              >
                Run
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Parameters</div>
                {activeOperation.parameters.length ? activeOperation.parameters.map(param => (
                  <div key={`${param.in}:${param.name}`} className="mb-2 last:mb-0">
                    <div className="text-[12px] text-zinc-200">
                      {param.name} <span className="text-zinc-600">({param.in})</span>
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {param.required ? 'required' : 'optional'}
                    </div>
                  </div>
                )) : (
                  <div className="text-[11px] text-zinc-600">No parameters.</div>
                )}
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Security</div>
                <SecurityPills operation={activeOperation} securitySchemes={document.securitySchemes} />
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Generated Request</div>
              <pre className="text-[12px] text-zinc-300 font-mono whitespace-pre-wrap break-all">
                {generatedRequest ? formatRequestAsHttpBlock(generatedRequest) : 'No request available'}
              </pre>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Responses</div>
              <div className="space-y-2">
                {Object.entries(activeOperation.responses ?? {}).map(([statusCode, response]) => (
                  <div key={statusCode} className="text-[12px] text-zinc-300">
                    <span className="text-emerald-400 font-mono mr-2">{statusCode}</span>
                    <span>{response.description || response.contentType || 'response'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Validation</div>
              <ValidationSummary result={validation} />
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-[12px] font-mono text-zinc-600">
            No operations found.
          </div>
        )}
      </div>
    </div>
  )
}
