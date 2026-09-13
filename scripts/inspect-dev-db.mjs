// Read-only inspection of the live dev database, for Phase 4.5 verification.
//
//   node_modules/electron/dist/electron.exe scripts/inspect-dev-db.mjs   (with ELECTRON_RUN_AS_NODE=1)
//
// Runs under Electron because that is the runtime better-sqlite3 is built for.
// Opens the database read-only — this only reports, it never writes.
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const dbPath = process.argv[2] ?? join(process.env.APPDATA, 'dmcs', 'dmcs.db')
console.log('database:', dbPath, '\n')

const db = new Database(dbPath, { readonly: true })
const q = (sql) => { try { return db.prepare(sql).all() } catch (e) { return [{ __error: e.message.slice(0, 80) }] } }

console.log('=== migrations applied ===')
for (const r of q('SELECT id, name, run_at FROM _migrations ORDER BY id')) {
  console.log(`  ${String(r.id).padStart(2)}  ${String(r.name).padEnd(26)} ${r.run_at}`)
}

console.log('\n=== campaigns: is description preserved? (rule 10) ===')
for (const c of q("SELECT id, name, session_count, LENGTH(COALESCE(description,'')) AS d FROM campaigns ORDER BY id")) {
  console.log(`  #${c.id}  ${String(c.name).padEnd(30)} session_count=${c.session_count}  description=${c.d} chars`)
}

console.log('\n=== sessions (created by the migration 011 import) ===')
const sessions = q("SELECT id, campaign_id, session_number, title, LENGTH(COALESCE(notes,'')) AS n FROM sessions ORDER BY id")
if (!sessions.length || sessions[0].__error) console.log('  (none)')
else for (const s of sessions) {
  console.log(`  #${s.id}  campaign ${s.campaign_id}  session ${s.session_number}  "${s.title}"  notes=${s.n} chars`)
}

console.log('\n=== does each imported session match its campaign description? ===')
for (const r of q(`
  SELECT c.id, c.name,
         LENGTH(COALESCE(c.description,'')) AS desc_len,
         LENGTH(COALESCE(s.notes,''))       AS notes_len,
         (c.description = s.notes)          AS identical
    FROM campaigns c
    JOIN sessions s ON s.campaign_id = c.id AND s.title = 'Imported notes'`)) {
  console.log(`  #${r.id} ${String(r.name).padEnd(24)} description ${r.desc_len} chars, session notes ${r.notes_len} chars, identical=${r.identical ? 'YES' : 'NO'}`)
}

console.log('\n=== row counts ===')
for (const t of ['campaigns', 'locations', 'npcs', 'factions', 'characters', 'encounters', 'maps',
                 'compendium_custom', 'connections', 'mind_map_positions', 'sessions', 'plot_threads',
                 'reveals', 'pdf_sources', 'pdf_chunks', 'srd_cache', 'subclasses']) {
  const r = q(`SELECT COUNT(*) AS c FROM ${t}`)[0]
  console.log(`  ${t.padEnd(20)} ${r.__error ? 'MISSING' : r.c}`)
}

console.log('\n=== schema properties Phases 1-4 depend on ===')
const fk = (table, col) => db.pragma(`foreign_key_list(${table})`).find(f => f.from === col)
const checks = [
  ['npcs.location_id SET NULL (009)', () => fk('npcs', 'location_id')?.on_delete === 'SET NULL'],
  ['encounters.map_id SET NULL (009)', () => fk('encounters', 'map_id')?.on_delete === 'SET NULL'],
  ['connections.campaign_id CASCADE (009)', () => fk('connections', 'campaign_id')?.on_delete === 'CASCADE'],
  ['pdf_sources.campaign_id nullable (010)', () =>
    db.pragma('table_info(pdf_sources)').find(c => c.name === 'campaign_id')?.notnull === 0],
  ['sessions/plot_threads/reveals exist (011)', () =>
    ['sessions', 'plot_threads', 'reveals'].every(t =>
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t))],
  ['plot_threads.opened_session_id SET NULL (011)', () =>
    fk('plot_threads', 'opened_session_id')?.on_delete === 'SET NULL'],
]
for (const [label, fn] of checks) {
  let ok = false
  try { ok = fn() } catch { ok = false }
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
}

console.log('\n=== integrity ===')
console.log('  foreign_key_check violations:', db.pragma('foreign_key_check').length)
console.log('  integrity_check:', JSON.stringify(db.pragma('integrity_check')[0]))

db.close()
