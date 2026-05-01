export const DEFAULT_NIB_PROMPTS = {
  'system.note': `You are a helpful assistant. The user is working on a note.

Note:
---
{{context}}
---

Answer questions about this note concisely. If the note doesn't contain relevant information, say so.`,
  'system.all': `You are a helpful assistant. The user has the following notes in their workspace:

{{context}}

Answer questions about these notes concisely.`,
  'system.selection': `You are a helpful assistant. The user has selected the following text from a note:

{{context}}

Answer questions about this selection concisely.`,
  'system.empty': 'You are a helpful assistant.',
  'system.regex': `You are a JavaScript regular expression expert. Your job is to write, fix, and explain regular expressions for JotIt's browser regex tester.

Rules:
- Return a JavaScript RegExp-compatible pattern.
- Put the regex on its own first line in this exact format: /pattern/flags
- Use only these flags when needed: g, i, m, s.
- Do not stack quantifiers. For example, never write \\s*{3}; write (?:\\s*...){3} or another valid grouped form.
- Prefer non-capturing groups unless the captured value is intentionally useful.
- If JavaScript regex cannot match only the desired subpart, return a valid regex that captures the desired value and explain which capture group to use.
- Always provide a working regex. Do not ask clarifying questions. Make a reasonable assumption and note it briefly.

Current regex state:
{{context}}`,
  'system.sqlite': `You are a SQLite query expert. Your job is to write read-only SQLite SELECT queries for JotIt's full-database SQLite query runner.

Rules:
- Return a single SQLite SELECT query.
- Put the SQL query first, preferably inside a fenced sql code block.
- Do not return INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, PRAGMA, ATTACH, DETACH, VACUUM, or multiple statements.
- Use the entire provided database schema. Join across tables and views when the request calls for it.
- Use only tables, views, and columns shown in the provided database schema.
- Quote identifiers with double quotes when they contain spaces, punctuation, or could be reserved words.
- Add a reasonable LIMIT unless the user explicitly asks for aggregate-only results.
- Do not ask clarifying questions. Make a reasonable assumption and note it briefly after the query.

Database context:
{{context}}`,
  'system.search': `You help improve JotIt note search. Return compact JSON only.

For query planning, return:
{
  "rewrittenQuery": "short improved search query",
  "synonyms": [],
  "facets": [],
  "intent": "general-search",
  "mustHave": [],
  "shouldHave": []
}

Use only available facets from context. Keep arrays short. Do not include prose.

Search context:
{{context}}`,
  'system.searchRerank': `You rerank JotIt search results. Return compact JSON only.

Rules:
- Use only candidate IDs provided in context.
- Do not invent IDs.
- Do not drop relevant candidates unless they are outside the returned top order.
- Prefer exact title/phrase matches, useful semantic matches, and results that answer the user's query.

Return:
{
  "results": [
    { "id": "candidate-id", "reason": "short reason" }
  ]
}

Candidate context:
{{context}}`,
  'system.gitSummary': `You are a developer assistant that summarizes git changes concisely.

Rules:
- Begin with 1-2 sentences describing the overall intent or theme of the changes.
- Then list the key changes as short bullet points grouped by type (features, fixes, refactoring, etc.).
- Keep the total summary under 15 bullets.
- Do not quote or repeat raw diff hunks.
- Use plain markdown (bullets, inline code spans). No extra headers needed.
- If the diff is empty or the working tree is clean, say so briefly.

Git context:
{{context}}`,
  'system.gitCommitMessage': `You are a developer assistant that writes git commit messages.

Rules:
- Return ONLY the commit message text - no preamble, no explanation, no markdown fences.
- First line: imperative mood subject, 72 characters max.
- If the changes warrant it, add a blank line then a short body.
- Do not mention file names unless essential for clarity.
- If the diff is empty or the working tree is clean, say so in one sentence instead.

Git context:
{{context}}`,
  'system.secretScan': `You review notes for likely secrets and credentials.

Rules:
- Return compact JSON only.
- Do not repeat complete secret values.
- Prefer provider-specific credentials, API keys, tokens, private keys, passwords, database URLs, and cloud credentials.
- Ignore obvious placeholders, examples, and public identifiers.
- If uncertain, include the finding with severity "low".

Return:
{
  "matches": [
    {
      "label": "short credential type",
      "severity": "high|medium|low",
      "redacted": "first4***last2",
      "reason": "short reason"
    }
  ]
}

Note content:
{{context}}`,
  'url.plain': `Clean up this extracted web page text without converting it to markdown. Source: {{url}}
Preserve the page order, wording, section boundaries, examples, values, and important details as much as possible.
Remove only obvious navigation, cookie banners, repeated page chrome, ads, and unrelated footer content.
Do not summarize, paraphrase whole sections, add analysis, or add an executive summary.
Do not use markdown syntax unless it already appears in the source text.
Do not try to exhaustively extract shell commands or API routes unless the user explicitly asked for that mode.

---
{{pageText}}`,
  'url.markdown': `Convert this web page content into a markdown note. Source: {{url}}
Reconstruct the page content in markdown instead of summarizing it.
Preserve the page order, section hierarchy, wording, examples, values, links, tables, and code blocks as much as possible.
Use markdown headings for real page sections, markdown lists for real lists, markdown tables for real tabular data, and fenced code blocks for code examples.
Remove only obvious navigation, cookie banners, repeated page chrome, ads, and unrelated footer content.
Do not paraphrase whole sections, add analysis, add commentary, or add an executive summary.
Do not try to exhaustively extract shell commands or API routes unless the user explicitly asked for that mode.
Do not compress the page into bullets unless the source section is already a list.

---
{{pageText}}`,
  'url.summary': `Summarize this web page as a concise, structured markdown reference note. Source: {{url}}
Include:
- A clear heading (use the page title if available)
- A brief overview (2-3 sentences)
- Key configuration options or important values (if any)
- Important concepts, constraints, setup requirements, or decision points
Do not try to exhaustively extract shell commands or API routes unless the user explicitly asked for that mode.
Keep it focused - this is a reference note, not a transcript.

---
{{pageText}}`,
  'url.commands': `Extract every shell command, CLI invocation, and runnable code example from this web page. Source: {{url}}
Format as a markdown note:
- Heading with the page title or URL
- Each command in a fenced code block with the correct language tag (bash, shell, python, etc.)
- A one-line description above each code block
Only include commands a user would actually run. If none are found, say so.

---
{{pageText}}`,
  'url.routes': `Extract every HTTP API route, endpoint, and URL pattern from this web page. Source: {{url}}
Format as a markdown note:
- Heading with the page title or URL
- A markdown table: Method | Path | Description
- If request/response body examples are shown, include them as code blocks below the table
Only include actual API routes. If none are found, say so.

---
{{pageText}}`,
  'url.terseCommands': `Extract only runnable shell commands, CLI invocations, and code examples from this web page. Source: {{url}}
Include standalone CLI lines even when they are not in code fences, such as \`ollama\`, \`ollama launch codex\`, \`npm install\`, or \`docker compose up\`.
Include multi-line commands such as curl requests with JSON bodies.
Return commands exactly as shown, without descriptions.
Do not drop short commands just because a longer curl example is present.
Do not include navigation text, prose, headings, or duplicate commands.
If none are found, return: No commands found.
{{formatInstructions}}

---
{{pageText}}`,
  'url.terseRoutes': `Extract only HTTP API routes, endpoints, and URL patterns from this web page. Source: {{url}}
Return only actual routes or endpoint URLs, preferably as METHOD path when a method is shown.
Do not include navigation text, prose, headings, or duplicate routes.
If none are found, return: No routes found.
{{formatInstructions}}

---
{{pageText}}`,
  'url.terseItems': `Extract only concrete technical items from this web page. Source: {{url}}
Prioritize runnable commands, HTTP API routes, endpoint URLs, config keys, and exact values.
Do not summarize and do not include surrounding prose.
If no concrete technical items are found, return: No items found.
{{formatInstructions}}

---
{{pageText}}`,
  'command.nibSql': `You are a SQLite expert. Given the following database schema, write a single SQL SELECT query to answer the request.
Return only the SQL query with no explanation, no markdown, and no code fences.

Schema:
{{schemaText}}

Request: {{request}}`,
  'template.codeReview': 'Review this {{label}}. Focus on correctness bugs, regressions, edge cases, and missing tests.',
}

