function inferScalarExample(schema) {
  if (!schema || typeof schema !== 'object') return ''
  if (schema.example != null) return schema.example
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]

  switch (schema.type) {
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'array':
      return [inferScalarExample(schema.items ?? {})]
    case 'object':
      return buildSchemaExample(schema)
    default:
      if (schema.format === 'date-time') return new Date().toISOString()
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000'
      return ''
  }
}

export function buildSchemaExample(schema) {
  if (!schema || typeof schema !== 'object') return {}
  if (schema.example != null) return schema.example

  if (schema.type === 'array') {
    return [inferScalarExample(schema.items ?? {})]
  }

  if (schema.type !== 'object' && !schema.properties) {
    return inferScalarExample(schema)
  }

  const output = {}
  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    output[key] = inferScalarExample(propertySchema)
  }
  return output
}

function fillPath(path, pathParams) {
  let resolved = path
  for (const param of pathParams) {
    const example = param.example ?? inferScalarExample(param.schema ?? {})
    resolved = resolved.replaceAll(`{${param.name}}`, encodeURIComponent(String(example || param.name)))
  }
  return resolved
}

function joinServerUrlAndPath(serverUrl, path) {
  const base = String(serverUrl ?? '').trim()
  const normalizedPath = String(path ?? '').startsWith('/') ? String(path) : `/${String(path ?? '')}`
  if (!base) return normalizedPath
  return `${base.replace(/\/+$/, '')}${normalizedPath}`
}

export function generateRequestFromOperation(operation, options = {}) {
  const serverUrl = options.serverUrl ?? ''
  const pathParams = (operation.parameters ?? []).filter(param => param.in === 'path')
  const queryParams = (operation.parameters ?? []).filter(param => param.in === 'query')
  const headerParams = (operation.parameters ?? []).filter(param => param.in === 'header')

  const query = new URLSearchParams()
  for (const param of queryParams) {
    const value = param.example ?? inferScalarExample(param.schema ?? {})
    if (value === '' || value == null) continue
    query.set(param.name, String(value))
  }

  const headers = {}
  for (const param of headerParams) {
    const value = param.example ?? inferScalarExample(param.schema ?? {})
    if (value === '' || value == null) continue
    headers[param.name] = String(value)
  }

  let body = null
  if (operation.requestBody?.contentType?.includes('json')) {
    headers['Content-Type'] = operation.requestBody.contentType
    body = JSON.stringify(
      operation.requestBody.example ?? buildSchemaExample(operation.requestBody.schema ?? {}),
      null,
      2
    )
  }

  const path = fillPath(operation.path, pathParams)
  const queryString = query.toString()

  return {
    method: operation.method,
    url: `${joinServerUrlAndPath(serverUrl, path)}${queryString ? `?${queryString}` : ''}`,
    headers,
    body,
  }
}

export function formatRequestAsHttpBlock(request) {
  const headerLines = Object.entries(request.headers ?? {}).map(([key, value]) => `${key}: ${value}`)
  const parts = [
    `${request.method} ${request.url}`,
    ...headerLines,
  ]

  if (request.body) {
    parts.push('', request.body)
  }

  return parts.join('\n').trimEnd()
}
