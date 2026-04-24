import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import jwt from 'jsonwebtoken'
import { createRequireAuth, createUserStore, registerAuthRoutes } from '../server/auth.js'
import { createMockApp, createMockResponse, runHandlers } from './helpers.js'

const JWT_SECRET = 'test-secret'

async function testRequireAuthRejectsMissingBearerToken() {
  const requireAuth = createRequireAuth(JWT_SECRET)
  const req = { headers: {} }
  const res = createMockResponse()

  await requireAuth(req, res, () => {})

  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.jsonBody, { error: 'Unauthorized' })
}

async function testRegisterLoginAndMeFlow() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jotit-auth-'))
  const userDbPath = path.join(tempDir, 'users.test.db')
  const userDb = createUserStore(userDbPath)
  const requireAuth = createRequireAuth(JWT_SECRET)
  const app = createMockApp()

  try {
    registerAuthRoutes(app, { jwtSecret: JWT_SECRET, requireAuth, userDb })

    const registerHandlers = app.routes.post.get('/api/auth/register')
    const registerReq = { body: { email: 'Test@Example.com', password: 'password123' } }
    const registerRes = createMockResponse()
    await runHandlers(registerHandlers, registerReq, registerRes)

    assert.equal(registerRes.statusCode, 200)
    assert.equal(registerRes.jsonBody.user.email, 'test@example.com')
    assert.ok(registerRes.jsonBody.token)

    const loginHandlers = app.routes.post.get('/api/auth/login')
    const loginReq = { body: { email: 'test@example.com', password: 'password123' } }
    const loginRes = createMockResponse()
    await runHandlers(loginHandlers, loginReq, loginRes)

    assert.equal(loginRes.statusCode, 200)
    assert.equal(loginRes.jsonBody.user.email, 'test@example.com')

    const meHandlers = app.routes.get.get('/api/auth/me')
    const meReq = {
      headers: {
        authorization: `Bearer ${loginRes.jsonBody.token}`,
      },
    }
    const meRes = createMockResponse()
    await runHandlers(meHandlers, meReq, meRes)

    const decoded = jwt.verify(loginRes.jsonBody.token, JWT_SECRET)
    assert.equal(meRes.statusCode, 200)
    assert.deepEqual(meRes.jsonBody.user, {
      id: decoded.userId,
      email: decoded.email,
    })
  } finally {
    userDb.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function testRegisterRejectsDuplicateEmail() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jotit-auth-'))
  const userDbPath = path.join(tempDir, 'users.test.db')
  const userDb = createUserStore(userDbPath)
  const app = createMockApp()

  try {
    registerAuthRoutes(app, {
      jwtSecret: JWT_SECRET,
      requireAuth: createRequireAuth(JWT_SECRET),
      userDb,
    })

    const registerHandlers = app.routes.post.get('/api/auth/register')
    const req = { body: { email: 'dup@example.com', password: 'password123' } }

    await runHandlers(registerHandlers, req, createMockResponse())
    const duplicateRes = createMockResponse()
    await runHandlers(registerHandlers, req, duplicateRes)

    assert.equal(duplicateRes.statusCode, 409)
    assert.deepEqual(duplicateRes.jsonBody, { error: 'An account with that email already exists' })
  } finally {
    userDb.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

export default [
  ['createRequireAuth rejects missing bearer token', testRequireAuthRejectsMissingBearerToken],
  ['register/login/me flow works', testRegisterLoginAndMeFlow],
  ['register rejects duplicate email', testRegisterRejectsDuplicateEmail],
]
