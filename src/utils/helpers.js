export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const CATEGORY_COLORS = {
  password:    'bg-red-950/80 text-red-400 border-red-900',
  token:       'bg-orange-950/80 text-orange-400 border-orange-900',
  'api-key':   'bg-orange-950/80 text-orange-400 border-orange-900',
  credentials: 'bg-red-950/80 text-red-400 border-red-900',
  secret:      'bg-red-950/80 text-red-400 border-red-900',
  config:      'bg-blue-950/80 text-blue-400 border-blue-900',
  snippet:     'bg-purple-950/80 text-purple-400 border-purple-900',
  command:     'bg-violet-950/80 text-violet-400 border-violet-900',
  sql:         'bg-indigo-950/80 text-indigo-400 border-indigo-900',
  'error-log': 'bg-yellow-950/80 text-yellow-400 border-yellow-900',
  log:         'bg-yellow-950/80 text-yellow-500 border-yellow-900',
  url:         'bg-cyan-950/80 text-cyan-400 border-cyan-900',
  link:        'bg-cyan-950/80 text-cyan-400 border-cyan-900',
  github:      'bg-slate-800/80 text-slate-300 border-slate-700',
  aws:         'bg-amber-950/80 text-amber-400 border-amber-900',
  docker:      'bg-sky-950/80 text-sky-400 border-sky-900',
  'csv / tables': 'bg-cyan-950/80 text-cyan-300 border-cyan-900',
  csv:         'bg-cyan-950/80 text-cyan-300 border-cyan-900',
  table:       'bg-cyan-950/80 text-cyan-300 border-cyan-900',
  spreadsheet: 'bg-cyan-950/80 text-cyan-300 border-cyan-900',
  'diagrams / flowcharts': 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-900',
  diagram:     'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-900',
  flowchart:   'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-900',
}

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category.toLowerCase()] ?? 'bg-zinc-800/80 text-zinc-400 border-zinc-700'
}

export const SAMPLE_NOTES = [
  {
    id: 'sample-1',
    content: 'GitHub Personal Access Token\nghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\nScopes: repo, workflow, read:org\nExpires: 2026-12-31\nCreated for: CI/CD pipeline',
    categories: ['github', 'token', 'api-key', 'credentials'],
    embedding: null,
    createdAt: Date.now() - 86400000 * 3,
    updatedAt: Date.now() - 86400000 * 3,
  },
  {
    id: 'sample-2',
    content: 'Postgres Dev Connection\nHost: localhost:5432\nDB: myapp_dev\nUser: postgres\nPass: devpassword123\n\npsql -U postgres -d myapp_dev',
    categories: ['config', 'credentials', 'sql', 'postgres'],
    embedding: null,
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'sample-3',
    content: 'Docker compose snippet\nservices:\n  web:\n    image: node:20-alpine\n    ports:\n      - "3000:3000"\n    volumes:\n      - .:/app\n    command: npm run dev',
    categories: ['docker', 'config', 'snippet'],
    embedding: null,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'sample-4',
    content: 'AWS Access Keys\nAccount: prod\nAccess Key ID: AKIAIOSFODNN7EXAMPLE\nSecret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nRegion: us-east-1',
    categories: ['aws', 'credentials', 'api-key'],
    embedding: null,
    createdAt: Date.now() - 3600000 * 5,
    updatedAt: Date.now() - 3600000 * 5,
  },
  {
    id: 'sample-5',
    content: 'Nginx error log\n2026/04/18 14:23:11 [error] 1234#0: *567 connect() failed\n(111: Connection refused) while connecting to upstream,\nclient: 10.0.0.1, server: api.example.com,\nrequest: "POST /api/v2/users HTTP/1.1"',
    categories: ['error-log', 'nginx', 'log'],
    embedding: null,
    createdAt: Date.now() - 3600000 * 2,
    updatedAt: Date.now() - 3600000 * 2,
  },
  {
    id: 'sample-6',
    content: 'OpenAI API Key\nsk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\nOrg: Personal\nProject: jotit-dev\nLimit: $20/mo',
    categories: ['api-key', 'token', 'openai', 'credentials'],
    embedding: null,
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3600000,
  },
]
