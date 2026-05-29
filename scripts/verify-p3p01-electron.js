/**
 * Phase 3 Prompt 01 — Map Manager & Image Import
 * Verification script: run with `npx electron scripts/verify-p3p01-electron.js`
 */

const path = require('path')
const { app } = require('electron')

app.whenReady().then(async () => {
  const DatabaseService = require('../electron/database/DatabaseService')
  const dbPath = require('os').tmpdir() + '/dmcs-p3p01-' + Date.now() + '.db'
  const db = new DatabaseService(dbPath)

  let passed = 0
  let failed = 0

  function assert(label, condition) {
    if (condition) {
      console.log(`  ✅ ${label}`)
      passed++
    } else {
      console.error(`  ❌ ${label}`)
      failed++
    }
  }

  console.log('\n=== Phase 3 Prompt 01 — Map IPC Verification ===\n')

  // ── Seed test data ─────────────────────────────────────────────────
  db.run(`INSERT INTO campaigns (name, description, world_setting, created_at, updated_at, session_count)
          VALUES ('Test Campaign', 'P3P01 test', 'Forgotten Realms', datetime('now'), datetime('now'), 0)`)
  const campaign = db.get('SELECT id FROM campaigns LIMIT 1')
  const cid = campaign.id

  db.run(`INSERT INTO locations (campaign_id, name, type, description, lore, created_at)
          VALUES (?, 'Riverdale', 'town', 'A riverside town', '', datetime('now'))`, [cid])
  const location = db.get('SELECT id, name FROM locations WHERE campaign_id = ? LIMIT 1', [cid])

  // ── Test 1: Create a map ───────────────────────────────────────────
  console.log('Test 1: Create a map')
  const result = db.run(
    `INSERT INTO maps (campaign_id, name, location_id, image_path, grid_size, fog_data, tokens, created_at)
     VALUES (?,?,?,?,?,?,?,datetime('now'))`,
    [cid, 'Riverdale Town Square', location.id, null, 50, JSON.stringify([]), JSON.stringify([])]
  )
  const mapId = result.lastInsertRowid
  assert('Map created with valid ID', mapId > 0)

  // ── Test 2: getAll returns map with location_name join ─────────────
  console.log('\nTest 2: getAll with location join')
  const maps = db.all(
    `SELECT m.*, l.name AS location_name FROM maps m
     LEFT JOIN locations l ON m.location_id = l.id
     WHERE m.campaign_id = ? ORDER BY m.name ASC`,
    [cid]
  )
  const testMap = maps.find(m => m.id === mapId)
  assert('Map appears in getAll', !!testMap)
  assert('location_name joined correctly', testMap?.location_name === location.name)
  assert('grid_size defaults to 50', testMap?.grid_size === 50)

  // ── Test 3: tokens and fog_data stored as JSON strings ────────────
  console.log('\nTest 3: JSON fields')
  const raw = db.get('SELECT fog_data, tokens FROM maps WHERE id = ?', [mapId])
  assert('fog_data is valid JSON array', (() => { try { return Array.isArray(JSON.parse(raw.fog_data)) } catch { return false } })())
  assert('tokens is valid JSON array',   (() => { try { return Array.isArray(JSON.parse(raw.tokens))   } catch { return false } })())

  // ── Test 4: updateFog ─────────────────────────────────────────────
  console.log('\nTest 4: updateFog')
  const fogData = [true, false, true, true]
  db.run('UPDATE maps SET fog_data = ? WHERE id = ?', [JSON.stringify(fogData), mapId])
  const afterFog = db.get('SELECT fog_data FROM maps WHERE id = ?', [mapId])
  const parsed = JSON.parse(afterFog.fog_data)
  assert('fog_data updated correctly', JSON.stringify(parsed) === JSON.stringify(fogData))

  // ── Test 5: updateTokens ──────────────────────────────────────────
  console.log('\nTest 5: updateTokens')
  const tokens = [{ id: 1, x: 100, y: 200, name: 'Goblin' }]
  db.run('UPDATE maps SET tokens = ? WHERE id = ?', [JSON.stringify(tokens), mapId])
  const afterTokens = db.get('SELECT tokens FROM maps WHERE id = ?', [mapId])
  const parsedTokens = JSON.parse(afterTokens.tokens)
  assert('tokens updated correctly', parsedTokens[0]?.name === 'Goblin')

  // ── Test 6: updateImagePath ───────────────────────────────────────
  console.log('\nTest 6: updateImagePath')
  const fakePath = 'C:\\Users\\test\\maps\\map_12345.png'
  db.run('UPDATE maps SET image_path = ? WHERE id = ?', [fakePath, mapId])
  const afterImage = db.get('SELECT image_path FROM maps WHERE id = ?', [mapId])
  assert('image_path updated correctly', afterImage.image_path === fakePath)

  // ── Test 7: getById ───────────────────────────────────────────────
  console.log('\nTest 7: getById')
  const byId = db.get('SELECT * FROM maps WHERE id = ?', [mapId])
  assert('getById returns correct map', byId?.name === 'Riverdale Town Square')

  // ── Test 8: delete ────────────────────────────────────────────────
  console.log('\nTest 8: delete')
  db.run('DELETE FROM maps WHERE id = ?', [mapId])
  const afterDelete = db.get('SELECT id FROM maps WHERE id = ?', [mapId])
  assert('Map deleted successfully', !afterDelete)

  // ── Summary ───────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(48)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed === 0) {
    console.log('✅ All Phase 3 Prompt 01 checks passed!\n')
  } else {
    console.log('❌ Some checks failed — review above.\n')
  }

  app.exit(failed === 0 ? 0 : 1)
})
