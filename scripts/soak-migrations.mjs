// Migration soak test — Phase 9.
//
//   npm run verify:migrations
//
// Builds a LARGE, realistic database on the pre-Phase-1 schema (migrations
// 001-008), with rows in every table that exists at that point, then runs every
// later migration over it and checks that nothing was lost or broken:
//
//   1. every table that exists at 008 has realistic rows — enumerated from the
//      schema, so a table nobody thought to seed fails the run rather than being
//      quietly skipped;
//   2. row counts per table are compared before and after EACH migration, so a
//      migration that drops rows is attributed to that migration;
//   3. a sample of every foreign key in the final schema is dereferenced — the
//      parent row must exist — and PRAGMA foreign_key_check must be clean;
//   4. every FK's declared ON DELETE behaviour is exercised for real (delete a
//      parent that has children, observe, roll back), because a declaration that
//      does not behave as declared is what migration 009 existed to fix;
//   5. the JSON columns still parse, and the values a DM would notice — fog
//      masks, a character's stats, an encounter's monsters — are compared byte
//      for byte across the whole run.
//
// This complements `npm run test:migrations`, which checks each migration's
// behaviour case by case on small fixtures. This one checks that the set of them
// survives a database with a campaign's worth of data in it.
//
// Runs on node:sqlite; see scripts/lib/migration-sql.mjs for why.
import {
  LATEST, MIGRATION_IDS, newDb, migrateTo, applyMigration,
  userTables, rowCounts, allForeignKeys,
} from './lib/migration-sql.mjs'

const BUILD_TO = 8              // the schema the realistic data is written on
const SOAK_FROM = BUILD_TO + 1  // 009 onward is what gets soaked

let checks = 0
let failures = 0
const check = (label, ok, detail = '') => {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
  return ok
}

// Deterministic pseudo-random, so a failure is reproducible.
let seed = 20260917
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1))

// ── A campaign's worth of data ───────────────────────────────────────────────

const SCALE = {
  campaigns: 3,
  factionsPerCampaign: 6,
  locationsPerCampaign: 24,
  npcsPerCampaign: 40,
  charactersPerCampaign: 6,
  mapsPerCampaign: 8,
  encountersPerCampaign: 12,
  compendiumPerCampaign: 30,
  connectionsPerCampaign: 60,
  positionsPerCampaign: 30,
  pdfSourcesPerCampaign: 3,
  chunksPerSource: 60,
  usagePerCampaign: 40,
  srdCache: 250,
  subclasses: 12,
}

const LOCATION_TYPES = ['town', 'dungeon', 'shop', 'region', 'landmark']
const COMPENDIUM_TYPES = ['item', 'spell', 'equipment', 'monster', 'lore']
const RACES = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Tiefling', 'Half-Orc', 'Gnome']
const CLASSES = ['Fighter', 'Wizard', 'Rogue', 'Cleric', 'Ranger', 'Bard', 'Paladin']

function fogMask(cols, rows, revealedEvery) {
  return Array.from({ length: cols * rows }, (_, i) => i % revealedEvery === 0)
}

