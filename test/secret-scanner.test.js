import assert from 'node:assert/strict'
import { scanForSecrets } from '../src/utils/secretScanner.js'

function testDetectsOpenRouterApiKeyInPlainText() {
  const matches = scanForSecrets(`open router api key

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`)

  assert.equal(matches.length, 1)
  assert.equal(matches[0].type, 'openrouter_api_key')
  assert.equal(matches[0].label, 'OpenRouter API Key')
  assert.equal(matches[0].severity, 'high')
}

export default [
  ['secret scanner detects OpenRouter API keys in plain text', testDetectsOpenRouterApiKeyInPlainText],
]
