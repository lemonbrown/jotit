import { useEffect, useMemo, useState } from 'react'
import { contentHash, scanForSecrets } from '../utils/secretScanner.js'

const EMPTY_FLAGGED_IDS = new Set()

export function scanNotesForSecrets(notes, enabled = false) {
  if (!enabled || !Array.isArray(notes) || !notes.length) {
    return { flaggedNoteIds: EMPTY_FLAGGED_IDS, flaggedCount: 0 }
  }

  const flaggedNoteIds = new Set()
  for (const note of notes) {
    if (!note?.id) continue
    const content = note.content ?? ''
    if (note.secretsClearedHash && note.secretsClearedHash === contentHash(content)) continue
    if (scanForSecrets(content).length) flaggedNoteIds.add(note.id)
  }

  return { flaggedNoteIds, flaggedCount: flaggedNoteIds.size }
}

export function useSecretScan(notes, { secretScanEnabled = false, debounceMs = 250 } = {}) {
  const [scanResult, setScanResult] = useState(() => scanNotesForSecrets(notes, secretScanEnabled))
  const noteSignature = useMemo(
    () => !secretScanEnabled ? '' : (notes ?? [])
      .map(note => `${note.id}:${note.secretsClearedHash ?? ''}:${note.content?.length ?? 0}:${contentHash(note.content ?? '')}`)
      .join('|'),
    [notes, secretScanEnabled]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setScanResult(scanNotesForSecrets(notes, secretScanEnabled))
    }, debounceMs)

    return () => window.clearTimeout(timer)
  }, [debounceMs, noteSignature, notes, secretScanEnabled])

  return scanResult
}
