import { generateId } from './helpers.js'

export const ALL_COLLECTION_ID = '__all_notes__'
export const DEFAULT_COLLECTION_NAME = 'Default'
export const LEGACY_DEFAULT_COLLECTION_NAME = 'All notes'

export function normalizeCollectionSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function createCollectionDraft({ name, description = '', isDefault = false, id = null } = {}) {
  const trimmedName = (name ?? '').trim()
  if (!trimmedName) return null

  const now = Date.now()
  return {
    id: id ?? generateId(),
    name: trimmedName,
    description: description?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
    isDefault,
  }
}

export function createDefaultCollectionDraft() {
  return createCollectionDraft({
    id: 'default',
    name: DEFAULT_COLLECTION_NAME,
    isDefault: true,
  })
}
