import { useState, useCallback, useEffect } from 'react'

const KEY_MODEL = 'jotit_llm_model'
const KEY_ENABLED = 'jotit_llm_enabled'
const CHANGE_EVENT = 'jotit:llm-settings-change'

export function getActiveLLMModel(fallback = '') {
  return localStorage.getItem(KEY_MODEL) || fallback
}

function readSettings() {
  return {
    ollamaModel: getActiveLLMModel(),
    llmEnabled: localStorage.getItem(KEY_ENABLED) === 'true',
  }
}

function dispatchSettingsChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useLLMSettings() {
  const [ollamaModel, setOllamaModelState] = useState(() => readSettings().ollamaModel)
  const [llmEnabled, setLLMEnabledState] = useState(() => readSettings().llmEnabled)

  const syncFromStorage = useCallback(() => {
    const next = readSettings()
    setOllamaModelState(next.ollamaModel)
    setLLMEnabledState(next.llmEnabled)
  }, [])

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === KEY_MODEL || event.key === KEY_ENABLED) syncFromStorage()
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

  return { ollamaModel, setOllamaModel, llmEnabled, setLLMEnabled }
}
