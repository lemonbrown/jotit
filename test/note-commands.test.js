import assert from 'node:assert/strict'
import { NOW_COMMAND, formatCurrentDateTime, getInlineCommandRange } from '../src/utils/noteCommands.js'

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

export default [
  ['format current date time uses local offset', testFormatCurrentDateTimeUsesLocalOffset],
  ['inline command range finds /now at cursor', testGetInlineCommandRangeFindsNowAtCursor],
  ['inline command range rejects embedded command', testGetInlineCommandRangeRejectsEmbeddedCommand],
]
