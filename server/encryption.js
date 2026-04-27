import crypto from 'crypto'
import { logServerError } from './http.js'

const ALGORITHM = 'aes-256-gcm'
const KEY_LEN = 32  // 256-bit key
const IV_LEN = 12   // 96-bit IV (recommended for GCM)
const TAG_LEN = 16  // 128-bit auth tag

function masterKey() {
  const hex = process.env.MASTER_ENCRYPTION_KEY ?? ''
  if (!hex) throw new Error('MASTER_ENCRYPTION_KEY not configured')
  const buf = Buffer.from(hex, 'hex')
  if (buf.length !== KEY_LEN) throw new Error('MASTER_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  return buf
}

export function hasMasterKey() {
  return Boolean(process.env.MASTER_ENCRYPTION_KEY)
}

// Wraps a fresh random 256-bit data key with the master key.
// Returns { encryptedKey, iv } as hex strings — safe to store in DB.
export function generateUserDataKey() {
  const mk = masterKey()
  const dataKey = crypto.randomBytes(KEY_LEN)
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGORITHM, mk, iv)
  const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()])
  const tag = cipher.getAuthTag()
  // Layout: ciphertext(KEY_LEN) + tag(TAG_LEN), stored as hex
  return {
    encryptedKey: Buffer.concat([encrypted, tag]).toString('hex'),
    iv: iv.toString('hex'),
  }
}

// Unwraps a user data key previously returned by generateUserDataKey.
export function unwrapUserDataKey(encryptedKeyHex, ivHex) {
  const mk = masterKey()
  const iv = Buffer.from(ivHex, 'hex')
  const blob = Buffer.from(encryptedKeyHex, 'hex')
  const ciphertext = blob.subarray(0, KEY_LEN)
  const tag = blob.subarray(KEY_LEN, KEY_LEN + TAG_LEN)
  const decipher = crypto.createDecipheriv(ALGORITHM, mk, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function encryptField(plaintext, dataKeyBuf) {
  if (plaintext == null) return { ciphertext: null, iv: null, tag: null }
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGORITHM, dataKeyBuf, iv)
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  }
}

export function decryptField(ciphertextHex, ivHex, tagHex, dataKeyBuf) {
  if (!ciphertextHex || !ivHex || !tagHex) return null
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, dataKeyBuf, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8')
  } catch (e) {
    logServerError('[jot.it] decryptField failed:', e)
    return null
  }
}

// Encrypts content + note_data fields of a note row in-place (Tier 1).
export function encryptNoteRow(note, dataKeyBuf) {
  const content = encryptField(note.content, dataKeyBuf)
  const noteData = encryptField(note.note_data, dataKeyBuf)
  return {
    ...note,
    content: content.ciphertext ?? '',
    content_iv: content.iv,
    content_tag: content.tag,
    note_data: noteData.ciphertext,
    note_data_iv: noteData.iv,
    note_data_tag: noteData.tag,
    encryption_tier: 1,
  }
}

// Decrypts a note row returned from Postgres.
// Tier 0: no-op. Tier 2 (client E2E): no-op — server never holds the key.
export function decryptNoteRow(row, dataKeyBuf) {
  const tier = Number(row.encryption_tier ?? 0)
  if (tier === 0 || tier === 2) return row
  return {
    ...row,
    content: decryptField(row.content, row.content_iv, row.content_tag, dataKeyBuf) ?? '',
    note_data: decryptField(row.note_data, row.note_data_iv, row.note_data_tag, dataKeyBuf),
  }
}

// Convenience: unwrap a user's data key from their DB row.
export function getDataKeyForUser(user) {
  if (!user?.encrypted_data_key || !user?.data_key_iv) return null
  try {
    return unwrapUserDataKey(user.encrypted_data_key, user.data_key_iv)
  } catch (e) {
    logServerError('[jot.it] getDataKeyForUser failed:', e)
    return null
  }
}
