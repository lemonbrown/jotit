import { useState, useEffect } from 'react'
import { useLocalAgentStatus } from '../hooks/useLocalAgentStatus'
import { getStoredKeyPair } from '../utils/e2eEncryption'
import { useLLMSettings } from '../hooks/useLLMSettings'
import { getLLMStatus, getLLMModels } from '../utils/llmClient'

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
  onLoadBucketInfo,
  onSaveBucketName,
  onLoadAiConfig,
  onSaveAiConfig,
  onSeedNotes,
  onRegenerateKeys,
  publicNoteCount,
  publicCollectionCount = 0,
  noteCount = 0,
  user,
  bucketName: initialBucketName = '',
}) {
  const [serverProxy, setServerProxy] = useState(settings.serverProxy ?? false)
  const [localAgentToken, setLocalAgentToken] = useState(settings.localAgentToken ?? '')
  const [bucketName, setBucketName] = useState(initialBucketName || settings.bucketName || '')
  const [theme, setTheme] = useState(settings.theme ?? 'dark')
  const [secretScanEnabled, setSecretScanEnabled] = useState(settings.secretScanEnabled ?? false)
  const [secretScanBlockSync, setSecretScanBlockSync] = useState(settings.secretScanBlockSync ?? false)
  const [bucketSaving, setBucketSaving] = useState(false)
  const [bucketStatus, setBucketStatus] = useState(null)
  const [bucketCollections, setBucketCollections] = useState([])
  const [bucketNotes, setBucketNotes] = useState([])
  const localAgentStatus = useLocalAgentStatus()

  const { llmEnabled, setLLMEnabled, ollamaModel, setOllamaModel } = useLLMSettings()
  const [ollamaAvailable, setOllamaAvailable] = useState(null) // null=unchecked, true, false
  const [ollamaModels, setOllamaModels] = useState([])
  const [ollamaLoading, setOllamaLoading] = useState(false)

  const [embedProvider, setEmbedProvider] = useState('openai') // 'openai' | 'ollama'
  const [embedModel, setEmbedModel] = useState('nomic-embed-text')
  const [embedSaving, setEmbedSaving] = useState(false)
  const [embedStatus, setEmbedStatus] = useState(null) // null | { ok } | { error }

  const checkOllama = async () => {
    const token = localAgentToken.trim() || settings.localAgentToken?.trim() || ''
    if (!token) return
    setOllamaLoading(true)
    try {
      const status = await getLLMStatus(token)
      setOllamaAvailable(status.available)
      if (status.available) {
        const { models } = await getLLMModels(token)
        setOllamaModels(models ?? [])
        if (models?.length && !ollamaModel) setOllamaModel(models[0].name)
      } else {
        setOllamaModels([])
      }
    } catch {
      setOllamaAvailable(false)
      setOllamaModels([])
    } finally {
      setOllamaLoading(false)
    }
  }

  const [hasE2EKeys, setHasE2EKeys] = useState(false)
  const [regenMode, setRegenMode] = useState(false)
  const [regenPassword, setRegenPassword] = useState('')
  const [regenState, setRegenState] = useState(null) // 'loading' | 'ok' | 'error'
  const [regenError, setRegenError] = useState('')

  useEffect(() => {
    if (llmEnabled) checkOllama()
    if (onLoadAiConfig) {
      onLoadAiConfig().then(config => {
        if (!config) return
        if (config.embeddingProvider) setEmbedProvider(config.embeddingProvider)
        if (config.ollamaEmbedModel) setEmbedModel(config.ollamaEmbedModel)
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (user) getStoredKeyPair().then(kp => setHasE2EKeys(!!kp))
  }, [user])

  useEffect(() => {
    setBucketName(initialBucketName || settings.bucketName || '')
  }, [initialBucketName, settings.bucketName])

  useEffect(() => {
    if (!user || !onLoadBucketInfo) return
    let cancelled = false

    onLoadBucketInfo().then(result => {
      if (cancelled || !result) return
      if (result.ok) {
        setBucketName(result.bucketName ?? '')
        setBucketCollections(result.publicCollections ?? [])
        setBucketNotes(result.publicNotes ?? [])
      } else if (result.error) {
        setBucketStatus({ error: result.error })
      }
    }).catch(() => {})

    return () => { cancelled = true }
  }, [onLoadBucketInfo, user?.id])

  const handleRegenerate = async () => {
    if (!regenPassword) return
    setRegenState('loading')
    setRegenError('')
    try {
      await onRegenerateKeys(regenPassword)
      setHasE2EKeys(true)
      setRegenState('ok')
      setRegenMode(false)
      setRegenPassword('')
    } catch (e) {
      setRegenState('error')
      setRegenError(e.message ?? 'Failed to regenerate keys')
    }
  }

  const handleSaveEmbedConfig = async () => {
    if (!onSaveAiConfig) return
    setEmbedSaving(true)
    setEmbedStatus(null)
    try {
      const result = await onSaveAiConfig({ embeddingProvider: embedProvider, ollamaEmbedModel: embedModel })
      setEmbedStatus(result?.ok ? { ok: true } : { error: result?.error ?? 'Failed to save' })
    } finally {
      setEmbedSaving(false)
    }
  }

  const handleThemeChange = (id) => {
    setTheme(id)
    document.documentElement.dataset.theme = id
  }

  const handleSave = () => {
    onSave({ ...settings, serverProxy, localAgentToken: localAgentToken.trim(), theme, secretScanEnabled, secretScanBlockSync })
  }

  const handleSaveBucketName = async () => {
    const slug = bucketName.trim()
    if (!SLUG_RE.test(slug) || !onSaveBucketName) return
    setBucketSaving(true)
    setBucketStatus(null)
    try {
      const result = await onSaveBucketName(slug)
      setBucketStatus(result)
      if (result?.ok) setBucketName(result.bucketName ?? slug)
    } finally {
      setBucketSaving(false)
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
                  Uses <code className="font-mono">jot serve</code> on <code className="font-mono">127.0.0.1:3210</code> for localhost/private-network/dev targets.
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
                Run <code className="font-mono">jot serve</code> to start the agent, copy the token shown in terminal, and paste it here.
              </p>
            </div>
          </div>

          <div className="pt-1 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-zinc-400">✒ Nib</label>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Query your notes with a locally running model via <code className="font-mono">jotit-agent</code>.
                </p>
                {ollamaAvailable === true && (
                  <p className="text-[11px] text-emerald-400 mt-1">Ollama connected</p>
                )}
                {ollamaAvailable === false && (
                  <p className="text-[11px] text-zinc-600 mt-1">Ollama not reachable</p>
                )}
              </div>
              <button
                role="switch"
                aria-checked={llmEnabled}
                onClick={() => setLLMEnabled(!llmEnabled)}
                className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${llmEnabled ? 'bg-violet-600 border-violet-500' : 'bg-zinc-700 border-zinc-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${llmEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            {llmEnabled && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={ollamaModel}
                    onChange={e => setOllamaModel(e.target.value)}
                    disabled={!ollamaModels.length}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono outline-none focus:border-zinc-500 transition-colors disabled:opacity-50"
                  >
                    {ollamaModels.length === 0 && ollamaModel && (
                      <option value={ollamaModel}>{ollamaModel}</option>
                    )}
                    {ollamaModels.length === 0 && !ollamaModel && (
                      <option value="">{ollamaAvailable === false ? 'Ollama not reachable' : ollamaLoading ? 'Loading…' : 'No models found'}</option>
                    )}
                    {ollamaModels.map(m => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={checkOllama}
                    disabled={ollamaLoading}
                    className="px-3 py-2 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {ollamaLoading ? 'Checking…' : 'Refresh'}
                  </button>
                </div>
                {!ollamaModels.length && ollamaAvailable === null && (
                  <p className="text-[11px] text-zinc-600">Make sure jotit-agent is running and click Refresh.</p>
                )}
              </div>
            )}
          </div>

          {onSaveAiConfig && (
            <div className="pt-1 border-t border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs font-medium text-zinc-400">Embeddings provider</label>
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    Source for semantic search embeddings. Local uses Ollama via jotit-agent.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={embedProvider === 'ollama'}
                  onClick={() => { setEmbedProvider(p => p === 'ollama' ? 'openai' : 'ollama'); setEmbedStatus(null) }}
                  className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${embedProvider === 'ollama' ? 'bg-violet-600 border-violet-500' : 'bg-zinc-700 border-zinc-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${embedProvider === 'ollama' ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              {embedProvider === 'ollama' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={embedModel}
                      onChange={e => { setEmbedModel(e.target.value); setEmbedStatus(null) }}
                      placeholder="nomic-embed-text"
                      spellCheck={false}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
                    />
                    <button
                      onClick={handleSaveEmbedConfig}
                      disabled={embedSaving || !embedModel.trim()}
                      className="px-3 py-2 text-xs bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors font-medium whitespace-nowrap"
                    >
                      {embedSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-600">
                    Run <code className="font-mono">ollama pull nomic-embed-text</code> first. After saving, use Reindex on the AI status page to rebuild embeddings.
                  </p>
                </div>
              )}
              {embedProvider === 'openai' && (
                <div className="flex justify-end">
                  <button
                    onClick={handleSaveEmbedConfig}
                    disabled={embedSaving}
                    className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 text-zinc-300 rounded-md transition-colors font-medium"
                  >
                    {embedSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
              {embedStatus?.ok && (
                <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  Saved — run Reindex to rebuild embeddings with the new provider
                </p>
              )}
              {embedStatus?.error && (
                <p className="text-[11px] text-red-400">{embedStatus.error}</p>
              )}
            </div>
          )}

          <div className="pt-1 border-t border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-zinc-400">Public Bucket</label>
              {publicCollectionCount > 0 ? (
                <span className="text-[11px] text-emerald-500">
                  {publicCollectionCount} public collection{publicCollectionCount !== 1 ? 's' : ''} · {bucketNotes.length} direct note{bucketNotes.length !== 1 ? 's' : ''}
                </span>
              ) : (
                <span className="text-[11px] text-zinc-600">
                  {bucketNotes.length ? `${bucketNotes.length} direct note${bucketNotes.length !== 1 ? 's' : ''} in bucket` : 'no public collections yet'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={bucketName}
                onChange={e => { setBucketName(e.target.value.toLowerCase()); setBucketStatus(null) }}
                placeholder="your-bucket-name"
                spellCheck={false}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
              />
              <button
                onClick={handleSaveBucketName}
                disabled={bucketSaving || !SLUG_RE.test(bucketName.trim())}
                className="px-3 py-2 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors font-medium whitespace-nowrap"
              >
                {bucketSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
            {!SLUG_RE.test(bucketName.trim()) && bucketName.trim().length > 0 && (
              <p className="text-[11px] text-red-400">Use 2-40 lowercase letters, numbers, or hyphens</p>
            )}
            {bucketName.trim() && SLUG_RE.test(bucketName.trim()) && (
              <p className="text-[11px] text-zinc-500">
                Bucket URL: <span className="font-mono text-zinc-300">/b/{bucketName.trim()}</span>
              </p>
            )}
            {bucketCollections.length > 0 && (
              <p className="text-[11px] text-zinc-600">
                Live now: {bucketCollections.map(collection => collection.slug).join(', ')}
              </p>
            )}
            {bucketNotes.length > 0 && (
              <p className="text-[11px] text-zinc-600">
                Direct notes: {bucketNotes.slice(0, 4).map(note => note.title ?? 'untitled').join(', ')}{bucketNotes.length > 4 ? ` +${bucketNotes.length - 4} more` : ''}
              </p>
            )}
            {bucketStatus?.ok && (
              <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Bucket name saved
              </p>
            )}
            {bucketStatus?.error && (
              <p className="text-[11px] text-red-400">{bucketStatus.error}</p>
            )}
            {publicNoteCount > 0 && (
              <p className="text-[11px] text-zinc-600">
                {publicNoteCount} individually shared note{publicNoteCount !== 1 ? 's' : ''} now also appear under <span className="font-mono text-zinc-300">/b/{bucketName.trim() || 'your-bucket'}</span>.
              </p>
            )}
          </div>

          {user && (
            <div className="pt-1 border-t border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs font-medium text-zinc-400">End-to-end encryption</label>
                  <p className={`text-[11px] mt-0.5 ${hasE2EKeys ? 'text-emerald-400' : 'text-zinc-600'}`}>
                    {hasE2EKeys ? 'Key pair active on this device' : 'No key pair on this device'}
                  </p>
                </div>
                {!regenMode && (
                  <button
                    onClick={() => { setRegenMode(true); setRegenState(null); setRegenError('') }}
                    className="ml-4 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors shrink-0"
                  >
                    {hasE2EKeys ? 'Regenerate key pair' : 'Set up key pair'}
                  </button>
                )}
              </div>

              {regenMode && (
                <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-3 space-y-2">
                  <p className="text-[11px] text-amber-400">
                    Generating new keys will make any E2E-encrypted notes unreadable on other devices until those devices log out and back in.
                  </p>
                  <input
                    type="password"
                    value={regenPassword}
                    onChange={e => setRegenPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleRegenerate()}
                    placeholder="Enter your account password"
                    autoFocus
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
                  />
                  {regenError && <p className="text-[11px] text-red-400">{regenError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRegenerate}
                      disabled={!regenPassword || regenState === 'loading'}
                      className="px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors font-medium"
                    >
                      {regenState === 'loading' ? 'Generating…' : 'Generate'}
                    </button>
                    <button
                      onClick={() => { setRegenMode(false); setRegenPassword(''); setRegenState(null) }}
                      className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {regenState === 'ok' && !regenMode && (
                <p className="text-[11px] text-emerald-400">Key pair generated and uploaded successfully.</p>
              )}
            </div>
          )}

          <div className="pt-1 border-t border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-zinc-400">Secret scanning</label>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Warn when a note contains API keys, tokens, passwords, or private keys.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={secretScanEnabled}
                onClick={() => {
                  const next = !secretScanEnabled
                  setSecretScanEnabled(next)
                  if (!next) setSecretScanBlockSync(false)
                }}
                className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${secretScanEnabled ? 'bg-amber-600 border-amber-500' : 'bg-zinc-700 border-zinc-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${secretScanEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            {secretScanEnabled && (
              <div className="flex items-center justify-between pl-3 border-l border-zinc-800">
                <div>
                  <label className="block text-xs font-medium text-zinc-500">Block auto-sync and require confirmation to share</label>
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    Notes with uncleared secrets won't sync automatically and will prompt before publishing.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={secretScanBlockSync}
                  onClick={() => setSecretScanBlockSync(v => !v)}
                  className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${secretScanBlockSync ? 'bg-amber-600 border-amber-500' : 'bg-zinc-700 border-zinc-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${secretScanBlockSync ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
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
