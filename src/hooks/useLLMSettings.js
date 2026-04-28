import { useState, useCallback } from 'react'

const KEY_MODEL = 'jotit_llm_model'
const KEY_ENABLED = 'jotit_llm_enabled'

export function useLLMSettings() {
  const [ollamaModel, setOllamaModelState] = useState(() => localStorage.getItem(KEY_MODEL) ?? '')
  const [llmEnabled, setLLMEnabledState] = useState(() => localStorage.getItem(KEY_ENABLED) === 'true')

  const setOllamaModel = useCallback((model) => {
    setOllamaModelState(model)
    localStorage.setItem(KEY_MODEL, model)
  }, [])

  const setLLMEnabled = useCallback((enabled) => {
    setLLMEnabledState(enabled)
    localStorage.setItem(KEY_ENABLED, String(enabled))
  }, [])

  return { ollamaModel, setOllamaModel, llmEnabled, setLLMEnabled }
}
