export const NOW_COMMAND = '/now'

function pad(value, width = 2) {
  return String(value).padStart(width, '0')
}

export function formatCurrentDateTime(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offset = `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    `GMT${offset}`,
  ].join(' ')
}

export function getInlineCommandRange(text, cursor, command) {
  const value = String(text ?? '')
  const end = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  const normalizedCommand = String(command ?? '')
  if (!normalizedCommand) return null

  const start = end - normalizedCommand.length
  if (start < 0 || value.slice(start, end) !== normalizedCommand) return null
  const before = start > 0 ? value[start - 1] : ''
  if (before && !/\s|[([{]/.test(before)) return null
  return { start, end }
}
