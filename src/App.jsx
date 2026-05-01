import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { loadSettings, saveSettings } from './utils/storage'
import { useMemo } from 'react'
import { exportSQLite, getAttachmentsForNote, schedulePersist as scheduleDbPersist, upsertNoteSync, setSyncIncluded, setSyncExcluded, setAllSyncExcluded, pinNote, unpinNote, getAllPins, setNoteKanbanStatus } from './utils/db'
import { scheduleSyncPush, setOnSyncHeld, removeNoteFromServer, removeAllNotesFromServer } from './utils/sync'
import { scanForSecrets, contentHash } from './utils/secretScanner'
import { generateAndStoreKeyPair, exportPublicKeyJwk, wrapPrivateKey } from './utils/e2eEncryption'
import { createEmptyNote, createImportedOpenApiNote } from './utils/noteFactories'
import { ALL_COLLECTION_ID, normalizeCollectionSlug } from './utils/collectionFactories'
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
import { useLLMSettings } from './hooks/useLLMSettings'
import NoteGrid from './components/NoteGrid'
import KanbanBoard from './components/KanbanBoard'
import NotePanel from './components/NotePanel'
import LLMChat from './components/LLMChat'
import SearchBar from './components/SearchBar'
import GlobalSecretAlert from './components/GlobalSecretAlert'
import Settings from './components/Settings'
import NibPromptsModal from './components/NibPromptsModal'
import SharedLinksModal from './components/SharedLinksModal'
import HelpModal from './components/HelpModal'
import AuthScreen from './components/AuthScreen'
import SnippetManager from './components/SnippetManager'
import TemplateManager from './components/TemplateManager'
import { useTemplates } from './hooks/useTemplates'
import { useAuth } from './contexts/AuthContext'
import { usePaneResize } from './hooks/usePaneResize'
import { useMultiPaneResize } from './hooks/useMultiPaneResize'
import { useGlobalKeyboardShortcuts } from './hooks/useGlobalKeyboardShortcuts'
import { useSecretScan } from './hooks/useSecretScan'
import PaneResizer from './components/PaneResizer'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const COMMAND_TOOLBARS_HIDDEN_KEY = 'jotit_command_toolbars_hidden'
const NOTE_LIST_METADATA_HIDDEN_KEY = 'jotit_note_list_metadata_hidden'
const NOTE_LIST_ONE_LINE_KEY = 'jotit_note_list_one_line'
const TIPS_CREATED_KEY = 'jotit_tips_created'
const NOTEGRID_WIDTH_KEY = 'jotit_notegrid_width'
const NOTEGRID_DEFAULT_WIDTH = 420
const NOTEGRID_MIN_WIDTH = 160
const NOTEGRID_MAX_WIDTH = 720
const DEFAULT_PANE_WIDTH = 600
const MIN_PANE_WIDTH = 280

export default function App() {
  const { user, loading: authLoading, logout, refreshUser, bucketName } = useAuth()

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

  return <AppShell user={user} logout={logout} refreshUser={refreshUser} bucketName={bucketName} />
}

