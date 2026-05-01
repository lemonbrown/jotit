import TurndownService from 'turndown'
import { buildNibPrompt } from './nibPrompts.js'

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
    for (const tag of ['script', 'style', 'nav', 'footer', 'aside', 'head', 'img', 'picture', 'svg']) {
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

export function htmlToMarkdown(html, url = '') {
  const raw = String(html ?? '')
  if (!raw.trim()) return ''

  const turndown = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    headingStyle: 'atx',
  })

  turndown.remove(['script', 'style', 'nav', 'footer', 'aside', 'head', 'img', 'picture', 'svg'])

  const fallbackTitle = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim()
  const fallbackBody = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? raw

  try {
    const doc = typeof DOMParser !== 'undefined'
      ? new DOMParser().parseFromString(raw, 'text/html')
      : null
    const title = doc?.querySelector('title')?.textContent?.trim() || fallbackTitle
    const source = doc?.body ?? fallbackBody
    const markdown = turndown.turndown(source)
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
      .slice(0, MAX_PAGE_CHARS)

    return [
      title || url ? `# ${title || url}` : '',
      url ? `Source: ${url}` : '',
      markdown,
    ].filter(Boolean).join('\n\n')
  } catch {
    const markdown = turndown.turndown(fallbackBody)
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
      .slice(0, MAX_PAGE_CHARS)

    return [
      fallbackTitle || url ? `# ${fallbackTitle || url}` : '',
      url ? `Source: ${url}` : '',
      markdown,
    ].filter(Boolean).join('\n\n')
  }
}

export function buildUrlCommandsPrompt(pageText, url, promptOverrides = {}) {
  return buildNibPrompt(promptOverrides, 'url.commands', { pageText, url })
}

export function buildUrlRoutesPrompt(pageText, url, promptOverrides = {}) {
  return buildNibPrompt(promptOverrides, 'url.routes', { pageText, url })
}

export function buildUrlSummaryPrompt(pageText, url, promptOverrides = {}) {
  return buildNibPrompt(promptOverrides, 'url.summary', { pageText, url })
}

export function buildUrlStructurePrompt(pageText, url, { markdown = false, promptOverrides = {} } = {}) {
  return buildNibPrompt(promptOverrides, markdown ? 'url.markdown' : 'url.plain', { pageText, url })
}

export function buildUrlTersePrompt(pageText, url, hint = '', { markdown = false, promptOverrides = {} } = {}) {
  const h = String(hint ?? '').trim().toLowerCase()
  const formatInstructions = markdown
    ? 'Use minimal markdown only:\n- No summary, no page title, no explanations.\n- For commands, use one fenced code block per command.\n- For routes, use a compact table with Method and Path only.'
    : 'Use plain text only:\n- No markdown.\n- No summary, no page title, no explanations.\n- Put each result on its own line.'
  const promptId = (h === 'commands' || h === 'command')
    ? 'url.terseCommands'
    : (h === 'routes' || h === 'api' || h === 'endpoints')
      ? 'url.terseRoutes'
      : 'url.terseItems'

  return buildNibPrompt(promptOverrides, promptId, { pageText, url, formatInstructions })
}

export function buildUrlNibPrompt(pageText, url, { mode = 'structure', markdown = false, promptOverrides = {} } = {}) {
  if (mode === 'commands') return buildUrlCommandsPrompt(pageText, url, promptOverrides)
  if (mode === 'routes') return buildUrlRoutesPrompt(pageText, url, promptOverrides)
  if (mode === 'summary') return buildUrlSummaryPrompt(pageText, url, promptOverrides)
  return buildUrlStructurePrompt(pageText, url, { markdown, promptOverrides })
}
