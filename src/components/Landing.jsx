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

export default function Landing({ onEnter }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <LandingNav onEnter={onEnter} />
      <LandingHero onEnter={onEnter} />
      <LandingFeatureWall />
      <LandingWhy />
      <LandingFooter />
    </div>
  )
}

function LandingNav({ onEnter }) {
  return (
    <nav className="flex items-center justify-between px-8 py-6 border-b border-zinc-800/60">
      <span className="text-zinc-100 font-medium tracking-tight text-sm">jotit</span>
      <button
        onClick={onEnter}
        className="text-sm text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
      >
        open app →
      </button>
    </nav>
  )
}

function LandingHero({ onEnter }) {
  return (
    <section className="px-8 py-24 max-w-3xl mx-auto">
      <h1 className="text-4xl sm:text-5xl font-medium text-zinc-50 leading-tight mb-8 tracking-tight">
        A note app that<br />got out of hand.
      </h1>
      <p className="text-zinc-400 text-base leading-relaxed mb-12 max-w-xl">
        It started as a place to jot things down. Then it needed search.
        Then HTTP execution. Then an OpenAPI explorer. Then a regex tester. Then—
      </p>
      <button
        onClick={onEnter}
        className="px-6 py-3 bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 transition-colors cursor-pointer"
      >
        open the app →
      </button>
    </section>
  )
}

function LandingFeatureWall() {
  return (
    <section className="px-8 py-16 border-t border-zinc-800/60 max-w-3xl mx-auto">
      <p className="text-zinc-600 text-sm mb-1">{'// what\'s in the box'}</p>
      <p className="text-zinc-700 text-xs mb-8">{`// ${FEATURES.length} features you didn't ask for`}</p>
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
      <span className="text-zinc-700 select-none">—</span>
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
        Every tool you reach for mid-thought breaks your flow.{' '}
        <span className="text-zinc-100">jot.it just... has it.</span>{' '}
        Overkill? Probably. Useful? Definitely.
      </p>
    </section>
  )
}

function LandingFooter() {
  return (
    <footer className="px-8 py-8 border-t border-zinc-800/60 max-w-3xl mx-auto">
      <p className="text-zinc-700 text-sm">
        jotit — built for brains that won't slow down.
      </p>
    </footer>
  )
}
