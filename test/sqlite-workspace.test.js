import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

import { buildSQLiteMarker, extractSQLiteAssetRef } from '../src/utils/sqliteNote.js'
import { buildSelectAllQuery, executeSQLiteQueryCore, inspectSQLiteDatabaseCore, readSQLiteTableCore, updateSQLiteRowCore, validateSelectQuery } from '../src/utils/externalSqliteCore.js'
import { importFiles } from '../src/utils/importNotes.js'

function createExec(db) {
  return async (sql) => db.prepare(sql).all()
}

function createExecDetailed(db) {
  return async (sql) => {
    const statement = db.prepare(sql)
    const rows = statement.all()
    return {
      columns: statement.columns().map(column => column.name),
      rows,
    }
  }
}

function createRun(db) {
  return async (sql, params = []) => {
    db.prepare(sql).run(...params)
  }
}

function createTextFile(name, text) {
  return {
    name,
    size: text.length,
    async text() { return text },
  }
}

function createSqliteFile(name, bytes) {
  return {
    name,
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

const tests = []

tests.push([
  'sqlite note markers build and extract asset references',
  async () => {
    const marker = buildSQLiteMarker('asset_123')
    assert.equal(marker, '[sqlite://asset_123]')
    assert.deepEqual(extractSQLiteAssetRef(`db note\n${marker}`), { assetId: 'asset_123' })
    assert.equal(extractSQLiteAssetRef('plain note with no marker'), null)
  },
])

tests.push([
  'inspectSQLiteDatabaseCore returns tables views and row counts',
  async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO users (name) VALUES ('Ada'), ('Linus');
      CREATE TABLE audit_log (id INTEGER PRIMARY KEY, action TEXT);
      INSERT INTO audit_log (action) VALUES ('create');
      CREATE VIEW user_names AS SELECT name FROM users;
    `)

    const result = await inspectSQLiteDatabaseCore(createExec(db))
    assert.equal(result.tableCount, 2)
    assert.equal(result.viewCount, 1)

    const users = result.objects.find(entry => entry.name === 'users')
    const auditLog = result.objects.find(entry => entry.name === 'audit_log')
    const userNames = result.objects.find(entry => entry.name === 'user_names')

    assert.equal(users?.type, 'table')
    assert.equal(users?.rowCount, 2)
    assert.equal(auditLog?.rowCount, 1)
    assert.equal(userNames?.type, 'view')
    assert.equal(userNames?.rowCount, null)

    db.close()
  },
])

tests.push([
  'readSQLiteTableCore pages rows and returns columns',
  async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, team TEXT);
      INSERT INTO users (name, team) VALUES
        ('Ada', 'platform'),
        ('Linus', 'kernel'),
        ('Grace', 'compiler');
    `)

    const page = await readSQLiteTableCore(createExec(db), 'users', 2, 1)
    assert.deepEqual(page.columns, ['id', 'name', 'team'])
    assert.equal(page.totalRows, 3)
    assert.equal(page.rows.length, 2)
    assert.equal(page.rows[0].name, 'Linus')
    assert.equal(page.rows[1].name, 'Grace')

    db.close()
  },
])

tests.push([
  'readSQLiteTableCore reads views like tables',
  async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO users (name) VALUES ('Ada'), ('Linus');
      CREATE VIEW user_names AS SELECT name FROM users;
    `)

    const page = await readSQLiteTableCore(createExec(db), 'user_names', 10, 0)
    assert.deepEqual(page.columns, ['name'])
    assert.equal(page.totalRows, 2)
    assert.equal(page.rows.length, 2)
    assert.equal(page.rows[0].name, 'Ada')
    assert.equal(page.rows[1].name, 'Linus')

    db.close()
  },
])

tests.push([
  'validateSelectQuery only allows single select statements',
  async () => {
    assert.equal(validateSelectQuery('  SELECT * FROM users;  '), 'SELECT * FROM users')
    assert.throws(() => validateSelectQuery(''), /Enter a SELECT query/)
    assert.throws(() => validateSelectQuery('DELETE FROM users'), /Only a single SELECT statement/)
    assert.throws(() => validateSelectQuery('SELECT 1; SELECT 2'), /Only a single SELECT statement/)
  },
])

tests.push([
  'buildSelectAllQuery quotes identifiers safely',
  async () => {
    assert.equal(buildSelectAllQuery('team"members'), 'SELECT * FROM "team""members" LIMIT 100')
  },
])

tests.push([
  'executeSQLiteQueryCore returns columns for empty result sets',
  async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO users (name) VALUES ('Ada');
    `)

    const result = await executeSQLiteQueryCore(createExecDetailed(db), 'SELECT id, name FROM users WHERE 1 = 0')
    assert.deepEqual(result.columns, ['id', 'name'])
    assert.deepEqual(result.rows, [])
    assert.equal(result.rowCount, 0)

    db.close()
  },
])

tests.push([
  'updateSQLiteRowCore updates simple table rows by rowid',
  async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, team TEXT);
      INSERT INTO users (name, team) VALUES ('Ada', 'platform');
    `)

    const result = await updateSQLiteRowCore(createExec(db), createRun(db), 'users', 1, {
      name: 'Grace',
      team: 'compiler',
    })

    assert.equal(result.editable, true)
    assert.equal(result.row.name, 'Grace')
    assert.equal(result.row.team, 'compiler')

    const persisted = db.prepare('SELECT name, team FROM users WHERE id = 1').get()
    assert.deepEqual(persisted, { name: 'Grace', team: 'compiler' })

    db.close()
  },
])

tests.push([
  'updateSQLiteRowCore rejects tables without editable rowid path',
  async () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE user_roles (
        user_id INTEGER NOT NULL,
        role_id INTEGER NOT NULL,
        name TEXT,
        PRIMARY KEY (user_id, role_id)
      ) WITHOUT ROWID;
      INSERT INTO user_roles (user_id, role_id, name) VALUES (1, 2, 'admin');
    `)

    await assert.rejects(
      () => updateSQLiteRowCore(createExec(db), createRun(db), 'user_roles', 1, { name: 'owner' }),
      /does not support constrained row editing/
    )

    db.close()
  },
])

tests.push([
  'importFiles treats sqlite files as linked sqlite notes instead of text notes',
  async () => {
    const createdAssets = []
    const upserted = []
    const notes = await importFiles(
      [createSqliteFile('sample.sqlite', new Uint8Array([83, 81, 76, 105]))],
      1024,
      {
        makeId: () => 'asset-1',
        async createSqliteAsset(file, assetId) {
          createdAssets.push({ fileName: file.name, assetId })
        },
        createSqliteNote(fileName, assetId) {
          return {
            id: 'note-1',
            content: `${fileName}\n[sqlite://${assetId}]`,
            categories: ['sqlite'],
          }
        },
        upsertNote(note) {
          upserted.push(note)
        },
      }
    )

    assert.equal(createdAssets.length, 1)
    assert.deepEqual(createdAssets[0], { fileName: 'sample.sqlite', assetId: 'asset-1' })
    assert.equal(notes.length, 1)
    assert.equal(notes[0].id, 'note-1')
    assert.ok(notes[0].content.includes('[sqlite://asset-1]'))
    assert.deepEqual(upserted, notes)
  },
])

export default tests
