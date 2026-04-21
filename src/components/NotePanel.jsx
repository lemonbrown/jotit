import { useState, useEffect, useRef, useMemo } from 'react'
import { marked } from 'marked'
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

import { timeAgo } from '../utils/helpers'
import { TRANSFORMS, applyTransform } from '../utils/transforms'
import { detectRequestType } from '../utils/httpParser'
import CategoryBadge from './CategoryBadge'
import RegexTester from './RegexTester'
import HttpRunner from './HttpRunner'

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

const HINT_LANGS = ['json','javascript','typescript','python','sql','bash','yaml','xml','css','dockerfile','ini']

const mdRenderer = new marked.Renderer()
mdRenderer.code = ({ text, lang }) => {
  let highlighted = ''
  if (lang && hljs.getLanguage(lang)) {
    try { highlighted = hljs.highlight(text, { language: lang }).value } catch {}
  }
  if (!highlighted) {
    try { highlighted = hljs.highlightAuto(text, HINT_LANGS).value } catch {}
  }
  if (!highlighted) highlighted = hljs.escapeHTML(text)
  const cls = lang ? `hljs language-${lang}` : 'hljs'
  return `<pre><code class="${cls}">${highlighted}</code></pre>`
}
marked.use({ renderer: mdRenderer, gfm: true, breaks: true })

function isValidJson(text) {
  const t = text.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return false
  try { JSON.parse(t); return true } catch { return false }
}

