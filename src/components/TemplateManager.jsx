import { useEffect, useMemo, useState } from 'react'
import { BUILTIN_TEMPLATES } from '../utils/noteTemplates'

const EMPTY_FORM = { id: null, command: '', name: '', body: '' }

export default function TemplateManager({ userTemplates, onClose, onSave, onDelete }) {
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(null) // null = list view, object = edit view

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') { form ? setForm(null) : onClose() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [form, onClose])

  const userCmds = useMemo(() => new Set(userTemplates.map(t => t.command)), [userTemplates])

  const filteredBuiltins = useMemo(() => {
    const q = query.trim().toLowerCase()
    return BUILTIN_TEMPLATES.filter(t =>
      !q || t.command.includes(q) || t.name.toLowerCase().includes(q)
    )
  }, [query])

  const filteredUser = useMemo(() => {
    const q = query.trim().toLowerCase()
    return userTemplates.filter(t =>
      !q || t.command.includes(q) || t.name.toLowerCase().includes(q)
    )
  }, [query, userTemplates])

  const handleSave = () => {
    if (!form) return
    const command = form.command.trim().replace(/^!+/, '')
    if (!command) return
    onSave({ id: form.id, command, name: form.name || command, body: form.body })
    setForm(null)
  }

  if (form) {
    return (
      <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-6" onClick={e => e.target === e.currentTarget && setForm(null)}>
        <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 flex flex-col">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
            <h2 className="text-base font-semibold text-zinc-100">
              {form.id ? 'Edit template' : 'New template'}
            </h2>
            <button onClick={() => setForm(null)} className="ml-auto text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">×</button>
          </div>

          <div className="flex flex-col gap-4 p-4 overflow-auto">
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 w-36">
                <label className="text-[11px] text-zinc-500 font-mono">command</label>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-500 font-mono text-sm">!</span>
                  <input
                    autoFocus
                    value={form.command}
                    onChange={e => setForm(f => ({ ...f, command: e.target.value.replace(/\s/g, '').replace(/^!+/, '') }))}
                    onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                    placeholder="command"
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono text-zinc-200 outline-none focus:border-zinc-500 min-w-0"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[11px] text-zinc-500 font-mono">name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                  placeholder="display name"
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-zinc-500 font-mono">body</label>
                <span className="text-[10px] text-zinc-700 font-mono">{'  '}use ${'{'}1:placeholder{'}'} for tab stops · ${'{'}sel{'}'} for selected text</span>
              </div>
              <textarea
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={14}
                spellCheck={false}
                placeholder={`Bug: \${1:title}\n\nSteps to reproduce\n\${2:1. step}\n\nExpected\n\${3:what should happen}`}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-zinc-200 outline-none focus:border-zinc-500 resize-y"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800 bg-zinc-900/60">
            <button
              onClick={() => setForm(null)}
              className="px-3 py-1.5 text-xs font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded transition-colors"
            >
              cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!form.command.trim()}
              className="px-3 py-1.5 text-xs font-mono text-emerald-300 hover:text-emerald-100 border border-emerald-900 hover:border-emerald-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {form.id ? 'save changes' : 'create template'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-6" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
          <h2 className="text-base font-semibold text-zinc-100">Templates</h2>
          <span className="text-[11px] text-zinc-600 font-mono">{userTemplates.length} custom</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search templates"
            className="ml-auto w-full max-w-sm bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500"
          />
          <button
            onClick={() => setForm({ ...EMPTY_FORM })}
            className="shrink-0 px-3 py-1.5 text-xs font-mono text-emerald-300 hover:text-emerald-100 border border-emerald-900 hover:border-emerald-700 rounded transition-colors"
          >
            + new
          </button>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">×</button>
        </div>

        <div className="overflow-auto">
          {filteredUser.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] text-zinc-600 font-mono border-b border-zinc-900/80 bg-zinc-900/40">custom</div>
              {filteredUser.map(t => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  onEdit={() => setForm({ id: t.id, command: t.command, name: t.name, body: t.body })}
                  onDelete={() => onDelete(t.id)}
                />
              ))}
            </>
          )}

          {filteredBuiltins.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] text-zinc-600 font-mono border-b border-zinc-900/80 bg-zinc-900/40">
                built-in
                {userCmds.size > 0 && <span className="ml-2 text-zinc-700">— shadowed by custom if same command</span>}
              </div>
              {filteredBuiltins.map(t => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  builtin
                  onEdit={() => setForm({ id: null, command: t.command, name: t.name, body: t.body })}
                />
              ))}
            </>
          )}

          {filteredUser.length === 0 && filteredBuiltins.length === 0 && (
            <div className="px-4 py-8 text-sm text-zinc-600 text-center">No templates found.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateRow({ template, builtin = false, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="px-4 py-3 border-b border-zinc-900/80">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-100 font-mono shrink-0">!{template.command}</span>
        <span className="text-[12px] text-zinc-500 truncate">{template.name}</span>
        <button
          onClick={() => setExpanded(v => !v)}
          className="ml-auto text-[10px] text-zinc-600 hover:text-zinc-400 font-mono transition-colors"
        >
          {expanded ? 'hide' : 'preview'}
        </button>
        <button
          onClick={onEdit}
          className="px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded transition-colors"
        >
          {builtin ? 'copy & edit' : 'edit'}
        </button>
        {!builtin && onDelete && (
          <button
            onClick={onDelete}
            className="px-2 py-1 text-[11px] font-mono text-red-400 hover:text-red-300 border border-red-950 hover:border-red-800 rounded transition-colors"
          >
            delete
          </button>
        )}
      </div>
      {expanded && (
        <pre className="mt-2 note-content text-[12px] text-zinc-500 whitespace-pre-wrap overflow-auto m-0 max-h-48">
          {template.body}
        </pre>
      )}
    </div>
  )
}
