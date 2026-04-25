import { useEffect, useMemo, useState } from 'react'

function snippetLabel(snippet) {
  if (snippet.name?.trim()) return snippet.name.trim()
  const firstLine = snippet.content.split('\n').find(line => line.trim()) ?? snippet.content
  return firstLine.trim().slice(0, 64) || 'untitled snippet'
}

export default function SnippetManager({ snippets, onClose, onDelete, onRename }) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [draftName, setDraftName] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return snippets
    return snippets.filter(snippet => {
      const name = (snippet.name ?? '').toLowerCase()
      const content = snippet.content.toLowerCase()
      return name.includes(q) || content.includes(q)
    })
  }, [query, snippets])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-6" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
          <h2 className="text-base font-semibold text-zinc-100">Snippets</h2>
          <span className="text-[11px] text-zinc-600 font-mono">{snippets.length}</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search snippets"
            className="ml-auto w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500"
          />
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">
            ×
          </button>
        </div>

        <div className="overflow-auto">
          {filtered.length ? filtered.map(snippet => (
            <div key={snippet.id} className="px-4 py-3 border-b border-zinc-900/80">
              <div className="flex items-center gap-2">
                {editingId === snippet.id ? (
                  <input
                    autoFocus
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        onRename(snippet.id, draftName)
                        setEditingId(null)
                      }
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    onBlur={() => {
                      onRename(snippet.id, draftName)
                      setEditingId(null)
                    }}
                    placeholder="optional name"
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm font-mono text-zinc-200 outline-none focus:border-zinc-500"
                  />
                ) : (
                  <span className="text-sm text-zinc-100 font-mono truncate">{snippetLabel(snippet)}</span>
                )}
                <span className="text-[10px] text-zinc-700 font-mono">{new Date(snippet.updatedAt).toLocaleDateString()}</span>
                <button
                  onClick={() => {
                    setEditingId(snippet.id)
                    setDraftName(snippet.name ?? '')
                  }}
                  className="ml-auto px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded transition-colors"
                >
                  rename
                </button>
                <button
                  onClick={() => onDelete(snippet.id)}
                  className="px-2 py-1 text-[11px] font-mono text-red-400 hover:text-red-300 border border-red-950 hover:border-red-800 rounded transition-colors"
                >
                  delete
                </button>
              </div>
              <pre className="mt-2 note-content text-[12px] text-zinc-500 whitespace-pre-wrap overflow-auto m-0">
                {snippet.content}
              </pre>
            </div>
          )) : (
            <div className="px-4 py-8 text-sm text-zinc-600 text-center">No snippets found.</div>
          )}
        </div>
      </div>
    </div>
  )
}
