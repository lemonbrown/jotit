import { useEffect, useState } from 'react'

export default function SharedLinksModal({ onListSharedLinks, onDeleteSharedLink, onClose }) {
  const [links, setLinks] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [removingSlug, setRemovingSlug] = useState(null)
  const [removingAll, setRemovingAll] = useState(false)

  const loadLinks = async () => {
    if (!onListSharedLinks) return
    setLoading(true)
    setError(null)
    try {
      const result = await onListSharedLinks()
      if (result?.ok) setLinks(result.links ?? [])
      else setError(result?.error ?? 'Failed to load shared links')
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (slug) => {
    if (!slug || !onDeleteSharedLink) return
    const confirmed = window.confirm(`Remove shared link /n/${slug}? This will break the public URL.`)
    if (!confirmed) return
    setRemovingSlug(slug)
    setError(null)
    try {
      const result = await onDeleteSharedLink(slug)
      if (!result?.ok) {
        setError(result?.error ?? 'Failed to remove shared link')
        return
      }
      setLinks(current => current.filter(link => link.slug !== slug))
    } finally {
      setRemovingSlug(null)
    }
  }

  const handleRemoveAll = async () => {
    if (!links.length || !onDeleteSharedLink) return
    const confirmed = window.confirm(`Remove all ${links.length} shared link${links.length !== 1 ? 's' : ''}? All public URLs will break.`)
    if (!confirmed) return
    setRemovingAll(true)
    setError(null)
    const failed = []
    for (const link of links) {
      const result = await onDeleteSharedLink(link.slug)
      if (result?.ok) {
        setLinks(current => current.filter(l => l.slug !== link.slug))
      } else {
        failed.push(link.slug)
      }
    }
    setRemovingAll(false)
    if (failed.length) setError(`Failed to remove ${failed.length} link${failed.length !== 1 ? 's' : ''}: ${failed.join(', ')}`)
  }

  useEffect(() => {
    loadLinks()
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-6"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
          <h2 className="text-base font-semibold text-zinc-100">Shared Links</h2>
          <span className="text-[11px] text-zinc-600 font-mono">{links.length}</span>
          <button
            onClick={loadLinks}
            disabled={loading || removingAll}
            className="ml-auto px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            onClick={handleRemoveAll}
            disabled={!links.length || removingAll || loading}
            className="px-3 py-1.5 text-xs bg-red-950 hover:bg-red-900 border border-red-900 text-red-200 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {removingAll ? 'Removing...' : 'Delete all'}
          </button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">
            ×
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {loading && !links.length ? (
            <div className="px-4 py-8 text-[11px] font-mono text-zinc-500 text-center">Loading shared links...</div>
          ) : links.length ? (
            <div className="divide-y divide-zinc-900">
              {links.map(link => {
                const absoluteUrl = `${window.location.origin}${link.url}`
                return (
                  <div key={link.slug} className="px-4 py-3 space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-zinc-200 truncate">{link.title}</div>
                        <div className="text-[11px] text-zinc-500 font-mono truncate">{link.url}</div>
                      </div>
                      <button
                        onClick={() => handleRemove(link.slug)}
                        disabled={removingSlug === link.slug || removingAll}
                        className="px-2.5 py-1.5 text-[11px] bg-red-950 hover:bg-red-900 border border-red-900 text-red-200 rounded-md transition-colors disabled:opacity-50 shrink-0"
                      >
                        {removingSlug === link.slug ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                    {link.preview && (
                      <div className="text-[11px] text-zinc-600 line-clamp-2">{link.preview}</div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-zinc-700 font-mono">
                        {link.viewMode === 'bundle' ? `${link.noteCount ?? 0} notes` : `note ${link.noteId}`}
                      </span>
                      {link.viewMode && (
                        <span className="text-[10px] text-zinc-700 font-mono">{link.viewMode}</span>
                      )}
                      {link.publishedAt > 0 && (
                        <span className="text-[10px] text-zinc-700 font-mono">
                          {new Date(link.publishedAt).toLocaleString()}
                        </span>
                      )}
                      <button
                        onClick={() => navigator.clipboard.writeText(absoluteUrl)}
                        className="ml-auto px-2 py-1 text-[10px] bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition-colors"
                      >
                        Copy
                      </button>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 text-[10px] bg-blue-950/60 hover:bg-blue-900/70 border border-blue-900 text-blue-200 rounded transition-colors"
                      >
                        Open
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-sm text-zinc-600 text-center">No shared note links yet.</div>
          )}
          {error && (
            <p className="px-4 py-2 text-[11px] text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
