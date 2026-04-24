import { useState, useMemo, Fragment } from 'react'

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

export default function RegexTester({ initialTestString = '' }) {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags]     = useState('g')
  const [testStr, setTestStr] = useState(initialTestString)

  const toggleFlag = (f) =>
    setFlags(prev => prev.includes(f) ? prev.replace(f, '') : prev + f)

  const result = useMemo(() => {
    if (!pattern) return null
    let re
    try {
      const f = flags.includes('g') ? flags : flags + 'g'
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
      if (m.index > lastIdx) segments.push({ t: 'text', s: testStr.slice(lastIdx, m.index) })
      segments.push({ t: 'match', s: m[0] || '∅', m })
      lastIdx = m.index + (m[0].length || 1)
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
          <span className="text-[11px] text-zinc-600 font-mono shrink-0">pattern</span>
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none select-none">/</span>
            <input
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              placeholder="regex pattern"
              spellCheck={false}
              className={`w-full bg-zinc-800 border rounded px-6 py-1.5 text-sm font-mono text-zinc-200 outline-none transition-colors ${
                hasError ? 'border-red-800 focus:border-red-600' : 'border-zinc-700 focus:border-zinc-500'
              }`}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none select-none">/{flags}</span>
          </div>

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

        {hasError && (
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