function seedRealisticData(db) {
  const run = (sql, params = []) => db.prepare(sql).run(...params)
  const lastId = () => db.prepare('SELECT last_insert_rowid() AS id').get().id

  const notable = {}   // rows the checks below look at by name

  for (let c = 1; c <= SCALE.campaigns; c++) {
    run(`INSERT INTO campaigns (name, description, world_setting, session_count)
         VALUES (?,?,?,?)`,
      [`Campaign ${c}: The Mere of Dead Men`,
       `A coastal campaign of ${c * 7} sessions. Notes from before sessions existed.`,
       'Forgotten Realms', int(0, 12)])
    const campaignId = lastId()

    const factionIds = []
    for (let f = 1; f <= SCALE.factionsPerCampaign; f++) {
      run(`INSERT INTO factions (campaign_id, name, description, alignment, notes)
           VALUES (?,?,?,?,?)`,
        [campaignId, `Faction ${c}-${f}`, 'A power in the region.',
         pick(['Lawful Good', 'Neutral', 'Chaotic Evil', 'Lawful Evil']), 'Rivals with everyone.'])
      factionIds.push(lastId())
    }

    // Locations nested four deep — region > town > shop, plus dungeons.
    const locationIds = []
    for (let l = 1; l <= SCALE.locationsPerCampaign; l++) {
      const parent = l > 4 && rnd() < 0.7 ? pick(locationIds) : null
      run(`INSERT INTO locations (campaign_id, name, type, description, lore, parent_location_id, has_own_map, floor_number)
           VALUES (?,?,?,?,?,?,?,?)`,
        [campaignId, `Location ${c}-${l}`, pick(LOCATION_TYPES),
         'A place the party has been.', 'Older than the town above it.',
         parent, l % 3 === 0 ? 1 : 0, l % 5 === 0 ? -1 : 0])
      locationIds.push(lastId())
    }

    for (let n = 1; n <= SCALE.npcsPerCampaign; n++) {
      run(`INSERT INTO npcs (campaign_id, name, race, class, role, location_id, faction_id, notes, secrets, motivation, is_alive)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [campaignId, `NPC ${c}-${n}`, pick(RACES), pick(CLASSES), 'Shopkeeper',
         rnd() < 0.85 ? pick(locationIds) : null,
         rnd() < 0.6 ? pick(factionIds) : null,
         'Talks too much.', 'Secretly a cultist.', 'Wants the amulet.',
         rnd() < 0.9 ? 1 : 0])
    }

    for (let p = 1; p <= SCALE.charactersPerCampaign; p++) {
      const stats = { strength: int(8, 18), dexterity: int(8, 18), constitution: int(8, 18),
                      intelligence: int(8, 18), wisdom: int(8, 18), charisma: int(8, 18) }
      run(`INSERT INTO characters (campaign_id, player_name, character_name, class, race, level,
             stats, hp_current, hp_max, inventory, spell_slots, notes, subclass_name)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [campaignId, `Player ${p}`, `PC ${c}-${p}`, pick(CLASSES), pick(RACES), int(1, 12),
         JSON.stringify(stats), int(5, 60), 60,
         JSON.stringify([{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 10 }]),
         JSON.stringify({ 1: 4, 2: 3, 3: 2 }), 'Owes money in three towns.',
         rnd() < 0.5 ? 'Champion' : null])
      if (c === 1 && p === 1) notable.character = { id: lastId(), stats: JSON.stringify(stats) }
    }

    const mapIds = []
    for (let m = 1; m <= SCALE.mapsPerCampaign; m++) {
      const grid = pick([25, 50, 70])
      const mask = fogMask(40, 30, int(3, 9))
      const tokens = Array.from({ length: int(2, 9) }, (_, t) => ({
        id: `tok-${c}-${m}-${t}`, label: `Token ${t}`, type: pick(['player', 'npc', 'monster', 'object']),
        col: int(0, 39), row: int(0, 29), color: '#D0021B', entity_type: null, entity_id: null,
      }))
      run(`INSERT INTO maps (campaign_id, name, location_id, image_path, grid_size, fog_data, tokens)
           VALUES (?,?,?,?,?,?,?)`,
        [campaignId, `Map ${c}-${m}`, rnd() < 0.8 ? pick(locationIds) : null,
         `C:/maps/map_${c}_${m}.png`, grid, JSON.stringify(mask), JSON.stringify(tokens)])
      mapIds.push(lastId())
      if (c === 1 && m === 1) notable.map = { id: lastId(), fog: JSON.stringify(mask), tokens: JSON.stringify(tokens) }
    }

    for (let e = 1; e <= SCALE.encountersPerCampaign; e++) {
      const monsters = Array.from({ length: int(1, 5) }, (_, i) => ({
        id: `mon-${e}-${i}`, name: `Goblin ${i}`, cr: 0.25, count: int(1, 6),
        hp_max: 7, hp_current: 7, ac: 15, xp: 50,
      }))
      run(`INSERT INTO encounters (campaign_id, name, location_id, monsters, status, xp_total, notes, map_id)
           VALUES (?,?,?,?,?,?,?,?)`,
        [campaignId, `Encounter ${c}-${e}`, rnd() < 0.8 ? pick(locationIds) : null,
         JSON.stringify(monsters), pick(['planned', 'active', 'completed']), int(100, 4000),
         'They fight to the death.', rnd() < 0.6 ? pick(mapIds) : null])
      if (c === 1 && e === 1) notable.encounter = { id: lastId(), monsters: JSON.stringify(monsters) }
    }

    for (let k = 1; k <= SCALE.compendiumPerCampaign; k++) {
      run(`INSERT INTO compendium_custom (campaign_id, type, name, data, source)
           VALUES (?,?,?,?,?)`,
        [campaignId, pick(COMPENDIUM_TYPES), `Entry ${c}-${k}`,
         JSON.stringify({ name: `Entry ${c}-${k}`, description: 'Homebrew.', challenge_rating: 2 }),
         pick(['custom', 'srd', 'pdf_upload', 'source_book'])])
    }

    // Polymorphic rows — the ones with no foreign key to protect them.
    const npcIds = db.prepare('SELECT id FROM npcs WHERE campaign_id = ?').all(campaignId).map(r => r.id)
    for (let x = 1; x <= SCALE.connectionsPerCampaign; x++) {
      const kinds = [['npc', pick(npcIds)], ['location', pick(locationIds)], ['faction', pick(factionIds)]]
      const [aType, aId] = pick(kinds)
      const [bType, bId] = pick(kinds)
      run(`INSERT INTO connections (entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes, campaign_id)
           VALUES (?,?,?,?,?,?,?)`,
        [aType, aId, bType, bId, pick(['allied with', 'lives in', 'member of', 'hunting']), '', campaignId])
    }

    for (let x = 1; x <= SCALE.positionsPerCampaign; x++) {
      run(`INSERT INTO mind_map_positions (campaign_id, entity_type, entity_id, x_pos, y_pos)
           VALUES (?,?,?,?,?)`,
        [campaignId, 'npc', pick(npcIds), rnd() * 2000, rnd() * 2000])
    }

    for (let sIdx = 1; sIdx <= SCALE.pdfSourcesPerCampaign; sIdx++) {
      run(`INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count, indexed_at)
           VALUES (?,?,?,?,?,datetime('now'))`,
        [campaignId, `book_${c}_${sIdx}.pdf`, `C:/pdf/book_${c}_${sIdx}.pdf`,
         pick(['pending', 'indexed', 'failed']), SCALE.chunksPerSource])
      const sourceId = lastId()
      for (let ch = 0; ch < SCALE.chunksPerSource; ch++) {
        run(`INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text, embedded, embedding_model)
             VALUES (?,?,?,?,?,?)`,
          [sourceId, ch, int(1, 320),
           `Page text for chunk ${ch}. Grappling: you can use the Attack action to make a special melee attack.`,
           ch % 2, ch % 2 ? 'nomic-embed-text' : null])
      }
    }

    for (let u = 1; u <= SCALE.usagePerCampaign; u++) {
      run(`INSERT INTO ai_usage_log (campaign_id, mode, type, prompt_len, response_len, duration_ms)
           VALUES (?,?,?,?,?,?)`,
        [campaignId, pick(['online', 'offline-ollama']), pick(['chat', 'rag', 'rag-fallback']),
         int(100, 4000), int(50, 3000), int(200, 9000)])
    }
  }

  // Campaign-independent tables.
  for (let i = 1; i <= SCALE.srdCache; i++) {
    run(`INSERT INTO srd_cache (resource_type, slug, data) VALUES (?,?,?)`,
      [pick(['monsters', 'spells', 'equipment', 'classes']), `slug-${i}`,
       JSON.stringify({ index: `slug-${i}`, name: `SRD ${i}`, challenge_rating: int(0, 24) })])
  }
  for (let i = 1; i <= SCALE.subclasses; i++) {
    run(`INSERT INTO subclasses (class_name, name, description, unlock_level, features, source)
         VALUES (?,?,?,?,?,?)`,
      [pick(CLASSES), `Subclass ${i}`, 'A path.', pick([1, 2, 3]),
       JSON.stringify([{ name: 'Feature', level_gained: 3, description: 'It does something.' }]), 'srd'])
  }

  return notable
}

