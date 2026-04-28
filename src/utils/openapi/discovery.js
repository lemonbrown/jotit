const COMMON_OPENAPI_PATHS = [
  '/swagger/v1/swagger.json',
  '/openapi/v1.json',
  '/openapi.json',
  '/swagger.json',
  '/api-docs',
  '/v3/api-docs',
  '/scalar/v1',
  '/scalar',
]

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function hasProtocol(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}

function looksLikeSpecUrl(url) {
  const pathname = url.pathname.toLowerCase()
  return pathname.endsWith('.json') || pathname.includes('swagger') || pathname.includes('openapi') || pathname.includes('api-docs')
}

function toUrlCandidates(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return []
  return hasProtocol(raw) ? [raw] : [`https://${raw}`, `http://${raw}`]
}

export function buildOpenApiDiscoveryUrls(input) {
  const urls = []

  for (const candidate of toUrlCandidates(input)) {
    let parsed
    try {
      parsed = new URL(candidate)
    } catch {
      continue
    }

    if (looksLikeSpecUrl(parsed)) {
      urls.push(parsed.toString())
    }

    const origin = parsed.origin
    for (const path of COMMON_OPENAPI_PATHS) {
      urls.push(`${origin}${path}`)
    }
  }

  return unique(urls)
}

export function getOpenApiSpecFileName(specUrl, document = null) {
  let host = 'openapi'
  try {
    host = new URL(specUrl).host || host
  } catch {}

  const title = document?.normalized?.title
    ? String(document.normalized.title).trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
    : ''

  return `${title || host}-openapi.json`
}

export function extractOpenApiDiscoveryUrls(text, sourceUrl) {
  const body = String(text ?? '')
  const urls = []
  let base
  try {
    base = new URL(sourceUrl)
  } catch {
    return []
  }

  const patterns = [
    /["']([^"']*(?:openapi|swagger|api-docs)[^"']*\.json(?:\?[^"']*)?)["']/gi,
    /url\s*:\s*["']([^"']+)["']/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(body))) {
      const raw = String(match[1] ?? '').trim()
      if (!raw || raw.startsWith('data:') || raw.startsWith('#')) continue
      try {
        urls.push(new URL(raw, base).toString())
      } catch {}
    }
  }

  return unique(urls)
}
