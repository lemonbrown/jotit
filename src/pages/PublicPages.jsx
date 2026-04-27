import { useMemo, useState } from 'react'
import { usePublicPageData } from '../hooks/usePublicPageData'
import PublicHeadingOutline from '../components/public/PublicHeadingOutline'
import PublicMarkdown from '../components/public/PublicMarkdown'
import PublicNoteCard from '../components/public/PublicNoteCard'
import { timeAgo } from '../utils/publicContent'
import { createPublicCloneNote } from '../utils/noteFactories'
import { initDB, persist, replaceNoteSearchArtifacts, upsertNoteSync } from '../utils/db'
import { buildNoteSearchArtifacts } from '../utils/searchIndex'

function PublicShell({ path, children }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2.5 backdrop-blur md:px-4">
        <a href="/" className="text-base font-bold tracking-tight text-zinc-100">jot.it</a>
        <span className="truncate font-mono text-[11px] text-zinc-600">{path}</span>
        <a href="/?new=1" className="ml-auto rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500">
          + New
        </a>
      </header>
      {children}
    </div>
  )
}

function PublicState({ path, loading, error }) {
  return (
    <PublicShell path={path}>
      <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
        {loading ? (
          <>
            <div className="mb-4 h-7 w-7 animate-spin rounded-full border-2 border-zinc-800 border-t-blue-400" />
            <p className="font-mono text-xs text-zinc-600">loading public page...</p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-xl font-semibold text-zinc-100">Public page not found</h1>
            <p className="text-sm text-zinc-500">{error ?? 'This page does not exist or is no longer public.'}</p>
          </>
        )}
      </main>
    </PublicShell>
  )
}

function PublicNotePage({ path }) {
  const { loading, error, data } = usePublicPageData(path)
  const [headings, setHeadings] = useState([])
  const [cloneState, setCloneState] = useState(null)
  const note = data?.note

  const cloneSharedNote = async () => {
    if (!data?.slug || !note || cloneState?.loading) return
    setCloneState({ loading: true })
    try {
      await initDB()
      const cloned = createPublicCloneNote({ shared: data, slug: data.slug })
      upsertNoteSync(cloned)
      replaceNoteSearchArtifacts(cloned.id, buildNoteSearchArtifacts(cloned))
      await persist()
      setCloneState({ ok: true, noteId: cloned.id })
    } catch (e) {
      setCloneState({ error: e.message ?? 'Failed to clone shared note' })
    }
  }

  if (loading || error || !note) return <PublicState path={path} loading={loading} error={error} />

  return (
    <PublicShell path={path}>
      <main className="mx-auto grid max-w-5xl gap-4 px-3 py-4 md:px-4 xl:grid-cols-[1fr_14rem]">
        <section className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-3 font-mono text-[11px] text-zinc-600">
            <span>published {timeAgo(data.publishedAt)}</span>
            <span>updated {timeAgo(note.updatedAt)}</span>
            {note.viewMode && <span>{note.viewMode}</span>}
            <button
              type="button"
              onClick={cloneSharedNote}
              disabled={cloneState?.loading || cloneState?.ok}
              className="ml-auto rounded-md border border-blue-900/70 bg-blue-950/30 px-2 py-1 text-[11px] text-blue-200 transition-colors hover:bg-blue-950/60 disabled:cursor-default disabled:opacity-60"
            >
              {cloneState?.loading ? 'Cloning...' : cloneState?.ok ? 'Cloned' : 'Clone +'}
            </button>
          </div>
          {cloneState?.ok && (
            <div className="mb-4 rounded-md border border-blue-900/60 bg-blue-950/30 px-3 py-2 text-xs text-blue-100">
              Cloned into your notes. <a href="/app" className="font-mono text-blue-300 hover:text-blue-200">Open Jot.it</a>
            </div>
          )}
          {cloneState?.error && (
            <div className="mb-4 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200">
              {cloneState.error}
            </div>
          )}
          <PublicMarkdown content={note.content ?? ''} viewMode={note.viewMode} onHeadings={setHeadings} />
        </section>
        <PublicHeadingOutline headings={headings} />
      </main>
    </PublicShell>
  )
}

