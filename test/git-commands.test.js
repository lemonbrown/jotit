import assert from 'node:assert/strict'
import { getGitCommandSuggestions, getGitCommandTrigger, parseGitCommand, parsePrCommand } from '../src/utils/gitCommands.js'

async function testParseConnectWithWindowsPath() {
  assert.deepEqual(
    parseGitCommand('/git connect "C:\\Users\\cambr\\source\\repos\\my-repo"'),
    {
      command: 'connect',
      path: 'C:\\Users\\cambr\\source\\repos\\my-repo',
    }
  )
}

async function testParseUseWithDefaultFlag() {
  assert.deepEqual(parseGitCommand('/git use my-repo --default'), {
    command: 'use',
    repoId: 'my-repo',
    setDefault: true,
  })
}

async function testParseStatusWithExplicitRepo() {
  assert.deepEqual(parseGitCommand('/git status api'), {
    command: 'status',
    repoId: 'api',
  })
}

async function testRejectsNonGitCommand() {
  assert.equal(parseGitCommand('/now'), null)
  assert.equal(parseGitCommand('/github'), null)
}

async function testParsePrDraft() {
  assert.deepEqual(parsePrCommand('/pr draft my-repo'), {
    command: 'draft',
    repoId: 'my-repo',
  })
}

async function testGitTriggerFindsCurrentLineCommand() {
  assert.deepEqual(getGitCommandTrigger('one\n/git sta', 12), {
    start: 4,
    end: 12,
    query: 'sta',
  })
}

async function testGitSuggestionsFilterCommands() {
  assert.deepEqual(getGitCommandSuggestions('st').map(item => item.command), ['status'])
}

async function testGitSuggestionsReturnReposForUse() {
  const suggestions = getGitCommandSuggestions('use ap', [
    { id: 'api', name: 'api', branch: 'main', path: 'C:\\repo\\api' },
    { id: 'web', name: 'web', branch: 'main', path: 'C:\\repo\\web' },
  ])

  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].insertText, '/git use api')
}

export default [
  ['git command parses quoted connect path', testParseConnectWithWindowsPath],
  ['git command parses use default flag', testParseUseWithDefaultFlag],
  ['git command parses explicit status repo', testParseStatusWithExplicitRepo],
  ['git command rejects other slash commands', testRejectsNonGitCommand],
  ['pr command parses draft repo', testParsePrDraft],
  ['git trigger finds current line command', testGitTriggerFindsCurrentLineCommand],
  ['git suggestions filter commands', testGitSuggestionsFilterCommands],
  ['git suggestions return repos for use', testGitSuggestionsReturnReposForUse],
]
