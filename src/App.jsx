import { useState, useEffect, useCallback, useRef } from 'react'
import { loadSettings, saveSettings } from './utils/storage'
import { useMemo } from 'react'
import { exportSQLite, getAttachmentsForNote } from './utils/db'
import { scheduleSyncPush } from './utils/sync'
import { generateAndStoreKeyPair, exportPublicKeyJwk, wrapPrivateKey } from './utils/e2eEncryption'
import { createEmptyNote } from './utils/noteFactories'
import { ALL_COLLECTION_ID } from './utils/collectionFactories'
import { createDeveloperSeedNotes } from './utils/helpers'
import { getNoteTitle } from './utils/noteTypes'
import { searchSnippetsLocally } from './utils/search'
import { useNoteSearch } from './hooks/useNoteSearch'
import { useNoteDropImport } from './hooks/useNoteDropImport'
import { useAppLifecycle } from './hooks/useAppLifecycle'
import { useNoteMutations } from './hooks/useNoteMutations'
import { useNoteWorkspace } from './hooks/useNoteWorkspace'
import { useCollectionCatalog } from './hooks/useCollectionCatalog'
import { useServerAiStatus } from './hooks/useServerAiStatus'
import NoteGrid from './components/NoteGrid'
import NotePanel from './components/NotePanel'
import SearchBar from './components/SearchBar'
import Settings from './components/Settings'
import SharedLinksModal from './components/SharedLinksModal'
import HelpModal from './components/HelpModal'
import AuthScreen from './components/AuthScreen'
import SnippetManager from './components/SnippetManager'
import { useAuth } from './contexts/AuthContext'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const COMMAND_TOOLBARS_HIDDEN_KEY = 'jotit_command_toolbars_hidden'
const TIPS_CREATED_KEY = 'jotit_tips_created'

export default function App() {
  const { user, loading: authLoading, logout } = useAuth()

  if (authLoading) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center gap-3 text-zinc-600">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" />
        </svg>
        <span className="text-sm font-mono">loading...</span>
      </div>
    )
  }

  return <AppShell user={user} logout={logout} />
}

