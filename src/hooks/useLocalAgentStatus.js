import { useEffect, useState } from 'react'

const LOCAL_AGENT_ORIGIN = 'http://127.0.0.1:3210'

export function useLocalAgentStatus() {
  const [status, setStatus] = useState({ checking: true, available: false })

  useEffect(() => {
    let cancelled = false
    fetch(`${LOCAL_AGENT_ORIGIN}/health`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(() => {
        if (!cancelled) setStatus({ checking: false, available: true })
      })
      .catch(() => {
        if (!cancelled) setStatus({ checking: false, available: false })
      })
    return () => { cancelled = true }
  }, [])

  return status
}
