function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, value: null }
  }
}

function validateValue(schema, value, path, issues) {
  if (!schema || typeof schema !== 'object') return

  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const required = schema.required ?? []
    for (const key of required) {
      if (!(key in value)) issues.push(`Missing required field ${path}.${key}`)
    }

    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (!(key in value)) continue
      validateValue(childSchema, value[key], `${path}.${key}`, issues)
    }
    return
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      issues.push(`Expected ${path} to be an array`)
      return
    }
    if (value.length) validateValue(schema.items ?? {}, value[0], `${path}[0]`, issues)
    return
  }

  if (!schema.type) return

  const actualType =
    Array.isArray(value) ? 'array'
      : value === null ? 'null'
        : typeof value

  const typeMap = { integer: 'number', number: 'number', string: 'string', boolean: 'boolean' }
  const expectedType = typeMap[schema.type] ?? schema.type
  if (actualType !== expectedType) {
    issues.push(`Expected ${path} to be ${schema.type}, got ${actualType}`)
  }
}

export function validateResponseAgainstOperation(operation, response) {
  const statusKey = String(response?.status ?? '')
  const responseSpec = operation?.responses?.[statusKey] ?? operation?.responses?.default ?? null
  if (!responseSpec?.schema) {
    return { ok: true, issues: [], matchedStatus: statusKey || null }
  }

  if (!(response?.contentType ?? '').includes('json')) {
    return { ok: false, issues: ['Response validation currently supports JSON responses only'], matchedStatus: statusKey || null }
  }

  const parsed = safeJsonParse(response.body ?? '')
  if (!parsed.ok) {
    return { ok: false, issues: ['Response body is not valid JSON'], matchedStatus: statusKey || null }
  }

  const issues = []
  validateValue(responseSpec.schema, parsed.value, '$', issues)
  return {
    ok: issues.length === 0,
    issues,
    matchedStatus: statusKey || null,
  }
}
