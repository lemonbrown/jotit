export function isCodeOutlineLanguage(language) {
  return language === 'javascript' || language === 'typescript'
}

export function classifyCodeSymbol(line) {
  const trimmed = line.trim()
  if (!trimmed || !trimmed.includes('{')) return null

  let match = trimmed.match(/^(?:else\s+)?if\b/)
  if (match) return { kind: 'statement', label: 'if', showInPane: false }

  match = trimmed.match(/^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/)
  if (match) return { kind: 'class', label: match[1] }

  match = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
  if (match) return { kind: 'function', label: match[1] }

  match = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/)
  if (match) return { kind: 'function', label: match[1] }

  match = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/)
  if (match) return { kind: 'property', label: match[1] }

  match = trimmed.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(/)
  if (match) {
    const segments = match[1].split('.')
    return { kind: 'call', label: segments[segments.length - 1] }
  }

  match = trimmed.match(/^(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^=]*\)\s*\{/)
  if (match) return { kind: 'method', label: match[1] }

  match = trimmed.match(/^(for|while|switch|try|catch|finally|do)\b/)
  if (match) return { kind: 'statement', label: match[1], showInPane: false }

  return null
}

export function parseCodeSymbols(text, language) {
  if (!isCodeOutlineLanguage(language)) return []

  const lines = String(text ?? '').split('\n')
  const symbols = []
  const stack = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const candidate = classifyCodeSymbol(line)
    let assignedCandidate = false

    for (const char of line) {
      if (char === '{') {
        stack.push({
          candidate: !assignedCandidate ? candidate : null,
          lineIndex,
        })
        if (candidate && !assignedCandidate) assignedCandidate = true
      } else if (char === '}') {
        const open = stack.pop()
        if (!open?.candidate) continue
        if (lineIndex <= open.lineIndex) continue

        const symbol = {
          id: `${open.candidate.kind}:${open.lineIndex}:${open.candidate.label}`,
          kind: open.candidate.kind,
          label: open.candidate.label,
          showInPane: open.candidate.showInPane !== false,
          startLine: open.lineIndex,
          endLine: lineIndex,
        }
        symbols.push(symbol)
      }
    }
  }

  return symbols.sort((a, b) => (
    a.startLine - b.startLine ||
    b.endLine - a.endLine
  ))
}

export function buildCollapsedCodeView(text, symbols, collapsedIds) {
  const lines = String(text ?? '').split('\n')
  const collapsed = symbols.filter(symbol => collapsedIds[symbol.id])
  if (!collapsed.length) {
    return {
      foldedSymbols: [],
      visibleLineNumbers: lines.map((_, index) => index + 1),
      text: String(text ?? ''),
    }
  }

  const collapsedByStartLine = new Map(
    collapsed
      .filter(symbol => symbol.endLine > symbol.startLine)
      .map(symbol => [symbol.startLine, symbol])
  )

  const visibleLines = []
  const visibleLineNumbers = []

  for (let lineIndex = 0; lineIndex < lines.length;) {
    const symbol = collapsedByStartLine.get(lineIndex)
    if (symbol) {
      const hiddenCount = symbol.endLine - symbol.startLine
      visibleLines.push(`// ... ${symbol.kind} ${symbol.label} (${hiddenCount} line${hiddenCount === 1 ? '' : 's'})`)
      visibleLineNumbers.push(lineIndex + 1)
      lineIndex = symbol.endLine + 1
      continue
    }

    visibleLines.push(lines[lineIndex])
    visibleLineNumbers.push(lineIndex + 1)
    lineIndex += 1
  }

  return {
    foldedSymbols: collapsed,
    visibleLineNumbers,
    text: visibleLines.join('\n'),
  }
}
