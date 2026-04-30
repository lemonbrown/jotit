import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import { hljs, HINT_LANGS, normalizeCodeLanguage, detectPreferredCodeLanguage, shouldAutoIndentForLanguage } from '../utils/highlight'
import { isCodeOutlineLanguage, parseCodeSymbols, buildCollapsedCodeView } from '../utils/codeSymbols'

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
import { TRANSFORMS, applyTransform, parseDates, detectDateTimeInstant, getDateTimeCommandOptions } from '../utils/transforms'
import { analyzeCalculation } from '../utils/calculator'
import { parseCsvTable, looksLikeCsvTable } from '../utils/csvTable'
import { diagramSessionFromText, serializeDiagramBlock } from '../utils/diagram'
import { detectRequestType } from '../utils/httpParser'
import { hasShellBlocks } from '../utils/shellParser'
import CategoryBadge from './CategoryBadge'
import FindBar from './FindBar'
import { findMatches, isValidRegex, parseSearchScope, findMatchesScoped, applyReplaceAll } from '../utils/inNoteSearch'
import { parseSections, matchesToSections } from '../utils/parseNoteSections'
import RegexTester from './RegexTester'
import HttpRunner from './HttpRunner'
import ShellRunner from './ShellRunner'
import DiffViewer from './DiffViewer'
import TableViewer from './TableViewer'
import CronBuilder from './CronBuilder'
import DiagramEditor from './DiagramEditor'
import JsonBlockViewer from './JsonBlockViewer'
import InlineImageEditor from './InlineImageEditor'
import SQLiteViewer from './SQLiteViewer'
import OpenApiViewer from './OpenApiViewer'
import NoteScrollMap from './NoteScrollMap'
import { extractSQLiteAssetRef } from '../utils/sqliteNote'
import { NOTE_TYPE_OPENAPI, getPublicCloneInfo, isOpenApiNote } from '../utils/noteTypes'
import { getStoredKeyPair } from '../utils/e2eEncryption'
import { useScrollMap } from '../hooks/useScrollMap'
import { useNoteEditorHistory } from '../hooks/useNoteEditorHistory'
import { useNoteSelection } from '../hooks/useNoteSelection'
import { useNoteMode } from '../hooks/useNoteMode'
import SecretAlert from './SecretAlert'
import { runJsInWorker } from '../utils/jsRunner'
import { NOW_COMMAND, formatCurrentDateTime, getInlineCommandRange } from '../utils/noteCommands'
import { getGitCommandSuggestions, getGitCommandTrigger, parseGitCommand, parsePrCommand, formatGitCommandResult } from '../utils/gitCommands'
import { connectGitRepo, getGitDiff, getGitPR, getGitStatus, listGitRepos, useGitRepo } from '../utils/gitClient'
import GitPRView from './GitPRView'
import { streamLLMChat } from '../utils/llmClient'
import { matchTemplates, expandTemplate, parseTemplateQuery } from '../utils/noteTemplates'
import { escapeHtml } from '../utils/escapeHtml'
import { useSnippetPicker } from '../hooks/useSnippetPicker'

const CODE_LINE_HEIGHT = '1.6'
const HELP_COMMAND = '/tips'
const HELP_NOTE_CONTENT = `jot.it quick start

Useful habits
- Press Alt+N to create a note quickly.
- Use Ctrl+F to search the current collection.
- Create collections for projects, clients, investigations, or recurring work.
- Drag notes from the notes pane into a collection drop target to organize them.
- Use Ctrl+Alt+Up and Ctrl+Alt+Down to switch collections.

Writing notes
- Start with a clear first line. Jot.it uses it like the note title.
- Use markdown headings to create an outline.
- Paste images directly into notes when screenshots help.
- Save reusable text as snippets with Alt+S after selecting text.

Working with technical text
- Write HTTP requests directly in a note, then use the HTTP tool to run them.
- Import OpenAPI JSON to browse operations and generate requests.
- Drop SQLite files into Jot.it to inspect tables and run read-only queries.
- Select JSON, Base64, URLs, JWTs, timestamps, or hex text and use the transform tools.

Search and navigation
- Search is local-first. Signed-in users can use server-backed semantic search when available.
- Use Alt+Left and Alt+Right to move through note locations.
- Use Shift+Mouse wheel over the notes pane for expanded previews.

Tip
Keep this note around as a reference, or delete it once the shortcuts feel familiar.`


let _scratchBlockIdx = 0