function AppShell({ user, logout }) {
  const [dbReady, setDbReady] = useState(false)
  const [notes, setNotes] = useState([])
  const [snippets, setSnippets] = useState([])
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme ?? 'dark'
  }, [settings.theme])
  const [showHelp, setShowHelp] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showSharedLinks, setShowSharedLinks] = useState(false)
  const searchRef = useRef(null)
  const diffLoaderRef = useRef(null)
  const [diffActive, setDiffActive] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [notePeekOpen, setNotePeekOpen] = useState(false)
  const [notesPaneHidden, setNotesPaneHidden] = useState(false)
  const [simpleEditorMode, setSimpleEditorMode] = useState(false)
  const [commandToolbarsHidden, setCommandToolbarsHidden] = useState(() => (
    localStorage.getItem(COMMAND_TOOLBARS_HIDDEN_KEY) !== 'false'
  ))
  const [tipsCreated, setTipsCreated] = useState(() => localStorage.getItem(TIPS_CREATED_KEY) === 'true')
  const [editorFocusNonce, setEditorFocusNonce] = useState(0)
  const [draggedNoteId, setDraggedNoteId] = useState(null)
  const [dragOverCollectionId, setDragOverCollectionId] = useState(null)
  const createFromUrlHandledRef = useRef(false)
  const {
    activeNoteId,
    activePaneId,
    closeEditorPane,
    editorPanes,
    locationHistory,
    locationHistoryIndex,
    navigateLocationHistory,
    openNoteInPane,
    recordLocation,
    removeNoteFromWorkspace,
    resetWorkspace,
    restoreLocation,
    setActiveNoteId,
    setActivePaneId,
    showSinglePaneForNote,
  } = useNoteWorkspace()

  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])
  const snippetsRef = useRef(snippets)
  useEffect(() => { snippetsRef.current = snippets }, [snippets])
  const aiEnabled = useServerAiStatus(user)

  const {
    activeCollection,
    activeCollectionId,
    collections,
    createCollection,
    deleteCollection,
    loadCollections,
    moveNoteToCollection,
    refreshCollections,
    renameCollection,
    setActiveCollectionId,
  } = useCollectionCatalog({
    notesRef,
    resetWorkspace,
    setNotes,
    showSinglePaneForNote,
    user,
  })

  const collectionNotes = useMemo(
    () => !activeCollectionId || activeCollectionId === ALL_COLLECTION_ID
      ? notes
      : notes.filter(note => note.collectionId === activeCollectionId),
    [activeCollectionId, notes]
  )
  const collectionNotesRef = useRef(collectionNotes)
  useEffect(() => { collectionNotesRef.current = collectionNotes }, [collectionNotes])

  const searchCollectionId = activeCollectionId === ALL_COLLECTION_ID ? null : activeCollectionId
  const defaultCollectionId = collections.find(collection => collection.isDefault)?.id ?? 'default'
  const writableCollectionId = activeCollectionId && activeCollectionId !== ALL_COLLECTION_ID
    ? activeCollectionId
    : defaultCollectionId

  const { searchInput, searchResults, isSearching, handleSearch, clearSearch, searchMode, toggleSearchMode, searchQuery } = useNoteSearch(collectionNotesRef, user, searchCollectionId)
  const { isDragging, handleDragEnter, handleDragLeave, handleDragOver, handleDrop } = useNoteDropImport({
    activeCollectionId: writableCollectionId,
    clearSearch,
    maxFileSize: MAX_FILE_SIZE,
    setActiveNoteId,
    setNotes,
  })
  const { addNote, createSnippet, deleteAllNotes, deleteNote, deleteSnippet, seedNotes, updateNote, updateSnippet } = useNoteMutations({
    notesRef,
    resetWorkspace,
    removeNoteFromWorkspace,
    setNotes,
    setSnippets,
    user,
    activeCollectionId,
    newNoteCollectionId: writableCollectionId,
  })

  useAppLifecycle({
    dbReady,
    notesRef,
    setDbReady,
    setNotes,
    setSnippets,
    settings,
    showSinglePaneForNote,
    snippetsRef,
    user,
    loadCollections,
    refreshCollections,
  })

  const createNote = useCallback(() => {
    const note = addNote(createEmptyNote({ collectionId: writableCollectionId }))
    showSinglePaneForNote(note.id)
    recordLocation({ noteId: note.id }, { replaceCurrent: false })
    setEditorFocusNonce(n => n + 1)
    clearSearch()
  }, [addNote, clearSearch, recordLocation, showSinglePaneForNote, writableCollectionId])

  const createNoteFromContent = useCallback((content) => {
    const note = createEmptyNote({ collectionId: writableCollectionId })
    note.content = content
    note.updatedAt = Date.now()
    const created = addNote(note)
    showSinglePaneForNote(created.id)
    recordLocation({ noteId: created.id }, { replaceCurrent: false })
    setEditorFocusNonce(n => n + 1)
    clearSearch()
  }, [addNote, clearSearch, recordLocation, showSinglePaneForNote, writableCollectionId])

  const createTipsNote = useCallback((content) => {
    localStorage.setItem(TIPS_CREATED_KEY, 'true')
    setTipsCreated(true)
    createNoteFromContent(content)
  }, [createNoteFromContent])

  const openFileAsNote = useCallback((fileName, content) => {
    const existing = notesRef.current.find(n => n.content.startsWith(fileName + '\n'))
    if (existing) {
      showSinglePaneForNote(existing.id)
      recordLocation({ noteId: existing.id }, { replaceCurrent: false })
      clearSearch()
    } else {
      createNoteFromContent(content)
    }
  }, [clearSearch, createNoteFromContent, notesRef, recordLocation, showSinglePaneForNote])

  useEffect(() => {
    if (!dbReady || createFromUrlHandledRef.current) return
    createFromUrlHandledRef.current = true

    const params = new URLSearchParams(window.location.search)
    const jotParam = params.get('jot')

    if (jotParam) {
      try {
        const b64 = jotParam.replace(/-/g, '+').replace(/_/g, '/')
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        const content = new TextDecoder('utf-8').decode(bytes)
        const fileName = content.split('\n')[0] ?? ''
        openFileAsNote(fileName, content)
      } catch {}
      params.delete('jot')
    } else if (params.get('new') === '1') {
      createNote()
      params.delete('new')
    } else {
      return
    }

    const nextQuery = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`)
  }, [createNote, dbReady, openFileAsNote])

  useEffect(() => {
    if (!dbReady) return
    const es = new EventSource('/api/events')
    es.onmessage = (e) => {
      try {
        const { type, fileName, content } = JSON.parse(e.data)
        if (type === 'open-file' && fileName && content) openFileAsNote(fileName, content)
      } catch {}
    }
    return () => es.close()
  }, [dbReady, openFileAsNote])

  const handleSeedDeveloperNotes = useCallback(() => {
    const seeded = seedNotes(createDeveloperSeedNotes())
    if (!seeded.length) return
    clearSearch()
    showSinglePaneForNote(seeded[0].id)
    recordLocation({ noteId: seeded[0].id }, { replaceCurrent: false })
  }, [clearSearch, recordLocation, seedNotes, showSinglePaneForNote])

  const handleSelectCollection = useCallback((collectionId) => {
    setActiveCollectionId(collectionId)
    clearSearch()
    const firstNote = collectionId === ALL_COLLECTION_ID
      ? notesRef.current[0]
      : notesRef.current.find(note => note.collectionId === collectionId)
    showSinglePaneForNote(firstNote?.id ?? null)
  }, [clearSearch, notesRef, setActiveCollectionId, showSinglePaneForNote])

  const cycleCollection = useCallback((direction) => {
    const selectable = [
      ...(collections.length > 1 ? [{ id: ALL_COLLECTION_ID }] : []),
      ...collections,
    ]
    if (selectable.length < 2) return

    const currentIndex = Math.max(0, selectable.findIndex(collection => collection.id === activeCollectionId))
    const nextIndex = (currentIndex + direction + selectable.length) % selectable.length
    handleSelectCollection(selectable[nextIndex].id)
  }, [activeCollectionId, collections, handleSelectCollection])

  const handleCreateCollection = useCallback(() => {
    const name = window.prompt('Collection name')
    const collection = createCollection(name)
    if (!collection) return
    clearSearch()
    showSinglePaneForNote(null)
  }, [clearSearch, createCollection, showSinglePaneForNote])

  const handleRenameCollection = useCallback(() => {
    if (!activeCollection || activeCollection.isVirtual) return
    const name = window.prompt('Collection name', activeCollection.name)
    if (name === null) return
    renameCollection(activeCollection.id, name)
  }, [activeCollection, renameCollection])

  const handleDeleteCollection = useCallback(() => {
    if (!activeCollection || activeCollection.isDefault || activeCollection.isVirtual) return
    const confirmed = window.confirm(`Delete collection "${activeCollection.name}"? Notes will move to the default collection.`)
    if (!confirmed) return
    deleteCollection(activeCollection.id)
    clearSearch()
  }, [activeCollection, clearSearch, deleteCollection])

  const handleMoveActiveNoteToCollection = useCallback((collectionId) => {
    if (!activeNoteId || !collectionId) return
    moveNoteToCollection(activeNoteId, collectionId)
    if (activeCollectionId !== ALL_COLLECTION_ID && collectionId !== activeCollectionId) {
      const nextNote = notesRef.current.find(note => note.id !== activeNoteId && note.collectionId === activeCollectionId)
      showSinglePaneForNote(nextNote?.id ?? null)
    }
    clearSearch()
  }, [activeCollectionId, activeNoteId, clearSearch, moveNoteToCollection, notesRef, showSinglePaneForNote])

  const handleDropNoteOnCollection = useCallback((e, collectionId) => {
    e.preventDefault()
    e.stopPropagation()
    const noteId = e.dataTransfer.getData('application/x-jotit-note-id') || draggedNoteId
    setDraggedNoteId(null)
    setDragOverCollectionId(null)
    if (!noteId || !collectionId) return

    moveNoteToCollection(noteId, collectionId)
    if (activeCollectionId !== ALL_COLLECTION_ID && collectionId !== activeCollectionId) {
      const nextNote = notesRef.current.find(note => note.id !== noteId && note.collectionId === activeCollectionId)
      showSinglePaneForNote(nextNote?.id ?? null)
    }
    clearSearch()
  }, [activeCollectionId, clearSearch, draggedNoteId, moveNoteToCollection, notesRef, showSinglePaneForNote])

  const handleCollectionDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleCollectionDragLeave = useCallback((e, collectionId) => {
    const nextTarget = e.relatedTarget
    if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) return
    setDragOverCollectionId(current => current === collectionId ? null : current)
  }, [])

  const searchSnippets = useCallback(async (query) => {
    const raw = query.trim()
    if (!raw) return []
    return searchSnippetsLocally(snippetsRef.current, raw)
  }, [])

  const handleSaveSettings = useCallback((nextSettings) => {
    setSettings(nextSettings)
    saveSettings(nextSettings)
    setShowSettings(false)
  }, [])

  const handleRegenerateKeys = useCallback(async (password) => {
    const token = localStorage.getItem('jotit_auth_token')
    if (!token) throw new Error('Not logged in')
    const keyPair = await generateAndStoreKeyPair()
    const publicKeyJwk = await exportPublicKeyJwk(keyPair.publicKey)
    const encryptedPrivateKey = await wrapPrivateKey(keyPair.privateKey, password)
    const res = await fetch('/api/auth/public-key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ publicKey: publicKeyJwk, encryptedPrivateKey }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to upload keys')
  }, [])

  const handlePublish = useCallback(async (bucketName) => {
    const publicNotes = notesRef.current.filter(note => note.isPublic)
    try {
      const res = await fetch('/api/bucket/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketName, notes: publicNotes }),
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? 'Publish failed' }
      return { ok: true, count: data.count, url: data.url }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [])

  const handlePublishNote = useCallback(async (note, viewMode) => {
    try {
      let content = note.content ?? ''

      const markerRegex = /\[img:\/\/([^\]]+)\]/g
      const markerIds = [...content.matchAll(markerRegex)].map(m => m[1])

      if (markerIds.length > 0) {
        const attachments = getAttachmentsForNote(note.id)
        const attachMap = Object.fromEntries(attachments.map(a => [a.id, a]))

        const totalBytes = attachments
          .filter(a => markerIds.includes(a.id))
          .reduce((sum, a) => sum + (a.data?.length ?? 0), 0)

        if (totalBytes > 5 * 1024 * 1024) {
          const mb = (totalBytes / (1024 * 1024)).toFixed(1)
          return { error: `Images are too large to share (${mb} MB). Limit is 5 MB total.` }
        }

        content = content.replace(markerRegex, (_, id) => {
          const att = attachMap[id]
          return att ? `![](${att.data})` : ''
        })
      }

      const res = await fetch('/api/public-note/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: { ...note, content, viewMode: viewMode ?? null } }),
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? 'Publish failed' }
      return { ok: true, url: data.url, slug: data.slug }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [])

  const handleListSharedLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/public-notes')
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? 'Failed to load shared links' }
      return { ok: true, links: data.links ?? [] }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [])

  const handleDeleteSharedLink = useCallback(async (slug) => {
    try {
      const res = await fetch(`/api/public-note/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? 'Failed to remove shared link' }
      return { ok: true, slug: data.slug ?? slug }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [])

  const toggleNotesPane = useCallback(() => {
    setNotesPaneHidden(hidden => {
      if (!hidden) setNotePeekOpen(false)
      return !hidden
    })
  }, [])

  const toggleSimpleEditorMode = useCallback(() => {
    setSimpleEditorMode(enabled => {
      if (!enabled) setNotePeekOpen(false)
      return !enabled
    })
  }, [])

  const toggleCommandToolbars = useCallback(() => {
    setCommandToolbarsHidden(hidden => !hidden)
  }, [])

  useEffect(() => {
    localStorage.setItem(COMMAND_TOOLBARS_HIDDEN_KEY, commandToolbarsHidden ? 'true' : 'false')
  }, [commandToolbarsHidden])

  useEffect(() => {
    const handler = (e) => {
      const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName)
      const isBackslashShortcut = (e.ctrlKey || e.metaKey) && (e.code === 'Backslash' || e.key === '\\' || e.key === '|')
      if (e.altKey && e.key === 'n') { e.preventDefault(); createNote() }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowUp') { e.preventDefault(); cycleCollection(-1) }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); cycleCollection(1) }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigateLocationHistory(-1) }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navigateLocationHistory(1) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchRef.current?.focus() }
      if (isBackslashShortcut && e.shiftKey) { e.preventDefault(); toggleSimpleEditorMode() }
      else if (isBackslashShortcut && e.altKey) { e.preventDefault(); toggleCommandToolbars() }
      else if (isBackslashShortcut) { e.preventDefault(); toggleNotesPane() }
      if (e.key === 'Escape') { clearSearch(); setShowSettings(false); setShowHelp(false); setShowSnippets(false); setShowSharedLinks(false) }
      if (e.key === '?' && !inInput) { e.preventDefault(); setShowHelp(h => !h) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clearSearch, createNote, cycleCollection, navigateLocationHistory, toggleNotesPane, toggleSimpleEditorMode, toggleCommandToolbars])

  const displayedNotes = useMemo(() => searchResults?.map(result => result.note) ?? collectionNotes, [collectionNotes, searchResults])
  const searchMatches = useMemo(
    () => (searchResults ? new Map(searchResults.map(result => [result.noteId, result])) : null),
    [searchResults]
  )
  const openPanes = editorPanes
    .map(pane => ({ ...pane, note: notes.find(note => note.id === pane.noteId) }))
    .filter(pane => pane.note)
  const publicNoteCount = notes.filter(note => note.isPublic).length
  const canGoBack = locationHistoryIndex > 0
  const canGoForward = locationHistoryIndex >= 0 && locationHistoryIndex < locationHistory.length - 1
  const shouldShowNotesPane = !notesPaneHidden && !simpleEditorMode

  if (!dbReady) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center gap-3 text-zinc-600">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" />
        </svg>
        <span className="text-sm font-mono">loading database...</span>
      </div>
    )
  }

  return (
    <div
      className="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden relative"
      onDragEnter={e => {
        if (draggedNoteId) return
        handleDragEnter(e)
      }}
      onDragLeave={e => {
        if (draggedNoteId) return
        handleDragLeave(e)
      }}
      onDragOver={e => {
        if (draggedNoteId) return
        handleDragOver(e)
      }}
      onDrop={e => {
        if (draggedNoteId) return
        handleDrop(e)
      }}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-2 rounded-xl border-2 border-dashed border-blue-500 bg-zinc-950/90" />
          <div className="relative text-center space-y-3">
            <div className="text-5xl">??</div>
            <p className="text-blue-400 text-base font-medium">Drop files to import</p>
            <p className="text-zinc-500 text-sm">CSV imports each row as a note · SQLite opens in viewer mode · other files become a single note · 5 MB max</p>
          </div>
        </div>
      )}
      {!simpleEditorMode && (
      <header className="relative z-50 flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base font-bold tracking-tight text-zinc-100">jot.it</span>
          <span className="text-[11px] text-zinc-600 font-mono tabular-nums">{collectionNotes.length}</span>
        </div>

        <div className="relative flex items-center gap-1 shrink-0">
          <select
            value={activeCollectionId ?? ''}
            onChange={e => handleSelectCollection(e.target.value)}
            title="Collection"
            className="h-7 max-w-[180px] bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2 outline-none focus:border-blue-700"
          >
            {collections.length > 1 && <option value={ALL_COLLECTION_ID}>All notes</option>}
            {collections.map(collection => (
              <option key={collection.id} value={collection.id}>{collection.name}</option>
            ))}
          </select>
          <button
            onClick={handleCreateCollection}
            title="New collection"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
          >
            +
          </button>
          <button
            onClick={handleRenameCollection}
            disabled={!activeCollection || activeCollection.isVirtual}
            title="Rename collection"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors disabled:text-zinc-800 disabled:hover:bg-transparent"
          >
            <svg className="w-3.5 h-3.5 mx-auto" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793z" />
              <path d="M11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          </button>
          <button
            onClick={handleDeleteCollection}
            disabled={!activeCollection || activeCollection.isDefault || activeCollection.isVirtual}
            title="Delete collection"
            className="h-7 w-7 text-zinc-500 hover:text-red-300 hover:bg-zinc-800 rounded-md transition-colors disabled:text-zinc-800 disabled:hover:bg-transparent"
          >
            <svg className="w-3.5 h-3.5 mx-auto" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.75 1A1.75 1.75 0 007 2.75V3H4.75a.75.75 0 000 1.5h10.5a.75.75 0 000-1.5H13v-.25A1.75 1.75 0 0011.25 1h-2.5zM8.5 3v-.25a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25V3h-3zM6 6a.75.75 0 01.75.75v8.5a.75.75 0 001.5 0v-8.5A.75.75 0 016 6zm4 .75a.75.75 0 00-1.5 0v8.5a.75.75 0 001.5 0v-8.5zm2.75-.75a.75.75 0 00-.75.75v8.5a.75.75 0 001.5 0v-8.5a.75.75 0 00-.75-.75z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="flex-1 max-w-sm">
          <SearchBar value={searchInput} onChange={handleSearch} isSearching={isSearching} aiEnabled={aiEnabled} inputRef={searchRef} searchMode={searchMode} onToggleMode={toggleSearchMode} />
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {searchResults !== null && (
            <span className="text-[11px] text-zinc-500">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </span>
          )}
          <div className={`flex items-center gap-1 text-[11px] ${aiEnabled ? 'text-green-500' : 'text-zinc-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${aiEnabled ? 'bg-green-500' : 'bg-zinc-700'}`} />
            <span>AI</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={toggleNotesPane}
              title={`${notesPaneHidden ? 'Show' : 'Hide'} notes pane (Ctrl+\\)`}
              aria-pressed={notesPaneHidden}
              className={`p-1.5 rounded-md transition-colors ${
                notesPaneHidden
                  ? 'text-blue-300 bg-blue-950/40 hover:bg-blue-950/70'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm0 2h4v10H4V5zm6 10V5h6v10h-6z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={toggleSimpleEditorMode}
              title="Simple editor mode (Ctrl+Shift+\\)"
              aria-pressed={simpleEditorMode}
              className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M4 4.75A2.75 2.75 0 016.75 2h6.5A2.75 2.75 0 0116 4.75v10.5A2.75 2.75 0 0113.25 18h-6.5A2.75 2.75 0 014 15.25V4.75zM6.75 4a.75.75 0 00-.75.75v10.5c0 .414.336.75.75.75h6.5a.75.75 0 00.75-.75V4.75a.75.75 0 00-.75-.75h-6.5z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={toggleCommandToolbars}
              title={`${commandToolbarsHidden ? 'Show' : 'Hide'} command toolbars (Ctrl+Alt+\\)`}
              aria-pressed={commandToolbarsHidden}
              className={`p-1.5 rounded-md transition-colors ${
                commandToolbarsHidden
                  ? 'text-blue-300 bg-blue-950/40 hover:bg-blue-950/70'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3 5.75A.75.75 0 013.75 5h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 5.75zM3 10a.75.75 0 01.75-.75h8.5a.75.75 0 010 1.5h-8.5A.75.75 0 013 10zM3.75 13.5a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5H3.75z" />
              </svg>
            </button>
            <button
              onClick={() => navigateLocationHistory(-1)}
              disabled={!canGoBack}
              title="Back through note locations (Alt+Left)"
              className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors disabled:text-zinc-800 disabled:hover:bg-transparent disabled:cursor-default"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.78 4.22a.75.75 0 010 1.06L8.06 10l4.72 4.72a.75.75 0 11-1.06 1.06l-5.25-5.25a.75.75 0 010-1.06l5.25-5.25a.75.75 0 011.06 0z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => navigateLocationHistory(1)}
              disabled={!canGoForward}
              title="Forward through note locations (Alt+Right)"
              className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors disabled:text-zinc-800 disabled:hover:bg-transparent disabled:cursor-default"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.22 4.22a.75.75 0 011.06 0l5.25 5.25a.75.75 0 010 1.06l-5.25 5.25a.75.75 0 11-1.06-1.06L11.94 10 7.22 5.28a.75.75 0 010-1.06z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <button
            onClick={createNote}
            title="New note (Alt+N)"
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors"
          >
            + New
          </button>
          {activeNoteId && collections.length > 1 && (
            <select
              value=""
              onChange={e => {
                handleMoveActiveNoteToCollection(e.target.value)
                e.target.value = ''
              }}
              title="Move current note to collection"
              className="h-7 max-w-[130px] bg-zinc-950 border border-zinc-800 text-zinc-400 text-xs rounded-md px-2 outline-none focus:border-blue-700"
            >
              <option value="" disabled>Move to...</option>
              {collections
                .filter(collection => collection.id !== writableCollectionId)
                .map(collection => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
            </select>
          )}
          <button
            onClick={() => setShowSnippets(true)}
            title="Manage snippets"
            className="px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded-md transition-colors"
          >
            Snippets
          </button>
          <button
            onClick={() => setShowSharedLinks(true)}
            title="Manage shared links"
            className="px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded-md transition-colors"
          >
            Links
          </button>
          <button
            onClick={() => setShowHelp(true)}
            title="Hotkeys & commands (?)"
            className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors font-mono text-sm leading-none"
          >
            ?
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
          {user ? (
            <>
              <div className="w-px h-4 bg-zinc-800" />
              <span className="text-[11px] text-zinc-600 hidden sm:inline truncate max-w-[120px]" title={user.email}>
                {user.email}
              </span>
              <button
                onClick={logout}
                title="Sign out"
                className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h7a1 1 0 000-2H4V5h6a1 1 0 000-2H3zm11.293 4.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L15.586 12H9a1 1 0 010-2h6.586l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded-md transition-colors"
            >
              Sign in
            </button>
          )}
        </div>
      </header>
      )}

      {draggedNoteId && collections.length > 1 && (
        <div
          className="fixed top-16 z-[100] w-[360px] rounded-md border border-blue-800/70 bg-zinc-950 shadow-2xl shadow-black/70 p-2"
          style={{ left: shouldShowNotesPane ? 432 : 16 }}
          onDragEnter={handleCollectionDragOver}
          onDragOver={handleCollectionDragOver}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div className="px-2 pb-2 text-[10px] uppercase tracking-wide text-blue-300">Drop note into collection</div>
          <div className="space-y-2">
            {collections.map(collection => {
              const isCurrent = collection.id === notes.find(note => note.id === draggedNoteId)?.collectionId
              const noteCount = notes.filter(note => note.collectionId === collection.id).length
              return (
                <div
                  key={collection.id}
                  role="button"
                  tabIndex={0}
                  data-collection-drop-target={collection.id}
                  onDragEnter={(e) => {
                    handleCollectionDragOver(e)
                    if (!isCurrent) setDragOverCollectionId(collection.id)
                  }}
                  onDragOver={(e) => {
                    handleCollectionDragOver(e)
                    if (!isCurrent) setDragOverCollectionId(collection.id)
                  }}
                  onDragLeave={e => handleCollectionDragLeave(e, collection.id)}
                  onDrop={e => {
                    if (!isCurrent) handleDropNoteOnCollection(e, collection.id)
                    else {
                      e.preventDefault()
                      e.stopPropagation()
                      setDraggedNoteId(null)
                      setDragOverCollectionId(null)
                    }
                  }}
                  className={[
                    'w-full min-h-[96px] flex flex-col justify-between gap-3 rounded-md px-3.5 py-3 text-left border transition-colors',
                    isCurrent
                      ? 'border-zinc-800 text-zinc-600 bg-zinc-950 cursor-default'
                      : dragOverCollectionId === collection.id
                        ? 'border-blue-400 text-white bg-blue-900/70 ring-1 ring-blue-300/50'
                      : 'border-zinc-700 text-zinc-200 bg-zinc-900 hover:border-blue-500 hover:bg-blue-950/50',
                  ].join(' ')}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{collection.name}</div>
                    <div className="mt-1 text-[11px] text-zinc-500 line-clamp-2">
                      {collection.description || (isCurrent ? 'This note is already here' : 'Move the dragged note here')}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-600">
                    <span>{noteCount} note{noteCount === 1 ? '' : 's'}</span>
                    <span>{isCurrent ? 'current' : collection.isDefault ? 'default' : 'drop target'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {shouldShowNotesPane && (
          <NoteGrid
            notes={displayedNotes}
            activeNoteId={activeNoteId}
            onSelectNote={(id, options = {}) => {
              if (diffLoaderRef.current) {
                const note = notes.find(item => item.id === id)
                if (note) diffLoaderRef.current(note)
              } else {
                openNoteInPane(id, options)
              }
            }}
            searchMatches={searchMatches}
            searchQuery={searchQuery}
            diffActive={diffActive}
            isPeekOpen={notePeekOpen}
            onPeekOpenChange={setNotePeekOpen}
            onNoteDragStart={(noteId) => {
              setDraggedNoteId(noteId)
              setDragOverCollectionId(null)
            }}
            onNoteDragEnd={() => {
              setDraggedNoteId(null)
              setDragOverCollectionId(null)
            }}
          />
        )}
        {openPanes.length ? (
          <div className="flex flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
            {openPanes.map(({ id: paneId, note }, index) => (
              <div
                key={paneId}
                onMouseDown={() => {
                  setActivePaneId(paneId)
                  setActiveNoteId(note.id)
                }}
                className={[
                  'flex flex-col min-w-[520px] flex-1 border-r border-zinc-800 last:border-r-0',
                  activePaneId === paneId ? 'bg-zinc-950' : 'bg-zinc-950/80',
                ].join(' ')}
              >
                {!simpleEditorMode && (
                  <div className={`flex items-center gap-2 px-3 py-1.5 border-b shrink-0 ${
                    activePaneId === paneId ? 'border-blue-900/70 bg-blue-950/20' : 'border-zinc-800 bg-zinc-900/40'
                  }`}>
                    <span className="text-[10px] text-zinc-600 font-mono shrink-0">pane {index + 1}</span>
                    <span className="text-[11px] text-zinc-400 truncate min-w-0">
                      {getNoteTitle(note)}
                    </span>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => closeEditorPane(paneId)}
                      title="Close pane"
                      className="ml-auto text-zinc-600 hover:text-zinc-300 transition-colors text-sm leading-none shrink-0"
                    >
                      x
                    </button>
                  </div>
                )}
                <NotePanel
                  key={`${paneId}:${note.id}`}
                  note={note}
                  snippets={snippets}
                  aiEnabled={aiEnabled}
                  user={user}
                  onRequireAuth={() => setShowAuth(true)}
                  onUpdate={(updates) => updateNote(note.id, updates)}
                  onDelete={() => deleteNote(note.id)}
                  onCreateSnippet={createSnippet}
                  onSearchSnippets={searchSnippets}
                  onPublishNote={(mode) => handlePublishNote(note, mode)}
                  onCreateNoteFromContent={createNoteFromContent}
                  onCreateTipsNote={createTipsNote}
                  tipsCreated={tipsCreated}
                  focusNonce={activePaneId === paneId ? editorFocusNonce : 0}
                  restoreLocation={restoreLocation?.noteId === note.id ? restoreLocation : null}
                  onLocationChange={recordLocation}
                  notes={notes}
                  searchQuery={searchQuery}
                  simpleEditor={simpleEditorMode}
                  hideCommandToolbars={simpleEditorMode || commandToolbarsHidden}
                  onDiffModeChange={(loader) => {
                    diffLoaderRef.current = loader
                    setDiffActive(!!loader)
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-700">
            <svg className="w-12 h-12 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M9 12h6M9 16h6M9 8h3M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
            </svg>
            <p className="text-sm">No note selected</p>
            <button onClick={createNote} className="text-xs text-blue-500 hover:text-blue-400 underline-offset-2 underline">
              Create one
            </button>
          </div>
        )}
      </div>

      {showSettings && (
        <Settings
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          onDeleteAllNotes={deleteAllNotes}
          onExportDB={exportSQLite}
          onPublish={handlePublish}
          onSeedNotes={handleSeedDeveloperNotes}
          onRegenerateKeys={handleRegenerateKeys}
          publicNoteCount={publicNoteCount}
          noteCount={collectionNotes.length}
          user={user}
        />
      )}
      {showSnippets && (
        <SnippetManager
          snippets={snippets}
          onClose={() => setShowSnippets(false)}
          onDelete={deleteSnippet}
          onRename={(id, name) => updateSnippet(id, { name })}
        />
      )}
      {showSharedLinks && (
        <SharedLinksModal
          onListSharedLinks={handleListSharedLinks}
          onDeleteSharedLink={handleDeleteSharedLink}
          onClose={() => setShowSharedLinks(false)}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showAuth && <AuthScreen onClose={() => setShowAuth(false)} />}
    </div>
  )
}
