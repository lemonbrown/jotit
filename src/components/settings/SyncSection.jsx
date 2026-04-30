export default function SyncSection({
  checkOllama,
  embedModel,
  embedProvider,
  embedSaving,
  embedStatus,
  llmEnabled,
  localAgentStatus,
  localAgentToken,
  ollamaAvailable,
  ollamaLoading,
  ollamaModel,
  ollamaModels,
  onEmbedModelChange,
  onSaveEmbedConfig,
  onToggleEmbedProvider,
  onToggleLlm,
  onToggleServerProxy,
  onToggleSync,
  serverProxy,
  setLocalAgentToken,
  setOllamaModel,
  syncEnabled,
  user,
  showAiConfig,
}) {
  return (
    <>
      {user && (
        <div className="pt-1 border-t border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-medium text-zinc-400">Sync notes to server</label>
              <p className="text-[11px] text-zinc-600 mt-0.5">
                {syncEnabled
                  ? 'All notes sync automatically.'
                  : 'Sync is off globally. Choose which notes to sync individually from the note list.'}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={syncEnabled}
              onClick={onToggleSync}
              className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${syncEnabled ? 'bg-blue-600 border-blue-500' : 'bg-zinc-700 border-zinc-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${syncEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      )}

      <div className="pt-1 border-t border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-xs font-medium text-zinc-400">Route HTTP requests via local agent</label>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Uses <code className="font-mono">jot serve</code> on <code className="font-mono">127.0.0.1:3210</code> for localhost/private-network/dev targets.
            </p>
            <p className={`text-[11px] mt-1 ${localAgentStatus.available ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {localAgentStatus.checking ? 'Checking local agent...' : localAgentStatus.available ? 'Local agent connected' : 'Local agent not detected'}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={serverProxy}
            onClick={onToggleServerProxy}
            className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${serverProxy ? 'bg-blue-600 border-blue-500' : 'bg-zinc-700 border-zinc-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${serverProxy ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Local Agent Token</label>
          <input
            type="password"
            value={localAgentToken}
            onChange={e => setLocalAgentToken(e.target.value)}
            placeholder="Paste token printed by jotit-agent"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
          />
          <p className="text-[11px] text-zinc-600 mt-1.5">
            Run <code className="font-mono">jot serve</code> to start the agent, copy the token shown in terminal, and paste it here.
          </p>
        </div>
      </div>

      <div className="pt-1 border-t border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-xs font-medium text-zinc-400">✒ Nib</label>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Query your notes with a locally running model via <code className="font-mono">jotit-agent</code>.
            </p>
            {ollamaAvailable === true && <p className="text-[11px] text-emerald-400 mt-1">Ollama connected</p>}
            {ollamaAvailable === false && <p className="text-[11px] text-zinc-600 mt-1">Ollama not reachable</p>}
          </div>
          <button
            role="switch"
            aria-checked={llmEnabled}
            onClick={onToggleLlm}
            className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${llmEnabled ? 'bg-violet-600 border-violet-500' : 'bg-zinc-700 border-zinc-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${llmEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
        {llmEnabled && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={ollamaModel}
                onChange={e => setOllamaModel(e.target.value)}
                disabled={!ollamaModels.length}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono outline-none focus:border-zinc-500 transition-colors disabled:opacity-50"
              >
                {ollamaModels.length === 0 && ollamaModel && <option value={ollamaModel}>{ollamaModel}</option>}
                {ollamaModels.length > 0 && ollamaModel && !ollamaModels.some(model => model.name === ollamaModel) && (
                  <option value={ollamaModel}>{ollamaModel} (missing)</option>
                )}
                {ollamaModels.length === 0 && !ollamaModel && (
                  <option value="">{ollamaAvailable === false ? 'Ollama not reachable' : ollamaLoading ? 'Loading...' : 'No models found'}</option>
                )}
                {ollamaModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
              <button
                onClick={checkOllama}
                disabled={ollamaLoading}
                className="px-3 py-2 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {ollamaLoading ? 'Checking...' : 'Refresh'}
              </button>
            </div>
            {!ollamaModels.length && ollamaAvailable === null && (
              <p className="text-[11px] text-zinc-600">Make sure jotit-agent is running and click Refresh.</p>
            )}
            {ollamaModel && (
              <p className="text-[11px] text-zinc-600">
                Active chat model: <code className="font-mono text-zinc-400">{ollamaModel}</code>
              </p>
            )}
          </div>
        )}
      </div>

      {showAiConfig && (
        <div className="pt-1 border-t border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-xs font-medium text-zinc-400">Embeddings provider</label>
              <p className="text-[11px] text-zinc-600 mt-0.5">
                Source for semantic search embeddings. Local uses Ollama via jotit-agent.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={embedProvider === 'ollama'}
              onClick={onToggleEmbedProvider}
              className={`relative ml-4 shrink-0 w-9 h-5 rounded-full border transition-colors ${embedProvider === 'ollama' ? 'bg-violet-600 border-violet-500' : 'bg-zinc-700 border-zinc-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${embedProvider === 'ollama' ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
          {embedProvider === 'ollama' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={embedModel}
                  onChange={e => onEmbedModelChange(e.target.value)}
                  placeholder="nomic-embed-text"
                  spellCheck={false}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
                />
                <button
                  onClick={onSaveEmbedConfig}
                  disabled={embedSaving || !embedModel.trim()}
                  className="px-3 py-2 text-xs bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors font-medium whitespace-nowrap"
                >
                  {embedSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-[11px] text-zinc-600">
                Run <code className="font-mono">ollama pull nomic-embed-text</code> first. After saving, use Reindex on the AI status page to rebuild embeddings.
              </p>
            </div>
          )}
          {embedProvider === 'openai' && (
            <div className="flex justify-end">
              <button
                onClick={onSaveEmbedConfig}
                disabled={embedSaving}
                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 text-zinc-300 rounded-md transition-colors font-medium"
              >
                {embedSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
          {embedStatus?.ok && (
            <p className="text-[11px] text-emerald-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              Saved - run Reindex to rebuild embeddings with the new provider
            </p>
          )}
          {embedStatus?.error && <p className="text-[11px] text-red-400">{embedStatus.error}</p>}
        </div>
      )}
    </>
  )
}
