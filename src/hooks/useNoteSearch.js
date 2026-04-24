import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { searchNotesLocallyDetailed } from '../utils/search'

const TOKEN_KEY = 'jotit_auth_token'

export function useNoteSearch(notesRef, user) {
  const [searchInput, setSearchInput] = useState('')
  const deferredSearchInput = useDeferredValue(searchInput)
  const [searchResults, setSearchResults] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const searchSequenceRef = useRef(0)

  const clearSearch = useCallback(() => {
    searchSequenceRef.current += 1
    setSearchInput('')
    setSearchResults(null)
    setIsSearching(false)
  }, [])

  const handleSearch = useCallback((query) => {
    setSearchInput(query)
  }, [])

  useEffect(() => {
    const query = deferredSearchInput.trim()
    const sequence = searchSequenceRef.current + 1
    searchSequenceRef.current = sequence

    if (!query) {
      startTransition(() => {
        setSearchResults(null)
        setIsSearching(false)
      })
      return
    }

    const localSearchTimer = setTimeout(() => {
      if (searchSequenceRef.current !== sequence) return
      const local = searchNotesLocallyDetailed(notesRef.current, query)
      startTransition(() => {
        if (searchSequenceRef.current !== sequence) return
        setSearchResults(local)
      })
    }, 60)

    if (!user) {
      setIsSearching(false)
      return () => clearTimeout(localSearchTimer)
    }

    let cancelled = false
    setIsSearching(true)

    ;(async () => {
      try {
        const token = localStorage.getItem(TOKEN_KEY)
        if (!token) return

        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok || cancelled || searchSequenceRef.current !== sequence) return

        const data = await response.json()
        if (cancelled || searchSequenceRef.current !== sequence) return

        startTransition(() => {
          if (cancelled || searchSequenceRef.current !== sequence) return
          setSearchResults(Array.isArray(data.results) ? data.results : [])
        })
      } finally {
        if (!cancelled && searchSequenceRef.current === sequence) {
          setIsSearching(false)
        }
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(localSearchTimer)
    }
  }, [deferredSearchInput, notesRef, user])

  return {
    clearSearch,
    handleSearch,
    isSearching,
    searchInput,
    searchResults,
  }
}
