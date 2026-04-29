import { useCallback, useState } from 'react'

const EMPTY_SELECTION = { start: 0, end: 0, text: '' }

export function useNoteSelection({
  textareaRef,
  reportCurrentLocation,
  setSnippetSaveOpen,
}) {
  const [sel, setSel] = useState(EMPTY_SELECTION)
  const [txResult, setTxResult] = useState(null)
  const [txCopied, setTxCopied] = useState(false)
  const [calcResult, setCalcResult] = useState(null)
  const [pendingCalc, setPendingCalc] = useState(null)
  const [calcCopied, setCalcCopied] = useState(false)
  const [interactiveTx, setInteractiveTx] = useState(null)
  const [guidCopied, setGuidCopied] = useState(false)
  const [nowInserted, setNowInserted] = useState(false)

  const resetSelectionState = useCallback(() => {
    setSel(EMPTY_SELECTION)
    setTxResult(null)
    setCalcResult(null)
    setPendingCalc(null)
    setInteractiveTx(null)
  }, [])

  const updateSel = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: start, selectionEnd: end } = ta
    if (end > start) {
      setSel({ start, end, text: ta.value.slice(start, end) })
    } else {
      setSel(EMPTY_SELECTION)
    }
    reportCurrentLocation(ta)
  }, [reportCurrentLocation, textareaRef])

  const clearSelIfEmpty = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    if (ta.selectionStart === ta.selectionEnd) {
      setSel(EMPTY_SELECTION)
      setTxResult(null)
      setInteractiveTx(null)
      setSnippetSaveOpen(false)
    }
    reportCurrentLocation(ta)
  }, [reportCurrentLocation, setSnippetSaveOpen, textareaRef])

  return {
    sel,
    setSel,
    txResult,
    setTxResult,
    txCopied,
    setTxCopied,
    calcResult,
    setCalcResult,
    pendingCalc,
    setPendingCalc,
    calcCopied,
    setCalcCopied,
    interactiveTx,
    setInteractiveTx,
    guidCopied,
    setGuidCopied,
    nowInserted,
    setNowInserted,
    resetSelectionState,
    updateSel,
    clearSelIfEmpty,
  }
}
