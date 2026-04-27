function findFuzzyMatches(text, pattern) {
  const lText = text.toLowerCase()
  const lPattern = pattern.toLowerCase()
  const matches = []
  let searchFrom = 0

  while (searchFrom < lText.length && matches.length < 5000) {
    const firstIdx = lText.indexOf(lPattern[0], searchFrom)
    if (firstIdx === -1) break

    let pi = 1, j = firstIdx + 1
    while (j < lText.length && pi < lPattern.length) {
      if (lText[j] === lPattern[pi]) pi++
      j++
    }

    if (pi === lPattern.length) {
      matches.push({ start: firstIdx, end: j })
      searchFrom = firstIdx + 1
    } else {
      break
    }
  }

  return matches
}

// Returns [{start, end}] or null when mode is 'regex' and pattern is invalid.
export function findMatches(content, query, mode) {
  if (!query || !content) return []

  if (mode === 'exact') {
    const lText = content.toLowerCase()
    const lQuery = query.toLowerCase()
    const matches = []
    let idx = 0
    while (matches.length < 5000) {
      const pos = lText.indexOf(lQuery, idx)
      if (pos === -1) break
      matches.push({ start: pos, end: pos + query.length })
      idx = pos + 1
    }
    return matches
  }

  if (mode === 'fuzzy') {
    if (query.length < 2) return []
    return findFuzzyMatches(content, query)
  }

  if (mode === 'regex') {
    try {
      const re = new RegExp(query, 'gi')
      const matches = []
      let m
      while ((m = re.exec(content)) !== null && matches.length < 5000) {
        matches.push({ start: m.index, end: m.index + m[0].length })
        if (m[0].length === 0) re.lastIndex++
      }
      return matches
    } catch {
      return null
    }
  }

  return []
}

export function isValidRegex(query) {
  if (!query) return true
  try { new RegExp(query); return true } catch { return false }
}

// Parses "in:code <term>" or "in:text <term>" prefixes.
// Returns { scope: 'all'|'code'|'text', term: string }.
export function parseSearchScope(query) {
  const m = query.match(/^in:(code|text)\s+([\s\S]*)$/i)
  if (m) return { scope: m[1].toLowerCase(), term: m[2] }
  return { scope: 'all', term: query }
}

// Splits content into fenced-code-block and prose segments, returning
// [{type:'code'|'text', start, end}] with absolute character offsets.
export function splitCodeBlocks(content) {
  const segments = []
  // Matches ``` (optional lang) newline ... closing ``` at line start
  const fenceRe = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm
  let lastIdx = 0
  let m

  while ((m = fenceRe.exec(content)) !== null) {
    if (m.index > lastIdx) {
      segments.push({ type: 'text', start: lastIdx, end: m.index })
    }
    segments.push({ type: 'code', start: m.index, end: m.index + m[0].length })
    lastIdx = m.index + m[0].length
  }

  if (lastIdx < content.length) {
    segments.push({ type: 'text', start: lastIdx, end: content.length })
  }

  return segments
}

// Replace all occurrences of term in content within the given scope.
// Returns { content: string, count: number }.
export function applyReplaceAll(content, term, scope, mode, replacement) {
  const matches = findMatchesScoped(content, term, scope, mode) ?? []
  if (!matches.length) return { content, count: 0 }
  let result = ''
  let last = 0
  for (const { start, end } of matches) {
    result += content.slice(last, start)
    if (mode === 'regex') {
      try {
        result += content.slice(start, end).replace(new RegExp(term), replacement)
      } catch { result += replacement }
    } else {
      result += replacement
    }
    last = end
  }
  result += content.slice(last)
  return { content: result, count: matches.length }
}

// Like findMatches but restricts to 'code' or 'text' segments.
// scope 'all' delegates directly to findMatches.
export function findMatchesScoped(content, term, scope, mode) {
  if (scope === 'all') return findMatches(content, term, mode)

  const segments = splitCodeBlocks(content).filter(s => s.type === scope)
  const all = []

  for (const seg of segments) {
    const local = findMatches(content.slice(seg.start, seg.end), term, mode)
    if (local === null) return null // regex error
    for (const m of local) {
      all.push({ start: seg.start + m.start, end: seg.start + m.end })
    }
  }

  return all
}
