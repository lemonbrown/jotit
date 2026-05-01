export const THEMES = [
  { id: 'dark',  label: 'Dark',  swatch: '#09090b' },
  { id: 'light', label: 'Light', swatch: '#ffffff' },
  { id: 'nord',  label: 'Nord',  swatch: '#2e3440' },
  { id: 'mocha', label: 'Mocha', swatch: '#1c140e' },
]

export default function AppearanceSection({ theme, onThemeChange, newNoteKeepsPanes, onNewNoteKeepsPanesChange }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-2">Theme</label>
        <div className="flex gap-2 flex-wrap">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => onThemeChange(t.id)}
              title={t.label}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                theme === t.id
                  ? 'border-blue-500 bg-blue-950/40 text-blue-300'
                  : 'border-zinc-700 hover:border-zinc-500 text-zinc-300'
              }`}
            >
              <span
                className="w-3.5 h-3.5 rounded-full border border-zinc-600 shrink-0"
                style={{ background: t.swatch }}
              />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={newNoteKeepsPanes ?? false}
          onChange={e => onNewNoteKeepsPanesChange(e.target.checked)}
          className="w-3.5 h-3.5 rounded accent-blue-500"
        />
        <span className="text-xs text-zinc-300">Keep existing panes when creating a new note</span>
      </label>
    </div>
  )
}
