#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const JOTIT_URL = process.env.JOTIT_URL ?? 'http://localhost:5173/app'

const EXT_TO_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'jsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', cs: 'csharp',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', html: 'html', css: 'css', sql: 'sql', xml: 'xml',
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`
  try { execSync(cmd, { stdio: 'ignore' }) } catch {}
}

async function readDocxText(filePath) {
  const require = createRequire(import.meta.url)
  const mammoth = require('mammoth')
  const { value } = await mammoth.extractRawText({ path: filePath })
  return value
}

async function openFile(filePath) {
  const resolved = path.resolve(filePath)

  if (!fs.existsSync(resolved)) {
    console.error(`jot: file not found: ${resolved}`)
    process.exit(1)
  }

  if (fs.statSync(resolved).size > 5 * 1024 * 1024) {
    console.error(`jot: file too large (max 5 MB): ${resolved}`)
    process.exit(1)
  }

  const fileName = path.basename(resolved)
  const ext = path.extname(fileName).slice(1).toLowerCase()

  let content
  if (ext === 'docx') {
    const text = await readDocxText(resolved)
    content = `${fileName}\n${text}`
  } else {
    const lang = EXT_TO_LANG[ext] ?? ''
    const fileContent = fs.readFileSync(resolved, 'utf8')
    content = `${fileName}\n\`\`\`${lang}\n${fileContent}\n\`\`\``
  }

  let delivered = false
  try {
    const res = await fetch(`${JOTIT_URL}/api/notes/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, fileName }),
    })
    const data = await res.json()
    delivered = data.delivered === true
  } catch {
    // server not running — fall through to browser open with encoded content
  }

  if (!delivered) {
    const encoded = Buffer.from(content).toString('base64url')
    openBrowser(`${JOTIT_URL}/?jot=${encoded}`)
  }
}

const arg = process.argv[2]

if (arg === 'serve') {
  import('../src/server.js')
} else if (arg) {
  openFile(arg)
} else {
  console.error('Usage:')
  console.error('  jot serve        Start the local agent (HTTP proxy)')
  console.error('  jot <file>       Open a file as a new note in jotit')
  process.exit(1)
}
