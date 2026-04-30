import { useEffect, useMemo, useState } from 'react'
import { deleteStashItem, filterStashItems, maskStashValue, stashRef, upsertStashItem } from '../utils/stash'

const EMPTY_FORM = { id: null, key: '', value: '', secret: false, description: '' }

export default function StashPicker({
  items,
  query = '',
  activeIndex = 0,
  initialForm = null,
  style,
  onItemsChange,
  onInsertValue,
  onInsertReference,
  onSaved,
  onClose,
}) {
  const [form, setForm] = useState(() => initialForm ? { ...EMPTY_FORM, ...initialForm } : null)
  const [revealed, setRevealed] = useState(() => new Set())
  const [copiedId, setCopiedId] = useState(null)
  const filtered = useMemo(() => filterStashItems(items, query), [items, query])

  useEffect(() => {
    if (initialForm) setForm({ ...EMPTY_FORM, ...initialForm })
  }, [initialForm])

  const save = () => {
    if (!form?.key?.trim()) return
    const saved = form
    const next = upsertStashItem(form)
    onItemsChange(next)
    onSaved?.(saved, next)
    setForm(null)
  }

  const remove = (id) => {
    const next = deleteStashItem(id)
    onItemsChange(next)
    setForm(null)
  }

  const copyValue = async (item) => {
    await navigator.clipboard.writeText(item.value)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 1200)
  }

  return (
    <div className="absolute z-30 w-[40rem] max-w-[calc(100%-32px)]" style={style}>
      <div className="rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-2xl shadow-black/50 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900/80">
          <span className="text-[10px] text-emerald-400 font-mono">Stash</span>
          <span className="text-[11px] text-zinc-500 font-mono truncate min-w-0">/var {query}</span>
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => setForm({ ...EMPTY_FORM })}
            className="ml-auto px-2 py-1 text-[11px] font-mono text-emerald-300 hover:text-emerald-100 border border-emerald-900 hover:border-emerald-700 rounded transition-colors"
          >
            + add
          </button>
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            x
          </button>
        </div>

        {form ? (
          <div className="p-3 space-y-3 border-b border-zinc-800 bg-zinc-950">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] gap-2">
              <input
                autoFocus
                value={form.key}
                onChange={e => setForm(prev => ({ ...prev, key: e.target.value.replace(/\s/g, '') }))}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setForm(null) }}
                placeholder="apiBaseUrl"
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] font-mono text-zinc-200 outline-none focus:border-emerald-700"
              />
              <input
                value={form.value}
                onChange={e => setForm(prev => ({ ...prev, value: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setForm(null) }}
                placeholder="https://localhost:7081"
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] font-mono text-zinc-200 outline-none focus:border-emerald-700"
              />
            </div>
            <input
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setForm(null) }}
              placeholder="optional description"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[12px] text-zinc-300 outline-none focus:border-emerald-700"
            />
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-[11px] text-zinc-500">
                <input type="checkbox" checked={form.secret} onChange={e => setForm(prev => ({ ...prev, secret: e.target.checked }))} />
                secret
              </label>
              {form.id && (
                <button onClick={() => remove(form.id)} className="ml-auto text-[11px] text-red-400 hover:text-red-300">delete</button>
              )}
              <button onClick={() => setForm(null)} className="px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 border border-zinc-800 rounded">cancel</button>
              <button onClick={save} disabled={!form.key.trim()} className="px-2 py-1 text-[11px] text-emerald-300 hover:text-emerald-100 border border-emerald-900 rounded disabled:opacity-40">save</button>
            </div>
          </div>
        ) : null}

        <div className="max-h-80 overflow-auto">
          {filtered.length ? filtered.map((item, index) => {
            const showValue = !item.secret || revealed.has(item.id)
            return (
              <div
                key={item.id}
                className={`px-3 py-2 border-b border-zinc-900/80 ${index === activeIndex ? 'bg-emerald-950/35' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => onInsertReference(item)}
                    className="text-left min-w-0 flex-1"
                    title="Insert reference"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12px] text-zinc-100 font-mono truncate">{item.key}</span>
                      {item.secret && <span className="text-[10px] text-amber-400 border border-amber-900 rounded px-1">secret</span>}
                      {item.description && <span className="text-[11px] text-zinc-600 truncate">{item.description}</span>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500 font-mono truncate">
                      {showValue ? item.value : maskStashValue(item.value)}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onMouseDown={e => e.preventDefault()} onClick={() => onInsertValue(item)} className="px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-100 border border-zinc-800 rounded">value</button>
                    <button onMouseDown={e => e.preventDefault()} onClick={() => onInsertReference(item)} className="px-2 py-1 text-[10px] text-emerald-300 hover:text-emerald-100 border border-emerald-900 rounded">{stashRef(item.key)}</button>
                    <button onMouseDown={e => e.preventDefault()} onClick={() => copyValue(item)} className="px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-100 border border-zinc-800 rounded">{copiedId === item.id ? 'copied' : 'copy'}</button>
                    {item.secret && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => setRevealed(prev => { const next = new Set(prev); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next })} className="px-2 py-1 text-[10px] text-amber-400 hover:text-amber-200 border border-amber-900 rounded">
                        {revealed.has(item.id) ? 'hide' : 'reveal'}
                      </button>
                    )}
                    <button onMouseDown={e => e.preventDefault()} onClick={() => setForm(item)} className="px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-200 border border-zinc-800 rounded">edit</button>
                  </div>
                </div>
              </div>
            )
          }) : (
            <div className="px-4 py-8 text-center text-sm text-zinc-600">
              No stash values. Add one to reuse it anywhere.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
