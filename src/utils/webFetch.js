const AGENT_BASE = 'http://localhost:3210'
const MAX_PAGE_CHARS = 25_000

export async function fetchPageContent(url, { token } = {}) {
  if (!token?.trim()) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    } catch (err) {
      throw new Error(`Could not fetch URL directly. Start jotit-agent and add its token in Settings for CORS-blocked pages. ${err?.message ?? err}`)
    }
  }

  const agentRes = await fetch(`${AGENT_BASE}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.trim()}`,
    },
    body: JSON.stringify({
      url,
      method: 'GET',
      headers: { Accept: 'text/html,*/*;q=0.8' },
      timeoutMs: 12000,
    }),
  })

  const data = await agentRes.json().catch(() => ({}))
  if (!agentRes.ok && data.error) throw new Error(data.error)
  if (!agentRes.ok) throw new Error(`Agent request failed: HTTP ${agentRes.status}`)
  if (data.status < 200 || data.status >= 300) throw new Error(`HTTP ${data.status}`)
  if (data.isBinary) throw new Error('Page response was binary')
  return data.body ?? ''
}

export function stripHtmlToText(html) {
  const s = String(html ?? '')
  if (!s.trim()) return ''

  try {
    const doc = new DOMParser().parseFromString(s, 'text/html')
    for (const tag of ['script', 'style', 'nav', 'footer', 'aside', 'head']) {
      doc.querySelectorAll(tag).forEach(el => el.remove())
    }
    const text = (doc.body?.innerText ?? doc.body?.textContent ?? '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return text.slice(0, MAX_PAGE_CHARS)
  } catch {
    return s
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_PAGE_CHARS)
  }
}

export function buildUrlCommandsPrompt(pageText, url) {
  return [
    `Extract every shell command, CLI invocation, and runnable code example from this web page. Source: ${url}`,
    'Format as a markdown note:',
    '- Heading with the page title or URL',
    '- Each command in a fenced code block with the correct language tag (bash, shell, python, etc.)',
    '- A one-line description above each code block',
    'Only include commands a user would actually run. If none are found, say so.',
    '',
    '---',
    pageText,
  ].join('\n')
}

export function buildUrlRoutesPrompt(pageText, url) {
  return [
    `Extract every HTTP API route, endpoint, and URL pattern from this web page. Source: ${url}`,
    'Format as a markdown note:',
    '- Heading with the page title or URL',
    '- A markdown table: Method | Path | Description',
    '- If request/response body examples are shown, include them as code blocks below the table',
    'Only include actual API routes. If none are found, say so.',
    '',
    '---',
    pageText,
  ].join('\n')
}

export function buildUrlSummaryPrompt(pageText, url) {
  return [
    `Summarize this web page as a concise, structured markdown reference note. Source: ${url}`,
    'Include:',
    '- A clear heading (use the page title if available)',
    '- A brief overview (2-3 sentences)',
    '- CLI commands (if any) in fenced code blocks',
    '- API routes (if any) as a markdown table: Method | Path | Description',
    '- Key configuration options or important values (if any)',
    'Keep it focused - this is a reference note, not a transcript.',
    '',
    '---',
    pageText,
  ].join('\n')
}

export function buildUrlTersePrompt(pageText, url, hint = '', { markdown = false } = {}) {
  const h = String(hint ?? '').trim().toLowerCase()
  const format = markdown
    ? [
        'Use minimal markdown only:',
        '- No summary, no page title, no explanations.',
        '- For commands, use one fenced code block per command.',
        '- For routes, use a compact table with Method and Path only.',
      ]
    : [
        'Use plain text only:',
        '- No markdown.',
        '- No summary, no page title, no explanations.',
        '- Put each result on its own line.',
      ]

  const target = (h === 'commands' || h === 'command')
    ? [
        `Extract only runnable shell commands, CLI invocations, and code examples from this web page. Source: ${url}`,
        'Include standalone CLI lines even when they are not in code fences, such as `ollama`, `ollama launch codex`, `npm install`, or `docker compose up`.',
        'Include multi-line commands such as curl requests with JSON bodies.',
        'Return commands exactly as shown, without descriptions.',
        'Do not drop short commands just because a longer curl example is present.',
        'Do not include navigation text, prose, headings, or duplicate commands.',
        'If none are found, return: No commands found.',
      ]
    : (h === 'routes' || h === 'api' || h === 'endpoints')
      ? [
          `Extract only HTTP API routes, endpoints, and URL patterns from this web page. Source: ${url}`,
          'Return only actual routes or endpoint URLs, preferably as METHOD path when a method is shown.',
          'Do not include navigation text, prose, headings, or duplicate routes.',
          'If none are found, return: No routes found.',
        ]
      : [
          `Extract only concrete technical items from this web page. Source: ${url}`,
          'Prioritize runnable commands, HTTP API routes, endpoint URLs, config keys, and exact values.',
          'Do not summarize and do not include surrounding prose.',
          'If no concrete technical items are found, return: No items found.',
        ]

  return [
    ...target,
    ...format,
    '',
    '---',
    pageText,
  ].join('\n')
}

export function buildUrlNibPrompt(pageText, url, hint = '') {
  const h = String(hint ?? '').trim().toLowerCase()
  if (h === 'commands' || h === 'command') return buildUrlCommandsPrompt(pageText, url)
  if (h === 'routes' || h === 'api' || h === 'endpoints') return buildUrlRoutesPrompt(pageText, url)
  return buildUrlSummaryPrompt(pageText, url)
}
