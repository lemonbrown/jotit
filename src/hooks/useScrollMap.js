import { useRef, useEffect, useCallback, useState } from 'react'

export const MINIMAP_WIDTH = 100
const PAD_LEFT = 6
const MAX_CHARS = 160
const MAX_STRIDE = 4  // px per line ceiling — short docs sit at top, not stretched

function lineColor(line) {
  if (!line.trim()) return null
  if (/^#{1,6}\s/.test(line)) return '#d4d4d8'
  if (/^`{3}/.test(line)) return '#52525b'
  return '#71717a'
}

function drawLines(ctx, lines, width, stride) {
  const fontSize = Math.max(1.5, stride * 0.85)
  const usable = width - PAD_LEFT - 4
  const maxChars = Math.ceil(usable / (fontSize * 0.55))
  ctx.clearRect(0, 0, width, ctx.canvas.height)
  ctx.textBaseline = 'top'
  ctx.font = `${fontSize}px monospace`
  for (let i = 0; i < lines.length; i++) {
    const color = lineColor(lines[i])
    if (!color) continue
    ctx.fillStyle = color
    ctx.fillText(lines[i].substring(0, maxChars), PAD_LEFT, i * stride)
  }
}

export function useScrollMap(textareaRef, content, enabled) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const docPxHeightRef = useRef(0)
  const [viewportStyle, setViewportStyle] = useState({ top: 0, height: 0 })

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const h = container.clientHeight
    if (!h) return
    const lines = String(content ?? '').split('\n')
    const stride = Math.min(h / lines.length, MAX_STRIDE)
    docPxHeightRef.current = lines.length * stride
    canvas.width = MINIMAP_WIDTH
    canvas.height = h
    drawLines(canvas.getContext('2d'), lines, MINIMAP_WIDTH, stride)
  }, [content])

  const syncViewport = useCallback(() => {
    const ta = textareaRef.current
    const docPxH = docPxHeightRef.current
    if (!ta || !docPxH) return
    const { scrollTop, scrollHeight, clientHeight } = ta
    if (!scrollHeight) return
    setViewportStyle({
      top: Math.round((scrollTop / scrollHeight) * docPxH),
      height: Math.max(8, Math.round((clientHeight / scrollHeight) * docPxH)),
    })
  }, [textareaRef])

  useEffect(() => {
    if (!enabled) return
    redraw()
    syncViewport()
  }, [content, enabled, redraw, syncViewport])

  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => { redraw(); syncViewport() })
    ro.observe(container)
    return () => ro.disconnect()
  }, [enabled, redraw, syncViewport])

  useEffect(() => {
    if (!enabled) return
    const ta = textareaRef.current
    if (!ta) return
    ta.addEventListener('scroll', syncViewport, { passive: true })
    return () => ta.removeEventListener('scroll', syncViewport)
  }, [enabled, textareaRef, syncViewport])

  const handlePointerDown = useCallback((e) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)

    const scrollTo = (clientY) => {
      const ta = textareaRef.current
      const docPxH = docPxHeightRef.current
      if (!ta || !docPxH) return
      const rect = el.getBoundingClientRect()
      if (!rect.height) return
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / docPxH))
      ta.scrollTop = Math.max(0, ratio * ta.scrollHeight - ta.clientHeight / 2)
    }

    scrollTo(e.clientY)

    const onMove = (ev) => scrollTo(ev.clientY)
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }, [textareaRef])

  return { canvasRef, containerRef, viewportStyle, handlePointerDown }
}
