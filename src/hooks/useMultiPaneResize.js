import { useCallback, useEffect, useRef, useState } from 'react'

export function useMultiPaneResize(defaultWidth, minWidth) {
  const [paneWidths, setPaneWidths] = useState({})
  const paneWidthsRef = useRef({})

  useEffect(() => { paneWidthsRef.current = paneWidths }, [paneWidths])

  const startPaneResize = useCallback((paneId, e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = paneWidthsRef.current[paneId] ?? defaultWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev) => {
      const next = Math.max(minWidth, startWidth + (ev.clientX - startX))
      setPaneWidths(prev => ({ ...prev, [paneId]: next }))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [defaultWidth, minWidth])

  const prunePaneWidths = useCallback((paneIds) => {
    const ids = new Set(paneIds)
    setPaneWidths(prev => {
      const hasStale = Object.keys(prev).some(id => !ids.has(id))
      if (!hasStale) return prev
      const cleaned = {}
      for (const [id, width] of Object.entries(prev)) {
        if (ids.has(id)) cleaned[id] = width
      }
      return cleaned
    })
  }, [])

  return { paneWidths, startPaneResize, prunePaneWidths }
}
