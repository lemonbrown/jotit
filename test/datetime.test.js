import assert from 'node:assert/strict'
import { detectDateTimeInstant, getDateTimeCommandOptions } from '../src/utils/transforms.js'

async function testDetectDateTimeWithOffset() {
  const detected = detectDateTimeInstant('2026-04-28 14:30:00 -05:00')

  assert.equal(detected.source, 'datetime')
  assert.equal(detected.date.toISOString(), '2026-04-28T19:30:00.000Z')
}

async function testDateTimeOptionsIncludeLocalUtcAndEpochs() {
  const detected = detectDateTimeInstant('2026-04-28T19:30:00Z')
  const options = getDateTimeCommandOptions(detected.date)

  assert.equal(options.timezoneOptions[0].label, 'Local')
  assert.equal(options.timezoneOptions[0].isUser, true)
  assert.ok(options.timezoneOptions.some(option => option.iana === 'UTC' && option.value.includes('2026-04-28 19:30:00')))
  assert.ok(options.timestampOptions.some(option => option.label === 'epoch sec' && option.value === '1777404600'))
  assert.ok(options.timestampOptions.some(option => option.label === 'epoch ms' && option.value === '1777404600000'))
}

async function testDetectEpochMilliseconds() {
  const detected = detectDateTimeInstant('1777404600000')

  assert.equal(detected.source, 'timestamp')
  assert.equal(detected.date.toISOString(), '2026-04-28T19:30:00.000Z')
}

export default [
  ['detect datetime with offset', testDetectDateTimeWithOffset],
  ['datetime options include local UTC and epochs', testDateTimeOptionsIncludeLocalUtcAndEpochs],
  ['detect epoch milliseconds', testDetectEpochMilliseconds],
]
