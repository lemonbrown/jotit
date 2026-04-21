import { useState } from 'react'
import { testConnection } from '../utils/openai'

export default function Settings({ settings, onSave, onClose, onExportDB }) {
  const [apiKey, setApiKey] = useState(settings.openaiApiKey ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // null | 'ok' | 'fail'

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    // Temporarily init with entered key to test
    const { initOpenAI } = await import('../utils/openai')
    initOpenAI(apiKey)
    const ok = await testConnection()
    setTestResult(ok ? 'ok' : 'fail')
    setTesting(false)
  }

  const handleSave = () => {
    onSave({ ...settings, openaiApiKey: apiKey.trim() })
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[480px] p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              OpenAI API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setTestResult(null) }}
              placeholder="sk-proj-..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
            />
            <p className="text-[11px] text-zinc-600 mt-1.5">
              Used for automatic note categorization and semantic search. Your key is stored locally and never sent anywhere except OpenAI.
            </p>
          </div>

          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 text-[12px] text-zinc-500 space-y-1">
            <p className="text-zinc-400 font-medium mb-1">What AI does:</p>
            <p>• Auto-tags notes (token, config, github, etc.) after you stop typing</p>
            <p>• Generates embeddings for semantic search</p>
            <p>• Lets you search "github token" and find relevant notes even without exact words</p>
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
            <span className="text-[11px] text-zinc-600">Database</span>
            <button
              onClick={onExportDB}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors"
            >
              Export .sqlite
            </button>
          </div>

          <div className="flex items-center gap-2">
            {apiKey && (
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-md transition-colors disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            )}
            {testResult === 'ok' && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" /> Connected
              </span>
            )}
            {testResult === 'fail' && (
              <span className="text-xs text-red-400">Invalid key or no access</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
