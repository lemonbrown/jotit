import { DEFAULT_NIB_PROMPTS, NIB_PROMPT_DEFINITIONS } from '../../utils/nibPrompts'

export default function NibTemplatesSection({ prompts, onChange }) {
  const values = prompts ?? {}

  const updatePrompt = (id, value) => {
    onChange({ ...values, [id]: value })
  }

  const resetPrompt = (id) => {
    const next = { ...values }
    delete next[id]
    onChange(next)
  }

  const resetAll = () => {
    onChange({})
  }

  const groups = NIB_PROMPT_DEFINITIONS.reduce((acc, prompt) => {
    const key = prompt.group ?? 'Other'
    if (!acc.has(key)) acc.set(key, [])
    acc.get(key).push(prompt)
    return acc
  }, new Map())

  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950/40">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-300">Nib prompts</h3>
          <p className="text-[11px] text-zinc-500 mt-1">
            View and edit the prompts used by Nib chat, commands, URL tools, search, git, and helpers.
          </p>
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-md transition-colors"
        >
          Reset all
        </button>
      </div>

      <div className="space-y-5">
        {[...groups.entries()].map(([group, definitions]) => (
          <div key={group} className="space-y-4">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{group}</h4>
            {definitions.map(prompt => {
          const value = values[prompt.id] ?? DEFAULT_NIB_PROMPTS[prompt.id] ?? ''
          return (
            <div key={prompt.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400">{prompt.label}</label>
                  <p className="text-[11px] text-zinc-600 mt-0.5">{prompt.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => resetPrompt(prompt.id)}
                  className="px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-md transition-colors"
                >
                  Reset
                </button>
              </div>
              <textarea
                value={value}
                onChange={e => updatePrompt(prompt.id, e.target.value)}
                rows={Math.min(12, Math.max(4, value.split('\n').length))}
                className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-blue-700"
                spellCheck={false}
              />
              <div className="flex flex-wrap gap-1.5">
                {prompt.variables.map(variable => (
                  <code key={variable} className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-500">
                    {'{{'}{variable}{'}}'}
                  </code>
                ))}
              </div>
            </div>
          )
        })}
          </div>
        ))}
      </div>
    </div>
  )
}
