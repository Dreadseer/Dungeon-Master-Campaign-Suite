// Verification for migration 011 and the sessions/plots/reveals data layer
// (Phase 4).
//
//   node scripts/verify-sessions.mjs
//
// Runs the app's real migration SQL — including the real importCampaignNotes
// data-preservation step, extracted from DatabaseService.js — against a real
// SQLite database via Node's built-in node:sqlite. The handler SQL is replayed
// verbatim from electron/ipc/dbHandlers.js where the assertions need it, so this
// tests the queries that actually ship rather than paraphrases of them.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const SRC = readFileSync('electron/database/DatabaseService.js', 'utf8')

let failures = 0, checks = 0
const check = (label, ok, detail = '') => {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
  return ok
}

const sqlFor = (n) => {
  const tag = 'const MIGRATION_' + String(n).padStart(3, '0') + ' = `'
  const start = SRC.indexOf(tag) + tag.length
  return SRC.slice(start, SRC.indexOf('`', start))
}

const LAST = 11

const newDb = () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, run_at DATETIME DEFAULT (datetime('now')))`)
  return db
}

const api = (db) => ({
  get: (sql, p = []) => db.prepare(sql).get(...p),
  all: (sql, p = []) => db.prepare(sql).all(...p),
  run: (sql, p = []) => { const r = db.prepare(sql).run(...p); return { lastInsertRowid: r.lastInsertRowid, changes: r.changes } },
  transaction: (fn) => fn(),
})

// The real data-preservation step, lifted out of DatabaseService.js rather than
// reimplemented — a paraphrase here would test the paraphrase.
const importCampaignNotes = (() => {
  const start = SRC.indexOf('function importCampaignNotes(db) {')
  const end = SRC.indexOf('\n}', start) + 2
  // eslint-disable-next-line no-new-func
  return new Function(`${SRC.slice(start, end)}; return importCampaignNotes`)()
})()

const applyMigration = (db, id) => {
  const guarded = id === 9 || id === 10
  if (guarded) db.exec('PRAGMA foreign_keys = OFF')
  try {
    if (guarded) db.exec('BEGIN')
    db.exec(sqlFor(id))
    if (guarded) db.exec('COMMIT')
    if (id === 11) importCampaignNotes(api(db))
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(id, 'm' + id)
  } finally {
    if (guarded) db.exec('PRAGMA foreign_keys = ON')
  }
}

const migrateTo = (db, last) => { for (let i = 1; i <= last; i++) applyMigration(db, i); return db }

// ── A. Fresh database ───────────────────────────────────────────────────────
console.log('\n=== A. Fresh database: migrations 001-011 ===\n')
{
  const db = migrateTo(newDb(), LAST)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)

  for (const t of ['sessions', 'plot_threads', 'reveals']) {
    check(`${t} table created`, tables.includes(t))
  }

  const fk = (table, col) =>
    db.prepare(`PRAGMA foreign_key_list(${table})`).all().find(f => f.from === col)

  check('sessions.campaign_id CASCADEs', fk('sessions', 'campaign_id')?.on_delete === 'CASCADE')
  check('plot_threads.opened_session_id SET NULL', fk('plot_threads', 'opened_session_id')?.on_delete === 'SET NULL')
  check('plot_threads.resolved_session_id SET NULL', fk('plot_threads', 'resolved_session_id')?.on_delete === 'SET NULL')
  check('reveals.session_id SET NULL', fk('reveals', 'session_id')?.on_delete === 'SET NULL')

  const sessionsDdl = db.prepare("SELECT sql FROM sqlite_master WHERE name='sessions'").get().sql
  check('sessions has UNIQUE(campaign_id, session_number)',
    /UNIQUE\s*\(\s*campaign_id\s*,\s*session_number\s*\)/i.test(sessionsDdl))

  const plotsDdl = db.prepare("SELECT sql FROM sqlite_master WHERE name='plot_threads'").get().sql
  check('plot_threads status CHECK covers all four states',
    ['open', 'active', 'resolved', 'abandoned'].every(v => plotsDdl.includes(`'${v}'`)))

  const revealsDdl = db.prepare("SELECT sql FROM sqlite_master WHERE name='reveals'").get().sql
  check('reveals has UNIQUE(entity_type, entity_id)',
    /UNIQUE\s*\(\s*entity_type\s*,\s*entity_id\s*\)/i.test(revealsDdl))

  check('all 11 migrations recorded',
    db.prepare('SELECT COUNT(*) c FROM _migrations').get().c === 11)
  db.close()
}

// ── B. The acceptance case: three campaigns, one with a description ─────────
console.log('\n=== B. Populated database: three campaigns, one with notes ===\n')
let populated
{
  const db = migrateTo(newDb(), 10)

  db.exec(`
    INSERT INTO campaigns (id, name, description) VALUES
      (1, 'Saltmarsh', 'Session 1: the party met at the Snapping Line. Gellan hired them.'),
      (2, 'Empty Campaign', NULL),
      (3, 'Blank Notes', '   ');
    INSERT INTO locations (id, campaign_id, name, type) VALUES (1, 1, 'Saltmarsh', 'town');
    INSERT INTO npcs (id, campaign_id, name) VALUES (1, 1, 'Gellan Primewater');
    INSERT INTO compendium_custom (id, campaign_id, type, name, data, source)
      VALUES (1, 1, 'lore', 'The Sea Ghosts', '{"content":"A smuggling ring operating out of the abandoned alchemist house.","category":"faction","is_secret":true}', 'custom');
  `)

  const before = db.prepare('SELECT id, description FROM campaigns ORDER BY id').all()

  applyMigration(db, 11)

  const sessions = db.prepare('SELECT * FROM sessions ORDER BY id').all()
  check('exactly ONE session was imported', sessions.length === 1, `got ${sessions.length}`)
  check('  it belongs to the campaign that had a description', sessions[0]?.campaign_id === 1)
  check('  it is session_number 1', sessions[0]?.session_number === 1)
  check('  it is titled "Imported notes"', sessions[0]?.title === 'Imported notes')
  check('  it carries the original text verbatim',
    sessions[0]?.notes === 'Session 1: the party met at the Snapping Line. Gellan hired them.')

  const after = db.prepare('SELECT id, description FROM campaigns ORDER BY id').all()
  check('campaigns.description is left INTACT — copy, not move',
    JSON.stringify(before) === JSON.stringify(after))

  check('a campaign with NULL description got no session',
    !sessions.some(s => s.campaign_id === 2))
  check('a campaign with whitespace-only description got no session',
    !sessions.some(s => s.campaign_id === 3))

  check('session_count was corrected for the imported campaign',
    db.prepare('SELECT session_count FROM campaigns WHERE id=1').get().session_count === 1)

  // Idempotence: the migration must not double-import if re-run.
  importCampaignNotes(api(db))
  check('re-running the import creates no second session',
    db.prepare('SELECT COUNT(*) c FROM sessions').get().c === 1)

  populated = db
}

// ── C. The handler SQL, replayed from dbHandlers.js ─────────────────────────
console.log('\n=== C. Sessions: create increments the count ===\n')
{
  const db = populated
  const dbApi = api(db)

  // Mirrors db:sessions:create — derive the number, insert, recount.
  const createSession = (campaignId, title) => {
    const next = (dbApi.get('SELECT MAX(session_number) AS n FROM sessions WHERE campaign_id = ?',
      [campaignId])?.n ?? 0) + 1
    const result = dbApi.run(
      `INSERT INTO sessions (campaign_id, session_number, title, notes, created_at)
       VALUES (?,?,?,?,datetime('now'))`,
      [campaignId, next, title ?? `Session ${next}`, ''])
    dbApi.run(`UPDATE campaigns SET session_count = (SELECT COUNT(*) FROM sessions WHERE campaign_id = ?) WHERE id = ?`,
      [campaignId, campaignId])
    return { id: Number(result.lastInsertRowid), session_number: next }
  }

  const s2 = createSession(1, 'Into the Haunted House')
  const s3 = createSession(1, 'The Alchemist Returns')
  check('session numbers increment', s2.session_number === 2 && s3.session_number === 3)
  check('the campaign card would read "3 sessions"',
    db.prepare('SELECT session_count FROM campaigns WHERE id=1').get().session_count === 3,
    `got ${db.prepare('SELECT session_count FROM campaigns WHERE id=1').get().session_count}`)

  // UNIQUE(campaign_id, session_number) must stop a duplicate number.
  let rejected = false
  try {
    dbApi.run('INSERT INTO sessions (campaign_id, session_number, title) VALUES (1, 3, ?)', ['dupe'])
  } catch { rejected = true }
  check('a duplicate session_number in the same campaign is REFUSED', rejected)

  // ...but the same number in another campaign is fine.
  dbApi.run("INSERT INTO campaigns (id, name) VALUES (9, 'Other')")
  let allowed = true
  try {
    dbApi.run('INSERT INTO sessions (campaign_id, session_number, title) VALUES (9, 3, ?)', ['fine'])
  } catch { allowed = false }
  check('the same number in a DIFFERENT campaign is allowed', allowed)

  check('getCurrent returns the highest-numbered session',
    dbApi.get('SELECT * FROM sessions WHERE campaign_id = ? ORDER BY session_number DESC LIMIT 1', [1])
      ?.session_number === 3)

  // ── D. Plot threads survive session deletion ────────────────────────────
  console.log('\n=== D. Deleting a session referenced by a plot thread ===\n')

  dbApi.run(
    `INSERT INTO plot_threads (campaign_id, title, description, status, opened_session_id)
     VALUES (1, 'Who is funding the Sea Ghosts?', 'Unresolved', 'active', ?)`, [s2.id])
  const plotId = Number(dbApi.get('SELECT id FROM plot_threads').id)

  dbApi.run(`INSERT INTO reveals (campaign_id, entity_type, entity_id, session_id) VALUES (1,'lore',1,?)`, [s2.id])

  dbApi.run('DELETE FROM sessions WHERE id = ?', [s2.id])

  const plot = dbApi.get('SELECT * FROM plot_threads WHERE id = ?', [plotId])
  check('the plot thread SURVIVES the session delete', !!plot)
  check('  its opened_session_id is now NULL', plot?.opened_session_id === null)
  check('  its title and status are untouched',
    plot?.title === 'Who is funding the Sea Ghosts?' && plot?.status === 'active')

  const reveal = dbApi.get("SELECT * FROM reveals WHERE entity_type='lore' AND entity_id=1")
  check('the reveal survives too — the party still knows what it was told', !!reveal)
  check('  with a NULL session_id', reveal?.session_id === null)

  dbApi.run(`UPDATE campaigns SET session_count = (SELECT COUNT(*) FROM sessions WHERE campaign_id = 1) WHERE id = 1`)
  check('session_count drops back to 2 after the delete',
    dbApi.get('SELECT session_count FROM campaigns WHERE id=1').session_count === 2)

  // ── E. Reveals ──────────────────────────────────────────────────────────
  console.log('\n=== E. Reveals ===\n')

  const revealIt = (type, id, sessionId) => dbApi.run(
    `INSERT INTO reveals (campaign_id, entity_type, entity_id, session_id, revealed_at)
     VALUES (1,?,?,?,datetime('now'))
     ON CONFLICT(entity_type, entity_id) DO UPDATE
       SET session_id = excluded.session_id, revealed_at = excluded.revealed_at`,
    [type, id, sessionId ?? null])

  revealIt('npc', 1, s3.id)
  check('revealing an NPC records it',
    !!dbApi.get("SELECT 1 FROM reveals WHERE entity_type='npc' AND entity_id=1"))

  revealIt('npc', 1, s3.id)
  check('revealing the same entity twice is a no-op, not a constraint failure',
    dbApi.get("SELECT COUNT(*) c FROM reveals WHERE entity_type='npc' AND entity_id=1").c === 1)

  dbApi.run("DELETE FROM reveals WHERE entity_type='npc' AND entity_id=1")
  check('unrevealing removes it',
    !dbApi.get("SELECT 1 FROM reveals WHERE entity_type='npc' AND entity_id=1"))

  check('an NPC and a location may share an id without colliding', (() => {
    revealIt('npc', 5, null)
    revealIt('location', 5, null)
    return dbApi.get("SELECT COUNT(*) c FROM reveals WHERE entity_id=5").c === 2
  })())

  // ── E2. Deleting an entity clears its reveals (Phase 4.5) ───────────────
  console.log('\n=== E2. Orphaned reveals ===\n')

  // Mirrors deleteWithPolymorphicRefs in electron/ipc/dbHandlers.js.
  const deleteWithPolymorphicRefs = (table, entityType, id) => {
    dbApi.run(`DELETE FROM connections
               WHERE (entity_a_type = ? AND entity_a_id = ?)
                  OR (entity_b_type = ? AND entity_b_id = ?)`, [entityType, id, entityType, id])
    dbApi.run('DELETE FROM mind_map_positions WHERE entity_type = ? AND entity_id = ?', [entityType, id])
    dbApi.run('DELETE FROM reveals WHERE entity_type = ? AND entity_id = ?', [entityType, id])
    return dbApi.run(`DELETE FROM ${table} WHERE id = ?`, [id])
  }

  // An NPC that is revealed, connected, and positioned on the mind map.
  dbApi.run("INSERT INTO npcs (id, campaign_id, name) VALUES (77, 1, 'Doomed NPC')")
  revealIt('npc', 77, null)
  dbApi.run(`INSERT INTO connections (campaign_id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship)
             VALUES (1, 'npc', 77, 'faction', 1, 'member of')`)
  dbApi.run("INSERT INTO mind_map_positions (campaign_id, entity_type, entity_id, x_pos, y_pos) VALUES (1,'npc',77,10,10)")

  check('setup: the NPC has a reveal, a connection and a position',
    dbApi.get("SELECT COUNT(*) c FROM reveals WHERE entity_type='npc' AND entity_id=77").c === 1 &&
    dbApi.get("SELECT COUNT(*) c FROM connections WHERE entity_a_id=77").c === 1 &&
    dbApi.get("SELECT COUNT(*) c FROM mind_map_positions WHERE entity_id=77").c === 1)

  deleteWithPolymorphicRefs('npcs', 'npc', 77)

  check('deleting the NPC leaves ZERO orphaned reveals',
    dbApi.get("SELECT COUNT(*) c FROM reveals WHERE entity_type='npc' AND entity_id=77").c === 0)
  check('  its connections are gone too',
    dbApi.get('SELECT COUNT(*) c FROM connections WHERE entity_a_id=77').c === 0)
  check('  its mind-map position is gone',
    dbApi.get('SELECT COUNT(*) c FROM mind_map_positions WHERE entity_id=77').c === 0)
  check('  the NPC itself is gone', !dbApi.get('SELECT 1 FROM npcs WHERE id=77'))

  // A different entity type that happens to share the id must be untouched.
  dbApi.run("INSERT INTO locations (id, campaign_id, name, type) VALUES (77, 1, 'Same Id Location', 'town')")
  revealIt('location', 77, null)
  dbApi.run("INSERT INTO npcs (id, campaign_id, name) VALUES (78, 1, 'Another NPC')")
  revealIt('npc', 78, null)
  deleteWithPolymorphicRefs('npcs', 'npc', 78)
  check("deleting an NPC does not touch a LOCATION with the same id",
    dbApi.get("SELECT COUNT(*) c FROM reveals WHERE entity_type='location' AND entity_id=77").c === 1)

  // ── F. Lore body search ─────────────────────────────────────────────────
  console.log('\n=== F. Searching inside a lore entry body ===\n')

  const q = '%abandoned alchemist%'
  const oldWay = dbApi.all(
    `SELECT id FROM compendium_custom WHERE campaign_id=1 AND type='lore' AND name LIKE ?`, [q])
  const newWay = dbApi.all(
    `SELECT id, name FROM compendium_custom
      WHERE campaign_id=1 AND type='lore'
        AND (name LIKE ? OR json_extract(data, '$.content') LIKE ?)`, [q, q])

  check('the OLD title-only search finds nothing', oldWay.length === 0)
  check('the new search finds the entry by its body text', newWay.length === 1, `got ${newWay.length}`)
  check('  and it is the right entry', newWay[0]?.name === 'The Sea Ghosts')

  const sessionHit = dbApi.all(
    `SELECT id FROM sessions WHERE campaign_id=1 AND (title LIKE ? OR notes LIKE ? OR recap LIKE ?)`,
    ['%Snapping Line%', '%Snapping Line%', '%Snapping Line%'])
  check('session notes are searchable too', sessionHit.length === 1)

  // ── G. Cascade on campaign delete ───────────────────────────────────────
  console.log('\n=== G. Deleting a campaign ===\n')

  dbApi.run('DELETE FROM campaigns WHERE id = 1')
  for (const t of ['sessions', 'plot_threads', 'reveals']) {
    check(`${t} rows cascaded away`,
      dbApi.get(`SELECT COUNT(*) c FROM ${t} WHERE campaign_id = 1`).c === 0)
  }
  check('the other campaigns are untouched',
    dbApi.get('SELECT COUNT(*) c FROM campaigns').c === 3)
  check('database passes foreign_key_check',
    db.prepare('PRAGMA foreign_key_check').all().length === 0)

  db.close()
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`)
process.exit(failures === 0 ? 0 : 1)
