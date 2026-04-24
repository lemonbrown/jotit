import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createRequireAuth, createUserStore, registerAuthRoutes } from './server/auth.js'
import { createAiService, registerAiRoutes } from './server/ai.js'
import { registerEnvRoute, registerSpaFallback } from './server/infra.js'
import { registerPublicSharing } from './server/publicSharing.js'
import { registerProxyRoute } from './server/proxy.js'
import { createSyncPool, registerSyncRoutes } from './server/sync.js'
import { registerSearchRoutes } from './server/search.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT ?? 3001
const BUCKETS_FILE = join(__dirname, 'buckets.json')
const PUBLIC_NOTES_FILE = join(__dirname, 'public-notes.json')
const USER_DB_FILE = join(__dirname, 'users.db')
const DIST_DIR = join(__dirname, 'dist')
const JWT_SECRET = process.env.JWT_SECRET ?? 'jotit-dev-secret-change-in-prod'

const pgPool = createSyncPool(process.env.DATABASE_URL)
const userDb = createUserStore(USER_DB_FILE)
const requireAuth = createRequireAuth(JWT_SECRET)
const aiService = createAiService(process.env.OPENAI_API_KEY)

app.use(express.json({ limit: '10mb' }))
registerEnvRoute(app)
app.use(express.static(DIST_DIR))

registerAuthRoutes(app, { jwtSecret: JWT_SECRET, requireAuth, userDb })
registerAiRoutes(app, { aiService, pgPool, requireAuth })
registerPublicSharing(app, {
  bucketsFile: BUCKETS_FILE,
  publicNotesFile: PUBLIC_NOTES_FILE,
  pgPool,
})
registerSyncRoutes(app, { aiService, pgPool, requireAuth })
registerSearchRoutes(app, { aiService, pgPool, requireAuth })
registerProxyRoute(app)
registerSpaFallback(app, { distIndexFile: join(DIST_DIR, 'index.html') })

app.listen(PORT, '127.0.0.1', () => {
  console.log(`jotit server -> http://127.0.0.1:${PORT}`)
})
