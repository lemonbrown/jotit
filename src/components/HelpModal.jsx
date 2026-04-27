export default function HelpModal({ onClose }) {
  const Section = ({ title, rows }) => (
    <div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">{title}</div>
      <div className="space-y-0.5">
        {rows.map(([keys, desc]) => (
          <div key={desc} className="flex items-baseline gap-3 py-1 border-b border-zinc-800/60 last:border-0">
            <div className="flex items-center gap-1 shrink-0 min-w-[160px]">
              {keys.map((k, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-zinc-600 text-[10px] mx-0.5">/</span>}
                  <kbd className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono text-zinc-300 bg-zinc-800 border border-zinc-700 rounded">
                    {k}
                  </kbd>
                </span>
              ))}
            </div>
            <span className="text-[12px] text-zinc-400">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[560px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-900 z-10">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Hotkeys &amp; Commands</h2>
            <p className="text-[11px] text-zinc-600 mt-0.5">Everything jot.it can do</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <Section title="Files" rows={[
            [['Drag & drop'],        'Drop any text file onto the app — becomes a new note (5 MB max)'],
            [['Multi-drop'],         'Drop multiple files at once; each becomes its own note'],
          ]} />

          <Section title="Navigation" rows={[
            [['Mouse wheel'],        'Navigate between notes in the grid'],
            [['Shift+Mouse wheel'],  'Pop out the note grid and browse expanded note previews'],
            [['Alt+Mouse wheel'],    'Pan through the note grid with coasting'],
            [['Alt+Left'],           'Back through note locations'],
            [['Alt+Right'],          'Forward through note locations'],
            [['Ctrl+Alt+Up'],        'Switch to previous collection'],
            [['Ctrl+Alt+Down'],      'Switch to next collection'],
            [['Click'],              'Select a note'],
            [['Ctrl+Click'],         'Open note in another editor pane'],
            [['Alt+Hover'],          'Preview a note in a popout glance view'],
            [['Alt+N'],              'Create a new note'],
            [['Ctrl+F'],             'Focus the search bar'],
            [['Ctrl+\\'],            'Show or hide the notes pane'],
            [['Ctrl+Alt+\\'],        'Show or hide command toolbars'],
            [['Ctrl+Shift+\\'],      'Toggle simple editor mode'],
            [['Ctrl+Shift+Alt+\\'],  'Show or hide note metadata badges'],
            [['Esc'],                'Clear search / close modals'],
          ]} />

          <Section title="Editor" rows={[
            [['Tab'],                'Insert 2 spaces'],
            [['Ctrl+G'],             'Go to line'],
            [['Ctrl+='],             'Calculate selection or current line'],
            [['Ctrl+Enter'],         'Preview calculation insert; Enter accepts it'],
            [['Alt+M'],              'Toggle scroll minimap'],
            [['Ctrl+H'],             'Find and replace (note / collection / all)'],
            [['Shift+Mouse wheel'],  'Open the document outline and move through markdown headings'],
            [['Alt+Mouse wheel'],    'Velocity scroll through the editor'],
            [['Share'],              'Publish current note and copy a public link'],
            [['📋 Copy'],            'Copy entire note content to clipboard'],
            [['delete'],             'Delete note (requires confirm)'],
          ]} />

          <Section title="Toolbar modes" rows={[
            [['</> Preview'],        'Render with syntax highlighting (auto-detects language)'],
            [['MD Preview'],         'Render note as formatted Markdown (GFM + tables + code blocks)'],
            [['Table'],              'Open selected CSV or whole-note CSV as an editable table'],
            [['Cron'],               'Build Unix or Azure cron expressions and preview next runs'],
            [['Diagram'],            'Create boxes, shapes, and linked lightweight diagrams'],
            [['.* Regex'],           'Open regex tester — select text first to pre-fill test string'],
            [['{} Prettify'],        'Reformat selected note as JSON (shown when valid JSON detected)'],
            [['⚡ HTTP'],            'Execute HTTP request written in the note — glows amber when a request is detected'],
          ]} />

          <Section title="HTTP runner — supported formats" rows={[
            [['curl'],               'curl -X POST https://... -H "Key: val" -d \'{"a":1}\''],
            [['HTTP block'],         'METHOD https://...\nHeader: value\n\nbody'],
            [['PowerShell'],         'Invoke-WebRequest / Invoke-RestMethod -Uri https://... -Method Post'],
            [['###'],               'Separate multiple requests with ### — navigate with the tab bar'],
            [['CORS note'],          'Requests run in the browser — target must allow cross-origin access'],
          ]} />

          <Section title="Text transforms (select text first)" rows={[
            [['Base64 ↑'],           'Encode selection to Base64'],
            [['Base64 ↓'],           'Decode Base64 → text or pretty JSON'],
            [['URL ↓'],              'URL-decode (%20 → space, etc.)'],
            [['JWT ↓'],              'Split JWT and decode header + payload'],
            [['JSON {}'],            'Pretty-print JSON selection'],
            [['YAML {}'],            'Normalize YAML / YML indentation'],
            [['Hex→ASCII'],          'Convert hex bytes to ASCII (space-sep or continuous)'],
            [['ASCII→Hex'],          'Convert ASCII text to hex bytes'],
            [['HTML ↓'],             'Decode HTML entities (&lt;div&gt; → <div>)'],
            [['Unicode ↓'],          'Decode \\uXXXX, \\u{X}, &#x;, &#; escapes'],
          ]} />

          <Section title="Search" rows={[
            [['text'],               'Instant filter by content or category tags'],
            [['AI semantic'],        'Signed-in users get server-backed semantic search when AI is enabled'],
          ]} />

          <Section title="AI" rows={[
            [['Account-gated'],      'Server AI features require a signed-in account'],
            [['Semantic search'],    'Global search can rank by meaning for signed-in users'],
            [['Key ownership'],      'The server owns the AI key; users do not bring their own'],
          ]} />

          <Section title="Database" rows={[
            [['⚙ → Export .sqlite'], 'Download all notes as a portable .sqlite file'],
            [['Auto-persist'],       'SQLite saved to IndexedDB 800ms after every change'],
          ]} />
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 text-[11px] text-zinc-600 text-center">
          Press <kbd className="inline-flex items-center px-1.5 py-0.5 font-mono text-zinc-400 bg-zinc-800 border border-zinc-700 rounded text-[10px]">?</kbd> to open this at any time
        </div>
      </div>
    </div>
  )
}
