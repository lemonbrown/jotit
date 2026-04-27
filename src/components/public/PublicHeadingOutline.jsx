export default function PublicHeadingOutline({ headings }) {
  if (!headings?.length) return null

  return (
    <nav className="hidden xl:block sticky top-16 self-start max-h-[calc(100vh-5rem)] w-56 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600">Jump to</div>
      <div className="space-y-1">
        {headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            onClick={() => document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            style={{ paddingLeft: `${8 + heading.level * 10}px` }}
            title={heading.title}
          >
            {heading.title}
          </button>
        ))}
      </div>
    </nav>
  )
}
