// Returns sections derived from markdown headers (# through ######).
// startLine / endLine are 0-indexed line numbers.
export function parseSections(content) {
  const lines = content.split('\n')
  const sections = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)/)
    if (m) {
      sections.push({ title: m[2].trim(), level: m[1].length, startLine: i, endLine: -1 })
    }
  }

  for (let i = 0; i < sections.length; i++) {
    sections[i].endLine = i + 1 < sections.length
      ? sections[i + 1].startLine - 1
      : lines.length - 1
  }

  return sections
}

// Maps findResults [{start,end}] onto sections, returning only sections that have hits.
// Returns [{...section, matchCount, firstMatchResultIdx}].
export function matchesToSections(findResults, sections, content) {
  if (!findResults.length || !sections.length) return []

  // Build line-start offsets once, then binary-search per match
  const lineStarts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1)
  }

  const getLine = (offset) => {
    let lo = 0, hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const result = sections.map(s => ({ ...s, matchCount: 0, firstMatchResultIdx: -1 }))

  findResults.forEach((match, resultIdx) => {
    const matchLine = getLine(match.start)
    for (let i = 0; i < sections.length; i++) {
      if (matchLine >= sections[i].startLine && matchLine <= sections[i].endLine) {
        result[i].matchCount++
        if (result[i].firstMatchResultIdx === -1) result[i].firstMatchResultIdx = resultIdx
        break
      }
    }
  })

  return result.filter(s => s.matchCount > 0)
}
