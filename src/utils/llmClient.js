const AGENT_BASE = 'http://localhost:3210'

function agentHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export async function getLLMStatus(token) {
  try {
    const res = await fetch(`${AGENT_BASE}/ollama/status`, {
      headers: agentHeaders(token),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { available: false }
    return res.json()
  } catch {
    return { available: false }
  }
}

export async function getLLMModels(token) {
  const res = await fetch(`${AGENT_BASE}/ollama/models`, {
    headers: agentHeaders(token),
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error('Could not load models')
  return res.json()
}

export async function streamLLMChat({ token, model, messages, context, contextMode }, onChunk, onDone, onError) {
  let res
  try {
    res = await fetch(`${AGENT_BASE}/ollama/chat`, {
      method: 'POST',
      headers: agentHeaders(token),
      body: JSON.stringify({ model, messages, context, contextMode }),
    })
  } catch (err) {
    onError(err.message ?? 'Could not reach jotit-agent')
    return
  }

  if (!res.ok) {
    onError(`Agent error: ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          onDone()
          return
        }
        try {
          const parsed = JSON.parse(payload)
          if (parsed.error) { onError(parsed.error); return }
          if (parsed.token) onChunk(parsed.token)
        } catch {}
      }
    }
  } catch (err) {
    onError(err.message ?? 'Stream interrupted')
    return
  }

  onDone()
}
