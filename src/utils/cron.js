const FIELD_DEFS = {
  second: { min: 0, max: 59 },
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  weekday: { min: 0, max: 6 },
}

export const CRON_PRESETS = [
  { label: 'Every minute', unix: '* * * * *', azure: '0 * * * * *' },
  { label: 'Every 5 minutes', unix: '*/5 * * * *', azure: '0 */5 * * * *' },
  { label: 'Hourly', unix: '0 * * * *', azure: '0 0 * * * *' },
  { label: 'Daily 9 AM', unix: '0 9 * * *', azure: '0 0 9 * * *' },
  { label: 'Weekdays 9 AM', unix: '0 9 * * 1-5', azure: '0 0 9 * * 1-5' },
  { label: 'Monday 9 AM', unix: '0 9 * * 1', azure: '0 0 9 * * 1' },
  { label: 'First day midnight', unix: '0 0 1 * *', azure: '0 0 0 1 * *' },
]

export function parseCronExpression(expression) {
  const fields = expression.trim().split(/\s+/).filter(Boolean)
  if (fields.length === 5) {
    return {
      type: 'unix',
      fields: {
        minute: fields[0],
        hour: fields[1],
        day: fields[2],
        month: fields[3],
        weekday: fields[4],
      },
    }
  }
  if (fields.length === 6) {
    return {
      type: 'azure',
      fields: {
        second: fields[0],
        minute: fields[1],
        hour: fields[2],
        day: fields[3],
        month: fields[4],
        weekday: fields[5],
      },
    }
  }
  throw new Error('Expected 5 fields for Unix cron or 6 fields for Azure/NCRONTAB')
}

export function buildCronExpression(type, fields) {
  if (type === 'azure') {
    return [fields.second ?? '0', fields.minute, fields.hour, fields.day, fields.month, fields.weekday].join(' ')
  }
  return [fields.minute, fields.hour, fields.day, fields.month, fields.weekday].join(' ')
}

function parsePart(part, def) {
  const [rangeRaw, stepRaw] = part.split('/')
  const step = stepRaw === undefined ? 1 : Number(stepRaw)
  if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step: ${part}`)

  let start
  let end
  if (rangeRaw === '*') {
    start = def.min
    end = def.max
  } else if (rangeRaw.includes('-')) {
    const [a, b] = rangeRaw.split('-').map(Number)
    start = a
    end = b
  } else {
    start = Number(rangeRaw)
    end = Number(rangeRaw)
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < def.min || end > def.max || start > end) {
    throw new Error(`Invalid range: ${part}`)
  }

  const values = []
  for (let value = start; value <= end; value += step) values.push(value)
  return values
}

export function expandCronField(expr, fieldName) {
  const def = FIELD_DEFS[fieldName]
  if (!def) throw new Error(`Unknown field: ${fieldName}`)
  if (expr === '?') return expandCronField('*', fieldName)
  const values = new Set()
  for (const part of expr.split(',')) {
    if (!part.trim()) throw new Error(`Invalid empty field segment in ${expr}`)
    parsePart(part.trim(), def).forEach(v => values.add(v))
  }
  return [...values].sort((a, b) => a - b)
}

export function validateCronExpression(expression) {
  const parsed = parseCronExpression(expression)
  const fields = parsed.fields
  if (parsed.type === 'azure') expandCronField(fields.second, 'second')
  expandCronField(fields.minute, 'minute')
  expandCronField(fields.hour, 'hour')
  expandCronField(fields.day, 'day')
  expandCronField(fields.month, 'month')
  expandCronField(fields.weekday, 'weekday')
  return parsed
}

function matches(date, parsed, expanded) {
  return (
    (parsed.type !== 'azure' || expanded.second.includes(date.getSeconds())) &&
    expanded.minute.includes(date.getMinutes()) &&
    expanded.hour.includes(date.getHours()) &&
    expanded.day.includes(date.getDate()) &&
    expanded.month.includes(date.getMonth() + 1) &&
    expanded.weekday.includes(date.getDay())
  )
}

export function nextCronRuns(expression, count = 5, from = new Date()) {
  const parsed = validateCronExpression(expression)
  const expanded = {
    second: parsed.type === 'azure' ? expandCronField(parsed.fields.second, 'second') : [0],
    minute: expandCronField(parsed.fields.minute, 'minute'),
    hour: expandCronField(parsed.fields.hour, 'hour'),
    day: expandCronField(parsed.fields.day, 'day'),
    month: expandCronField(parsed.fields.month, 'month'),
    weekday: expandCronField(parsed.fields.weekday, 'weekday'),
  }

  const cursor = new Date(from.getTime())
  cursor.setMilliseconds(0)
  if (parsed.type === 'azure') cursor.setSeconds(cursor.getSeconds() + 1)
  else {
    cursor.setSeconds(0)
    cursor.setMinutes(cursor.getMinutes() + 1)
  }

  const runs = []
  const limit = parsed.type === 'azure' ? 366 * 24 * 60 * 60 : 366 * 24 * 60
  for (let i = 0; i < limit && runs.length < count; i++) {
    if (matches(cursor, parsed, expanded)) runs.push(new Date(cursor.getTime()))
    if (parsed.type === 'azure') cursor.setSeconds(cursor.getSeconds() + 1)
    else cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return runs
}

export function describeCronType(type) {
  return type === 'azure'
    ? 'Azure Functions NCRONTAB uses 6 fields with seconds first.'
    : 'Unix cron uses 5 fields: minute hour day month weekday.'
}
