import assert from 'node:assert/strict'
import { NOW_COMMAND, buildNibTemplatePrompt, formatCurrentDateTime, getInlineCommandRange, getNibCommandSuggestions, getNibCommandTrigger, normalizeTemplateForNib, parseNibCommand } from '../src/utils/noteCommands.js'
import { parseSqlCommand, getSqlDbAtTrigger, filterSqliteNotes, formatSqlResultText } from '../src/utils/sqlCommands.js'
import { buildUrlNibPrompt, buildUrlTersePrompt, stripHtmlToText } from '../src/utils/webFetch.js'

async function testFormatCurrentDateTimeUsesLocalOffset() {
  const date = new Date(2026, 3, 28, 9, 5, 7)
  const formatted = formatCurrentDateTime(date)

  assert.match(formatted, /^2026-04-28 09:05:07 GMT[+-]\d{2}:\d{2}$/)
}

async function testGetInlineCommandRangeFindsNowAtCursor() {
  assert.deepEqual(getInlineCommandRange(`Created ${NOW_COMMAND}`, 12, NOW_COMMAND), { start: 8, end: 12 })
}

async function testGetInlineCommandRangeRejectsEmbeddedCommand() {
  assert.equal(getInlineCommandRange(`prefix${NOW_COMMAND}`, 10, NOW_COMMAND), null)
}

async function testParseNibCommandOpensNib() {
  assert.deepEqual(parseNibCommand('/nib'), { command: 'ask', prompt: '', templateCommand: '', templateArgs: '', output: 'inline' })
}

async function testParseNibCommandWithPrompt() {
  assert.deepEqual(parseNibCommand('/nib summarize this'), { command: 'ask', prompt: 'summarize this', templateCommand: '', templateArgs: '', output: 'inline' })
}

async function testParseNibCommandWithTemplate() {
  assert.deepEqual(parseNibCommand('/nib !bug login fails'), { command: 'template', prompt: '', templateCommand: 'bug', templateArgs: 'login fails', output: 'inline' })
}

async function testParseNibCommandWithNewNoteFlag() {
  assert.deepEqual(parseNibCommand('/nib --note !bug login fails'), { command: 'template', prompt: '', templateCommand: 'bug', templateArgs: 'login fails', output: 'note' })
}

