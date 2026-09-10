// Verification harness for migration 009 (Phase 1, referential integrity).
//
//   node scripts/verify-migration-009.mjs
//
// Runs entirely on Node's built-in node:sqlite — the same SQLite engine
// better-sqlite3 wraps, executing the same DDL. DatabaseService itself cannot be
// imported under bare node because its better-sqlite3 binary is compiled for
// Electron's ABI, so this harness extracts the real MIGRATION_00N template
// literals out of the source file and replays them. It is a check of the SQL, not
// of the JavaScript around it.
//
// Two scenarios, both required by the phase rules:
//   A. a fresh database  — 001..009 applied to an empty file
//   B. a populated one   — 001..008 applied, rows inserted in every affected
//                          table, then 009 applied on top
//
// Then the acceptance cases from the phase brief are exercised as real deletes.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const SRC = readFileSync('electron/database/DatabaseService.js', 'utf8')
const LAST = 9

let failures = 0
let checks = 0

const check = (label, ok, detail = '') => {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
  return ok
}

const sqlFor = (n) => {
  const tag = 'const MIGRATION_' + String(n).padStart(3, '0') + ' = `'
  const start = SRC.indexOf(tag)
  if (start === -1) throw new Error(tag + ' not found')
  const from = start + tag.length
  const end = SRC.indexOf('`', from)
  return SRC.slice(from, end)
}

// Mirrors DatabaseService.runGuardedMigration: FKs off, transaction,
// foreign_key_check before commit, FKs back on.
const applyMigration = (db, id) => {
  const guarded = id === 9
  if (guarded) db.exec('PRAGMA foreign_keys = OFF')
  try {
    if (guarded) db.exec('BEGIN')
    db.exec(sqlFor(id))
    if (guarded) {
      const violations = db.prepare('PRAGMA foreign_key_check').all()
      if (violations.length) {
        db.exec('ROLLBACK')
        throw new Error(`migration ${id} left ${violations.length} FK violations`)
      }
      db.exec('COMMIT')
    }
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(id, 'm' + id)
  } finally {
    if (guarded) db.exec('PRAGMA foreign_keys = ON')
  }
}

