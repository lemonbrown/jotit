import { useCallback, useRef } from 'react'

const MAX_HISTORY_ENTRIES = 200
const HISTORY_DEBOUNCE_MS = 300

function appendHistory(historyRef, historyIdxRef, text) {
  const idx = historyIdxRef.current
  if (historyRef.current[idx] === text) return
  const next = historyRef.current.slice(0, idx + 1)
  next.push(text)
  if (next.length > MAX_HISTORY_ENTRIES) next.splice(0, next.length - MAX_HISTORY_ENTRIES)
  historyRef.current = next
  historyIdxRef.current = next.length - 1
}

export function useNoteEditorHistory({
  initialContent,
  setContent,
  onUpdate,
  codeViewActive,
  setCodeContent,
}) {
  const historyRef = useRef([initialContent])
  const historyIdxRef = useRef(0)
  const historyTimerRef = useRef(null)

  const resetHistory = useCallback((text) => {
    clearTimeout(historyTimerRef.current)
    historyRef.current = [text]
    historyIdxRef.current = 0
  }, [])

  const pushHistory = useCallback((text) => {
    clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => {
      appendHistory(historyRef, historyIdxRef, text)
    }, HISTORY_DEBOUNCE_MS)
  }, [])

  const pushHistoryNow = useCallback((text) => {
    clearTimeout(historyTimerRef.current)
    appendHistory(historyRef, historyIdxRef, text)
  }, [])

  const undo = useCallback(() => {
    clearTimeout(historyTimerRef.current)
    const idx = historyIdxRef.current
    if (idx <= 0) return
    historyIdxRef.current = idx - 1
    const prev = historyRef.current[idx - 1]
    setContent(prev)
    onUpdate({ content: prev })
    if (codeViewActive) setCodeContent(prev)
  }, [codeViewActive, onUpdate, setCodeContent, setContent])

  const redo = useCallback(() => {
    clearTimeout(historyTimerRef.current)
    const idx = historyIdxRef.current
    if (idx >= historyRef.current.length - 1) return
    historyIdxRef.current = idx + 1
    const next = historyRef.current[idx + 1]
    setContent(next)
    onUpdate({ content: next })
    if (codeViewActive) setCodeContent(next)
  }, [codeViewActive, onUpdate, setCodeContent, setContent])

  return {
    pushHistory,
    pushHistoryNow,
    resetHistory,
    undo,
    redo,
  }
}
