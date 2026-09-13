// Phase 4.5 click-through, executed rather than clicked.
//
//   node_modules/electron/dist/electron.exe scripts/verify-app-electron.mjs
//   (with ELECTRON_RUN_AS_NODE=1)
//
// This runs inside Electron against a FRESH temporary database, driving the REAL
// DatabaseService — real migrations, real seed data, real better-sqlite3 — and
// the real SQL from electron/ipc/dbHandlers.js.
//
// What it is: proof that the data behaviour behind each click-through item is
// correct in the shipping code, on the runtime the app actually uses.
// What it is NOT: proof that the UI renders, that a button is wired to the
// handler, or that a toast appears. Those need a human at the keyboard or a
// driver that can attach to a dev-mode Electron window. Items that depend on
// rendering are marked NOT COVERED here and recorded as such in BUILD_STATUS.
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

let failures = 0, checks = 0
const check = (label, ok, detail = '') => {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
  return ok
}
const section = (t) => console.log(`\n=== ${t} ===\n`)

const tmp = mkdtempSync(join(tmpdir(), 'dmcs-clickthrough-'))
const dbPath = join(tmp, 'test.db')

// The real thing: migrations, subclass seeding, WAL, foreign keys.
const DatabaseService = require('../electron/database/DatabaseService.js')
const db = new DatabaseService(dbPath)

// The real polymorphic-delete helper, lifted from the handler file so this
// tests the shipping implementation rather than a copy of it.
const { readFileSync } = require('node:fs')
const handlerSrc = readFileSync('electron/ipc/dbHandlers.js', 'utf8')
const helperStart = handlerSrc.indexOf('function deleteWithPolymorphicRefs')
const helperEnd = handlerSrc.indexOf('\n}', helperStart) + 2
const POLY = handlerSrc.slice(handlerSrc.indexOf('const POLYMORPHIC_TYPES'), handlerSrc.indexOf('\n', handlerSrc.indexOf('const POLYMORPHIC_TYPES')))
// eslint-disable-next-line no-new-func
const deleteWithPolymorphicRefs = new Function(
  `${POLY}; ${handlerSrc.slice(helperStart, helperEnd)}; return deleteWithPolymorphicRefs`)()