function AppShell({ user, logout, refreshUser, bucketName }) {
  const [dbReady, setDbReady] = useState(false)
  const [notes, setNotes] = useState([])
  const [snippets, setSnippets] = useState([])
  const [pins, setPins] = useState(() => new Map())
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const { llmEnabled, llmProvider, ollamaModel, remoteModel, remoteApiKey } = useLLMSettings()

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme ?? 'dark'
  }, [settings.theme])

  useEffect(() => {
    if (!dbReady) return
    const map = new Map()
    for (const { noteId, collectionId } of getAllPins()) {
      if (!map.has(collectionId)) map.set(collectionId, new Set())
      map.get(collectionId).add(noteId)
    }
    setPins(map)
  }, [dbReady])
  const [showHelp, setShowHelp] = useState(false)
  const [showSnippets, setShowSnippets] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSharedLinks, setShowSharedLinks] = useState(false)
  const [showNibPrompts, setShowNibPrompts] = useState(false)
  const searchRef = useRef(null)
  const diffLoaderRef = useRef(null)
  const [diffActive, setDiffActive] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [notePeekOpen, setNotePeekOpen] = useState(false)
  const [notesPaneHidden, setNotesPaneHidden] = useState(false)
  const [simpleEditorMode, setSimpleEditorMode] = useState(false)

  const { size: noteGridWidth, startDrag: startNoteGridResize } = usePaneResize(
    NOTEGRID_WIDTH_KEY, NOTEGRID_DEFAULT_WIDTH, NOTEGRID_MIN_WIDTH, NOTEGRID_MAX_WIDTH,
  )
  const { paneWidths, startPaneResize, prunePaneWidths } = useMultiPaneResize(DEFAULT_PANE_WIDTH, MIN_PANE_WIDTH)

  const [commandToolbarsHidden, setCommandToolbarsHidden] = useState(() => (
    localStorage.getItem(COMMAND_TOOLBARS_HIDDEN_KEY) !== 'false'
  ))
  const [noteListMetadataHidden, setNoteListMetadataHidden] = useState(() => (
    localStorage.getItem(NOTE_LIST_METADATA_HIDDEN_KEY) === 'true'
  ))
  const [noteListOneLine, setNoteListOneLine] = useState(() => (
    localStorage.getItem(NOTE_LIST_ONE_LINE_KEY) === 'true'
  ))
  const [tipsCreated, setTipsCreated] = useState(() => localStorage.getItem(TIPS_CREATED_KEY) === 'true')
  const [editorFocusNonce, setEditorFocusNonce] = useState(0)
  const [draggedNoteId, setDraggedNoteId] = useState(null)
  const [syncHeldIds, setSyncHeldIds] = useState([])
  const [publishSecretGate, setPublishSecretGate] = useState(null) // { note, viewMode, matches }
  const [selectedShareNoteIds, setSelectedShareNoteIds] = useState(() => new Set())
  const [shareSelectedState, setShareSelectedState] = useState(null)
  const [sharingSelected, setSharingSelected] = useState(false)
  const [nibLiveContext, setNibLiveContext] = useState({
    noteId: null,
    selectionText: '',
    selectionRange: { start: 0, end: 0 },
  })
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
    openNibPane,
    openKanbanPane,
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
    setCollectionPublic,
    updateCollectionKanbanColumns,
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

  const pinnedIds = useMemo(
    () => activeCollectionId && activeCollectionId !== ALL_COLLECTION_ID
      ? (pins.get(activeCollectionId) ?? new Set())
      : new Set(),
    [activeCollectionId, pins]
  )

  const sortedCollectionNotes = useMemo(() => {
    if (!pinnedIds.size) return collectionNotes
    const pinned = collectionNotes.filter(n => pinnedIds.has(n.id))
    const unpinned = collectionNotes.filter(n => !pinnedIds.has(n.id))
    return [...pinned, ...unpinned]
  }, [collectionNotes, pinnedIds])

  const handleTogglePin = useCallback((noteId, collectionId) => {
    const isPinned = pins.get(collectionId)?.has(noteId)
    if (isPinned) {
      unpinNote(noteId, collectionId)
      setPins(prev => {
        const next = new Map(prev)
        const set = new Set(next.get(collectionId))
        set.delete(noteId)
        if (set.size) next.set(collectionId, set)
        else next.delete(collectionId)
        return next
      })
    } else {
      pinNote(noteId, collectionId)
      setPins(prev => {
        const next = new Map(prev)
        const set = new Set(next.get(collectionId) ?? [])
        set.add(noteId)
        next.set(collectionId, set)
        return next
      })
    }
    scheduleDbPersist()
  }, [pins])

  const collectionNotesRef = useRef(collectionNotes)
  useEffect(() => { collectionNotesRef.current = collectionNotes }, [collectionNotes])

  const searchCollectionId = activeCollectionId === ALL_COLLECTION_ID ? null : activeCollectionId
  const defaultCollectionId = collections.find(collection => collection.isDefault)?.id ?? 'default'
  const writableCollectionId = activeCollectionId && activeCollectionId !== ALL_COLLECTION_ID
    ? activeCollectionId
    : defaultCollectionId

  const {
    searchInput,
    searchResults,
    isSearching,
    isNibSearching,
    improveWithNib,
    nibSearchApplied,
    handleSearch,
    clearSearch,
    filterByIds,
    clearIdFilter,
    idFilter,
    searchMode,
    toggleSearchMode,
    searchQuery,
  } = useNoteSearch(collectionNotesRef, user, searchCollectionId, {
    llmEnabled,
    llmProvider,
    agentToken: settings.localAgentToken ?? '',
    ollamaModel: llmProvider === 'ollama' ? ollamaModel : remoteModel,
  }, notesRef)
  const { flaggedNoteIds, flaggedCount } = useSecretScan(notes, {
    secretScanEnabled: settings.secretScanEnabled ?? false,
  })
  useEffect(() => {
    if (!idFilter) return
    const nextIds = [...idFilter].filter(id => flaggedNoteIds.has(id))
    if (nextIds.length === idFilter.size) return
    if (nextIds.length) filterByIds(nextIds)
    else clearIdFilter()
  }, [clearIdFilter, filterByIds, flaggedNoteIds, idFilter])
  const { isDragging, handleDragEnter, handleDragLeave, handleDragOver, handleDrop } = useNoteDropImport({
    activeCollectionId: writableCollectionId,
    clearSearch,
    maxFileSize: MAX_FILE_SIZE,
    setActiveNoteId,
    setNotes,
  })
  const { templates, userTemplates, saveTemplate, deleteTemplate } = useTemplates({ dbReady })

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
    if (settings.newNoteKeepsPanes) {
      openNoteInPane(note.id, { newPane: true })
    } else {
      showSinglePaneForNote(note.id)
    }
    recordLocation({ noteId: note.id }, { replaceCurrent: false })
    setEditorFocusNonce(n => n + 1)
    clearSearch()
  }, [addNote, clearSearch, openNoteInPane, recordLocation, settings.newNoteKeepsPanes, showSinglePaneForNote, writableCollectionId])

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

  const createNotesSilently = useCallback((contentArray) => {
    for (const noteContent of contentArray) {
      const note = createEmptyNote({ collectionId: writableCollectionId })
      note.content = noteContent
      note.updatedAt = Date.now()
      addNote(note)
    }
  }, [addNote, writableCollectionId])

  const createNoteFromContentInNewPane = useCallback((content) => {
    const note = createEmptyNote({ collectionId: writableCollectionId })
    note.content = content
    note.updatedAt = Date.now()
    const created = addNote(note)
    openNoteInPane(created.id, { newPane: true })
    setEditorFocusNonce(n => n + 1)
    clearSearch()
    return created
  }, [addNote, clearSearch, openNoteInPane, writableCollectionId])

  const createOpenApiNote = useCallback((fileName, document) => {
    const note = createImportedOpenApiNote(fileName, document)
    note.collectionId = writableCollectionId
    const created = addNote(note)
    showSinglePaneForNote(created.id)
    recordLocation({ noteId: created.id }, { replaceCurrent: false })
    clearSearch()
    return created
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

  const handleSaveNibPrompts = useCallback((nibPrompts) => {
    const nextSettings = { ...settings, nibPrompts }
    setSettings(nextSettings)
    saveSettings(nextSettings)
    setShowNibPrompts(false)
  }, [settings])

  const saveLocalAiConfig = useCallback((config) => {
    const nextSettings = {
      ...settings,
      embeddingProvider: config.embeddingProvider ?? settings.embeddingProvider ?? 'openai',
      ollamaEmbedModel: config.ollamaEmbedModel?.trim() || settings.ollamaEmbedModel || 'nomic-embed-text',
    }
    setSettings(nextSettings)
    saveSettings(nextSettings)
    return nextSettings
  }, [settings])

  const handleToggleNoteSync = useCallback((noteId, included) => {
    setSyncIncluded(noteId, included)
    scheduleDbPersist()
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, syncIncluded: included } : n))
  }, [])

  const handleKanbanStatusChange = useCallback((noteId, status) => {
    setNoteKanbanStatus(noteId, status)
    scheduleDbPersist()
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, kanbanStatus: status } : n))
  }, [])

  const handleRemoveNoteFromServer = useCallback(async (noteId) => {
    const result = await removeNoteFromServer(noteId)
    if (result?.ok) {
      setSyncExcluded(noteId)
      scheduleDbPersist()
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, syncExcluded: true, dirty: 0 } : n))
    }
    return result
  }, [])

  const handleRemoveAllNotesFromServer = useCallback(async () => {
    const ids = notesRef.current.map(n => n.id)
    const result = await removeAllNotesFromServer(ids)
    if (result?.ok) {
      setAllSyncExcluded()
      scheduleDbPersist()
      setNotes(prev => prev.map(n => ({ ...n, syncExcluded: true, dirty: 0 })))
    }
    return result
  }, [])

  const handleLoadBucketInfo = useCallback(async () => {
    const token = localStorage.getItem('jotit_auth_token')
    if (!token) return { ok: true, bucketName: '', publicCollections: [], publicNotes: [] }

    try {
      const res = await fetch('/api/bucket/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error ?? 'Failed to load bucket info' }
      await refreshUser().catch(() => {})
      return {
        ok: true,
        bucketName: data.bucketName ?? '',
        publicCollections: data.publicCollections ?? [],
        publicNotes: data.publicNotes ?? [],
      }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [refreshUser])

  const handleSaveBucketName = useCallback(async (nextBucketName) => {
    const token = localStorage.getItem('jotit_auth_token')
    if (!token) return { error: 'Sign in required' }

    try {
      const res = await fetch('/api/bucket/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bucketName: nextBucketName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error ?? 'Failed to save bucket name' }
      await refreshUser().catch(() => {})
      return { ok: true, bucketName: data.bucketName ?? nextBucketName }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [refreshUser])

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

  const handleLoadAiConfig = useCallback(async () => {
    if (!user) {
      return {
        embeddingProvider: settings.embeddingProvider ?? 'openai',
        ollamaEmbedModel: settings.ollamaEmbedModel ?? 'nomic-embed-text',
      }
    }

    try {
      const res = await fetch('/api/ai/config')
      if (!res.ok) {
        return {
          embeddingProvider: settings.embeddingProvider ?? 'openai',
          ollamaEmbedModel: settings.ollamaEmbedModel ?? 'nomic-embed-text',
        }
      }
      const config = await res.json()
      return {
        embeddingProvider: config.embeddingProvider ?? settings.embeddingProvider ?? 'openai',
        ollamaEmbedModel: config.ollamaEmbedModel ?? settings.ollamaEmbedModel ?? 'nomic-embed-text',
      }
    } catch {
      return {
        embeddingProvider: settings.embeddingProvider ?? 'openai',
        ollamaEmbedModel: settings.ollamaEmbedModel ?? 'nomic-embed-text',
      }
    }
  }, [settings.embeddingProvider, settings.ollamaEmbedModel, user])

  const handleSaveAiConfig = useCallback(async (config) => {
    const nextSettings = saveLocalAiConfig(config)
    if (!user) return { ok: true, embeddingProvider: nextSettings.embeddingProvider, ollamaEmbedModel: nextSettings.ollamaEmbedModel }

    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error ?? 'Failed to save AI config' }
      return { ok: true, ...data }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [saveLocalAiConfig, user])

  const handleSetCollectionVisibility = useCallback(async (collection, isPublic) => {
    if (!user) {
      setShowAuth(true)
      return { error: 'Sign in required' }
    }
    if (!collection?.id || collection.isVirtual) return { error: 'Select a collection first' }

    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(collection.id)}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('jotit_auth_token')}` },
        body: JSON.stringify({ isPublic }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error ?? 'Failed to update collection visibility' }
      setCollectionPublic(collection.id, isPublic)
      await refreshUser().catch(() => {})
      return { ok: true, collection: data.collection ?? null }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [refreshUser, setCollectionPublic, user])

  const handleSetNoteCollectionVisibility = useCallback(async (note, collectionExcluded) => {
    if (!user) {
      setShowAuth(true)
      return { error: 'Sign in required' }
    }
    if (!note?.id) return { error: 'Note not found' }

    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}/collection-visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('jotit_auth_token')}` },
        body: JSON.stringify({ collectionExcluded }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error ?? 'Failed to update note visibility' }
      updateNote(note.id, { collectionExcluded })
      return { ok: true, note: data.note ?? null }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [updateNote, user])

  const prepareNoteForPublicShare = useCallback((note, viewMode = null) => {
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

    return { note: { ...note, content, viewMode: viewMode ?? null } }
  }, [])

  const handlePublishNote = useCallback(async (note, viewMode) => {
    if (settings.secretScanEnabled) {
      const c = note.content ?? ''
      const matches = scanForSecrets(c)
      const isCleared = note.secretsClearedHash && note.secretsClearedHash === contentHash(c)
      if (matches.length && !isCleared) {
        setPublishSecretGate({ note, viewMode, matches })
        return { secretGated: true }
      }
    }

    try {
      const prepared = prepareNoteForPublicShare(note, viewMode)
      if (prepared.error) return { error: prepared.error }

      const res = await fetch('/api/public-note/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: prepared.note }),
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? 'Publish failed' }
      return { ok: true, url: data.url, slug: data.slug }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [prepareNoteForPublicShare, settings])

  const selectedShareNotes = useMemo(
    () => [...selectedShareNoteIds].map(id => notes.find(note => note.id === id)).filter(Boolean),
    [notes, selectedShareNoteIds]
  )

  const handlePublishSelectedNotes = useCallback(async () => {
    if (!user) { setShowAuth(true); return { error: 'Sign in to share notes' } }
    if (selectedShareNotes.length < 2) return { error: 'Select at least two notes to share' }

    if (settings.secretScanEnabled) {
      const blocked = selectedShareNotes.find(note => {
        const c = note.content ?? ''
        const matches = scanForSecrets(c)
        const isCleared = note.secretsClearedHash && note.secretsClearedHash === contentHash(c)
        return matches.length && !isCleared
      })
      if (blocked) return { error: `Clear secrets before sharing "${getNoteTitle(blocked)}"` }
    }

    const prepared = []
    for (const note of selectedShareNotes) {
      const result = prepareNoteForPublicShare(note, null)
      if (result.error) return { error: result.error }
      prepared.push(result.note)
    }

    try {
      const title = selectedShareNotes.length === 2
        ? `${getNoteTitle(selectedShareNotes[0])} + ${getNoteTitle(selectedShareNotes[1])}`
        : `${getNoteTitle(selectedShareNotes[0])} + ${selectedShareNotes.length - 1} notes`
      const res = await fetch('/api/public-note/publish-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, notes: prepared }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error ?? 'Publish failed' }
      return { ok: true, url: data.url, slug: data.slug, noteCount: data.noteCount ?? prepared.length }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [prepareNoteForPublicShare, selectedShareNotes, settings.secretScanEnabled, user])

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

  const handleClearAllBucketNotes = useCallback(async () => {
    const token = localStorage.getItem('jotit_auth_token')
    try {
      const res = await fetch('/api/bucket/me/direct-notes', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error ?? 'Failed to clear bucket notes' }
      setNotes(prev => prev.map(n => n.isPublic ? { ...n, isPublic: false } : n))
      return { ok: true, count: data.count ?? 0 }
    } catch (e) {
      return { error: e.message ?? 'Network error' }
    }
  }, [setNotes])

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

  const toggleNoteListMetadata = useCallback(() => {
    setNoteListMetadataHidden(hidden => !hidden)
  }, [])

  const toggleNoteListOneLine = useCallback(() => {
    setNoteListOneLine(active => !active)
  }, [])

  useEffect(() => {
    localStorage.setItem(COMMAND_TOOLBARS_HIDDEN_KEY, commandToolbarsHidden ? 'true' : 'false')
  }, [commandToolbarsHidden])

  useEffect(() => {
    localStorage.setItem(NOTE_LIST_METADATA_HIDDEN_KEY, noteListMetadataHidden ? 'true' : 'false')
  }, [noteListMetadataHidden])

  useEffect(() => {
    localStorage.setItem(NOTE_LIST_ONE_LINE_KEY, noteListOneLine ? 'true' : 'false')
  }, [noteListOneLine])

  useEffect(() => {
    setOnSyncHeld(ids => setSyncHeldIds(ids))
    return () => setOnSyncHeld(null)
  }, [])

  const displayedNotes = useMemo(() => searchResults?.map(result => result.note) ?? sortedCollectionNotes, [sortedCollectionNotes, searchResults])
  const nibConnected = llmEnabled && (
    llmProvider === 'ollama'
      ? Boolean(ollamaModel)
      : Boolean(remoteApiKey && remoteModel)
  )
  const displayedNoteById = useMemo(
    () => new Map(displayedNotes.map(note => [note.id, note])),
    [displayedNotes]
  )

  const ensureSelectableNoteIsLocal = useCallback((id) => {
    if (notesRef.current.some(note => note.id === id)) return
    const searchNote = displayedNoteById.get(id)
    if (!searchNote) return

    const hydrated = {
      ...searchNote,
      categories: searchNote.categories ?? [],
      collectionId: searchNote.collectionId ?? defaultCollectionId,
      createdAt: searchNote.createdAt ?? Date.now(),
      updatedAt: searchNote.updatedAt ?? Date.now(),
    }
    upsertNoteSync(hydrated, 0)
    scheduleDbPersist()
    setNotes(prev => prev.some(note => note.id === id) ? prev : [hydrated, ...prev])
  }, [defaultCollectionId, displayedNoteById, notesRef, setNotes])

  const toggleShareNoteSelection = useCallback((noteId) => {
    setShareSelectedState(null)
    setSelectedShareNoteIds(prev => {
      const next = new Set(prev)
      if (next.has(noteId)) next.delete(noteId)
      else next.add(noteId)
      return next
    })
  }, [])

  const clearShareNoteSelection = useCallback(() => {
    setShareSelectedState(null)
    setSelectedShareNoteIds(new Set())
  }, [])

  const publishShareNoteSelection = useCallback(async () => {
    if (sharingSelected) return
    setSharingSelected(true)
    setShareSelectedState(null)
    try {
      const result = await handlePublishSelectedNotes()
      if (result?.ok) {
        const absolute = `${window.location.origin}${result.url}`
        try { await navigator.clipboard.writeText(absolute) } catch {}
        setShareSelectedState({ ok: true, url: result.url, copied: true })
      } else {
        setShareSelectedState({ error: result?.error ?? 'Publish failed' })
      }
    } finally {
      setSharingSelected(false)
    }
  }, [handlePublishSelectedNotes, sharingSelected])

  useEffect(() => {
    if (!activeNoteId) return
    setNibLiveContext(prev => (
      prev.noteId === activeNoteId
        ? prev
        : { noteId: activeNoteId, selectionText: '', selectionRange: { start: 0, end: 0 } }
    ))
  }, [activeNoteId])

  const handleNibContextChange = useCallback((context) => {
    setNibLiveContext({
      noteId: context.noteId,
      selectionText: context.selectionText ?? '',
      selectionRange: context.selectionRange ?? { start: 0, end: 0 },
    })
  }, [])

  const cycleNote = useCallback((direction) => {
    if (!displayedNotes.length) return
    const idx = displayedNotes.findIndex(n => n.id === activeNoteId)
    const next = displayedNotes[Math.max(0, Math.min(displayedNotes.length - 1, idx + direction))]
    if (next && next.id !== activeNoteId) {
      ensureSelectableNoteIsLocal(next.id)
      showSinglePaneForNote(next.id)
    }
  }, [activeNoteId, displayedNotes, ensureSelectableNoteIsLocal, showSinglePaneForNote])

  useGlobalKeyboardShortcuts({
    clearSearch,
    createNote,
    cycleCollection,
    cycleNote,
    navigateLocationHistory,
    searchRef,
    setShowHelp,
    setShowSettings,
    setShowSharedLinks,
    setShowSnippets,
    setShowTemplates,
    toggleCommandToolbars,
    toggleNoteListMetadata,
    toggleNotesPane,
    toggleSimpleEditorMode,
  })

  const searchMatches = useMemo(
    () => (searchResults ? new Map(searchResults.map(result => [result.noteId, result])) : null),
    [searchResults]
  )
  const noteById = useMemo(() => {
    const map = new Map(displayedNotes.map(note => [note.id, note]))
    for (const note of notes) map.set(note.id, note)
    return map
  }, [displayedNotes, notes])

  const openPanes = editorPanes
    .map(pane => {
      const type = pane.type ?? 'note'
      const note = type === 'nib'
        ? noteById.get(pane.sourceNoteId)
        : noteById.get(pane.noteId)
      return { ...pane, type, note }
    })
    .filter(pane => pane.type === 'nib' || pane.type === 'kanban' || pane.note)

  const boardView = openPanes.some(p => p.type === 'kanban')

  const openPaneIdStr = openPanes.map(p => p.id).join(',')
  useEffect(() => {
    if (!openPaneIdStr) return
    prunePaneWidths(openPaneIdStr.split(','))
  }, [openPaneIdStr, prunePaneWidths])

  const publicNoteCount = notes.filter(note => note.isPublic).length
  const publicCollectionCount = collections.filter(collection => collection.isPublic).length
  const activeCollectionPublicUrl = activeCollection && !activeCollection.isVirtual && activeCollection.isPublic && bucketName
    ? `/b/${bucketName}/${normalizeCollectionSlug(activeCollection.name)}`
    : ''
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
      className="h-[100dvh] bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden relative"
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
      <header className="relative z-50 flex flex-wrap items-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-2.5 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <span className="text-base font-bold tracking-tight text-zinc-100">jot.it</span>
          <span className="text-[11px] text-zinc-600 font-mono tabular-nums">{collectionNotes.length}</span>
        </div>

        <div className="relative flex items-center gap-1 shrink min-w-0">
          <select
            value={activeCollectionId ?? ''}
            onChange={e => handleSelectCollection(e.target.value)}
            title="Collection"
            className="h-7 max-w-[42vw] md:max-w-[180px] bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-md px-2 outline-none focus:border-blue-700"
          >
            {collections.length > 1 && <option value={ALL_COLLECTION_ID}>All notes</option>}
            {collections.map(collection => (
              <option key={collection.id} value={collection.id}>{collection.isPublic ? `[public] ${collection.name}` : collection.name}</option>
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
          <button
            onClick={async () => {
              const nextPublic = !activeCollection?.isPublic
              const result = await handleSetCollectionVisibility(activeCollection, nextPublic)
              if (result?.error) window.alert(result.error)
            }}
            disabled={!activeCollection || activeCollection.isVirtual}
            title={activeCollection?.isPublic ? 'Make collection private' : 'Make collection public'}
            className={`h-7 px-2.5 text-[11px] rounded-md border transition-colors disabled:text-zinc-800 disabled:border-zinc-900 disabled:hover:bg-transparent ${
              activeCollection?.isPublic
                ? 'text-emerald-300 border-emerald-800 bg-emerald-950/40 hover:bg-emerald-950/60'
                : 'text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {activeCollection?.isPublic ? 'Public' : 'Private'}
          </button>
          {activeCollectionPublicUrl && (
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(`${window.location.origin}${activeCollectionPublicUrl}`) } catch {}
              }}
              title={activeCollectionPublicUrl}
              className="hidden md:inline-flex h-7 items-center px-2.5 text-[11px] rounded-md border border-blue-900/70 text-blue-300 bg-blue-950/30 hover:bg-blue-950/50 transition-colors font-mono"
            >
              {activeCollectionPublicUrl}
            </button>
          )}
        </div>

        <div className="order-3 w-full md:order-none md:flex-1 md:max-w-sm">
          <SearchBar
            value={searchInput}
            onChange={handleSearch}
            isSearching={isSearching}
            aiEnabled={aiEnabled}
            llmEnabled={nibConnected}
            isNibSearching={isNibSearching}
            nibSearchApplied={nibSearchApplied}
            inputRef={searchRef}
            searchMode={searchMode}
            onToggleMode={toggleSearchMode}
            onImproveWithNib={improveWithNib}
          />
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 ml-auto shrink-0 min-w-0">
          <GlobalSecretAlert
            flaggedCount={flaggedCount}
            flaggedNoteIds={flaggedNoteIds}
            idFilter={idFilter}
            onFilterByIds={filterByIds}
            onClearFilter={clearIdFilter}
          />
          {searchResults !== null && (
            <span className="text-[11px] text-zinc-500">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </span>
          )}
          <div
            title={nibConnected ? `Nib connected: ${llmProvider === 'ollama' ? ollamaModel : remoteModel}` : 'Nib provider not connected'}
            className={`flex items-center gap-1 text-[11px] ${nibConnected ? 'text-green-500' : 'text-zinc-700'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${nibConnected ? 'bg-green-500' : 'bg-zinc-700'}`} />
            <span className="hidden sm:inline">Nib</span>
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
            <span className="sm:hidden">+</span><span className="hidden sm:inline">+ New</span>
          </button>
          {activeNoteId && collections.length > 1 && (
            <select
              value=""
              onChange={e => {
                handleMoveActiveNoteToCollection(e.target.value)
                e.target.value = ''
              }}
              title="Move current note to collection"
              className="hidden sm:block h-7 max-w-[130px] bg-zinc-950 border border-zinc-800 text-zinc-400 text-xs rounded-md px-2 outline-none focus:border-blue-700"
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
            className="hidden sm:inline-flex px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded-md transition-colors"
          >
            Snippets
          </button>
          <button
            onClick={() => setShowTemplates(true)}
            title="Manage templates (!command to expand)"
            className="hidden sm:inline-flex px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded-md transition-colors"
          >
            Templates
          </button>
          <button
            onClick={() => setShowSharedLinks(true)}
            title="Manage shared links"
            className="hidden sm:inline-flex px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded-md transition-colors"
          >
            Links
          </button>
          <button
            onClick={() => setShowNibPrompts(true)}
            title="Edit Nib prompts"
            className="hidden sm:inline-flex px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded-md transition-colors"
          >
            Prompts
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

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden relative">
        {shouldShowNotesPane && (
          <NoteGrid
            notes={displayedNotes}
            activeNoteId={activeNoteId}
            style={{ width: noteGridWidth }}
            syncEnabled={user ? (settings.syncEnabled ?? true) : true}
            onToggleNoteSync={user ? handleToggleNoteSync : undefined}
            pinnedIds={pinnedIds}
            onTogglePin={activeCollectionId !== ALL_COLLECTION_ID ? handleTogglePin : undefined}
            selectedShareNoteIds={selectedShareNoteIds}
            onToggleShareSelection={toggleShareNoteSelection}
            onClearShareSelection={clearShareNoteSelection}
            onShareSelected={publishShareNoteSelection}
            shareSelectedState={shareSelectedState}
            sharingSelected={sharingSelected}
            onSelectNote={(id, options = {}) => {
              if (diffLoaderRef.current) {
                const note = notes.find(item => item.id === id)
                if (note) diffLoaderRef.current(note)
              } else {
                ensureSelectableNoteIsLocal(id)
                openNoteInPane(id, options)
              }
            }}
            searchMatches={searchMatches}
            searchQuery={searchQuery}
            diffActive={diffActive}
            isPeekOpen={notePeekOpen}
            onPeekOpenChange={setNotePeekOpen}
            noteMetadataHidden={noteListMetadataHidden}
            onToggleNoteMetadata={toggleNoteListMetadata}
            oneLineMode={noteListOneLine}
            onToggleOneLineMode={toggleNoteListOneLine}
            onNoteDragStart={(noteId) => {
              setDraggedNoteId(noteId)
            }}
            onNoteDragEnd={() => {
              setDraggedNoteId(null)
            }}
            onKanbanDropToList={(noteId) => handleKanbanStatusChange(noteId, null)}
            boardView={boardView}
            onToggleBoardView={() => {
              const kanbanPane = openPanes.find(p => p.type === 'kanban')
              if (kanbanPane) closeEditorPane(kanbanPane.id)
              else openKanbanPane()
            }}
          />
        )}
        {shouldShowNotesPane && openPanes.length > 0 && (
          <PaneResizer onMouseDown={startNoteGridResize} />
        )}
        {openPanes.length ? (
          <div className="flex flex-col md:flex-row flex-1 min-w-0 overflow-y-auto md:overflow-y-hidden md:overflow-x-auto">
            {openPanes.map((pane, index) => {
              const { id: paneId, note, type } = pane
              const isNibPane = type === 'nib'
              const isKanbanPane = type === 'kanban'
              const isMultiPane = openPanes.length > 1
              const isLast = index === openPanes.length - 1
              const nibContext = isNibPane && !pane.regexContext
                ? {
                    noteId: nibLiveContext.noteId ?? pane.sourceNoteId,
                    selectionText: nibLiveContext.selectionText || pane.selectionText || '',
                    selectionRange: nibLiveContext.selectionRange ?? pane.selectionRange,
                  }
                : {
                    noteId: pane.sourceNoteId,
                    selectionText: pane.selectionText ?? '',
                    selectionRange: pane.selectionRange,
                  }
              const nibNote = isNibPane ? (noteById.get(nibContext.noteId) ?? note) : null
              return (
              <Fragment key={paneId}>
              <div
                onMouseDown={() => {
                  setActivePaneId(paneId)
                  if (!isNibPane && !isKanbanPane && note?.id) setActiveNoteId(note.id)
                }}
                style={
                  isMultiPane && !isLast
                    ? { flex: 'none', width: paneWidths[paneId] ?? DEFAULT_PANE_WIDTH }
                    : isMultiPane && isLast
                      ? { minWidth: MIN_PANE_WIDTH }
                      : undefined
                }
                className={[
                  'flex flex-col min-w-0 w-full border-b md:border-b-0 border-zinc-800',
                  isMultiPane
                    ? isLast ? 'flex-1' : ''
                    : 'md:min-w-[520px] flex-1 md:border-r last:border-r-0',
                  activePaneId === paneId ? 'bg-zinc-950' : 'bg-zinc-950/80',
                ].join(' ')}
              >
                {!simpleEditorMode && (
                  <div className={`flex items-center gap-2 px-3 py-1.5 border-b shrink-0 ${
                    activePaneId === paneId ? 'border-blue-900/70 bg-blue-950/20' : 'border-zinc-800 bg-zinc-900/40'
                  }`}>
                    <span className="text-[10px] text-zinc-600 font-mono shrink-0">pane {index + 1}</span>
                    <span className="text-[11px] text-zinc-400 truncate min-w-0">
                      {isKanbanPane ? 'Board' : isNibPane ? `Nib${nibNote ? `: ${getNoteTitle(nibNote)}` : ''}` : getNoteTitle(note)}
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
                {isKanbanPane ? (
                  <KanbanBoard
                    key={`${paneId}:kanban`}
                    notes={notes}
                    prefillCollections={collections}
                    activeNoteId={activeNoteId}
                    onSelectNote={(id, options = {}) => {
                      ensureSelectableNoteIsLocal(id)
                      openNoteInPane(id, { newPane: true, ...options })
                    }}
                    columns={activeCollection?.kanbanColumns}
                    onUpdateColumns={activeCollectionId && activeCollectionId !== ALL_COLLECTION_ID
                      ? (cols) => updateCollectionKanbanColumns(activeCollectionId, cols)
                      : undefined}
                    onKanbanStatusChange={handleKanbanStatusChange}
                  />
                ) : isNibPane ? (
                  <LLMChat
                    key={`${paneId}:nib`}
                    note={nibNote}
                    notes={notes}
                    selectionText={nibContext.selectionText}
                    regexContext={pane.regexContext ?? null}
                    initialMessage={pane.initialMessage ?? ''}
                    initialMessageNonce={pane.initialMessageNonce ?? ''}
                    autoSendInitialMessage={pane.autoSendInitialMessage ?? true}
                    settings={{ localAgentToken: settings.localAgentToken ?? '' }}
                    model={llmProvider === 'ollama' ? ollamaModel : remoteModel}
                    pane
                    onCreateNoteFromContent={createNoteFromContentInNewPane}
                    onJumpToSelection={() => {
                      if (nibContext.noteId) openNoteInPane(nibContext.noteId)
                    }}
                    onClose={() => closeEditorPane(paneId)}
                  />
                ) : (
                  <NotePanel
                    key={`${paneId}:${note.id}`}
                    note={note}
                    collection={collections.find(collection => collection.id === note.collectionId) ?? null}
                    bucketName={bucketName}
                    snippets={snippets}
                    templates={templates}
                    aiEnabled={aiEnabled}
                    user={user}
                    onRequireAuth={() => setShowAuth(true)}
                    onUpdate={(updates) => updateNote(note.id, updates)}
                    onReplaceInNotes={(updates) => updates.forEach(({ id, content }) => updateNote(id, { content }))}
                    onDelete={() => deleteNote(note.id)}
                    onRemoveFromServer={user ? () => handleRemoveNoteFromServer(note.id) : undefined}
                    isPinned={pins.get(note.collectionId)?.has(note.id) ?? false}
                    onTogglePin={() => handleTogglePin(note.id, note.collectionId)}
                    onCreateSnippet={createSnippet}
                    onSearchSnippets={searchSnippets}
                    onPublishNote={(mode) => handlePublishNote(note, mode)}
                    onToggleCollectionExcluded={(collectionExcluded) => handleSetNoteCollectionVisibility(note, collectionExcluded)}
                    onCreateNoteFromContent={createNoteFromContent}
                    onAddNotesSilently={createNotesSilently}
                    onCreateOpenApiNote={createOpenApiNote}
                    onCreateTipsNote={createTipsNote}
                    tipsCreated={tipsCreated}
                    focusNonce={activePaneId === paneId ? editorFocusNonce : 0}
                    restoreLocation={restoreLocation?.noteId === note.id ? restoreLocation : null}
                    onLocationChange={recordLocation}
                    notes={notes}
                    searchQuery={searchQuery}
                    simpleEditor={simpleEditorMode}
                    secretScanEnabled={settings.secretScanEnabled ?? false}
                    secretScanNibEnabled={settings.secretScanNibEnabled ?? false}
                    hideCommandToolbars={simpleEditorMode || commandToolbarsHidden}
                    llmEnabled={nibConnected}
                    ollamaModel={llmProvider === 'ollama' ? ollamaModel : remoteModel}
                    agentToken={settings.localAgentToken ?? ''}
                    nibPrompts={{
                      ...(settings.nibTemplates?.codeReview ? { 'template.codeReview': settings.nibTemplates.codeReview } : {}),
                      ...(settings.nibPrompts ?? {}),
                    }}
                    onOpenNibPane={openNibPane}
                    onNibContextChange={activePaneId === paneId ? handleNibContextChange : undefined}
                    onDiffModeChange={(loader) => {
                      diffLoaderRef.current = loader
                      setDiffActive(!!loader)
                    }}
                    onOpenNote={(noteId, options = {}) => {
                      ensureSelectableNoteIsLocal(noteId)
                      openNoteInPane(noteId, options)
                    }}
                  />
                )}
              </div>
              {!isLast && isMultiPane && (
                <PaneResizer onMouseDown={(e) => startPaneResize(paneId, e)} visible />
              )}
              </Fragment>
            )})}
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
          onLoadBucketInfo={handleLoadBucketInfo}
          onSaveBucketName={handleSaveBucketName}
          onLoadAiConfig={handleLoadAiConfig}
          onSaveAiConfig={handleSaveAiConfig}
          onSeedNotes={handleSeedDeveloperNotes}
          onRegenerateKeys={handleRegenerateKeys}
          onRemoveAllFromServer={user ? handleRemoveAllNotesFromServer : undefined}
          onClearAllBucketNotes={user ? handleClearAllBucketNotes : undefined}
          publicNoteCount={publicNoteCount}
          publicCollectionCount={publicCollectionCount}
          noteCount={collectionNotes.length}
          user={user}
          bucketName={bucketName}
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
      {showTemplates && (
        <TemplateManager
          userTemplates={userTemplates}
          onClose={() => setShowTemplates(false)}
          onSave={saveTemplate}
          onDelete={deleteTemplate}
        />
      )}
      {showSharedLinks && (
        <SharedLinksModal
          onListSharedLinks={handleListSharedLinks}
          onDeleteSharedLink={handleDeleteSharedLink}
          onClose={() => setShowSharedLinks(false)}
        />
      )}
      {showNibPrompts && (
        <NibPromptsModal
          settings={settings}
          onSave={handleSaveNibPrompts}
          onClose={() => setShowNibPrompts(false)}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showAuth && <AuthScreen onClose={() => setShowAuth(false)} />}

      {settings.secretScanEnabled && settings.secretScanBlockSync && syncHeldIds.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-2.5 bg-amber-950 border border-amber-700/60 rounded-lg shadow-xl text-[12px] max-w-sm">
          <svg className="w-4 h-4 text-amber-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span className="text-amber-200 flex-1">
            {syncHeldIds.length} note{syncHeldIds.length > 1 ? 's' : ''} held from sync — potential secrets detected
          </span>
          <button
            onClick={() => setSyncHeldIds([])}
            className="text-amber-600 hover:text-amber-300 transition-colors shrink-0"
            title="Dismiss"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      {publishSecretGate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={e => e.target === e.currentTarget && setPublishSecretGate(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[440px] p-5 space-y-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Potential secrets detected</h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">This note may contain sensitive credentials. Are you sure you want to publish it?</p>
              </div>
            </div>
            <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg p-3 space-y-1">
              {publishSecretGate.matches.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="text-zinc-500">{m.label}:</span>
                  <span className="font-mono text-amber-400">{m.redacted}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setPublishSecretGate(null)}
                className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const { note, viewMode } = publishSecretGate
                  setPublishSecretGate(null)
                  await handlePublishNote(note, viewMode)
                }}
                className="px-4 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-white rounded-md transition-colors font-medium"
              >
                Publish anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
