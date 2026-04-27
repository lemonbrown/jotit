import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { searchNotesLocallyDetailed } from '../utils/search'
import { searchNotesPlainText } from '../utils/plainSearch'

const TOKEN_KEY = 'jotit_auth_token'
const EXACT_PREFIX = 'em:'

export function useNoteSearch(notesRef, user, collectionId = null) {
  const [searchInput, setSearchInput] = useState('')
  const deferredSearchInput = useDeferredValue(searchInput)
  const [searchResults, setSearchResults] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchMode, setSearchMode] = useState('smart')
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

  const toggleSearchMode = useCallback(() => {
    setSearchMode(m => m === 'smart' ? 'plain' : 'smart')
  }, [])

  useEffect(() => {
    const raw = deferredSearchInput.trim()
    const hasPrefix = raw.startsWith(EXACT_PREFIX)
    const query = hasPrefix ? raw.slice(EXACT_PREFIX.length).trim() : raw
    const effectiveMode = hasPrefix ? 'plain' : searchMode

    const sequence = searchSequenceRef.current + 1
    searchSequenceRef.current = sequence

    if (!query) {
      startTransition(() => {
        setSearchResults(null)
        setIsSearching(false)
      })
      return
    }

    if (effectiveMode === 'plain') {
      const results = searchNotesPlainText(notesRef.current, query)
      startTransition(() => {
        setSearchResults(results)
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

        const params = new URLSearchParams({ q: query })
        if (collectionId) params.set('collectionId', collectionId)
        const response = await fetch(`/api/search?${params.toString()}`, {
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
  }, [collectionId, deferredSearchInput, notesRef, searchMode, user])

  const strippedInput = searchInput.trim()
  const effectiveSearchMode = strippedInput.startsWith(EXACT_PREFIX) ? 'plain' : searchMode
  const searchQuery = strippedInput.startsWith(EXACT_PREFIX)
    ? strippedInput.slice(EXACT_PREFIX.length).trim()
    : strippedInput

  return {
    clearSearch,
    handleSearch,
    isSearching,
    searchInput,
    searchMode: effectiveSearchMode,
    searchQuery,
    searchResults,
    toggleSearchMode,
  }
}
