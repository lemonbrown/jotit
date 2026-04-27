import PublicMarkdown from './PublicMarkdown'
import { timeAgo } from '../../utils/publicContent'

export default function PublicNoteCard({ note, bucketName }) {
  const categories = Array.isArray(note?.categories) ? note.categories.slice(0, 5) : []
  const collectionHref = note?.collectionIsPublic && note?.collectionSlug && bucketName
    ? `/b/${bucketName}/${note.collectionSlug}`
    : null

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-600">
          <span>updated {timeAgo(note?.updatedAt)}</span>
          {note?.collectionName && (
            collectionHref
              ? <a className="text-blue-300 hover:text-blue-200" href={collectionHref}>in {note.collectionName}</a>
              : <span>in {note.collectionName}</span>
          )}
          {note?.slug && <a className="ml-auto text-blue-300 hover:text-blue-200" href={`/n/${note.slug}`}>open shared note</a>}
        </div>
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
      <div className="px-3 py-3">
        <PublicMarkdown content={note?.content ?? ''} viewMode={note?.viewMode ?? null} />
      </div>
    </article>
  )
}
