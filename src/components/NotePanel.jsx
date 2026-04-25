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

import { timeAgo, generateId } from '../utils/helpers'
import {
  buildMarker,
  extractMarkerIds,
  processImageFile,
} from '../utils/attachments'
import {
  insertAttachment,
  getAttachmentsForNote,
  deleteAttachment,
  schedulePersist,
} from '../utils/db'
import { TRANSFORMS, applyTransform, parseDates, detectSingleDate, getDateFormats,
         detectTimeWithZone, getTimeConversions, detectTimestamp, getTimestampFormats } from '../utils/transforms'
import { analyzeCalculation } from '../utils/calculator'
import { parseCsvTable, looksLikeCsvTable } from '../utils/csvTable'
import { diagramSessionFromText, serializeDiagramBlock } from '../utils/diagram'
import { detectRequestType } from '../utils/httpParser'
import CategoryBadge from './CategoryBadge'
import FindBar from './FindBar'
import { findMatches, isValidRegex, parseSearchScope, findMatchesScoped } from '../utils/inNoteSearch'
import { parseSections, matchesToSections } from '../utils/parseNoteSections'
import RegexTester from './RegexTester'
import HttpRunner from './HttpRunner'
import DiffViewer from './DiffViewer'
import TableViewer from './TableViewer'
import CronBuilder from './CronBuilder'
import DiagramEditor from './DiagramEditor'
import JsonBlockViewer from './JsonBlockViewer'
import InlineImageEditor from './InlineImageEditor'
import SQLiteViewer from './SQLiteViewer'
import OpenApiViewer from './OpenApiViewer'
import { extractSQLiteAssetRef } from '../utils/sqliteNote'
import { NOTE_TYPE_OPENAPI, isOpenApiNote } from '../utils/noteTypes'

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

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const mdRenderer = new marked.Renderer()
mdRenderer.code = ({ text, lang }) => {
  let highlighted = ''
  if (lang && hljs.getLanguage(lang)) {
    try { highlighted = hljs.highlight(text, { language: lang }).value } catch {}
  }
  if (!highlighted) {
    try { highlighted = hljs.highlightAuto(text, HINT_LANGS).value } catch {}
  }
  if (!highlighted) highlighted = escapeHtml(text)
  const cls = lang ? `hljs language-${lang}` : 'hljs'
  return `<pre><code class="${cls}">${highlighted}</code></pre>`
}
marked.use({ renderer: mdRenderer, gfm: true, breaks: true })

function autoIndent(code) {
  const lines = code.split('\n')
  let depth = 0
  const out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { out.push(''); continue }
    const leadingClose = (line.match(/^[}\]\)]+/) || [''])[0].length
    depth = Math.max(0, depth - leadingClose)
    out.push('  '.repeat(depth) + line)
    const opens  = (line.match(/[{(\[]/g) || []).length
    const closes = (line.match(/[}\)\]]/g) || []).length
    depth = Math.max(0, depth + opens - closes + leadingClose)
  }
  return out.join('\n')
}

function isValidJson(text) {
  const t = text.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return false
  try { JSON.parse(t); return true } catch { return false }
}

function snippetLabel(snippet) {
  if (snippet.name?.trim()) return snippet.name.trim()
  const firstLine = snippet.content.split('\n').find(line => line.trim()) ?? snippet.content
  return firstLine.trim().slice(0, 48) || 'untitled snippet'
}

