import { useState, useEffect, useCallback, useRef } from 'react'
import { loadSettings, saveSettings } from './utils/storage'
import { useMemo } from 'react'
import { exportSQLite, getAttachmentsForNote } from './utils/db'
import { scheduleSyncPush } from './utils/sync'
import { createEmptyNote } from './utils/noteFactories'
import { createDeveloperSeedNotes } from './utils/helpers'
import { getNoteTitle } from './utils/noteTypes'
import { searchSnippetsLocally } from './utils/search'
import { useNoteSearch } from './hooks/useNoteSearch'
import { useNoteDropImport } from './hooks/useNoteDropImport'
import { useAppLifecycle } from './hooks/useAppLifecycle'
import { useNoteMutations } from './hooks/useNoteMutations'
import { useNoteWorkspace } from './hooks/useNoteWorkspace'
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
  const [editorFocusNonce, setEditorFocusNonce] = useState(0)
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

  const { searchInput, searchResults, isSearching, handleSearch, clearSearch } = useNoteSearch(notesRef, user)
  const { isDragging, handleDragEnter, handleDragLeave, handleDragOver, handleDrop } = useNoteDropImport({
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
  })

  const createNote = useCallback(() => {
    const note = createEmptyNote()
    addNote(note)
    showSinglePaneForNote(note.id)
    recordLocation({ noteId: note.id }, { replaceCurrent: false })
    setEditorFocusNonce(n => n + 1)
    clearSearch()
  }, [addNote, clearSearch, recordLocation, showSinglePaneForNote])

  const createNoteFromContent = useCallback((content) => {
    const note = createEmptyNote()
    note.content = content
    note.updatedAt = Date.now()
    addNote(note)
    showSinglePaneForNote(note.id)
    recordLocation({ noteId: note.id }, { replaceCurrent: false })
    setEditorFocusNonce(n => n + 1)
    clearSearch()
  }, [addNote, clearSearch, recordLocation, showSinglePaneForNote])

  useEffect(() => {
    if (!dbReady || createFromUrlHandledRef.current) return

    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') {
      createFromUrlHandledRef.current = true
      return
    }

    createFromUrlHandledRef.current = true
    createNote()
    params.delete('new')
    const nextQuery = params.toString()
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', nextUrl)
  }, [createNote, dbReady])

  const handleSeedDeveloperNotes = useCallback(() => {
    const seeded = seedNotes(createDeveloperSeedNotes())
    if (!seeded.length) return
    clearSearch()
    showSinglePaneForNote(seeded[0].id)
    recordLocation({ noteId: seeded[0].id }, { replaceCurrent: false })
  }, [clearSearch, recordLocation, seedNotes, showSinglePaneForNote])

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

  useEffect(() => {
    const handler = (e) => {
      const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName)
      if (e.altKey && e.key === 'n') { e.preventDefault(); createNote() }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigateLocationHistory(-1) }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navigateLocationHistory(1) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'Escape') { clearSearch(); setShowSettings(false); setShowHelp(false); setShowSnippets(false); setShowSharedLinks(false) }
      if (e.key === '?' && !inInput) { e.preventDefault(); setShowHelp(h => !h) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clearSearch, createNote, navigateLocationHistory])

  const displayedNotes = useMemo(() => searchResults?.map(result => result.note) ?? notes, [notes, searchResults])
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
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base font-bold tracking-tight text-zinc-100">jot.it</span>
          <span className="text-[11px] text-zinc-600 font-mono tabular-nums">{notes.length}</span>
        </div>

        <div className="flex-1 max-w-sm">
          <SearchBar value={searchInput} onChange={handleSearch} isSearching={isSearching} aiEnabled={aiEnabled} inputRef={searchRef} />
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

      <div className="flex flex-1 overflow-hidden relative">
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
          searchQuery={searchInput}
          diffActive={diffActive}
          isPeekOpen={notePeekOpen}
          onPeekOpenChange={setNotePeekOpen}
        />
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
                  focusNonce={activePaneId === paneId ? editorFocusNonce : 0}
                  restoreLocation={restoreLocation?.noteId === note.id ? restoreLocation : null}
                  onLocationChange={recordLocation}
                  notes={notes}
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
          publicNoteCount={publicNoteCount}
          noteCount={notes.length}
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