export default function NotePanel({ note, aiProcessing, aiEnabled, onUpdate, onDelete }) {
  const [content, setContent] = useState(note.content)
  const [mode, setMode] = useState('edit')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState(false)
  const [regexInstance, setRegexInstance] = useState(0)

  // Selection + transform state
  const [sel, setSel] = useState({ start: 0, end: 0, text: '' })
  const [txResult, setTxResult] = useState(null) // { opName, text, error } | null
  const [txCopied, setTxCopied] = useState(false)

  const textareaRef = useRef(null)
  const capturedSelectionRef = useRef('')
  const capturedHttpSelRef = useRef('')
  const [httpInstance, setHttpInstance] = useState(0)
  const charCount = content.length
  const lineCount = content.split('\n').length

  useEffect(() => {
    setContent(note.content)
    setConfirmDelete(false)
    setSel({ start: 0, end: 0, text: '' })
    setTxResult(null)
    if (!note.content) setTimeout(() => textareaRef.current?.focus(), 50)
  }, [note.id])

  // ── Selection tracking ──────────────────────────────────────────────────────
  const updateSel = () => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: start, selectionEnd: end } = ta
    if (end > start) {
      setSel({ start, end, text: ta.value.slice(start, end) })
    }
  }

  const clearSelIfEmpty = () => {
    const ta = textareaRef.current
    if (!ta) return
    if (ta.selectionStart === ta.selectionEnd) {
      setSel({ start: 0, end: 0, text: '' })
      setTxResult(null)
    }
  }

  // ── Transforms ──────────────────────────────────────────────────────────────
  const runTransform = (id, opName) => {
    try {
      const result = applyTransform(id, sel.text)
      setTxResult({ opName, text: result, error: null })
    } catch (e) {
      setTxResult({ opName, text: '', error: e.message })
    }
  }

  const applyTxResult = () => {
    const newContent = content.slice(0, sel.start) + txResult.text + content.slice(sel.end)
    setContent(newContent)
    onUpdate({ content: newContent })
    setTxResult(null)
    setSel({ start: 0, end: 0, text: '' })
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const copyTxResult = async () => {
    await navigator.clipboard.writeText(txResult.text)
    setTxCopied(true)
    setTimeout(() => setTxCopied(false), 1500)
  }

  // ── Editor actions ──────────────────────────────────────────────────────────
  const handleContent = (e) => {
    setContent(e.target.value)
    onUpdate({ content: e.target.value })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newVal = content.slice(0, start) + '  ' + content.slice(end)
      setContent(newVal)
      onUpdate({ content: newVal })
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
  }

  const prettifyJson = () => {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2)
      setContent(pretty)
      onUpdate({ content: pretty })
    } catch {}
  }

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDelete = () => {
    if (confirmDelete) { onDelete() }
    else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000) }
  }

  const handleRegexMouseDown = () => {
    if (mode === 'regex') return
    const ta = textareaRef.current
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      capturedSelectionRef.current = ta.value.slice(ta.selectionStart, ta.selectionEnd)
    } else {
      capturedSelectionRef.current = ''
    }
  }

  const handleHttpMouseDown = () => {
    if (mode === 'http') return
    const ta = textareaRef.current
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      capturedHttpSelRef.current = ta.value.slice(ta.selectionStart, ta.selectionEnd)
    } else {
      capturedHttpSelRef.current = ''
    }
  }

  // ── Highlight.js ────────────────────────────────────────────────────────────
  const { highlighted, language } = useMemo(() => {
    if (!content.trim()) return { highlighted: '', language: '' }
    try {
      const result = hljs.highlightAuto(content, HINT_LANGS)
      return { highlighted: result.value, language: result.language ?? '' }
    } catch {
      return { highlighted: hljs.escapeHTML(content), language: '' }
    }
  }, [content])

  const markdownHtml = useMemo(() => {
    if (!content.trim()) return ''
    try { return marked.parse(content) } catch { return '' }
  }, [content])

  const looksLikeRequest = useMemo(() => {
    return detectRequestType(content) !== null
  }, [content])

  const jsonValid = isValidJson(content)
  const showTransformStrip = mode === 'edit' && sel.text.length > 0

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

      {/* ── Main toolbar ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-800 shrink-0">
        {jsonValid && (
          <button
            onClick={prettifyJson}
            title="Prettify JSON"
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-amber-400 hover:text-amber-300 bg-amber-950/40 hover:bg-amber-950/70 border border-amber-900/50 rounded transition-colors font-mono"
          >
            <span className="text-[13px] leading-none">{'{}'}</span>
            Prettify
          </button>
        )}
        <button
          onClick={() => setMode(m => m === 'preview' ? 'edit' : 'preview')}
          title="Syntax highlighting preview"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'preview'
              ? 'text-blue-300 bg-blue-950/50 border-blue-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <span className="text-[12px]">&lt;/&gt;</span>
          {mode === 'preview' ? 'Edit' : 'Preview'}
        </button>
        <button
          onMouseDown={handleRegexMouseDown}
          onClick={() => {
            if (mode !== 'regex') setRegexInstance(i => i + 1)
            setMode(m => m === 'regex' ? 'edit' : 'regex')
          }}
          title="Test regex"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'regex'
              ? 'text-purple-300 bg-purple-950/50 border-purple-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <span className="text-[12px]">.*</span>
          {mode === 'regex' ? 'Edit' : 'Regex'}
        </button>
        <button
          onClick={() => setMode(m => m === 'markdown' ? 'edit' : 'markdown')}
          title="Markdown preview"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'markdown'
              ? 'text-emerald-300 bg-emerald-950/50 border-emerald-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <span className="text-[12px]">MD</span>
          {mode === 'markdown' ? 'Edit' : 'Preview'}
        </button>
        <button
          onMouseDown={handleHttpMouseDown}
          onClick={() => {
            if (mode !== 'http') setHttpInstance(i => i + 1)
            setMode(m => m === 'http' ? 'edit' : 'http')
          }}
          title="HTTP / curl runner — select text first to use only that selection"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'http'
              ? 'text-amber-300 bg-amber-950/50 border-amber-800'
              : looksLikeRequest || sel.text.length > 0
                ? 'text-amber-400 hover:text-amber-200 bg-amber-950/20 border-amber-900 hover:border-amber-700'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <span className="text-[12px]">⚡</span>
          {mode === 'http' ? 'Edit' : 'HTTP'}
        </button>
        <button
          onClick={copyToClipboard}
          title="Copy to clipboard"
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded transition-colors"
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
        <div className="ml-auto flex items-center gap-3">
          {aiProcessing && (
            <span className="text-[11px] text-blue-400 animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
              categorizing…
            </span>
          )}
          <button
            onClick={handleDelete}
            className={`text-xs transition-colors px-2 py-1 rounded ${
              confirmDelete
                ? 'bg-red-900/60 text-red-300 border border-red-700'
                : 'text-zinc-600 hover:text-red-400'
            }`}
          >
            {confirmDelete ? 'confirm delete?' : 'delete'}
          </button>
        </div>
      </div>

      {/* ── Transform strip (appears on text selection) ── */}
      {showTransformStrip && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60 overflow-x-auto shrink-0">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 mr-0.5">
            {sel.text.length}c →
          </span>
          {TRANSFORMS.map(t => (
            <button
              key={t.id}
              onMouseDown={e => e.preventDefault()} // keep textarea selection
              onClick={() => runTransform(t.id, t.title)}
              title={t.title}
              className="px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-400 rounded bg-zinc-900 hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Content area ── */}
      {mode === 'edit' && (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleContent}
          onKeyDown={handleKeyDown}
          onSelect={updateSel}
          onMouseUp={updateSel}
          onKeyUp={updateSel}
          onClick={clearSelIfEmpty}
          placeholder="Start typing…"
          spellCheck={false}
          className="flex-1 bg-transparent text-zinc-300 note-content p-4 resize-none outline-none placeholder-zinc-800 overflow-y-auto"
        />
      )}
      {mode === 'preview' && (
        <div className="flex-1 overflow-auto p-4">
          {content.trim() ? (
            <pre className="hljs rounded-lg p-4 text-[13px] leading-relaxed overflow-x-auto" style={{ background: '#0d1117', margin: 0 }}>
              <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
          ) : (
            <span className="text-zinc-700 note-content text-sm">empty</span>
          )}
        </div>
      )}
      {mode === 'markdown' && (
        <div className="flex-1 overflow-auto p-5">
          {markdownHtml ? (
            <div className="md-prose max-w-none" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
          ) : (
            <span className="text-zinc-700 note-content text-sm">empty</span>
          )}
        </div>
      )}
      {mode === 'regex' && (
        <RegexTester
          key={`${note.id}-${regexInstance}`}
          noteContent={content}
          initialTestString={capturedSelectionRef.current}
        />
      )}
      {mode === 'http' && (
        <HttpRunner
          key={`${note.id}-${httpInstance}`}
          noteContent={content}
          initialText={capturedHttpSelRef.current}
        />
      )}

      {/* ── Transform result panel ── */}
      {txResult && mode === 'edit' && (
        <div className="border-t border-zinc-700 bg-zinc-900/80 shrink-0 flex flex-col max-h-56">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800">
            <span className="text-[11px] text-zinc-500 font-mono">{txResult.opName}</span>
            {txResult.error ? (
              <span className="text-[11px] text-red-400">{txResult.error}</span>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyTxResult}
                  className="px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded bg-zinc-800 transition-colors"
                >
                  {txCopied ? '✓ copied' : 'copy'}
                </button>
                <button
                  onClick={applyTxResult}
                  className="px-2 py-0.5 text-[11px] font-mono text-green-400 hover:text-green-300 border border-green-900 hover:border-green-700 rounded bg-green-950/40 transition-colors"
                >
                  replace selection
                </button>
              </div>
            )}
            <button
              onClick={() => setTxResult(null)}
              className="ml-auto text-zinc-600 hover:text-zinc-300 transition-colors text-sm leading-none"
            >
              ✕
            </button>
          </div>
          {!txResult.error && (
            <pre className="note-content text-[12px] text-zinc-300 p-3 overflow-auto flex-1 leading-relaxed">
              {txResult.text}
            </pre>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      {mode !== 'regex' && mode !== 'http' && (
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-1.5 flex-wrap shrink-0 min-h-[36px]">
          {note.categories.length > 0
            ? note.categories.map(c => <CategoryBadge key={c} category={c} />)
            : <span className="text-[11px] text-zinc-700">{aiEnabled ? 'AI will tag when you stop typing…' : 'Add OpenAI key in ⚙ for auto-tagging'}</span>
          }
          <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-700 shrink-0">
            {mode === 'preview' && language && <span className="text-zinc-500 font-mono">{language}</span>}
            {mode === 'markdown' && <span className="text-emerald-700 font-mono">markdown</span>}
            <span>{lineCount}L · {charCount}C</span>
            <span>{timeAgo(note.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
