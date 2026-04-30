export default function EncryptionSection({
  hasE2EKeys,
  onRegenerate,
  regenError,
  regenMode,
  regenPassword,
  regenState,
  secretScanBlockSync,
  secretScanEnabled,
  secretScanNibEnabled,
  setRegenError,
  setRegenMode,
  setRegenPassword,
  setRegenState,
  setSecretScanBlockSync,
  setSecretScanEnabled,
  setSecretScanNibEnabled,
  user,
}) {
  return (
    <>
      {user && (
        <div className="pt-1 border-t border-zinc-800 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-medium text-zinc-400">End-to-end encryption</label>
              <p className={`text-[11px] mt-0.5 ${hasE2EKeys ? 'text-emerald-400' : 'text-zinc-600'}`}>
                {hasE2EKeys ? 'Key pair active on this device' : 'No key pair on this device'}
              </p>
            </div>
            {!regenMode && (
              <button
                onClick={() => { setRegenMode(true); setRegenState(null); setRegenError('') }}
                className="ml-4 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors shrink-0"
              >
                {hasE2EKeys ? 'Regenerate key pair' : 'Set up key pair'}
              </button>
            )}
          </div>

          {regenMode && (
            <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-3 space-y-2">
              <p className="text-[11px] text-amber-400">
                Generating new keys will make any E2E-encrypted notes unreadable on other devices until those devices log out and back in.
              </p>
              <input
                type="password"
                value={regenPassword}
                onChange={e => setRegenPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onRegenerate()}
                placeholder="Enter your account password"
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
              />
              {regenError && <p className="text-[11px] text-red-400">{regenError}</p>}
              <div className="flex items-center gap-2">
                <button
                  onClick={onRegenerate}
                  disabled={!regenPassword || regenState === 'loading'}
                  className="px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors font-medium"
                >
                  {regenState === 'loading' ? 'Generating...' : 'Generate'}
                </button>
                <button
                  onClick={() => { setRegenMode(false); setRegenPassword(''); setRegenState(null) }}
                  className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {regenState === 'ok' && !regenMode && (
            <p className="text-[11px] text-emerald-400">Key pair generated and uploaded successfully.</p>
          )}
        </div>
      )}

      <div className="pt-1 border-t border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-xs font-medium text-zinc-400">Secret scanning</label>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Warn when a note contains API keys, tokens, passwords, or private keys.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={secretScanEnabled}
            onClick={() => {
              const next = !secretScanEnabled
              setSecretScanEnabled(next)
              if (!next) {
                setSecretScanBlockSync(false)
                setSecretScanNibEnabled(false)
              }
            }}
            className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${secretScanEnabled ? 'bg-amber-600 border-amber-500' : 'bg-zinc-700 border-zinc-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${secretScanEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
        {secretScanEnabled && (
          <div className="space-y-2 pl-3 border-l border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-zinc-500">Block auto-sync and require confirmation to share</label>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Notes with uncleared secrets won't sync automatically and will prompt before publishing.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={secretScanBlockSync}
                onClick={() => setSecretScanBlockSync(v => !v)}
                className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${secretScanBlockSync ? 'bg-amber-600 border-amber-500' : 'bg-zinc-700 border-zinc-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${secretScanBlockSync ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-zinc-500">Let Nib help detect secrets</label>
                <p className="text-[11px] text-zinc-600 mt-0.5">
                  Reviews the open note with your configured Nib model. Remote providers receive note content.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={secretScanNibEnabled}
                onClick={() => setSecretScanNibEnabled(v => !v)}
                className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${secretScanNibEnabled ? 'bg-amber-600 border-amber-500' : 'bg-zinc-700 border-zinc-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${secretScanNibEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
