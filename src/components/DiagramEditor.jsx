import { useMemo, useRef, useState } from 'react'
import { generateId } from '../utils/helpers'

const TOOLS = [
  ['select', 'Select'],
  ['box', 'Box'],
  ['round', 'Round'],
  ['circle', 'Circle'],
  ['diamond', 'Diamond'],
  ['text', 'Text'],
  ['link', 'Link'],
]

const DEFAULT_NODE = {
  box: { w: 160, h: 70, text: 'Box' },
  round: { w: 170, h: 72, text: 'Rounded' },
  circle: { w: 110, h: 110, text: 'Circle' },
  diamond: { w: 140, h: 100, text: 'Decision' },
  text: { w: 180, h: 50, text: 'Text' },
}

export default function DiagramEditor({ initialDiagram, onApply, onCancel }) {
  const [diagram, setDiagram] = useState(initialDiagram)
  const [tool, setTool] = useState('select')
  const [selected, setSelected] = useState(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState([])
  const [drag, setDrag] = useState(null)
  const [marquee, setMarquee] = useState(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panDrag, setPanDrag] = useState(null)
  const [linkFrom, setLinkFrom] = useState(null)
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [editingNodeId, setEditingNodeId] = useState(null)
  const svgRef = useRef(null)

  const nodesById = useMemo(() => Object.fromEntries(diagram.nodes.map(n => [n.id, n])), [diagram.nodes])

  const commit = (next) => {
    setUndoStack(prev => [...prev.slice(-49), diagram])
    setRedoStack([])
    setDiagram(next)
  }

  const updateNode = (id, patch, saveUndo = true) => {
    const next = { ...diagram, nodes: diagram.nodes.map(n => n.id === id ? { ...n, ...patch } : n) }
    if (saveUndo) commit(next)
    else setDiagram(next)
  }

  const addNode = (type, x, y) => {
    const d = DEFAULT_NODE[type]
    const node = {
      id: generateId(),
      type,
      x: Math.round(x - d.w / 2),
      y: Math.round(y - d.h / 2),
      w: d.w,
      h: d.h,
      text: d.text,
      fill: type === 'text' ? 'transparent' : '#18181b',
      stroke: type === 'text' ? 'transparent' : '#52525b',
    }
    commit({ ...diagram, nodes: [...diagram.nodes, node] })
    setSelected({ type: 'node', id: node.id })
    setSelectedNodeIds([node.id])
    setTool('select')
  }

  const deleteSelected = () => {
    if (selectedNodeIds.length) {
      const ids = new Set(selectedNodeIds)
      commit({
        ...diagram,
        nodes: diagram.nodes.filter(n => !ids.has(n.id)),
        edges: diagram.edges.filter(e => !ids.has(e.from) && !ids.has(e.to)),
      })
    } else if (selected?.type === 'edge') {
      commit({ ...diagram, edges: diagram.edges.filter(e => e.id !== selected.id) })
    } else {
      return
    }
    setSelected(null)
    setSelectedNodeIds([])
  }

  const undo = () => {
    setUndoStack(prev => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]
      setRedoStack(r => [...r, diagram])
      setDiagram(last)
      return prev.slice(0, -1)
    })
  }

  const redo = () => {
    setRedoStack(prev => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]
      setUndoStack(u => [...u, diagram])
      setDiagram(last)
      return prev.slice(0, -1)
    })
  }

  const canvasPoint = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left - pan.x, y: e.clientY - rect.top - pan.y }
  }

  const screenPoint = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleCanvasDown = (e) => {
    if (e.button === 1) {
      e.preventDefault()
      setPanDrag({ start: screenPoint(e), origin: pan })
      return
    }
    if (e.target.dataset.canvas !== 'true') return
    const p = canvasPoint(e)
    if (tool !== 'select' && tool !== 'link') addNode(tool, p.x, p.y)
    else {
      setSelected(null)
      setSelectedNodeIds([])
      setMarquee({ startX: p.x, startY: p.y, x: p.x, y: p.y })
    }
  }

  const handleNodeDown = (e, node) => {
    e.stopPropagation()
    if (e.button === 1) {
      e.preventDefault()
      setPanDrag({ start: screenPoint(e), origin: pan })
      return
    }
    if (editingNodeId === node.id) return
    if (tool === 'link') {
      if (!linkFrom) {
        setLinkFrom(node.id)
      } else if (linkFrom !== node.id) {
        commit({ ...diagram, edges: [...diagram.edges, { id: generateId(), from: linkFrom, to: node.id, label: '', style: 'arrow' }] })
        setLinkFrom(null)
        setTool('select')
      }
      return
    }
    const nodeIds = selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id]
    setSelected({ type: 'node', id: node.id })
    setSelectedNodeIds(nodeIds)
    const p = canvasPoint(e)
    setDrag({
      ids: nodeIds,
      anchorId: node.id,
      dx: p.x - node.x,
      dy: p.y - node.y,
      origins: Object.fromEntries(diagram.nodes.filter(n => nodeIds.includes(n.id)).map(n => [n.id, { x: n.x, y: n.y }])),
      startPointer: p,
      start: diagram,
    })
  }

  const handleMove = (e) => {
    if (panDrag) {
      const p = screenPoint(e)
      setPan({
        x: panDrag.origin.x + p.x - panDrag.start.x,
        y: panDrag.origin.y + p.y - panDrag.start.y,
      })
      return
    }
    const p = canvasPoint(e)
    if (marquee) {
      const next = { ...marquee, x: p.x, y: p.y }
      setMarquee(next)
      const x1 = Math.min(next.startX, next.x)
      const y1 = Math.min(next.startY, next.y)
      const x2 = Math.max(next.startX, next.x)
      const y2 = Math.max(next.startY, next.y)
      const ids = diagram.nodes
        .filter(n => n.x < x2 && n.x + n.w > x1 && n.y < y2 && n.y + n.h > y1)
        .map(n => n.id)
      setSelectedNodeIds(ids)
      setSelected(ids.length === 1 ? { type: 'node', id: ids[0] } : null)
      return
    }
    if (!drag) return
    const anchor = nodesById[drag.anchorId]
    if (!anchor) return
    const nextAnchorX = Math.round(p.x - drag.dx)
    const nextAnchorY = Math.round(p.y - drag.dy)
    const deltaX = nextAnchorX - drag.origins[drag.anchorId].x
    const deltaY = nextAnchorY - drag.origins[drag.anchorId].y
    setDiagram({
      ...diagram,
      nodes: diagram.nodes.map(n => drag.ids.includes(n.id)
        ? { ...n, x: drag.origins[n.id].x + deltaX, y: drag.origins[n.id].y + deltaY }
        : n
      ),
    })
  }

  const handleUp = () => {
    if (panDrag) {
      setPanDrag(null)
      return
    }
    if (marquee) {
      setMarquee(null)
      return
    }
    if (drag) {
      setUndoStack(prev => [...prev.slice(-49), drag.start])
      setRedoStack([])
      setDrag(null)
    }
  }

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected() }
    if (e.key === 'Escape') { setTool('select'); setSelected(null); setSelectedNodeIds([]); setLinkFrom(null); setMarquee(null); setEditingNodeId(null) }
  }

  const renderNode = (node) => {
    const isSelected = selectedNodeIds.includes(node.id) || (selected?.type === 'node' && selected.id === node.id)
    const stroke = isSelected || linkFrom === node.id ? '#60a5fa' : node.stroke
    const common = { fill: node.fill, stroke, strokeWidth: isSelected ? 2 : 1.5 }
    const cx = node.x + node.w / 2
    const cy = node.y + node.h / 2

    return (
      <g key={node.id} onMouseDown={e => handleNodeDown(e, node)} className="cursor-move">
        {node.type === 'circle' && <ellipse cx={cx} cy={cy} rx={node.w / 2} ry={node.h / 2} {...common} />}
        {node.type === 'diamond' && <polygon points={`${cx},${node.y} ${node.x + node.w},${cy} ${cx},${node.y + node.h} ${node.x},${cy}`} {...common} />}
        {node.type === 'round' && <rect x={node.x} y={node.y} width={node.w} height={node.h} rx="14" {...common} />}
        {node.type === 'box' && <rect x={node.x} y={node.y} width={node.w} height={node.h} rx="4" {...common} />}
        {node.type === 'text' && <rect x={node.x} y={node.y} width={node.w} height={node.h} fill="transparent" stroke={isSelected ? '#60a5fa' : 'transparent'} strokeWidth="1.5" />}
        <foreignObject x={node.x + 8} y={node.y + 8} width={Math.max(20, node.w - 16)} height={Math.max(20, node.h - 16)}>
          {editingNodeId === node.id ? (
            <textarea
              autoFocus
              value={node.text}
              onMouseDown={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
              onBlur={() => setEditingNodeId(null)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditingNodeId(null)
                }
              }}
              onChange={e => updateNode(node.id, { text: e.target.value })}
              className="w-full h-full resize-none bg-zinc-900/80 text-zinc-100 text-xs font-mono outline-none text-center overflow-hidden border border-blue-800 rounded"
            />
          ) : (
            <div
              onMouseDown={e => handleNodeDown(e, node)}
              onDoubleClick={e => {
                e.stopPropagation()
                setSelected({ type: 'node', id: node.id })
                setSelectedNodeIds([node.id])
                setEditingNodeId(node.id)
              }}
              className="w-full h-full flex items-center justify-center text-zinc-200 text-xs font-mono text-center whitespace-pre-wrap overflow-hidden select-none pointer-events-auto"
            >
              {node.text}
            </div>
          )}
        </foreignObject>
      </g>
    )
  }

  const renderEdge = (edge) => {
    const from = nodesById[edge.from]
    const to = nodesById[edge.to]
    if (!from || !to) return null
    const x1 = from.x + from.w / 2
    const y1 = from.y + from.h / 2
    const x2 = to.x + to.w / 2
    const y2 = to.y + to.h / 2
    const isSelected = selected?.type === 'edge' && selected.id === edge.id
    return (
      <g key={edge.id} onMouseDown={e => { e.stopPropagation(); setSelected({ type: 'edge', id: edge.id }); setSelectedNodeIds([]) }} className="cursor-pointer">
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isSelected ? '#60a5fa' : '#71717a'} strokeWidth={isSelected ? 2.5 : 1.8} markerEnd="url(#arrow)" />
        {edge.label && (
          <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle" className="fill-zinc-400 text-[11px] font-mono">
            {edge.label}
          </text>
        )}
      </g>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-950" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[11px] text-zinc-500 font-mono">Diagram: {diagram.nodes.length} nodes · {diagram.edges.length} links</span>
        <div className="flex items-center gap-1">
          {TOOLS.map(([id, label]) => (
            <button key={id} onClick={() => setTool(id)} className={`px-2 py-1 text-[11px] font-mono rounded border ${tool === id ? 'text-blue-300 bg-blue-950/50 border-blue-800' : 'text-zinc-500 hover:text-zinc-300 border-zinc-800 hover:border-zinc-600'}`}>
              {label}
            </button>
          ))}
        </div>
        {linkFrom && <span className="text-[11px] text-blue-400 font-mono">select target</span>}
        {selectedNodeIds.length > 1 && <span className="text-[11px] text-blue-400 font-mono">{selectedNodeIds.length} selected</span>}
        <button disabled={!selected && !selectedNodeIds.length} onClick={deleteSelected} className="px-2 py-1 text-[11px] font-mono text-zinc-500 hover:text-red-300 border border-zinc-800 hover:border-red-800 rounded disabled:text-zinc-800 disabled:hover:border-zinc-800">
          Delete
        </button>
        <button onClick={() => setPan({ x: 0, y: 0 })} className="px-2 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded">
          Center
        </button>
        <button disabled={!undoStack.length} onClick={undo} className="px-2 py-1 text-[11px] font-mono text-zinc-400 border border-zinc-800 rounded disabled:text-zinc-800">Undo</button>
        <button disabled={!redoStack.length} onClick={redo} className="px-2 py-1 text-[11px] font-mono text-zinc-400 border border-zinc-800 rounded disabled:text-zinc-800">Redo</button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => onApply(diagram)} className="px-2.5 py-1 text-[11px] font-mono text-green-300 border border-green-800 hover:border-green-600 rounded bg-green-950/40">Apply</button>
          <button onClick={onCancel} className="px-2.5 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded">Cancel</button>
        </div>
      </div>
      <svg
        ref={svgRef}
        data-canvas="true"
        onMouseDown={handleCanvasDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        onMouseLeave={handleUp}
        onContextMenu={e => { if (panDrag) e.preventDefault() }}
        className="flex-1 min-h-0 w-full bg-zinc-950"
      >
        <defs>
          <pattern id="grid" x={pan.x % 24} y={pan.y % 24} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#27272a" strokeWidth="1" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#71717a" />
          </marker>
        </defs>
        <rect data-canvas="true" width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${pan.x} ${pan.y})`}>
          {diagram.edges.map(renderEdge)}
          {diagram.nodes.map(renderNode)}
          {marquee && (
            <rect
              x={Math.min(marquee.startX, marquee.x)}
              y={Math.min(marquee.startY, marquee.y)}
              width={Math.abs(marquee.x - marquee.startX)}
              height={Math.abs(marquee.y - marquee.startY)}
              fill="rgba(59, 130, 246, 0.12)"
              stroke="#60a5fa"
              strokeDasharray="4 3"
            />
          )}
        </g>
      </svg>
    </div>
  )
}
