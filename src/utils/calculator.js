const FUNCTIONS = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  round: (n, places = 0) => {
    const f = 10 ** places
    return Math.round(n * f) / f
  },
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  log: Math.log10,
  ln: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
}

const CONSTANTS = {
  pi: Math.PI,
  e: Math.E,
}

function normalizeExpression(input) {
  return input
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[=]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(input) {
  const source = normalizeExpression(input)
  const tokens = []
  let i = 0

  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) { i++; continue }

    if (/\d|\./.test(ch)) {
      const start = i
      while (i < source.length && /[\d.]/.test(source[i])) i++
      const raw = source.slice(start, i)
      if (!/^(?:\d+\.?\d*|\.\d+)$/.test(raw)) throw new Error(`Invalid number: ${raw}`)
      tokens.push({ type: 'number', value: Number(raw) })
      continue
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = i
      while (i < source.length && /[a-zA-Z_]/.test(source[i])) i++
      tokens.push({ type: 'ident', value: source.slice(start, i).toLowerCase() })
      continue
    }

    if (ch === '*' && source[i + 1] === '*') {
      tokens.push({ type: 'op', value: '**' })
      i += 2
      continue
    }

    if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ type: ch === '(' || ch === ')' || ch === ',' ? ch : 'op', value: ch })
      i++
      continue
    }

    throw new Error(`Unexpected character: ${ch}`)
  }

  tokens.push({ type: 'eof', value: '' })
  return tokens
}

function parseExpressionTokens(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const take = () => tokens[pos++]
  const matchOp = (...ops) => peek().type === 'op' && ops.includes(peek().value)
  const startsPrimary = (token) => token.type === 'number' || token.type === 'ident' || token.type === '('

  const parsePrimary = () => {
    const token = take()
    if (token.type === 'number') return token.value

    if (token.type === 'ident') {
      if (peek().type === '(') {
        take()
        const args = []
        if (peek().type !== ')') {
          while (true) {
            args.push(parseAddSub())
            if (peek().type !== ',') break
            take()
          }
        }
        if (peek().type !== ')') throw new Error('Expected )')
        take()
        const fn = FUNCTIONS[token.value]
        if (!fn) throw new Error(`Unknown function: ${token.value}`)
        const value = fn(...args)
        if (!Number.isFinite(value)) throw new Error(`Invalid result from ${token.value}()`)
        return value
      }

      if (token.value in CONSTANTS) return CONSTANTS[token.value]
      throw new Error(`Unknown identifier: ${token.value}`)
    }

    if (token.type === '(') {
      const value = parseAddSub()
      if (peek().type !== ')') throw new Error('Expected )')
      take()
      return value
    }

    throw new Error('Expected number, function, or parenthesized expression')
  }

  const parseUnary = () => {
    if (matchOp('+')) { take(); return parseUnary() }
    if (matchOp('-')) { take(); return -parseUnary() }
    return parsePrimary()
  }

  const parsePower = () => {
    let left = parseUnary()
    if (matchOp('^', '**')) {
      take()
      left = left ** parsePower()
    }
    return left
  }

  const parsePercentPostfix = () => {
    let value = parsePower()
    while (matchOp('%')) {
      const next = tokens[pos + 1]
      if (startsPrimary(next)) break
      take()
      value /= 100
    }
    return value
  }

  const parseMulDiv = () => {
    let left = parsePercentPostfix()
    while (matchOp('*', '/', '%')) {
      const op = take().value
      const right = parsePercentPostfix()
      if (op === '*') left *= right
      else if (op === '/') left /= right
      else left %= right
    }
    return left
  }

  const parseAddSub = () => {
    let left = parseMulDiv()
    while (matchOp('+', '-')) {
      const op = take().value
      const right = parseMulDiv()
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  const value = parseAddSub()
  if (peek().type !== 'eof') throw new Error(`Unexpected token: ${peek().value}`)
  if (!Number.isFinite(value)) throw new Error('Result is not finite')
  return value
}

export function formatNumber(value) {
  if (Object.is(value, -0)) return '0'
  const rounded = Math.round((value + Number.EPSILON) * 1e12) / 1e12
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(Number(rounded.toPrecision(12))).replace(/\.?0+$/, '')
}

export function evaluateExpression(input) {
  const expression = normalizeExpression(input)
  if (!expression) throw new Error('No expression to calculate')
  return parseExpressionTokens(tokenize(expression))
}

function expressionFromLine(line) {
  const beforeEquals = line.includes('=') ? line.slice(0, line.lastIndexOf('=')) : line
  const colon = beforeEquals.lastIndexOf(':')
  const expression = colon === -1 ? beforeEquals : beforeEquals.slice(colon + 1)
  return expression.trim()
}

function completeEqualsLine(line) {
  if (!/=\s*$/.test(line)) return line
  const expression = expressionFromLine(line)
  const result = formatNumber(evaluateExpression(expression))
  return `${line.replace(/\s*$/, '')} ${result}`
}

function numericValue(line) {
  const trimmed = line.trim()
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed.replace(/,/g, ''))) return null
  return Number(trimmed.replace(/,/g, ''))
}

export function analyzeCalculation(input) {
  const text = input.trim()
  if (!text) throw new Error('No expression to calculate')

  const lines = input.split(/\r?\n/)
  const nonEmpty = lines.filter(line => line.trim())
  const equalsLines = nonEmpty.filter(line => /=\s*$/.test(line))

  if (equalsLines.length > 0) {
    const replacement = lines.map(line => line.trim() ? completeEqualsLine(line) : line).join('\n')
    return {
      mode: 'equals-lines',
      title: `${equalsLines.length} line${equalsLines.length === 1 ? '' : 's'} completed`,
      expression: input,
      resultText: replacement,
      replacementText: replacement,
      appendText: null,
    }
  }

  if (nonEmpty.length > 1) {
    const values = nonEmpty.map(numericValue)
    if (values.every(v => v !== null)) {
      const sum = values.reduce((a, b) => a + b, 0)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const avg = sum / values.length
      const resultText = [
        `sum = ${formatNumber(sum)}`,
        `avg = ${formatNumber(avg)}`,
        `min = ${formatNumber(min)}`,
        `max = ${formatNumber(max)}`,
        `count = ${values.length}`,
      ].join('\n')
      return {
        mode: 'numeric-block',
        title: `${values.length} numbers`,
        expression: input,
        resultText,
        replacementText: formatNumber(sum),
        appendText: `\n${resultText}`,
      }
    }
  }

  const expression = nonEmpty.length > 1 ? nonEmpty.join(' ') : expressionFromLine(input)
  const result = formatNumber(evaluateExpression(expression))
  return {
    mode: nonEmpty.length > 1 ? 'multiline-expression' : 'expression',
    title: 'calculated',
    expression,
    resultText: result,
    replacementText: result,
    appendText: input.includes('=') ? ` ${result}` : ` = ${result}`,
  }
}
