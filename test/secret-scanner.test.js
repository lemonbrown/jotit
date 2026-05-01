import assert from 'node:assert/strict'
import { contentHash, scanForSecrets } from '../src/utils/secretScanner.js'
import { scanNotesForSecrets } from '../src/hooks/useSecretScan.js'

function testDetectsOpenRouterApiKeyInPlainText() {
  const matches = scanForSecrets(`open router api key

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`)

  assert.equal(matches.length, 1)
  assert.equal(matches[0].type, 'openrouter_api_key')
  assert.equal(matches[0].label, 'OpenRouter API Key')
  assert.equal(matches[0].severity, 'high')
}

function testGlobalScanReturnsFlaggedNoteIds() {
  const notes = [
    { id: 'safe', content: 'ordinary note' },
    { id: 'flagged', content: 'password=abcdefghi123456789' },
  ]

  const result = scanNotesForSecrets(notes, true)

  assert.equal(result.flaggedCount, 1)
  assert.deepEqual([...result.flaggedNoteIds], ['flagged'])
}

function testGlobalScanSkipsClearedNoteHash() {
  const content = 'password=abcdefghi123456789'
  const notes = [
    { id: 'cleared', content, secretsClearedHash: contentHash(content) },
  ]

  const result = scanNotesForSecrets(notes, true)

  assert.equal(result.flaggedCount, 0)
  assert.deepEqual([...result.flaggedNoteIds], [])
}

export default [
  ['secret scanner detects OpenRouter API keys in plain text', testDetectsOpenRouterApiKeyInPlainText],
  ['global secret scan returns flagged note ids', testGlobalScanReturnsFlaggedNoteIds],
  ['global secret scan skips notes marked safe for current content', testGlobalScanSkipsClearedNoteHash],
]
