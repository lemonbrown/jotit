import { startTransition, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { searchNotesLocallyDetailed } from '../utils/search'
import { searchNotesPlainText } from '../utils/plainSearch'
import { rerankResultsWithNib } from '../utils/searchNib'
import { searchNotesWithLocalEmbeddings } from '../utils/localEmbeddings'

const TOKEN_KEY = 'jotit_auth_token'
const EXACT_PREFIX = 'em:'

export function useNoteSearch(notesRef, user, collectionId = null, nibOptions = {}, idFilterNotesRef = notesRef) {
  const [searchInput, setSearchInput] = useState('')
  const deferredSearchInput = useDeferredValue(searchInput)
  const [textSearchResults, setTextSearchResults] = useState(null)
  const [idFilter, setIdFilter] = useState(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isNibSearching, setIsNibSearching] = useState(false)
  const [nibSearchApplied, setNibSearchApplied] = useState(false)
  const [searchMode, setSearchMode] = useState('plain')
  const searchSequenceRef = useRef(0)

  const clearSearch = useCallback(() => {
    searchSequenceRef.current += 1
    setSearchInput('')
    setTextSearchResults(null)
    setIdFilter(null)
    setIsSearching(false)
    setIsNibSearching(false)
    setNibSearchApplied(false)
  }, [])

  const clearIdFilter = useCallback(() => {
    searchSequenceRef.current += 1
    setIdFilter(null)
    setIsSearching(false)
  }, [])

  const filterByIds = useCallback((ids) => {
    searchSequenceRef.current += 1
    setSearchInput('')
    setTextSearchResults(null)
    setIdFilter(new Set(ids))
    setIsSearching(false)
    setIsNibSearching(false)
    setNibSearchApplied(false)
  }, [])

  const handleSearch = useCallback((query) => {
    setNibSearchApplied(false)
    setIdFilter(null)
    setSearchInput(query)
  }, [])

  const toggleSearchMode = useCallback(() => {
    setNibSearchApplied(false)
    setSearchMode(m => m === 'smart' ? 'plain' : 'smart')
  }, [])

  const improveWithNib = useCallback(async () => {
    const query = searchInput.trim()
    if (!query || !textSearchResults?.length || isNibSearching || idFilter) return
    if (!nibOptions.llmEnabled || !nibOptions.ollamaModel) return
    if ((nibOptions.llmProvider ?? 'ollama') === 'ollama' && !nibOptions.agentToken) return

    const sequence = searchSequenceRef.current
    setIsNibSearching(true)
    try {
      const reranked = await rerankResultsWithNib({
        token: nibOptions.agentToken,
        model: nibOptions.ollamaModel,
        query,
        results: textSearchResults,
      })
      if (searchSequenceRef.current !== sequence) return
      startTransition(() => {
        setTextSearchResults(reranked)
        setNibSearchApplied(true)
      })
    } catch {
      if (searchSequenceRef.current === sequence) setNibSearchApplied(false)
    } finally {
      if (searchSequenceRef.current === sequence) setIsNibSearching(false)
    }
  }, [idFilter, isNibSearching, nibOptions.agentToken, nibOptions.llmEnabled, nibOptions.llmProvider, nibOptions.ollamaModel, searchInput, textSearchResults])

  useEffect(() => {
    const raw = deferredSearchInput.trim()
    const hasPrefix = raw.startsWith(EXACT_PREFIX)
    const query = hasPrefix ? raw.slice(EXACT_PREFIX.length).trim() : raw
    const effectiveMode = hasPrefix ? 'plain' : searchMode

    const sequence = searchSequenceRef.current + 1
    searchSequenceRef.current = sequence
    setNibSearchApplied(false)

    if (idFilter) {
      startTransition(() => {
        setTextSearchResults(null)
        setIsSearching(false)
      })
      return
    }

    if (!query) {
      startTransition(() => {
        setTextSearchResults(null)
        setIsSearching(false)
      })
      return
    }

    const normalized = query.toLowerCase()
    if (normalized === 'is:git') {
      const results = notesRef.current
        .filter(n => n.git?.repoId)
        .map(note => ({ note, noteId: note.id, score: 1 }))
      startTransition(() => {
        setTextSearchResults(results)
        setIsSearching(false)
      })
      return
    }

    if (normalized.startsWith('git:')) {
      const target = query.slice(4).trim().toLowerCase()
      const results = notesRef.current
        .filter(n => n.git?.repoId?.toLowerCase() === target)
        .map(note => ({ note, noteId: note.id, score: 1 }))
      startTransition(() => {
        setTextSearchResults(results)
        setIsSearching(false)
      })
      return
    }

    if (effectiveMode === 'plain') {
      const results = searchNotesPlainText(notesRef.current, query)
      startTransition(() => {
        setTextSearchResults(results)
        setIsSearching(false)
      })
      return
    }

    const localSearchTimer = setTimeout(() => {
      if (searchSequenceRef.current !== sequence) return
      const local = searchNotesLocallyDetailed(notesRef.current, query)
      startTransition(() => {
        if (searchSequenceRef.current !== sequence) return
        setTextSearchResults(local)
      })
    }, 60)

    if (!user) {
      let cancelled = false
      setIsSearching(true)
      ;(async () => {
        try {
          const local = searchNotesLocallyDetailed(notesRef.current, query)
          const results = await searchNotesWithLocalEmbeddings(local, notesRef.current, query)
          if (cancelled || searchSequenceRef.current !== sequence) return
          startTransition(() => {
            if (cancelled || searchSequenceRef.current !== sequence) return
            setTextSearchResults(results)
          })
        } finally {
          if (!cancelled && searchSequenceRef.current === sequence) setIsSearching(false)
        }
      })()
      return () => {
        cancelled = true
        clearTimeout(localSearchTimer)
      }
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
          setTextSearchResults(Array.isArray(data.results) ? data.results : [])
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
  }, [collectionId, deferredSearchInput, idFilter, notesRef, searchMode, user])

  const strippedInput = searchInput.trim()
  const effectiveSearchMode = strippedInput.startsWith(EXACT_PREFIX) ? 'plain' : searchMode
  const searchQuery = strippedInput.startsWith(EXACT_PREFIX)
    ? strippedInput.slice(EXACT_PREFIX.length).trim()
    : strippedInput
  const searchResults = idFilter
    ? idFilterNotesRef.current
      .filter(note => idFilter.has(note.id))
      .map(note => ({ note, noteId: note.id }))
    : textSearchResults

  return {
    clearSearch,
    clearIdFilter,
    filterByIds,
    idFilter,
    handleSearch,
    isSearching,
    isNibSearching,
    improveWithNib,
    nibSearchApplied,
    searchInput,
    searchMode: effectiveSearchMode,
    searchQuery,
    searchResults,
    toggleSearchMode,
  }
}
