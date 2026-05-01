import { useState, useRef, useCallback, useEffect } from 'react'
import { buildNotePreviewModel } from './NotePreviewBody'
import { getNoteTitle } from '../utils/noteTypes'

const DEFAULT_COLUMNS = ['Backlog', 'In Progress', 'Review', 'Done']

function KanbanCard({ note, isActive, onSelect, onDragStart, onDragEnd, columnName }) {
  const model = buildNotePreviewModel(note, null, { expanded: false })
  const title = model.firstLine || 'empty'
  const preview = model.rest?.split('\n').slice(0, 2).join(' ').slice(0, 120) || ''

  return (
    <div
      id={`note-card-${note.id}`}
      draggable
      onClick={(e) => onSelect(note.id, { newPane: e.ctrlKey || e.metaKey })}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', note.id)
        e.dataTransfer.setData('application/x-jotit-note-id', note.id)
        e.dataTransfer.setData('application/x-jotit-kanban-source-col', columnName)
        onDragStart?.(note.id)
      }}
      onDragEnd={() => onDragEnd?.()}
      className={[
        'group relative rounded-md border cursor-pointer select-none',
        'transition-all duration-100 p-2.5 mb-2 last:mb-0',
        isActive
          ? 'border-blue-700 bg-blue-950/30 shadow-md shadow-blue-950/50'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/70',
      ].join(' ')}
    >
      <div className="text-xs font-medium text-zinc-200 leading-snug line-clamp-2 mb-1">{title}</div>
      {preview && (
        <div className="text-[10px] text-zinc-500 leading-snug line-clamp-2">{preview}</div>
      )}
      {note.categories?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {note.categories.slice(0, 3).map(cat => (
            <span key={cat} className="rounded px-1 py-0.5 text-[9px] bg-zinc-800 text-zinc-400 border border-zinc-700/50">{cat}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function KanbanColumn({
  name,
  notes,
  activeNoteId,
  onSelect,
  onCardDragStart,
  onCardDragEnd,
  onDrop,
  onRenameColumn,
  onDeleteColumn,
  canDelete,
}) {
  const [dragOver, setDragOver] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)
  const inputRef = useRef(null)
  const dragCounterRef = useRef(0)
  const colRef = useRef(null)
  const onDropRef = useRef(onDrop)
  useEffect(() => { onDropRef.current = onDrop }, [onDrop])

  // Native listeners so preventDefault() runs synchronously, outside React's
  // batching — fixes the "no drop" cursor when dragging over child elements.
  useEffect(() => {
    const el = colRef.current
    if (!el) return

    const onDragEnter = (e) => {
      e.preventDefault()
      dragCounterRef.current++
      setDragOver(true)
    }
    const onDragOver = (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
    const onDragLeave = () => {
      dragCounterRef.current--
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0
        setDragOver(false)
      }
    }
    const handleDrop = (e) => {
      e.preventDefault()
      dragCounterRef.current = 0
      setDragOver(false)
      const noteId = e.dataTransfer.getData('application/x-jotit-note-id') || e.dataTransfer.getData('text/plain')
      if (noteId) onDropRef.current(noteId, name)
    }

    el.addEventListener('dragenter', onDragEnter)
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', handleDrop)
    return () => {
      el.removeEventListener('dragenter', onDragEnter)
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', handleDrop)
    }
  }, [name])

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== name) onRenameColumn(name, trimmed)
    setEditing(false)
  }, [editValue, name, onRenameColumn])

  return (
    <div
      ref={colRef}
      className={[
        'flex flex-col rounded-lg border transition-colors duration-100',
        'w-64 shrink-0 min-h-[200px]',
        dragOver
          ? 'border-blue-600 bg-blue-950/20'
          : 'border-zinc-800 bg-zinc-900/40',
      ].join(' ')}
    >
      {/* Column header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-800">
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setEditValue(name); setEditing(false) }
            }}
            className="flex-1 min-w-0 bg-transparent border-b border-blue-600 text-xs font-semibold text-zinc-200 outline-none"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => { setEditValue(name); setEditing(true) }}
            title="Double-click to rename column"
            className="flex-1 min-w-0 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider truncate"
          >
            {name}
          </button>
        )}
        <span className="text-[10px] text-zinc-600 tabular-nums">{notes.length}</span>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDeleteColumn(name)}
            title="Delete column"
            className="opacity-0 group-hover:opacity-100 ml-0.5 text-zinc-600 hover:text-red-400 text-[11px] transition-opacity"
          >
            ×
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 group">
        {notes.length === 0 && (
          <div className="text-[10px] text-zinc-700 text-center mt-4 select-none">drop cards here</div>
        )}
        {notes.map(note => (
          <KanbanCard
            key={note.id}
            note={note}
            isActive={note.id === activeNoteId}
            onSelect={onSelect}
            onDragStart={onCardDragStart}
            onDragEnd={onCardDragEnd}
            columnName={name}
          />
        ))}
      </div>
    </div>
  )
}

export default function KanbanBoard({
  notes,
  activeNoteId,
  onSelectNote,
  columns = DEFAULT_COLUMNS,
  onUpdateColumns,
  onKanbanStatusChange,
}) {
  const [draggingId, setDraggingId] = useState(null)

  const getColumnNotes = useCallback((colName) => {
    if (colName === columns[0]) {
      return notes.filter(n => !n.kanbanStatus || !columns.includes(n.kanbanStatus) || n.kanbanStatus === colName)
    }
    return notes.filter(n => n.kanbanStatus === colName)
  }, [notes, columns])

  const handleDrop = useCallback((noteId, targetColumn) => {
    onKanbanStatusChange(noteId, targetColumn)
    setDraggingId(null)
  }, [onKanbanStatusChange])

  const handleRenameColumn = useCallback((oldName, newName) => {
    if (!newName.trim() || newName === oldName) return
    const updated = columns.map(c => c === oldName ? newName : c)
    onUpdateColumns(updated)
    // remap notes in renamed column
    notes.forEach(n => {
      if (n.kanbanStatus === oldName) onKanbanStatusChange(n.id, newName)
    })
  }, [columns, notes, onKanbanStatusChange, onUpdateColumns])

  const handleDeleteColumn = useCallback((name) => {
    if (columns.length <= 1) return
    const firstCol = columns.find(c => c !== name) ?? columns[0]
    const updated = columns.filter(c => c !== name)
    onUpdateColumns(updated)
    notes.forEach(n => {
      if (n.kanbanStatus === name) onKanbanStatusChange(n.id, firstCol)
    })
  }, [columns, notes, onKanbanStatusChange, onUpdateColumns])

  const handleAddColumn = useCallback(() => {
    const name = `Column ${columns.length + 1}`
    onUpdateColumns([...columns, name])
  }, [columns, onUpdateColumns])

  return (
    <div className="flex flex-col h-full" onDragOver={e => e.preventDefault()}>
      {/* Board toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[10px] text-zinc-600 select-none">double-click column header to rename · drag cards between columns</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleAddColumn}
          title="Add column"
          className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
        >
          + column
        </button>
      </div>

      {/* Columns */}
      <div className="flex flex-1 gap-3 p-3 overflow-x-auto overflow-y-hidden">
        {columns.map(col => (
          <KanbanColumn
            key={col}
            name={col}
            notes={getColumnNotes(col)}
            activeNoteId={activeNoteId}
            onSelect={onSelectNote}
            onCardDragStart={(id) => setDraggingId(id)}
            onCardDragEnd={() => setDraggingId(null)}
            onDrop={handleDrop}
            onRenameColumn={handleRenameColumn}
            onDeleteColumn={handleDeleteColumn}
            canDelete={columns.length > 1}
          />
        ))}
      </div>
    </div>
  )
}
