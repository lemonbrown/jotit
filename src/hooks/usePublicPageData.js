import { useEffect, useState } from 'react'

export function usePublicPageData(path) {
  const [state, setState] = useState({ loading: true, error: null, data: null })

  useEffect(() => {
    let cancelled = false

    async function load() {
      setState({ loading: true, error: null, data: null })
      try {
        const res = await fetch(`/api/public-pages${path}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setState({ loading: false, error: data.error ?? 'Public page not found', data: null })
          return
        }
        setState({ loading: false, error: null, data })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.message ?? 'Network error', data: null })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [path])

  return state
}
