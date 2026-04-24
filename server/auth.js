import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { sendJsonError } from './http.js'

export function createUserStore(userDbPath) {
  const userDb = new Database(userDbPath)
  userDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

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
      const stmt = userDb.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      const result = stmt.run(normalizedEmail, hash)
      const token = createAuthToken(jwtSecret, result.lastInsertRowid, normalizedEmail)
      res.json({ token, user: { id: result.lastInsertRowid, email: normalizedEmail } })
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
    res.json({ token, user: { id: user.id, email: user.email } })
  })

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: { id: req.user.userId, email: req.user.email } })
  })
}
