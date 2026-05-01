import { useCallback, useRef, useState } from 'react'
import { schedulePersist } from '../utils/db'
import { scheduleSyncPush } from '../utils/sync'
import { importDroppedFiles } from '../utils/importNotes'

function hasDraggedFiles(dataTransfer) {
  return Array.from(dataTransfer?.types ?? []).includes('Files')
}

export function useNoteDropImport({
  activeCollectionId,
  clearSearch,
  maxFileSize,
  setActiveNoteId,
  setNotes,
}) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const handleDragEnter = useCallback((e) => {
    if (!hasDraggedFiles(e.dataTransfer)) return
    e.preventDefault()
    dragCounter.current += 1
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    if (!hasDraggedFiles(e.dataTransfer)) return
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e) => {
    if (!hasDraggedFiles(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(async (e) => {
    if (!hasDraggedFiles(e.dataTransfer)) return
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return

    const created = await importDroppedFiles(files, maxFileSize, { collectionId: activeCollectionId })
    if (!created.length) return

    setNotes(prev => [...created, ...prev])
    setActiveNoteId(created[0].id)
    clearSearch()
    schedulePersist()
    scheduleSyncPush()
  }, [activeCollectionId, clearSearch, maxFileSize, setActiveNoteId, setNotes])

  return {
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isDragging,
  }
}
