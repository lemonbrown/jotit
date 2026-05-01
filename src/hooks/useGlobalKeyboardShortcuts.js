import { useEffect } from 'react'

export function useGlobalKeyboardShortcuts({
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
}) {
  useEffect(() => {
    const handler = (e) => {
      const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName)
      const isBackslashShortcut = (e.ctrlKey || e.metaKey) && (e.code === 'Backslash' || e.key === '\\' || e.key === '|')

      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'n') { e.preventDefault(); createNote() }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowUp') { e.preventDefault(); cycleCollection(-1) }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); cycleCollection(1) }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === 'ArrowUp' && !inInput) { e.preventDefault(); cycleNote(-1) }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === 'ArrowDown' && !inInput) { e.preventDefault(); cycleNote(1) }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigateLocationHistory(-1) }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navigateLocationHistory(1) }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); searchRef.current?.focus() }
      if (isBackslashShortcut && e.shiftKey && e.altKey) { e.preventDefault(); toggleNoteListMetadata() }
      else if (isBackslashShortcut && e.shiftKey) { e.preventDefault(); toggleSimpleEditorMode() }
      else if (isBackslashShortcut && e.altKey) { e.preventDefault(); toggleCommandToolbars() }
      else if (isBackslashShortcut) { e.preventDefault(); toggleNotesPane() }
      if (e.key === 'Escape') {
        clearSearch()
        setShowSettings(false)
        setShowHelp(false)
        setShowSnippets(false)
        setShowTemplates(false)
        setShowSharedLinks(false)
      }
      if (e.key === '?' && !inInput) { e.preventDefault(); setShowHelp(h => !h) }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
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
  ])
}
