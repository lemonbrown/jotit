import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import ini from 'highlight.js/lib/languages/ini'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('json', json)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('ini', ini)
hljs.registerAliases?.(['js', 'mjs', 'cjs', 'node'], { languageName: 'javascript' })
hljs.registerAliases?.(['ts', 'mts', 'cts'], { languageName: 'typescript' })
hljs.registerAliases?.(['sh', 'zsh', 'shell'], { languageName: 'bash' })
hljs.registerAliases?.(['yml'], { languageName: 'yaml' })
hljs.registerAliases?.(['html', 'svg'], { languageName: 'xml' })

export const HINT_LANGS = ['json', 'javascript', 'typescript', 'python', 'sql', 'bash', 'yaml', 'xml', 'css', 'dockerfile', 'ini']

export { hljs }

export function normalizeCodeLanguage(lang) {
  const normalized = String(lang ?? '').trim().toLowerCase()
  if (!normalized) return ''

  if (['js', 'mjs', 'cjs', 'node'].includes(normalized)) return 'javascript'
  if (['ts', 'mts', 'cts'].includes(normalized)) return 'typescript'
  if (['sh', 'zsh', 'shell'].includes(normalized)) return 'bash'
  if (normalized === 'yml') return 'yaml'
  if (['html', 'svg'].includes(normalized)) return 'xml'
  return normalized
}

function scoreJavaScriptLike(text) {
  const sample = String(text ?? '')
  if (!sample.trim()) return 0

  let score = 0
  if (/\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/.test(sample)) score += 3
  if (/\b(function|return|import|export|from|async|await|new)\b/.test(sample)) score += 3
  if (/=>/.test(sample)) score += 3
  if (/\b(console\.(log|error|warn|info|debug))\s*\(/.test(sample)) score += 4
  if (/\b(document|window|Array|Object|Promise|Map|Set|JSON)\b/.test(sample)) score += 2
  if (/[`$][{(]/.test(sample) || /`[^`]*\$\{/.test(sample)) score += 2
  if (/[A-Za-z_$][\w$]*\s*\(\s*\)\s*{/.test(sample)) score += 2
  if (/<[A-Z][A-Za-z0-9]*(\s|>)/.test(sample) || /<\/[A-Z][A-Za-z0-9]*>/.test(sample)) score += 2
  return score
}

export function detectPreferredCodeLanguage(text) {
  const sample = String(text ?? '')
  const jsScore = scoreJavaScriptLike(sample)

  try {
    const auto = hljs.highlightAuto(sample, HINT_LANGS)
    const autoLanguage = normalizeCodeLanguage(auto.language)

    if (jsScore >= 6 && (!autoLanguage || ['ini', 'yaml', 'bash', 'sql'].includes(autoLanguage))) {
      return 'javascript'
    }

    if (jsScore >= 8 && autoLanguage && !['javascript', 'typescript', 'json', 'css', 'xml'].includes(autoLanguage)) {
      return 'javascript'
    }

    return autoLanguage
  } catch {
    return jsScore >= 6 ? 'javascript' : ''
  }
}

export function shouldAutoIndentForLanguage(language) {
  return ['javascript', 'typescript', 'json', 'css'].includes(language)
}
