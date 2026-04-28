const SHELL_FENCE_RE = /^```[ \t]*(bash|sh|shell|zsh|powershell|pwsh|cmd)\b[^\n]*\n([\s\S]*?)^```[ \t]*$/gim

export function parseShellBlocks(text) {
  const blocks = []
  SHELL_FENCE_RE.lastIndex = 0
  let match
  while ((match = SHELL_FENCE_RE.exec(text)) !== null) {
    const lang = match[1].toLowerCase()
    const command = match[2].trimEnd()
    if (!command.trim()) continue
    blocks.push({ lang, command })
  }
  // If no fenced blocks found, treat the whole text as a runnable command
  if (!blocks.length && text.trim()) {
    blocks.push({ lang: 'bash', command: text.trim() })
  }
  return blocks
}

export function hasShellBlocks(text) {
  return /^```[ \t]*(bash|sh|shell|zsh|powershell|pwsh|cmd)\b/im.test(text)
}
