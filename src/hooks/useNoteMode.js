import { useEffect, useState } from 'react'

export function useNoteMode({ onDiffModeChange }) {
  const [mode, setMode] = useState('edit')
  const [diffCapture, setDiffCapture] = useState(null)
  const [diffInstance, setDiffInstance] = useState(0)
  const [diffPendingNote, setDiffPendingNote] = useState(null)
  const [codeBefore, setCodeBefore] = useState('')
  const [codeAfter, setCodeAfter] = useState('')

  useEffect(() => {
    if (mode === 'diff') {
      onDiffModeChange?.((note) => setDiffPendingNote(note))
    } else {
      onDiffModeChange?.(null)
    }
    return () => onDiffModeChange?.(null)
  }, [mode, onDiffModeChange])

  return {
    mode,
    setMode,
    diffCapture,
    setDiffCapture,
    diffInstance,
    setDiffInstance,
    diffPendingNote,
    setDiffPendingNote,
    codeBefore,
    setCodeBefore,
    codeAfter,
    setCodeAfter,
  }
}
