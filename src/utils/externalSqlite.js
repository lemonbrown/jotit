import * as sqlJsModule from 'sql.js'
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url'
import { executeSQLiteQueryCore, inspectSQLiteDatabaseCore, readSQLiteTableCore, updateSQLiteRowCore } from './externalSqliteCore'

const initSqlJs = sqlJsModule.default ?? sqlJsModule

let sqlPromise = null

function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => sqlWasm })
  }
  return sqlPromise
}

function rowsFromResult(result) {
  if (!result?.length) return []
  const { columns, values } = result[0]
  return values.map(row => Object.fromEntries(columns.map((col, idx) => [col, row[idx]])))
}

function resultSetFromExec(result) {
  if (!result?.length) return { columns: [], rows: [] }
  const { columns, values } = result[0]
  return {
    columns,
    rows: values.map(row => Object.fromEntries(columns.map((col, idx) => [col, row[idx]]))),
  }
}

async function withDatabase(bytes, fn) {
  const SQL = await getSql()
  const db = new SQL.Database(bytes)
  try {
    return await fn(db)
  } finally {
    db.close()
  }
}

export async function inspectSQLiteDatabase(bytes) {
  return withDatabase(bytes, (db) => inspectSQLiteDatabaseCore((sql) => rowsFromResult(db.exec(sql))))
}

export async function readSQLiteTable(bytes, tableName, limit = 100, offset = 0) {
  return withDatabase(bytes, (db) => readSQLiteTableCore((sql) => rowsFromResult(db.exec(sql)), tableName, limit, offset))
}

export async function executeSQLiteQuery(bytes, sql) {
  return withDatabase(bytes, (db) => executeSQLiteQueryCore((statement) => resultSetFromExec(db.exec(statement)), sql))
}

export async function updateSQLiteRow(bytes, tableName, rowId, values) {
  return withDatabase(bytes, async (db) => {
    const result = await updateSQLiteRowCore(
      (sql) => rowsFromResult(db.exec(sql)),
      (sql, params) => db.run(sql, params),
      tableName,
      rowId,
      values
    )

    return {
      ...result,
      bytes: db.export(),
    }
  })
}