async function testBuildNibTemplatePrompt() {
  const prompt = buildNibTemplatePrompt({ command: 'bug', name: 'Bug report', body: 'Bug: ${1:title}' }, { args: 'checkout failure' })

  assert.match(prompt, /Draft a Bug report/)
  assert.match(prompt, /checkout failure/)
  assert.match(prompt, /Bug: \[title\]/)
  assert.doesNotMatch(prompt, /\$\{/)
}

async function testNormalizeTemplateForNibStripsTabStops() {
  assert.equal(
    normalizeTemplateForNib('${1:Title}\n\nNotes\n${5:}'),
    '[Title]\n\nNotes\n[TODO]'
  )
}

async function testNibCommandTriggerFindsPartialCommand() {
  assert.deepEqual(getNibCommandTrigger('/ni', 3), { start: 0, end: 3, query: 'ni' })
}

async function testSlashCommandTriggerFindsRootSlash() {
  assert.deepEqual(getNibCommandTrigger('/', 1), { start: 0, end: 1, query: '' })
}

async function testNibCommandTriggerSkipsTemplatePicker() {
  assert.equal(getNibCommandTrigger('/nib !bu', 8), null)
}

async function testNibCommandSuggestionsIncludeNoteFlag() {
  const suggestions = getNibCommandSuggestions('nib note')
  assert.ok(suggestions.some(item => item.insertText.includes('--note')))
}

async function testSlashCommandSuggestionsIncludeGitAndNib() {
  const labels = getNibCommandSuggestions('').map(item => item.label)
  assert.ok(labels.includes('/git'))
  assert.ok(labels.includes('/nib'))
}

async function testSlashCommandSuggestionsIncludeSql() {
  const labels = getNibCommandSuggestions('').map(item => item.label)
  assert.ok(labels.includes('/sql'))
}

async function testNibCommandParsesSqlSubcommand() {
  assert.deepEqual(
    parseNibCommand('/nib sql find all users'),
    { command: 'sql', db: null, prompt: 'find all users', templateCommand: '', templateArgs: '', output: 'panel' }
  )
}

async function testNibCommandParsesSqlSubcommandWithDb() {
  assert.deepEqual(
    parseNibCommand('/nib sql @abc123 find all users'),
    { command: 'sql', db: 'abc123', prompt: 'find all users', templateCommand: '', templateArgs: '', output: 'panel' }
  )
}

async function testNibCommandParsesSqlWithNoteFlag() {
  const result = parseNibCommand('/nib --note sql find all users')
  assert.equal(result.command, 'sql')
  assert.equal(result.output, 'note')
}

async function testNibCommandParsesSqlWithInlineFlag() {
  const result = parseNibCommand('/nib --inline sql find all users')
  assert.equal(result.command, 'sql')
  assert.equal(result.output, 'inline')
}

async function testNibCommandParsesUrlSubcommand() {
  assert.deepEqual(
    parseNibCommand('/nib url https://example.com'),
    { command: 'url', url: 'https://example.com', hint: '', markdown: false, terse: false, templateCommand: '', templateArgs: '', output: 'panel' }
  )
}

async function testNibCommandParsesUrlSubcommandHint() {
  const result = parseNibCommand('/nib url https://example.com commands')
  assert.equal(result.command, 'url')
  assert.equal(result.url, 'https://example.com')
  assert.equal(result.hint, 'commands')
  assert.equal(result.markdown, false)
  assert.equal(result.terse, false)
  assert.equal(result.output, 'panel')
}

async function testNibCommandParsesUrlWithMarkdownFlag() {
  const result = parseNibCommand('/nib --markdown url https://example.com commands')
  assert.equal(result.command, 'url')
  assert.equal(result.url, 'https://example.com')
  assert.equal(result.hint, 'commands')
  assert.equal(result.markdown, true)
  assert.equal(result.terse, false)
  assert.equal(result.output, 'panel')
}

async function testNibCommandParsesUrlWithTerseFlag() {
  const result = parseNibCommand('/nib --terse url https://example.com commands')
  assert.equal(result.command, 'url')
  assert.equal(result.url, 'https://example.com')
  assert.equal(result.hint, 'commands')
  assert.equal(result.markdown, false)
  assert.equal(result.terse, true)
  assert.equal(result.output, 'panel')
}

async function testNibCommandParsesUrlWithTerseMarkdownFlags() {
  const result = parseNibCommand('/nib --terse --markdown url https://example.com routes')
  assert.equal(result.command, 'url')
  assert.equal(result.url, 'https://example.com')
  assert.equal(result.hint, 'routes')
  assert.equal(result.markdown, true)
  assert.equal(result.terse, true)
}

async function testNibCommandParsesUrlWithNoteFlag() {
  const result = parseNibCommand('/nib --note url https://example.com')
  assert.equal(result.command, 'url')
  assert.equal(result.url, 'https://example.com')
  assert.equal(result.markdown, false)
  assert.equal(result.terse, false)
  assert.equal(result.output, 'note')
}

async function testNibCommandParsesUrlWithInlineFlag() {
  const result = parseNibCommand('/nib --inline url https://example.com routes')
  assert.equal(result.command, 'url')
  assert.equal(result.hint, 'routes')
  assert.equal(result.markdown, false)
  assert.equal(result.terse, false)
  assert.equal(result.output, 'inline')
}

async function testNibCommandParsesInlineFlagForRegularPrompt() {
  const result = parseNibCommand('/nib --inline summarize this')
  assert.equal(result.command, 'ask')
  assert.equal(result.output, 'inline')
  assert.equal(result.prompt, 'summarize this')
}

async function testStripHtmlToTextRemovesScriptAndTags() {
  const text = stripHtmlToText('<html><head><style>.x{}</style></head><body><nav>skip</nav><h1>Title</h1><script>alert(1)</script><p>Hello <b>world</b></p></body></html>')
  assert.match(text, /Title/)
  assert.match(text, /Hello/)
  assert.match(text, /world/)
  assert.doesNotMatch(text, /alert/)
  assert.doesNotMatch(text, /<h1>/)
}

async function testBuildUrlNibPromptSelectsCommandPrompt() {
  const prompt = buildUrlNibPrompt('ollama run llama3', 'https://example.com', 'commands')
  assert.match(prompt, /Extract every shell command/)
  assert.match(prompt, /ollama run llama3/)
}

async function testBuildUrlNibPromptSelectsRoutesPrompt() {
  const prompt = buildUrlNibPrompt('GET /api/tags', 'https://example.com', 'api')
  assert.match(prompt, /Extract every HTTP API route/)
  assert.match(prompt, /GET \/api\/tags/)
}

async function testBuildUrlTersePromptSelectsPlainCommandPrompt() {
  const prompt = buildUrlTersePrompt('ollama run llama3', 'https://example.com', 'commands')
  assert.match(prompt, /Extract only runnable shell commands/)
  assert.match(prompt, /Include standalone CLI lines/)
  assert.match(prompt, /Do not drop short commands/)
  assert.match(prompt, /Use plain text only/)
  assert.match(prompt, /No markdown/)
  assert.match(prompt, /ollama run llama3/)
}

async function testBuildUrlTersePromptPreservesOllamaCliExamples() {
  const prompt = buildUrlTersePrompt(
    [
      'Run ollama in your terminal to open the interactive menu:',
      'ollama',
      'Launch OpenClaw, a personal AI with 100+ skills:',
      'ollama launch openclaw',
      'Launch Claude Code and other coding tools with Ollama models:',
      'ollama launch claude',
      'ollama launch codex',
      'curl http://localhost:11434/api/chat -d \'{ "model": "gemma3" }\'',
    ].join('\n'),
    'https://docs.ollama.com/quickstart',
    'commands'
  )
  assert.match(prompt, /ollama launch openclaw/)
  assert.match(prompt, /ollama launch codex/)
  assert.match(prompt, /curl http:\/\/localhost:11434\/api\/chat/)
}

async function testBuildUrlTersePromptCanUseMinimalMarkdown() {
  const prompt = buildUrlTersePrompt('GET /api/tags', 'https://example.com', 'routes', { markdown: true })
  assert.match(prompt, /Extract only HTTP API routes/)
  assert.match(prompt, /Use minimal markdown only/)
  assert.match(prompt, /Method and Path only/)
}

async function testParseSqlCommandBasicQuery() {
  assert.deepEqual(parseSqlCommand('/sql SELECT * FROM users'), { db: null, query: 'SELECT * FROM users' })
}

async function testParseSqlCommandWithDbRef() {
  assert.deepEqual(parseSqlCommand('/sql @abc123 SELECT * FROM users'), { db: 'abc123', query: 'SELECT * FROM users' })
}

async function testParseSqlCommandRejectsOtherCommands() {
  assert.equal(parseSqlCommand('/nib foo'), null)
  assert.equal(parseSqlCommand('SELECT * FROM users'), null)
}

async function testGetSqlDbAtTriggerInSqlLine() {
  const result = getSqlDbAtTrigger('/sql @my', 8)
  assert.deepEqual(result, { atStart: 5, start: 6, end: 8, query: 'my' })
}

async function testGetSqlDbAtTriggerInNibSqlLine() {
  const result = getSqlDbAtTrigger('/nib sql @my', 12)
  assert.deepEqual(result, { atStart: 9, start: 10, end: 12, query: 'my' })
}

async function testGetSqlDbAtTriggerClosedWhenSpaceAfterAt() {
  assert.equal(getSqlDbAtTrigger('/sql @mydb SELECT', 17), null)
}

async function testFilterSqliteNotesFiltersAndMatchesQuery() {
  const notes = [
    { id: '1', content: 'my-data.db\n[sqlite://abc]' },
    { id: '2', content: 'other.db\n[sqlite://xyz]' },
    { id: '3', content: 'plain note without marker' },
  ]
  const results = filterSqliteNotes(notes, 'my')
  assert.equal(results.length, 1)
  assert.equal(results[0].id, '1')
}

async function testFormatSqlResultTextProducesTable() {
  const result = { columns: ['id', 'name'], rows: [{ id: 1, name: 'Alice' }], rowCount: 1 }
  const text = formatSqlResultText(result)
  assert.match(text, /id.*name/)
  assert.match(text, /Alice/)
  assert.match(text, /1 row/)
}

export default [
  ['format current date time uses local offset', testFormatCurrentDateTimeUsesLocalOffset],
  ['inline command range finds /now at cursor', testGetInlineCommandRangeFindsNowAtCursor],
  ['inline command range rejects embedded command', testGetInlineCommandRangeRejectsEmbeddedCommand],
  ['nib command defaults to inline output', testParseNibCommandOpensNib],
  ['nib command parses prompt', testParseNibCommandWithPrompt],
  ['nib command parses template', testParseNibCommandWithTemplate],
  ['nib command parses new note flag', testParseNibCommandWithNewNoteFlag],
  ['nib template prompt includes template and args', testBuildNibTemplatePrompt],
  ['nib template normalization strips tab stops', testNormalizeTemplateForNibStripsTabStops],
  ['nib command trigger finds partial command', testNibCommandTriggerFindsPartialCommand],
  ['slash command trigger finds root slash', testSlashCommandTriggerFindsRootSlash],
  ['nib command trigger skips template picker', testNibCommandTriggerSkipsTemplatePicker],
  ['nib command suggestions include note flag', testNibCommandSuggestionsIncludeNoteFlag],
  ['slash command suggestions include git and nib', testSlashCommandSuggestionsIncludeGitAndNib],
  ['slash command suggestions include sql', testSlashCommandSuggestionsIncludeSql],
  ['nib command parses sql subcommand', testNibCommandParsesSqlSubcommand],
  ['nib command parses sql subcommand with db ref', testNibCommandParsesSqlSubcommandWithDb],
  ['nib command parses sql --note flag', testNibCommandParsesSqlWithNoteFlag],
  ['nib command parses sql --inline flag', testNibCommandParsesSqlWithInlineFlag],
  ['nib command parses url subcommand', testNibCommandParsesUrlSubcommand],
  ['nib command parses url subcommand hint', testNibCommandParsesUrlSubcommandHint],
  ['nib command parses url --markdown flag', testNibCommandParsesUrlWithMarkdownFlag],
  ['nib command parses url --terse flag', testNibCommandParsesUrlWithTerseFlag],
  ['nib command parses url --terse --markdown flags', testNibCommandParsesUrlWithTerseMarkdownFlags],
  ['nib command parses url --note flag', testNibCommandParsesUrlWithNoteFlag],
  ['nib command parses url --inline flag', testNibCommandParsesUrlWithInlineFlag],
  ['nib command parses --inline flag for regular prompt', testNibCommandParsesInlineFlagForRegularPrompt],
  ['strip html to text removes scripts and tags', testStripHtmlToTextRemovesScriptAndTags],
  ['url nib prompt selects command mode', testBuildUrlNibPromptSelectsCommandPrompt],
  ['url nib prompt selects routes mode', testBuildUrlNibPromptSelectsRoutesPrompt],
  ['url terse prompt selects plain command mode', testBuildUrlTersePromptSelectsPlainCommandPrompt],
  ['url terse prompt preserves Ollama CLI examples', testBuildUrlTersePromptPreservesOllamaCliExamples],
  ['url terse prompt can use minimal markdown', testBuildUrlTersePromptCanUseMinimalMarkdown],
  ['/sql command parses basic query', testParseSqlCommandBasicQuery],
  ['/sql command parses with db ref', testParseSqlCommandWithDbRef],
  ['/sql command rejects other commands', testParseSqlCommandRejectsOtherCommands],
  ['sql db trigger fires in /sql line', testGetSqlDbAtTriggerInSqlLine],
  ['sql db trigger fires in /nib sql line', testGetSqlDbAtTriggerInNibSqlLine],
  ['sql db trigger closed when space follows @word', testGetSqlDbAtTriggerClosedWhenSpaceAfterAt],
  ['filterSqliteNotes filters by type and query', testFilterSqliteNotesFiltersAndMatchesQuery],
  ['formatSqlResultText produces readable table', testFormatSqlResultTextProducesTable],
]
