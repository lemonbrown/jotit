const PATTERNS = [
  {
    type: 'pem_private_key',
    label: 'PEM Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    severity: 'high',
  },
  {
    type: 'aws_access_key',
    label: 'AWS Access Key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: 'high',
  },
  {
    type: 'aws_secret_key',
    label: 'AWS Secret Key',
    pattern: /aws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*\S{20,}/gi,
    severity: 'high',
  },
  {
    type: 'github_token',
    label: 'GitHub Token',
    pattern: /\b(?:ghp|ghs|gho|ghu|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
    severity: 'high',
  },
  {
    type: 'google_api_key',
    label: 'Google API Key',
    pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    severity: 'high',
  },
  {
    type: 'stripe_live_key',
    label: 'Stripe Live Key',
    pattern: /\b(?:sk|pk)_live_[0-9A-Za-z]{20,}\b/g,
    severity: 'high',
  },
  {
    type: 'slack_token',
    label: 'Slack Token',
    pattern: /\bxox[baprs]-[0-9A-Za-z\-]{10,}\b/g,
    severity: 'high',
  },
  {
    type: 'db_connection_string',
    label: 'DB Connection String',
    pattern: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:@\s]+:[^@\s]+@[^\s"']{4,}/gi,
    severity: 'high',
  },
  {
    type: 'bearer_token',
    label: 'Bearer Token',
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}={0,2}\b/g,
    severity: 'medium',
  },
  {
    type: 'generic_secret',
    label: 'Secret Assignment',
    // Matches: secret=, password=, api_key=, token=, etc. followed by a non-trivial value
    pattern: /(?:^|[ \t])(?:secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?token)\s*[=:]\s*(?!['"]?\s*(?:your[_-]?|<|{|\[|example|placeholder|todo|xxx|null|undefined|true|false|\d{1,6}\s*$))['"]?(\S{8,})/gim,
    severity: 'medium',
  },
]

function redact(str) {
  if (str.length <= 8) return '***'
  return str.slice(0, 4) + '***' + str.slice(-2)
}

export function scanForSecrets(content) {
  if (!content) return []
  const matches = []
  const seen = new Set()

  for (const { type, label, pattern, severity } of PATTERNS) {
    pattern.lastIndex = 0
    let m
    while ((m = pattern.exec(content)) !== null) {
      const key = `${type}:${m[0]}`
      if (seen.has(key)) continue
      seen.add(key)
      matches.push({ type, label, severity, redacted: redact(m[0]), index: m.index })
    }
  }

  return matches
}

export function contentHash(str) {
  let h = 0
  for (let i = 0; i < (str ?? '').length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return String(h >>> 0)
}
