import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
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
import DiffViewer from './DiffViewer'

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

export default function NotePanel({ note, aiProcessing, aiEnabled, onUpdate, onDelete, txExpanded, onTxExpandedChange, notes, onDiffModeChange }) {
  const [content, setContent] = useState(note.content)
  const [mode, setMode] = useState('edit')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState(false)
  const [regexInstance, setRegexInstance] = useState(0)

  // Selection + transform state
  const [sel, setSel] = useState({ start: 0, end: 0, text: '' })
  const [txResult, setTxResult] = useState(null) // { opName, text, error } | null
  const [txCopied, setTxCopied] = useState(false)
  const [interactiveTx, setInteractiveTx] = useState(null) // { id, opName, param } | null
  const [guidCopied, setGuidCopied] = useState(false)
  const [diffCapture, setDiffCapture] = useState(null) // captured "A" text for diff
  const [diffInstance, setDiffInstance] = useState(0)
  const [diffPendingNote, setDiffPendingNote] = useState(null)
  const [codeBefore, setCodeBefore] = useState('')
  const [codeAfter, setCodeAfter] = useState('')
  const [codeContent, setCodeContent] = useState('')
  const showMoreTx = txExpanded
  const setShowMoreTx = onTxExpandedChange

  const textareaRef = useRef(null)
  const codeEditRef = useRef(null)
  const codePreRef = useRef(null)
  const interactiveInputRef = useRef(null)
  const historyRef = useRef([note.content])
  const historyIdxRef = useRef(0)
  const historyTimerRef = useRef(null)
  const capturedSelectionRef = useRef('')
  const capturedHttpSelRef = useRef('')
  const capturedDiffARef = useRef('')
  const capturedDiffBRef = useRef('')
  const [httpInstance, setHttpInstance] = useState(0)
  const [showLineNumbers, setShowLineNumbers] = useState(() => localStorage.getItem('jotit_lnums') !== 'false')
  const lineNumsRef = useRef(null)
  const charCount = content.length
  const lineCount = content.split('\n').length

  useEffect(() => {
    setContent(note.content)
    setConfirmDelete(false)
    setSel({ start: 0, end: 0, text: '' })
    setTxResult(null)
    setInteractiveTx(null)
    clearTimeout(historyTimerRef.current)
    historyRef.current = [note.content]
    historyIdxRef.current = 0
  }, [note.id])

  // Register/unregister diff note loader with parent
  useEffect(() => {
    if (mode === 'diff') {
      onDiffModeChange?.((note) => setDiffPendingNote(note))
    } else {
      onDiffModeChange?.(null)
    }
    return () => onDiffModeChange?.(null)
  }, [mode])

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
      setInteractiveTx(null)
    }
  }

  // ── Undo / redo ─────────────────────────────────────────────────────────────
  const pushHistory = (text) => {
    clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => {
      const idx = historyIdxRef.current
      if (historyRef.current[idx] === text) return
      const next = historyRef.current.slice(0, idx + 1)
      next.push(text)
      if (next.length > 200) next.splice(0, next.length - 200)
      historyRef.current = next
      historyIdxRef.current = next.length - 1
    }, 300)
  }

  const pushHistoryNow = (text) => {
    clearTimeout(historyTimerRef.current)
    const idx = historyIdxRef.current
    if (historyRef.current[idx] === text) return
    const next = historyRef.current.slice(0, idx + 1)
    next.push(text)
    if (next.length > 200) next.splice(0, next.length - 200)
    historyRef.current = next
    historyIdxRef.current = next.length - 1
  }

  const undo = () => {
    clearTimeout(historyTimerRef.current)
    const idx = historyIdxRef.current
    if (idx <= 0) return
    historyIdxRef.current = idx - 1
    const prev = historyRef.current[idx - 1]
    setContent(prev)
    onUpdate({ content: prev })
    if (mode === 'code') {
      const newCode = codeAfter.length > 0 ? prev.slice(codeBefore.length, -codeAfter.length) : prev.slice(codeBefore.length)
      setCodeContent(newCode)
    }
  }

  const redo = () => {
    clearTimeout(historyTimerRef.current)
    const idx = historyIdxRef.current
    if (idx >= historyRef.current.length - 1) return
    historyIdxRef.current = idx + 1
    const next = historyRef.current[idx + 1]
    setContent(next)
    onUpdate({ content: next })
    if (mode === 'code') {
      const newCode = codeAfter.length > 0 ? next.slice(codeBefore.length, -codeAfter.length) : next.slice(codeBefore.length)
      setCodeContent(newCode)
    }
  }

  // ── Transforms ──────────────────────────────────────────────────────────────
  const runTransform = (id, opName, param = '') => {
    try {
      const result = applyTransform(id, sel.text, param)
      setTxResult({ opName, text: result, error: null })
    } catch (e) {
      setTxResult({ opName, text: '', error: e.message })
    }
  }

  const startInteractive = (id, opName) => {
    setInteractiveTx({ id, opName, param: '' })
    setTxResult(null)
    requestAnimationFrame(() => interactiveInputRef.current?.focus())
  }

  const updateInteractiveParam = (param) => {
    setInteractiveTx(prev => ({ ...prev, param }))
    try {
      const result = applyTransform(interactiveTx.id, sel.text, param)
      setTxResult({ opName: interactiveTx.opName, text: result, error: null })
    } catch (e) {
      setTxResult({ opName: interactiveTx.opName, text: '', error: e.message })
    }
  }

  const dismissInteractive = () => {
    setInteractiveTx(null)
    setTxResult(null)
  }

  const insertGuid = () => {
    const guid = crypto.randomUUID()
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = content.slice(0, start) + guid + content.slice(end)
    pushHistoryNow(next)
    setContent(next)
    onUpdate({ content: next })
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + guid.length
      ta.focus()
    })
    setGuidCopied(true)
    setTimeout(() => setGuidCopied(false), 1500)
  }

  const applyTxResult = () => {
    const newContent = content.slice(0, sel.start) + txResult.text + content.slice(sel.end)
    pushHistoryNow(newContent)
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
    pushHistory(e.target.value)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      undo()
      return
    }
    if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
      e.preventDefault()
      redo()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newVal = content.slice(0, start) + '  ' + content.slice(end)
      setContent(newVal)
      onUpdate({ content: newVal })
      pushHistoryNow(newVal)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
  }

  const prettifyJson = () => {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2)
      pushHistoryNow(content)
      setContent(pretty)
      onUpdate({ content: pretty })
      pushHistoryNow(pretty)
    } catch {}
  }

  const enterCodeMode = () => {
    if (mode === 'code') {
      setMode('edit')
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    const ta = textareaRef.current
    const hasTextSel = ta && ta.selectionStart !== ta.selectionEnd
    if (hasTextSel) {
      setCodeBefore(content.slice(0, ta.selectionStart))
      setCodeContent(content.slice(ta.selectionStart, ta.selectionEnd))
      setCodeAfter(content.slice(ta.selectionEnd))
    } else {
      setCodeBefore('')
      setCodeContent(content)
      setCodeAfter('')
    }
    setMode('code')
    requestAnimationFrame(() => codeEditRef.current?.focus())
  }

  const handleCodeEdit = (e) => {
    const newCode = e.target.value
    setCodeContent(newCode)
    const full = codeBefore + newCode + codeAfter
    setContent(full)
    onUpdate({ content: full })
    pushHistory(full)
  }

  const handleCodeKeyDown = (e) => {
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      undo()
      return
    }
    if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
      e.preventDefault()
      redo()
      return
    }
    if (e.key === 'Escape') {
      setMode('edit')
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.target
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newVal = codeContent.slice(0, start) + '  ' + codeContent.slice(end)
      setCodeContent(newVal)
      const full = codeBefore + newVal + codeAfter
      setContent(full)
      onUpdate({ content: full })
      pushHistoryNow(full)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
  }

  const syncCodeScroll = (e) => {
    if (codePreRef.current) {
      codePreRef.current.scrollTop = e.target.scrollTop
      codePreRef.current.scrollLeft = e.target.scrollLeft
    }
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

  // Capture selection for panel mode switches
  const captureSelForModeSwitch = () => {
    const ta = textareaRef.current
    const text = (ta && ta.selectionStart !== ta.selectionEnd)
      ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
      : ''
    capturedSelectionRef.current = text
    capturedHttpSelRef.current = text
    capturedDiffARef.current = text
    capturedDiffBRef.current = ''
  }

  const openDiffWithCaptures = () => {
    setDiffInstance(i => i + 1)
    switchMode('diff')
  }

  const switchMode = useCallback((next) => {
    if (next === 'regex' && mode !== 'regex') setRegexInstance(i => i + 1)
    if (next === 'http'  && mode !== 'http')  setHttpInstance(i => i + 1)
    if (next === 'diff'  && mode !== 'diff')  setDiffInstance(i => i + 1)
    setMode(prev => prev === next ? 'edit' : next)
  }, [mode])


  const { codeHighlighted, codeLanguage } = useMemo(() => {
    if (mode !== 'code') return { codeHighlighted: '', codeLanguage: '' }
    if (!codeContent.trim()) return { codeHighlighted: hljs.escapeHTML(codeContent), codeLanguage: '' }
    try {
      const result = hljs.highlightAuto(codeContent, HINT_LANGS)
      return { codeHighlighted: result.value, codeLanguage: result.language ?? '' }
    } catch {
      return { codeHighlighted: hljs.escapeHTML(codeContent), codeLanguage: '' }
    }
  }, [codeContent, mode])

  const markdownHtml = useMemo(() => {
    if (!content.trim()) return ''
    try { return marked.parse(content) } catch { return '' }
  }, [content])

  const looksLikeRequest = useMemo(() => {
    return detectRequestType(content) !== null
  }, [content])

  const jsonValid = isValidJson(content)
  const hasSelection = sel.text.length > 0

  // Score each transform against the selected text for contextual ordering
  const scoredTransforms = useMemo(() => {
    const t = sel.text.trim()
    if (!t) return TRANSFORMS.map(tx => ({ ...tx, score: 0 }))
    const score = (id) => {
      const bare = t.replace(/[{}\-()\s]/g, '')
      if (id === 'jwt')      return t.split('.').length === 3 && /^[A-Za-z0-9_-]{10,}$/.test(t.split('.')[0]) ? 10 : 0
      if (id === 'json')     return (t[0] === '{' || t[0] === '[') ? 9 : 0
      if (id === 'jsonpath') return (t[0] === '{' || t[0] === '[') ? 8 : 0
      if (id === 'qs')       return (t.includes('=') && (t.includes('&') || t.includes('?'))) ? 9 : 0
      if (id === 'urld')     return t.includes('%') ? 8 : 0
      if (id === 'base64d')  return /^[A-Za-z0-9+/=_-]{16,}$/.test(t.replace(/\s/g,'')) ? 6 : 0
      if (id === 'htmld')    return (t.includes('&amp;') || t.includes('&#') || t.includes('&lt;')) ? 8 : 0
      if (id === 'unicode')  return (t.includes('\\u') || t.includes('&#x')) ? 8 : 0
      if (id === 'hex2asc')  return /^([0-9a-fA-F]{2}[\s:])+[0-9a-fA-F]{2}$/.test(t) ? 9 : /^[0-9a-fA-F]{8,}$/.test(t) ? 6 : 0
      if (id === 'csv2json') return (t.includes(',') && t.includes('\n')) ? 8 : 0
      if (id === 'logfmt')   return /\d{4}-\d{2}-\d{2}/.test(t) || /\w+=\S+/.test(t) ? 7 : 0
      if (id === 'guidval')  return /^[0-9a-fA-F-]{32,36}$/.test(bare) ? 10 : 0
      if (id === 'guidstrip')return /^[0-9a-fA-F-]{32,36}$/.test(bare) && t.includes('-') ? 8 : 0
      if (id === 'guidfmt')  return /^[0-9a-fA-F]{32}$/.test(bare) && !t.includes('-') ? 8 : 0
      if (id === 'toSnake')  return (/[a-z][A-Z]/.test(t) || /[-\s][a-z]/.test(t)) ? 5 : 0
      if (id === 'toCamel')  return (/_[a-z]/.test(t) || /[-\s][a-z]/.test(t)) ? 5 : 0
      if (id === 'toPascal') return (/_[a-z]/.test(t) || /[a-z][A-Z]/.test(t) || /[-\s][a-zA-Z]/.test(t)) ? 4 : 0
      return 0
    }
    return TRANSFORMS.map(tx => ({ ...tx, score: score(tx.id) }))
  }, [sel.text])


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
          onMouseDown={e => e.preventDefault()}
          onClick={enterCodeMode}
          title={mode === 'code' ? 'Exit code editor' : 'Editable syntax-highlighted view — select text first for a region'}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'code'
              ? 'text-blue-300 bg-blue-950/50 border-blue-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <span className="text-[12px]">&lt;/&gt;</span>
          {mode === 'code' ? 'Edit' : 'Code'}
        </button>
        <button
          onMouseDown={captureSelForModeSwitch}
          onClick={() => switchMode('regex')}
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
          onMouseDown={captureSelForModeSwitch}
          onClick={() => switchMode('markdown')}
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
          onMouseDown={captureSelForModeSwitch}
          onClick={() => switchMode('http')}
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
          onMouseDown={captureSelForModeSwitch}
          onClick={() => switchMode('diff')}
          title="Diff two texts or notes"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'diff'
              ? 'text-sky-300 bg-sky-950/50 border-sky-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <span className="text-[12px]">±</span>
          {mode === 'diff' ? 'Edit' : 'Diff'}
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={insertGuid}
          title="Insert UUID v4 at cursor"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            guidCopied
              ? 'text-green-300 border-green-800 bg-green-950/30'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          {guidCopied ? '✓ inserted' : 'GUID'}
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => setShowLineNumbers(v => { const next = !v; localStorage.setItem('jotit_lnums', String(next)); return next })}
          title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            showLineNumbers
              ? 'text-zinc-300 bg-zinc-800/60 border-zinc-600'
              : 'text-zinc-600 hover:text-zinc-400 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          #
        </button>
        <button
          onClick={copyToClipboard}
          title="Copy to clipboard"
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded transition-colors"
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => onUpdate({ isPublic: !note.isPublic })}
          title={note.isPublic ? 'Public — click to make private' : 'Private — click to make public'}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            note.isPublic
              ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800 hover:bg-emerald-950/60'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clipRule="evenodd" />
          </svg>
          {note.isPublic ? 'Public' : 'Private'}
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

      {/* ── Transform strip ── */}
      {mode === 'edit' && !interactiveTx && (
        <div className={`px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60 shrink-0 ${showMoreTx ? 'flex flex-wrap gap-1' : 'flex items-center gap-1 overflow-hidden'}`}>
          {hasSelection ? (
            <span className="text-[10px] text-zinc-600 font-mono shrink-0 self-center mr-0.5">
              {sel.text.length}c
            </span>
          ) : (
            <span className="text-[10px] text-zinc-700 font-mono shrink-0 self-center mr-0.5">
              select to transform
            </span>
          )}

          {/* Suggested transforms (score > 0), or all when expanded */}
          {(showMoreTx ? scoredTransforms : scoredTransforms.filter(t => t.score > 0).sort((a, b) => b.score - a.score).slice(0, 5))
            .map(t => (
              <button
                key={t.id}
                onMouseDown={e => e.preventDefault()}
                onClick={() => hasSelection && (t.interactive ? startInteractive(t.id, t.title) : runTransform(t.id, t.title))}
                title={hasSelection ? t.title : 'Select text first'}
                className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
                  !hasSelection
                    ? 'text-zinc-700 border-zinc-800 cursor-default'
                    : t.score > 0
                      ? 'text-zinc-300 hover:text-zinc-100 border-zinc-600 hover:border-zinc-400 bg-zinc-800/80 hover:bg-zinc-700'
                      : 'text-zinc-500 hover:text-zinc-300 border-zinc-800 hover:border-zinc-600 bg-transparent hover:bg-zinc-800/40'
                }`}
              >
                {t.label}
              </button>
            ))
          }

          {/* Diff capture buttons */}
          {hasSelection && !diffCapture && (
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => setDiffCapture(sel.text)}
              title="Capture as diff side A"
              className="px-2 py-0.5 text-[11px] font-mono text-sky-500 hover:text-sky-300 border border-sky-900 hover:border-sky-700 rounded bg-sky-950/20 hover:bg-sky-950/40 transition-colors whitespace-nowrap shrink-0"
            >
              Diff A
            </button>
          )}
          {hasSelection && diffCapture && (
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                capturedDiffARef.current = diffCapture
                capturedDiffBRef.current = sel.text
                setDiffCapture(null)
                openDiffWithCaptures()
              }}
              title={`Compare with captured A (${diffCapture.length}c)`}
              className="px-2 py-0.5 text-[11px] font-mono text-sky-300 border border-sky-600 bg-sky-900/40 hover:bg-sky-900/70 rounded transition-colors whitespace-nowrap shrink-0"
            >
              vs A
            </button>
          )}
          {diffCapture && (
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => setDiffCapture(null)}
              title="Clear captured A"
              className="px-1.5 py-0.5 text-[10px] font-mono text-sky-700 hover:text-sky-500 border border-sky-900 rounded transition-colors whitespace-nowrap shrink-0"
            >
              A ✕
            </button>
          )}

          {/* Show all / collapse toggle */}
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => setShowMoreTx(v => !v)}
            title={showMoreTx ? 'Collapse' : 'Show all transforms'}
            className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors shrink-0 ${showMoreTx ? 'ml-0' : 'ml-auto'} ${
              showMoreTx
                ? 'text-zinc-400 border-zinc-600 bg-zinc-800 hover:text-zinc-200'
                : 'text-zinc-600 border-zinc-800 hover:text-zinc-400 hover:border-zinc-600'
            }`}
          >
            {showMoreTx ? '↑ less' : '···'}
          </button>
        </div>
      )}

      {/* ── Interactive transform input (e.g. JSON path) ── */}
      {mode === 'edit' && interactiveTx && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950/60 shrink-0">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0">
            {interactiveTx.opName}
          </span>
          <input
            ref={interactiveInputRef}
            value={interactiveTx.param}
            onChange={e => updateInteractiveParam(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') dismissInteractive() }}
            placeholder=".data.items[].title"
            spellCheck={false}
            className="flex-1 bg-zinc-800 border border-zinc-700 focus:border-zinc-500 rounded px-2.5 py-1 text-sm font-mono text-zinc-200 outline-none transition-colors placeholder-zinc-700"
          />
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={dismissInteractive}
            className="text-zinc-600 hover:text-zinc-300 transition-colors text-sm leading-none shrink-0"
            title="Cancel (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Content area ── */}
      {mode === 'edit' && (
        <div className="flex flex-1 overflow-hidden">
          {showLineNumbers && (
            <div
              ref={lineNumsRef}
              className="select-none shrink-0 overflow-y-hidden pt-4 pb-4 pr-3 pl-2 text-right border-r border-zinc-800/60"
              style={{
                fontFamily: "'JetBrains Mono','Fira Code',Consolas,monospace",
                fontSize: '13px',
                lineHeight: '1.6',
                color: '#3f3f46',
                width: `${Math.max(String(lineCount).length + 2, 4)}ch`,
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i + 1}>{i + 1}</div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContent}
            onKeyDown={handleKeyDown}
            onSelect={updateSel}
            onMouseUp={updateSel}
            onKeyUp={updateSel}
            onClick={clearSelIfEmpty}
            onScroll={showLineNumbers ? e => { if (lineNumsRef.current) lineNumsRef.current.scrollTop = e.target.scrollTop } : undefined}
            placeholder="Start typing…"
            spellCheck={false}
            className="flex-1 bg-transparent text-zinc-300 note-content p-4 resize-none outline-none placeholder-zinc-800 overflow-y-auto"
          />
        </div>
      )}

      {mode === 'code' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {codeBefore.length > 0 && (
            <div className="px-4 py-2 border-b border-zinc-800 text-zinc-600 note-content text-[13px] leading-relaxed max-h-28 overflow-hidden shrink-0 select-none">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{codeBefore}</pre>
            </div>
          )}
          <div className="relative flex-1 overflow-hidden" style={{ background: '#0d1117' }}>
            <pre
              ref={codePreRef}
              aria-hidden="true"
              className="hljs absolute inset-0 m-0 p-4 overflow-auto pointer-events-none text-[13px] leading-relaxed"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'JetBrains Mono','Fira Code',Consolas,monospace" }}
              dangerouslySetInnerHTML={{ __html: codeHighlighted + '\n' }}
            />
            <textarea
              ref={codeEditRef}
              value={codeContent}
              onChange={handleCodeEdit}
              onKeyDown={handleCodeKeyDown}
              onScroll={syncCodeScroll}
              spellCheck={false}
              className="absolute inset-0 w-full h-full p-4 resize-none outline-none bg-transparent text-[13px] leading-relaxed"
              style={{ color: 'transparent', caretColor: '#e2e8f0', fontFamily: "'JetBrains Mono','Fira Code',Consolas,monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            />
          </div>
          {codeAfter.length > 0 && (
            <div className="px-4 py-2 border-t border-zinc-800 text-zinc-600 note-content text-[13px] leading-relaxed max-h-28 overflow-hidden shrink-0 select-none">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{codeAfter}</pre>
            </div>
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
      {mode === 'diff' && (
        <DiffViewer
          key={`${note.id}-${diffInstance}`}
          noteContent={content}
          initialA={capturedDiffARef.current}
          initialB={capturedDiffBRef.current}
          notes={notes}
          currentNoteId={note.id}
          pendingNote={diffPendingNote}
          onPendingNoteConsumed={() => setDiffPendingNote(null)}
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

      {/* ── Code mode footer ── */}
      {mode === 'code' && (
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-1.5 flex-wrap shrink-0 min-h-[36px]" style={{ background: '#0d1117' }}>
          <span className="text-[11px] text-zinc-600 font-mono">Esc to exit · Tab for indent</span>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-600 shrink-0 font-mono">
            {codeLanguage && <span className="text-zinc-400">{codeLanguage}</span>}
            <span>{codeContent.split('\n').length}L · {codeContent.length}C</span>
            <span>{timeAgo(note.updatedAt)}</span>
          </div>
        </div>
      )}
      {/* ── Footer ── */}
      {mode !== 'regex' && mode !== 'http' && mode !== 'diff' && mode !== 'code' && (
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-1.5 flex-wrap shrink-0 min-h-[36px]">
          {note.categories.length > 0
            ? note.categories.map(c => <CategoryBadge key={c} category={c} />)
            : <span className="text-[11px] text-zinc-700">{aiEnabled ? 'AI will tag when you stop typing…' : 'Add OpenAI key in ⚙ for auto-tagging'}</span>
          }
          <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-700 shrink-0">
            {mode === 'markdown' && <span className="text-emerald-700 font-mono">markdown</span>}
            <span>{lineCount}L · {charCount}C</span>
            <span>{timeAgo(note.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
