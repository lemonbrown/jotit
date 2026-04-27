const FEATURES = [
  'notes',
  'snippets',
  'local SQLite storage',
  'full-text search',
  'semantic AI search',
  'HTTP runner',
  'local agent execution',
  'private target proxying',
  'OpenAPI 3.x import',
  'operation explorer',
  'request builder',
  'response validation',
  'external SQLite viewer',
  'image paste',
  'attachment thumbnails',
  'drag-and-drop import',
  'public note sharing',
  'bucket sharing',
  'regex tester',
  'cross-device sync',
  'JSON viewer',
  'split panes',
  'location history',
  'diff view',
  'entity extraction',
  'chunk-based embeddings',
  'JWT auth',
  'dark / light / nord / mocha',
  'note export',
  'snippet search',
]

const LANDING_COPY = `I built jot.it for me. It may not work for you. I built it because I have a penchant for dumping "eventually very important information" into notepad++. 
And it became teeth pulling painful to find that very important thing. So I built something that helps me find things. 
A lot of other things were added, too. Jot.it will exasperate a disciplined developer, but could be useful to another like me. Ymmv.`

const FEATURE_GROUPS = [
  {
    title: 'Local first by default',
    body: 'jot.it is backed by a local browser SQLite database. It does not require an account, remote services, or a network connection to use. Notes are long-persisted and assumed to be there forever unless you remove them.',
  },
  {
    title: 'Accounts add sync and public links',
    body: 'An account enables syncing between logged-in devices and creating public links to notes or collections. By default, account notes sync to a central backend service. They are encrypted at rest, but can be decrypted by the server for normal synced behavior.',
  },
  {
    title: 'Optional end-to-end encryption',
    body: 'A user account can create a public/private key pair and enable E2E encryption on selected notes. Only devices with the private key can read those notes, which means the server cannot decrypt their contents.',
  },
  {
    title: 'Search for the thing you almost remember',
    body: 'Search is built for messy developer notes: chunks, headings, entities, keywords, and optional semantic embeddings for signed-in users. Embeddings help search by meaning instead of only exact words, so a query can find related notes even when you forgot the exact phrasing you originally used.',
  },
  {
    title: 'Tools inside the note flow',
    body: 'Use the note you already have open to run small tasks: transform text, inspect JSON, test regex, run HTTP requests, explore OpenAPI specs, compare diffs, and save snippets without jumping between apps.',
  },
  {
    title: 'Files, data, and scratch work',
    body: 'Drop in text files, CSVs, OpenAPI specs, pasted images, or SQLite databases. CSVs can render as tables, OpenAPI files become navigable API notes, images stay attached, and SQLite files can be queried in place.',
  },
]

export default function Landing({ onEnter }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <LandingNav onEnter={onEnter} />
      <LandingHero onEnter={onEnter} />
      <LandingFeatures />
      <LandingFeatureWall />
      <LandingWhy />
      <LandingFooter />
    </div>
  )
}

function LandingNav({ onEnter }) {
  return (
    <nav className="flex items-center justify-between px-8 py-6 border-b border-zinc-800/60">
      <span className="text-zinc-100 font-medium tracking-tight text-sm">jot.it</span>
      <button
        onClick={onEnter}
        className="text-sm text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
      >
        open app -&gt;
      </button>
    </nav>
  )
}

function LandingHero({ onEnter }) {
  return (
    <section className="px-8 py-24 max-w-3xl mx-auto">
      <h1 className="text-4xl sm:text-5xl font-medium text-zinc-50 leading-tight mb-8 tracking-tight">
        I built a<br />note app for me.<br /> You may like it, or hate it.
      </h1>
      <p className="text-zinc-400 text-base leading-relaxed mb-12 max-w-2xl">
        {LANDING_COPY}
      </p>
      <button
        onClick={onEnter}
        className="px-6 py-3 bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 transition-colors cursor-pointer"
      >
        open the app -&gt;
      </button>
    </section>
  )
}

function LandingFeatures() {
  return (
    <section className="px-8 py-16 border-t border-zinc-800/60 max-w-3xl mx-auto">
      <p className="text-zinc-600 text-sm mb-1">{'// how it works'}</p>
      <h2 className="text-2xl font-medium text-zinc-100 tracking-tight mb-8">
        Features worth knowing about
      </h2>
      <div className="grid gap-4">
        {FEATURE_GROUPS.map((feature) => (
          <article key={feature.title} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h3 className="mb-2 text-sm font-medium text-zinc-100">{feature.title}</h3>
            <p className="text-sm leading-relaxed text-zinc-400">{feature.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function LandingFeatureWall() {
  return (
    <section className="px-8 py-16 border-t border-zinc-800/60 max-w-3xl mx-auto">
      <p className="text-zinc-600 text-sm mb-1">{'// what\'s in the box'}</p>
      <div className="columns-2 sm:columns-3 gap-x-8">
        {FEATURES.map((feature) => (
          <FeatureItem key={feature} label={feature} />
        ))}
        <FeatureItem label="and counting." muted />
      </div>
    </section>
  )
}

function FeatureItem({ label, muted = false }) {
  return (
    <div className="flex items-baseline gap-2 mb-2 break-inside-avoid">
      <span className="text-zinc-700 select-none">-</span>
      <span className={`text-sm ${muted ? 'text-zinc-600 italic' : 'text-zinc-300'}`}>
        {label}
      </span>
    </div>
  )
}

function LandingWhy() {
  return (
    <section className="px-8 py-16 border-t border-zinc-800/60 max-w-3xl mx-auto">
      <p className="text-zinc-400 text-base leading-relaxed">
        <span className="text-zinc-100">A lot of why nots went into jot.it.</span>{' '}
        A lot more probably will.
      </p>
    </section>
  )
}

function LandingFooter() {
  return (
    <footer className="px-8 py-8 border-t border-zinc-800/60 max-w-3xl mx-auto">
      <p className="text-zinc-700 text-sm">
        jot.it - ymmv.
      </p>
    </footer>
  )
}
