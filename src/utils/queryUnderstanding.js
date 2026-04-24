const PROVIDER_ALIASES = {
  azure: ['entra', 'aad', 'microsoft', 'key vault', 'service principal', 'managed identity', 'app registration'],
  entra: ['azure', 'aad', 'microsoft', 'service principal'],
  aad: ['azure', 'entra', 'microsoft'],
  aws: ['iam', 'sts', 's3', 'role arn', 'secrets manager', 'parameter store'],
  gcp: ['google cloud', 'service account', 'cloud run', 'gke', 'bigquery', 'project id'],
  postgres: ['postgresql', 'pg', 'database url', 'connection string', 'psql'],
  postgresql: ['postgres', 'pg', 'connection string', 'database url'],
  mysql: ['mariadb', 'connection string', 'database url', 'rds'],
  mongodb: ['mongo', 'atlas', 'connection string', 'document store'],
  redis: ['redis-cli', 'cache', 'tls'],
  docker: ['docker compose', 'container', 'image'],
  kubernetes: ['k8s', 'kubectl', 'helm', 'deployment', 'pod'],
  terraform: ['tf', 'apply', 'plan', 'state', 'workspace', 'tfvars'],
  gitlab: ['gl', 'ci', 'pipeline', 'runner', 'job token'],
  jwt: ['bearer', 'token', 'audience', 'issuer'],
  github: ['gh', 'workflow', 'actions', 'repo'],
  npm: ['package', 'publish', 'registry'],
  ci: ['github actions', 'workflow', 'pipeline', 'runner'],
}

const TERM_EXPANSIONS = {
  token: ['api key', 'secret', 'bearer', 'access token', 'client secret', 'credential'],
  key: ['api key', 'secret', 'credential'],
  password: ['secret', 'credential', 'database url'],
  secret: ['api key', 'credential', 'token', 'vault', 'client secret'],
  vault: ['key vault', 'secrets manager', 'parameter store', 'hashicorp'],
  api: ['endpoint', 'rest', 'authorization', 'oauth', 'oidc'],
  auth: ['authorization', 'oauth', 'oidc', 'bearer', 'jwt'],
  env: ['environment', 'config', 'settings', 'base url'],
  config: ['environment', 'settings', 'env'],
  connection: ['connection string', 'database url', 'host', 'port', 'connect'],
  staging: ['stage', 'preprod', 'test'],
  prod: ['production', 'live'],
  host: ['hostname', 'endpoint', 'base url'],
  role: ['iam', 'sts', 'assume role', 'role arn'],
  write: ['putobject', 'upload'],
  deploy: ['deployment', 'kubectl', 'helm', 'docker compose', 'rollout'],
  cluster: ['kubernetes', 'k8s', 'eks', 'aks', 'gke'],
  login: ['auth', 'credential', 'bearer', 'token', 'oauth'],
  rotate: ['rotation', 'renew', 'refresh', 'expire'],
  middleware: ['auth', 'jwt', 'authorization'],
  bug: ['debug', 'error', 'incident'],
  publish: ['package', 'registry', 'workflow', 'actions'],
  restart: ['rollout restart', 'deployment', 'kubectl'],
  commands: ['command', 'cli', 'script'],
  unauthorized: ['401', 'forbidden', 'invalid audience'],
  debug: ['error', 'incident', 'trace', 'unauthorized'],
  refused: ['timeout', 'firewall', 'blocked', '503'],
  crash: ['error', 'exception', 'stacktrace', 'panic'],
}

const FACET_RULES = [
  {
    facet: 'credentials',
    pattern: /\b(token|secret|password|credential|client secret|api key|bearer|jwt|ssh key)\b/i,
    entityTypes: ['api_key_like', 'jwt_like', 'env_var'],
  },
  {
    facet: 'cloud',
    pattern: /\b(azure|entra|aad|aws|iam|sts|gcp|google cloud|service account|key vault|s3)\b/i,
    entityTypes: ['cloud_provider'],
  },
  {
    facet: 'database',
    pattern: /\b(postgres|postgresql|mysql|mssql|redis|mongodb|database|connection string)\b/i,
    entityTypes: ['env_var', 'port'],
  },
  {
    facet: 'infra',
    pattern: /\b(docker|docker compose|kubernetes|k8s|kubectl|helm|terraform|deployment|pod)\b/i,
    entityTypes: ['command'],
  },
  {
    facet: 'api',
    pattern: /\b(api|endpoint|rest|graphql|webhook|oauth|oidc|authorization|bearer)\b/i,
    entityTypes: ['url', 'http_method', 'status_code'],
  },
  {
    facet: 'debugging',
    pattern: /\b(error|exception|stacktrace|traceback|timeout|debug|incident|repro|bug|unauthorized|forbidden|invalid audience|401|403|500)\b/i,
    entityTypes: ['status_code'],
  },
]

const INTENT_RULES = [
  { intent: 'find-credentials', pattern: /\b(token|secret|password|credential|api key|client secret|pat)\b/i },
  { intent: 'find-config', pattern: /\b(env|config|settings|host|port|base url|database url|connection string)\b/i },
  { intent: 'find-command', pattern: /\b(command|cli|script|docker|kubectl|terraform|npm|curl|psql)\b/i },
  { intent: 'debug-issue', pattern: /\b(error|debug|bug|incident|timeout|unauthorized|forbidden|401|403|500)\b/i },
  { intent: 'ci-workflow', pattern: /\b(github actions|workflow|pipeline|runner|publish|registry|npm)\b/i },
]

function tokenizeQuery(query) {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

function collectExpandedTerms(tokens) {
  const expanded = new Set(tokens)

  for (const token of tokens) {
    for (const alias of PROVIDER_ALIASES[token] ?? []) expanded.add(alias)
    for (const alias of TERM_EXPANSIONS[token] ?? []) expanded.add(alias)
  }

  return Array.from(expanded)
}

function detectProviderHints(tokens) {
  return tokens.filter(token => PROVIDER_ALIASES[token])
}

function detectFacets(normalizedQuery) {
  return FACET_RULES
    .filter(rule => rule.pattern.test(normalizedQuery))
    .map(rule => rule.facet)
}

function detectEntityTypeBoosts(normalizedQuery, facets) {
  const boosted = new Set()

  for (const rule of FACET_RULES) {
    if (rule.pattern.test(normalizedQuery) || facets.includes(rule.facet)) {
      for (const entityType of rule.entityTypes) boosted.add(entityType)
    }
  }

  return Array.from(boosted)
}

function detectIntent(normalizedQuery) {
  return INTENT_RULES.find(rule => rule.pattern.test(normalizedQuery))?.intent ?? 'general-search'
}

export function understandQuery(query) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return {
      normalizedQuery: '',
      coreTerms: [],
      tokens: [],
      expandedTerms: [],
      intent: 'general-search',
      facets: [],
      entityTypesToBoost: [],
      providerHints: [],
    }
  }

  const tokens = tokenizeQuery(query)
  const expandedTerms = collectExpandedTerms(tokens)
  const providerHints = detectProviderHints(tokens)
  const facets = detectFacets(normalizedQuery)
  const entityTypesToBoost = detectEntityTypeBoosts(normalizedQuery, facets)
  const intent = detectIntent(normalizedQuery)

  return {
    normalizedQuery,
    coreTerms: tokens,
    tokens,
    expandedTerms: [normalizedQuery, ...expandedTerms.filter(term => term !== normalizedQuery)],
    intent,
    facets,
    entityTypesToBoost,
    providerHints,
  }
}