function PublicBucketPage({ path }) {
  const { loading, error, data } = usePublicPageData(path)
  const collections = data?.collections ?? []
  const directNotes = data?.directNotes ?? []
  const bucketName = data?.bucket?.bucketName ?? ''

  if (loading || error || !data) return <PublicState path={path} loading={loading} error={error} />

  return (
    <PublicShell path={path}>
      <main className="mx-auto max-w-5xl px-3 py-4 md:px-4">
        <section className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">{bucketName}</h1>
            <span className="font-mono text-[11px] text-zinc-600">public bucket</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Public collections and shared notes from {data.bucket?.ownerLabel ?? bucketName}.</p>
        </section>

        <section className="mb-6">
          <div className="mb-2 flex items-end justify-between gap-4 px-1">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200">Collections</h2>
              <p className="text-xs text-zinc-600">Shared groupings of notes.</p>
            </div>
            <span className="font-mono text-xs text-zinc-600">{collections.length}</span>
          </div>
          {collections.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {collections.map(collection => (
                <a
                  key={collection.id}
                  href={`/b/${bucketName}/${collection.slug}`}
                  className="group rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition-colors hover:border-zinc-600 hover:bg-zinc-800/80"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium text-zinc-200">{collection.name}</h3>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{collection.description || 'Public collection'}</p>
                    </div>
                    <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      {collection.noteCount} note{collection.noteCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-3 flex justify-between gap-3 font-mono text-[10px] text-zinc-600">
                    <span>{collection.slug}</span>
                    <span>updated {timeAgo(collection.lastUpdatedAt || collection.updatedAt)}</span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">No public collections yet.</div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-end justify-between gap-4 px-1">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200">Direct Notes</h2>
              <p className="text-xs text-zinc-600">Individually shared public notes.</p>
            </div>
            <span className="font-mono text-xs text-zinc-600">{directNotes.length}</span>
          </div>
          {directNotes.length ? (
            <div className="grid gap-2">
              {directNotes.map(note => <PublicNoteCard key={note.id} note={note} bucketName={bucketName} />)}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">No direct public notes yet.</div>
          )}
        </section>
      </main>
    </PublicShell>
  )
}

function PublicCollectionPage({ path }) {
  const { loading, error, data } = usePublicPageData(path)
  const notes = data?.notes ?? []
  const bucketName = data?.bucket?.bucketName ?? ''

  if (loading || error || !data) return <PublicState path={path} loading={loading} error={error} />

  return (
    <PublicShell path={path}>
      <main className="mx-auto max-w-5xl px-3 py-4 md:px-4">
        <a href={`/b/${bucketName}`} className="mb-3 inline-flex font-mono text-xs text-blue-300 hover:text-blue-200">
          back to /b/{bucketName}
        </a>
        <section className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">{data.collection?.name}</h1>
            <span className="font-mono text-[11px] text-zinc-600">public collection</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{data.collection?.description || `Public collection from ${data.bucket?.ownerLabel ?? bucketName}`}</p>
        </section>
        {notes.length ? (
          <div className="grid gap-2">
            {notes.map(note => <PublicNoteCard key={note.id} note={note} bucketName={bucketName} />)}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">No public notes in this collection.</div>
        )}
      </main>
    </PublicShell>
  )
}

export function getPublicRoute(pathname = window.location.pathname) {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'n' && parts.length === 2) return { type: 'note', path: `/${parts.join('/')}` }
  if (parts[0] === 'b' && parts.length === 2) return { type: 'bucket', path: `/${parts.join('/')}` }
  if (parts[0] === 'b' && parts.length === 3) return { type: 'collection', path: `/${parts.join('/')}` }
  return null
}

export default function PublicPages() {
  const route = useMemo(() => getPublicRoute(), [])
  if (!route) return null
  if (route.type === 'note') return <PublicNotePage path={route.path} />
  if (route.type === 'bucket') return <PublicBucketPage path={route.path} />
  return <PublicCollectionPage path={route.path} />
}
