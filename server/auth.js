import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { sendJsonError } from './http.js'
import { generateUserDataKey, hasMasterKey } from './encryption.js'

export function createUserStore(userDbPath) {
  const userDb = new Database(userDbPath)
  userDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      email                 TEXT UNIQUE NOT NULL,
      password_hash         TEXT NOT NULL,
      encrypted_data_key    TEXT,
      data_key_iv           TEXT,
      public_key            TEXT,
      encrypted_private_key TEXT,
      created_at            INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  // Migrations for existing databases
  const migrations = [
    `ALTER TABLE users ADD COLUMN encrypted_data_key TEXT`,
    `ALTER TABLE users ADD COLUMN data_key_iv TEXT`,
    `ALTER TABLE users ADD COLUMN public_key TEXT`,
    `ALTER TABLE users ADD COLUMN encrypted_private_key TEXT`,
  ]
  for (const sql of migrations) {
    try { userDb.exec(sql) } catch {}
  }

  return userDb
}

export function createRequireAuth(jwtSecret) {
  return function requireAuth(req, res, next) {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Unauthorized' })

    try {
      req.user = jwt.verify(token, jwtSecret)
      next()
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' })
    }
  }
}

function normalizeEmail(email) {
  return email.toLowerCase().trim()
}

function createAuthToken(jwtSecret, userId, email) {
  return jwt.sign({ userId, email }, jwtSecret, { expiresIn: '30d' })
}

function userPublicFields(user) {
  return {
    id: user.id,
    email: user.email,
    publicKey: user.public_key ?? null,
    encryptedPrivateKey: user.encrypted_private_key ?? null,
  }
}

export function registerAuthRoutes(app, { jwtSecret, requireAuth, userDb }) {
  app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body ?? {}
    if (!email || !password) return sendJsonError(res, 400, 'Email and password are required')
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJsonError(res, 400, 'Invalid email address')
    }
    if (typeof password !== 'string' || password.length < 8) {
      return sendJsonError(res, 400, 'Password must be at least 8 characters')
    }

    try {
      const normalizedEmail = normalizeEmail(email)
      const hash = await bcrypt.hash(password, 10)

      let encrypted_data_key = null
      let data_key_iv = null
      if (hasMasterKey()) {
        try {
          const key = generateUserDataKey()
          encrypted_data_key = key.encryptedKey
          data_key_iv = key.iv
        } catch (e) {
          console.warn('[jot.it] Failed to generate user data key:', e.message)
        }
      }

      const stmt = userDb.prepare(
        'INSERT INTO users (email, password_hash, encrypted_data_key, data_key_iv) VALUES (?, ?, ?, ?)'
      )
      const result = stmt.run(normalizedEmail, hash, encrypted_data_key, data_key_iv)
      const token = createAuthToken(jwtSecret, result.lastInsertRowid, normalizedEmail)
      res.json({
        token,
        user: { id: result.lastInsertRowid, email: normalizedEmail, publicKey: null, encryptedPrivateKey: null },
      })
    } catch (e) {
      if (e.message?.includes('UNIQUE')) {
        return sendJsonError(res, 409, 'An account with that email already exists')
      }
      sendJsonError(res, 500, 'Registration failed')
    }
  })

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {}
    if (!email || !password) return sendJsonError(res, 400, 'Email and password are required')

    const normalizedEmail = normalizeEmail(email)
    const user = userDb.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail)
    if (!user) return sendJsonError(res, 401, 'Invalid email or password')

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return sendJsonError(res, 401, 'Invalid email or password')

    const token = createAuthToken(jwtSecret, user.id, user.email)
    res.json({ token, user: userPublicFields(user) })
  })

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = userDb.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId)
    if (!user) return sendJsonError(res, 404, 'User not found')
    res.json({ user: userPublicFields(user) })
  })

  // Store the client-generated RSA public key and encrypted private key backup.
  app.put('/api/auth/public-key', requireAuth, (req, res) => {
    const { publicKey, encryptedPrivateKey } = req.body ?? {}
    if (!publicKey || typeof publicKey !== 'string') {
      return sendJsonError(res, 400, 'publicKey is required')
    }
    userDb.prepare('UPDATE users SET public_key = ?, encrypted_private_key = ? WHERE id = ?')
      .run(publicKey, encryptedPrivateKey ?? null, req.user.userId)
    res.json({ ok: true })
  })

  // Fetch another user's public key (needed for E2E sharing).
  app.get('/api/users/:userId/public-key', requireAuth, (req, res) => {
    const userId = parseInt(req.params.userId, 10)
    if (!userId) return sendJsonError(res, 400, 'Invalid user ID')
    const row = userDb.prepare('SELECT public_key FROM users WHERE id = ?').get(userId)
    if (!row?.public_key) return sendJsonError(res, 404, 'No public key found for this user')
    res.json({ publicKey: row.public_key })
  })
}
