const IDB_NAME = 'jotit_sqlite_assets'
const IDB_STORE = 'sqlite_files'

function openAssetsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

function isSQLiteFileName(name = '') {
  return /\.(sqlite|sqlite3|db)$/i.test(name)
}

function normalizeSQLiteAsset(asset, bytes, overrides = {}) {
  const now = Date.now()
  return {
    ...asset,
    ...overrides,
    bytes,
    size: bytes.byteLength,
    updatedAt: now,
  }
}

export async function saveSQLiteAsset(asset) {
  const idb = await openAssetsDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(asset)
    tx.oncomplete = () => resolve(asset)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getSQLiteAsset(id) {
  if (!id) return null
  const idb = await openAssetsDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function createSQLiteAssetFromFile(file, id) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const now = Date.now()
  const asset = {
    id,
    fileName: file.name,
    size: file.size,
    mimeType: file.type || 'application/vnd.sqlite3',
    createdAt: now,
    updatedAt: now,
    bytes,
  }
  await saveSQLiteAsset(asset)
  return asset
}

export async function replaceSQLiteAssetFromFile(id, file) {
  const existing = await getSQLiteAsset(id)
  if (!existing) throw new Error('SQLite asset not found in local storage.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const asset = normalizeSQLiteAsset(existing, bytes, {
    fileName: file.name || existing.fileName,
    mimeType: file.type || existing.mimeType || 'application/vnd.sqlite3',
  })
  await saveSQLiteAsset(asset)
  return asset
}

export async function replaceSQLiteAssetBytes(id, bytes, overrides = {}) {
  const existing = await getSQLiteAsset(id)
  if (!existing) throw new Error('SQLite asset not found in local storage.')
  const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const asset = normalizeSQLiteAsset(existing, normalizedBytes, overrides)
  await saveSQLiteAsset(asset)
  return asset
}

export function downloadSQLiteAsset(asset) {
  if (!asset?.bytes?.byteLength) return

  const blob = new Blob([asset.bytes], { type: asset.mimeType || 'application/vnd.sqlite3' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = asset.fileName || 'database.sqlite'
  anchor.click()
  URL.revokeObjectURL(url)
}

export { isSQLiteFileName }
