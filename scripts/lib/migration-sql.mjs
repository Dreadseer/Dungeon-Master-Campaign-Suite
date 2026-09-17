// Shared plumbing for the migration harnesses.
//
// DatabaseService cannot be imported under bare node: its better-sqlite3 binary
// is built for Electron's ABI. So every migration harness extracts the real
// MIGRATION_0NN template literals (and migration 011's real data-import
// function) out of the source file and replays them against Node's built-in
// node:sqlite — the same SQLite engine better-sqlite3 wraps, running the same
// SQL. It checks the SQL and the data steps, not the JavaScript around them.
//
// Used by scripts/verify-migrations.mjs (behaviour of each migration) and
// scripts/soak-migrations.mjs (a large realistic database through all of them).
// Keeping one copy of the runner rules is the point: a harness that applied
// migrations differently from the app would prove nothing.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export const SOURCE_PATH = 'electron/database/DatabaseService.js'
export const SRC = readFileSync(SOURCE_PATH, 'utf8')

/** The raw SQL of one migration, straight out of the source file. */
export const sqlFor = (n) => {
  const tag = 'const MIGRATION_' + String(n).padStart(3, '0') + ' = `'
  const start = SRC.indexOf(tag)
  if (start === -1) throw new Error(tag + ' not found')
  const from = start + tag.length
  const end = SRC.indexOf('`', from)
  return SRC.slice(from, end)
}

/**
 * Every migration id registered in DatabaseService, read from the array rather
 * than hard-coded, so a harness cannot silently stop covering the newest one.
 */
export const MIGRATION_IDS = (() => {
  const start = SRC.indexOf('const migrations = [')
  if (start === -1) throw new Error('migrations array not found')
  const end = SRC.indexOf('\n    ]', start)
  const block = SRC.slice(start, end)
  const ids = [...block.matchAll(/\{\s*id:\s*(\d+),/g)].map(m => Number(m[1]))
  if (!ids.length) throw new Error('no migration ids found')
  return ids
})()

export const LATEST = Math.max(...MIGRATION_IDS)

// How DatabaseService runs each one:
//   guarded — foreign keys OFF around a transaction, because the migration
//             recreates tables that reference each other (009, 010).
//   atomic  — a plain transaction, because a partial apply cannot be retried
//             (014: ADD COLUMN is not idempotent).
export const GUARDED = new Set(
  [...SRC.matchAll(/\{\s*id:\s*(\d+),[^}]*foreignKeysOff:\s*true/g)].map(m => Number(m[1]))
)
export const ATOMIC = new Set(
  [...SRC.matchAll(/\{\s*id:\s*(\d+),[^}]*atomic:\s*true/g)].map(m => Number(m[1]))
)

/** The db.run/get/all shape DatabaseService's own helpers expect. */
export const makeApi = (db) => ({
  run: (sql, params = []) => {
    const result = db.prepare(sql).run(...params)
    return { lastInsertRowid: result.lastInsertRowid, changes: result.changes }
  },
  get: (sql, params = []) => db.prepare(sql).get(...params),
  all: (sql, params = []) => db.prepare(sql).all(...params),
})

/**
 * Migration 011's real data step, lifted out of the source file so the import is
 * tested rather than re-implemented. It copies each campaign's description into
 * a first session — a copy, never a move, so nothing is destroyed.
 */
export const importCampaignNotes = (() => {
  const start = SRC.indexOf('function importCampaignNotes(db) {')
  if (start === -1) throw new Error('importCampaignNotes not found')
  const end = SRC.indexOf('\n}', start) + 2
  return new Function(`${SRC.slice(start, end)}; return importCampaignNotes`)()
})()

const AFTER_HOOKS = { 11: importCampaignNotes }

/** An empty in-memory database with foreign keys on and the bookkeeping table. */
export const newDb = () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, run_at DATETIME DEFAULT (datetime('now')))`)
  return db
}

/**
 * Apply one migration exactly as DatabaseService would.
 *
 * @param {object} opts.hooks  run the `after` data step (migration 011). Default true.
 * @param {boolean} opts.quiet silence the hook's console output.
 */
export const applyMigration = (db, id, opts = {}) => {
  const { hooks = true, quiet = false } = opts
  const record = () => db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(id, 'm' + id)
  const hook = hooks ? AFTER_HOOKS[id] : null

  if (GUARDED.has(id)) {
    db.exec('PRAGMA foreign_keys = OFF')
    try {
      db.exec('BEGIN')
      db.exec(sqlFor(id))
      const violations = db.prepare('PRAGMA foreign_key_check').all()
      if (violations.length) {
        db.exec('ROLLBACK')
        throw new Error(`migration ${id} left ${violations.length} FK violations`)
      }
      db.exec('COMMIT')
      record()
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
    return
  }

  if (ATOMIC.has(id) || hook) {
    db.exec('BEGIN')
    try {
      db.exec(sqlFor(id))
      if (hook) withQuiet(quiet, () => hook(makeApi(db)))
      record()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return
  }

  db.exec(sqlFor(id))
  record()
}

function withQuiet(quiet, fn) {
  if (!quiet) return fn()
  const log = console.log
  console.log = () => {}
  try { return fn() } finally { console.log = log }
}

/**
 * Bring a database up to `last`, skipping what has already run — exactly as
 * DatabaseService does, so a database can be migrated PART way, populated, and
 * then brought the rest of the way. That is the only way to test a migration
 * against rows from the old schema.
 */
export const migrateTo = (db, last = LATEST, opts = {}) => {
  const ran = new Set(db.prepare('SELECT id FROM _migrations').all().map(r => r.id))
  for (const id of MIGRATION_IDS) {
    if (id <= last && !ran.has(id)) applyMigration(db, id, opts)
  }
  return db
}

/** Table names in the database now, excluding SQLite's own and our bookkeeping. */
export const userTables = (db) =>
  db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
              AND name NOT LIKE 'sqlite_%' AND name <> '_migrations' ORDER BY name`)
    .all().map(r => r.name)

export const rowCounts = (db) =>
  Object.fromEntries(userTables(db).map(t => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]))

/** Every foreign key in the database: one row per FK column. */
export const allForeignKeys = (db) =>
  userTables(db).flatMap(table =>
    db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(fk => ({
      table,
      column: fk.from,
      parent: fk.table,
      parentColumn: fk.to ?? 'id',
      onDelete: fk.on_delete,
    })))
