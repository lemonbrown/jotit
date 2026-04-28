import { useState, useCallback, useRef, useEffect } from 'react'

export function usePaneResize(storageKey, defaultSize, min = 100, max = 1200) {
  const [size, setSize] = useState(() => {
    if (!storageKey) return defaultSize
    const stored = localStorage.getItem(storageKey)
    return stored ? Math.min(max, Math.max(min, Number(stored))) : defaultSize
  })

  const sizeRef = useRef(size)
  useEffect(() => { sizeRef.current = size }, [size])

  const startDrag = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startSize = sizeRef.current

    const onMove = (ev) => {
      const next = Math.min(max, Math.max(min, startSize + ev.clientX - startX))
      setSize(next)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (storageKey) localStorage.setItem(storageKey, String(sizeRef.current))
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [min, max, storageKey])

  return { size, startDrag }
}
