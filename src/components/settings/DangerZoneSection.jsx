export default function DangerZoneSection({
  noteCount,
  onDeleteAllNotes,
  onExportDB,
  onRemoveAllFromServer,
  removeAllServerState,
  setRemoveAllServerState,
  user,
}) {
  return (
    <div className="flex items-center gap-2 pt-1 border-t border-zinc-800 flex-wrap">
      <span className="text-[11px] text-zinc-600">Database</span>
      <button
        onClick={onExportDB}
        className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors"
      >
        Export .sqlite
      </button>
      <button
        onClick={onDeleteAllNotes}
        disabled={!noteCount}
        className="px-3 py-1.5 text-xs bg-red-950 hover:bg-red-900 border border-red-900 text-red-200 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Delete all notes
      </button>
      {user && onRemoveAllFromServer && (
        <button
          disabled={removeAllServerState === 'loading' || removeAllServerState === 'ok'}
          onClick={async () => {
            if (removeAllServerState !== 'confirm') {
              setRemoveAllServerState('confirm')
              return
            }
            setRemoveAllServerState('loading')
            const result = await onRemoveAllFromServer()
            setRemoveAllServerState(result?.ok ? 'ok' : { error: result?.error ?? 'Failed' })
          }}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            removeAllServerState === 'confirm'
              ? 'bg-amber-950 hover:bg-amber-900 border-amber-800 text-amber-200'
              : removeAllServerState === 'ok'
                ? 'bg-zinc-800 border-zinc-700 text-zinc-400 cursor-default'
                : removeAllServerState?.error
                  ? 'bg-zinc-800 border-red-900 text-red-400 cursor-default'
                  : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-300'
          }`}
          title="Remove all notes from the server while keeping them on this device"
        >
          {removeAllServerState === 'confirm' ? 'confirm remove all?' : removeAllServerState === 'loading' ? 'removing...' : removeAllServerState === 'ok' ? 'removed from server' : removeAllServerState?.error ? `failed: ${removeAllServerState.error}` : 'Remove all from server'}
        </button>
      )}
    </div>
  )
}
