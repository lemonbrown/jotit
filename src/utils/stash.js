import { generateId } from './helpers.js'

const STASH_KEY = 'jotit_stash_values'
const REF_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g

function normalizeItem(item) {
  const key = String(item?.key ?? '').trim()
  if (!key) return null
  const now = Date.now()
  return {
    id: item.id || generateId(),
    key,
    value: String(item.value ?? ''),
    secret: Boolean(item.secret),
    description: String(item.description ?? ''),
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
  }
}

export function loadStashItems() {
  try {
    const raw = localStorage.getItem(STASH_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.map(normalizeItem).filter(Boolean).sort((a, b) => a.key.localeCompare(b.key))
      : []
  } catch {
    return []
  }
}

export function saveStashItems(items) {
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify(items.map(normalizeItem).filter(Boolean)))
    window.dispatchEvent(new CustomEvent('jotit:stash-changed'))
  } catch {}
}

export function upsertStashItem(item) {
  const draft = normalizeItem({ ...item, updatedAt: Date.now() })
  if (!draft) return loadStashItems()
  const existing = loadStashItems()
  const without = existing.filter(entry => entry.id !== draft.id && entry.key !== draft.key)
  const next = [...without, draft].sort((a, b) => a.key.localeCompare(b.key))
  saveStashItems(next)
  return next
}

export function deleteStashItem(id) {
  const next = loadStashItems().filter(item => item.id !== id)
  saveStashItems(next)
  return next
}

export function filterStashItems(items, query = '') {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return items
  return items.filter(item =>
    item.key.toLowerCase().includes(q) ||
    item.value.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q)
  )
}

export function maskStashValue(value) {
  if (!value) return ''
  return '•'.repeat(Math.min(Math.max(String(value).length, 8), 16))
}

export function resolveStashRefs(text, items = loadStashItems()) {
  const byKey = new Map(items.map(item => [item.key, item.value]))
  return String(text ?? '').replace(REF_RE, (match, key) => byKey.has(key) ? byKey.get(key) : match)
}

export function getStashCommandTrigger(text, cursor) {
  const before = String(text ?? '').slice(0, cursor)
  const lineStart = before.lastIndexOf('\n') + 1
  const line = before.slice(lineStart)
  const match = line.match(/^\/vars?(?:\s+(.*))?$/i)
  if (!match) return null
  return {
    start: lineStart,
    end: cursor,
    query: match[1] ?? '',
  }
}

export function stashRef(key) {
  return `{{${key}}}`
}
