function decodePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

function resolvePointer(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`Unsupported $ref: ${ref}`)
  }

  return ref
    .slice(2)
    .split('/')
    .map(decodePointerToken)
    .reduce((current, token) => {
      if (current == null || typeof current !== 'object' || !(token in current)) {
        throw new Error(`Unresolved $ref: ${ref}`)
      }
      return current[token]
    }, root)
}

function dereference(value, root, seen = new Set()) {
  if (!value || typeof value !== 'object') return value

  if (typeof value.$ref === 'string') {
    if (seen.has(value.$ref)) throw new Error(`Circular $ref: ${value.$ref}`)
    const nextSeen = new Set(seen)
    nextSeen.add(value.$ref)
    return dereference(resolvePointer(root, value.$ref), root, nextSeen)
  }

  if (Array.isArray(value)) return value.map(entry => dereference(entry, root, seen))

  const output = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = dereference(entry, root, seen)
  }
  return output
}

function normalizeParameters(operation, pathItem, root) {
  const combined = [...(pathItem?.parameters ?? []), ...(operation?.parameters ?? [])]
  const seen = new Set()

  return combined
    .map(param => dereference(param, root))
    .filter(param => {
      const key = `${param.in}:${param.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(param => ({
      name: String(param.name ?? ''),
      in: String(param.in ?? 'query'),
      required: Boolean(param.required),
      description: param.description ?? '',
      schema: param.schema ?? null,
      example: param.example ?? param.schema?.example ?? null,
    }))
}

function normalizeRequestBody(requestBody, root) {
  if (!requestBody) return null
  const body = dereference(requestBody, root)
  const contentEntries = Object.entries(body.content ?? {})
  if (!contentEntries.length) return null

  const [contentType, media] = contentEntries[0]
  return {
    required: Boolean(body.required),
    description: body.description ?? '',
    contentType,
    schema: media?.schema ? dereference(media.schema, root) : null,
    example: media?.example ?? media?.schema?.example ?? null,
  }
}

function normalizeResponses(responses, root) {
  const normalized = {}

  for (const [statusCode, response] of Object.entries(responses ?? {})) {
    const resolved = dereference(response, root)
    const contentEntries = Object.entries(resolved.content ?? {})
    const [contentType, media] = contentEntries[0] ?? []
    normalized[statusCode] = {
      description: resolved.description ?? '',
      contentType: contentType ?? null,
      schema: media?.schema ? dereference(media.schema, root) : null,
    }
  }

  return normalized
}

function normalizeSecuritySchemes(root) {
  const entries = Object.entries(root.components?.securitySchemes ?? {})
  return Object.fromEntries(entries.map(([name, scheme]) => {
    const resolved = dereference(scheme, root)
    return [name, {
      type: resolved.type ?? 'unknown',
      scheme: resolved.scheme ?? null,
      in: resolved.in ?? null,
      name: resolved.name ?? null,
    }]
  }))
}

function normalizeSecurity(operation, root) {
  const security = operation.security ?? root.security ?? []
  return security.flatMap(entry => Object.keys(entry))
}

export function normalizeOpenApiDocument(root) {
  if (!root || typeof root !== 'object') throw new Error('OpenAPI document must be an object')
  if (!String(root.openapi ?? '').startsWith('3.')) {
    throw new Error('Only OpenAPI 3.x JSON documents are supported')
  }

  const operations = []
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

  for (const [path, pathItem] of Object.entries(root.paths ?? {})) {
    for (const method of methods) {
      if (!pathItem?.[method]) continue
      const operation = dereference(pathItem[method], root)
      operations.push({
        id: operation.operationId ?? `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? '',
        description: operation.description ?? '',
        tags: operation.tags ?? [],
        parameters: normalizeParameters(operation, pathItem, root),
        requestBody: normalizeRequestBody(operation.requestBody, root),
        responses: normalizeResponses(operation.responses, root),
        security: normalizeSecurity(operation, root),
      })
    }
  }

  const tags = [
    ...new Set([
      ...(root.tags ?? []).map(tag => tag.name).filter(Boolean),
      ...operations.flatMap(operation => operation.tags ?? []),
    ]),
  ]

  return {
    openapi: root.openapi,
    title: root.info?.title ?? 'OpenAPI Document',
    version: root.info?.version ?? '',
    description: root.info?.description ?? '',
    servers: (root.servers ?? []).map(server => server.url).filter(Boolean),
    tags,
    securitySchemes: normalizeSecuritySchemes(root),
    operations: operations.sort((a, b) => {
      const tagA = a.tags?.[0] ?? ''
      const tagB = b.tags?.[0] ?? ''
      return tagA.localeCompare(tagB) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
    }),
  }
}
