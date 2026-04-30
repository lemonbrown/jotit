import { useState, useEffect } from 'react'
import { useLocalAgentStatus } from '../hooks/useLocalAgentStatus'
import { getStoredKeyPair } from '../utils/e2eEncryption'
import { useLLMSettings } from '../hooks/useLLMSettings'
import { getLLMStatus, getLLMModels } from '../utils/llmClient'
import AppearanceSection from './settings/AppearanceSection'
import ProfileSection, { SLUG_RE } from './settings/ProfileSection'
import SyncSection from './settings/SyncSection'
import EncryptionSection from './settings/EncryptionSection'
import DangerZoneSection from './settings/DangerZoneSection'

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
  onRemoveAllFromServer,
  publicNoteCount,
  publicCollectionCount = 0,
  noteCount = 0,
  user,
  bucketName: initialBucketName = '',
}) {
  const [serverProxy, setServerProxy] = useState(settings.serverProxy ?? false)
  const [syncEnabled, setSyncEnabled] = useState(settings.syncEnabled ?? true)
  const [localAgentToken, setLocalAgentToken] = useState(settings.localAgentToken ?? '')
  const [bucketName, setBucketName] = useState(initialBucketName || settings.bucketName || '')
  const [theme, setTheme] = useState(settings.theme ?? 'dark')
  const [secretScanEnabled, setSecretScanEnabled] = useState(settings.secretScanEnabled ?? false)
  const [secretScanBlockSync, setSecretScanBlockSync] = useState(settings.secretScanBlockSync ?? false)
  const [bucketSaving, setBucketSaving] = useState(false)
  const [bucketStatus, setBucketStatus] = useState(null)
  const [removeAllServerState, setRemoveAllServerState] = useState(null)
  const [bucketCollections, setBucketCollections] = useState([])
  const [bucketNotes, setBucketNotes] = useState([])
  const localAgentStatus = useLocalAgentStatus()

  const { llmEnabled, setLLMEnabled, ollamaModel, setOllamaModel } = useLLMSettings()
  const [ollamaAvailable, setOllamaAvailable] = useState(null)
  const [ollamaModels, setOllamaModels] = useState([])
  const [ollamaLoading, setOllamaLoading] = useState(false)
  const [embedProvider, setEmbedProvider] = useState('openai')
  const [embedModel, setEmbedModel] = useState('nomic-embed-text')
  const [embedSaving, setEmbedSaving] = useState(false)
  const [embedStatus, setEmbedStatus] = useState(null)

  const [hasE2EKeys, setHasE2EKeys] = useState(false)
  const [regenMode, setRegenMode] = useState(false)
  const [regenPassword, setRegenPassword] = useState('')
  const [regenState, setRegenState] = useState(null)
  const [regenError, setRegenError] = useState('')

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
        if (models?.length) {
          const modelNames = new Set(models.map(model => model.name))
          if (!ollamaModel || !modelNames.has(ollamaModel)) setOllamaModel(models[0].name)
        }
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
    onSave({ ...settings, serverProxy, localAgentToken: localAgentToken.trim(), theme, secretScanEnabled, secretScanBlockSync, syncEnabled })
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
          <AppearanceSection theme={theme} onThemeChange={handleThemeChange} />

          <SyncSection
            checkOllama={checkOllama}
            embedModel={embedModel}
            embedProvider={embedProvider}
            embedSaving={embedSaving}
            embedStatus={embedStatus}
            llmEnabled={llmEnabled}
            localAgentStatus={localAgentStatus}
            localAgentToken={localAgentToken}
            ollamaAvailable={ollamaAvailable}
            ollamaLoading={ollamaLoading}
            ollamaModel={ollamaModel}
            ollamaModels={ollamaModels}
            onEmbedModelChange={value => { setEmbedModel(value); setEmbedStatus(null) }}
            onSaveEmbedConfig={handleSaveEmbedConfig}
            onToggleEmbedProvider={() => { setEmbedProvider(p => p === 'ollama' ? 'openai' : 'ollama'); setEmbedStatus(null) }}
            onToggleLlm={() => setLLMEnabled(!llmEnabled)}
            onToggleServerProxy={() => setServerProxy(v => !v)}
            onToggleSync={() => setSyncEnabled(v => !v)}
            serverProxy={serverProxy}
            setLocalAgentToken={setLocalAgentToken}
            setOllamaModel={setOllamaModel}
            showAiConfig={Boolean(onSaveAiConfig)}
            syncEnabled={syncEnabled}
            user={user}
          />

          <ProfileSection
            bucketCollections={bucketCollections}
            bucketName={bucketName}
            bucketNotes={bucketNotes}
            bucketSaving={bucketSaving}
            bucketStatus={bucketStatus}
            onBucketNameChange={value => { setBucketName(value); setBucketStatus(null) }}
            onSaveBucketName={handleSaveBucketName}
            publicCollectionCount={publicCollectionCount}
            publicNoteCount={publicNoteCount}
          />

          <EncryptionSection
            hasE2EKeys={hasE2EKeys}
            onRegenerate={handleRegenerate}
            regenError={regenError}
            regenMode={regenMode}
            regenPassword={regenPassword}
            regenState={regenState}
            secretScanBlockSync={secretScanBlockSync}
            secretScanEnabled={secretScanEnabled}
            setRegenError={setRegenError}
            setRegenMode={setRegenMode}
            setRegenPassword={setRegenPassword}
            setRegenState={setRegenState}
            setSecretScanBlockSync={setSecretScanBlockSync}
            setSecretScanEnabled={setSecretScanEnabled}
            user={user}
          />

          <DangerZoneSection
            noteCount={noteCount}
            onDeleteAllNotes={handleDeleteAllNotes}
            onExportDB={onExportDB}
            onRemoveAllFromServer={onRemoveAllFromServer}
            removeAllServerState={removeAllServerState}
            setRemoveAllServerState={setRemoveAllServerState}
            user={user}
          />

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
