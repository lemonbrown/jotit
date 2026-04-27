// Client-side end-to-end encryption using the Web Crypto API.
//
// Key hierarchy:
//   RSA-OAEP key pair (per user, generated once, stored in IndexedDB)
//     └─ encrypts a random AES-256-GCM content key per note
//         └─ encrypts note content + note_data
//
// The private key never leaves the browser. The server only ever sees
// the RSA public key and encrypted blobs it cannot decrypt.

const RSA_PARAMS = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}
const AES_PARAMS = { name: 'AES-GCM', length: 256 }

const KEYS_IDB_NAME = 'jotit_keys'
const KEYS_STORE = 'keys'

// ── Helpers ───────────────────────────────────────────────────────────────────

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer ?? buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

// ── IndexedDB key store ───────────────────────────────────────────────────────

async function openKeysIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEYS_IDB_NAME, 1)
    req.onupgradeneeded = e => e.target.result.createObjectStore(KEYS_STORE)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

export async function storeKeys(privateKey, publicKey) {
  const idb = await openKeysIDB()
  return new Promise((resolve) => {
    const tx = idb.transaction(KEYS_STORE, 'readwrite')
    tx.objectStore(KEYS_STORE).put({ privateKey, publicKey }, 'keypair')
    tx.oncomplete = resolve
    tx.onerror = resolve
  })
}

export async function getStoredKeyPair() {
  try {
    const idb = await openKeysIDB()
    return new Promise((resolve) => {
      const tx = idb.transaction(KEYS_STORE, 'readonly')
      const req = tx.objectStore(KEYS_STORE).get('keypair')
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

export async function clearStoredKeyPair() {
  try {
    const idb = await openKeysIDB()
    return new Promise((resolve) => {
      const tx = idb.transaction(KEYS_STORE, 'readwrite')
      tx.objectStore(KEYS_STORE).delete('keypair')
      tx.oncomplete = resolve
      tx.onerror = resolve
    })
  } catch {}
}

// ── Key generation & export ───────────────────────────────────────────────────

export async function generateAndStoreKeyPair() {
  const keyPair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt'])
  await storeKeys(keyPair.privateKey, keyPair.publicKey)
  return keyPair
}

export async function exportPublicKeyJwk(publicKey) {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', publicKey))
}

export async function importPublicKeyJwk(jwkString) {
  const jwk = typeof jwkString === 'string' ? JSON.parse(jwkString) : jwkString
  return crypto.subtle.importKey('jwk', jwk, RSA_PARAMS, true, ['encrypt'])
}

// ── Private key wrapping (server backup / multi-device restore) ───────────────
//
// PBKDF2(passphrase) derives an AES-256-GCM key that encrypts the raw PKCS8
// bytes. AES-GCM has no alignment restriction (AES-KW requires multiples of 8
// bytes which RSA PKCS8 encodings don't always satisfy).
// Layout stored as base64: salt(16) + iv(12) + ciphertext.

export async function wrapPrivateKey(privateKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, pkcs8)
  const combined = new Uint8Array(16 + 12 + encrypted.byteLength)
  combined.set(salt, 0)
  combined.set(iv, 16)
  combined.set(new Uint8Array(encrypted), 28)
  return bufToBase64(combined)
}

export async function unwrapPrivateKey(base64Blob, passphrase) {
  const combined  = base64ToBuf(base64Blob)
  const salt      = combined.slice(0, 16)
  const iv        = combined.slice(16, 28)
  const encrypted = combined.slice(28)
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, encrypted)
  return crypto.subtle.importKey('pkcs8', pkcs8, RSA_PARAMS, true, ['decrypt'])
}

// ── Note encryption / decryption ──────────────────────────────────────────────
//
// Web Crypto AES-GCM appends the 16-byte auth tag to the ciphertext automatically,
// so content_tag is not stored separately (unlike the server-side Node.js path).

export async function encryptNoteE2E(content, noteData, publicKey) {
  const contentKey = await crypto.subtle.generateKey(AES_PARAMS, true, ['encrypt', 'decrypt'])

  const contentIv = crypto.getRandomValues(new Uint8Array(12))
  const encryptedContent = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: contentIv },
    contentKey,
    new TextEncoder().encode(content ?? '')
  )

  let encryptedNoteData = null
  let noteDataIv = null
  if (noteData != null) {
    noteDataIv = crypto.getRandomValues(new Uint8Array(12))
    const raw = typeof noteData === 'string' ? noteData : JSON.stringify(noteData)
    encryptedNoteData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: noteDataIv },
      contentKey,
      new TextEncoder().encode(raw)
    )
  }

  // Encrypt the AES content key with the recipient's RSA public key
  const rawContentKey = await crypto.subtle.exportKey('raw', contentKey)
  const encryptedContentKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' }, publicKey, rawContentKey
  )

  return {
    content: bufToBase64(encryptedContent),
    content_iv: bufToBase64(contentIv),
    note_data: encryptedNoteData ? bufToBase64(encryptedNoteData) : null,
    note_data_iv: noteDataIv ? bufToBase64(noteDataIv) : null,
    encrypted_content_key: bufToBase64(encryptedContentKey),
    encryption_tier: 2,
  }
}

export async function decryptNoteE2E(encryptedContent, contentIvB64, encryptedNoteData, noteDataIvB64, encryptedContentKeyB64, privateKey) {
  const rawContentKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToBuf(encryptedContentKeyB64)
  )
  const contentKey = await crypto.subtle.importKey('raw', rawContentKey, AES_PARAMS, false, ['decrypt'])

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBuf(contentIvB64) },
    contentKey,
    base64ToBuf(encryptedContent)
  )

  let noteData = null
  if (encryptedNoteData && noteDataIvB64) {
    const rawNoteData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBuf(noteDataIvB64) },
      contentKey,
      base64ToBuf(encryptedNoteData)
    )
    noteData = new TextDecoder().decode(rawNoteData)
  }

  return {
    content: new TextDecoder().decode(plaintext),
    noteData,
  }
}
