import { generateId } from './helpers.js'

export function createEmptyDiagram() {
  return {
    version: 1,
    nodes: [
      { id: generateId(), type: 'box', x: 100, y: 100, w: 160, h: 70, text: 'Start', fill: '#18181b', stroke: '#3b82f6' },
    ],
    edges: [],
  }
}

export function serializeDiagramBlock(diagram) {
  return `\`\`\`jotit-diagram\n${JSON.stringify(diagram, null, 2)}\n\`\`\``
}

export function parseDiagramJson(text) {
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('Diagram must be a JSON object')
  if (!Array.isArray(parsed.nodes)) throw new Error('Diagram needs a nodes array')
  if (!Array.isArray(parsed.edges)) parsed.edges = []
  return {
    version: parsed.version ?? 1,
    nodes: parsed.nodes.map(n => ({
      id: String(n.id ?? generateId()),
      type: ['box', 'round', 'circle', 'diamond', 'text'].includes(n.type) ? n.type : 'box',
      x: Number(n.x ?? 100),
      y: Number(n.y ?? 100),
      w: Number(n.w ?? 160),
      h: Number(n.h ?? 70),
      text: String(n.text ?? ''),
      fill: n.fill ?? '#18181b',
      stroke: n.stroke ?? '#52525b',
    })),
    edges: parsed.edges.map(e => ({
      id: String(e.id ?? generateId()),
      from: String(e.from ?? ''),
      to: String(e.to ?? ''),
      label: String(e.label ?? ''),
      style: e.style ?? 'arrow',
    })).filter(e => e.from && e.to),
  }
}

export function findDiagramBlock(text, selectionStart = 0, selectionEnd = 0) {
  const blockRe = /```jotit-diagram\s*\n([\s\S]*?)\n```/g
  let match
  while ((match = blockRe.exec(text)) !== null) {
    const start = match.index
    const end = match.index + match[0].length
    const intersects = selectionStart !== selectionEnd
      ? selectionStart < end && selectionEnd > start
      : selectionStart >= start && selectionStart <= end
    if (intersects) {
      return { start, end, json: match[1], block: match[0] }
    }
  }
  return null
}

export function diagramSessionFromText(text, cursorStart = 0, cursorEnd = 0) {
  const selected = cursorStart !== cursorEnd ? text.slice(cursorStart, cursorEnd) : ''

  if (selected.trim()) {
    try {
      return { start: cursorStart, end: cursorEnd, diagram: parseDiagramJson(selected), isNew: false }
    } catch {}
  }

  const block = findDiagramBlock(text, cursorStart, cursorEnd)
  if (block) {
    return { start: block.start, end: block.end, diagram: parseDiagramJson(block.json), isNew: false }
  }

  return { start: cursorStart, end: cursorEnd, diagram: createEmptyDiagram(), isNew: true }
}
