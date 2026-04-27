import {
  getDirtyNotes, markSynced, cleanupPendingDeletes,
  upsertNoteSync, deleteNoteSync, schedulePersist, getNote,
  getDirtyCollections, markCollectionsSynced, cleanupPendingCollectionDeletes,
  upsertCollectionSync, deleteCollectionSync,
} from './db.js'
import { getStoredKeyPair, encryptNoteE2E, decryptNoteE2E } from './e2eEncryption.js'

const TOKEN_KEY = 'jotit_auth_token'
const LAST_PULL_KEY = 'jotit_last_pull_ts'

let pushTimer = null

function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }
}

export function scheduleSyncPush() {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(syncPush, 800)
}

export async function syncPush() {
  if (!getToken()) return
  const dirty = getDirtyNotes()
  const dirtyCollections = getDirtyCollections()
  if (!dirty.length && !dirtyCollections.length) return

  // Fetch key pair once if any E2E notes need encrypting
  let keyPair = null
  if (dirty.some(n => n.encryptionTier === 2 && !n.pendingDelete)) {
    keyPair = await getStoredKeyPair()
  }

  try {
    const notesPayload = await Promise.all(dirty.map(async n => {
      if (n.pendingDelete) return { id: n.id, deleted: true }

      const base = {
        id: n.id,
        categories: JSON.stringify(n.categories ?? []),
        note_type: n.noteType ?? 'text',
        collection_id: n.collectionId ?? 'default',
        created_at: n.createdAt,
        updated_at: n.updatedAt,
        is_public: n.isPublic ? 1 : 0,
        encryption_tier: n.encryptionTier ?? 0,
      }

      if (n.encryptionTier === 2 && keyPair?.publicKey) {
        const noteDataStr = n.noteData ? JSON.stringify(n.noteData) : null
        const encrypted = await encryptNoteE2E(n.content, noteDataStr, keyPair.publicKey)
        return { ...base, ...encrypted }
      }

      return {
        ...base,
        content: n.content,
        note_data: n.noteData ? JSON.stringify(n.noteData) : null,
      }
    }))

    const collectionsPayload = dirtyCollections.map(collection => {
      if (collection.pendingDelete) return { id: collection.id, deleted: true }
      return {
        id: collection.id,
        name: collection.name,
        description: collection.description ?? '',
        created_at: collection.createdAt,
        updated_at: collection.updatedAt,
        is_default: collection.isDefault ? 1 : 0,
      }
    })

    const res = await fetch('/api/sync/push', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ collections: collectionsPayload, notes: notesPayload }),
    })
    if (!res.ok) return
    markSynced(dirty.filter(n => !n.pendingDelete).map(n => n.id))
    markCollectionsSynced(dirtyCollections.filter(c => !c.pendingDelete).map(c => c.id))
    cleanupPendingDeletes()
    cleanupPendingCollectionDeletes()
    schedulePersist()
  } catch {}
}

export async function syncPull() {
  if (!getToken()) return
  const since = Math.max(0, parseInt(localStorage.getItem(LAST_PULL_KEY) ?? '0', 10) || 0)

  try {
    const res = await fetch(`/api/sync/pull?since=${since}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!res.ok) return

    const { collections: serverCollections = [], notes: serverNotes, serverTime } = await res.json()

    for (const sc of serverCollections) {
      if (sc.deleted_at) {
        deleteCollectionSync(sc.id)
        continue
      }

      upsertCollectionSync({
        id: sc.id,
        name: sc.name,
        description: sc.description ?? '',
        createdAt: Number(sc.created_at),
        updatedAt: Number(sc.updated_at),
        isDefault: sc.is_default === 1,
      }, 0)
    }

    // Fetch key pair once if any E2E notes need decrypting
    let keyPair = null
    if (serverNotes.some(sn => Number(sn.encryption_tier) === 2 && !sn.deleted_at && sn.encrypted_content_key)) {
      keyPair = await getStoredKeyPair()
    }

    for (const sn of serverNotes) {
      if (sn.deleted_at) {
        deleteNoteSync(sn.id)
        continue
      }

      const local = getNote(sn.id)
      if (local?.pendingDelete) continue
      if (local && local.updatedAt >= Number(sn.updated_at)) continue

      let content = sn.content
      let noteData = sn.note_data ? JSON.parse(sn.note_data) : null

      if (Number(sn.encryption_tier) === 2 && sn.encrypted_content_key) {
        if (keyPair?.privateKey) {
          try {
            const decrypted = await decryptNoteE2E(
              sn.content,
              sn.content_iv,
              sn.note_data,
              sn.note_data_iv,
              sn.encrypted_content_key,
              keyPair.privateKey
            )
            content = decrypted.content
            noteData = decrypted.noteData ? JSON.parse(decrypted.noteData) : null
          } catch {
            // Can't decrypt — skip rather than clobber local copy
            continue
          }
        } else {
          // E2E keys not available on this device — skip
          continue
        }
      }

      upsertNoteSync({
        id: sn.id,
        content,
        categories: JSON.parse(sn.categories ?? '[]'),
        embedding: sn.embedding ? JSON.parse(sn.embedding) : null,
        noteType: sn.note_type ?? 'text',
        noteData,
        collectionId: sn.collection_id ?? 'default',
        createdAt: Number(sn.created_at),
        updatedAt: Number(sn.updated_at),
        isPublic: sn.is_public === 1,
        encryptionTier: Number(sn.encryption_tier ?? 0),
      }, 0)
    }

    localStorage.setItem(LAST_PULL_KEY, String(serverTime))
    schedulePersist()
  } catch {}
}

export async function syncAll() {
  await syncPull()
  await syncPush()
}
