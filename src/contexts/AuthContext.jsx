import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  generateAndStoreKeyPair,
  exportPublicKeyJwk,
  wrapPrivateKey,
  getStoredKeyPair,
  importPublicKeyJwk,
  storeKeys,
  unwrapPrivateKey,
  clearStoredKeyPair,
} from '../utils/e2eEncryption'

const AuthContext = createContext(null)

const TOKEN_KEY = 'jotit_auth_token'

async function setupE2EKeysAfterRegister(token, password) {
  try {
    const keyPair = await generateAndStoreKeyPair()
    const publicKeyJwk = await exportPublicKeyJwk(keyPair.publicKey)
    const encryptedPrivateKey = await wrapPrivateKey(keyPair.privateKey, password)
    await fetch('/api/auth/public-key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ publicKey: publicKeyJwk, encryptedPrivateKey }),
    })
  } catch (e) {
    console.warn('[jot.it] E2E key setup failed:', e)
  }
}

async function restoreE2EKeysAfterLogin(user, password) {
  try {
    const existing = await getStoredKeyPair()
    if (existing) return  // Already have keys on this device

    if (user.encryptedPrivateKey && user.publicKey) {
      const privateKey = await unwrapPrivateKey(user.encryptedPrivateKey, password)
      const publicKey = await importPublicKeyJwk(user.publicKey)
      await storeKeys(privateKey, publicKey)
    }
  } catch (e) {
    console.warn('[jot.it] E2E key restore failed:', e)
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { setLoading(false); return }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setUser(data.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false))
  }, [])

  const register = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Registration failed')
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    await setupE2EKeysAfterRegister(data.token, password)
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? `Login failed (${res.status})`)
    localStorage.setItem(TOKEN_KEY, data.token)
    setUser(data.user)
    await restoreE2EKeysAfterLogin(data.user, password)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    clearStoredKeyPair().catch(() => {})
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
