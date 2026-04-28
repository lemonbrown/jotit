import { useState, useMemo, Fragment, useRef, useCallback } from 'react'
import { streamLLMChat } from '../utils/llmClient'

function esc(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

const TOKEN_COLORS = {
  anchor:      'text-rose-400',
  charclass:   'text-emerald-400',
  quantifier:  'text-amber-300',
  group:       'text-sky-400',
  alternation: 'text-violet-400',
  escape:      'text-orange-300',
  literal:     'text-zinc-300',
}

function tokenizeRegex(pattern) {
  const tokens = []
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]

    if (ch === '\\') {
      const next = pattern[i + 1] ?? ''
      const raw  = next ? ch + next : ch
      const type = 'dDwWsS'.includes(next) ? 'charclass'
                 : 'bB'.includes(next)      ? 'anchor'
                 : 'escape'
      tokens.push({ type, raw })
      i += next ? 2 : 1

    } else if (ch === '[') {
      let raw = '['
      i++
      if (pattern[i] === '^') { raw += '^'; i++ }
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') { raw += '\\' + (pattern[i + 1] ?? ''); i += 2 }
        else raw += pattern[i++]
      }
      if (pattern[i] === ']') { raw += ']'; i++ }
      tokens.push({ type: 'charclass', raw })

    } else if (ch === '(') {
      if (pattern.startsWith('(?<=', i))      { tokens.push({ type: 'group', raw: '(?<=', subtype: 'lookbehind' }); i += 4 }
      else if (pattern.startsWith('(?<!', i)) { tokens.push({ type: 'group', raw: '(?<!', subtype: 'neg-lookbehind' }); i += 4 }
      else if (pattern.startsWith('(?:', i))  { tokens.push({ type: 'group', raw: '(?:',  subtype: 'non-capture' }); i += 3 }
      else if (pattern.startsWith('(?=', i))  { tokens.push({ type: 'group', raw: '(?=',  subtype: 'lookahead' }); i += 3 }
      else if (pattern.startsWith('(?!', i))  { tokens.push({ type: 'group', raw: '(?!',  subtype: 'neg-lookahead' }); i += 3 }
      else if (pattern.startsWith('(?<', i))  {
        const m = pattern.slice(i).match(/^\(\?<([^>]+)>/)
        if (m) { tokens.push({ type: 'group', raw: m[0], subtype: 'named', name: m[1] }); i += m[0].length }
        else   { tokens.push({ type: 'group', raw: '(' }); i++ }
      } else { tokens.push({ type: 'group', raw: '(' }); i++ }

    } else if (ch === ')') { tokens.push({ type: 'group', raw: ')' }); i++
    } else if (ch === '^') { tokens.push({ type: 'anchor', raw: '^' }); i++
    } else if (ch === '$') { tokens.push({ type: 'anchor', raw: '$' }); i++
    } else if (ch === '.') { tokens.push({ type: 'charclass', raw: '.' }); i++

    } else if ('*+?'.includes(ch)) {
      let raw = ch; i++
      if (pattern[i] === '?') { raw += '?'; i++ }
      tokens.push({ type: 'quantifier', raw })

    } else if (ch === '{') {
      const m = pattern.slice(i).match(/^\{\d+(?:,\d*)?\}/)
      if (m) {
        let raw = m[0]; i += raw.length
        if (pattern[i] === '?') { raw += '?'; i++ }
        tokens.push({ type: 'quantifier', raw })
      } else { tokens.push({ type: 'literal', raw: ch }); i++ }

    } else if (ch === '|') { tokens.push({ type: 'alternation', raw: '|' }); i++
    } else { tokens.push({ type: 'literal', raw: ch }); i++ }
  }
  return tokens
}

// ── Explanation ──────────────────────────────────────────────────────────────

function explainQuantifier(raw) {
  const lazy = raw.length > 1 && raw.endsWith('?')
  const base = lazy ? raw.slice(0, -1) : raw
  const sfx  = lazy ? ' (lazy)' : ''
  if (base === '*') return `0 or more${sfx}`
  if (base === '+') return `1 or more${sfx}`
  if (base === '?') return `optional${sfx}`
  const m = base.match(/^\{(\d+)(?:,(\d*))?\}$/)
  if (!m) return raw
  if (m[2] === undefined) return `exactly ${m[1]}${sfx}`
  if (m[2] === '')        return `${m[1]} or more${sfx}`
  return `${m[1]}–${m[2]}${sfx}`
}

