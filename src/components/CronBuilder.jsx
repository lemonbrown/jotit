import { useMemo, useState } from 'react'
import { buildCronExpression, CRON_PRESETS, describeCronType, nextCronRuns, parseCronExpression, validateCronExpression } from '../utils/cron'

const DEFAULT_FIELDS = {
  second: '0',
  minute: '0',
  hour: '9',
  day: '*',
  month: '*',
  weekday: '*',
}

const FIELD_META = [
  ['second', 'Sec', '0-59'],
  ['minute', 'Min', '0-59'],
  ['hour', 'Hour', '0-23'],
  ['day', 'Day', '1-31'],
  ['month', 'Month', '1-12'],
  ['weekday', 'DOW', '0-6'],
]

export default function CronBuilder({ initialExpression = '', onApply, onCancel }) {
  const initial = useMemo(() => {
    try {
      const parsed = parseCronExpression(initialExpression)
      return { type: parsed.type, fields: { ...DEFAULT_FIELDS, ...parsed.fields } }
    } catch {
      return { type: 'unix', fields: DEFAULT_FIELDS }
    }
  }, [initialExpression])

  const [type, setType] = useState(initial.type)
  const [fields, setFields] = useState(initial.fields)

  const expression = buildCronExpression(type, fields)
  const result = useMemo(() => {
    try {
      validateCronExpression(expression)
      return { error: null, runs: nextCronRuns(expression, 6) }
    } catch (e) {
      return { error: e.message, runs: [] }
    }
  }, [expression])

  const setField = (name, value) => setFields(prev => ({ ...prev, [name]: value.trim() || '*' }))

  const applyPreset = (preset) => {
    const nextExpression = type === 'azure' ? preset.azure : preset.unix
    const parsed = parseCronExpression(nextExpression)
    setFields({ ...DEFAULT_FIELDS, ...parsed.fields })
  }

  const switchType = (nextType) => {
    setType(nextType)
    setFields(prev => ({ ...prev, second: nextType === 'azure' ? (prev.second || '0') : '0' }))
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-950">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[11px] text-zinc-500 font-mono shrink-0">Cron</span>
        <div className="inline-flex rounded-md border border-zinc-800 overflow-hidden">
          {['unix', 'azure'].map(option => (
            <button
              key={option}
              onClick={() => switchType(option)}
              className={`px-2.5 py-1 text-[11px] font-mono transition-colors ${
                type === option ? 'bg-blue-950/60 text-blue-300' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {option === 'azure' ? 'Azure' : 'Unix'}
            </button>
          ))}
        </div>
        <code className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[12px] text-zinc-200 font-mono">
          {expression}
        </code>
        <span className="text-[11px] text-zinc-600 truncate">{describeCronType(type)}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            disabled={!!result.error}
            onClick={() => onApply(expression)}
            className="px-2.5 py-1 text-[11px] font-mono text-green-300 border border-green-800 hover:border-green-600 rounded bg-green-950/40 disabled:text-zinc-700 disabled:border-zinc-800 disabled:bg-transparent"
          >
            Apply
          </button>
          <button onClick={onCancel} className="px-2.5 py-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded">
            Cancel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[260px_minmax(0,1fr)] flex-1 min-h-0 overflow-hidden">
        <div className="border-r border-zinc-800 overflow-y-auto p-3 space-y-2">
          <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">Presets</div>
          {CRON_PRESETS.map(preset => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="w-full text-left px-3 py-2 rounded border border-zinc-800 hover:border-zinc-600 bg-zinc-900/50 hover:bg-zinc-900 transition-colors"
            >
              <div className="text-[12px] text-zinc-300">{preset.label}</div>
              <div className="text-[10px] text-zinc-600 font-mono mt-0.5">{type === 'azure' ? preset.azure : preset.unix}</div>
            </button>
          ))}
        </div>

        <div className="flex flex-col min-h-0 overflow-hidden">
          <div className="p-4 border-b border-zinc-800">
            <div className="grid grid-cols-6 gap-2">
              {FIELD_META.filter(([name]) => type === 'azure' || name !== 'second').map(([name, label, hint]) => (
                <label key={name} className="block">
                  <span className="block text-[10px] text-zinc-600 font-mono mb-1">{label}</span>
                  <input
                    value={fields[name] ?? '*'}
                    onChange={e => setField(name, e.target.value)}
                    spellCheck={false}
                    className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 rounded px-2 py-1.5 text-[13px] text-zinc-200 font-mono outline-none"
                  />
                  <span className="block text-[10px] text-zinc-700 font-mono mt-1">{hint}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 text-[11px] text-zinc-600 font-mono">
              Supports *, */n, lists like 1,2,3, and ranges like 1-5.
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {result.error ? (
              <div className="text-[12px] text-red-400 font-mono bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
                {result.error}
              </div>
            ) : (
              <div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">Next runs</div>
                <div className="space-y-1.5">
                  {result.runs.map((run, i) => (
                    <div key={run.toISOString()} className="flex items-center gap-3 px-3 py-2 bg-zinc-900/60 border border-zinc-800 rounded">
                      <span className="text-[11px] text-zinc-600 font-mono w-8">{i + 1}</span>
                      <span className="text-[13px] text-zinc-300 font-mono">{run.toLocaleString()}</span>
                      <span className="text-[11px] text-zinc-700 font-mono ml-auto">{run.toISOString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
