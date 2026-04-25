export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

const HIDDEN_ROW_ID = '__jotit_rowid'

function columnsFromRows(rows) {
  return rows.length ? Object.keys(rows[0]) : []
}

function normalizeStatement(sql = '') {
  return String(sql).trim().replace(/;+$/u, '').trim()
}

export function buildSelectAllQuery(name) {
  return `SELECT * FROM ${quoteIdent(name)} LIMIT 100`
}

export function validateSelectQuery(sql) {
  const statement = normalizeStatement(sql)

  if (!statement) {
    throw new Error('Enter a SELECT query.')
  }

  if (!/^select\b/i.test(statement)) {
    throw new Error('Only a single SELECT statement is supported in query mode.')
  }

  if (statement.includes(';')) {
    throw new Error('Only a single SELECT statement is supported in query mode.')
  }

  return statement
}

export async function inspectSQLiteDatabaseCore(execute) {
  const objects = await execute(`
    SELECT name, type, sql
    FROM sqlite_master
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `)

  const enriched = []
  for (const entry of objects) {
    if (entry.type !== 'table') {
      enriched.push({ ...entry, rowCount: null })
      continue
    }

    try {
      const rows = await execute(`SELECT COUNT(*) AS row_count FROM ${quoteIdent(entry.name)}`)
      enriched.push({ ...entry, rowCount: rows[0]?.row_count ?? 0 })
    } catch {
      enriched.push({ ...entry, rowCount: null })
    }
  }

  return {
    objects: enriched,
    tableCount: enriched.filter(entry => entry.type === 'table').length,
    viewCount: enriched.filter(entry => entry.type === 'view').length,
  }
}

async function getTableColumns(execute, tableName) {
  const safeTable = quoteIdent(tableName)
  const rows = await execute(`PRAGMA table_info(${safeTable})`)
  return rows.map(row => ({
    cid: row.cid,
    name: row.name,
    type: row.type ?? '',
    notNull: row.notnull === 1,
    defaultValue: row.dflt_value ?? null,
    isPrimaryKey: row.pk > 0,
  }))
}

export async function readSQLiteTableCore(execute, tableName, limit = 100, offset = 0) {
  const safeTable = quoteIdent(tableName)
  const columnInfo = await getTableColumns(execute, tableName)
  let rows = []
  let editable = false

  try {
    rows = await execute(`SELECT rowid AS ${quoteIdent(HIDDEN_ROW_ID)}, * FROM ${safeTable} LIMIT ${Math.max(1, limit)} OFFSET ${Math.max(0, offset)}`)
    editable = true
  } catch {
    rows = await execute(`SELECT * FROM ${safeTable} LIMIT ${Math.max(1, limit)} OFFSET ${Math.max(0, offset)}`)
  }

  const rowCountRows = await execute(`SELECT COUNT(*) AS row_count FROM ${safeTable}`)
  const columns = columnsFromRows(rows).filter(column => column !== HIDDEN_ROW_ID)
  return {
    columns,
    rows,
    totalRows: rowCountRows[0]?.row_count ?? rows.length,
    rowIdColumn: editable ? HIDDEN_ROW_ID : null,
    editable,
    columnInfo,
  }
}

export async function executeSQLiteQueryCore(executeDetailed, sql) {
  const statement = validateSelectQuery(sql)
  const result = await executeDetailed(statement)

  return {
    sql: statement,
    columns: result.columns ?? [],
    rows: result.rows ?? [],
    rowCount: result.rows?.length ?? 0,
  }
}

function normalizeEditedValue(value, column) {
  if (value == null) return null

  const trimmedType = String(column?.type ?? '').trim().toUpperCase()
  if (trimmedType.includes('INT')) {
    if (value === '') return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Column "${column.name}" expects a numeric value.`)
    }
    return parsed
  }

  if (trimmedType.includes('REAL') || trimmedType.includes('FLOA') || trimmedType.includes('DOUB') || trimmedType.includes('NUM')) {
    if (value === '') return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Column "${column.name}" expects a numeric value.`)
    }
    return parsed
  }

  return value
}

export async function updateSQLiteRowCore(execute, run, tableName, rowId, values = {}) {
  const safeTable = quoteIdent(tableName)
  const columnInfo = await getTableColumns(execute, tableName)

  let canUseRowId = true
  try {
    await execute(`SELECT rowid AS ${quoteIdent(HIDDEN_ROW_ID)} FROM ${safeTable} LIMIT 1`)
  } catch {
    canUseRowId = false
  }

  if (!canUseRowId) {
    throw new Error('This table does not support constrained row editing.')
  }

  const editableColumns = columnInfo.filter(column => !column.isPrimaryKey)
  const assignments = []
  const params = []

  for (const column of editableColumns) {
    if (!(column.name in values)) continue
    assignments.push(`${quoteIdent(column.name)} = ?`)
    params.push(normalizeEditedValue(values[column.name], column))
  }

  if (!assignments.length) {
    throw new Error('No editable column changes were provided.')
  }

  params.push(rowId)
  run(`UPDATE ${safeTable} SET ${assignments.join(', ')} WHERE rowid = ?`, params)

  const rows = await execute(`SELECT rowid AS ${quoteIdent(HIDDEN_ROW_ID)}, * FROM ${safeTable} WHERE rowid = ${Number(rowId)}`)
  const row = rows[0] ?? null

  return {
    row,
    columns: columnInfo,
    editable: true,
    rowIdColumn: HIDDEN_ROW_ID,
  }
}
