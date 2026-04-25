// Attachment IDs in note content use this prefix so the search index and entity
// extractor can identify and skip them cheaply without regex overhead.
export const IMG_MARKER_PREFIX = 'img://'

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024 // 5 MB (base64-encoded)
export const ATTACHMENT_MAX_DIMENSION = 2400         // px — resized before storage
export const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

// ── Marker helpers ─────────────────────────────────────────────────────────────

/** The plain-text marker inserted at the cursor when an image is pasted. */
export function buildMarker(id) {
  return `[${IMG_MARKER_PREFIX}${id}]`
}

/** Returns the attachment ID if the string is a well-formed marker, else null. */
export function parseMarker(text) {
  const m = text.match(/^\[img:\/\/([^\]]+)\]$/)
  return m ? m[1] : null
}

/** Returns all attachment IDs referenced inside a note's content string. */
export function extractMarkerIds(content) {
  const ids = []
  for (const m of (content ?? '').matchAll(/\[img:\/\/([^\]]+)\]/g)) {
    ids.push(m[1])
  }
  return ids
}

/** True if the token looks like an img marker — used by the search index. */
export function isImgMarker(token) {
  return typeof token === 'string' && token.startsWith(`[${IMG_MARKER_PREFIX}`)
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validates a clipboard File before processing.
 * Returns null on success, or a human-readable error string.
 */
export function validateImageFile(file) {
  if (!file || !SUPPORTED_MIME_TYPES.has(file.type)) {
    return `Unsupported image type. Supported: ${[...SUPPORTED_MIME_TYPES].join(', ')}`
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    return `Image too large (${mb} MB). Maximum is 5 MB.`
  }
  return null
}

// ── Processing ─────────────────────────────────────────────────────────────────

/**
 * Reads a File/Blob and returns a base64 data-URL string via FileReader.
 * Pure I/O — no DOM canvas needed for already-valid images.
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read image file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Resizes an image to fit within ATTACHMENT_MAX_DIMENSION on its longest side
 * and re-encodes as a JPEG (quality 0.88) to keep storage compact.
 * If the image already fits, returns the original dataURL unchanged.
 */
export function resizeImage(dataURL, mimeType) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      const max = ATTACHMENT_MAX_DIMENSION

      if (w <= max && h <= max) {
        resolve(dataURL)
        return
      }

      const scale  = Math.min(max / w, max / h)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.onerror = () => reject(new Error('Failed to decode image'))
    img.src = dataURL
  })
}

/**
 * Full pipeline: validate → read → resize.
 * Resolves to { dataURL, mimeType } or rejects with an Error whose .message
 * is safe to show in the UI.
 */
export async function processImageFile(file) {
  const validationError = validateImageFile(file)
  if (validationError) throw new Error(validationError)

  const rawDataURL = await readFileAsDataURL(file)

  // GIFs must not be re-encoded (animation would be lost)
  const dataURL = file.type === 'image/gif'
    ? rawDataURL
    : await resizeImage(rawDataURL, file.type)

  // Final size guard after resize/encode
  const byteEstimate = Math.round(dataURL.length * 0.75)
  if (byteEstimate > ATTACHMENT_MAX_BYTES) {
    const mb = (byteEstimate / (1024 * 1024)).toFixed(1)
    throw new Error(`Processed image is too large (${mb} MB). Maximum is 5 MB.`)
  }

  return { dataURL, mimeType: file.type === 'image/gif' ? 'image/gif' : 'image/jpeg' }
}
