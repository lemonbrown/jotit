import { useEffect, useState } from 'react'

const TOKEN_KEY = 'jotit_auth_token'

export function useServerAiStatus(user) {
  const [aiAvailable, setAiAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (!user) {
      setAiAvailable(false)
      return () => { cancelled = true }
    }

    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setAiAvailable(false)
      return () => { cancelled = true }
    }

    fetch('/api/ai/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => {
        if (!cancelled) setAiAvailable(Boolean(data.available))
      })
      .catch(() => {
        if (!cancelled) setAiAvailable(false)
      })

    return () => { cancelled = true }
  }, [user])

  return aiAvailable
}