function explainToken(tok) {
  const q = tok.quantifier ? ', ' + explainQuantifier(tok.quantifier.raw) : ''
  switch (tok.type) {
    case 'anchor':
      if (tok.raw === '^')    return 'start of string/line'
      if (tok.raw === '$')    return 'end of string/line'
      if (tok.raw === '\\b')  return 'word boundary'
      if (tok.raw === '\\B')  return 'non-word boundary'
      return tok.raw
    case 'charclass':
      if (tok.raw === '.')    return `any character (except newline)${q}`
      if (tok.raw === '\\d')  return `digit [0–9]${q}`
      if (tok.raw === '\\D')  return `non-digit${q}`
      if (tok.raw === '\\w')  return `word char [a-zA-Z0-9_]${q}`
      if (tok.raw === '\\W')  return `non-word char${q}`
      if (tok.raw === '\\s')  return `whitespace${q}`
      if (tok.raw === '\\S')  return `non-whitespace${q}`
      if (tok.raw.startsWith('[')) {
        const neg   = tok.raw[1] === '^'
        const inner = tok.raw.slice(neg ? 2 : 1, -1)
        return `${neg ? 'not ' : ''}one of [${inner}]${q}`
      }
      return tok.raw + q
    case 'quantifier':
      return explainQuantifier(tok.raw)
    case 'group':
      if (tok.raw === '(')    return 'capture group start'
      if (tok.raw === ')')    return 'group end'
      if (tok.raw === '(?:')  return 'non-capturing group'
      if (tok.raw === '(?=')  return 'lookahead (if followed by…)'
      if (tok.raw === '(?!')  return 'negative lookahead (if NOT followed by…)'
      if (tok.raw === '(?<=') return 'lookbehind (if preceded by…)'
      if (tok.raw === '(?<!') return 'negative lookbehind (if NOT preceded by…)'
      if (tok.subtype === 'named') return `named capture group "${tok.name}"`
      return tok.raw
    case 'alternation':
      return 'or'
    case 'escape':
      if (tok.raw === '\\n')  return `newline${q}`
      if (tok.raw === '\\t')  return `tab${q}`
      if (tok.raw === '\\r')  return `carriage return${q}`
      if (tok.raw === '\\\\') return `literal backslash${q}`
      if (/^\\[1-9]$/.test(tok.raw)) return `back-reference to group ${tok.raw[1]}`
      return `literal "${tok.raw[1]}"${q}`
    case 'literal': {
      const names = { ' ': 'space', '\t': 'tab', '\n': 'newline' }
      return (names[tok.raw] ?? `literal "${tok.raw}"`) + q
    }
    default:
      return tok.raw
  }
}

// Absorb each quantifier into the preceding token so the explanation table
// shows one row per logical unit instead of two.
function mergeQuantifiers(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    const tok  = tokens[i]
    const next = tokens[i + 1]
    if (next?.type === 'quantifier' && tok.raw !== ')') {
      out.push({ ...tok, raw: tok.raw + next.raw, quantifier: next })
      i++
    } else {
      out.push(tok)
    }
  }
  return out
}

// ── Component ────────────────────────────────────────────────────────────────

function extractRegexFromResponse(text) {
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^\/(.+)\/([gimsuy]*)$/)
    if (m?.[1]) return { pattern: m[1], flags: m[2] || 'g' }
  }
  const m2 = text.match(/`\/(.+?)\/([gimsuy]*)`/)
  if (m2?.[1]) return { pattern: m2[1], flags: m2[2] || 'g' }
  return null
}

function validateRegexSuggestion(suggestion) {
  if (!suggestion?.pattern) return 'Nib did not return a regex in /pattern/flags format.'
  try {
    new RegExp(suggestion.pattern, suggestion.flags || 'g')
    return ''
  } catch (error) {
    return error.message || 'Invalid regex suggestion.'
  }
}

function parseRegexLiteralInput(value) {
  const input = value.trim()
  if (!input.startsWith('/')) return null

  let escaped = false
  let inCharClass = false
  for (let i = 1; i < input.length; i++) {
    const ch = input[i]
    if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '[') {
      inCharClass = true
    } else if (ch === ']') {
      inCharClass = false
    } else if (ch === '/' && !inCharClass) {
      const parsedFlags = input.slice(i + 1)
      if (/^[dgimsuy]*$/.test(parsedFlags)) {
        return { pattern: input.slice(1, i), flags: parsedFlags || 'g' }
      }
    }
  }
  return null
}

