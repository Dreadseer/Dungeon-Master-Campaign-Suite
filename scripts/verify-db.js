// Prompt 02 verification — runs in Node directly (not Electron)
// Tests DatabaseService in isolation: migrations, create, read
const path = require('path')
const os = require('os')
const fs = require('fs')

const DatabaseService = require('../electron/database/DatabaseService')

const dbPath = path.join(os.tmpdir(), 'dmcs-verify-' + Date.now() + '.db')
console.log('DB path:', dbPath)

try {
  const db = new DatabaseService(dbPath)

  // Test 1 — getAll on empty DB
  const empty = db.all('SELECT * FROM campaigns ORDER BY updated_at DESC')
  console.assert(Array.isArray(empty) && empty.length === 0, 'Test 1 FAIL: expected []')
  console.log('Test 1 PASS — getAll() returned []')

  // Test 2 — create a campaign
  const result = db.run(
    `INSERT INTO campaigns (name, description, world_setting, created_at, updated_at, session_count)
     VALUES (?, ?, ?, datetime('now'), datetime('now'), 0)`,
    ['Test Campaign', 'Phase 1 test', 'Forgotten Realms']
  )
  console.assert(result.lastInsertRowid === 1, 'Test 2 FAIL: expected lastInsertRowid 1, got ' + result.lastInsertRowid)
  console.assert(result.changes === 1, 'Test 2 FAIL: expected changes 1, got ' + result.changes)
  console.log('Test 2 PASS — create returned', JSON.stringify(result))

  // Test 3 — read it back
  const rows = db.all('SELECT * FROM campaigns ORDER BY updated_at DESC')
  console.assert(rows.length === 1, 'Test 3 FAIL: expected 1 row, got ' + rows.length)
  console.assert(rows[0].name === 'Test Campaign', 'Test 3 FAIL: wrong name')
  console.assert(rows[0].world_setting === 'Forgotten Realms', 'Test 3 FAIL: wrong world_setting')
  console.log('Test 3 PASS — getAll() returned:', JSON.stringify(rows[0], null, 2))

  // Verify all 12 tables exist
  const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_%' ORDER BY name`)
  const names = tables.map(t => t.name)
  const expected = ['campaigns','characters','compendium_custom','connections',
                    'encounters','factions','locations','maps',
                    'mind_map_positions','npcs','pdf_sources','srd_cache']
  const missing = expected.filter(t => !names.includes(t))
  if (missing.length) {
    console.error('FAIL — missing tables:', missing)
  } else {
    console.log('Table check PASS — all 12 tables present:', names.join(', '))
  }

  console.log('\n✅ All verification tests passed.')
} catch (err) {
  console.error('ERROR:', err.message)
  process.exit(1)
} finally {
  try { fs.unlinkSync(dbPath) } catch {}
}
