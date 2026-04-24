import { useState, useRef, useCallback, useMemo } from 'react'

const IMG_MARKER_LINE = /^\[img:\/\/([^\]]+)\]$/

function parseSegments(content) {
  const lines = (content ?? '').split('\n')
  const segs = []
  let textLines = []
  for (const line of lines) {
    const m = line.match(IMG_MARKER_LINE)
    if (m) {
      segs.push({ type: 'text', content: textLines.join('\n') })
      textLines = []
      segs.push({ type: 'image', id: m[1] })
    } else {
      textLines.push(line)
    }
  }
  segs.push({ type: 'text', content: textLines.join('\n') })
  return segs
}

function assembleContent(segs) {
  return segs.map(s => s.type === 'text' ? s.content : `[img://${s.id}]`).join('\n')
}

// Compute line-start numbers and character offsets for each segment
function computeSegmentMeta(segs) {
  let line = 1
  let offset = 0
  return segs.map((seg, i) => {
    const start = { line, offset }
    if (seg.type === 'text') {
      const lineCount = seg.content.split('\n').length
      line += lineCount
      offset += seg.content.length
    } else {
      offset += `[img://${seg.id}]`.length
    }
    if (i < segs.length - 1) offset += 1 // '\n' separator
    return start
  })
}

const GUTTER_STYLE = {
  fontFamily: "'JetBrains Mono','Fira Code',Consolas,monospace",
  fontSize: '13px',
  lineHeight: '1.6',
  color: '#3f3f46',
}

export default function InlineImageEditor({
  content,
  attachmentMap,
  onChangeContent,
  onDeleteAttachment,
  showLineNumbers,
  scrollRef,
  onActiveSegment,
  onKeyDown,
  onPaste,
  onSelect,
  onMouseUp,
  onKeyUp,
  onClick,
}) {
  const [stubsVisible, setStubsVisible] = useState({})

  const segs = useMemo(() => parseSegments(content), [content])
  const meta = useMemo(() => computeSegmentMeta(segs), [segs])

  const totalTextLines = useMemo(
    () => segs.reduce((n, s) => s.type === 'text' ? n + s.content.split('\n').length : n, 0),
    [segs]
  )
  const gutterWidth = `${Math.max(String(totalTextLines).length + 2, 4)}ch`

  // Stable per-segment textarea refs (keyed by stable segment index)
  const taRefs = useRef([])
  const getOrCreateRef = useCallback((i) => {
    if (!taRefs.current[i]) taRefs.current[i] = { current: null }
    return taRefs.current[i]
  }, [])

  const handleFocus = useCallback((segIndex) => {
    onActiveSegment?.(taRefs.current[segIndex]?.current, meta[segIndex]?.offset ?? 0)
  }, [meta, onActiveSegment])

  const handleSegmentChange = useCallback((segIndex, newText) => {
    const newSegs = segs.map((s, i) => i === segIndex ? { ...s, content: newText } : s)
    onChangeContent(assembleContent(newSegs))
  }, [segs, onChangeContent])

  const handleSegmentKeyDown = useCallback((e, segIndex) => {
    const ta = e.target
    // Backspace at absolute start → delete the image immediately before this segment
    if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const prev = segs[segIndex - 1]
      if (prev?.type === 'image') {
        e.preventDefault()
        onDeleteAttachment(prev.id)
        return
      }
    }
    // Delete at absolute end → delete the image immediately after this segment
    if (e.key === 'Delete' && ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length) {
      const next = segs[segIndex + 1]
      if (next?.type === 'image') {
        e.preventDefault()
        onDeleteAttachment(next.id)
        return
      }
    }
    onKeyDown?.(e)
  }, [segs, onDeleteAttachment, onKeyDown])

  const toggleStub = useCallback((id) => {
    setStubsVisible(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  return (
    <div
      ref={scrollRef}
      className="flex flex-col flex-1 overflow-auto"
    >
      {segs.map((seg, i) => {
        const segMeta = meta[i]

        if (seg.type === 'image') {
          const att = attachmentMap?.get(seg.id)
          return (
            <div key={`img-${seg.id}`} className="flex min-w-0 group/imgrow">
              {showLineNumbers && (
                <div
                  className="select-none shrink-0 border-r border-zinc-800/60"
                  style={{ ...GUTTER_STYLE, width: gutterWidth }}
                />
              )}
              <div className="relative flex-1 px-4 py-2">
                {stubsVisible[seg.id] && (
                  <div className="font-mono text-[11px] text-zinc-600 mb-1 select-all">[img://{seg.id}]</div>
                )}
                {att
                  ? <img
                      src={att.data}
                      alt=""
                      className="max-w-full rounded border border-zinc-800/60 block"
                      style={{ maxHeight: '480px', objectFit: 'contain' }}
                    />
                  : <div className="text-xs text-zinc-600 italic py-1">image not found</div>
                }
                <div className="absolute top-2 right-4 hidden group-hover/imgrow:flex items-center gap-1 z-10">
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => toggleStub(seg.id)}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                    title={stubsVisible[seg.id] ? 'Hide marker' : 'Show marker'}
                  >
                    {stubsVisible[seg.id] ? 'hide' : 'stub'}
                  </button>
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => onDeleteAttachment(seg.id)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-700 transition-colors"
                    title="Remove image"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )
        }

        // text segment
        const ref = getOrCreateRef(i)
        const lineCount = seg.content.split('\n').length
        const firstSeg = i === 0
        const lastSeg = i === segs.length - 1

        return (
          <div key={`txt-${i}`} className="flex min-w-0">
            {showLineNumbers && (
              <div
                className="select-none shrink-0 text-right border-r border-zinc-800/60"
                style={{
                  ...GUTTER_STYLE,
                  width: gutterWidth,
                  paddingTop: firstSeg ? '16px' : '4px',
                  paddingBottom: lastSeg ? '16px' : '4px',
                  paddingRight: '12px',
                  paddingLeft: '8px',
                }}
              >
                {Array.from({ length: lineCount }, (_, j) => (
                  <div key={j}>{segMeta.line + j}</div>
                ))}
              </div>
            )}
            <textarea
              ref={el => { ref.current = el }}
              value={seg.content}
              rows={lineCount}
              spellCheck={false}
              placeholder={firstSeg ? 'Start typing…' : ''}
              className="flex-1 bg-transparent text-zinc-300 note-content px-4 resize-none outline-none placeholder-zinc-800 overflow-hidden block"
              style={{
                paddingTop: firstSeg ? '16px' : '4px',
                paddingBottom: lastSeg ? '16px' : '4px',
                lineHeight: '1.6',
              }}
              onChange={e => handleSegmentChange(i, e.target.value)}
              onFocus={() => handleFocus(i)}
              onKeyDown={e => handleSegmentKeyDown(e, i)}
              onPaste={onPaste}
              onSelect={onSelect}
              onMouseUp={onMouseUp}
              onKeyUp={onKeyUp}
              onClick={onClick}
            />
          </div>
        )
      })}
    </div>
  )
}
