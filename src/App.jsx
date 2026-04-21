import { useState, useEffect, useCallback, useRef } from 'react'
import { loadSettings, saveSettings } from './utils/storage'
import { initDB, getAllNotes, upsertNoteSync, deleteNoteSync, schedulePersist, exportSQLite } from './utils/db'
import { initOpenAI, isOpenAIReady, getEmbedding, semanticSearch, initCategoryEmbeddings, categorizeByEmbedding, areCategoryEmbeddingsReady } from './utils/openai'
import { generateId, SAMPLE_NOTES } from './utils/helpers'
import NoteGrid from './components/NoteGrid'
import NotePanel from './components/NotePanel'
import SearchBar from './components/SearchBar'
import Settings from './components/Settings'
import HelpModal from './components/HelpModal'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

export default function App() {
  const [dbReady, setDbReady] = useState(false)
  const [notes, setNotes] = useState([])
  const [activeNoteId, setActiveNoteId] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const searchRef = useRef(null)
  const [isSearching, setIsSearching] = useState(false)
  const [aiProcessing, setAiProcessing] = useState(new Set())

  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])

  const categTimers = useRef({})

  // ── Boot: init SQLite ───────────────────────────────────────────────────────
  useEffect(() => {
    initDB().then(() => {
      let loaded = getAllNotes()
      // First-ever launch with no DB data → seed sample notes
      if (loaded.length === 0) {
        for (const n of SAMPLE_NOTES) upsertNoteSync(n)
        schedulePersist()
        loaded = getAllNotes()
      }
      setNotes(loaded)
      setActiveNoteId(loaded[0]?.id ?? null)
      setDbReady(true)
    }).catch(err => {
      console.error('[JotIt] DB init failed:', err)
      setDbReady(true) // still render, just won't persist
    })
  }, [])

  // ── OpenAI ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    initOpenAI(settings.openaiApiKey)
    // Pre-compute category reference vectors (reads from localStorage cache if fresh)
    initCategoryEmbeddings()
  }, [settings.openaiApiKey])

  // Batch-embed + categorize notes that have no embedding when AI key is set
  useEffect(() => {
    if (!dbReady || !isOpenAIReady()) return
    const unembedded = notesRef.current.filter(n => !n.embedding && n.content.trim())
    if (!unembedded.length) return
    unembedded.forEach((note, i) => {
      setTimeout(async () => {
        const embed = await getEmbedding(note.content)
        if (embed) {
          const categories = areCategoryEmbeddingsReady() ? categorizeByEmbedding(embed) : []
          setNotes(prev => {
            const updated = { ...note, embedding: embed, ...(categories.length ? { categories } : {}) }
            const next = prev.map(n => n.id === note.id ? updated : n)
            upsertNoteSync(updated)
            schedulePersist()
            return next
          })
        }
      }, i * 600)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.openaiApiKey, dbReady])

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const createNote = useCallback(() => {
    const note = {
      id: generateId(),
      content: '',
      categories: [],
      embedding: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    upsertNoteSync(note)
    schedulePersist()
    setNotes(prev => [note, ...prev])
    setActiveNoteId(note.id)
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  const updateNote = useCallback((id, updates) => {
    setNotes(prev => {
      const next = prev.map(n => {
        if (n.id !== id) return n
        const updated = { ...n, ...updates, updatedAt: Date.now() }
        upsertNoteSync(updated)
        return updated
      })
      schedulePersist()
      return next
    })

    if (updates.content !== undefined && isOpenAIReady()) {
      clearTimeout(categTimers.current[id])
      categTimers.current[id] = setTimeout(async () => {
        const note = notesRef.current.find(n => n.id === id)
        if (!note?.content.trim()) return

        setAiProcessing(prev => new Set([...prev, id]))
        try {
          // Embedding first — categorization is derived from it, no extra API call
          const embedding = await getEmbedding(note.content)
          const categories = (embedding && areCategoryEmbeddingsReady())
            ? categorizeByEmbedding(embedding)
            : []
          setNotes(prev => {
            const next = prev.map(n => {
              if (n.id !== id) return n
              const updated = { ...n, embedding, ...(categories.length ? { categories } : {}) }
              upsertNoteSync(updated)
              return updated
            })
            schedulePersist()
            return next
          })
        } finally {
          setAiProcessing(prev => { const s = new Set(prev); s.delete(id); return s })
        }
      }, 1800)
    }
  }, [])

  const deleteNote = useCallback((id) => {
    deleteNoteSync(id)
    schedulePersist()
    setNotes(prev => {
      const idx = prev.findIndex(n => n.id === id)
      const next = prev.filter(n => n.id !== id)
      setActiveNoteId(next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null)
      return next
    })
  }, [])

  // ── Search ──────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async (query) => {
    setSearchQuery(query)
    if (!query.trim()) { setSearchResults(null); return }
    const q = query.toLowerCase()
    const local = notesRef.current.filter(n =>
      n.content.toLowerCase().includes(q) ||
      n.categories.some(c => c.includes(q))
    )
    setSearchResults(local)
    if (isOpenAIReady()) {
      setIsSearching(true)
      try {
        const semantic = await semanticSearch(query, notesRef.current)
        if (semantic) {
          const seen = new Set(local.map(n => n.id))
          setSearchResults([...local, ...semantic.filter(n => !seen.has(n.id))])
        }
      } finally { setIsSearching(false) }
    }
  }, [])

  const handleSaveSettings = useCallback((s) => {
    setSettings(s)
    saveSettings(s)
    setShowSettings(false)
  }, [])

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  const handleDragEnter = useCallback((e) => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current++
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return

    const firstId = await Promise.all(files.map(async (file) => {
      if (file.size > MAX_FILE_SIZE) return null
      let text
      try { text = await file.text() } catch { return null }
      // Skip files that look binary (many null bytes in first 1KB)
      if ((text.slice(0, 1024).match(/\0/g) ?? []).length > 10) return null

      const note = {
        id: generateId(),
        content: `${file.name}\n${text}`,
        categories: [],
        embedding: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      upsertNoteSync(note)

      // Embed + categorize in background
      if (isOpenAIReady() && note.content.trim()) {
        setAiProcessing(prev => new Set([...prev, note.id]))
        getEmbedding(note.content)
          .then(embedding => {
            if (!embedding) return
            const categories = areCategoryEmbeddingsReady() ? categorizeByEmbedding(embedding) : []
            setNotes(prev => {
              const next = prev.map(n => {
                if (n.id !== note.id) return n
                const updated = { ...n, embedding, ...(categories.length ? { categories } : {}) }
                upsertNoteSync(updated)
                return updated
              })
              schedulePersist()
              return next
            })
          })
          .finally(() => setAiProcessing(prev => { const s = new Set(prev); s.delete(note.id); return s }))
      }

      return note
    }))

    const created = firstId.filter(Boolean)
    if (!created.length) return

    setNotes(prev => [...created, ...prev])
    setActiveNoteId(created[0].id)
    setSearchQuery('')
    setSearchResults(null)
    schedulePersist()
  }, [])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const inInput = ['INPUT','TEXTAREA'].includes(e.target.tagName)
      if (e.altKey && e.key === 'n') { e.preventDefault(); createNote() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'Escape') { setSearchQuery(''); setSearchResults(null); setShowSettings(false); setShowHelp(false) }
      if (e.key === '?' && !inInput) { e.preventDefault(); setShowHelp(h => !h) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [createNote])

  const displayedNotes = searchResults ?? notes
  const activeNote = notes.find(n => n.id === activeNoteId) ?? null
  const aiEnabled = isOpenAIReady()

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!dbReady) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center gap-3 text-zinc-600">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeDashoffset="10" />
        </svg>
        <span className="text-sm font-mono">loading database…</span>
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
      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-2 rounded-xl border-2 border-dashed border-blue-500 bg-zinc-950/90" />
          <div className="relative text-center space-y-3">
            <div className="text-5xl">📄</div>
            <p className="text-blue-400 text-base font-medium">Drop files to create notes</p>
            <p className="text-zinc-500 text-sm">Each file becomes a new note · 5 MB max</p>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base font-bold tracking-tight text-zinc-100">JotIt</span>
          <span className="text-[11px] text-zinc-600 font-mono tabular-nums">{notes.length}</span>
        </div>

        <div className="flex-1 max-w-sm">
          <SearchBar value={searchQuery} onChange={handleSearch} isSearching={isSearching} aiEnabled={aiEnabled} inputRef={searchRef} />
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {searchResults !== null && (
            <span className="text-[11px] text-zinc-500">
              {displayedNotes.length} result{displayedNotes.length !== 1 ? 's' : ''}
            </span>
          )}
          <div className={`flex items-center gap-1 text-[11px] ${aiEnabled ? 'text-green-500' : 'text-zinc-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${aiEnabled ? 'bg-green-500' : 'bg-zinc-700'}`} />
            <span>AI</span>
          </div>
          <button
            onClick={createNote}
            title="New note (Alt+N)"
            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors"
          >
            + New
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
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <NoteGrid
          notes={displayedNotes}
          activeNoteId={activeNoteId}
          aiProcessing={aiProcessing}
          onSelectNote={setActiveNoteId}
          searchQuery={searchQuery}
        />
        {activeNote ? (
          <NotePanel
            key={activeNote.id}
            note={activeNote}
            aiProcessing={aiProcessing.has(activeNote.id)}
            aiEnabled={aiEnabled}
            onUpdate={(updates) => updateNote(activeNote.id, updates)}
            onDelete={() => deleteNote(activeNote.id)}
          />
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
        <Settings settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} onExportDB={exportSQLite} />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}
