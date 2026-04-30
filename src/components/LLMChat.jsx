import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useLLMChat } from '../hooks/useLLMChat'
import { useLLMSettings } from '../hooks/useLLMSettings'
import { buildAllNotesLLMContext, buildNoteLLMContext, buildReferencedNotesContext } from '../utils/llmNoteContext'

const BASE_MODES = [
  { id: 'note', label: 'Note' },
  { id: 'all', label: 'All notes' },
  { id: 'selection', label: 'Selection' },
]

function buildRegexContext({ pattern, flags, testStr, matchCount }) {
  const parts = [`Pattern: /${pattern}/${flags}`]
  if (testStr) parts.push(`Test string:\n${testStr}`)
  if (matchCount != null) parts.push(`Matches: ${matchCount}`)
  return parts.join('\n\n')
}

function noteTitle(note) {
  return String(note?.content ?? '').split('\n')[0].slice(0, 80) || 'Untitled'
}

// ── Note reference picker ─────────────────────────────────────────────────────

function NotePicker({ query, notes, onSelect, activeIndex, pickerRef }) {
  if (!notes.length) {
    return (
      <div ref={pickerRef} className="absolute bottom-full mb-1 left-0 right-0 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
        <p className="px-3 py-2 text-[12px] text-zinc-500">
          {query ? 'No matching notes' : 'Type to search notes'}
        </p>
      </div>
    )
  }

  return (
    <div ref={pickerRef} className="absolute bottom-full mb-1 left-0 right-0 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
      {notes.map((note, i) => (
        <button
          key={note.id}
          onMouseDown={e => { e.preventDefault(); onSelect(note) }}
          className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
            i === activeIndex
              ? 'bg-violet-900/50 text-violet-200'
              : 'text-zinc-300 hover:bg-zinc-700'
          }`}
        >
          <span className="truncate block">{noteTitle(note)}</span>
        </button>
      ))}
    </div>
  )
}

// ── Reference chips ───────────────────────────────────────────────────────────

function ReferenceChips({ notes, onRemove }) {
  if (!notes.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
      {notes.map(note => (
        <span
          key={note.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-900/40 border border-violet-800/60 text-[11px] text-violet-300 font-mono max-w-[200px]"
        >
          <span className="truncate">@{noteTitle(note)}</span>
          <button
            onMouseDown={e => { e.preventDefault(); onRemove(note.id) }}
            className="shrink-0 text-violet-500 hover:text-violet-200 transition-colors leading-none"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LLMChat({ note, notes = [], selectionText = '', onJumpToSelection, regexContext = null, initialMessage = '', settings, model, onClose, pane = false }) {
  const [input, setInput] = useState(initialMessage)
  const [contextMode, setContextMode] = useState(() => {
    if (regexContext) return 'regex'
    if (selectionText) return 'selection'
    return 'note'
  })
  const [referencedNotes, setReferencedNotes] = useState([])
  const [atPicker, setAtPicker] = useState(null) // null | { start: number, query: string }
  const [pickerIndex, setPickerIndex] = useState(0)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const pickerRef = useRef(null)
  const token = settings?.localAgentToken ?? ''
  const autoSentRef = useRef(false)
  const { ollamaModel: activeModel } = useLLMSettings()
  const chatModel = activeModel || model

  const MODES = [
    ...BASE_MODES,
    ...(regexContext ? [{ id: 'regex', label: 'Regex' }] : []),
  ]

  const { messages, isStreaming, error, sendMessage, clear } = useLLMChat({ token, model: chatModel })

  // ── Picker results ──────────────────────────────────────────────────────────

  const pickerResults = useMemo(() => {
    if (!atPicker) return []
    const q = atPicker.query.toLowerCase()
    return (notes ?? [])
      .filter(n => n.id !== note?.id)
      .filter(n => !referencedNotes.find(r => r.id === n.id))
      .filter(n => {
        if (!q) return true
        const content = String(n.content ?? '').toLowerCase()
        return content.includes(q)
      })
      .slice(0, 6)
  }, [atPicker, notes, note, referencedNotes])

  // Reset picker index when results change
  useEffect(() => { setPickerIndex(0) }, [pickerResults])

  // ── Scroll ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Focus ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectionText && !regexContext) inputRef.current?.focus()
  }, [])

  // ── Auto-send initial message ───────────────────────────────────────────────

  useEffect(() => {
    if (!initialMessage.trim() || autoSentRef.current) return
    autoSentRef.current = true
    const ctx = regexContext ? buildRegexContext(regexContext) : buildNoteLLMContext(note)
    const mode = regexContext ? 'regex' : contextMode
    sendMessage(initialMessage.trim(), ctx, mode)
    setInput('')
  }, [])

  // ── Escape closes nib (not picker) ─────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !atPicker) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, atPicker])

  // ── Context mode guards ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectionText && contextMode === 'selection') setContextMode('note')
  }, [selectionText, contextMode])

  useEffect(() => {
    if (regexContext || !selectionText || contextMode === 'all') return
    setContextMode('selection')
  }, [contextMode, regexContext, selectionText])

  // ── Context builder ─────────────────────────────────────────────────────────

  const buildContext = useCallback(() => {
    let ctx = ''
    if (contextMode === 'regex') ctx = regexContext ? buildRegexContext(regexContext) : ''
    else if (contextMode === 'all') ctx = buildAllNotesLLMContext(notes)
    else if (contextMode === 'selection') ctx = selectionText
    else ctx = buildNoteLLMContext(note)

    if (referencedNotes.length > 0) {
      const refCtx = buildReferencedNotesContext(referencedNotes)
      ctx = ctx ? `${ctx}\n\n${refCtx}` : refCtx
    }
    return ctx
  }, [contextMode, regexContext, notes, selectionText, note, referencedNotes])

  // ── Send ────────────────────────────────────────────────────────────────────

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim(), buildContext(), contextMode)
    setInput('')
  }

  // ── Note reference selection ────────────────────────────────────────────────

  const selectPickerNote = useCallback((pickerNote) => {
    setReferencedNotes(prev => {
      if (prev.find(n => n.id === pickerNote.id)) return prev
      return [...prev, pickerNote]
    })
    if (atPicker) {
      const removeLen = 1 + atPicker.query.length // '@' + query text
      setInput(prev => prev.slice(0, atPicker.start) + prev.slice(atPicker.start + removeLen))
    }
    setAtPicker(null)
    inputRef.current?.focus()
  }, [atPicker])

  const removeReferencedNote = useCallback((noteId) => {
    setReferencedNotes(prev => prev.filter(n => n.id !== noteId))
  }, [])

  // ── Input change — detect @ trigger ────────────────────────────────────────

  const handleInputChange = (e) => {
    const val = e.target.value
    const cursor = e.target.selectionStart
    setInput(val)

    const beforeCursor = val.slice(0, cursor)
    const atMatch = beforeCursor.match(/@(\S*)$/)
    if (atMatch) {
      setAtPicker({ start: cursor - atMatch[0].length, query: atMatch[1] })
    } else {
      setAtPicker(null)
    }
  }

  // ── Keyboard — picker nav + send ────────────────────────────────────────────

  const handleKeyDown = (e) => {
    if (atPicker && pickerResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPickerIndex(i => Math.min(i + 1, pickerResults.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPickerIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        selectPickerNote(pickerResults[pickerIndex])
        return
      }
    }
    if (e.key === 'Escape' && atPicker) {
      e.stopPropagation()
      setAtPicker(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const contextLabel = () => {
    if (contextMode === 'regex') return regexContext?.pattern ? `/${regexContext.pattern}/${regexContext.flags}` : 'regex'
    if (contextMode === 'all') return `all notes (${(notes ?? []).length})`
    if (contextMode === 'selection') return 'selection'
    return note?.content?.split('\n')[0]?.slice(0, 50) || 'Untitled'
  }

  return (
    <div className={pane
      ? 'flex flex-col flex-1 min-h-0 bg-zinc-900 overflow-hidden'
      : 'fixed bottom-4 right-4 z-50 flex flex-col w-[440px] max-h-[620px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden'
    }>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-zinc-200">✒ Nib</span>
          <span className="text-[11px] text-zinc-500 truncate" title={contextLabel()}>
            context: {contextLabel()}
            {referencedNotes.length > 0 && (
              <span className="text-violet-400"> + {referencedNotes.length} ref{referencedNotes.length > 1 ? 's' : ''}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {chatModel && (
            <span className="text-[10px] text-zinc-500 font-mono bg-zinc-800 px-2 py-0.5 rounded">
              {chatModel}
            </span>
          )}
          {messages.length > 0 && (
            <button
              onClick={clear}
              title="Clear conversation"
              className="text-zinc-600 hover:text-zinc-400 transition-colors text-[11px]"
            >
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Regex context preview */}
      {contextMode === 'regex' && regexContext && (
        <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-800/40 shrink-0">
          <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wide mb-1">Regex context</p>
          <code className="text-[12px] text-amber-300 font-mono">
            /{regexContext.pattern || <span className="text-zinc-600">empty</span>}/{regexContext.flags}
          </code>
          {regexContext.matchCount != null && (
            <span className={`ml-3 text-[11px] font-mono ${regexContext.matchCount > 0 ? 'text-green-400' : 'text-zinc-600'}`}>
              {regexContext.matchCount} match{regexContext.matchCount !== 1 ? 'es' : ''}
            </span>
          )}
          {regexContext.testStr && (
            <p className="text-[11px] text-zinc-600 font-mono mt-1 truncate">
              test: {regexContext.testStr.slice(0, 80)}{regexContext.testStr.length > 80 ? '…' : ''}
            </p>
          )}
        </div>
      )}

      {/* Selection preview */}
      {contextMode === 'selection' && selectionText && (
        <div className="px-3 py-2 border-b border-zinc-800 bg-violet-950/20 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-violet-400 font-mono uppercase tracking-wide">Selected text</p>
            {onJumpToSelection && (
              <button
                onClick={onJumpToSelection}
                title="Jump to selection in note"
                className="text-[10px] text-violet-500 hover:text-violet-300 font-mono transition-colors"
              >
                ↩ jump
              </button>
            )}
          </div>
          <p
            onClick={onJumpToSelection}
            title="Jump to selection in note"
            className="text-[12px] text-zinc-300 font-mono whitespace-pre-wrap line-clamp-4 leading-relaxed cursor-pointer hover:text-zinc-100 transition-colors"
          >
            {selectionText}
          </p>
        </div>
      )}

      {/* Context mode selector */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800 shrink-0">
        {MODES.map(m => {
          const disabled = m.id === 'selection' && !selectionText
          return (
            <button
              key={m.id}
              onClick={() => !disabled && setContextMode(m.id)}
              disabled={disabled}
              title={m.id === 'selection' && !selectionText ? 'Select text in the note first' : undefined}
              className={`px-2.5 py-1 text-[11px] rounded border font-mono transition-colors ${
                contextMode === m.id
                  ? 'text-violet-300 bg-violet-950/50 border-violet-800'
                  : disabled
                    ? 'text-zinc-700 border-zinc-800 cursor-not-allowed'
                    : 'text-zinc-500 hover:text-zinc-300 border-zinc-700 hover:border-zinc-500'
              }`}
            >
              {m.label}
            </button>
          )
        })}
        {contextMode === 'all' && (
          <span className="ml-auto text-[10px] text-zinc-600 font-mono">
            {Math.round(buildAllNotesLLMContext(notes).length / 1000)}k chars
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-[12px] text-zinc-600 text-center py-6">
            {contextMode === 'regex'
              ? 'Describe the regex you need, or ask about the current pattern.'
              : contextMode === 'all'
                ? `Ask anything across your ${(notes ?? []).length} notes.`
                : contextMode === 'selection'
                  ? 'Ask about the selected text.'
                  : 'Ask anything about this note. Type @ to reference another note.'}
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-[13px] whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'
              }`}
            >
              {msg.content}
              {msg.role === 'assistant' && isStreaming && i === messages.length - 1 && (
                <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-zinc-400 align-middle animate-pulse rounded-sm" />
              )}
            </div>
          </div>
        ))}
        {error && (
          <p className="text-[11px] text-red-400 text-center">{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="px-3 pb-3 pt-2 border-t border-zinc-800 shrink-0">
        {/* Reference chips */}
        <ReferenceChips notes={referencedNotes} onRemove={removeReferencedNote} />

        {/* Textarea + picker wrapper */}
        <div className={`relative flex items-end gap-2 ${referencedNotes.length > 0 ? 'mt-2' : ''}`}>
          {atPicker && (
            <NotePicker
              query={atPicker.query}
              notes={pickerResults}
              onSelect={selectPickerNote}
              activeIndex={pickerIndex}
              pickerRef={pickerRef}
            />
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder={isStreaming ? 'Responding…' : 'Ask… (Enter to send, @ to reference a note)'}
            rows={2}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors resize-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-[12px] font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