const newDb = () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, run_at DATETIME DEFAULT (datetime('now')))`)
  return db
}

const migrateTo = (db, last) => {
  for (let id = 1; id <= last; id++) applyMigration(db, id)
  return db
}

const fkList = (db, table) => db.prepare(`PRAGMA foreign_key_list(${table})`).all()
const fkFor = (db, table, column) => fkList(db, table).find(f => f.from === column)
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
const ddl = (db, table) =>
  db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql

// Rows touching every table 009 rebuilds, plus the ones that reference them.
const populate = (db) => {
  db.exec(`
    INSERT INTO campaigns (id, name, description) VALUES (1, 'Saltmarsh', 'coastal');
    INSERT INTO campaigns (id, name) VALUES (2, 'Second Campaign');

    INSERT INTO factions (id, campaign_id, name, alignment) VALUES (1, 1, 'Scarlet Brotherhood', 'Lawful Evil');

    INSERT INTO locations (id, campaign_id, name, type, description, parent_location_id, has_own_map, floor_number)
      VALUES (1, 1, 'Saltmarsh', 'town', 'fishing town', NULL, 1, 0);
    INSERT INTO locations (id, campaign_id, name, type, parent_location_id, has_own_map, floor_number)
      VALUES (2, 1, 'The Snapping Line', 'shop', 1, 0, 1);
    INSERT INTO locations (id, campaign_id, name, type, parent_location_id, has_own_map, floor_number)
      VALUES (3, 1, 'Haunted House', 'dungeon', 1, 1, -1);

    INSERT INTO npcs (id, campaign_id, name, race, location_id, faction_id, is_alive)
      VALUES (1, 1, 'Anders Solmor', 'Human', 1, 1, 1);
    INSERT INTO npcs (id, campaign_id, name, race, location_id, faction_id, is_alive)
      VALUES (2, 1, 'Gellan Primewater', 'Human', 2, NULL, 1);

    INSERT INTO maps (id, campaign_id, name, location_id, image_path, grid_size, fog_data, tokens)
      VALUES (1, 1, 'Town Map', 1, 'C:/maps/town.png', 50, '[]', '[]');

    INSERT INTO encounters (id, campaign_id, name, location_id, monsters, status, xp_total, map_id)
      VALUES (1, 1, 'Dockside Ambush', 1, '[]', 'planned', 450, 1);

    INSERT INTO connections (id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, campaign_id)
      VALUES (1, 'npc', 1, 'faction', 1, 'member of', 1);
    INSERT INTO connections (id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, campaign_id)
      VALUES (2, 'npc', 1, 'location', 1, 'lives in', 1);

    INSERT INTO mind_map_positions (id, campaign_id, entity_type, entity_id, x_pos, y_pos)
      VALUES (1, 1, 'npc', 1, 120.5, 340.0);

    INSERT INTO pdf_sources (id, campaign_id, filename, file_path, status, chunk_count)
      VALUES (1, 1, 'ghosts.pdf', 'C:/pdf/ghosts.pdf', 'indexed', 12);
    INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text)
      VALUES (1, 0, 3, 'The house on the hill...');

    INSERT INTO characters (id, campaign_id, character_name, level) VALUES (1, 1, 'Vex', 5);
    INSERT INTO compendium_custom (id, campaign_id, type, name, source) VALUES (1, 1, 'lore', 'Sea Ghosts', 'custom');
  `)
}

const snapshot = (db) => ({
  locations: db.prepare('SELECT * FROM locations ORDER BY id').all(),
  npcs: db.prepare('SELECT * FROM npcs ORDER BY id').all(),
  maps: db.prepare('SELECT * FROM maps ORDER BY id').all(),
  encounters: db.prepare('SELECT * FROM encounters ORDER BY id').all(),
  connections: db.prepare('SELECT * FROM connections ORDER BY id').all(),
  pdf_sources: db.prepare('SELECT * FROM pdf_sources ORDER BY id').all(),
})

// ── Scenario A: fresh database ───────────────────────────────────────────────
console.log('\n=== A. Fresh database: migrations 001-009 ===\n')
{
  const db = migrateTo(newDb(), LAST)

  check('all 9 migrations recorded',
    db.prepare('SELECT COUNT(*) c FROM _migrations').get().c === 9)

  const expected = [
    ['locations', 'parent_location_id', 'locations', 'SET NULL'],
    ['npcs', 'location_id', 'locations', 'SET NULL'],
    ['npcs', 'faction_id', 'factions', 'SET NULL'],
    ['maps', 'location_id', 'locations', 'SET NULL'],
    ['encounters', 'location_id', 'locations', 'SET NULL'],
    ['encounters', 'map_id', 'maps', 'SET NULL'],
    ['connections', 'campaign_id', 'campaigns', 'CASCADE'],
  ]
  for (const [table, column, parent, action] of expected) {
    const fk = fkFor(db, table, column)
    check(`${table}.${column} -> ${parent} ON DELETE ${action}`,
      !!fk && fk.table === parent && fk.on_delete === action,
      fk ? `got ${fk.table} / ${fk.on_delete}` : 'no FK found')
  }

  check("pdf_sources.status CHECK accepts 'embedded'", ddl(db, 'pdf_sources').includes("'embedded'"))

  // campaign_id cascades must survive the rebuild.
  for (const t of ['locations', 'npcs', 'maps', 'encounters', 'pdf_sources']) {
    const fk = fkFor(db, t, 'campaign_id')
    check(`${t}.campaign_id still CASCADEs`, !!fk && fk.on_delete === 'CASCADE')
  }

  // Columns added by 007 must still be there.
  check('locations keeps has_own_map + floor_number (007)',
    columns(db, 'locations').includes('has_own_map') && columns(db, 'locations').includes('floor_number'))
  check('encounters keeps map_id (007)', columns(db, 'encounters').includes('map_id'))
  check('connections keeps campaign_id (002)', columns(db, 'connections').includes('campaign_id'))

  check('no temporary _m009 tables left behind',
    db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name LIKE '%\\_m009' ESCAPE '\\'").get().c === 0)

  db.close()
}

// ── Scenario B: populated database ───────────────────────────────────────────
console.log('\n=== B. Populated database: rows through 001-008, then 009 ===\n')
let populated
{
  const db = migrateTo(newDb(), 8)
  populate(db)
  const before = snapshot(db)

  // Confirm the pre-009 defects are real before claiming they are fixed.
  let restricted = false
  try { db.exec('DELETE FROM locations WHERE id = 1') } catch { restricted = true }
  check('pre-009: deleting a referenced location is REFUSED', restricted)

  let campaignBlocked = false
  try { db.exec('DELETE FROM campaigns WHERE id = 1') } catch { campaignBlocked = true }
  check('pre-009: deleting a campaign with connections is REFUSED', campaignBlocked)

  let checkFailed = false
  try { db.exec("UPDATE pdf_sources SET status='embedded' WHERE id=1") } catch { checkFailed = true }
  check("pre-009: UPDATE pdf_sources SET status='embedded' is REFUSED", checkFailed)

  applyMigration(db, 9)
  const after = snapshot(db)

  for (const table of Object.keys(before)) {
    check(`${table}: all ${before[table].length} rows preserved byte-for-byte`,
      JSON.stringify(before[table]) === JSON.stringify(after[table]))
  }

  check('pdf_chunks survived the pdf_sources rebuild',
    db.prepare('SELECT COUNT(*) c FROM pdf_chunks').get().c === 1)
  check('mind_map_positions untouched',
    db.prepare('SELECT COUNT(*) c FROM mind_map_positions').get().c === 1)

  populated = db
}

// ── Acceptance cases from the phase brief ────────────────────────────────────
console.log('\n=== C. Acceptance: deletes that used to fail silently ===\n')
{
  const db = populated

  check("UPDATE pdf_sources SET status='embedded' now succeeds", (() => {
    try {
      db.exec("UPDATE pdf_sources SET status='embedded' WHERE id=1")
      return db.prepare('SELECT status FROM pdf_sources WHERE id=1').get().status === 'embedded'
    } catch { return false }
  })())

  check("the CHECK still rejects a bogus status", (() => {
    try { db.exec("UPDATE pdf_sources SET status='nonsense' WHERE id=1"); return false }
    catch { return true }
  })())

  // Delete a location that has an NPC, a map and an encounter attached.
  let deleted = true
  try { db.exec('DELETE FROM locations WHERE id = 1') } catch (e) { deleted = false; console.log('   ', e.message) }
  check('delete a location with an NPC, a map and an encounter attached', deleted)
  if (deleted) {
    check('  the NPC survives with location_id NULL',
      db.prepare('SELECT location_id FROM npcs WHERE id=1').get().location_id === null)
    check('  the map survives with location_id NULL',
      db.prepare('SELECT location_id FROM maps WHERE id=1').get().location_id === null)
    check('  the encounter survives with location_id NULL',
      db.prepare('SELECT location_id FROM encounters WHERE id=1').get().location_id === null)
    check('  the child location survives with parent_location_id NULL',
      db.prepare('SELECT parent_location_id FROM locations WHERE id=2').get().parent_location_id === null)
    check('  the NPC keeps its faction (unrelated FK untouched)',
      db.prepare('SELECT faction_id FROM npcs WHERE id=1').get().faction_id === 1)
  }

  // Delete a map that an encounter points at.
  db.exec('DELETE FROM maps WHERE id = 1')
  check('delete a map referenced by an encounter -> encounter.map_id NULL',
    db.prepare('SELECT map_id FROM encounters WHERE id=1').get().map_id === null)

  // Delete a faction an NPC belongs to.
  db.exec('DELETE FROM factions WHERE id = 1')
  check('delete a faction with a member -> npc.faction_id NULL',
    db.prepare('SELECT faction_id FROM npcs WHERE id=1').get().faction_id === null)

  // Delete a campaign that still has connections.
  let campaignDeleted = true
  try { db.exec('DELETE FROM campaigns WHERE id = 1') } catch (e) { campaignDeleted = false; console.log('   ', e.message) }
  check('delete a campaign with connections', campaignDeleted)
  if (campaignDeleted) {
    check('  its connections cascaded away',
      db.prepare('SELECT COUNT(*) c FROM connections WHERE campaign_id=1').get().c === 0)
    for (const t of ['locations', 'npcs', 'maps', 'encounters', 'pdf_sources', 'characters', 'mind_map_positions']) {
      check(`  ${t} rows cascaded away`,
        db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE campaign_id=1`).get().c === 0)
    }
    check('  the other campaign is untouched',
      db.prepare('SELECT COUNT(*) c FROM campaigns').get().c === 1)
  }

  check('database passes foreign_key_check afterwards',
    db.prepare('PRAGMA foreign_key_check').all().length === 0)

  db.close()
}

// ── Idempotence ──────────────────────────────────────────────────────────────
console.log('\n=== D. Re-running the migration set is a no-op ===\n')
{
  const db = migrateTo(newDb(), LAST)
  const ran = new Set(db.prepare('SELECT id FROM _migrations').all().map(r => r.id))
  check('all 9 ids recorded, so a second launch skips every one', ran.size === 9)
  db.close()
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`)
process.exit(failures === 0 ? 0 : 1)
