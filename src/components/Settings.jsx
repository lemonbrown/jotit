import { useState } from 'react'
import { useLocalAgentStatus } from '../hooks/useLocalAgentStatus'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{2,40}$/

const THEMES = [
  { id: 'dark',  label: 'Dark',  swatch: '#09090b' },
  { id: 'light', label: 'Light', swatch: '#ffffff' },
  { id: 'nord',  label: 'Nord',  swatch: '#2e3440' },
  { id: 'mocha', label: 'Mocha', swatch: '#1c140e' },
]

export default function Settings({
  settings,
  onSave,
  onClose,
  onDeleteAllNotes,
  onExportDB,
  onPublish,
  onSeedNotes,
  publicNoteCount,
  noteCount = 0,
}) {
  const [serverProxy, setServerProxy] = useState(settings.serverProxy ?? false)
  const [localAgentToken, setLocalAgentToken] = useState(settings.localAgentToken ?? '')
  const [bucketName, setBucketName] = useState(settings.bucketName ?? '')
  const [theme, setTheme] = useState(settings.theme ?? 'dark')
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState(null)
  const localAgentStatus = useLocalAgentStatus()

  const handleThemeChange = (id) => {
    setTheme(id)
    document.documentElement.dataset.theme = id
  }

  const handleSave = () => {
    onSave({ ...settings, serverProxy, localAgentToken: localAgentToken.trim(), bucketName: bucketName.trim(), theme })
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

  const handleDeleteAllNotes = () => {
    if (!noteCount) return
    const confirmed = window.confirm(`Delete all ${noteCount} notes? This cannot be undone.`)
    if (!confirmed) return
    onDeleteAllNotes?.()
    onClose()
  }

  const handleSeedNotes = () => {
    onSeedNotes?.()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[560px] max-h-[88vh] overflow-y-auto p-6">
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
            <label className="block text-xs font-medium text-zinc-400 mb-2">Theme</label>
            <div className="flex gap-2 flex-wrap">
              {THEMES.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleThemeChange(t.id)}
                  title={t.label}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                    theme === t.id
                      ? 'border-blue-500 bg-blue-950/40 text-blue-300'
                      : 'border-zinc-700 hover:border-zinc-500 text-zinc-300'
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-zinc-600 shrink-0"
                    style={{ background: t.swatch }}
                  />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 text-[12px] text-zinc-500 space-y-1">
            <p className="text-zinc-400 font-medium mb-1">AI access</p>
            <p>Server AI is owned and controlled by the backend.</p>
            <p>Signed-in users can search their workspace semantically when server AI is enabled.</p>
            <p>Guests keep local keyword search only.</p>
          </div>

          <div className="pt-1 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-zinc-400">Route HTTP requests via local agent</label>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Uses <code className="font-mono">jotit-agent</code> on <code className="font-mono">127.0.0.1:3210</code> for localhost/private-network/dev targets.
                </p>
                <p className={`text-[11px] mt-1 ${localAgentStatus.available ? 'text-emerald-400' : 'text-zinc-600'}`}>
                  {localAgentStatus.checking ? 'Checking local agent...' : localAgentStatus.available ? 'Local agent connected' : 'Local agent not detected'}
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
            <div className="mt-3">
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Local Agent Token</label>
              <input
                type="password"
                value={localAgentToken}
                onChange={e => setLocalAgentToken(e.target.value)}
                placeholder="Paste token printed by jotit-agent"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
              />
              <p className="text-[11px] text-zinc-600 mt-1.5">
                Start the side app with <code className="font-mono">node agent/bin/jotit-agent.js</code>, copy the token shown in terminal, and paste it here.
              </p>
            </div>
          </div>

          <div className="pt-1 border-t border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-zinc-400">Public Bucket</label>
              {publicNoteCount > 0 ? (
                <span className="text-[11px] text-emerald-500">{publicNoteCount} public note{publicNoteCount !== 1 ? 's' : ''}</span>
              ) : (
                <span className="text-[11px] text-zinc-600">no public notes - toggle notes to make them public</span>
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
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
            </div>
            {!SLUG_RE.test(bucketName.trim()) && bucketName.trim().length > 0 && (
              <p className="text-[11px] text-red-400">Use 2-40 lowercase letters, numbers, or hyphens</p>
            )}
            {publishResult?.ok && (
              <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Published {publishResult.count} note{publishResult.count !== 1 ? 's' : ''} {'->'} <span className="font-mono text-emerald-300">/b/{bucketName.trim()}</span>
              </p>
            )}
            {publishResult?.error && (
              <p className="text-[11px] text-red-400">{publishResult.error}</p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
            <span className="text-[11px] text-zinc-600">Database</span>
            <button
              onClick={handleSeedNotes}
              className="px-3 py-1.5 text-xs bg-emerald-950 hover:bg-emerald-900 border border-emerald-900 text-emerald-200 rounded-md transition-colors"
            >
              Seed dev notes
            </button>
            <button
              onClick={onExportDB}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors"
            >
              Export .sqlite
            </button>
            <button
              onClick={handleDeleteAllNotes}
              disabled={!noteCount}
              className="px-3 py-1.5 text-xs bg-red-950 hover:bg-red-900 border border-red-900 text-red-200 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete all notes
            </button>
          </div>

          <div className="flex items-center gap-2">
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
