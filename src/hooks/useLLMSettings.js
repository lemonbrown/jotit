import { useState, useCallback, useEffect } from 'react'

const KEY_MODEL = 'jotit_llm_model'
const KEY_ENABLED = 'jotit_llm_enabled'
const KEY_PROVIDER = 'jotit_llm_provider'
const KEY_REMOTE_BASE_URL = 'jotit_llm_remote_base_url'
const KEY_REMOTE_API_KEY = 'jotit_llm_remote_api_key'
const KEY_REMOTE_MODEL = 'jotit_llm_remote_model'
const CHANGE_EVENT = 'jotit:llm-settings-change'

export function getActiveLLMModel(fallback = '') {
  return localStorage.getItem(KEY_MODEL) || fallback
}

function readSettings() {
  return {
    ollamaModel: getActiveLLMModel(),
    llmEnabled: localStorage.getItem(KEY_ENABLED) === 'true',
    llmProvider: localStorage.getItem(KEY_PROVIDER) || 'ollama',
    remoteBaseUrl: localStorage.getItem(KEY_REMOTE_BASE_URL) || 'https://openrouter.ai/api/v1',
    remoteApiKey: localStorage.getItem(KEY_REMOTE_API_KEY) || '',
    remoteModel: localStorage.getItem(KEY_REMOTE_MODEL) || '',
  }
}

function dispatchSettingsChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useLLMSettings() {
  const [ollamaModel, setOllamaModelState] = useState(() => readSettings().ollamaModel)
  const [llmEnabled, setLLMEnabledState] = useState(() => readSettings().llmEnabled)
  const [llmProvider, setLLMProviderState] = useState(() => readSettings().llmProvider)
  const [remoteBaseUrl, setRemoteBaseUrlState] = useState(() => readSettings().remoteBaseUrl)
  const [remoteApiKey, setRemoteApiKeyState] = useState(() => readSettings().remoteApiKey)
  const [remoteModel, setRemoteModelState] = useState(() => readSettings().remoteModel)

  const syncFromStorage = useCallback(() => {
    const next = readSettings()
    setOllamaModelState(next.ollamaModel)
    setLLMEnabledState(next.llmEnabled)
    setLLMProviderState(next.llmProvider)
    setRemoteBaseUrlState(next.remoteBaseUrl)
    setRemoteApiKeyState(next.remoteApiKey)
    setRemoteModelState(next.remoteModel)
  }, [])

  useEffect(() => {
    const onStorage = (event) => {
      if ([KEY_MODEL, KEY_ENABLED, KEY_PROVIDER, KEY_REMOTE_BASE_URL, KEY_REMOTE_API_KEY, KEY_REMOTE_MODEL].includes(event.key)) syncFromStorage()
    }
    window.addEventListener(CHANGE_EVENT, syncFromStorage)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, syncFromStorage)
      window.removeEventListener('storage', onStorage)
    }
  }, [syncFromStorage])

  const setOllamaModel = useCallback((model) => {
    setOllamaModelState(model)
    localStorage.setItem(KEY_MODEL, model)
    dispatchSettingsChanged()
  }, [])

  const setLLMEnabled = useCallback((enabled) => {
    setLLMEnabledState(enabled)
    localStorage.setItem(KEY_ENABLED, String(enabled))
    dispatchSettingsChanged()
  }, [])

  const setLLMProvider = useCallback((provider) => {
    setLLMProviderState(provider)
    localStorage.setItem(KEY_PROVIDER, provider)
    dispatchSettingsChanged()
  }, [])

  const setRemoteBaseUrl = useCallback((baseUrl) => {
    setRemoteBaseUrlState(baseUrl)
    localStorage.setItem(KEY_REMOTE_BASE_URL, baseUrl)
    dispatchSettingsChanged()
  }, [])

  const setRemoteApiKey = useCallback((apiKey) => {
    setRemoteApiKeyState(apiKey)
    localStorage.setItem(KEY_REMOTE_API_KEY, apiKey)
    dispatchSettingsChanged()
  }, [])

  const setRemoteModel = useCallback((model) => {
    setRemoteModelState(model)
    localStorage.setItem(KEY_REMOTE_MODEL, model)
    dispatchSettingsChanged()
  }, [])

  return {
    ollamaModel,
    setOllamaModel,
    llmEnabled,
    setLLMEnabled,
    llmProvider,
    setLLMProvider,
    remoteBaseUrl,
    setRemoteBaseUrl,
    remoteApiKey,
    setRemoteApiKey,
    remoteModel,
    setRemoteModel,
  }
}
