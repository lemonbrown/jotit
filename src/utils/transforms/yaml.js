import YAML from 'yaml'

function looksLikeYaml(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  let signalCount = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (/^[A-Za-z0-9_.'"-]+\s*:\s*(?:$|[^\[{/])/.test(line)) signalCount += 1
    if (/^-\s+/.test(line)) signalCount += 1
    if (/^---$|^\.\.\.$/.test(line)) signalCount += 1
    if (line.includes(': ') && !line.includes('{') && !line.includes('}')) signalCount += 1
    if (signalCount >= 2) return true
  }

  return false
}

export function prettifyYamlLike(input) {
  try {
    const doc = YAML.parseDocument(String(input ?? ''))
    if (doc.errors?.length) {
      throw doc.errors[0]
    }
    return String(doc.toString({ indent: 2, lineWidth: 0 })).trimEnd()
  } catch (parseError) {
    // Fall back to heuristic normalization for YAML-like text that is not valid YAML yet.
  }

  const rawLines = String(input ?? '').replace(/\r\n/g, '\n').split('\n')
  if (!rawLines.some(line => line.trim())) throw new Error('No YAML content')
  if (!looksLikeYaml(input)) throw new Error('Does not look like YAML')

  const indentWidths = [...new Set(
    rawLines
      .filter(line => line.trim() && !line.trimStart().startsWith('#'))
      .map(line => (line.match(/^ */)?.[0].length ?? 0))
      .filter(width => width > 0)
  )].sort((a, b) => a - b)

  const normalizedIndent = new Map(indentWidths.map((width, index) => [width, '  '.repeat(index + 1)]))

  return rawLines.map(rawLine => {
    const trimmedRight = rawLine.replace(/[ \t]+$/g, '')
    const trimmed = trimmedRight.trim()
    if (!trimmed) return ''
    if (trimmed === '---' || trimmed === '...') return trimmed

    const indentWidth = trimmedRight.match(/^ */)?.[0].length ?? 0
    const nextIndent = indentWidth > 0 ? (normalizedIndent.get(indentWidth) ?? '') : ''

    if (trimmed.startsWith('#')) {
      return `${nextIndent}${trimmed}`
    }

    return `${nextIndent}${trimmed}`
  }).join('\n')
}