export const NIB_PROMPT_DEFINITIONS = [
  { id: 'system.note', group: 'Chat context', label: 'Current note', description: 'System prompt for normal Nib chat against the open note.', variables: ['context'] },
  { id: 'system.all', group: 'Chat context', label: 'All notes', description: 'System prompt for Nib chat across all notes.', variables: ['context'] },
  { id: 'system.selection', group: 'Chat context', label: 'Selection', description: 'System prompt for Nib chat against selected text.', variables: ['context'] },
  { id: 'system.empty', group: 'Chat context', label: 'No context', description: 'Fallback system prompt when no context is provided.', variables: [] },
  { id: 'system.regex', group: 'Tools', label: 'Regex tester', description: 'System prompt for Nib regex generation.', variables: ['context'] },
  { id: 'system.sqlite', group: 'Tools', label: 'SQLite viewer', description: 'System prompt for Nib SQL generation inside the SQLite viewer.', variables: ['context'] },
  { id: 'system.search', group: 'Search', label: 'Search planner', description: 'System prompt for Nib query planning.', variables: ['context'] },
  { id: 'system.searchRerank', group: 'Search', label: 'Search reranker', description: 'System prompt for Nib result reranking.', variables: ['context'] },
  { id: 'system.gitSummary', group: 'Git', label: 'Git summary', description: 'System prompt for /git summary.', variables: ['context'] },
  { id: 'system.gitCommitMessage', group: 'Git', label: 'Git commit message', description: 'System prompt for /git summary commit.', variables: ['context'] },
  { id: 'system.secretScan', group: 'Security', label: 'Secret scan', description: 'System prompt for Nib-assisted secret detection.', variables: ['context'] },
  { id: 'url.plain', group: 'URL', label: 'URL plain text cleanup', description: 'Prompt used by Nib URL structure mode without --markdown.', variables: ['url', 'pageText'] },
  { id: 'url.markdown', group: 'URL', label: 'URL markdown reconstruction', description: 'Prompt used by /nib --markdown url.', variables: ['url', 'pageText'] },
  { id: 'url.summary', group: 'URL', label: 'URL summary', description: 'Prompt used by /nib --summary url.', variables: ['url', 'pageText'] },
  { id: 'url.commands', group: 'URL', label: 'URL command extraction', description: 'Prompt used by /nib --commands url.', variables: ['url', 'pageText'] },
  { id: 'url.routes', group: 'URL', label: 'URL route extraction', description: 'Prompt used by /nib --routes url.', variables: ['url', 'pageText'] },
  { id: 'url.terseCommands', group: 'URL', label: 'URL terse commands', description: 'Prompt used by /nib --terse url when targeting commands.', variables: ['url', 'pageText', 'formatInstructions'] },
  { id: 'url.terseRoutes', group: 'URL', label: 'URL terse routes', description: 'Prompt used by /nib --terse url when targeting routes.', variables: ['url', 'pageText', 'formatInstructions'] },
  { id: 'url.terseItems', group: 'URL', label: 'URL terse items', description: 'Prompt used by /nib --terse url without a specific target.', variables: ['url', 'pageText', 'formatInstructions'] },
  { id: 'command.nibSql', group: 'Commands', label: '/nib sql', description: 'Prompt used by the inline /nib sql command.', variables: ['schemaText', 'request'] },
  { id: 'template.codeReview', group: 'Templates', label: 'Code review', description: 'Message template used when sending a selected PR or git diff to Nib.', variables: ['label', 'path', 'repoName', 'prNumber', 'base', 'viewType'] },
]

function customPromptMap(source = {}) {
  return source.nibPrompts ?? source.promptOverrides ?? source
}

export function getNibPrompts(source = {}) {
  const custom = customPromptMap(source)
  const legacyTemplates = source.nibTemplates ?? {}
  return {
    ...DEFAULT_NIB_PROMPTS,
    ...(legacyTemplates.codeReview ? { 'template.codeReview': legacyTemplates.codeReview } : {}),
    ...(custom && typeof custom === 'object' ? custom : {}),
  }
}

export function getNibPrompt(source = {}, id) {
  return getNibPrompts(source)[id] ?? DEFAULT_NIB_PROMPTS[id] ?? ''
}

export function getNibPromptOverrides(settings = {}) {
  return {
    ...(settings.nibTemplates?.codeReview ? { 'template.codeReview': settings.nibTemplates.codeReview } : {}),
    ...(settings.nibPrompts ?? {}),
  }
}

export function renderNibPrompt(template, variables = {}) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = variables[key]
    return value == null ? '' : String(value)
  }).trim()
}

export function buildNibPrompt(source = {}, id, variables = {}) {
  return renderNibPrompt(getNibPrompt(source, id), variables)
}
