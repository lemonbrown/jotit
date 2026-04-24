const ENTITY_PATTERNS = [
  ['url', /\bhttps?:\/\/[^\s)]+/gi],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['ip', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ['uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi],
  ['env_var', /\b[A-Z][A-Z0-9_]{2,}\b/g],
  ['file_path', /(?:[A-Z]:\\[^\s]+|\/[\w./-]+)+/g],
  ['api_key_like', /\b(?:ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{12,})\b/g],
  ['jwt_like', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g],
  ['port', /(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[\w.-]+):)(\d{2,5})\b/gi],
  ['docker_image', /\b[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+(?::[\w.-]+)?\b/g],
  ['http_method', /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g],
  ['status_code', /\b(?:401|403|404|409|422|429|500|502|503|504)\b/g],
  ['sql_identifier', /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE|GROUP BY|ORDER BY)\b/gi],
]

const PROVIDER_PATTERNS = [
  ['cloud_provider', /\b(?:azure|entra|aad|key vault|managed identity|service principal)\b/gi],
  ['cloud_provider', /\b(?:aws|iam|sts|s3|rds|cloudwatch|route53|secrets manager)\b/gi],
  ['cloud_provider', /\b(?:gcp|google cloud|gke|bigquery|cloud run|service account)\b/gi],
]

const COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|node|python|pip|docker|kubectl|terraform|git|gh|az|aws|gcloud|psql|redis-cli)\s+[^\n]+/gi,
]

function normalizeEntityValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function pushEntity(results, seen, entity) {
  const key = `${entity.entityType}:${entity.normalizedValue}:${entity.chunkId ?? ''}`
  if (!entity.normalizedValue || seen.has(key)) return
  seen.add(key)
  results.push(entity)
}

export function extractEntities(text, { noteId, chunkId = null } = {}) {
  // Strip image markers before extraction so base64 data URLs and IDs are
  // never indexed as entities, env vars, or API keys.
  const content = String(text ?? '').replace(/\[img:\/\/[^\]]+\]/g, '')
  if (!content.trim()) return []

  const results = []
  const seen = new Set()

  for (const [entityType, pattern] of ENTITY_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const rawValue = match[1] ?? match[0]
      pushEntity(results, seen, {
        id: `${noteId}:${chunkId ?? 'note'}:${entityType}:${results.length}`,
        noteId,
        chunkId,
        entityType,
        entityValue: rawValue,
        normalizedValue: normalizeEntityValue(rawValue),
      })
    }
  }

  for (const [entityType, pattern] of PROVIDER_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      pushEntity(results, seen, {
        id: `${noteId}:${chunkId ?? 'note'}:${entityType}:${results.length}`,
        noteId,
        chunkId,
        entityType,
        entityValue: match[0],
        normalizedValue: normalizeEntityValue(match[0]),
      })
    }
  }

  for (const pattern of COMMAND_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      pushEntity(results, seen, {
        id: `${noteId}:${chunkId ?? 'note'}:command:${results.length}`,
        noteId,
        chunkId,
        entityType: 'command',
        entityValue: match[0],
        normalizedValue: normalizeEntityValue(match[0]),
      })
    }
  }

  return results
}