function withRequiredFlags(baseFlags) {
  const out = new Set(baseFlags.split(''))
  out.add('g')
  try {
    new RegExp('', 'd')
    out.add('d')
  } catch {}
  return [...out].join('')
}

function getHighlightRanges(match) {
  const groupRanges = match.indices
    ?.slice(1)
    .filter(range => range && range[0] !== -1 && range[1] > range[0])
    .map(([start, end]) => ({ start, end }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  if (groupRanges?.length) return groupRanges
  return [{ start: match.index, end: match.index + match[0].length }]
}

export default function RegexTester({ initialTestString = '', llmEnabled = false, agentToken = '', ollamaModel = '' }) {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags]     = useState('g')
  const [testStr, setTestStr] = useState(initialTestString)
  const [nibMode, setNibMode] = useState(false)
  const [nibRequest, setNibRequest] = useState('')
  const [nibStreaming, setNibStreaming] = useState(false)
  const [nibSuggestion, setNibSuggestion] = useState(null) // { pattern, flags } | null
  const [nibError, setNibError] = useState('')
  const nibInputRef = useRef(null)
  const nibResponseRef = useRef('')

  const toggleFlag = (f) =>
    setFlags(prev => prev.includes(f) ? prev.replace(f, '') : prev + f)

  const updatePatternInput = useCallback((value) => {
    const parsed = parseRegexLiteralInput(value)
    if (parsed) {
      setPattern(parsed.pattern)
      setFlags(parsed.flags)
    } else {
      setPattern(value)
    }
  }, [])

  const toggleNibMode = () => {
    setNibSuggestion(null)
    setNibError('')
    const next = !nibMode
    setNibMode(next)
    if (next) setTimeout(() => nibInputRef.current?.focus(), 0)
  }

  const acceptSuggestion = useCallback(() => {
    if (!nibSuggestion) return
    setPattern(nibSuggestion.pattern)
    setFlags(nibSuggestion.flags)
    setNibSuggestion(null)
    setNibError('')
  }, [nibSuggestion])

  const dismissSuggestion = useCallback(() => {
    setNibSuggestion(null)
    setNibError('')
  }, [])

  const handlePatternKeyDown = (e) => {
    if (!nibSuggestion) return
    if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); acceptSuggestion(); return }
    if (e.key === 'Escape') { e.preventDefault(); dismissSuggestion(); return }
    // any other key: dismiss suggestion and let user type normally
    dismissSuggestion()
  }

  const sendToNib = useCallback(() => {
    if (!nibRequest.trim() || nibStreaming) return
    nibResponseRef.current = ''
    setNibStreaming(true)
    setNibMode(false)
    setNibError('')

    const ctxParts = []
    if (pattern) ctxParts.push(`Current pattern: /${pattern}/${flags}`)
    if (testStr) ctxParts.push(`Test string:\n${testStr}`)

    streamLLMChat(
      {
        token: agentToken,
        model: ollamaModel,
        messages: [{ role: 'user', content: nibRequest.trim() }],
        context: ctxParts.join('\n\n'),
        contextMode: 'regex',
      },
      (chunk) => { nibResponseRef.current += chunk },
      () => {
        setNibStreaming(false)
        const extracted = extractRegexFromResponse(nibResponseRef.current)
        const validationError = validateRegexSuggestion(extracted)
        if (validationError) {
          setNibError(`Nib returned an invalid regex: ${validationError}`)
        } else {
          setNibSuggestion(extracted)
        }
        setNibRequest('')
      },
      (error) => {
        setNibStreaming(false)
        setNibError(error || 'Nib could not build a regex.')
        setNibRequest('')
      },
    )
  }, [nibRequest, nibStreaming, pattern, flags, testStr, agentToken, ollamaModel])

  const handleNibKeyDown = (e) => {
    if (e.key === 'Escape') { setNibMode(false); return }
    if (e.key === 'Enter') { e.preventDefault(); sendToNib() }
  }

  const result = useMemo(() => {
    if (!pattern) return null
    let re
    try {
      const f = withRequiredFlags(flags)
      re = new RegExp(pattern, f)
    } catch (e) {
      return { error: e.message }
    }
    if (!testStr) return { error: null, matches: [], html: '' }

    const allMatches = []
    const segments   = []
    let lastIdx = 0

    for (const m of testStr.matchAll(re)) {
      allMatches.push(m)
      const matchEnd = m.index + m[0].length
      for (const range of getHighlightRanges(m)) {
        if (range.start > lastIdx) segments.push({ t: 'text', s: testStr.slice(lastIdx, range.start) })
        segments.push({ t: 'match', s: testStr.slice(range.start, range.end), m })
        lastIdx = range.end
      }
      if (matchEnd > lastIdx) {
        segments.push({ t: 'text', s: testStr.slice(lastIdx, matchEnd) })
        lastIdx = matchEnd
      } else if (m[0].length === 0) {
        lastIdx = m.index + 1
      }
      if (lastIdx > testStr.length) break
    }
    if (lastIdx < testStr.length) segments.push({ t: 'text', s: testStr.slice(lastIdx) })

    const html = segments.map(seg =>
      seg.t === 'match' ? `<mark class="rx-match">${esc(seg.s)}</mark>` : esc(seg.s)
    ).join('')

    const matches = allMatches.map((m, i) => ({
      i, full: m[0], index: m.index,
      groups: [...m].slice(1),
      named:  m.groups ?? null,
    }))

    return { error: null, matches, html }
  }, [pattern, flags, testStr])

  const tokens = useMemo(() => {
    if (!pattern || result?.error) return []
    return tokenizeRegex(pattern)
  }, [pattern, result?.error])

  const explainRows = useMemo(() => mergeQuantifiers(tokens), [tokens])

  const safeResult = result ?? { error: null, matches: [], html: '' }
  const matchCount = result?.matches?.length ?? null
  const hasError   = !!result?.error

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Pattern row */}
      <div className="px-4 py-2.5 border-b border-zinc-800 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-600 font-mono shrink-0">
            {nibMode ? 'ask' : 'pattern'}
          </span>
          <div className="relative flex-1">
            {!nibMode && (
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none select-none">/</span>
            )}
            {nibMode ? (
              <input
                ref={nibInputRef}
                value={nibRequest}
                onChange={e => setNibRequest(e.target.value)}
                onKeyDown={handleNibKeyDown}
                placeholder="describe what you want to match… (Enter to send)"
                spellCheck={false}
                className="w-full bg-violet-950/30 border border-violet-700 rounded px-3 py-1.5 text-sm font-mono text-violet-200 outline-none focus:border-violet-500 transition-colors placeholder-violet-800"
              />
            ) : (
              <input
                value={nibSuggestion ? nibSuggestion.pattern : pattern}
                onChange={e => { dismissSuggestion(); updatePatternInput(e.target.value) }}
                onKeyDown={handlePatternKeyDown}
                placeholder={nibStreaming ? '✒ thinking…' : 'regex pattern'}
                readOnly={nibStreaming}
                spellCheck={false}
                className={`w-full bg-zinc-800 border rounded px-6 py-1.5 text-sm font-mono outline-none transition-colors ${
                  nibSuggestion
                    ? 'border-violet-600 text-violet-300 focus:border-violet-400'
                    : nibStreaming
                      ? 'border-zinc-700 text-zinc-600 cursor-wait'
                      : hasError
                        ? 'border-red-800 focus:border-red-600 text-zinc-200'
                        : 'border-zinc-700 focus:border-zinc-500 text-zinc-200'
                }`}
              />
            )}
            {!nibMode && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none select-none">/{flags}</span>
            )}
          </div>

          {llmEnabled && (
            <button
              onClick={nibStreaming ? undefined : toggleNibMode}
              disabled={nibStreaming}
              title={nibStreaming ? 'Nib is thinking…' : nibMode ? 'Back to regex input (Esc)' : 'Ask Nib to write this regex'}
              className={`shrink-0 px-2 py-1.5 text-[12px] rounded border transition-colors font-mono ${
                nibStreaming
                  ? 'text-violet-600 border-violet-900 cursor-wait animate-pulse'
                  : nibMode
                    ? 'text-violet-300 bg-violet-950/50 border-violet-700'
                    : 'text-violet-500 hover:text-violet-300 bg-violet-950/20 border-violet-900 hover:border-violet-700'
              }`}
            >
              ✒
            </button>
          )}

          <div className="flex gap-0.5 shrink-0">
            {['g','i','m','s'].map(f => (
              <button
                key={f}
                onClick={() => toggleFlag(f)}
                title={{ g: 'global', i: 'case insensitive', m: 'multiline', s: 'dot-all' }[f]}
                className={`w-6 h-6 text-[11px] font-mono rounded border transition-colors ${
                  flags.includes(f)
                    ? 'bg-blue-900/70 text-blue-300 border-blue-700'
                    : 'text-zinc-600 border-zinc-700 hover:text-zinc-400 hover:border-zinc-600'
                }`}
              >{f}</button>
            ))}
          </div>

          {!hasError && matchCount !== null && testStr && (
            <span className={`text-[11px] font-mono shrink-0 ${matchCount > 0 ? 'text-green-400' : 'text-zinc-600'}`}>
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </span>
          )}
        </div>

        {nibSuggestion && (
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-violet-400">✒ suggestion</span>
            <span className="text-zinc-600">—</span>
            <button onClick={acceptSuggestion} className="text-violet-300 hover:text-violet-100 transition-colors">Tab / Enter to accept</button>
            <span className="text-zinc-700">·</span>
            <button onClick={dismissSuggestion} className="text-zinc-600 hover:text-zinc-400 transition-colors">Esc to dismiss</button>
          </div>
        )}

        {nibError && !nibSuggestion && (
          <div className="text-[11px] text-violet-300 font-mono bg-violet-950/30 border border-violet-900/40 rounded px-2.5 py-1">
            {nibError}
          </div>
        )}

        {hasError && !nibSuggestion && (
          <div className="text-[11px] text-red-400 font-mono bg-red-950/30 border border-red-900/40 rounded px-2.5 py-1">
            {result.error}
          </div>
        )}

        {/* Token-level highlight strip */}
        {tokens.length > 0 && (
          <div className="font-mono text-[13px] leading-relaxed px-0.5">
            {tokens.map((tok, i) => (
              <span key={i} className={TOKEN_COLORS[tok.type]}>{tok.raw}</span>
            ))}
          </div>
        )}
      </div>

      {/* Test string + results */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <textarea
          value={testStr}
          onChange={e => setTestStr(e.target.value)}
          placeholder="Paste test string here…"
          spellCheck={false}
          className="note-content text-sm text-zinc-400 bg-transparent p-4 resize-none outline-none placeholder-zinc-800 overflow-y-auto border-b border-zinc-800"
          style={{ flex: '0 0 40%' }}
        />

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {/* Explanation */}
          {explainRows.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">Explanation</div>
              <div className="grid gap-y-0.5" style={{ gridTemplateColumns: 'auto 1fr' }}>
                {explainRows.map((tok, i) => (
                  <Fragment key={i}>
                    <code className={`${TOKEN_COLORS[tok.type]} text-[12px] font-mono pr-5 select-all`}>{tok.raw}</code>
                    <span className="text-zinc-500 text-[12px] font-mono">{explainToken(tok)}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          {testStr && !hasError && (
            <>
              <div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">Highlighted</div>
                <pre
                  className="note-content text-[13px] text-zinc-400 leading-relaxed whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: safeResult.html || esc(testStr) }}
                />
              </div>

              {safeResult.matches.length > 0 && (
                <div>
                  <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">Matches</div>
                  <div className="space-y-1.5">
                    {safeResult.matches.map(m => (
                      <div key={m.i} className="text-[12px] font-mono bg-zinc-900 border border-zinc-800 rounded px-3 py-2 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
                        <span className="text-zinc-600 shrink-0">[{m.i}]</span>
                        <span className="text-amber-300">"{m.full}"</span>
                        {m.groups.map((g, gi) => (
                          <span key={gi} className="text-[11px]">
                            <span className="text-zinc-600">group {gi + 1}: </span>
                            <span className="text-blue-400">{g == null ? <span className="text-zinc-600">undefined</span> : `"${g}"`}</span>
                          </span>
                        ))}
                        {m.named && Object.entries(m.named).map(([k, v]) => (
                          <span key={k} className="text-[11px]">
                            <span className="text-zinc-600">?&lt;{k}&gt;: </span>
                            <span className="text-purple-400">"{v}"</span>
                          </span>
                        ))}
                        <span className="text-zinc-700 text-[10px] ml-auto">index {m.index}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {safeResult.matches.length === 0 && pattern && (
                <div className="text-[12px] text-zinc-600 font-mono">no matches</div>
              )}
            </>
          )}

          {!testStr && (
            <div className="text-[12px] text-zinc-700 font-mono">paste a test string above ↑</div>
          )}
        </div>
      </div>
    </div>
  )
}
