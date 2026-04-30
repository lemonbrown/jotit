import { DEFAULT_NIB_TEMPLATES, NIB_TEMPLATE_DEFINITIONS } from '../../utils/nibTemplates'

export default function NibTemplatesSection({ templates, onChange }) {
  const updateTemplate = (id, value) => {
    onChange({ ...templates, [id]: value })
  }

  const resetTemplate = (id) => {
    const next = { ...templates }
    delete next[id]
    onChange(next)
  }

  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950/40">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-300">Nib message templates</h3>
          <p className="text-[11px] text-zinc-500 mt-1">
            Global prompts used when opening Nib with structured context.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {NIB_TEMPLATE_DEFINITIONS.map(template => {
          const value = templates[template.id] ?? DEFAULT_NIB_TEMPLATES[template.id] ?? ''
          return (
            <div key={template.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400">{template.label}</label>
                  <p className="text-[11px] text-zinc-600 mt-0.5">{template.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => resetTemplate(template.id)}
                  className="px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-md transition-colors"
                >
                  Reset
                </button>
              </div>
              <textarea
                value={value}
                onChange={e => updateTemplate(template.id, e.target.value)}
                rows={4}
                className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-blue-700"
                spellCheck={false}
              />
              <div className="flex flex-wrap gap-1.5">
                {template.variables.map(variable => (
                  <code key={variable} className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-500">
                    {'{{'}{variable}{'}}'}
                  </code>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
