const TIMEOUT_MS = 5000

const JS_FENCE_RE = /^```[ \t]*(javascript|typescript|js|ts|mjs|cjs)\b[^\n]*\n([\s\S]*?)^```[ \t]*$/gim

export function parseJsBlocks(text) {
  const blocks = []
  JS_FENCE_RE.lastIndex = 0
  let match
  while ((match = JS_FENCE_RE.exec(text)) !== null) {
    const lang = match[1].toLowerCase()
    const code = match[2].trimEnd()
    if (!code.trim()) continue
    blocks.push({ lang: lang === 'ts' || lang === 'typescript' ? 'typescript' : 'javascript', code })
  }
  return blocks
}

export function hasJsBlocks(text) {
  return /^```[ \t]*(javascript|typescript|js|ts|mjs|cjs)\b/im.test(text)
}

export function runJsInWorker(code, { notes, currentNote }, onMessage) {
  const src = buildWorkerSrc(notes, currentNote)
  const blob = new Blob([src], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  const worker = new Worker(url)

  const cleanup = () => {
    worker.terminate()
    URL.revokeObjectURL(url)
  }

  const timer = setTimeout(() => {
    cleanup()
    onMessage({ type: 'error', message: 'Timed out (5s)' })
  }, TIMEOUT_MS)

  worker.onmessage = ({ data }) => {
    onMessage(data)
    if (data.type === 'done' || data.type === 'error') {
      clearTimeout(timer)
      cleanup()
    }
  }

  worker.onerror = (e) => {
    clearTimeout(timer)
    cleanup()
    onMessage({ type: 'error', message: e.message ?? 'Worker error' })
  }

  worker.postMessage({ code })
  return cleanup
}

function buildWorkerSrc(notes, currentNote) {
  const notesJson = JSON.stringify(
    (notes ?? []).map(n => ({ id: n.id, content: n.content ?? '' }))
  )
  const currentJson = JSON.stringify({ id: currentNote?.id, content: currentNote?.content ?? '' })

  return `
const _notes = ${notesJson};
const _current = ${currentJson};

const jotit = {
  notes: _notes,
  currentNote: _current,
  search(query) {
    const q = String(query).toLowerCase();
    return _notes
      .filter(n => (n.content || '').toLowerCase().includes(q))
      .map(n => ({
        id: n.id,
        title: (n.content || '').split('\\n')[0].trim(),
        content: n.content,
      }));
  },
};

function fmt(a) {
  if (a === null) return 'null';
  if (a === undefined) return 'undefined';
  if (typeof a === 'object') { try { return JSON.stringify(a, null, 2); } catch { return String(a); } }
  return String(a);
}

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

self.onmessage = async function({ data: { code } }) {
  const fakeConsole = {
    log:  (...a) => self.postMessage({ type: 'log', line: a.map(fmt).join(' ') }),
    error:(...a) => self.postMessage({ type: 'log', line: '[error] ' + a.map(fmt).join(' ') }),
    warn: (...a) => self.postMessage({ type: 'log', line: '[warn] '  + a.map(fmt).join(' ') }),
    info: (...a) => self.postMessage({ type: 'log', line: a.map(fmt).join(' ') }),
  };
  try {
    const fn = new AsyncFunction('jotit', 'console', code);
    const result = await fn(jotit, fakeConsole);
    const out = result !== undefined ? fmt(result) : undefined;
    self.postMessage({ type: 'done', result: out });
  } catch(e) {
    self.postMessage({ type: 'error', message: e.message });
  }
};
`
}
