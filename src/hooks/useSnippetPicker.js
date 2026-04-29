import { useCallback, useState } from 'react'

export function useSnippetPicker({
  textareaRef,
}) {
  const [snippetPicker, setSnippetPicker] = useState(null)
  const [snippetResults, setSnippetResults] = useState([])
  const [templateResults, setTemplateResults] = useState([])
  const [snippetActiveIndex, setSnippetActiveIndex] = useState(0)
  const [tabStops, setTabStops] = useState(null)

  const closeSnippetPicker = useCallback(() => {
    setSnippetPicker(null)
    setSnippetResults([])
    setTemplateResults([])
    setSnippetActiveIndex(0)
  }, [])

  const advanceTabStop = useCallback((direction = 1) => {
    const ta = textareaRef.current
    if (!ta || !tabStops) return
    const { stops, current } = tabStops
    const cursorEnd = Math.max(ta.selectionStart, ta.selectionEnd)
    const delta = cursorEnd - stops[current].end
    const next = current + direction
    if (next >= stops.length || next < 0) {
      setTabStops(null)
      return
    }
    const newStops = stops.map((s, i) => {
      if (i < current) return s
      if (i === current) return { ...s, end: cursorEnd }
      return { ...s, start: s.start + delta, end: s.end + delta }
    })
    setTabStops({ stops: newStops, current: next })
    requestAnimationFrame(() => {
      ta.selectionStart = newStops[next].start
      ta.selectionEnd = newStops[next].end
    })
  }, [tabStops, textareaRef])

  return {
    snippetPicker,
    setSnippetPicker,
    snippetResults,
    setSnippetResults,
    templateResults,
    setTemplateResults,
    snippetActiveIndex,
    setSnippetActiveIndex,
    tabStops,
    setTabStops,
    closeSnippetPicker,
    advanceTabStop,
  }
}
