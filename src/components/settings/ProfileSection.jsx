export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$|^[a-z0-9]{2,40}$/

export default function ProfileSection({
  bucketCollections,
  bucketName,
  bucketNotes,
  bucketSaving,
  bucketStatus,
  onBucketNameChange,
  onSaveBucketName,
  publicCollectionCount,
  publicNoteCount,
  clearBucketNoteState,
  onClearAllBucketNotes,
}) {
  const trimmedBucketName = bucketName.trim()

  return (
    <div className="pt-1 border-t border-zinc-800 space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-zinc-400">Public Bucket</label>
        {publicCollectionCount > 0 ? (
          <span className="text-[11px] text-emerald-500">
            {publicCollectionCount} public collection{publicCollectionCount !== 1 ? 's' : ''} · {bucketNotes.length} direct note{bucketNotes.length !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-[11px] text-zinc-600">
            {bucketNotes.length ? `${bucketNotes.length} direct note${bucketNotes.length !== 1 ? 's' : ''} in bucket` : 'no public collections yet'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={bucketName}
          onChange={e => onBucketNameChange(e.target.value.toLowerCase())}
          placeholder="your-bucket-name"
          spellCheck={false}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
        />
        <button
          onClick={onSaveBucketName}
          disabled={bucketSaving || !SLUG_RE.test(trimmedBucketName)}
          className="px-3 py-2 text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors font-medium whitespace-nowrap"
        >
          {bucketSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {!SLUG_RE.test(trimmedBucketName) && trimmedBucketName.length > 0 && (
        <p className="text-[11px] text-red-400">Use 2-40 lowercase letters, numbers, or hyphens</p>
      )}
      {trimmedBucketName && SLUG_RE.test(trimmedBucketName) && (
        <p className="text-[11px] text-zinc-500">
          Bucket URL: <span className="font-mono text-zinc-300">/b/{trimmedBucketName}</span>
        </p>
      )}
      {bucketCollections.length > 0 && (
        <p className="text-[11px] text-zinc-600">
          Live now: {bucketCollections.map(collection => collection.slug).join(', ')}
        </p>
      )}
      {bucketNotes.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-zinc-600 min-w-0 truncate">
            Direct: {bucketNotes.slice(0, 4).map(note => note.title ?? 'untitled').join(', ')}{bucketNotes.length > 4 ? ` +${bucketNotes.length - 4} more` : ''}
          </p>
          {onClearAllBucketNotes && (
            <button
              onClick={onClearAllBucketNotes}
              disabled={clearBucketNoteState === 'loading' || clearBucketNoteState === 'ok'}
              className={`shrink-0 px-2 py-0.5 text-[11px] rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                clearBucketNoteState === 'confirm'
                  ? 'bg-amber-950 hover:bg-amber-900 border-amber-800 text-amber-200'
                  : clearBucketNoteState === 'ok'
                    ? 'border-zinc-700 text-zinc-500 cursor-default'
                    : clearBucketNoteState?.error
                      ? 'border-red-900 text-red-400 cursor-default'
                      : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-400'
              }`}
              title="Make all directly-shared notes private"
            >
              {clearBucketNoteState === 'confirm' ? 'Confirm?' : clearBucketNoteState === 'loading' ? 'Clearing...' : clearBucketNoteState === 'ok' ? 'Cleared' : clearBucketNoteState?.error ? 'Failed' : 'Clear all'}
            </button>
          )}
        </div>
      )}
      {bucketStatus?.ok && (
        <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          Bucket name saved
        </p>
      )}
      {bucketStatus?.error && (
        <p className="text-[11px] text-red-400">{bucketStatus.error}</p>
      )}
      {publicNoteCount > 0 && (
        <p className="text-[11px] text-zinc-600">
          {publicNoteCount} individually shared note{publicNoteCount !== 1 ? 's' : ''} now also appear under <span className="font-mono text-zinc-300">/b/{trimmedBucketName || 'your-bucket'}</span>.
        </p>
      )}
    </div>
  )
}
