import { useState } from 'react'
import PublicMarkdown from './PublicMarkdown'
import { timeAgo } from '../../utils/publicContent'
import { getNoteTitle } from '../../utils/noteTypes'

export default function PublicNoteCard({ note, bucketName }) {
  const [collapsed, setCollapsed] = useState(true)
  const categories = Array.isArray(note?.categories) ? note.categories.slice(0, 5) : []
  const collectionHref = note?.collectionIsPublic && note?.collectionSlug && bucketName
    ? `/b/${bucketName}/${note.collectionSlug}`
    : null

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <div className={`${collapsed ? '' : 'border-b border-zinc-800'} px-3 py-2`}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-600">
          <span>updated {timeAgo(note?.updatedAt)}</span>
          {note?.collectionName && (
            collectionHref
              ? <a className="text-blue-300 hover:text-blue-200" href={collectionHref}>in {note.collectionName}</a>
              : <span>in {note.collectionName}</span>
          )}
          {note?.slug && <a className="text-blue-300 hover:text-blue-200" href={`/n/${note.slug}`}>open shared note</a>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
        {collapsed && (
          <h3 className="mt-2 truncate text-sm font-medium text-zinc-200">
            {getNoteTitle(note)}
          </h3>
        )}
        {!!categories.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {categories.map(category => (
              <span key={category} className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                {category}
              </span>
            ))}
          </div>
        )}
      </div>
      {!collapsed && (
        <div className="px-3 py-3">
          <PublicMarkdown content={note?.content ?? ''} viewMode={note?.viewMode ?? null} />
        </div>
      )}
    </article>
  )
}