/**
 * Rows in the tables the soaked migrations themselves add — sessions, plot
 * threads, reveals, saved combat, encounter tables. Without these, a third of
 * the foreign keys in the final schema have no rows to probe, and "a sample of
 * every foreign key" would quietly mean "of the old ones".
 */
function seedPostMigrationTables(db) {
  const run = (sql, params = []) => db.prepare(sql).run(...params)
  const ids = (sql) => db.prepare(sql).all().map(r => r.id)
  const campaignIds = ids('SELECT id FROM campaigns')
  const locationIds = ids('SELECT id FROM locations')
  const encounterIds = ids('SELECT id FROM encounters')
  const npcIds = ids('SELECT id FROM npcs')

  for (const campaignId of campaignIds) {
    const sessionIds = []
    for (let n = 2; n <= 6; n++) {
      run(`INSERT INTO sessions (campaign_id, session_number, title, notes, played_on)
           VALUES (?,?,?,?,date('now'))`,
        [campaignId, n, `Session ${n}`, `The party did things. ${'Notes. '.repeat(20)}`])
      sessionIds.push(db.prepare('SELECT last_insert_rowid() AS id').get().id)
    }

    for (let t = 1; t <= 8; t++) {
      const resolved = rnd() < 0.4
      run(`INSERT INTO plot_threads (campaign_id, title, description, status, opened_session_id, resolved_session_id)
           VALUES (?,?,?,?,?,?)`,
        [campaignId, `Thread ${t}`, 'Someone is behind it.',
         resolved ? 'resolved' : pick(['open', 'active']),
         pick(sessionIds), resolved ? pick(sessionIds) : null])
    }

    // reveals is UNIQUE(entity_type, entity_id) — a reveal is a fact about an
    // entity, not a per-campaign one — so walk this campaign's own NPCs rather
    // than picking at random and colliding.
    const ownNpcs = ids(`SELECT id FROM npcs WHERE campaign_id = ${campaignId}`).slice(0, 10)
    for (const npcId of ownNpcs) {
      run(`INSERT INTO reveals (campaign_id, entity_type, entity_id, session_id)
           VALUES (?,?,?,?)`,
        [campaignId, 'npc', npcId, rnd() < 0.8 ? pick(sessionIds) : null])
    }

    for (let tbl = 1; tbl <= 4; tbl++) {
      run(`INSERT INTO encounter_tables (campaign_id, name, location_id, die, entries)
           VALUES (?,?,?,?,?)`,
        [campaignId, `Wandering table ${tbl}`, rnd() < 0.8 ? pick(locationIds) : null, 'd20',
         JSON.stringify([{ roll_min: 1, roll_max: 10, label: 'Nothing' },
                         { roll_min: 11, roll_max: 20, label: 'Goblins', encounter_id: pick(encounterIds) }])])
    }
  }

  // One saved fight per encounter, and only for some of them.
  for (const encounterId of encounterIds.filter((_, i) => i % 3 === 0)) {
    const campaignId = db.prepare('SELECT campaign_id FROM encounters WHERE id = ?').get(encounterId).campaign_id
    run(`INSERT INTO combat_state (campaign_id, encounter_id, round_count, phase, combatants, log_entries)
         VALUES (?,?,?,?,?,?)`,
      [campaignId, encounterId, int(1, 9), 'active',
       JSON.stringify({ schema_version: 1, combatants: [{ id: 'c1', name: 'Vex', initiative: 18, hp_current: 30, hp_max: 44 }] }),
       JSON.stringify({ schema_version: 1, log_entries: [{ round: 1, text: 'Vex hits for 7.' }] })])
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

console.log(`\n=== Migration soak test: 001-${String(BUILD_TO).padStart(3, '0')} with realistic data, ` +
            `then ${String(SOAK_FROM).padStart(3, '0')}-${String(LATEST).padStart(3, '0')} ===\n`)

const db = newDb()
migrateTo(db, BUILD_TO, { quiet: true })

const tablesAt008 = userTables(db)
console.log(`  built the ${String(BUILD_TO).padStart(3, '0')} schema: ${tablesAt008.length} tables\n`)

const notable = seedRealisticData(db)
const before = rowCounts(db)
const totalRows = Object.values(before).reduce((a, b) => a + b, 0)
console.log(`  seeded ${totalRows.toLocaleString()} rows\n`)

// 1. Every table that exists at 008 must have been seeded.
const empty = tablesAt008.filter(t => before[t] === 0)
check(`every one of the ${tablesAt008.length} tables at 008 has rows`, empty.length === 0,
  empty.length ? `empty: ${empty.join(', ')}` : Object.entries(before).map(([t, n]) => `${t}=${n}`).join(' '))

// 2. Apply each later migration, comparing row counts as we go.
console.log('')
let running = { ...before }
for (const id of MIGRATION_IDS.filter(i => i >= SOAK_FROM)) {
  let err = null
  try {
    applyMigration(db, id, { quiet: true })
  } catch (e) {
    err = e
  }
  if (!check(`migration ${String(id).padStart(3, '0')} applied`, !err, err ? err.message : '')) break

  const after = rowCounts(db)
  // Only 011 is allowed to add rows, and only to sessions (the notes import).
  const lost = Object.keys(running).filter(t => (after[t] ?? 0) < running[t])
  const gained = Object.keys(after).filter(t => (after[t] ?? 0) > (running[t] ?? 0))
  const allowedGain = id === 11 ? ['sessions'] : []
  check(`  ${String(id).padStart(3, '0')}: no table lost rows`, lost.length === 0,
    lost.length ? lost.map(t => `${t} ${running[t]}→${after[t]}`).join(', ') : `${Object.keys(after).length} tables checked`)
  check(`  ${String(id).padStart(3, '0')}: no table gained rows unexpectedly`,
    gained.every(t => allowedGain.includes(t)),
    gained.length ? gained.map(t => `${t} ${running[t] ?? 0}→${after[t]}`).join(', ') : 'none')
  running = after
}

console.log('')
// Now fill the tables the migrations just created, so the foreign-key section
// below can probe every key in the final schema rather than only the old ones.
seedPostMigrationTables(db)

const after = rowCounts(db)
const stillEmpty = userTables(db).filter(t => after[t] === 0)
check(`every one of the ${userTables(db).length} tables in the final schema has rows`,
  stillEmpty.length === 0, stillEmpty.length ? `empty: ${stillEmpty.join(', ')}` : '')

check(`every migration is recorded (${LATEST})`,
  db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n === MIGRATION_IDS.length)

// Row counts for the tables that existed before the soak must be identical.
const changed = tablesAt008.filter(t => before[t] !== after[t])
check('row counts for every table that existed at 008 are unchanged', changed.length === 0,
  changed.length ? changed.map(t => `${t} ${before[t]}→${after[t]}`).join(', ') : `${tablesAt008.length} tables, ${totalRows.toLocaleString()} rows`)

// Migration 011 copied, not moved: descriptions are still there AND in sessions.
const withDescription = db.prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE TRIM(COALESCE(description,'')) <> ''`).get().n
const importedSessions = db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE title = 'Imported notes'`).get().n
check('011 copied each campaign description into a session and left the original',
  withDescription === SCALE.campaigns && importedSessions === SCALE.campaigns,
  `${withDescription} descriptions kept, ${importedSessions} sessions imported`)

// 5. The values a DM would notice, byte for byte.
const mapNow = db.prepare('SELECT fog_data, tokens FROM maps WHERE id = ?').get(notable.map.id)
check('a painted fog mask survived unchanged', mapNow.fog_data === notable.map.fog,
  `${JSON.parse(mapNow.fog_data).length} cells, ${JSON.parse(mapNow.fog_data).filter(Boolean).length} revealed`)
check("a map's tokens survived unchanged", mapNow.tokens === notable.map.tokens)
check("a character's stats survived unchanged",
  db.prepare('SELECT stats FROM characters WHERE id = ?').get(notable.character.id).stats === notable.character.stats)
check("an encounter's monster list survived unchanged",
  db.prepare('SELECT monsters FROM encounters WHERE id = ?').get(notable.encounter.id).monsters === notable.encounter.monsters)

// Every JSON column still parses.
const JSON_COLUMNS = [
  ['maps', 'fog_data'], ['maps', 'tokens'], ['maps', 'annotations'], ['maps', 'generated_params'],
  ['characters', 'stats'], ['characters', 'inventory'], ['characters', 'spell_slots'],
  ['encounters', 'monsters'], ['compendium_custom', 'data'], ['srd_cache', 'data'],
  ['subclasses', 'features'], ['encounter_tables', 'entries'],
]
const badJson = []
for (const [table, column] of JSON_COLUMNS) {
  for (const row of db.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL`).all()) {
    try { JSON.parse(row.v) } catch { badJson.push(`${table}.${column}#${row.id}`) }
  }
}
check('every JSON column in the database still parses', badJson.length === 0,
  badJson.length ? badJson.slice(0, 5).join(', ') : `${JSON_COLUMNS.length} columns scanned`)

// 3. Every foreign key: dereference a real row, and check the database is clean.
console.log('')
const fks = allForeignKeys(db)
const dangling = []
const unexercised = []
for (const fk of fks) {
  const rows = db.prepare(
    `SELECT t.${fk.column} AS v FROM ${fk.table} t WHERE t.${fk.column} IS NOT NULL LIMIT 3`).all()
  if (rows.length === 0) { unexercised.push(`${fk.table}.${fk.column}`); continue }
  for (const row of rows) {
    const parent = db.prepare(
      `SELECT 1 AS ok FROM ${fk.parent} WHERE ${fk.parentColumn} = ?`).get(row.v)
    if (!parent) dangling.push(`${fk.table}.${fk.column}=${row.v} → ${fk.parent}`)
  }
}
check(`all ${fks.length} foreign keys dereference to a real parent row`, dangling.length === 0,
  dangling.length ? dangling.slice(0, 5).join(', ') : `sampled up to 3 rows each; ${unexercised.length} had no non-null rows to sample`)
if (unexercised.length) console.log(`       (not sampled, no rows: ${unexercised.join(', ')})`)

check('PRAGMA foreign_key_check is clean', db.prepare('PRAGMA foreign_key_check').all().length === 0)

// 4. Every FK's declared ON DELETE behaviour, exercised and rolled back.
//
// The child rows are identified BY ID before the delete and looked up again
// after, rather than counted. Counting is not enough for a self-referencing key
// like locations.parent_location_id: deleting a top-level region removes a row
// whose own parent was NULL at the same moment its children become NULL, so the
// number of NULLs does not move and a count-based check reads a working SET NULL
// as a failure. (It did, until this was rewritten.)
console.log('')
const pkOf = (table) => {
  const pk = db.prepare(`PRAGMA table_info(${table})`).all().find(c => c.pk === 1)
  return pk ? pk.name : null
}

for (const fk of fks) {
  const label = `${fk.table}.${fk.column} → ${fk.parent} (${fk.onDelete})`
  const pk = pkOf(fk.table)
  const parentRow = db.prepare(
    `SELECT p.${fk.parentColumn} AS id FROM ${fk.parent} p
      WHERE EXISTS (SELECT 1 FROM ${fk.table} c WHERE c.${fk.column} = p.${fk.parentColumn}) LIMIT 1`).get()
  if (!parentRow) { check(label, true, 'no parent with children to delete — not exercised'); continue }
  if (!pk) { check(label, false, `${fk.table} has no primary key to track children by`); continue }

  const children = db.prepare(
    `SELECT ${pk} AS id FROM ${fk.table} WHERE ${fk.column} = ? LIMIT 25`).all(parentRow.id).map(r => r.id)

  db.exec('SAVEPOINT fk_probe')
  let threw = null
  try {
    db.prepare(`DELETE FROM ${fk.parent} WHERE ${fk.parentColumn} = ?`).run(parentRow.id)
  } catch (e) {
    threw = String(e.message).split(/\r?\n/)[0]
  }
  // What happened to each child row that pointed at the deleted parent.
  const fate = threw ? [] : children.map(id => {
    const row = db.prepare(`SELECT ${fk.column} AS v FROM ${fk.table} WHERE ${pk} = ?`).get(id)
    return row === undefined ? 'deleted' : row.v === null ? 'nulled' : 'kept'
  })
  db.exec('ROLLBACK TO fk_probe')
  db.exec('RELEASE fk_probe')

  const all = (what) => fate.length > 0 && fate.every(f => f === what)
  const ok = fk.onDelete === 'CASCADE' ? !threw && all('deleted')
    : fk.onDelete === 'SET NULL' ? !threw && all('nulled')
    : !!threw   // RESTRICT / NO ACTION must refuse the delete
  const summary = {}
  for (const f of fate) summary[f] = (summary[f] ?? 0) + 1
  check(label, ok,
    threw ? `refused: ${threw}`
      : `${children.length} child row(s): ${Object.entries(summary).map(([k, v]) => `${v} ${k}`).join(', ')}`)
}

// The data must be intact after all that probing.
console.log('')
const finalCounts = rowCounts(db)
const drifted = Object.keys(after).filter(t => after[t] !== finalCounts[t])
check('the FK probes left the data exactly as it was', drifted.length === 0,
  drifted.length ? drifted.map(t => `${t} ${after[t]}→${finalCounts[t]}`).join(', ') : 'every count identical')

db.close()

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`)
process.exit(failures === 0 ? 0 : 1)
