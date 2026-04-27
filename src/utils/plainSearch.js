export function searchNotesPlainText(notes, query) {
  const q = query.toLowerCase()
  const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const results = []

  for (const note of notes) {
    const content = note.content ?? ''
    const lower = content.toLowerCase()
    const idx = lower.indexOf(q)
    if (idx === -1) continue

    const start = Math.max(0, idx - 80)
    const end = Math.min(content.length, idx + query.length + 80)
    let preview = content.slice(start, end).replace(/\n/g, ' ')
    if (start > 0) preview = '…' + preview
    if (end < content.length) preview += '…'

    const matchCount = (lower.match(new RegExp(escapedQ, 'g')) ?? []).length
    const firstLine = content.split('\n')[0] ?? ''
    const reasons = firstLine.toLowerCase().includes(q) ? ['title match'] : []

    results.push({ noteId: note.id, score: matchCount, matchType: 'plain', preview, reasons, matchCount, note })
  }

  return results.sort((a, b) => b.matchCount - a.matchCount)
}