const mdRenderer = new marked.Renderer()
mdRenderer.code = ({ text, lang }) => {
  if (lang === 'csv') {
    try {
      const { headers, rows } = parseCsvTable(text)
      const headerCells = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')
      const bodyRows = rows.map(row =>
        `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
      ).join('')
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`
    } catch { /* fall through to code block */ }
  }
  let highlighted = ''
  const normalizedLang = normalizeCodeLanguage(lang)
  if (normalizedLang && hljs.getLanguage(normalizedLang)) {
    try { highlighted = hljs.highlight(text, { language: normalizedLang }).value } catch {}
  }
  if (!highlighted) {
    const preferred = detectPreferredCodeLanguage(text)
    if (preferred && hljs.getLanguage(preferred)) {
      try { highlighted = hljs.highlight(text, { language: preferred }).value } catch {}
    }
  }
  if (!highlighted) {
    try { highlighted = hljs.highlightAuto(text, HINT_LANGS).value } catch {}
  }
  if (!highlighted) highlighted = escapeHtml(text)
  const cls = normalizedLang ? `hljs language-${normalizedLang}` : 'hljs'
  if (normalizedLang === 'javascript' || normalizedLang === 'typescript') {
    const scratchId = `scratch-${_scratchBlockIdx++}`
    return [
      `<div class="jotit-scratch-block">`,
      `<div class="jotit-scratch-pre-wrap">`,
      `<button class="jotit-run-btn" data-scratch-id="${scratchId}">&#9654; Run</button>`,
      `<pre><code class="${cls}">${highlighted}</code></pre>`,
      `</div>`,
      `<div class="jotit-scratch-output" data-scratch-id="${scratchId}"></div>`,
      `</div>`,
    ].join('')
  }
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

function isRunnableCommandLine(line) {
  const text = String(line ?? '').trim()
  const gitCommand = parseGitCommand(text)
  if (gitCommand) {
    if (gitCommand.command === 'help') return false
    if (gitCommand.command === 'unknown') return false
    if (gitCommand.command === 'connect') return Boolean(gitCommand.path)
    if (gitCommand.command === 'use') return Boolean(gitCommand.repoId)
    if (gitCommand.command === 'pr-view') return Boolean(gitCommand.number)
    return true
  }

  const prCommand = parsePrCommand(text)
  return Boolean(prCommand && prCommand.command !== 'unknown')
}

function ScratchOutput({ output }) {
  if (!output) return null
  const { status, logs, result, error } = output
  if (!logs.length && status !== 'running' && result === undefined && !error) return null
  return (
    <div className="mt-1 mb-3 rounded border border-zinc-700/60 bg-zinc-950 text-[11.5px] font-mono overflow-hidden">
      {status === 'running' && !logs.length && (
        <div className="px-3 py-2 text-zinc-500">running…</div>
      )}
      {logs.map((line, i) => (
        <div key={i} className="px-3 py-[3px] text-zinc-300 leading-relaxed border-b border-zinc-800/40 last:border-0 whitespace-pre-wrap break-all">{line}</div>
      ))}
      {status === 'done' && result !== undefined && (
        <div className="px-3 py-2 text-emerald-400 border-t border-zinc-800/60 whitespace-pre-wrap break-all">→ {result}</div>
      )}
      {status === 'done' && result === undefined && !logs.length && (
        <div className="px-3 py-2 text-zinc-600">→ (no output)</div>
      )}
      {status === 'error' && (
        <div className="px-3 py-2 text-red-400 border-t border-zinc-800/60 whitespace-pre-wrap break-all">✕ {error}</div>
      )}
    </div>
  )
}

export default function NotePanel({ note, collection = null, bucketName = '', snippets = [], templates = [], aiEnabled, user, onRequireAuth, onUpdate, onDelete, onRemoveFromServer, onCreateSnippet, onSearchSnippets, onPublishNote, onToggleCollectionExcluded, onCreateNoteFromContent, onCreateOpenApiNote, onCreateTipsNote, tipsCreated = false, focusNonce, restoreLocation, onLocationChange, notes, searchQuery, simpleEditor = false, hideCommandToolbars = false, onDiffModeChange, onReplaceInNotes, secretScanEnabled = false, llmEnabled = false, ollamaModel = '', agentToken = '', onOpenNibPane, onNibContextChange, isPinned = false, onTogglePin }) {
  const [content, setContent] = useState(note.content)
  const [gitPRData, setGitPRData] = useState(null)
  const [gitPRViewRef, setGitPRViewRef] = useState(note.noteData?.gitPRView ?? null)
  const [gitPRLoading, setGitPRLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRemoveServer, setConfirmRemoveServer] = useState(false)
  const [removingFromServer, setRemovingFromServer] = useState(false)
  const [removeServerResult, setRemoveServerResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [publishSecretMatches, setPublishSecretMatches] = useState(null)
  const [regexInstance, setRegexInstance] = useState(0)
  const [codeViewActive, setCodeViewActive] = useState(false)
  const [codeViewScratchOutput, setCodeViewScratchOutput] = useState(null)

  const [hasE2EKeys, setHasE2EKeys] = useState(false)
  const [codeSymbolsOpen, setCodeSymbolsOpen] = useState(false)
  const [codeCollapsedIds, setCodeCollapsedIds] = useState({})

  useEffect(() => {
    if (user) getStoredKeyPair().then(kp => setHasE2EKeys(!!kp))
  }, [user])
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
  const [displayHint, setDisplayHint] = useState(null) // 'table' | 'code' | null — persists after apply for sharing

  const isInPublicCollection = Boolean(collection?.isPublic)
  const publicCloneInfo = getPublicCloneInfo(note)
  const collectionPublicUrl = isInPublicCollection && bucketName
    ? `/b/${bucketName}/${String(collection?.name ?? '')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')}`
    : ''

  const textareaRef = useRef(null)
  const gitPRLoadRequestRef = useRef(0)
  const searchBackdropRef = useRef(null)
  const codeEditRef = useRef(null)
  const codePreRef = useRef(null)
  const interactiveInputRef = useRef(null)
  const gotoInputRef = useRef(null)
  const snippetNameInputRef = useRef(null)
  const editorScrollCoastRef = useRef({ velocity: 0, direction: 1, rafId: null })
  const capturedSelectionRef = useRef('')
  const capturedHttpSelRef = useRef('')
  const capturedShellSelRef = useRef('')
  const capturedDiffARef = useRef('')
  const capturedDiffBRef = useRef('')
  const txRangeRef = useRef({ start: 0, end: 0 })
  const [httpInstance, setHttpInstance] = useState(0)
  const [shellInstance, setShellInstance] = useState(0)
  const [shellRunTrigger, setShellRunTrigger] = useState(0)
  const [showLineNumbers, setShowLineNumbers] = useState(() => localStorage.getItem('jotit_lnums') !== 'false')
  const [showMinimap, setShowMinimap] = useState(() => localStorage.getItem('jotit_minimap') === 'true')
  const handleAskNib = useCallback(({ request, pattern, flags, testStr, matchCount }) => {
    onOpenNibPane?.({
      noteId: note.id,
      initialMessage: request,
      regexContext: { pattern, flags, testStr, matchCount },
      selectionText: '',
      selectionRange: { start: 0, end: 0 },
    })
  }, [note.id, onOpenNibPane])

  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findMode, setFindMode] = useState('exact')
  const [findMatchIndex, setFindMatchIndex] = useState(0)
  const [showReplace, setShowReplace] = useState(false)
  const [replaceQuery, setReplaceQuery] = useState('')
  const [replaceScope, setReplaceScope] = useState('note')
  const [replaceCount, setReplaceCount] = useState(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineQuery, setOutlineQuery] = useState('')
  const [outlineIndex, setOutlineIndex] = useState(0)
  const [attachments, setAttachments] = useState([])
  const [pasteError, setPasteError] = useState('')
  const [scratchOutputs, setScratchOutputs] = useState({})
  const [scratchPortals, setScratchPortals] = useState([])
  const [sessionGitRepoId, setSessionGitRepoId] = useState(null)
  const [gitPicker, setGitPicker] = useState(null)
  const [gitActiveIndex, setGitActiveIndex] = useState(0)
  const [knownGitRepos, setKnownGitRepos] = useState([])
  const [enterCommandHint, setEnterCommandHint] = useState(null)

  const lineNumsRef = useRef(null)
  const findInputRef = useRef(null)
  const replaceInputRef = useRef(null)
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
  const helpCommandReady = !openApiNote && content.trim() === HELP_COMMAND
  const charCount = editorDisplayContent.length
  const lineCount = editorDisplayContent.split('\n').length
  const {
    snippetPicker,
    setSnippetPicker,
    snippetResults,
    setSnippetResults,
    templateResults,
    setTemplateResults,
    snippetActiveIndex,
    setSnippetActiveIndex,
    tabStops,
    setTabStops,
    closeSnippetPicker,
    advanceTabStop,
  } = useSnippetPicker({
    textareaRef,
  })
  const {
    mode,
    setMode,
    diffCapture,
    setDiffCapture,
    diffInstance,
    setDiffInstance,
    diffPendingNote,
    setDiffPendingNote,
    codeBefore,
    setCodeBefore,
    codeAfter,
    setCodeAfter,
  } = useNoteMode({ onDiffModeChange })

  const minimapEnabled = showMinimap && mode === 'edit' && !jsonSession && !hasInlineImages
  const activeEditorRef = codeViewActive ? codeEditRef : textareaRef
  const scrollMap = useScrollMap(activeEditorRef, content, minimapEnabled)
  const reportCurrentLocation = useCallback((target = textareaRef.current) => {
    if (!target) return
    onLocationChange?.({
      noteId: note.id,
      cursorStart: target.selectionStart ?? 0,
      cursorEnd: target.selectionEnd ?? target.selectionStart ?? 0,
      scrollTop: target.scrollTop ?? 0,
    })
  }, [note.id, onLocationChange])
  const {
    sel,
    setSel,
    txResult,
    setTxResult,
    txCopied,
    setTxCopied,
    calcResult,
    setCalcResult,
    pendingCalc,
    setPendingCalc,
    calcCopied,
    setCalcCopied,
    interactiveTx,
    setInteractiveTx,
    guidCopied,
    setGuidCopied,
    nowInserted,
    setNowInserted,
    resetSelectionState,
    updateSel,
    clearSelIfEmpty,
  } = useNoteSelection({
    textareaRef,
    reportCurrentLocation,
    setSnippetSaveOpen,
  })
  const {
    pushHistory,
    pushHistoryNow,
    resetHistory,
    undo,
    redo,
  } = useNoteEditorHistory({
    initialContent: note.content,
    setContent,
    onUpdate,
    codeViewActive,
    setCodeContent,
  })

  const gitSuggestions = useMemo(
    () => gitPicker ? getGitCommandSuggestions(gitPicker.query, knownGitRepos) : [],
    [gitPicker, knownGitRepos]
  )

  const linkedGitRepo = useMemo(() => {
    if (!note.git?.repoId) return null
    const repo = knownGitRepos.find(item => item.id === note.git.repoId)
    return repo ?? {
      id: note.git.repoId,
      displayName: note.git.repoId,
      baseBranch: note.git.baseBranch,
    }
  }, [knownGitRepos, note.git])

  useEffect(() => {
    if (!gitPicker || !agentToken?.trim()) return
    let cancelled = false
    listGitRepos(agentToken)
      .then(data => {
        if (!cancelled) setKnownGitRepos(data.repos ?? [])
      })
      .catch(() => {
        if (!cancelled) setKnownGitRepos([])
      })
    return () => { cancelled = true }
  }, [agentToken, gitPicker])

  useEffect(() => {
    if (!note.git?.repoId || !agentToken?.trim()) return
    if (knownGitRepos.some(repo => repo.id === note.git.repoId)) return

    let cancelled = false
    listGitRepos(agentToken)
      .then(data => {
        if (!cancelled) setKnownGitRepos(data.repos ?? [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [agentToken, knownGitRepos, note.git?.repoId])

  useEffect(() => {
    onNibContextChange?.({
      noteId: note.id,
      selectionText: sel.text,
      selectionRange: { start: sel.start, end: sel.end },
    })
  }, [note.id, onNibContextChange, sel.end, sel.start, sel.text])

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

  const focusEditorLine = useCallback((lineNumber) => {
    const ta = codeViewActive ? codeEditRef.current : textareaRef.current
    if (!ta) return

    const clampedLine = Math.min(Math.max(lineNumber, 1), lineCount)
    const activeText = codeViewActive ? ta.value : content
    let pos = 0
    for (let line = 1; line < clampedLine; line++) {
      const nextBreak = activeText.indexOf('\n', pos)
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
  }, [codeViewActive, content, lineCount, reportCurrentLocation])

  const updateEnterCommandHint = useCallback((target = textareaRef.current, value = content) => {
    if (!target || openApiNote || target.selectionStart !== target.selectionEnd) {
      setEnterCommandHint(null)
      return
    }

    const cursor = target.selectionStart ?? 0
    const lineStart = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
    const nextBreak = value.indexOf('\n', cursor)
    const lineEnd = nextBreak === -1 ? value.length : nextBreak
    const line = value.slice(lineStart, lineEnd).trim()
    if (!isRunnableCommandLine(line)) {
      setEnterCommandHint(null)
      return
    }

    const before = value.slice(0, lineStart)
    const lineIndex = before.split('\n').length - 1
    const column = Math.max(0, cursor - lineStart)
    const lineHeight = parseFloat(getComputedStyle(target).lineHeight) || 20.8
    const charWidth = 7.8

    setEnterCommandHint({
      label: `Enter runs ${line}`,
      top: 24 + lineIndex * lineHeight - target.scrollTop,
      left: 24 + column * charWidth - target.scrollLeft,
    })
  }, [content, openApiNote])

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
    if (sel.text && !sel.text.includes('\n')) setFindQuery(sel.text)
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [sel.text])

  const openFindReplace = useCallback(() => {
    if (sel.text && !sel.text.includes('\n')) setFindQuery(sel.text)
    setFindOpen(true)
    setShowReplace(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [sel.text])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setShowReplace(false)
    setReplaceCount(null)
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

  const runScratch = useCallback((scratchId, code) => {
    setScratchOutputs(prev => ({
      ...prev,
      [scratchId]: { status: 'running', logs: [], result: undefined, error: undefined },
    }))
    const snapshot = {
      notes: (notes ?? []).map(n => ({ id: n.id, content: n.content ?? '' })),
      currentNote: { id: note.id, content: note.content ?? '' },
    }
    runJsInWorker(code, snapshot, (msg) => {
      if (msg.type === 'log') {
        setScratchOutputs(prev => {
          const cur = prev[scratchId] ?? { status: 'running', logs: [], result: undefined, error: undefined }
          return { ...prev, [scratchId]: { ...cur, logs: [...cur.logs, msg.line] } }
        })
      } else if (msg.type === 'done') {
        setScratchOutputs(prev => ({ ...prev, [scratchId]: { ...prev[scratchId], status: 'done', result: msg.result } }))
      } else if (msg.type === 'error') {
        setScratchOutputs(prev => ({ ...prev, [scratchId]: { ...prev[scratchId], status: 'error', error: msg.message } }))
      }
    })
  }, [notes, note.id, note.content])

  const runCodeViewScratch = useCallback(() => {
    setCodeViewScratchOutput({ status: 'running', logs: [], result: undefined, error: undefined })
    const snapshot = {
      notes: (notes ?? []).map(n => ({ id: n.id, content: n.content ?? '' })),
      currentNote: { id: note.id, content: note.content ?? '' },
    }
    runJsInWorker(codeContent, snapshot, (msg) => {
      if (msg.type === 'log') {
        setCodeViewScratchOutput(prev => ({ ...prev, logs: [...(prev?.logs ?? []), msg.line] }))
      } else if (msg.type === 'done') {
        setCodeViewScratchOutput(prev => ({ ...prev, status: 'done', result: msg.result }))
      } else if (msg.type === 'error') {
        setCodeViewScratchOutput(prev => ({ ...prev, status: 'error', error: msg.message }))
      }
    })
  }, [codeContent, notes, note.id, note.content])

  const handleMarkdownClick = useCallback((e) => {
    const btn = e.target.closest('.jotit-run-btn[data-scratch-id]')
    if (!btn) return
    const scratchId = btn.dataset.scratchId
    const codeEl = btn.closest('.jotit-scratch-block')?.querySelector('pre code')
    if (!codeEl) return
    runScratch(scratchId, codeEl.textContent ?? '')
  }, [runScratch])

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

  const toggleMinimap = useCallback(() => {
    setShowMinimap(v => { const next = !v; localStorage.setItem('jotit_minimap', String(next)); return next })
  }, [])

  const handlePanelKeyDown = useCallback((e) => {
    if (outlineOpen) return
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      openFind()
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
      e.preventDefault()
      openFindReplace()
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      toggleMinimap()
    }
    if (llmEnabled && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      onOpenNibPane?.({
        noteId: note.id,
        selectionText: sel.text,
        selectionRange: { start: sel.start, end: sel.end },
        regexContext: null,
        initialMessage: '',
      })
    }
  }, [openFind, openFindReplace, outlineOpen, toggleMinimap, llmEnabled, note.id, onOpenNibPane, sel])

  useEffect(() => {
    setContent(note.content)
    setMode(isOpenApiNote(note) ? 'openapi' : 'edit')
    setGitPRData(null)
    setGitPRViewRef(note.noteData?.gitPRView ?? null)
    setGitPRLoading(false)
    setConfirmDelete(false)
    setShareState(null)
    resetSelectionState()
    setTableSession(null)
    setCronSession(null)
    setDiagramSession(null)
    setJsonSession(null)
    setSnippetSaveOpen(false)
    setSnippetDraftName('')
    setSnippetSaved(false)
    setSnippetPicker(null)
    setSnippetResults([])
    setTemplateResults([])
    setSnippetActiveIndex(0)
    setTabStops(null)
    setDisplayHint(null)
    setFindOpen(false)
    setFindQuery('')
    setFindMatchIndex(0)
    setOutlineOpen(false)
    setOutlineQuery('')
    setOutlineIndex(0)
    setCodeViewActive(false)
    setCodeSymbolsOpen(false)
    setCodeCollapsedIds({})
    resetHistory(note.content)
  }, [note.id, resetHistory, resetSelectionState])

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
    if (mode !== 'edit') { setCodeViewActive(false); setCodeViewScratchOutput(null) }
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
    if (!snippetPicker?.query && snippetPicker?.query !== '') {
      setSnippetResults(snippets.slice(0, 8))
      setTemplateResults([])
      setSnippetActiveIndex(0)
      return
    }

    // Template results are synchronous — filter immediately
    setTemplateResults(matchTemplates(templates, snippetPicker?.query ?? ''))

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
  }, [onSearchSnippets, snippetPicker?.query, snippets, templates])

  // ── Selection tracking ──────────────────────────────────────────────────────
  // ── Undo / redo ─────────────────────────────────────────────────────────────
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

    const fenceMatch = text.match(/^```csv\s*\n([\s\S]*?)\n```\s*$/)
    const csvText = fenceMatch ? fenceMatch[1] : text

    try {
      parseCsvTable(csvText)
      setTableSession({ start, end, text: csvText })
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
    replaceRange(tableSession.start, tableSession.end, `\`\`\`csv\n${csv}\n\`\`\``)
    setTableSession(null)
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

  const closeGitPicker = useCallback(() => {
    setGitPicker(null)
    setGitActiveIndex(0)
  }, [])

  const handleEditorSelect = useCallback((e) => {
    updateSel()
    updateEnterCommandHint(e.target, e.target.value)
  }, [updateEnterCommandHint, updateSel])

  const handleEditorClick = useCallback((e) => {
    clearSelIfEmpty()
    updateEnterCommandHint(e.target, e.target.value)
  }, [clearSelIfEmpty, updateEnterCommandHint])

  const insertGitSuggestion = useCallback((suggestion) => {
    if (!gitPicker || !suggestion) return
    replaceRangeInEditor(gitPicker.start, gitPicker.end, suggestion.insertText)
    closeGitPicker()
  }, [closeGitPicker, gitPicker, replaceRangeInEditor])

  const insertSnippet = useCallback((snippet) => {
    if (!snippetPicker) return
    replaceRangeInEditor(snippetPicker.start, snippetPicker.end, snippet.content)
    closeSnippetPicker()
  }, [closeSnippetPicker, replaceRangeInEditor, snippetPicker])

  const insertPickerItem = useCallback((item) => {
    if (!snippetPicker) return
    if (item.kind === 'template') {
      const { args } = parseTemplateQuery(snippetPicker.query)
      const { text, stops } = expandTemplate(item.template, { args, selection: sel.text })
      const base = snippetPicker.start
      replaceRangeInEditor(base, snippetPicker.end, text)
      closeSnippetPicker()
      if (stops.length > 0) {
        const absoluteStops = stops.map(s => ({ ...s, start: base + s.start, end: base + s.end }))
        setTabStops({ stops: absoluteStops, current: 0 })
        requestAnimationFrame(() => {
          const ta = textareaRef.current
          if (ta) {
            ta.selectionStart = absoluteStops[0].start
            ta.selectionEnd = absoluteStops[0].end
          }
        })
      }
    } else {
      replaceRangeInEditor(snippetPicker.start, snippetPicker.end, item.snippet.content)
      closeSnippetPicker()
    }
  }, [snippetPicker, sel.text, replaceRangeInEditor, closeSnippetPicker])

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
    replaceRange(ta.selectionStart, ta.selectionEnd, guid)
    setGuidCopied(true)
    setTimeout(() => setGuidCopied(false), 1500)
  }

  const insertNow = () => {
    const ta = textareaRef.current
    if (!ta) return
    replaceRange(ta.selectionStart, ta.selectionEnd, formatCurrentDateTime())
    setNowInserted(true)
    setTimeout(() => setNowInserted(false), 1500)
  }

  const resolveGitRepoId = async (explicitRepoId = '') => {
    if (explicitRepoId) return explicitRepoId
    if (note.git?.repoId) return note.git.repoId
    if (sessionGitRepoId) return sessionGitRepoId

    const data = await listGitRepos(agentToken)
    if (data.defaultRepoId) return data.defaultRepoId
    throw new Error('No repo selected. Run /git connect "path" and then /git use <repo>.')
  }

  const replaceGitCommand = (range, output) => {
    replaceRangeInEditor(range.start, range.end, output)
  }

  const closeGitPRView = () => {
    gitPRLoadRequestRef.current += 1
    setGitPRLoading(false)
    setMode('edit')
  }

  const openGitPRView = async () => {
    if (gitPRLoading) return
    if (gitPRData) {
      setMode(mode === 'gitpr' ? 'edit' : 'gitpr')
      return
    }

    if (!gitPRViewRef) return
    if (!agentToken?.trim()) {
      setMode('edit')
      return
    }

    let loadingGitPRStarted = false
    try {
      setGitPRLoading(true)
      setMode('gitpr')
      const requestId = ++gitPRLoadRequestRef.current
      const repoId = gitPRViewRef.repoId || await resolveGitRepoId('')
      const data = await getGitPR(repoId, gitPRViewRef.prNumber, gitPRViewRef.base, agentToken)
      if (requestId !== gitPRLoadRequestRef.current) return
      setGitPRData(data)
      setGitPRViewRef({
        repoId,
        prNumber: data.prNumber,
        base: data.base,
        repoName: data.repo?.displayName ?? data.repo?.name ?? repoId,
        updatedAt: Date.now(),
      })
      setMode('gitpr')
    } catch (error) {
      const message = error.message ?? String(error)
      setGitPRViewRef(prev => prev ? { ...prev, error: message } : prev)
      setMode('edit')
    } finally {
      setGitPRLoading(false)
    }
  }

  const runGitCommand = async (range) => {
    const parsed = parseGitCommand(range.text)
    if (!parsed) return false
    closeGitPicker()
    setEnterCommandHint(null)

    if (!agentToken?.trim()) {
      replaceGitCommand(range, formatGitCommandResult('Git command failed', 'Local agent token is missing. Paste the token into Settings.'))
      return true
    }

    try {
      if (parsed.command === 'help') {
        replaceGitCommand(range, formatGitCommandResult('Git commands', [
          '/git connect "C:\\path\\to\\repo"',
          '/git repos',
          '/git use <repo-id>',
          '/git status',
          '/git diff',
          '/git summary',
          '/git summary commit',
          '/git pr <number>',
        ].join('\n')))
        return true
      }

      if (parsed.command === 'connect') {
        if (!parsed.path) throw new Error('Usage: /git connect "C:\\path\\to\\repo"')
        const { repo } = await connectGitRepo(parsed.path, agentToken)
        setSessionGitRepoId(repo.id)
        replaceGitCommand(range, formatGitCommandResult(`Connected repo: ${repo.displayName ?? repo.name ?? repo.id}`, [
          `Repo ID: ${repo.id}`,
          `Branch: ${repo.branch}`,
          `Base: ${repo.baseBranch}`,
          `Path: ${repo.path}`,
          '',
          `Run /git use ${repo.id} to link it to this note.`,
        ].join('\n')))
        return true
      }

      if (parsed.command === 'repos') {
        const data = await listGitRepos(agentToken)
        const linkedRepoId = note.git?.repoId ?? null
        const lines = data.repos.length
          ? data.repos.flatMap(repo => [
            `* ${repo.id}${repo.id === linkedRepoId ? ' (linked)' : ''}${repo.id === data.defaultRepoId ? ' (default)' : ''}`,
            `  Branch: ${repo.branch}`,
            `  Base: ${repo.baseBranch}`,
            `  Path: ${repo.path}`,
          ])
          : ['No repos connected. Run /git connect "C:\\path\\to\\repo".']
        replaceGitCommand(range, formatGitCommandResult('Known repos', lines.join('\n')))
        return true
      }

      if (parsed.command === 'use') {
        if (!parsed.repoId) throw new Error('Usage: /git use <repo-id>')
        const { repo } = await useGitRepo(parsed.repoId, { setDefault: parsed.setDefault }, agentToken)
        const git = { repoId: repo.id, baseBranch: repo.baseBranch, linkedAt: Date.now() }
        const noteData = note.noteData && typeof note.noteData === 'object' ? { ...note.noteData, git } : { git }
        onUpdate({ git, noteData })
        setSessionGitRepoId(repo.id)
        replaceGitCommand(range, formatGitCommandResult(`Repo linked to this note: ${repo.displayName ?? repo.name ?? repo.id}`, [
          `Repo ID: ${repo.id}`,
          `Branch: ${repo.branch}`,
          `Base: ${repo.baseBranch}`,
          parsed.setDefault ? 'Default repo: yes' : '',
        ].filter(Boolean).join('\n')))
        return true
      }

      if (parsed.command === 'status') {
        const repoId = await resolveGitRepoId(parsed.repoId)
        const data = await getGitStatus(repoId, agentToken)
        replaceGitCommand(range, formatGitCommandResult(`Git status: ${data.repo.displayName ?? data.repo.name ?? repoId}`, `\`\`\`text\n${data.status || 'clean'}\n\`\`\``))
        return true
      }

      if (parsed.command === 'diff') {
        const repoId = await resolveGitRepoId(parsed.repoId)
        const data = await getGitDiff(repoId, agentToken)
        const diff = data.diff || '(no diff)'
        const stat = data.stat ? `${data.stat}\n\n` : ''
        replaceGitCommand(range, formatGitCommandResult(`Git diff: ${data.repo.displayName ?? data.repo.name ?? repoId}`, `${stat}\`\`\`diff\n${diff}\n\`\`\``))
        return true
      }

      if (parsed.command === 'summary') {
        if (!ollamaModel) throw new Error('No AI model configured. Enable a local AI model in Settings.')
        const repoId = await resolveGitRepoId(parsed.repoId)
        const [statusData, diffData] = await Promise.all([
          getGitStatus(repoId, agentToken),
          getGitDiff(repoId, agentToken),
        ])
        const repoName = statusData.repo.displayName ?? statusData.repo.name ?? repoId
        const header = `Git summary: ${repoName}\n\n`
        replaceGitCommand(range, header + '…')
        const insertBodyStart = range.start + header.length
        const streamState = { bodyLen: 1 }
        const context = [
          `Repository: ${repoName}`,
          `Branch: ${statusData.repo.branch ?? 'unknown'}`,
          statusData.repo.baseBranch ? `Base branch: ${statusData.repo.baseBranch}` : null,
          '',
          '=== Status ===',
          statusData.status || '(clean)',
          '',
          '=== Diff stat ===',
          diffData.stat || '(no changes)',
          '',
          '=== Diff ===',
          (diffData.diff || '(no diff)').slice(0, 16000),
        ].filter(s => s !== null).join('\n')
        streamLLMChat(
          {
            token: agentToken,
            model: ollamaModel,
            messages: [{ role: 'user', content: 'Summarize these git changes.' }],
            context,
            contextMode: 'git-summary',
          },
          (chunk) => {
            let next
            setContent(prev => {
              const bodyEnd = insertBodyStart + streamState.bodyLen
              next = prev.slice(0, insertBodyStart) + prev.slice(insertBodyStart, bodyEnd) + chunk + prev.slice(bodyEnd)
              streamState.bodyLen += chunk.length
              return next
            })
            if (next !== undefined) onUpdate({ content: next })
          },
          () => {
            setContent(prev => { pushHistoryNow(prev); return prev })
          },
          (err) => {
            let next
            setContent(prev => {
              const bodyEnd = insertBodyStart + streamState.bodyLen
              const errMsg = `_(Error: ${err})_`
              next = prev.slice(0, insertBodyStart) + errMsg + prev.slice(bodyEnd)
              streamState.bodyLen = errMsg.length
              return next
            })
            if (next !== undefined) {
              pushHistoryNow(next)
              onUpdate({ content: next })
            }
          }
        )
        return true
      }

      if (parsed.command === 'summary-commit') {
        if (!ollamaModel) throw new Error('No AI model configured. Enable a local AI model in Settings.')
        const repoId = await resolveGitRepoId(parsed.repoId)
        const [statusData, diffData] = await Promise.all([
          getGitStatus(repoId, agentToken),
          getGitDiff(repoId, agentToken),
        ])
        const repoName = statusData.repo.displayName ?? statusData.repo.name ?? repoId
        const header = `Commit message: ${repoName}\n\n`
        replaceGitCommand(range, header + '…')
        const insertBodyStart = range.start + header.length
        const streamState = { bodyLen: 1 }
        const context = [
          `Repository: ${repoName}`,
          `Branch: ${statusData.repo.branch ?? 'unknown'}`,
          statusData.repo.baseBranch ? `Base branch: ${statusData.repo.baseBranch}` : null,
          '',
          '=== Status ===',
          statusData.status || '(clean)',
          '',
          '=== Diff stat ===',
          diffData.stat || '(no changes)',
          '',
          '=== Diff ===',
          (diffData.diff || '(no diff)').slice(0, 16000),
        ].filter(s => s !== null).join('\n')
        streamLLMChat(
          {
            token: agentToken,
            model: ollamaModel,
            messages: [{ role: 'user', content: 'Write a git commit message for these changes.' }],
            context,
            contextMode: 'git-commit-msg',
          },
          (chunk) => {
            let next
            setContent(prev => {
              const bodyEnd = insertBodyStart + streamState.bodyLen
              next = prev.slice(0, insertBodyStart) + prev.slice(insertBodyStart, bodyEnd) + chunk + prev.slice(bodyEnd)
              streamState.bodyLen += chunk.length
              return next
            })
            if (next !== undefined) onUpdate({ content: next })
          },
          () => {
            setContent(prev => { pushHistoryNow(prev); return prev })
          },
          (err) => {
            let next
            setContent(prev => {
              const bodyEnd = insertBodyStart + streamState.bodyLen
              const errMsg = `_(Error: ${err})_`
              next = prev.slice(0, insertBodyStart) + errMsg + prev.slice(bodyEnd)
              streamState.bodyLen = errMsg.length
              return next
            })
            if (next !== undefined) {
              pushHistoryNow(next)
              onUpdate({ content: next })
            }
          }
        )
        return true
      }

      if (parsed.command === 'pr-view') {
        if (!parsed.number) throw new Error('Usage: /git pr <number> [--base <branch>]')
        const repoId = await resolveGitRepoId(parsed.repoId)
        const pendingGitPRView = {
          repoId,
          prNumber: parsed.number,
          base: parsed.base,
          repoName: repoId,
          updatedAt: Date.now(),
        }
        setGitPRViewRef(pendingGitPRView)
        setGitPRLoading(true)
        loadingGitPRStarted = true
        setMode('gitpr')
        const data = await getGitPR(repoId, parsed.number, parsed.base, agentToken)
        const repoName = data.repo?.displayName ?? data.repo?.name ?? repoId
        const gitPRView = {
          repoId,
          prNumber: data.prNumber,
          base: data.base,
          repoName,
          updatedAt: Date.now(),
        }
        const lines = [`PR #${data.prNumber} — ${repoName}`, `Base: ${data.base}`, '']
        if (data.log) lines.push('## Commits', '```text', data.log.trimEnd(), '```', '')
        if (data.stat) lines.push('## Changed Files', '```text', data.stat.trimEnd(), '```', '')
        if (data.diff) lines.push('## Diff', '```diff', data.diff.trimEnd(), '```')
        replaceGitCommand(range, lines.join('\n').trimEnd())
        const noteData = note.noteData && typeof note.noteData === 'object'
          ? { ...note.noteData, gitPRView }
          : { gitPRView }
        onUpdate({ noteData })
        setGitPRViewRef(gitPRView)
        setGitPRData(data)
        setGitPRLoading(false)
        setMode('gitpr')
        return true
      }

      throw new Error('Unknown git command. Try /git repos, /git connect, /git use, /git status, /git diff, /git summary, /git summary commit, or /git pr <number>.')
    } catch (error) {
      setGitPRLoading(false)
      if (loadingGitPRStarted) setMode('edit')
      replaceGitCommand(range, formatGitCommandResult('Git command failed', error.message ?? String(error)))
      return true
    }
  }

  const runPrCommand = async (range) => {
    const parsed = parsePrCommand(range.text)
    if (!parsed) return false
    closeGitPicker()
    setEnterCommandHint(null)

    if (!agentToken?.trim()) {
      replaceGitCommand(range, formatGitCommandResult('PR draft failed', 'Local agent token is missing. Paste the token into Settings.'))
      return true
    }

    try {
      if (parsed.command === 'help') {
        replaceGitCommand(range, formatGitCommandResult('PR commands', '/pr draft [repo-id]'))
        return true
      }
      if (parsed.command !== 'draft') {
        throw new Error('Unknown PR command. Try /pr draft.')
      }

      const repoId = await resolveGitRepoId(parsed.repoId)
      const [statusData, diffData] = await Promise.all([
        getGitStatus(repoId, agentToken),
        getGitDiff(repoId, agentToken),
      ])
      const repoName = statusData.repo.displayName ?? statusData.repo.name ?? repoId
      const branch = statusData.repo.branch ?? 'unknown'
      const base = statusData.repo.baseBranch ?? note.git?.baseBranch ?? 'main'
      const stat = diffData.stat || '(no file changes)'
      const draft = [
        `PR draft: ${repoName}`,
        '',
        '## Title',
        `${branch} into ${base}`,
        '',
        '## Summary',
        '- TODO: describe the intent of this change.',
        '',
        '## Changes',
        '```text',
        stat,
        '```',
        '',
        '## Working Tree',
        '```text',
        statusData.status || 'clean',
        '```',
        '',
        '## Tests',
        '- TODO',
      ].join('\n')
      replaceGitCommand(range, draft)
      return true
    } catch (error) {
      replaceGitCommand(range, formatGitCommandResult('PR draft failed', error.message ?? String(error)))
      return true
    }
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
    setPendingCalc(null)
    setContent(e.target.value)
    onUpdate({ content: e.target.value })
    pushHistory(e.target.value)
    if (jsonSession) setJsonSession(null)
    updateEnterCommandHint(target, e.target.value)

    // Track tab stop drift as user types within the current stop
    if (tabStops) {
      const stop = tabStops.stops[tabStops.current]
      const newEnd = target.selectionEnd ?? cursor
      if (newEnd < stop.start) {
        // Cursor moved before the current stop — exit tab stop mode
        setTabStops(null)
      } else {
        const delta = newEnd - stop.end
        if (delta !== 0) {
          setTabStops(prev => {
            if (!prev) return null
            const newStops = prev.stops.map((s, i) => {
              if (i < prev.current) return s
              if (i === prev.current) return { ...s, end: newEnd }
              return { ...s, start: s.start + delta, end: s.end + delta }
            })
            return { ...prev, stops: newStops }
          })
        }
      }
      reportCurrentLocation(target)
      return // Don't open the snippet picker while navigating tab stops
    }

    const gitTrigger = getGitCommandTrigger(e.target.value, cursor)
    if (gitTrigger) {
      const lineStart = gitTrigger.start
      const lineEnd = e.target.value.indexOf('\n', cursor)
      const currentLine = e.target.value.slice(lineStart, lineEnd === -1 ? e.target.value.length : lineEnd)
      if (isRunnableCommandLine(currentLine)) {
        closeGitPicker()
        updateEnterCommandHint(target, e.target.value)
        reportCurrentLocation(target)
        return
      }
      const before = e.target.value.slice(0, gitTrigger.start)
      const lineIndex = before.split('\n').length - 1
      const visualLineStart = before.lastIndexOf('\n') + 1
      const column = gitTrigger.start - visualLineStart
      const lineHeight = parseFloat(getComputedStyle(target).lineHeight) || 20.8
      const charWidth = 7.8
      setGitPicker({
        ...gitTrigger,
        top: 24 + lineIndex * lineHeight - target.scrollTop,
        left: 24 + column * charWidth - target.scrollLeft,
      })
      setGitActiveIndex(0)
      setEnterCommandHint(null)
      if (snippetPicker) closeSnippetPicker()
      reportCurrentLocation(target)
      return
    } else if (gitPicker) {
      closeGitPicker()
    }

    const trigger = getSnippetTrigger(e.target.value, cursor)
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
    if (gitPicker) closeGitPicker()
    setContent(newContent)
    onUpdate({ content: newContent })
    pushHistory(newContent)
    if (jsonSession) setJsonSession(null)
  }, [onUpdate, pushHistory, closeSnippetPicker, closeGitPicker, snippetPicker, gitPicker, jsonSession])

  const handleKeyDown = (e) => {
    // Tab stop cycling (active when a template was just expanded)
    if (tabStops && !snippetPicker) {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        advanceTabStop(e.shiftKey ? -1 : 1)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setTabStops(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const commandRange = getCurrentLineRange()
      if (isRunnableCommandLine(commandRange.text)) {
        const gitCommand = parseGitCommand(commandRange.text)
        e.preventDefault()
        if (gitCommand) void runGitCommand(commandRange)
        else void runPrCommand(commandRange)
        return
      }
    }
    if (gitPicker) {
      const totalItems = gitSuggestions.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setGitActiveIndex(index => Math.min(index + 1, Math.max(0, totalItems - 1)))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setGitActiveIndex(index => Math.max(index - 1, 0))
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && totalItems) {
        e.preventDefault()
        insertGitSuggestion(gitSuggestions[gitActiveIndex] ?? gitSuggestions[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeGitPicker()
        return
      }
    }
    if (snippetPicker) {
      // Combined picker: templates first, then snippets
      const pickerItems = [
        ...templateResults.map(t => ({ kind: 'template', template: t })),
        ...snippetResults.map(s => ({ kind: 'snippet', snippet: s })),
      ]
      const totalItems = pickerItems.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSnippetActiveIndex(index => Math.min(index + 1, Math.max(0, totalItems - 1)))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSnippetActiveIndex(index => Math.max(index - 1, 0))
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && totalItems) {
        e.preventDefault()
        insertPickerItem(pickerItems[snippetActiveIndex] ?? pickerItems[0])
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
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const cursor = e.target.selectionStart ?? 0
      const gitRange = getCurrentLineRange()
      if (isRunnableCommandLine(gitRange.text) && parseGitCommand(gitRange.text)) {
        e.preventDefault()
        void runGitCommand(gitRange)
        return
      }
      if (isRunnableCommandLine(gitRange.text) && parsePrCommand(gitRange.text)) {
        e.preventDefault()
        void runPrCommand(gitRange)
        return
      }
      const nowRange = getInlineCommandRange(e.target.value, cursor, NOW_COMMAND)
      if (nowRange) {
        e.preventDefault()
        replaceRangeInEditor(nowRange.start, nowRange.end, formatCurrentDateTime())
        return
      }
    }
    if (helpCommandReady && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      if (onCreateTipsNote) onCreateTipsNote(HELP_NOTE_CONTENT)
      else onCreateNoteFromContent?.(HELP_NOTE_CONTENT)
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
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
      e.preventDefault()
      runShell()
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
      const selectedLanguage = detectPreferredCodeLanguage(selected)
      const formatted = shouldAutoIndentForLanguage(selectedLanguage) ? autoIndent(selected) : selected
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
    const contentLanguage = detectPreferredCodeLanguage(content)
    const formatted = shouldAutoIndentForLanguage(contentLanguage) ? autoIndent(content) : content
    setCodeBefore('')
    setCodeContent(formatted)
    setCodeAfter('')
    if (formatted !== content) {
      pushHistoryNow(content)
      setContent(formatted)
      onUpdate({ content: formatted })
    }
    setCodeSymbolsOpen(true)
    setCodeCollapsedIds({})
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
    if (codeViewReadOnly && e.key !== 'Escape' && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault()
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
      if (result?.secretGated) {
        // App-level secret gate has taken over — do nothing, modal will show
      } else if (result?.ok) {
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

  const handleRemoveFromServer = async () => {
    if (!confirmRemoveServer) {
      setConfirmRemoveServer(true)
      setTimeout(() => setConfirmRemoveServer(false), 3000)
      return
    }
    setConfirmRemoveServer(false)
    setRemovingFromServer(true)
    setRemoveServerResult(null)
    try {
      const result = await onRemoveFromServer()
      setRemoveServerResult(result ?? { ok: true })
    } finally {
      setRemovingFromServer(false)
    }
  }

  // Capture selection for panel mode switches
  const captureSelForModeSwitch = () => {
    const ta = textareaRef.current
    const text = (ta && ta.selectionStart !== ta.selectionEnd)
      ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
      : ''
    capturedSelectionRef.current = text
    capturedHttpSelRef.current = text
    capturedShellSelRef.current = text
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
    if (next === 'shell' && mode !== 'shell') setShellInstance(i => i + 1)
    if (next === 'diff'  && mode !== 'diff')  setDiffInstance(i => i + 1)
    setMode(prev => prev === next ? 'edit' : next)
  }, [mode])

  const runShell = useCallback(() => {
    const ta = textareaRef.current
    const text = (ta && ta.selectionStart !== ta.selectionEnd)
      ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
      : ''
    capturedShellSelRef.current = text
    setShellRunTrigger(t => t + 1)
    if (mode !== 'shell') {
      setShellInstance(i => i + 1)
      setMode('shell')
    }
  }, [mode])


  const codeLanguage = useMemo(() => {
    if (!codeViewActive || !codeContent.trim()) return ''
    try {
      const preferred = detectPreferredCodeLanguage(codeContent)
      if (preferred && hljs.getLanguage(preferred)) return preferred
      const result = hljs.highlightAuto(codeContent, HINT_LANGS)
      return normalizeCodeLanguage(result.language)
    } catch {
      return ''
    }
  }, [codeContent, codeViewActive])

  const codeSymbols = useMemo(() => (
    codeViewActive ? parseCodeSymbols(codeContent, codeLanguage) : []
  ), [codeContent, codeLanguage, codeViewActive])
  const codePaneSymbols = useMemo(() => (
    codeSymbols.filter(symbol => symbol.showInPane !== false)
  ), [codeSymbols])

  useEffect(() => {
    setCodeCollapsedIds(prev => {
      const validIds = new Set(codeSymbols.map(symbol => symbol.id))
      const next = Object.fromEntries(
        Object.entries(prev).filter(([id, enabled]) => enabled && validIds.has(id))
      )
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [codeSymbols])

  const collapsedCodeView = useMemo(() => (
    buildCollapsedCodeView(codeContent, codeSymbols, codeCollapsedIds)
  ), [codeCollapsedIds, codeContent, codeSymbols])

  const codeDisplayContent = collapsedCodeView.text
  const codeViewReadOnly = codeViewActive && collapsedCodeView.foldedSymbols.length > 0
  const displayedLineNumbers = useMemo(() => (
    codeViewActive ? collapsedCodeView.visibleLineNumbers : Array.from({ length: lineCount }, (_, index) => index + 1)
  ), [codeViewActive, collapsedCodeView.visibleLineNumbers, lineCount])
  const codeSymbolsByStartLine = useMemo(() => new Map(
    codeSymbols.map(symbol => [symbol.startLine, symbol])
  ), [codeSymbols])

  const toggleCodeSymbolFold = useCallback((symbolId) => {
    setCodeCollapsedIds(prev => (
      prev[symbolId]
        ? Object.fromEntries(Object.entries(prev).filter(([id]) => id !== symbolId))
        : { ...prev, [symbolId]: true }
    ))
  }, [])

  const expandAllCodeSymbols = useCallback(() => {
    setCodeCollapsedIds({})
  }, [])

  const collapseAllCodeSymbols = useCallback(() => {
    setCodeCollapsedIds(Object.fromEntries(codeSymbols.map(symbol => [symbol.id, true])))
  }, [codeSymbols])

  const jumpToCodeSymbol = useCallback((symbol) => {
    if (!symbol) return
    setCodeCollapsedIds(prev => {
      if (!prev[symbol.id]) return prev
      const next = { ...prev }
      delete next[symbol.id]
      return next
    })
    setCodeSymbolsOpen(true)
    requestAnimationFrame(() => focusEditorLine(symbol.startLine + 1))
  }, [focusEditorLine])

  const codeHighlighted = useMemo(() => {
    if (!codeViewActive) return ''
    if (!codeDisplayContent.trim()) return escapeHtml(codeDisplayContent)
    try {
      if (codeLanguage && hljs.getLanguage(codeLanguage)) {
        return hljs.highlight(codeDisplayContent, { language: codeLanguage }).value
      }
      return hljs.highlightAuto(codeDisplayContent, HINT_LANGS).value
    } catch {
      return escapeHtml(codeDisplayContent)
    }
  }, [codeDisplayContent, codeLanguage, codeViewActive])

  const markdownHtml = useMemo(() => {
    if (!content.trim()) return ''
    try {
      _scratchBlockIdx = 0
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

  const handleReplace = useCallback(() => {
    if (!findResults.length || findMatchIndex >= findResults.length) return
    const { start, end } = findResults[findMatchIndex]
    let actual = replaceQuery
    if (findMode === 'regex') {
      try { actual = content.slice(start, end).replace(new RegExp(findParsed.term), replaceQuery) } catch {}
    }
    const newContent = content.slice(0, start) + actual + content.slice(end)
    setContent(newContent)
    onUpdate({ content: newContent })
    setReplaceCount(null)
    const newResults = findMatchesScoped(newContent, findParsed.term, findParsed.scope, findMode) ?? []
    const nextIdx = Math.min(findMatchIndex, Math.max(0, newResults.length - 1))
    setFindMatchIndex(nextIdx)
    if (newResults[nextIdx]) {
      requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        const { start: ns, end: ne } = newResults[nextIdx]
        ta.setSelectionRange(ns, ne)
        const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20.8
        ta.scrollTop = Math.max(0, ta.value.slice(0, ns).split('\n').length * lineHeight - ta.clientHeight * 0.35)
        if (lineNumsRef.current) lineNumsRef.current.scrollTop = ta.scrollTop
      })
    }
  }, [findResults, findMatchIndex, replaceQuery, findMode, findParsed, content, onUpdate])

  const handleReplaceAll = useCallback(() => {
    if (!findParsed.term || findRegexError) return
    const doReplace = (c) => applyReplaceAll(c, findParsed.term, findParsed.scope, findMode, replaceQuery)

    if (replaceScope === 'note') {
      const { content: newContent, count } = doReplace(content)
      setContent(newContent)
      onUpdate({ content: newContent })
      setReplaceCount(count)
      setFindMatchIndex(0)
      return
    }

    const targetNotes = replaceScope === 'collection'
      ? notes.filter(n => n.collectionId === note.collectionId)
      : notes

    let totalCount = 0
    const otherUpdates = []

    for (const n of targetNotes) {
      const src = n.id === note.id ? content : n.content
      const { content: newContent, count } = doReplace(src)
      if (!count) continue
      totalCount += count
      if (n.id === note.id) {
        setContent(newContent)
        onUpdate({ content: newContent })
      } else {
        otherUpdates.push({ id: n.id, content: newContent })
      }
    }
    if (otherUpdates.length) onReplaceInNotes?.(otherUpdates)
    setReplaceCount(totalCount)
    setFindMatchIndex(0)
  }, [replaceScope, findParsed, findMode, findRegexError, content, note, notes, replaceQuery, onUpdate, onReplaceInNotes])

  const displayMarkdownHtml = useMemo(() => {
    if (!markdownHtml) return markdownHtml
    // FindBar takes precedence; fall back to global searchQuery when bar is closed
    const activeQuery = (findOpen && !findRegexError && findParsed.term)
      ? findParsed.term
      : (!findOpen && searchQuery)
        ? searchQuery
        : null
    if (!activeQuery) return markdownHtml
    const wrapText = (text) => {
      try {
        if (!findOpen || findMode === 'exact') {
          const escaped = activeQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="find-mark">$1</mark>')
        }
        if (findMode === 'regex') {
          return text.replace(new RegExp(`(${activeQuery})`, 'gi'), '<mark class="find-mark">$1</mark>')
        }
      } catch {}
      return text
    }
    if (findOpen && findParsed.scope === 'code') {
      // Only highlight inside <pre><code>…</code></pre> blocks
      return markdownHtml.replace(/(<pre><code[^>]*>)([\s\S]*?)(<\/code><\/pre>)/gi,
        (_, open, body, close) => open + wrapText(body) + close)
    }
    if (findOpen && findParsed.scope === 'text') {
      // Highlight everywhere except inside <pre><code>…</code></pre> blocks
      return markdownHtml.replace(/(<pre>[\s\S]*?<\/pre>)|(<[^>]+>)|([^<]*)/g, (_, pre, tag, text) => {
        if (pre || tag) return pre ?? tag
        if (!text) return ''
        return wrapText(text)
      })
    }
    // scope === 'all' (or global search): highlight everywhere
    return markdownHtml.replace(/(<[^>]+>)|([^<]*)/g, (_, tag, text) => {
      if (tag) return tag
      if (!text) return ''
      return wrapText(text)
    })
  }, [markdownHtml, findOpen, findParsed, findMode, findRegexError, searchQuery])

  // Clear scratch outputs when switching notes
  useEffect(() => {
    setScratchOutputs({})
    setScratchPortals([])
  }, [note.id])

  // Scan for scratch output portal targets after markdown HTML updates
  useEffect(() => {
    if (!markdownPreviewRef.current) return
    const divs = markdownPreviewRef.current.querySelectorAll('.jotit-scratch-output[data-scratch-id]')
    setScratchPortals(Array.from(divs).map(el => ({ id: el.dataset.scratchId, el })))
  }, [displayMarkdownHtml])

  const searchHighlightHtml = useMemo(() => {
    if (!searchQuery || findOpen) return null
    const matches = findMatches(editorDisplayContent, searchQuery, 'exact')
    if (!matches.length) return null
    let html = ''
    let last = 0
    for (const { start, end } of matches) {
      html += escapeHtml(editorDisplayContent.slice(last, start))
      html += `<mark class="find-mark">${escapeHtml(editorDisplayContent.slice(start, end))}</mark>`
      last = end
    }
    html += escapeHtml(editorDisplayContent.slice(last))
    return html
  }, [searchQuery, editorDisplayContent, findOpen])

  const findHighlightHtml = useMemo(() => {
    if (!findOpen || !findResults.length) return null
    let html = ''
    let last = 0
    for (let i = 0; i < findResults.length; i++) {
      const { start, end } = findResults[i]
      html += escapeHtml(editorDisplayContent.slice(last, start))
      const cls = i === findMatchIndex ? 'find-mark-active' : 'find-mark'
      html += `<mark class="${cls}">${escapeHtml(editorDisplayContent.slice(start, end))}</mark>`
      last = end
    }
    html += escapeHtml(editorDisplayContent.slice(last))
    return html
  }, [findOpen, findResults, findMatchIndex, editorDisplayContent])

  const selMatchData = useMemo(() => {
    const term = sel.text
    if (findOpen || !term || term.length < 2 || term.includes('\n') || /^\s+$/.test(term)) return null
    const matches = []
    let idx = 0
    while (matches.length < 500) {
      const pos = editorDisplayContent.indexOf(term, idx)
      if (pos === -1) break
      matches.push({ start: pos, end: pos + term.length })
      idx = pos + 1
    }
    if (matches.length <= 1) return null
    let html = ''
    let last = 0
    for (const { start, end } of matches) {
      html += escapeHtml(editorDisplayContent.slice(last, start))
      html += `<mark class="sel-mark">${escapeHtml(editorDisplayContent.slice(start, end))}</mark>`
      last = end
    }
    html += escapeHtml(editorDisplayContent.slice(last))
    return { html, count: matches.length }
  }, [sel.text, editorDisplayContent, findOpen])

  const sectionMatches = useMemo(() => {
    if (!findOpen || !findResults.length) return []
    return matchesToSections(findResults, sections, content)
  }, [findOpen, findResults, sections, content])

  const looksLikeRequest = useMemo(() => {
    return detectRequestType(content) !== null
  }, [content])

  const looksLikeShell = useMemo(() => hasShellBlocks(content), [content])

  const looksLikeTable = useMemo(() => {
    const ta = textareaRef.current
    const selected = ta && ta.selectionStart !== ta.selectionEnd
      ? content.slice(ta.selectionStart, ta.selectionEnd)
      : content
    const fenceMatch = selected.match(/^```csv\s*\n([\s\S]*?)\n```\s*$/)
    return fenceMatch ? looksLikeCsvTable(fenceMatch[1]) : looksLikeCsvTable(selected)
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
      if (id === 'yaml')     return (/^\s*[\w."'-]+\s*:\s*/m.test(t) || /^\s*-\s+/m.test(t)) ? 8 : 0
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

  const dateTimeCommandBar = useMemo(() => {
    if (!hasSelection) return null
    const detected = detectDateTimeInstant(sel.text)
    if (!detected) return null
    return {
      source: detected.source,
      ...getDateTimeCommandOptions(detected.date),
    }
  }, [sel.text, hasSelection])
  const dateFmtPopup = null
  const tzPopup = null
  const tsPopup = null
  const showCommandToolbars = !simpleEditor && !hideCommandToolbars
  const gitPRViewButtonData = gitPRData
    ? {
      prNumber: gitPRData.prNumber,
      repoName: gitPRData.repo?.displayName ?? gitPRData.repo?.name ?? '',
      error: '',
      loading: false,
    }
    : gitPRViewRef
      ? { ...gitPRViewRef, loading: gitPRLoading }
      : null

  return (
    <>
    <div ref={panelRef} className="flex flex-col flex-1 min-w-0 overflow-hidden relative" onKeyDown={handlePanelKeyDown}>

      {/* ── Main toolbar ── */}
      {showCommandToolbars && (
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-zinc-800 shrink-0">
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
        {codeViewActive && isCodeOutlineLanguage(codeLanguage) && codePaneSymbols.length > 0 && (
          <>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={() => setCodeSymbolsOpen(open => !open)}
              title="Show code symbols and jump targets"
              className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
                codeSymbolsOpen
                  ? 'text-cyan-300 bg-cyan-950/50 border-cyan-800'
                  : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
              }`}
            >
              Jump
            </button>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={collapseAllCodeSymbols}
              title="Collapse all detected methods, functions, and statements"
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600"
            >
              Fold
            </button>
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={expandAllCodeSymbols}
              title="Expand all collapsed code blocks"
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600"
            >
              Unfold
            </button>
          </>
        )}
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
          onClick={() => switchMode('shell')}
          title="Shell runner — run bash/shell code blocks via local agent"
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            mode === 'shell'
              ? 'text-emerald-300 bg-emerald-950/50 border-emerald-800'
              : looksLikeShell || sel.text.length > 0
                ? 'text-emerald-400 hover:text-emerald-200 bg-emerald-950/20 border-emerald-900 hover:border-emerald-700'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          <span className="text-[12px]">$</span>
          {mode === 'shell' ? 'Edit' : 'Shell'}
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
        {gitPRViewButtonData && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={openGitPRView}
            title={
              gitPRViewButtonData.error
                ? gitPRViewButtonData.error
                : gitPRViewButtonData.loading
                  ? `Loading PR #${gitPRViewButtonData.prNumber}`
                : mode === 'gitpr'
                  ? 'Back to note'
                  : `Open PR #${gitPRViewButtonData.prNumber} viewer`
            }
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
              mode === 'gitpr'
                ? 'text-violet-300 bg-violet-950/50 border-violet-800'
                : gitPRViewButtonData.loading
                  ? 'text-violet-300 bg-violet-950/30 border-violet-800'
                : gitPRViewButtonData.error
                  ? 'text-red-300 bg-red-950/20 border-red-900 hover:border-red-700'
                : 'text-violet-400 hover:text-violet-200 bg-violet-950/20 border-violet-900 hover:border-violet-700'
            }`}
          >
            {gitPRViewButtonData.loading && (
              <span className="w-3 h-3 rounded-full border border-violet-400/40 border-t-violet-200 animate-spin" />
            )}
            PR #{gitPRViewButtonData.prNumber}
          </button>
        )}
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={insertNow}
          title="Insert current local date and time at cursor. You can also type /now and press Enter."
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            nowInserted
              ? 'text-green-300 border-green-800 bg-green-950/30'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          {nowInserted ? 'inserted' : 'Now'}
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
          onClick={toggleMinimap}
          title={showMinimap ? 'Hide scroll map (Alt+M)' : 'Show scroll map (Alt+M)'}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
            showMinimap
              ? 'text-zinc-300 bg-zinc-800/60 border-zinc-600'
              : 'text-zinc-600 hover:text-zinc-400 bg-transparent border-zinc-800 hover:border-zinc-600'
          }`}
        >
          map
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
        {llmEnabled && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => onOpenNibPane?.({
              noteId: note.id,
              selectionText: sel.text,
              selectionRange: { start: sel.start, end: sel.end },
              regexContext: null,
              initialMessage: '',
            })}
            title="Nib — ask AI about this note"
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono text-violet-400 hover:text-violet-200 bg-violet-950/20 border-violet-900 hover:border-violet-700"
          >
            <span className="text-[13px] leading-none">✒</span>
            Nib
          </button>
        )}
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
        {publicCloneInfo && (
          <a
            href={publicCloneInfo.url ?? '#'}
            target="_blank"
            rel="noreferrer"
            title={publicCloneInfo.url ? `Cloned from ${publicCloneInfo.url}` : 'Cloned from a shared note'}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-blue-900/60 bg-blue-950/40 text-blue-200 transition-colors hover:bg-blue-950/60 font-mono"
          >
            cloned
          </a>
        )}
        {linkedGitRepo && (
          <span
            title={[
              `Linked repo: ${linkedGitRepo.displayName ?? linkedGitRepo.name ?? linkedGitRepo.id}`,
              linkedGitRepo.branch ? `Branch: ${linkedGitRepo.branch}` : null,
              linkedGitRepo.baseBranch ? `Base: ${linkedGitRepo.baseBranch}` : null,
              linkedGitRepo.path ? `Path: ${linkedGitRepo.path}` : null,
            ].filter(Boolean).join('\n')}
            className="flex min-w-0 max-w-[18rem] items-center gap-1 px-2 py-1 text-[11px] rounded border border-sky-800/70 bg-sky-950/30 text-sky-200 font-mono"
          >
            <span className="text-sky-400 shrink-0">git</span>
            <span className="truncate">{linkedGitRepo.displayName ?? linkedGitRepo.name ?? linkedGitRepo.id}</span>
            {linkedGitRepo.branch && (
              <span className="text-sky-500/80 truncate">({linkedGitRepo.branch})</span>
            )}
          </span>
        )}
        {isInPublicCollection && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={async () => {
              if (!onToggleCollectionExcluded) return
              const result = await onToggleCollectionExcluded(!note.collectionExcluded)
              if (result?.error) window.alert(result.error)
            }}
            title={note.collectionExcluded
              ? `Hidden from ${collection?.name}${collectionPublicUrl ? ` (${collectionPublicUrl})` : ''}`
              : `Visible in ${collection?.name}${collectionPublicUrl ? ` (${collectionPublicUrl})` : ''}`}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
              note.collectionExcluded
                ? 'text-amber-300 bg-amber-950/40 border-amber-800 hover:bg-amber-950/60'
                : 'text-sky-300 bg-sky-950/30 border-sky-900 hover:bg-sky-950/50'
            }`}
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
              {note.collectionExcluded
                ? <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 10-1.06 1.06l2.116 2.116A8.836 8.836 0 001 10c2.333 3.5 5.59 5.25 9 5.25 1.835 0 3.626-.507 5.259-1.52l1.46 1.46a.75.75 0 101.06-1.06l-14.5-14.5zm7.548 7.548a2 2 0 00-2.548-2.548l2.548 2.548zM6.148 7.208l1.156 1.156A2 2 0 0010 10.06l1.792 1.792A3.5 3.5 0 016.148 7.208z" clipRule="evenodd" />
                : <path d="M10 4.75c-3.41 0-6.667 1.75-9 5.25 2.333 3.5 5.59 5.25 9 5.25s6.667-1.75 9-5.25c-2.333-3.5-5.59-5.25-9-5.25zm0 8a2.75 2.75 0 110-5.5 2.75 2.75 0 010 5.5z" />}
            </svg>
            {note.collectionExcluded ? 'Hidden' : 'In bucket'}
          </button>
        )}
        {user && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              if (!hasE2EKeys) return
              onUpdate({ encryptionTier: note.encryptionTier === 2 ? 0 : 2 })
            }}
            title={
              !hasE2EKeys
                ? 'No encryption keys — log out and back in to set up'
                : note.encryptionTier === 2
                  ? 'End-to-end encrypted — click to remove encryption'
                  : 'Click to enable end-to-end encryption'
            }
            disabled={!hasE2EKeys}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
              note.encryptionTier === 2
                ? 'text-amber-300 bg-amber-950/40 border-amber-800 hover:bg-amber-950/60'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
          >
            {note.encryptionTier === 2 ? (
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
              </svg>
            )}
            {note.encryptionTier === 2 ? 'E2E' : 'E2E'}
          </button>
        )}
        {onTogglePin && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={onTogglePin}
            title={isPinned ? 'Unpin from this collection' : 'Pin to top of this collection'}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors font-mono ${
              isPinned
                ? 'text-amber-300 bg-amber-950/40 border-amber-800 hover:bg-amber-950/60'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-zinc-800 hover:border-zinc-600'
            }`}
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
            </svg>
            {isPinned ? 'Pinned' : 'Pin'}
          </button>
        )}
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
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {shareState?.ok && (
            <a
              href={shareState.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 max-w-[min(32rem,100%)] truncate text-[11px] text-emerald-400 hover:text-emerald-300 font-mono"
              onMouseDown={e => e.stopPropagation()}
            >
              {shareState.url}
            </a>
          )}
          {shareState?.error && (
            <span className="text-[11px] text-red-400 font-mono">{shareState.error}</span>
          )}
          {user && onRemoveFromServer && !note.syncExcluded && (
            <button
              onClick={handleRemoveFromServer}
              disabled={removingFromServer}
              className={`shrink-0 whitespace-nowrap text-xs transition-colors px-2 py-1 rounded ${
                confirmRemoveServer
                  ? 'bg-amber-900/60 text-amber-300 border border-amber-700'
                  : removeServerResult?.ok
                    ? 'text-zinc-500 cursor-default'
                    : removeServerResult?.error
                      ? 'text-red-400 cursor-default'
                      : 'text-zinc-600 hover:text-amber-400'
              }`}
              title="Delete this note from the server but keep it on this device"
            >
              {removingFromServer ? 'removing…' : confirmRemoveServer ? 'confirm remove?' : removeServerResult?.ok ? 'removed from server' : removeServerResult?.error ? `failed: ${removeServerResult.error}` : 'remove from server'}
            </button>
          )}
          <button
            onClick={handleDelete}
            className={`shrink-0 whitespace-nowrap text-xs transition-colors px-2 py-1 rounded ${
              confirmDelete
                ? 'bg-red-900/60 text-red-300 border border-red-700'
                : 'text-zinc-600 hover:text-red-400'
            }`}
          >
            {confirmDelete ? 'confirm delete?' : 'delete'}
          </button>
        </div>
      </div>
      )}

      {/* ── Find bar ── */}
      {showCommandToolbars && findOpen && (mode === 'edit' || mode === 'markdown') && (
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
          showReplace={showReplace}
          replaceQuery={replaceQuery}
          onReplaceQueryChange={setReplaceQuery}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
          replaceScope={replaceScope}
          onReplaceScopeChange={setReplaceScope}
          replaceInputRef={replaceInputRef}
          replaceCount={replaceCount}
        />
      )}

      {/* ── Transform strip ── */}
      {showCommandToolbars && mode === 'edit' && !interactiveTx && (
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
      {showCommandToolbars && mode === 'edit' && !interactiveTx && dateTimeCommandBar && (
        <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-950/40 shrink-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 self-center mr-0.5">datetime</span>
          {dateTimeCommandBar.timezoneOptions.map(option => (
            <button
              key={option.iana}
              onMouseDown={e => e.preventDefault()}
              onClick={() => replaceSelectionWith(option.value)}
              title={`${option.label}${option.isUser ? ' local timezone' : ''} - overwrite selection`}
              className={`px-2 py-0.5 text-[11px] font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
                option.isUser
                  ? 'text-amber-300 border-amber-700/60 bg-amber-950/20 hover:bg-amber-950/50 hover:text-amber-100'
                  : 'text-zinc-400 hover:text-zinc-100 border-zinc-700/60 bg-transparent hover:bg-zinc-800/60 hover:border-zinc-500'
              }`}
            >
              <span className="text-zinc-600 mr-1">{option.label}</span>
              {option.value}
            </button>
          ))}
          <span className="h-4 w-px bg-zinc-800 mx-0.5" />
          {dateTimeCommandBar.timestampOptions.map(option => (
            <button
              key={option.label}
              onMouseDown={e => e.preventDefault()}
              onClick={() => replaceSelectionWith(option.value)}
              title={`${option.label} - overwrite selection`}
              className="px-2 py-0.5 text-[11px] font-mono text-sky-400 hover:text-sky-200 border border-sky-900/70 hover:border-sky-700 rounded bg-sky-950/20 hover:bg-sky-950/40 transition-colors whitespace-nowrap shrink-0"
            >
              <span className="text-sky-700 mr-1">{option.label}</span>
              {option.value}
            </button>
          ))}
        </div>
      )}

      {showCommandToolbars && mode === 'edit' && !interactiveTx && dateFmtPopup && (
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
      {showCommandToolbars && mode === 'edit' && !interactiveTx && tzPopup && (
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
      {showCommandToolbars && mode === 'edit' && !interactiveTx && tsPopup && (
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

      {showCommandToolbars && mode === 'edit' && gotoOpen && (
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
            x
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

      {secretScanEnabled && (
        <SecretAlert
          content={content}
          clearedHash={note.secretsClearedHash ?? null}
          onMarkSafe={hash => onUpdate({ secretsClearedHash: hash })}
        />
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
              onSelect={handleEditorSelect}
              onMouseUp={handleEditorSelect}
              onKeyUp={handleEditorSelect}
              onClick={handleEditorClick}
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
                lineHeight: CODE_LINE_HEIGHT,
                color: '#3f3f46',
                width: `${Math.max(String(lineCount).length + (codeViewActive && isCodeOutlineLanguage(codeLanguage) ? 6 : 2), 4)}ch`,
              }}
            >
              {displayedLineNumbers.map((lineNumber) => {
                const sourceIndex = lineNumber - 1
                const symbol = codeViewActive ? codeSymbolsByStartLine.get(sourceIndex) : null
                const isCollapsed = symbol ? !!codeCollapsedIds[symbol.id] : false
                return (
                  <div key={lineNumber} className="flex items-center justify-end gap-1" style={{ lineHeight: CODE_LINE_HEIGHT }}>
                    {symbol && (
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => toggleCodeSymbolFold(symbol.id)}
                        title={`${isCollapsed ? 'Unfold' : 'Fold'} ${symbol.kind} ${symbol.label}`}
                        className="inline-flex h-4 w-4 items-center justify-center rounded border border-zinc-800 bg-zinc-900 text-[10px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-200"
                      >
                        {isCollapsed ? '+' : '-'}
                      </button>
                    )}
                    <span>{lineNumber}</span>
                  </div>
                )
              })}
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
              <>
              <div className="relative flex-1 min-w-0 overflow-hidden">
              {(findHighlightHtml || searchHighlightHtml || selMatchData) && (
                <div
                  ref={searchBackdropRef}
                  aria-hidden
                  className="absolute inset-0 w-full h-full note-content p-4 text-transparent whitespace-pre-wrap break-words overflow-hidden pointer-events-none select-none"
                  dangerouslySetInnerHTML={{ __html: findHighlightHtml ?? searchHighlightHtml ?? selMatchData.html }}
                />
              )}
              {selMatchData && (
                <div className="absolute right-2 top-2 z-10 pointer-events-none">
                  <div className="rounded border border-zinc-700 bg-zinc-900/95 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                    {selMatchData.count} matches
                  </div>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={editorDisplayContent}
                onChange={openApiNote ? undefined : handleContent}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onSelect={handleEditorSelect}
                onMouseUp={handleEditorSelect}
                onKeyUp={handleEditorSelect}
                onClick={handleEditorClick}
                onScroll={e => {
                  if (showLineNumbers && lineNumsRef.current) lineNumsRef.current.scrollTop = e.target.scrollTop
                  if (searchBackdropRef.current) searchBackdropRef.current.scrollTop = e.target.scrollTop
                  updateEnterCommandHint(e.target, e.target.value)
                  reportCurrentLocation(e.target)
                }}
                placeholder={openApiNote ? 'OpenAPI document JSON' : tipsCreated ? 'Start typing...' : '/tips'}
                readOnly={openApiNote}
                spellCheck={false}
                className="absolute inset-0 w-full h-full bg-transparent text-zinc-300 note-content p-4 resize-none outline-none placeholder-zinc-800 overflow-y-auto"
              />
              {helpCommandReady && (
                <div className="absolute top-4 left-4 z-10 pointer-events-none">
                  <div className="rounded-md border border-blue-800/70 bg-blue-950/90 px-2.5 py-1.5 text-[11px] text-blue-100 shadow-lg shadow-black/30">
                    Press Enter to create a jot.it tips note
                  </div>
                </div>
              )}
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
              {enterCommandHint && !gitPicker && !snippetPicker && (
                <div
                  className="absolute z-10 pointer-events-none"
                  style={{
                    top: `${enterCommandHint.top + 24}px`,
                    left: `${Math.max(16, enterCommandHint.left)}px`,
                    maxWidth: 'calc(100% - 32px)',
                  }}
                >
                  <span className="inline-flex items-center rounded border border-sky-900/70 bg-zinc-950/90 px-1.5 py-0.5 text-[10px] font-mono text-sky-400 shadow-lg shadow-black/30">
                    {enterCommandHint.label}
                  </span>
                </div>
              )}
              {tabStops && (
                <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 pointer-events-none">
                  <span className="text-[10px] font-mono text-violet-400 bg-zinc-950/90 border border-violet-900/60 rounded px-1.5 py-0.5">
                    Tab next · Shift+Tab back · Esc exit
                  </span>
                </div>
              )}
              {gitPicker && (
                <div
                  className="absolute z-20 w-[26rem] max-w-[calc(100%-32px)]"
                  style={{
                    top: `${Math.max(16, gitPicker.top + 24)}px`,
                    left: `${Math.max(16, gitPicker.left)}px`,
                  }}
                >
                  <div className="rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-2xl shadow-black/40 overflow-hidden">
                    <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 flex items-center gap-2">
                      <span className="text-[10px] text-sky-400 font-mono">git</span>
                      <span className="text-[11px] text-zinc-500 font-mono truncate min-w-0">/git {gitPicker.query}</span>
                      <span className="ml-auto text-[10px] text-zinc-700 font-mono">Enter accept</span>
                    </div>
                    <div className="max-h-72 overflow-auto">
                      {gitSuggestions.length ? gitSuggestions.map((item, index) => (
                        <button
                          key={`${item.kind}:${item.command}:${item.repo?.id ?? item.insertText}`}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => insertGitSuggestion(item)}
                          className={`w-full text-left px-3 py-2 border-b border-zinc-900/80 transition-colors ${
                            index === gitActiveIndex ? 'bg-sky-950/50' : 'bg-transparent hover:bg-zinc-900/80'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] text-sky-300 font-mono shrink-0">{item.kind === 'repo' ? item.repo.id : `/git ${item.command}`}</span>
                            <span className="text-[12px] text-zinc-300 truncate">{item.kind === 'repo' ? item.usage : item.detail}</span>
                          </div>
                          <div className="text-[11px] text-zinc-600 font-mono truncate mt-0.5">
                            {item.kind === 'repo' ? item.detail : item.usage}
                          </div>
                        </button>
                      )) : (
                        <div className="px-3 py-2 text-[11px] text-zinc-500 font-mono">no git suggestions</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {snippetPicker && (() => {
                const pickerItems = [
                  ...templateResults.map((t, i) => ({ kind: 'template', template: t, globalIndex: i })),
                  ...snippetResults.map((s, i) => ({ kind: 'snippet', snippet: s, globalIndex: templateResults.length + i })),
                ]
                const hasTemplates = templateResults.length > 0
                const hasSnippets = snippetResults.length > 0
                return (
                  <div
                    className="absolute z-20 w-80 max-w-[calc(100%-32px)]"
                    style={{
                      top: `${Math.max(16, snippetPicker.top + 24)}px`,
                      left: `${Math.max(16, snippetPicker.left)}px`,
                    }}
                  >
                    <div className="rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-2xl shadow-black/40 overflow-hidden">
                      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/80 flex items-center gap-2">
                        <span className="text-[10px] text-zinc-600 font-mono">{hasTemplates ? 'templates · snippets' : 'snippets'}</span>
                        <span className="text-[11px] text-zinc-500 font-mono truncate min-w-0">!{snippetPicker.query}</span>
                        {snippetSaved && <span className="ml-auto text-[10px] text-emerald-400 font-mono">saved</span>}
                      </div>
                      <div className="max-h-72 overflow-auto">
                        {hasTemplates && (
                          <>
                            {templateResults.map((t, i) => (
                              <button
                                key={t.id}
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => insertPickerItem({ kind: 'template', template: t })}
                                className={`w-full text-left px-3 py-2 border-b border-zinc-900/80 transition-colors ${
                                  i === snippetActiveIndex ? 'bg-violet-950/60' : 'bg-transparent hover:bg-zinc-900/80'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-violet-400 font-mono shrink-0">!{t.command}</span>
                                  <span className="text-[12px] text-zinc-200 truncate">{t.name}</span>
                                  {t.builtin && <span className="text-[9px] text-zinc-700 font-mono ml-auto shrink-0">built-in</span>}
                                </div>
                                <div className="text-[11px] text-zinc-600 font-mono truncate mt-0.5">
                                  {snippetPicker.query.includes(' ')
                                    ? `args: "${parseTemplateQuery(snippetPicker.query).args}"`
                                    : 'Tab through fields after expanding'}
                                </div>
                              </button>
                            ))}
                          </>
                        )}
                        {hasTemplates && hasSnippets && (
                          <div className="px-3 py-1 text-[10px] text-zinc-700 font-mono border-b border-zinc-900/80 bg-zinc-900/30">snippets</div>
                        )}
                        {hasSnippets && snippetResults.map((snippet, i) => {
                          const globalIdx = templateResults.length + i
                          return (
                            <button
                              key={snippet.id}
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => insertPickerItem({ kind: 'snippet', snippet })}
                              className={`w-full text-left px-3 py-2 border-b border-zinc-900/80 transition-colors ${
                                globalIdx === snippetActiveIndex ? 'bg-zinc-800/80' : 'bg-transparent hover:bg-zinc-900/80'
                              }`}
                            >
                              <div className="text-[12px] text-zinc-200 font-mono truncate">{snippetLabel(snippet)}</div>
                              <div className="text-[11px] text-zinc-500 note-content whitespace-pre-wrap line-clamp-2">
                                {snippet.content}
                              </div>
                            </button>
                          )
                        })}
                        {!hasTemplates && !hasSnippets && (
                          <div className="px-3 py-2 text-[11px] text-zinc-500 font-mono">no results</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}
              </div>
              {minimapEnabled && (
                <NoteScrollMap
                  containerRef={scrollMap.containerRef}
                  canvasRef={scrollMap.canvasRef}
                  viewportStyle={scrollMap.viewportStyle}
                  onPointerDown={scrollMap.handlePointerDown}
                />
              )}
              </>
              )}
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ background: '#0d1117' }}>
              <div className="flex flex-1 min-w-0 overflow-hidden">
              <div className="relative flex-1 overflow-hidden">
                <pre
                  ref={codePreRef}
                  aria-hidden="true"
                  className="hljs absolute inset-0 m-0 p-4 overflow-auto pointer-events-none text-[13px]"
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'JetBrains Mono','Fira Code',Consolas,monospace", lineHeight: CODE_LINE_HEIGHT }}
                  dangerouslySetInnerHTML={{ __html: codeHighlighted + '\n' }}
                />
                <textarea
                  ref={codeEditRef}
                  value={codeDisplayContent}
                  onChange={codeViewReadOnly ? undefined : handleCodeEdit}
                  onKeyDown={handleCodeKeyDown}
                  onScroll={syncCodeScroll}
                  readOnly={codeViewReadOnly}
                  spellCheck={false}
                  className="absolute inset-0 w-full h-full p-4 resize-none outline-none bg-transparent text-[13px]"
                  style={{ color: 'transparent', caretColor: codeViewReadOnly ? 'transparent' : '#e2e8f0', fontFamily: "'JetBrains Mono','Fira Code',Consolas,monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: CODE_LINE_HEIGHT }}
                />
                <div className="absolute right-3 top-3 flex items-center gap-2">
                  {(codeLanguage === 'javascript' || codeLanguage === 'typescript') && (
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={runCodeViewScratch}
                      disabled={codeViewScratchOutput?.status === 'running'}
                      className="rounded border border-emerald-800/70 bg-emerald-950/80 px-2 py-1 text-[10px] font-mono text-emerald-300 hover:text-emerald-100 hover:border-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-default"
                    >
                      {codeViewScratchOutput?.status === 'running' ? 'running…' : '▷ Run'}
                    </button>
                  )}
                  {codeViewReadOnly && (
                    <div className="pointer-events-none rounded-md border border-amber-800/60 bg-amber-950/85 px-2 py-1 text-[10px] font-mono text-amber-200">
                      inspect mode: unfold to edit
                    </div>
                  )}
                </div>
              </div>
              {minimapEnabled && (
                <NoteScrollMap
                  containerRef={scrollMap.containerRef}
                  canvasRef={scrollMap.canvasRef}
                  viewportStyle={scrollMap.viewportStyle}
                  onPointerDown={scrollMap.handlePointerDown}
                />
              )}
              {codeViewActive && codeSymbolsOpen && isCodeOutlineLanguage(codeLanguage) && codePaneSymbols.length > 0 && (
                <div className="w-[260px] shrink-0 border-l border-zinc-800 bg-zinc-950/85 overflow-y-auto">
                  <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">Code symbols</div>
                    <div className="mt-1 text-[11px] text-zinc-600">{codePaneSymbols.length} jump target{codePaneSymbols.length === 1 ? '' : 's'}</div>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {codePaneSymbols.map(symbol => {
                      const isCollapsed = !!codeCollapsedIds[symbol.id]
                      return (
                        <div key={symbol.id} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-2">
                          <button
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => jumpToCodeSymbol(symbol)}
                            className="w-full text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500">
                                {symbol.kind}
                              </span>
                              <span className="truncate text-[12px] font-mono text-zinc-200">{symbol.label}</span>
                            </div>
                            <div className="mt-1 text-[10px] font-mono text-zinc-600">L{symbol.startLine + 1}-L{symbol.endLine + 1}</div>
                          </button>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => jumpToCodeSymbol(symbol)}
                              className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                            >
                              jump
                            </button>
                            <span className="text-[10px] font-mono text-zinc-600">
                              {isCollapsed ? 'collapsed inline' : 'toggle inline'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              </div>
              {codeViewScratchOutput && (
                <div className="shrink-0 border-t border-zinc-800 max-h-52 overflow-y-auto font-mono text-[11.5px] bg-zinc-950">
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/60 sticky top-0 bg-zinc-950">
                    <span className="text-[10px] uppercase tracking-widest text-zinc-600">output</span>
                    <button
                      onClick={() => setCodeViewScratchOutput(null)}
                      className="ml-auto text-zinc-600 hover:text-zinc-300 text-[11px]"
                    >✕</button>
                  </div>
                  {codeViewScratchOutput.status === 'running' && !codeViewScratchOutput.logs.length && (
                    <div className="px-3 py-2 text-zinc-500">running…</div>
                  )}
                  {codeViewScratchOutput.logs.map((line, i) => (
                    <div key={i} className="px-3 py-[3px] text-zinc-300 border-b border-zinc-800/30 last:border-0 whitespace-pre-wrap break-all">{line}</div>
                  ))}
                  {codeViewScratchOutput.status === 'done' && codeViewScratchOutput.result !== undefined && (
                    <div className="px-3 py-2 text-emerald-400 border-t border-zinc-800/60 whitespace-pre-wrap break-all">→ {codeViewScratchOutput.result}</div>
                  )}
                  {codeViewScratchOutput.status === 'done' && codeViewScratchOutput.result === undefined && !codeViewScratchOutput.logs.length && (
                    <div className="px-3 py-2 text-zinc-600">→ (no output)</div>
                  )}
                  {codeViewScratchOutput.status === 'error' && (
                    <div className="px-3 py-2 text-red-400 whitespace-pre-wrap break-all">✕ {codeViewScratchOutput.error}</div>
                  )}
                </div>
              )}
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
        <div ref={markdownPreviewRef} tabIndex={-1} className="flex-1 overflow-auto p-5 outline-none" onClick={handleMarkdownClick}>
          {displayMarkdownHtml ? (
            <div className="md-prose max-w-none" dangerouslySetInnerHTML={{ __html: displayMarkdownHtml }} />
          ) : (
            <span className="text-zinc-700 note-content text-sm">empty</span>
          )}
          {scratchPortals.map(({ id, el }) =>
            createPortal(<ScratchOutput key={id} output={scratchOutputs[id]} />, el)
          )}
        </div>
      )}
      {mode === 'sqlite' && (
        sqliteAssetRef ? (
          <SQLiteViewer
            assetId={sqliteAssetRef.assetId}
            llmEnabled={llmEnabled}
            agentToken={agentToken}
            ollamaModel={ollamaModel}
          />
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
          llmEnabled={llmEnabled}
          agentToken={agentToken}
          ollamaModel={ollamaModel}
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
          onCreateOpenApiNote={onCreateOpenApiNote}
        />
      )}
      {mode === 'gitpr' && gitPRLoading && (
        <div className="h-full flex flex-col bg-zinc-950">
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
            <span className="font-mono text-[11px] text-zinc-500 shrink-0">
              PR #{gitPRViewButtonData?.prNumber ?? ''}
            </span>
            <span className="text-sm font-medium text-zinc-200 truncate">
              {gitPRViewButtonData?.repoName || 'Loading pull request'}
            </span>
            {gitPRViewButtonData?.base && (
              <span className="text-[11px] text-zinc-600 shrink-0 hidden sm:block">&lt;- {gitPRViewButtonData.base}</span>
            )}
            <button
              onClick={closeGitPRView}
              aria-label="Close PR view"
              className="ml-auto shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="flex items-center gap-3 text-zinc-400">
              <span className="w-5 h-5 rounded-full border-2 border-violet-500/30 border-t-violet-300 animate-spin" />
              <span className="text-sm font-mono">Loading PR view...</span>
            </div>
          </div>
        </div>
      )}
      {mode === 'gitpr' && !gitPRLoading && gitPRData && (
        <GitPRView
          prData={gitPRData}
          onClose={closeGitPRView}
        />
      )}
      {mode === 'shell' && (
        <ShellRunner
          key={`${note.id}-${shellInstance}`}
          noteContent={content}
          initialText={capturedShellSelRef.current}
          runTrigger={shellRunTrigger}
          onCreateNoteFromContent={onCreateNoteFromContent}
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
            {codeViewActive && isCodeOutlineLanguage(codeLanguage) && codePaneSymbols.length > 0 && (
              <span className="text-zinc-600 font-mono">{codePaneSymbols.length} symbols</span>
            )}
            {codeViewReadOnly && <span className="text-amber-500 font-mono">folded view is read-only</span>}
            {mode === 'markdown' && <span className="text-emerald-700 font-mono">markdown</span>}
            <span>{lineCount}L · {charCount}C</span>
            <span>{timeAgo(note.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
