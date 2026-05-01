import { useState, useCallback, useRef } from 'react'
import { streamLLMChat } from '../utils/llmClient'

export function useLLMChat({ token, model }) {
  const [messages, setMessages] = useState([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(false)

  const sendMessage = useCallback(async (text, context, contextMode, options = {}) => {
    if (!text.trim() || isStreaming) return

    const userMessage = { role: 'user', content: text.trim() }
    const nextMessages = [...messages, userMessage]

    setMessages([...nextMessages, { role: 'assistant', content: '' }])
    setIsStreaming(true)
    setError(null)
    abortRef.current = false

    const historyForApi = nextMessages.map(({ role, content }) => ({ role, content }))

    streamLLMChat(
      { token, model, messages: historyForApi, context, contextMode, images: options.images ?? [] },
      (chunk) => {
        if (abortRef.current) return
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + chunk }
          }
          return updated
        })
      },
      () => {
        setIsStreaming(false)
      },
      (err) => {
        setError(err)
        setIsStreaming(false)
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = { ...last, content: '_(error: ' + err + ')_' }
          }
          return updated
        })
      },
    )
  }, [messages, isStreaming, token, model])

  const clear = useCallback(() => {
    abortRef.current = true
    setMessages([])
    setIsStreaming(false)
    setError(null)
  }, [])

  return { messages, isStreaming, error, sendMessage, clear }
}
