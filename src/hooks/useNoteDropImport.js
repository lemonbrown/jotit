import { useCallback, useRef, useState } from 'react'
import { schedulePersist } from '../utils/db'
import { scheduleSyncPush } from '../utils/sync'
import { importDroppedFiles } from '../utils/importNotes'

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
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current += 1
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    dragCounter.current -= 1
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
