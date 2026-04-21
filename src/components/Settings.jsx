import { useState } from 'react'
import { testConnection } from '../utils/openai'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{2,40}$/

export default function Settings({ settings, onSave, onClose, onExportDB, onPublish, publicNoteCount }) {
  const [apiKey, setApiKey] = useState(settings.openaiApiKey ?? '')
  const [serverProxy, setServerProxy] = useState(settings.serverProxy ?? false)
  const [bucketName, setBucketName] = useState(settings.bucketName ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // null | 'ok' | 'fail'
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState(null) // null | { ok, url, count } | { error }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    // Temporarily init with entered key to test
    const { initOpenAI } = await import('../utils/openai')
    initOpenAI(apiKey)
    const ok = await testConnection()
    setTestResult(ok ? 'ok' : 'fail')
    setTesting(false)
  }

  const handleSave = () => {
    onSave({ ...settings, openaiApiKey: apiKey.trim(), serverProxy, bucketName: bucketName.trim() })
  }

  const handlePublish = async () => {
    const slug = bucketName.trim()
    if (!SLUG_RE.test(slug)) return
    setPublishing(true)
    setPublishResult(null)
    try {
      const result = await onPublish(slug)
      setPublishResult(result)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[480px] p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              OpenAI API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setTestResult(null) }}
              placeholder="sk-proj-..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
            />
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Used for automatic note categorization and semantic search. Your key is stored locally and never sent anywhere except OpenAI.
            </p>
          </div>

          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 text-[12px] text-zinc-500 space-y-1">
            <p className="text-zinc-400 font-medium mb-1">What AI does:</p>
            <p>• Auto-tags notes (token, config, github, etc.) after you stop typing</p>
            <p>• Generates embeddings for semantic search</p>
            <p>• Lets you search "github token" and find relevant notes even without exact words</p>
          </div>

          <div className="pt-1 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-zinc-400">Route requests via local server</label>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Bypasses CORS by proxying HTTP requests through a local server. Requires <code className="font-mono">npm run server</code> or <code className="font-mono">npm run dev:full</code>.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={serverProxy}
                onClick={() => setServerProxy(v => !v)}
                className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${serverProxy ? 'bg-blue-600 border-blue-500' : 'bg-zinc-700 border-zinc-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${serverProxy ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>

          <div className="pt-1 border-t border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-zinc-400">Public Bucket</label>
              {publicNoteCount > 0 ? (
                <span className="text-[11px] text-emerald-500">{publicNoteCount} public note{publicNoteCount !== 1 ? 's' : ''}</span>
              ) : (
                <span className="text-[11px] text-zinc-600">no public notes — toggle notes to make them public</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={bucketName}
                onChange={e => { setBucketName(e.target.value.toLowerCase()); setPublishResult(null) }}
                placeholder="your-bucket-name"
                spellCheck={false}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
              />
              <button
                onClick={handlePublish}
                disabled={publishing || !SLUG_RE.test(bucketName.trim()) || publicNoteCount === 0}
                className="px-3 py-2 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors font-medium whitespace-nowrap"
              >
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            </div>
            {!SLUG_RE.test(bucketName.trim()) && bucketName.trim().length > 0 && (
              <p className="text-[11px] text-red-400">Use 2–40 lowercase letters, numbers, or hyphens</p>
            )}
            {publishResult?.ok && (
              <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Published {publishResult.count} note{publishResult.count !== 1 ? 's' : ''} →{' '}
                <span className="font-mono text-emerald-300">/b/{bucketName.trim()}</span>
              </p>
            )}
            {publishResult?.error && (
              <p className="text-[11px] text-red-400">{publishResult.error}</p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
            <span className="text-[11px] text-zinc-600">Database</span>
            <button
              onClick={onExportDB}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors"
            >
              Export .sqlite
            </button>
          </div>

          <div className="flex items-center gap-2">
            {apiKey && (
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            )}
            {testResult === 'ok' && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Connected
              </span>
            )}
            {testResult === 'fail' && (
              <span className="text-xs text-red-400">Invalid key or no access</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
