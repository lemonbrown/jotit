export const TRANSFORMS = [
  { id: 'base64e',  label: 'Base64 ↑',   title: 'Base64 Encode' },
  { id: 'base64d',  label: 'Base64 ↓',   title: 'Base64 Decode' },
  { id: 'urld',     label: 'URL ↓',       title: 'URL Decode' },
  { id: 'jwt',      label: 'JWT ↓',       title: 'JWT Decode (header + payload)' },
  { id: 'json',     label: 'JSON {}',     title: 'Prettify JSON' },
  { id: 'hex2asc',  label: 'Hex→ASCII',   title: 'Hex to ASCII' },
  { id: 'asc2hex',  label: 'ASCII→Hex',   title: 'ASCII to Hex' },
  { id: 'htmld',    label: 'HTML ↓',      title: 'HTML Entity Decode' },
  { id: 'unicode',  label: 'Unicode ↓',   title: 'Unicode Escape Decode (\\uXXXX, \\u{X}, &#x;)' },
]

export function applyTransform(id, input) {
  switch (id) {
    case 'base64e': {
      try { return btoa(input) }
      catch { throw new Error('Cannot encode — contains non-Latin1 characters (try UTF-8 first)') }
    }

    case 'base64d': {
      try {
        const decoded = atob(input.trim())
        try { return JSON.stringify(JSON.parse(decoded), null, 2) } catch { return decoded }
      } catch {
        throw new Error('Invalid Base64')
      }
    }

    case 'urld': {
      try {
        return decodeURIComponent(input.trim())
      } catch {
        // eslint-disable-next-line no-undef
        try { return unescape(input.trim()) } catch { throw new Error('Invalid URL encoding') }
      }
    }

    case 'jwt': {
      const parts = input.trim().split('.')
      if (parts.length < 2 || parts.length > 3) throw new Error('Not a valid JWT (expected header.payload.signature)')
      const decodeB64url = (str) => {
        const padded = str + '='.repeat((4 - str.length % 4) % 4)
        const bytes = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
        try { return JSON.stringify(JSON.parse(bytes), null, 2) } catch { return bytes }
      }
      const header  = decodeB64url(parts[0])
      const payload = decodeB64url(parts[1])
      const sig     = parts[2] ?? '(none)'
      return `── HEADER ──\n${header}\n\n── PAYLOAD ──\n${payload}\n\n── SIGNATURE ──\n${sig}`
    }

    case 'json': {
      try { return JSON.stringify(JSON.parse(input.trim()), null, 2) }
      catch { throw new Error('Invalid JSON') }
    }

    case 'hex2asc': {
      const raw = input.trim()
      // Space-separated bytes: "48 65 6c 6c 6f"
      const spaced = raw.split(/\s+/)
      if (spaced.length > 1 && spaced.every(h => /^[0-9a-fA-F]{1,2}$/.test(h))) {
        return spaced.map(h => String.fromCharCode(parseInt(h, 16))).join('')
      }
      // Continuous hex: "48656c6c6f" or "0x48656c6c6f"
      const cont = raw.replace(/^0x/i, '').replace(/\s/g, '')
      if (/^[0-9a-fA-F]+$/.test(cont) && cont.length % 2 === 0) {
        const chars = []
        for (let i = 0; i < cont.length; i += 2)
          chars.push(String.fromCharCode(parseInt(cont.slice(i, i + 2), 16)))
        return chars.join('')
      }
      throw new Error('Invalid hex — use "48 65 6c" or "48656c"')
    }

    case 'asc2hex': {
      return Array.from(input)
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(' ')
    }

    case 'htmld': {
      const doc = new DOMParser().parseFromString(input, 'text/html')
      return doc.documentElement.textContent ?? input
    }

    case 'unicode': {
      return input
        .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, cp) => String.fromCodePoint(parseInt(cp, 16)))
        .replace(/\\u([0-9a-fA-F]{4})/g,    (_, c)  => String.fromCharCode(parseInt(c, 16)))
        .replace(/\\U([0-9a-fA-F]{8})/g,    (_, cp) => String.fromCodePoint(parseInt(cp, 16)))
        .replace(/&#x([0-9a-fA-F]+);/g,     (_, cp) => String.fromCodePoint(parseInt(cp, 16)))
        .replace(/&#([0-9]+);/g,            (_, n)  => String.fromCodePoint(parseInt(n, 10)))
    }

    default:
      throw new Error(`Unknown transform: ${id}`)
  }
}