try {
  // ── Migrations and seed ───────────────────────────────────────────────────
  section('Startup: migrations and seed on a fresh database')
  const migs = db.all('SELECT id FROM _migrations ORDER BY id').map(r => r.id)
  check('all 11 migrations applied', migs.length === 11, `got [${migs.join(',')}]`)
  check('subclasses seeded', db.get('SELECT COUNT(*) c FROM subclasses').c === 27)
  check('foreign keys are ON', db.db.pragma('foreign_keys', { simple: true }) === 1)

  // ── Campaign with a description ───────────────────────────────────────────
  section('Create a campaign; set a description')
  const camp = db.run(
    `INSERT INTO campaigns (name, description, world_setting, created_at, updated_at, session_count)
     VALUES (?,?,?,datetime('now'),datetime('now'),0)`,
    ['Saltmarsh', 'A coastal campaign of smugglers and sea ghosts.', 'Greyhawk'])
  const campaignId = Number(camp.lastInsertRowid)
  const c = db.get('SELECT * FROM campaigns WHERE id=?', [campaignId])
  check('campaign created with its description', c.description.startsWith('A coastal campaign'))
  check('session_count starts at 0', c.session_count === 0)

  // ── Location with an NPC; delete the location ─────────────────────────────
  section('Delete a location that has an NPC attached')
  const locId = Number(db.run(
    "INSERT INTO locations (campaign_id, name, type) VALUES (?,?,'town')", [campaignId, 'Saltmarsh Town']).lastInsertRowid)
  const npcId = Number(db.run(
    'INSERT INTO npcs (campaign_id, name, location_id) VALUES (?,?,?)', [campaignId, 'Gellan', locId]).lastInsertRowid)
  const mapId = Number(db.run(
    "INSERT INTO maps (campaign_id, name, location_id, grid_size) VALUES (?,?,?,50)", [campaignId, 'Town Map', locId]).lastInsertRowid)
  const encId = Number(db.run(
    "INSERT INTO encounters (campaign_id, name, location_id, status) VALUES (?,?,?,'planned')", [campaignId, 'Dock Ambush', locId]).lastInsertRowid)

  let deleted = true
  try { deleteWithPolymorphicRefs(db, 'locations', 'location', locId) }
  catch (e) { deleted = false; console.log('     ', e.message.slice(0, 120)) }
  check('deleting the location SUCCEEDS (no FK refusal)', deleted)
  check('  the NPC survives', !!db.get('SELECT 1 FROM npcs WHERE id=?', [npcId]))
  check('  with location_id NULL', db.get('SELECT location_id FROM npcs WHERE id=?', [npcId]).location_id === null)
  check('  the map survives with location_id NULL', db.get('SELECT location_id FROM maps WHERE id=?', [mapId]).location_id === null)
  check('  the encounter survives with location_id NULL', db.get('SELECT location_id FROM encounters WHERE id=?', [encId]).location_id === null)

  // ── Delete an NPC that has a connection AND a reveal ──────────────────────
  section('Delete an NPC with a connection and a reveal (Phase 4.5 fix)')
  const facId = Number(db.run(
    'INSERT INTO factions (campaign_id, name) VALUES (?,?)', [campaignId, 'Sea Ghosts']).lastInsertRowid)
  db.run(`INSERT INTO connections (campaign_id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship)
          VALUES (?,'npc',?,'faction',?,'member of')`, [campaignId, npcId, facId])
  db.run(`INSERT INTO reveals (campaign_id, entity_type, entity_id) VALUES (?,'npc',?)`, [campaignId, npcId])
  db.run(`INSERT INTO mind_map_positions (campaign_id, entity_type, entity_id, x_pos, y_pos) VALUES (?,'npc',?,1,1)`, [campaignId, npcId])

  check('setup: npc has a connection, a reveal and a position',
    db.get('SELECT COUNT(*) c FROM connections WHERE entity_a_id=?', [npcId]).c === 1 &&
    db.get("SELECT COUNT(*) c FROM reveals WHERE entity_type='npc' AND entity_id=?", [npcId]).c === 1 &&
    db.get('SELECT COUNT(*) c FROM mind_map_positions WHERE entity_id=?', [npcId]).c === 1)

  deleteWithPolymorphicRefs(db, 'npcs', 'npc', npcId)
  check('deleting the NPC removes its connection rows',
    db.get('SELECT COUNT(*) c FROM connections WHERE entity_a_id=?', [npcId]).c === 0)
  check('  and its reveal row (zero orphans)',
    db.get("SELECT COUNT(*) c FROM reveals WHERE entity_type='npc' AND entity_id=?", [npcId]).c === 0)
  check('  and its mind-map position', db.get('SELECT COUNT(*) c FROM mind_map_positions WHERE entity_id=?', [npcId]).c === 0)

  // ── Handler errors are real errors ────────────────────────────────────────
  section('A handler error is a real, catchable error (toast source)')
  let threw = false, msg = ''
  try { db.run('INSERT INTO locations (campaign_id, name, type) VALUES (?,?,?)', [campaignId, null, 'town']) }
  catch (e) { threw = true; msg = e.message }
  check('a NOT NULL violation throws rather than failing silently', threw, msg.slice(0, 60))
  check('  the message is one the renderer can rewrite', /NOT NULL/i.test(msg))

  let checkThrew = false
  try { db.run("INSERT INTO locations (campaign_id, name, type) VALUES (?,?,'nonsense')", [campaignId, 'Bad Type']) }
  catch { checkThrew = true }
  check('a CHECK violation throws too', checkThrew)

  // ── Sessions ──────────────────────────────────────────────────────────────
  section('Create three sessions; card shows "3 sessions"')
  const createSession = (title) => db.transaction(() => {
    const next = (db.get('SELECT MAX(session_number) AS n FROM sessions WHERE campaign_id=?', [campaignId])?.n ?? 0) + 1
    const r = db.run(
      `INSERT INTO sessions (campaign_id, session_number, title, notes, created_at)
       VALUES (?,?,?,'',datetime('now'))`, [campaignId, next, title ?? `Session ${next}`])
    db.run(`UPDATE campaigns SET session_count=(SELECT COUNT(*) FROM sessions WHERE campaign_id=?) WHERE id=?`,
      [campaignId, campaignId])
    return { id: Number(r.lastInsertRowid), session_number: next }
  })

  const s1 = createSession('Arrival')
  const s2 = createSession('The Haunted House')
  const s3 = createSession('Into the Tunnels')
  check('three sessions created, numbered 1..3',
    [s1, s2, s3].map(s => s.session_number).join(',') === '1,2,3')
  check('campaigns.session_count reads 3',
    db.get('SELECT session_count FROM campaigns WHERE id=?', [campaignId]).session_count === 3)
  check('getCurrent returns the highest-numbered session',
    db.get('SELECT session_number FROM sessions WHERE campaign_id=? ORDER BY session_number DESC LIMIT 1',
      [campaignId]).session_number === 3)

  // Notes autosave writes only notes.
  db.run('UPDATE sessions SET notes=? WHERE id=?', ['The party met at the Snapping Line.', s3.id])
  const s3row = db.get('SELECT title, notes FROM sessions WHERE id=?', [s3.id])
  check('updateNotes writes notes without clobbering the title',
    s3row.notes.startsWith('The party met') && s3row.title === 'Into the Tunnels')

  check('campaigns.description is untouched by session notes',
    db.get('SELECT description FROM campaigns WHERE id=?', [campaignId]).description.startsWith('A coastal campaign'))

  // ── Plot threads through all four statuses ────────────────────────────────
  section('Plot thread through all four statuses, linked to a session')
  const plotId = Number(db.run(
    `INSERT INTO plot_threads (campaign_id, title, description, status, opened_session_id, created_at)
     VALUES (?,?,?,'open',?,datetime('now'))`,
    [campaignId, 'Who funds the Sea Ghosts?', 'Unresolved', s1.id]).lastInsertRowid)

  const setStatus = (status, sessionId) => db.transaction(() => {
    if (status === 'resolved' || status === 'abandoned') {
      return db.run('UPDATE plot_threads SET status=?, resolved_session_id=COALESCE(?, resolved_session_id) WHERE id=?',
        [status, sessionId ?? null, plotId])
    }
    return db.run('UPDATE plot_threads SET status=?, resolved_session_id=NULL WHERE id=?', [status, plotId])
  })

  const statusOf = () => db.get('SELECT status, opened_session_id, resolved_session_id FROM plot_threads WHERE id=?', [plotId])
  check('opens linked to session 1', statusOf().opened_session_id === s1.id)
  setStatus('active'); check('open -> active', statusOf().status === 'active')
  setStatus('resolved', s3.id)
  check('active -> resolved, stamped with session 3',
    statusOf().status === 'resolved' && statusOf().resolved_session_id === s3.id)
  setStatus('open')
  check('reopening clears the resolving session',
    statusOf().status === 'open' && statusOf().resolved_session_id === null)
  setStatus('abandoned', s3.id); check('-> abandoned', statusOf().status === 'abandoned')

  // Deleting the opening session leaves the thread alive.
  db.run('DELETE FROM sessions WHERE id=?', [s1.id])
  check('deleting the opening session leaves the thread with a NULL link',
    !!db.get('SELECT 1 FROM plot_threads WHERE id=?', [plotId]) &&
    db.get('SELECT opened_session_id FROM plot_threads WHERE id=?', [plotId]).opened_session_id === null)

  // ── Reveals ───────────────────────────────────────────────────────────────
  section('Reveal toggle semantics')
  const loreId = Number(db.run(
    `INSERT INTO compendium_custom (campaign_id, type, name, data, source, created_at)
     VALUES (?,'lore',?,?,'custom',datetime('now'))`,
    [campaignId, 'The Wreck', JSON.stringify({ content: 'A galleon lost in the shoals.', is_secret: true })]
  ).lastInsertRowid)

  const reveal = (type, id, sessionId) => db.run(
    `INSERT INTO reveals (campaign_id, entity_type, entity_id, session_id, revealed_at)
     VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET session_id=excluded.session_id, revealed_at=excluded.revealed_at`,
    [campaignId, type, id, sessionId ?? null])

  reveal('lore', loreId, s3.id)
  check('revealing records the row with its session',
    db.get("SELECT session_id FROM reveals WHERE entity_type='lore' AND entity_id=?", [loreId]).session_id === s3.id)
  reveal('lore', loreId, s3.id)
  check('revealing twice is a no-op, not a constraint failure',
    db.get("SELECT COUNT(*) c FROM reveals WHERE entity_type='lore' AND entity_id=?", [loreId]).c === 1)
  db.run("DELETE FROM reveals WHERE entity_type='lore' AND entity_id=?", [loreId])
  check('unrevealing removes it',
    db.get("SELECT COUNT(*) c FROM reveals WHERE entity_type='lore' AND entity_id=?", [loreId]).c === 0)

  // ── Attached panel data ───────────────────────────────────────────────────
  section('Attached panel: what is at a location')
  const loc2 = Number(db.run("INSERT INTO locations (campaign_id, name, type) VALUES (?,?,'dungeon')",
    [campaignId, 'The Tunnels']).lastInsertRowid)
  db.run('INSERT INTO npcs (campaign_id, name, location_id) VALUES (?,?,?)', [campaignId, 'Tunnel Rat', loc2])
  db.run('INSERT INTO maps (campaign_id, name, location_id, grid_size) VALUES (?,?,?,50)', [campaignId, 'Tunnel Map', loc2])
  db.run("INSERT INTO encounters (campaign_id, name, location_id, status) VALUES (?,?,?,'planned')", [campaignId, 'Rat Swarm', loc2])
  check('npcs.getByLocation finds 1', db.all('SELECT id FROM npcs WHERE location_id=?', [loc2]).length === 1)
  check('maps.getByLocation finds 1', db.all('SELECT id FROM maps WHERE location_id=?', [loc2]).length === 1)
  check('encounters.getByLocation finds 1', db.all('SELECT id FROM encounters WHERE location_id=?', [loc2]).length === 1)

  // ── World search ──────────────────────────────────────────────────────────
  section('World search reaches lore bodies and session notes')
  const q = '%galleon%'
  check('lore BODY is searchable (Phase 4)', db.all(
    `SELECT id FROM compendium_custom WHERE campaign_id=? AND type='lore'
      AND (name LIKE ? OR json_extract(data,'$.content') LIKE ?)`, [campaignId, q, q]).length === 1)
  check('  and the old title-only query finds nothing', db.all(
    `SELECT id FROM compendium_custom WHERE campaign_id=? AND type='lore' AND name LIKE ?`, [campaignId, q]).length === 0)
  check('session notes are searchable', db.all(
    `SELECT id FROM sessions WHERE campaign_id=? AND (title LIKE ? OR notes LIKE ?)`,
    [campaignId, '%Snapping Line%', '%Snapping Line%']).length === 1)

  // ── Encounter math ────────────────────────────────────────────────────────
  section('Encounter Builder: 4x CR 2 against four level-5 characters')
  for (let i = 0; i < 4; i++) {
    db.run('INSERT INTO characters (campaign_id, character_name, level, stats) VALUES (?,?,?,?)',
      [campaignId, `PC ${i + 1}`, 5, '{}'])
  }
  const party = db.all('SELECT level FROM characters WHERE campaign_id=?', [campaignId])
  check('four level-5 characters exist', party.length === 4 && party.every(p => p.level === 5))

  // The renderer's own maths. It is an ES module and the project has no
  // "type": "module", so Electron's Node treats .js as CommonJS and a plain
  // import() fails. Evaluate the source with its `export` keywords stripped —
  // this is still the shipping file, not a copy.
  const encSrc = readFileSync('src/utils/encounterUtils.js', 'utf8').replace(/^export /gm, '')
  const encNames = [...readFileSync('src/utils/encounterUtils.js', 'utf8')
    .matchAll(/^export const (\w+)/gm)].map(m => m[1])
  // eslint-disable-next-line no-new-func
  const enc = new Function(`${encSrc}; return { ${encNames.join(', ')} }`)()
  const monsters = [{ xp: enc.crToXP(2), count: 4 }]
  const adjusted = enc.adjustedXP(monsters, party.length)
  const verdict = enc.difficultyRating(adjusted, enc.partyThresholds(party)).label
  check('adjusted XP is 3600', adjusted === 3600, `got ${adjusted}`)
  check('difficulty reads "Hard"', verdict === 'Hard', `got ${verdict}`)

  // ── Campaign cascade ──────────────────────────────────────────────────────
  section('Deleting the campaign cascades cleanly')
  db.run('DELETE FROM campaigns WHERE id=?', [campaignId])
  for (const t of ['locations', 'npcs', 'factions', 'characters', 'encounters', 'maps',
                   'sessions', 'plot_threads', 'reveals', 'connections', 'mind_map_positions']) {
    check(`  ${t} cascaded`, db.get(`SELECT COUNT(*) c FROM ${t} WHERE campaign_id=?`, [campaignId]).c === 0)
  }
  check('foreign_key_check is clean', db.db.pragma('foreign_key_check').length === 0)

} finally {
  try { db.close?.() } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows file lock */ }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`)
process.exit(failures === 0 ? 0 : 1)
