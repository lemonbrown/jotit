import {
  getDirtyNotes, markSynced, cleanupPendingDeletes,
  upsertNoteSync, deleteNoteSync, getAllNotes, schedulePersist, getNote,
} from './db.js'

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
  if (!dirty.length) return

  try {
    const res = await fetch('/api/sync/push', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        notes: dirty.map(n => ({
          id: n.id,
          content: n.content,
          categories: JSON.stringify(n.categories ?? []),
          note_type: n.noteType ?? 'text',
          note_data: n.noteData ? JSON.stringify(n.noteData) : null,
          created_at: n.createdAt,
          updated_at: n.updatedAt,
          is_public: n.isPublic ? 1 : 0,
          deleted: n.pendingDelete,
        })),
      }),
    })
    if (!res.ok) return
    markSynced(dirty.filter(n => !n.pendingDelete).map(n => n.id))
    cleanupPendingDeletes()
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

    const { notes: serverNotes, serverTime } = await res.json()
    for (const sn of serverNotes) {
      if (sn.deleted_at) {
        deleteNoteSync(sn.id)
      } else {
        const local = getNote(sn.id)
        if (local?.pendingDelete) continue
        if (local && local.updatedAt >= Number(sn.updated_at)) continue
        upsertNoteSync({
          id: sn.id,
          content: sn.content,
          categories: JSON.parse(sn.categories ?? '[]'),
          embedding: sn.embedding ? JSON.parse(sn.embedding) : null,
          noteType: sn.note_type ?? 'text',
          noteData: sn.note_data ? JSON.parse(sn.note_data) : null,
          createdAt: Number(sn.created_at),
          updatedAt: Number(sn.updated_at),
          isPublic: sn.is_public === 1,
        }, 0)
      }
    }

    localStorage.setItem(LAST_PULL_KEY, String(serverTime))
    schedulePersist()
  } catch {}
}

export async function syncAll() {
  await syncPull()
  await syncPush()
}
