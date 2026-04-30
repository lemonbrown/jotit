import assert from 'node:assert/strict'
import { filterStashItems, maskStashValue, resolveStashRefs, stashRef } from '../src/utils/stash.js'

const ITEMS = [
  { id: '1', key: 'apiBaseUrl', value: 'https://localhost:7081', secret: false, description: 'local api' },
  { id: '2', key: 'devToken', value: 'abc123', secret: true, description: 'bearer token' },
]

export default [
  ['Stash resolves references by key', () => {
    assert.equal(resolveStashRefs('GET {{apiBaseUrl}}/health', ITEMS), 'GET https://localhost:7081/health')
  }],
  ['Stash leaves unknown references intact', () => {
    assert.equal(resolveStashRefs('{{missing}} {{devToken}}', ITEMS), '{{missing}} abc123')
  }],
  ['Stash filters by key value and description', () => {
    assert.deepEqual(filterStashItems(ITEMS, 'token').map(item => item.key), ['devToken'])
    assert.deepEqual(filterStashItems(ITEMS, '7081').map(item => item.key), ['apiBaseUrl'])
  }],
  ['Stash formats refs and masks secrets', () => {
    assert.equal(stashRef('apiBaseUrl'), '{{apiBaseUrl}}')
    assert.equal(maskStashValue('abc123').length >= 8, true)
  }],
]