function getSnippetTrigger(text, cursor) {
  const before = text.slice(0, cursor)
  const match = before.match(/(?:^|[\s([{\n])!(?<query>[^\s!()]*)$/)
  if (!match || match.index == null) return null
  const bangIndex = before.lastIndexOf('!')
  if (bangIndex === -1) return null
  return { start: bangIndex, end: cursor, query: match.groups?.query ?? '' }
}

export default function NotePanel({ note, snippets = [], aiEnabled, user, onRequireAuth, onUpdate, onDelete, onCreateSnippet, onSearchSnippets, onPublishNote, onCreateNoteFromContent, focusNonce, restoreLocation, onLocationChange, notes, onDiffModeChange }) {
  const [content, setContent] = useState(note.content)
  const [mode, setMode] = useState('edit')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [regexInstance, setRegexInstance] = useState(0)
  const [codeViewActive, setCodeViewActive] = useState(false)

  // Selection + transform state
  const [sel, setSel] = useState({ start: 0, end: 0, text: '' })
  const [txResult, setTxResult] = useState(null) // { opName, text, error } | null
  const [txCopied, setTxCopied] = useState(false)
  const [calcResult, setCalcResult] = useState(null)
  const [pendingCalc, setPendingCalc] = useState(null)
  const [calcCopied, setCalcCopied] = useState(false)
  const [interactiveTx, setInteractiveTx] = useState(null) // { id, opName, param } | null
  const [guidCopied, setGuidCopied] = useState(false)
  const [diffCapture, setDiffCapture] = useState(null) // captured "A" text for diff
  const [diffInstance, setDiffInstance] = useState(0)
  const [diffPendingNote, setDiffPendingNote] = useState(null)
  const [codeBefore, setCodeBefore] = useState('')
  const [codeAfter, setCodeAfter] = useState('')
  const [codeContent, setCodeContent] = useState('')
  const [gotoOpen, setGotoOpen] = useState(false)
  const [gotoLine, setGotoLine] = useState('')
  const [gotoError, setGotoError] = useState(false)
  const [tableSession, setTableSession] = useState(null)
  const [cronSession, setCronSession] = useState(null)
  const [diagramSession, setDiagramSession] = useState(null)
  const [jsonSession, setJsonSession] = useState(null)
  const [snippetSaveOpen, setSnippetSaveOpen] = useState(false)
  const [snippetDraftName, setSnippetDraftName] = useState('')
  const [snippetSaved, setSnippetSaved] = useState(false)
  const [snippetPicker, setSnippetPicker] = useState(null)
  const [snippetResults, setSnippetResults] = useState([])
  const [snippetActiveIndex, setSnippetActiveIndex] = useState(0)
  const [displayHint, setDisplayHint] = useState(null) // 'table' | 'code' | null — persists after apply for sharing

  const textareaRef = useRef(null)
  const codeEditRef = useRef(null)
  const codePreRef = useRef(null)
  const interactiveInputRef = useRef(null)
  const gotoInputRef = useRef(null)
  const snippetNameInputRef = useRef(null)
  const editorScrollCoastRef = useRef({ velocity: 0, direction: 1, rafId: null })
  const historyRef = useRef([note.content])
  const historyIdxRef = useRef(0)
  const historyTimerRef = useRef(null)
  const capturedSelectionRef = useRef('')
  const capturedHttpSelRef = useRef('')
  const capturedDiffARef = useRef('')
  const capturedDiffBRef = useRef('')
  const txRangeRef = useRef({ start: 0, end: 0 })
  const [httpInstance, setHttpInstance] = useState(0)
  const [showLineNumbers, setShowLineNumbers] = useState(() => localStorage.getItem('jotit_lnums') !== 'false')
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findMode, setFindMode] = useState('exact')
  const [findMatchIndex, setFindMatchIndex] = useState(0)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineQuery, setOutlineQuery] = useState('')
  const [outlineIndex, setOutlineIndex] = useState(0)
  const [attachments, setAttachments] = useState([])
  const [pasteError, setPasteError] = useState('')

  const lineNumsRef = useRef(null)
  const findInputRef = useRef(null)
  const outlineInputRef = useRef(null)
  const outlineListRef = useRef(null)
  const snippetSearchSeqRef = useRef(0)
  const inlineSegOffsetRef = useRef(0)
  const inlineScrollRef = useRef(null)
  const markdownPreviewRef = useRef(null)
  const panelRef = useRef(null)
  const attachmentMap = useMemo(() => new Map(attachments.map(a => [a.id, a])), [attachments])
  const hasInlineImages = attachments.length > 0 && /\[img:\/\/[^\]]+\]/.test(content)
  const openApiNote = useMemo(() => isOpenApiNote(note), [note])
  const editorDisplayContent = openApiNote ? (note.noteData?.rawText ?? content) : content
  const charCount = editorDisplayContent.length
  const lineCount = editorDisplayContent.split('\n').length

  const pendingCalcInline = useMemo(() => {
    if (!pendingCalc) return null
    const ta = textareaRef.current
    const startText = content.slice(0, Math.min(pendingCalc.end, content.length))
    const lineIndex = startText.split('\n').length - 1
    const lineStart = startText.lastIndexOf('\n') + 1
    const column = startText.length - lineStart
    const lineHeight = ta ? (parseFloat(getComputedStyle(ta).lineHeight) || 20.8) : 20.8
    const charWidth = 7.8
    const top = 16 + lineIndex * lineHeight - (ta?.scrollTop ?? 0)
    const left = 16 + column * charWidth - (ta?.scrollLeft ?? 0)
    const visible = !ta || (top > -lineHeight && top < ta.clientHeight + lineHeight)
    return { top, left, visible }
  }, [content, pendingCalc])

  const reportCurrentLocation = useCallback((target = textareaRef.current) => {
    if (!target) return
    onLocationChange?.({
      noteId: note.id,
      cursorStart: target.selectionStart ?? 0,
      cursorEnd: target.selectionEnd ?? target.selectionStart ?? 0,
      scrollTop: target.scrollTop ?? 0,
    })
  }, [note.id, onLocationChange])

  const focusEditorLine = useCallback((lineNumber) => {
    const ta = textareaRef.current
    if (!ta) return

    const clampedLine = Math.min(Math.max(lineNumber, 1), lineCount)
    let pos = 0
    for (let line = 1; line < clampedLine; line++) {
      const nextBreak = content.indexOf('\n', pos)
      if (nextBreak === -1) break
      pos = nextBreak + 1
    }

    ta.focus()
    ta.selectionStart = ta.selectionEnd = pos

    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20
    const targetTop = Math.max(0, (clampedLine - 1) * lineHeight - ta.clientHeight * 0.35)
    ta.scrollTop = targetTop
    if (lineNumsRef.current) lineNumsRef.current.scrollTop = targetTop
    reportCurrentLocation(ta)
  }, [content, lineCount, reportCurrentLocation])

  const openGotoLine = useCallback(() => {
    setMode('edit')
    setGotoOpen(true)
    setGotoLine('')
    setGotoError(false)
    requestAnimationFrame(() => gotoInputRef.current?.focus())
  }, [])

  const submitGotoLine = useCallback(() => {
    const nextLine = Number.parseInt(gotoLine, 10)
    if (!Number.isFinite(nextLine) || nextLine < 1) {
      setGotoError(true)
      return
    }
    setGotoOpen(false)
    setGotoError(false)
    requestAnimationFrame(() => focusEditorLine(nextLine))
  }, [focusEditorLine, gotoLine])

  const openFind = useCallback(() => {
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const sections = useMemo(() => parseSections(content), [content])
  const sqliteAssetRef = useMemo(() => extractSQLiteAssetRef(content), [content])

  const jumpToFindMatch = useCallback((targetIndex, results) => {
    if (!results.length) return
    const count = results.length
    const idx = ((targetIndex % count) + count) % count
    setFindMatchIndex(idx)
    const match = results[idx]

    const jumpInMain = () => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(match.start, match.end)
      const lineIndex = ta.value.slice(0, match.start).split('\n').length - 1
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20.8
      ta.scrollTop = Math.max(0, lineIndex * lineHeight - ta.clientHeight * 0.35)
      if (lineNumsRef.current) lineNumsRef.current.scrollTop = ta.scrollTop
    }

    if (mode === 'markdown') {
      setMode('edit')
      requestAnimationFrame(jumpInMain)
    } else if (codeViewActive) {
      const localStart = match.start - codeBefore.length
      const localEnd   = match.end   - codeBefore.length
      if (localStart >= 0 && localEnd <= codeContent.length) {
        requestAnimationFrame(() => {
          const ta = codeEditRef.current
          if (!ta) return
          ta.focus()
          ta.setSelectionRange(localStart, localEnd)
          const lineIndex = ta.value.slice(0, localStart).split('\n').length - 1
          const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20.8
          ta.scrollTop = Math.max(0, lineIndex * lineHeight - ta.clientHeight * 0.35)
          if (codePreRef.current) codePreRef.current.scrollTop = ta.scrollTop
        })
      } else {
        setCodeViewActive(false)
        requestAnimationFrame(jumpInMain)
      }
    } else {
      requestAnimationFrame(jumpInMain)
    }
  }, [mode, codeViewActive, codeBefore, codeContent])

  const jumpToSection = useCallback((section) => {
    focusEditorLine(section.startLine + 1)
  }, [focusEditorLine])

  const jumpToPreviewSection = useCallback((section, sectionIndex) => {
    const preview = markdownPreviewRef.current
    if (!preview) return

    const target = preview.querySelector(`[data-section-index="${sectionIndex}"]`)
    if (!target) return

    const previewRect = preview.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const top = Math.max(0, preview.scrollTop + targetRect.top - previewRect.top - 16)
    preview.scrollTo({ top, behavior: 'smooth' })
  }, [])

  const handleSectionJump = useCallback((section, sectionIndex) => {
    if (mode === 'markdown') {
      jumpToPreviewSection(section, sectionIndex)
      return
    }

    jumpToSection(section)
  }, [mode, jumpToPreviewSection, jumpToSection])

  const focusCurrentSurface = useCallback(() => {
    if (mode === 'markdown') {
      markdownPreviewRef.current?.focus()
      return
    }
    textareaRef.current?.focus()
  }, [mode])

  const getCurrentSectionIndex = useCallback(() => {
    if (!sections.length) return 0

    if (mode === 'markdown') {
      const preview = markdownPreviewRef.current
      if (!preview) return 0
      const headings = [...preview.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      if (!headings.length) return 0
      const previewTop = preview.getBoundingClientRect().top
      let currentIdx = 0
      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top - previewTop <= 48) currentIdx = index
      })
      return currentIdx
    }

    const ta = textareaRef.current
    const currentLine = ta
      ? content.slice(0, ta.selectionStart ?? 0).split('\n').length - 1
      : 0

    let currentIdx = 0
    sections.forEach((section, index) => {
      if (section.startLine <= currentLine) currentIdx = index
    })
    return currentIdx
  }, [content, mode, sections])

  const filteredSections = useMemo(() => {
    const query = outlineQuery.trim().toLowerCase()
    if (!query) return sections
    return sections.filter(section => section.title.toLowerCase().includes(query))
  }, [outlineQuery, sections])

  const closeOutline = useCallback(() => {
    setOutlineOpen(false)
    setOutlineQuery('')
    setOutlineIndex(0)
    requestAnimationFrame(() => focusCurrentSurface())
  }, [focusCurrentSurface])

  const commitOutlineSelection = useCallback((index = outlineIndex) => {
    const section = filteredSections[index]
    if (!section) return
    const sectionIndex = sections.findIndex(candidate =>
      candidate.startLine === section.startLine &&
      candidate.level === section.level &&
      candidate.title === section.title
    )
    setOutlineOpen(false)
    setOutlineQuery('')
    setOutlineIndex(0)
    requestAnimationFrame(() => {
      handleSectionJump(section, Math.max(0, sectionIndex))
      focusCurrentSurface()
    })
  }, [filteredSections, handleSectionJump, outlineIndex, focusCurrentSurface, sections])

  const openOutline = useCallback((step = 0) => {
    if (!sections.length) return
    setOutlineOpen(true)
    setOutlineQuery('')
    setOutlineIndex(prev => {
      const start = outlineOpen ? prev : getCurrentSectionIndex()
      const next = start + step
      return Math.max(0, Math.min(sections.length - 1, next))
    })
  }, [getCurrentSectionIndex, outlineOpen, sections])

  const handlePanelKeyDown = useCallback((e) => {
    if (outlineOpen) return
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      openFind()
    }
  }, [openFind, outlineOpen])

  useEffect(() => {
    setContent(note.content)
    setMode(isOpenApiNote(note) ? 'openapi' : 'edit')
    setConfirmDelete(false)
    setShareState(null)
    setSel({ start: 0, end: 0, text: '' })
    setTxResult(null)
    setCalcResult(null)
    setPendingCalc(null)
    setTableSession(null)
    setCronSession(null)
    setDiagramSession(null)
    setJsonSession(null)
    setSnippetSaveOpen(false)
    setSnippetDraftName('')
    setSnippetSaved(false)
    setSnippetPicker(null)
    setSnippetResults([])
    setSnippetActiveIndex(0)
    setInteractiveTx(null)
    setDisplayHint(null)
    setFindOpen(false)
    setFindQuery('')
    setFindMatchIndex(0)
    setOutlineOpen(false)
    setOutlineQuery('')
    setOutlineIndex(0)
    setCodeViewActive(false)
    clearTimeout(historyTimerRef.current)
    historyRef.current = [note.content]
    historyIdxRef.current = 0
  }, [note.id])

  useEffect(() => {
    setAttachments(getAttachmentsForNote(note.id))
  }, [note.id])

  // Remove attachment rows whose markers were deleted from the content
  useEffect(() => {
    const referenced = new Set(extractMarkerIds(content))
    setAttachments(prev => {
      const orphans = prev.filter(a => !referenced.has(a.id))
      if (!orphans.length) return prev
      orphans.forEach(a => { deleteAttachment(a.id); schedulePersist() })
      return prev.filter(a => referenced.has(a.id))
    })
  }, [content])

  useEffect(() => {
    setFindMatchIndex(0)
  }, [findQuery, findMode])

  useEffect(() => {
    if (!outlineOpen) return
    requestAnimationFrame(() => {
      outlineInputRef.current?.focus()
      outlineInputRef.current?.select()
    })
  }, [outlineOpen])

  useEffect(() => {
    if (!outlineOpen) return
    setOutlineIndex(idx => Math.max(0, Math.min(Math.max(filteredSections.length - 1, 0), idx)))
  }, [filteredSections.length, outlineOpen])

  useEffect(() => {
    if (!outlineOpen) return
    const active = outlineListRef.current?.querySelector(`[data-outline-index="${outlineIndex}"]`)
    active?.scrollIntoView({ block: 'nearest' })
  }, [outlineIndex, outlineOpen])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const handler = (e) => {
      if (!e.shiftKey || e.altKey || !sections.length) return
      e.preventDefault()
      openOutline(e.deltaY > 0 ? 1 : -1)
    }

    panel.addEventListener('wheel', handler, { passive: false })
    return () => panel.removeEventListener('wheel', handler)
  }, [openOutline, sections.length])

  useEffect(() => {
    if (mode !== 'edit') setCodeViewActive(false)
  }, [mode])

  useEffect(() => {
    if (!focusNonce || mode !== 'edit') return
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [focusNonce, mode])

  useEffect(() => {
    if (!restoreLocation || restoreLocation.noteId !== note.id) return
    if (mode !== 'edit') {
      setMode('edit')
      return
    }

    requestAnimationFrame(() => {
      const scrollTop = restoreLocation.scrollTop ?? 0
      if (inlineScrollRef.current) {
        inlineScrollRef.current.scrollTop = scrollTop
      } else {
        const ta = textareaRef.current
        if (!ta) return
        const cursorStart = Math.min(restoreLocation.cursorStart ?? 0, ta.value.length)
        const cursorEnd = Math.min(restoreLocation.cursorEnd ?? cursorStart, ta.value.length)
        ta.focus()
        ta.selectionStart = cursorStart
        ta.selectionEnd = cursorEnd
        ta.scrollTop = scrollTop
        if (lineNumsRef.current) lineNumsRef.current.scrollTop = scrollTop
      }
    })
  }, [restoreLocation, note.id, mode])

  useEffect(() => {
    if (mode !== 'edit') return
    const ta = textareaRef.current
    if (!ta) return

    const syncLineNumbers = () => {
      if (lineNumsRef.current) lineNumsRef.current.scrollTop = ta.scrollTop
    }

    const handler = (e) => {
      if (!e.altKey) return
      e.preventDefault()

      const sc = editorScrollCoastRef.current
      const dir = e.deltaY > 0 ? 1 : -1

      if (dir !== sc.direction) sc.velocity = 0
      sc.direction = dir

      const scrollScale = Math.max(1, ta.scrollHeight / (ta.clientHeight * 3))
      sc.velocity = Math.min(sc.velocity + Math.abs(e.deltaY) * 0.5 * scrollScale, 80 * scrollScale)

      if (!sc.rafId) {
        const coast = () => {
          sc.velocity *= 0.88
          ta.scrollTop += sc.velocity * sc.direction
          syncLineNumbers()
          reportCurrentLocation(ta)
          if (sc.velocity < 0.5) { sc.rafId = null; return }
          sc.rafId = requestAnimationFrame(coast)
        }
        sc.rafId = requestAnimationFrame(coast)
      }
    }

    ta.addEventListener('wheel', handler, { passive: false })
    return () => {
      ta.removeEventListener('wheel', handler)
      const sc = editorScrollCoastRef.current
      if (sc.rafId) { cancelAnimationFrame(sc.rafId); sc.rafId = null }
      sc.velocity = 0
    }
  }, [mode, reportCurrentLocation])

  useEffect(() => {
    if (!snippetPicker?.query) {
      setSnippetResults(snippets.slice(0, 8))
      setSnippetActiveIndex(0)
      return
    }

    let cancelled = false
    const seq = ++snippetSearchSeqRef.current
    const run = async () => {
      const next = onSearchSnippets
        ? await onSearchSnippets(snippetPicker.query)
        : snippets.filter(snippet => snippetLabel(snippet).toLowerCase().includes(snippetPicker.query.toLowerCase()))
      if (cancelled || seq !== snippetSearchSeqRef.current) return
      setSnippetResults(next.slice(0, 8))
      setSnippetActiveIndex(0)
    }

    const timer = setTimeout(run, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [onSearchSnippets, snippetPicker?.query, snippets])

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
    } else {
      setSel({ start: 0, end: 0, text: '' })
    }
    reportCurrentLocation(ta)
  }

  const clearSelIfEmpty = () => {
    const ta = textareaRef.current
    if (!ta) return
    if (ta.selectionStart === ta.selectionEnd) {
      setSel({ start: 0, end: 0, text: '' })
      setTxResult(null)
      setInteractiveTx(null)
      setSnippetSaveOpen(false)
    }
    reportCurrentLocation(ta)
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

  const handlePaste = useCallback(async (e) => {
    const imageItem = [...(e.clipboardData?.items ?? [])].find(item => item.type.startsWith('image/'))
    if (!imageItem) return

    e.preventDefault()
    setPasteError('')

    let processed
    try {
      processed = await processImageFile(imageItem.getAsFile())
    } catch (err) {
      setPasteError(err.message)
      setTimeout(() => setPasteError(''), 4000)
      return
    }

    const id = generateId()
    const attachment = { id, noteId: note.id, mimeType: processed.mimeType, data: processed.dataURL, createdAt: Date.now() }
    insertAttachment(attachment)
    schedulePersist()
    setAttachments(prev => [...prev, attachment])

    const marker = buildMarker(id)
    const ta = textareaRef.current
    const segOff = hasInlineImages ? (inlineSegOffsetRef.current ?? 0) : 0
    const insertAt = ta ? ta.selectionStart + segOff : content.length
    const next = content.slice(0, insertAt) + marker + '\n' + content.slice(insertAt)
    setContent(next)
    onUpdate({ content: next })
    pushHistoryNow(next)
    requestAnimationFrame(() => {
      if (ta) ta.selectionStart = ta.selectionEnd = insertAt + marker.length + 1 - segOff
    })
  }, [content, hasInlineImages, note.id, onUpdate, pushHistoryNow])

  const handleDeleteAttachment = useCallback((id) => {
    deleteAttachment(id)
    schedulePersist()
    setAttachments(prev => prev.filter(a => a.id !== id))

    const marker = buildMarker(id)
    const next = content.replace(marker + '\n', '').replace(marker, '')
    if (next !== content) {
      setContent(next)
      onUpdate({ content: next })
      pushHistoryNow(next)
    }
  }, [content, onUpdate, pushHistoryNow])

  const undo = () => {
    clearTimeout(historyTimerRef.current)
    const idx = historyIdxRef.current
    if (idx <= 0) return
    historyIdxRef.current = idx - 1
    const prev = historyRef.current[idx - 1]
    setContent(prev)
    onUpdate({ content: prev })
    if (codeViewActive) setCodeContent(prev)
  }

  const redo = () => {
    clearTimeout(historyTimerRef.current)
    const idx = historyIdxRef.current
    if (idx >= historyRef.current.length - 1) return
    historyIdxRef.current = idx + 1
    const next = historyRef.current[idx + 1]
    setContent(next)
    onUpdate({ content: next })
    if (codeViewActive) setCodeContent(next)
  }

  // ── Transforms ──────────────────────────────────────────────────────────────
  const runTransform = (id, opName, param = '') => {
    const hasText = sel.text.length > 0
    const inputText = hasText ? sel.text : content
    txRangeRef.current = hasText ? { start: sel.start, end: sel.end } : { start: 0, end: content.length }
    try {
      const result = applyTransform(id, inputText, param)
      setTxResult({ opName, text: result, error: null })
      setCalcResult(null)
    } catch (e) {
      setTxResult({ opName, text: '', error: e.message })
      setCalcResult(null)
    }
  }

  const startInteractive = (id, opName) => {
    const hasText = sel.text.length > 0
    txRangeRef.current = hasText ? { start: sel.start, end: sel.end } : { start: 0, end: content.length }
    setInteractiveTx({ id, opName, param: '' })
    setTxResult(null)
    requestAnimationFrame(() => interactiveInputRef.current?.focus())
  }

  const updateInteractiveParam = (param) => {
    setInteractiveTx(prev => ({ ...prev, param }))
    const hasText = sel.text.length > 0
    const inputText = hasText ? sel.text : content
    try {
      const result = applyTransform(interactiveTx.id, inputText, param)
      setTxResult({ opName: interactiveTx.opName, text: result, error: null })
    } catch (e) {
      setTxResult({ opName: interactiveTx.opName, text: '', error: e.message })
    }
  }

  const dismissInteractive = () => {
    setInteractiveTx(null)
    setTxResult(null)
  }

  const getCurrentLineRange = () => {
    const ta = textareaRef.current
    if (!ta) return { start: 0, end: 0, text: '' }
    const pos = ta.selectionStart
    const lineStart = content.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
    const nextBreak = content.indexOf('\n', pos)
    const lineEnd = nextBreak === -1 ? content.length : nextBreak
    return { start: lineStart, end: lineEnd, text: content.slice(lineStart, lineEnd) }
  }

  const getCalcRange = () => {
    const ta = textareaRef.current
    if (!ta) return { start: 0, end: 0, text: '' }
    if (ta.selectionStart !== ta.selectionEnd) {
      return {
        start: ta.selectionStart,
        end: ta.selectionEnd,
        text: ta.value.slice(ta.selectionStart, ta.selectionEnd),
      }
    }
    return getCurrentLineRange()
  }

  const replaceRange = (start, end, text) => {
    const next = content.slice(0, start) + text + content.slice(end)
    pushHistoryNow(next)
    setContent(next)
    onUpdate({ content: next })
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      const cursor = start + text.length
      ta.focus()
      ta.selectionStart = ta.selectionEnd = cursor
      reportCurrentLocation(ta)
    })
  }

  const openTableMode = () => {
    const ta = textareaRef.current
    const hasSelection = ta && ta.selectionStart !== ta.selectionEnd
    const start = hasSelection ? ta.selectionStart : 0
    const end = hasSelection ? ta.selectionEnd : content.length
    const text = content.slice(start, end)

    try {
      parseCsvTable(text)
      setTableSession({ start, end, text })
      setTxResult(null)
      setCalcResult(null)
      setPendingCalc(null)
      setMode('table')
    } catch (e) {
      setTxResult({ opName: 'Table', text: '', error: e.message })
      setMode('edit')
    }
  }

  const applyTableSession = (csv) => {
    if (!tableSession) return
    replaceRange(tableSession.start, tableSession.end, csv)
    setTableSession(null)
    setDisplayHint('table')
    setMode('edit')
  }

  const openCronMode = () => {
    const ta = textareaRef.current
    const hasSelection = ta && ta.selectionStart !== ta.selectionEnd
    const range = hasSelection
      ? { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) }
      : getCurrentLineRange()
    const text = range.text.trim()
    const useLine = /^\S+(?:\s+\S+){4,5}$/.test(text)
    const session = useLine || hasSelection
      ? range
      : { start: ta?.selectionStart ?? content.length, end: ta?.selectionEnd ?? content.length, text: '' }
    setCronSession(session)
    setTxResult(null)
    setCalcResult(null)
    setPendingCalc(null)
    setMode('cron')
  }

  const applyCronSession = (expression) => {
    if (!cronSession) return
    replaceRange(cronSession.start, cronSession.end, expression)
    setCronSession(null)
    setMode('edit')
  }

  const openDiagramMode = () => {
    const ta = textareaRef.current
    const start = ta?.selectionStart ?? 0
    const end = ta?.selectionEnd ?? 0
    try {
      const session = diagramSessionFromText(content, start, end)
      setDiagramSession(session)
      setTxResult(null)
      setCalcResult(null)
      setPendingCalc(null)
      setMode('diagram')
    } catch (e) {
      setTxResult({ opName: 'Diagram', text: '', error: e.message })
      setMode('edit')
    }
  }

  const applyDiagramSession = (diagram) => {
    if (!diagramSession) return
    replaceRange(diagramSession.start, diagramSession.end, serializeDiagramBlock(diagram))
    setDiagramSession(null)
    setMode('edit')
  }

  const openJsonViewer = (useSelection) => {
    const hasText = sel.text.length > 0
    const text = useSelection && hasText ? sel.text : content
    const start = useSelection && hasText ? sel.start : 0
    const end = useSelection && hasText ? sel.end : content.length
    if (!isValidJson(text)) {
      setTxResult({ opName: 'JSON Viewer', text: '', error: 'Selection is not valid JSON' })
      setJsonSession(null)
      return
    }
    setTxResult(null)
    setCalcResult(null)
    setPendingCalc(null)
    setCodeViewActive(false)
    setJsonSession({
      start,
      end,
      text: text.trim(),
      scopeLabel: useSelection && hasText ? 'Selection' : 'Whole note',
    })
  }

  const applyJsonEdit = (nextJson) => {
    if (!jsonSession) return
    const nextContent = content.slice(0, jsonSession.start) + nextJson + content.slice(jsonSession.end)
    pushHistoryNow(nextContent)
    setContent(nextContent)
    onUpdate({ content: nextContent })
    setJsonSession({
      ...jsonSession,
      text: nextJson,
      end: jsonSession.start + nextJson.length,
    })
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(jsonSession.start, jsonSession.start + nextJson.length)
      reportCurrentLocation(ta)
    })
  }

  const openSnippetSave = useCallback(() => {
    if (!sel.text.trim()) return
    setSnippetDraftName('')
    setSnippetSaveOpen(true)
    setSnippetSaved(false)
    requestAnimationFrame(() => snippetNameInputRef.current?.focus())
  }, [sel.text])

  const saveSnippetSelection = useCallback(async () => {
    if (!sel.text.trim() || !onCreateSnippet) return
    const created = await onCreateSnippet({
      content: sel.text,
      name: snippetDraftName,
      sourceNoteId: note.id,
    })
    if (!created) return
    setSnippetSaved(true)
    setSnippetSaveOpen(false)
    setSnippetDraftName('')
    setTimeout(() => setSnippetSaved(false), 1500)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [note.id, onCreateSnippet, sel.text, snippetDraftName])

  const closeSnippetPicker = useCallback(() => {
    setSnippetPicker(null)
    setSnippetResults([])
    setSnippetActiveIndex(0)
  }, [])

  const replaceRangeInEditor = useCallback((start, end, text) => {
    const next = content.slice(0, start) + text + content.slice(end)
    pushHistoryNow(next)
    setContent(next)
    onUpdate({ content: next })
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      const cursor = start + text.length
      ta.focus()
      ta.selectionStart = ta.selectionEnd = cursor
      setSel({ start: 0, end: 0, text: '' })
      reportCurrentLocation(ta)
    })
  }, [content, onUpdate, reportCurrentLocation])

  const insertSnippet = useCallback((snippet) => {
    if (!snippetPicker) return
    replaceRangeInEditor(snippetPicker.start, snippetPicker.end, snippet.content)
    closeSnippetPicker()
  }, [closeSnippetPicker, replaceRangeInEditor, snippetPicker])

  const runCalculation = ({ complete = false } = {}) => {
    const range = getCalcRange()
    try {
      const result = analyzeCalculation(range.text)
      setTxResult(null)
      const nextCalc = { ...result, start: range.start, end: range.end, sourceText: range.text, error: null }
      setCalcResult(nextCalc)

      if (complete) {
        const replacement = result.mode === 'equals-lines'
          ? result.replacementText
          : `${range.text.replace(/\s*$/, '')}${result.appendText ?? ` = ${result.resultText}`}`
        setPendingCalc({
          ...nextCalc,
          replacementText: replacement,
          previewText: result.mode === 'equals-lines'
            ? replacement
            : result.appendText ?? ` = ${result.resultText}`,
        })
      }
    } catch (e) {
      setTxResult(null)
      setPendingCalc(null)
      setCalcResult({
        title: 'calculation failed',
        expression: range.text,
        resultText: '',
        replacementText: '',
        appendText: null,
        start: range.start,
        end: range.end,
        sourceText: range.text,
        error: e.message,
      })
    }
  }

  const replaceWithCalcResult = () => {
    if (!calcResult || calcResult.error) return
    replaceRange(calcResult.start, calcResult.end, calcResult.replacementText)
    setCalcResult(null)
  }

  const appendCalcResult = () => {
    if (!calcResult || calcResult.error) return
    const addition = calcResult.appendText ?? ` = ${calcResult.resultText}`
    setPendingCalc({
      ...calcResult,
      replacementText: `${calcResult.sourceText.replace(/\s*$/, '')}${addition}`,
      previewText: addition,
    })
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const copyCalcResult = async () => {
    if (!calcResult || calcResult.error) return
    await navigator.clipboard.writeText(calcResult.resultText)
    setCalcCopied(true)
    setTimeout(() => setCalcCopied(false), 1500)
  }

  const acceptPendingCalc = () => {
    if (!pendingCalc) return
    replaceRange(pendingCalc.start, pendingCalc.end, pendingCalc.replacementText)
    setPendingCalc(null)
    setCalcResult(null)
  }

  const cancelPendingCalc = () => {
    setPendingCalc(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
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

  const replaceSelectionWith = (value) => {
    const newContent = content.slice(0, sel.start) + value + content.slice(sel.end)
    pushHistoryNow(newContent)
    setContent(newContent)
    onUpdate({ content: newContent })
    setSel({ start: 0, end: 0, text: '' })
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const applyTxResult = () => {
    const range = txRangeRef.current
    const newContent = content.slice(0, range.start) + txResult.text + content.slice(range.end)
    pushHistoryNow(newContent)
    setContent(newContent)
    onUpdate({ content: newContent })
    setTxResult(null)
    setCalcResult(null)
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
    const target = e.target
    const cursor = target.selectionStart ?? 0
    const trigger = getSnippetTrigger(e.target.value, cursor)
    setPendingCalc(null)
    setContent(e.target.value)
    onUpdate({ content: e.target.value })
    pushHistory(e.target.value)
    if (jsonSession) setJsonSession(null)
    if (trigger) {
      const before = e.target.value.slice(0, trigger.start)
      const lineIndex = before.split('\n').length - 1
      const lineStart = before.lastIndexOf('\n') + 1
      const column = before.length - lineStart
      const lineHeight = parseFloat(getComputedStyle(target).lineHeight) || 20.8
      const charWidth = 7.8
      setSnippetPicker({
        ...trigger,
        top: 24 + lineIndex * lineHeight - target.scrollTop,
        left: 24 + column * charWidth - target.scrollLeft,
      })
    } else if (snippetPicker) {
      closeSnippetPicker()
    }
    reportCurrentLocation(target)
  }

  // Used by InlineImageEditor when a text segment changes; receives the assembled full content
  const handleInlineEditorChange = useCallback((newContent) => {
    setPendingCalc(null)
    if (snippetPicker) closeSnippetPicker()
    setContent(newContent)
    onUpdate({ content: newContent })
    pushHistory(newContent)
    if (jsonSession) setJsonSession(null)
  }, [onUpdate, pushHistory, closeSnippetPicker, snippetPicker, jsonSession])

  const handleKeyDown = (e) => {
    if (snippetPicker) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSnippetActiveIndex(index => Math.min(index + 1, Math.max(0, snippetResults.length - 1)))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSnippetActiveIndex(index => Math.max(index - 1, 0))
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && snippetResults.length) {
        e.preventDefault()
        insertSnippet(snippetResults[snippetActiveIndex] ?? snippetResults[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSnippetPicker()
        return
      }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 's') {
      if (!sel.text.trim()) return
      e.preventDefault()
      openSnippetSave()
      return
    }
    if (pendingCalc && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      acceptPendingCalc()
      return
    }
    if (pendingCalc && e.key === 'Escape') {
      e.preventDefault()
      cancelPendingCalc()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      openFind()
      return
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown') {
      if (sections.length === 0) return
      e.preventDefault()
      const ta = textareaRef.current
      const curLine = ta ? content.slice(0, ta.selectionStart).split('\n').length - 1 : 0
      const next = sections.find(s => s.startLine > curLine)
      if (next) focusEditorLine(next.startLine + 1)
      return
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowUp') {
      if (sections.length === 0) return
      e.preventDefault()
      const ta = textareaRef.current
      const curLine = ta ? content.slice(0, ta.selectionStart).split('\n').length - 1 : 0
      const prev = [...sections].reverse().find(s => s.startLine < curLine)
      if (prev) focusEditorLine(prev.startLine + 1)
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      openGotoLine()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      runCalculation()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      runCalculation({ complete: true })
      return
    }
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
      const segOff = hasInlineImages ? (inlineSegOffsetRef.current ?? 0) : 0
      const start = ta.selectionStart + segOff
      const end = ta.selectionEnd + segOff
      const newVal = content.slice(0, start) + '  ' + content.slice(end)
      setContent(newVal)
      onUpdate({ content: newVal })
      pushHistoryNow(newVal)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 - segOff })
    }
  }

  const enterCodeMode = () => {
    if (codeViewActive) {
      setCodeViewActive(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    const ta = textareaRef.current
    const hasTextSel = ta && ta.selectionStart !== ta.selectionEnd
    if (hasTextSel) {
      // Pure in-place transform: auto-indent only the selected text, no overlay
      const before = content.slice(0, ta.selectionStart)
      const selected = content.slice(ta.selectionStart, ta.selectionEnd)
      const after = content.slice(ta.selectionEnd)
      const formatted = autoIndent(selected)
      if (formatted !== selected) {
        const next = before + formatted + after
        pushHistoryNow(content)
        setContent(next)
        onUpdate({ content: next })
      }
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(before.length, before.length + formatted.length)
      })
      return
    }
    // Whole note: activate syntax-highlighted overlay
    const formatted = autoIndent(content)
    setCodeBefore('')
    setCodeContent(formatted)
    setCodeAfter('')
    if (formatted !== content) {
      pushHistoryNow(content)
      setContent(formatted)
      onUpdate({ content: formatted })
    }
    setCodeViewActive(true)
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
      setCodeViewActive(false)
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
    if (showLineNumbers && lineNumsRef.current) {
      lineNumsRef.current.scrollTop = e.target.scrollTop
    }
  }

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const sharePublicNote = async () => {
    if (!user) { onRequireAuth?.(); return }
    if (!onPublishNote || sharing) return
    setSharing(true)
    setShareState(null)
    try {
      const publishMode = mode !== 'edit' ? mode : displayHint
      const result = await onPublishNote(publishMode)
      if (result?.ok) {
        const absolute = `${window.location.origin}${result.url}`
        try { await navigator.clipboard.writeText(absolute) } catch {}
        setShareState({ ok: true, url: result.url, copied: true })
      } else {
        setShareState({ error: result?.error ?? 'Publish failed' })
      }
    } finally {
      setSharing(false)
    }
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
    if (!codeViewActive) return { codeHighlighted: '', codeLanguage: '' }
    if (!codeContent.trim()) return { codeHighlighted: escapeHtml(codeContent), codeLanguage: '' }
    try {
      const result = hljs.highlightAuto(codeContent, HINT_LANGS)
      return { codeHighlighted: result.value, codeLanguage: result.language ?? '' }
    } catch {
      return { codeHighlighted: escapeHtml(codeContent), codeLanguage: '' }
    }
  }, [codeContent, codeViewActive])

  const markdownHtml = useMemo(() => {
    if (!content.trim()) return ''
    try {
      const rendered = marked.parse(content)
      let nextSectionIndex = 0
      return rendered.replace(/<h([1-6])(\b[^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level, attrs, inner) => {
        const section = sections[nextSectionIndex]
        if (!section || section.level !== Number(level)) return match
        const nextAttrs = attrs?.includes('data-section-index=')
          ? attrs
          : `${attrs ?? ''} data-section-index="${nextSectionIndex}"`
        nextSectionIndex += 1
        return `<h${level}${nextAttrs}>${inner}</h${level}>`
      })
    } catch {
      return ''
    }
  }, [content, sections])

  // Derived scope/term from the raw query (supports "in:code <term>" / "in:text <term>")
  const findParsed = useMemo(() => parseSearchScope(findQuery), [findQuery])

  const findRegexError = useMemo(() => {
    return findMode === 'regex' && findParsed.term.length > 0 && !isValidRegex(findParsed.term)
  }, [findMode, findParsed.term])

  const findResults = useMemo(() => {
    if (!findOpen || findRegexError) return []
    // No results while the user is still completing the "in:…" directive (no space yet)
    const typingDirective = findQuery.toLowerCase().startsWith('in:') && !findQuery.slice(3).includes(' ')
    if (!findParsed.term || typingDirective) return []
    return findMatchesScoped(content, findParsed.term, findParsed.scope, findMode) ?? []
  }, [findOpen, findParsed, findQuery, findMode, findRegexError, content])

  const displayMarkdownHtml = useMemo(() => {
    if (!findOpen || !findParsed.term || findRegexError || !markdownHtml) return markdownHtml
    const wrapText = (text) => {
      try {
        if (findMode === 'exact') {
          const escaped = findParsed.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="find-mark">$1</mark>')
        }
        if (findMode === 'regex') {
          return text.replace(new RegExp(`(${findParsed.term})`, 'gi'), '<mark class="find-mark">$1</mark>')
        }
      } catch {}
      return text
    }
    if (findParsed.scope === 'code') {
      // Only highlight inside <pre><code>…</code></pre> blocks
      return markdownHtml.replace(/(<pre><code[^>]*>)([\s\S]*?)(<\/code><\/pre>)/gi,
        (_, open, body, close) => open + wrapText(body) + close)
    }
    if (findParsed.scope === 'text') {
      // Highlight everywhere except inside <pre><code>…</code></pre> blocks
      return markdownHtml.replace(/(<pre>[\s\S]*?<\/pre>)|(<[^>]+>)|([^<]*)/g, (_, pre, tag, text) => {
        if (pre || tag) return pre ?? tag
        if (!text) return ''
        return wrapText(text)
      })
    }
    // scope === 'all': highlight everywhere
    return markdownHtml.replace(/(<[^>]+>)|([^<]*)/g, (_, tag, text) => {
      if (tag) return tag
      if (!text) return ''
      return wrapText(text)
    })
  }, [markdownHtml, findOpen, findParsed, findMode, findRegexError])

  const sectionMatches = useMemo(() => {
    if (!findOpen || !findResults.length) return []
    return matchesToSections(findResults, sections, content)
  }, [findOpen, findResults, sections, content])

  const looksLikeRequest = useMemo(() => {
    return detectRequestType(content) !== null
  }, [content])

  const looksLikeTable = useMemo(() => {
    const ta = textareaRef.current
    const selected = ta && ta.selectionStart !== ta.selectionEnd
      ? content.slice(ta.selectionStart, ta.selectionEnd)
      : content
    return looksLikeCsvTable(selected)
  }, [content, sel.text])

  const jsonValid = isValidJson(content)
  const selectedJsonValid = isValidJson(sel.text)
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
      if (id === 'oneliner') return /\\\n/.test(t) ? 10 : 0
      if (id === 'dategap')  return parseDates(t).length >= 2 ? 8 : 0
      return 0
    }
    return TRANSFORMS.map(tx => ({ ...tx, score: score(tx.id) }))
  }, [sel.text])

  const dateFmtPopup = useMemo(() => {
    if (!hasSelection) return null
    const date = detectSingleDate(sel.text)
    return date ? getDateFormats(date) : null
  }, [sel.text, hasSelection])

  const tzPopup = useMemo(() => {
    if (!hasSelection) return null
    const result = detectTimeWithZone(sel.text)
    return result ? getTimeConversions(result.utcDate) : null
  }, [sel.text, hasSelection])

  const tsPopup = useMemo(() => {
    if (!hasSelection) return null
    const date = detectTimestamp(sel.text)
    return date ? getTimestampFormats(date) : null
  }, [sel.text, hasSelection])

  return (
    <div ref={panelRef} className="flex flex-col flex-1 min-w-0 overflow-hidden relative" onKeyDown={handlePanelKeyDown}>

      {/* ── Main toolbar ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-zinc-800 shrink-0">
        {jsonValid && (
          <button
            onClick={() => jsonSession ? setJsonSession(null) : openJsonViewer(false)}
            title={jsonSession ? 'Close inline JSON editor' : 'Open inline JSON editor for the whole note'}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] border rounded transition-colors font-mono ${
              jsonSession
                ? 'text-amber-200 bg-amber-900/50 border-amber-700'
                : 'text-amber-400 hover:text-amber-300 bg-amber-950/40 hover:bg-amber-950/70 border-amber-900/50'
            }`}
          >
            <span className="text-[13px] leading-none">{'{}'}</span>
            {jsonSession ? 'Text' : 'JSON'}
          </button>
        )}
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={enterCodeMode}
          title={codeViewActive ? 'Exit code view (Esc)' : 'Syntax-highlighted code view with auto-indent — select text first for a region'}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            codeViewActive
              ? 'text-blue-300 bg-blue-950/50 border-blue-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <span className="text-[12px]">&lt;/&gt;</span>
          {codeViewActive ? 'Edit' : 'Code'}
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
          onMouseDown={e => e.preventDefault()}
          onClick={() => switchMode('sqlite')}
          title="Inspect linked SQLite database"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'sqlite'
              ? 'text-fuchsia-300 bg-fuchsia-950/50 border-fuchsia-800'
              : sqliteAssetRef
                ? 'text-fuchsia-400 hover:text-fuchsia-200 bg-fuchsia-950/20 border-fuchsia-900 hover:border-fuchsia-700'
                : 'text-zinc-800 bg-transparent border-zinc-900 cursor-not-allowed'
          }`}
          disabled={!sqliteAssetRef}
        >
          <span className="text-[12px]">DB</span>
          {mode === 'sqlite' ? 'Edit' : 'SQLite'}
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
        {openApiNote && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => switchMode('openapi')}
            title="OpenAPI document viewer"
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
              mode === 'openapi'
                ? 'text-cyan-300 bg-cyan-950/50 border-cyan-800'
                : 'text-cyan-400 hover:text-cyan-200 bg-cyan-950/20 border-cyan-900 hover:border-cyan-700'
            }`}
          >
            <span className="text-[12px]">API</span>
            {mode === 'openapi' ? 'Edit' : 'OpenAPI'}
          </button>
        )}
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
          onClick={openTableMode}
          title="Open selected CSV or whole note as a table"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'table'
              ? 'text-cyan-300 bg-cyan-950/50 border-cyan-800'
              : looksLikeTable
                ? 'text-cyan-400 hover:text-cyan-200 bg-cyan-950/20 border-cyan-900 hover:border-cyan-700'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          Table
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={openCronMode}
          title="Build a Unix or Azure cron expression"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'cron'
              ? 'text-lime-300 bg-lime-950/50 border-lime-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          Cron
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={openDiagramMode}
          title="Create or edit a lightweight diagram"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'diagram'
              ? 'text-fuchsia-300 bg-fuchsia-950/50 border-fuchsia-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          Diagram
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
          onMouseDown={e => e.preventDefault()}
          onClick={openGotoLine}
          title="Go to line (Ctrl+G)"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            gotoOpen
              ? 'text-blue-300 bg-blue-950/50 border-blue-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          Go
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={findOpen ? closeFind : openFind}
          title="Find in note (Ctrl+F)"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            findOpen
              ? 'text-yellow-300 bg-yellow-950/50 border-yellow-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          Find
        </button>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => runCalculation()}
          title="Calculate selection or current line (Ctrl+=)"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            calcResult
              ? 'text-emerald-300 bg-emerald-950/50 border-emerald-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          Calc
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
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={sharePublicNote}
          disabled={sharing || !content.trim()}
          title="Publish this note and copy a public link"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            shareState?.ok
              ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600 disabled:text-zinc-800 disabled:hover:border-zinc-800'
          }`}
        >
          {sharing ? 'Sharing…' : shareState?.ok ? 'Link copied' : 'Share'}
        </button>
        <div className="ml-auto flex items-center gap-3">
          {shareState?.ok && (
            <a
              href={shareState.url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-emerald-400 hover:text-emerald-300 font-mono"
              onMouseDown={e => e.stopPropagation()}
            >
              {shareState.url}
            </a>
          )}
          {shareState?.error && (
            <span className="text-[11px] text-red-400 font-mono">{shareState.error}</span>
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

      {/* ── Find bar ── */}
      {findOpen && (mode === 'edit' || mode === 'markdown') && (
        <FindBar
          inputRef={findInputRef}
          query={findQuery}
          onQueryChange={q => setFindQuery(q)}
          mode={findMode}
          onModeChange={m => setFindMode(m)}
          matchIndex={findMatchIndex}
          matchCount={findResults.length}
          regexError={findRegexError}
          onNext={() => jumpToFindMatch(findMatchIndex + 1, findResults)}
          onPrev={() => jumpToFindMatch(findMatchIndex - 1, findResults)}
          onClose={closeFind}
          sectionMatches={sectionMatches}
          onJumpToSection={idx => jumpToFindMatch(idx, findResults)}
          scope={findParsed.scope}
        />
      )}

      {/* ── Transform strip ── */}
      {mode === 'edit' && !interactiveTx && (
        <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60 shrink-0 flex flex-wrap gap-1">
          {hasSelection && (
            <span className="text-[10px] text-zinc-600 font-mono shrink-0 self-center mr-0.5">
              {sel.text.length}c
            </span>
          )}
          {selectedJsonValid && (
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => openJsonViewer(true)}
              title="Inspect selected JSON"
              className="px-2 py-0.5 text-[11px] font-mono text-amber-300 hover:text-amber-100 border border-amber-800 hover:border-amber-600 rounded bg-amber-950/30 hover:bg-amber-950/50 transition-colors whitespace-nowrap shrink-0"
            >
              JSON view
            </button>
          )}

          {/* All transforms stay visible; scores only affect emphasis. */}
          {scoredTransforms
            .map(t => (
              <button
                key={t.id}
                onMouseDown={e => e.preventDefault()}
                onClick={() => t.interactive ? startInteractive(t.id, t.title) : runTransform(t.id, t.title)}
                title={t.title}
                className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
                  hasSelection && t.score > 0
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
        </div>
      )}

      {/* ── Date format strip ── */}
      {mode === 'edit' && !interactiveTx && dateFmtPopup && (
        <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/40 shrink-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 self-center mr-0.5">date</span>
          {dateFmtPopup.map(f => (
            <button
              key={f.label}
              onMouseDown={e => e.preventDefault()}
              onClick={() => replaceSelectionWith(f.value)}
              title={f.label}
              className="px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-zinc-100 border border-zinc-700/60 hover:border-zinc-500 rounded bg-transparent hover:bg-zinc-800/60 transition-colors whitespace-nowrap shrink-0"
            >
              {f.value}
            </button>
          ))}
        </div>
      )}

      {/* ── Timezone conversion strip ── */}
      {mode === 'edit' && !interactiveTx && tzPopup && (
        <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/40 shrink-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 self-center mr-0.5">tz</span>
          {tzPopup.map(c => (
            <button
              key={c.abbr}
              onMouseDown={e => e.preventDefault()}
              onClick={() => replaceSelectionWith(c.value)}
              title={c.label}
              className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
                c.isUser
                  ? 'text-amber-300 border-amber-700/60 bg-amber-950/20 hover:bg-amber-950/50 hover:text-amber-100'
                  : 'text-zinc-400 hover:text-zinc-100 border-zinc-700/60 bg-transparent hover:bg-zinc-800/60 hover:border-zinc-500'
              }`}
            >
              {c.value}
            </button>
          ))}
        </div>
      )}

      {/* ── Timestamp conversion strip ── */}
      {mode === 'edit' && !interactiveTx && tsPopup && (
        <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/40 shrink-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 self-center mr-0.5">ts</span>
          {tsPopup.map(f => (
            <button
              key={f.label}
              onMouseDown={e => e.preventDefault()}
              onClick={() => replaceSelectionWith(f.value)}
              title={f.label}
              className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
                f.label === 'relative'
                  ? 'text-sky-400 border-sky-800/60 bg-sky-950/20 hover:bg-sky-950/40 hover:text-sky-200'
                  : 'text-zinc-400 hover:text-zinc-100 border-zinc-700/60 bg-transparent hover:bg-zinc-800/60 hover:border-zinc-500'
              }`}
            >
              {f.value}
            </button>
          ))}
        </div>
      )}

      {mode === 'edit' && gotoOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950/60 shrink-0">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0">
            go to line
          </span>
          <input
            ref={gotoInputRef}
            value={gotoLine}
            onChange={e => { setGotoLine(e.target.value); setGotoError(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') submitGotoLine()
              if (e.key === 'Escape') {
                setGotoOpen(false)
                requestAnimationFrame(() => textareaRef.current?.focus())
              }
            }}
            inputMode="numeric"
            placeholder={`1-${lineCount}`}
            className={`w-24 bg-zinc-800 border rounded px-2.5 py-1 text-sm font-mono text-zinc-200 outline-none transition-colors placeholder-zinc-700 ${
              gotoError ? 'border-red-700 focus:border-red-500' : 'border-zinc-700 focus:border-zinc-500'
            }`}
          />
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={submitGotoLine}
            className="px-2 py-1 text-[11px] font-mono text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded bg-zinc-800 transition-colors"
          >
            go
          </button>
          <span className="text-[11px] text-zinc-700 font-mono">
            {lineCount} lines
          </span>
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              setGotoOpen(false)
              requestAnimationFrame(() => textareaRef.current?.focus())
            }}
            className="ml-auto text-zinc-600 hover:text-zinc-300 transition-colors text-sm leading-none"
            title="Cancel (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      {mode === 'edit' && snippetSaveOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950/60 shrink-0">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0">
            save snippet
          </span>
          <input
            ref={snippetNameInputRef}
            value={snippetDraftName}
            onChange={e => setSnippetDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveSnippetSelection()
              if (e.key === 'Escape') {
                setSnippetSaveOpen(false)
                requestAnimationFrame(() => textareaRef.current?.focus())
              }
            }}
            placeholder="optional name"
            spellCheck={false}
            className="flex-1 bg-zinc-800 border border-zinc-700 focus:border-zinc-500 rounded px-2.5 py-1 text-sm font-mono text-zinc-200 outline-none transition-colors placeholder-zinc-700"
          />
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={saveSnippetSelection}
            className="px-2 py-1 text-[11px] font-mono text-zinc-300 hover:text-zinc-100 border border-zinc-700 hover:border-zinc-500 rounded bg-zinc-800 transition-colors"
          >
            save
          </button>
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              setSnippetSaveOpen(false)
              requestAnimationFrame(() => textareaRef.current?.focus())
            }}
            className="text-zinc-600 hover:text-zinc-300 transition-colors text-sm leading-none shrink-0"
            title="Cancel"
          >
            âœ•
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

      {/* ── Section navigation bar ── */}
      {sections.length > 0 && (mode === 'edit' || mode === 'markdown') && (
        <div
          className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800/50 bg-zinc-950/30 shrink-0 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {sections.map((section, i) => (
            <button
              key={i}
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleSectionJump(section, i)}
              title={section.title}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-zinc-700 hover:text-zinc-300 border border-zinc-800/80 hover:border-zinc-600 rounded bg-transparent hover:bg-zinc-800/40 transition-colors whitespace-nowrap shrink-0"
            >
              <span className="text-zinc-800">{'#'.repeat(section.level)}</span>
              <span>{section.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Content area ── */}
      {mode === 'edit' && (
        <div className="flex flex-1 overflow-hidden">
          {hasInlineImages && !jsonSession && !codeViewActive ? (
            <InlineImageEditor
              content={content}
              attachmentMap={attachmentMap}
              onChangeContent={handleInlineEditorChange}
              onDeleteAttachment={handleDeleteAttachment}
              showLineNumbers={showLineNumbers}
              scrollRef={inlineScrollRef}
              onActiveSegment={(el, offset) => {
                textareaRef.current = el
                inlineSegOffsetRef.current = offset
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onSelect={updateSel}
              onMouseUp={updateSel}
              onKeyUp={updateSel}
              onClick={clearSelIfEmpty}
            />
          ) : (
          <>
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
          {!codeViewActive ? (
            <div className="flex flex-1 min-w-0 overflow-hidden">
              {jsonSession ? (
                <div className="flex-1 min-w-0 overflow-auto p-4">
                  <JsonBlockViewer
                    rawJson={jsonSession.text}
                    scopeLabel={jsonSession.scopeLabel}
                    onChangeJson={applyJsonEdit}
                    onClose={() => setJsonSession(null)}
                  />
                </div>
              ) : (
              <div className="relative flex-1 min-w-0 overflow-hidden">
              <textarea
                ref={textareaRef}
                value={editorDisplayContent}
                onChange={openApiNote ? undefined : handleContent}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onSelect={updateSel}
                onMouseUp={updateSel}
                onKeyUp={updateSel}
                onClick={clearSelIfEmpty}
                onScroll={e => {
                  if (showLineNumbers && lineNumsRef.current) lineNumsRef.current.scrollTop = e.target.scrollTop
                  reportCurrentLocation(e.target)
                }}
                placeholder={openApiNote ? 'OpenAPI document JSON' : 'Start typing…'}
                readOnly={openApiNote}
                spellCheck={false}
                className="absolute inset-0 w-full h-full bg-transparent text-zinc-300 note-content p-4 resize-none outline-none placeholder-zinc-800 overflow-y-auto"
              />
              {pendingCalc && pendingCalcInline?.visible && (
                <div
                  className="absolute z-10 pointer-events-none flex items-start gap-2"
                  style={{
                    top: `${pendingCalcInline.top}px`,
                    left: `${Math.max(16, pendingCalcInline.left)}px`,
                    maxWidth: 'calc(100% - 32px)',
                  }}
                >
                  <pre className="note-content text-[13px] text-emerald-200 bg-emerald-950/80 border border-emerald-800/70 rounded px-1.5 py-0.5 whitespace-pre-wrap m-0 shadow-lg shadow-black/30">
                    {pendingCalc.previewText}
                  </pre>
                  <span className="mt-0.5 shrink-0 text-[10px] font-mono text-emerald-500 bg-zinc-950/90 border border-emerald-900/70 rounded px-1.5 py-0.5">
                    Enter accept · Esc cancel
                  </span>
                </div>
              )}
              {snippetPicker && (
                <div
                  className="absolute z-20 w-80 max-w-[calc(100%-32px)]"
                  style={{
                    top: `${Math.max(16, snippetPicker.top + 24)}px`,
                    left: `${Math.max(16, snippetPicker.left)}px`,
                  }}
                >
                  <div className="rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-2xl shadow-black/40 overflow-hidden">
                    <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 flex items-center gap-2">
                      <span className="text-[10px] text-zinc-600 font-mono">snippets</span>
                      <span className="text-[11px] text-zinc-500 font-mono truncate min-w-0">!{snippetPicker.query}</span>
                      {snippetSaved && <span className="ml-auto text-[10px] text-emerald-400 font-mono">saved</span>}
                    </div>
                    <div className="max-h-72 overflow-auto">
                      {snippetResults.length ? snippetResults.map((snippet, index) => (
                        <button
                          key={snippet.id}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => insertSnippet(snippet)}
                          className={`w-full text-left px-3 py-2 border-b border-zinc-900/80 transition-colors ${
                            index === snippetActiveIndex ? 'bg-zinc-800/80' : 'bg-transparent hover:bg-zinc-900/80'
                          }`}
                        >
                          <div className="text-[12px] text-zinc-200 font-mono truncate">{snippetLabel(snippet)}</div>
                          <div className="text-[11px] text-zinc-500 note-content whitespace-pre-wrap line-clamp-2">
                            {snippet.content}
                          </div>
                        </button>
                      )) : (
                        <div className="px-3 py-2 text-[11px] text-zinc-500 font-mono">no snippets</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              </div>
              )}
            </div>
          ) : (
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
          )}
        </>
        )}
        </div>
      )}

      {/* ── Paste error ── */}
      {pasteError && (
        <div className="shrink-0 px-4 py-1.5 text-[11px] font-mono text-red-400 bg-red-950/30 border-t border-red-900/40">
          {pasteError}
        </div>
      )}

      {mode === 'markdown' && (
        <div ref={markdownPreviewRef} tabIndex={-1} className="flex-1 overflow-auto p-5 outline-none">
          {displayMarkdownHtml ? (
            <div className="md-prose max-w-none" dangerouslySetInnerHTML={{ __html: displayMarkdownHtml }} />
          ) : (
            <span className="text-zinc-700 note-content text-sm">empty</span>
          )}
        </div>
      )}
      {mode === 'sqlite' && (
        sqliteAssetRef ? (
          <SQLiteViewer assetId={sqliteAssetRef.assetId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[12px] font-mono text-zinc-600">
            No SQLite asset is linked to this note.
          </div>
        )
      )}
      {mode === 'openapi' && (
        <OpenApiViewer
          note={note}
          onCopyRequestToNewNote={(requestText) => onCreateNoteFromContent?.(requestText)}
        />
      )}
      {outlineOpen && (
        <div className="absolute inset-0 z-40 bg-black/45 backdrop-blur-[1px] flex items-start justify-center px-4 py-10">
          <div className="w-full max-w-2xl max-h-[70vh] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/98 shadow-2xl shadow-black/50">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
              <div className="min-w-0">
                <div className="text-[11px] font-mono text-zinc-400">document outline</div>
                <div className="text-[10px] font-mono text-zinc-600">shift+wheel moves · enter jumps · esc closes</div>
              </div>
              <div className="ml-auto text-[10px] font-mono text-zinc-600">{filteredSections.length}/{sections.length}</div>
            </div>
            <div className="px-4 py-3 border-b border-zinc-900">
              <input
                ref={outlineInputRef}
                value={outlineQuery}
                onChange={e => { setOutlineQuery(e.target.value); setOutlineIndex(0) }}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    closeOutline()
                    return
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setOutlineIndex(idx => Math.min(idx + 1, Math.max(filteredSections.length - 1, 0)))
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setOutlineIndex(idx => Math.max(idx - 1, 0))
                    return
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitOutlineSelection()
                  }
                }}
                placeholder="Filter headings..."
                spellCheck={false}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-zinc-200 outline-none transition-colors placeholder-zinc-600 focus:border-zinc-500"
              />
            </div>
            <div ref={outlineListRef} className="max-h-[52vh] overflow-auto px-2 py-2">
              {filteredSections.length ? filteredSections.map((section, index) => (
                <button
                  key={`${section.startLine}-${section.title}`}
                  data-outline-index={index}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => commitOutlineSelection(index)}
                  className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                    index === outlineIndex
                      ? 'bg-blue-950/50 border border-blue-800/80'
                      : 'border border-transparent hover:bg-zinc-900/80'
                  }`}
                  style={{ paddingLeft: `${12 + section.level * 14}px` }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-zinc-600 shrink-0">{'#'.repeat(section.level)}</span>
                    <span className="min-w-0 truncate text-sm text-zinc-200 note-content">{section.title}</span>
                    <span className="ml-auto shrink-0 text-[10px] font-mono text-zinc-600">L{section.startLine + 1}</span>
                  </div>
                </button>
              )) : (
                <div className="px-3 py-6 text-center text-[11px] font-mono text-zinc-500">no matching headings</div>
              )}
            </div>
          </div>
        </div>
      )}
      {mode === 'table' && tableSession && (
        <TableViewer
          csvText={tableSession.text}
          onApply={applyTableSession}
          onCancel={() => { setTableSession(null); setMode('edit') }}
        />
      )}
      {mode === 'cron' && cronSession && (
        <CronBuilder
          initialExpression={cronSession.text}
          onApply={applyCronSession}
          onCancel={() => { setCronSession(null); setMode('edit') }}
        />
      )}
      {mode === 'diagram' && diagramSession && (
        <DiagramEditor
          initialDiagram={diagramSession.diagram}
          onApply={applyDiagramSession}
          onCancel={() => { setDiagramSession(null); setMode('edit') }}
        />
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
          onCopyRequestToNewNote={(request) => onCreateNoteFromContent?.(
            `${request.method} ${request.url}${Object.keys(request.headers ?? {}).length ? '\n' : ''}${
              Object.entries(request.headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n')
            }${request.body ? `\n\n${request.body}` : ''}`
          )}
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

      {/* ── Calculation result panel ── */}
      {calcResult && mode === 'edit' && (
        <div className="border-t border-zinc-700 bg-zinc-900/80 shrink-0 flex flex-col max-h-64">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800">
            <span className="text-[11px] text-zinc-500 font-mono">Calc</span>
            <span className={`text-[11px] font-mono ${calcResult.error ? 'text-red-400' : 'text-emerald-500'}`}>
              {calcResult.error ? calcResult.error : calcResult.title}
            </span>
            {!calcResult.error && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyCalcResult}
                  className="px-2 py-0.5 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded bg-zinc-800 transition-colors"
                >
                  {calcCopied ? '✓ copied' : 'copy'}
                </button>
                <button
                  onClick={replaceWithCalcResult}
                  className="px-2 py-0.5 text-[11px] font-mono text-green-400 hover:text-green-300 border border-green-900 hover:border-green-700 rounded bg-green-950/40 transition-colors"
                >
                  {calcResult.mode === 'equals-lines' ? 'complete lines' : 'replace'}
                </button>
                {calcResult.mode !== 'equals-lines' && (
                  <button
                    onClick={appendCalcResult}
                    className="px-2 py-0.5 text-[11px] font-mono text-sky-400 hover:text-sky-300 border border-sky-900 hover:border-sky-700 rounded bg-sky-950/40 transition-colors"
                  >
                    append
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() => setCalcResult(null)}
              className="ml-auto text-zinc-600 hover:text-zinc-300 transition-colors text-sm leading-none"
            >
              ✕
            </button>
          </div>
          {!calcResult.error && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 p-3 overflow-auto">
              <pre className="note-content text-[12px] text-zinc-500 whitespace-pre-wrap overflow-auto m-0">
                {calcResult.expression}
              </pre>
              <span className="text-zinc-700 font-mono text-xs pt-1">=</span>
              <pre className="note-content text-[12px] text-zinc-200 whitespace-pre-wrap overflow-auto m-0">
                {calcResult.resultText}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      {mode !== 'regex' && mode !== 'http' && mode !== 'diff' && mode !== 'table' && mode !== 'cron' && mode !== 'diagram' && (
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-1.5 flex-wrap shrink-0 min-h-[36px]">
            {note.categories.length > 0
              ? note.categories.map(c => <CategoryBadge key={c} category={c} />)
              : <span className="text-[11px] text-zinc-700">{aiEnabled ? 'Server AI search is enabled for this account' : 'Sign in to use server AI features'}</span>
            }
          <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-700 shrink-0">
            {codeViewActive && <span className="text-blue-600 font-mono">Esc to exit code view</span>}
            {codeViewActive && codeLanguage && <span className="text-zinc-500 font-mono">{codeLanguage}</span>}
            {mode === 'markdown' && <span className="text-emerald-700 font-mono">markdown</span>}
            <span>{lineCount}L · {charCount}C</span>
            <span>{timeAgo(note.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
