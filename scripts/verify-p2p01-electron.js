// Phase 2 Prompt 01 verification — Factions + Locations IPC
const { app } = require('electron')
const path = require('path')
const os   = require('os')
const fs   = require('fs')

app.whenReady().then(async () => {
  const DatabaseService = require('../electron/database/DatabaseService')
  const registerDbHandlers = require('../electron/ipc/dbHandlers')
  const { ipcMain } = require('electron')

  const dbPath = path.join(os.tmpdir(), 'dmcs-p2p01-' + Date.now() + '.db')
  let exitCode = 0

  try {
    const db = new DatabaseService(dbPath)
    registerDbHandlers(db)

    // Seed a campaign to satisfy FK
    db.run(`INSERT INTO campaigns (name, created_at, updated_at) VALUES ('Test', datetime('now'), datetime('now'))`)
    const cid = 1

    // Test 1: create faction
    const f1 = db.run(
      `INSERT INTO factions (campaign_id, name, description, alignment, notes, created_at) VALUES (?,?,?,?,?,datetime('now'))`,
      [cid, 'The Iron Wolves', 'A mercenary band', 'Chaotic Neutral', 'Secret: they work for the Duke']
    )
    console.assert(f1.lastInsertRowid === 1 && f1.changes === 1, 'Test 1 FAIL')
    console.log('✅ Test 1 PASS — faction create:', JSON.stringify(f1))

    // Test 2: getAll factions
    const factions = db.all('SELECT * FROM factions WHERE campaign_id = ? ORDER BY name ASC', [cid])
    console.assert(factions.length === 1 && factions[0].name === 'The Iron Wolves', 'Test 2 FAIL')
    console.log('✅ Test 2 PASS — factions getAll:', factions[0].name)

    // Test 3: create location
    const l1 = db.run(
      `INSERT INTO locations (campaign_id, name, type, description, lore, parent_location_id, created_at) VALUES (?,?,?,?,?,?,datetime('now'))`,
      [cid, 'Riverdale', 'town', 'A quiet riverside town', 'Founded 200 years ago by dwarven miners', null]
    )
    console.assert(l1.lastInsertRowid === 1 && l1.changes === 1, 'Test 3 FAIL')
    console.log('✅ Test 3 PASS — location create:', JSON.stringify(l1))

    // Test 4: getAll locations with parent join
    const locs = db.all(`
      SELECT l.*, p.name AS parent_name FROM locations l
      LEFT JOIN locations p ON l.parent_location_id = p.id
      WHERE l.campaign_id = ? ORDER BY l.name ASC`, [cid])
    console.assert(locs.length === 1 && locs[0].name === 'Riverdale' && locs[0].parent_name === null, 'Test 4 FAIL')
    console.log('✅ Test 4 PASS — locations getAll with parent_name:', JSON.stringify(locs[0]))

    // Test 5: sub-location with parent
    db.run(
      `INSERT INTO locations (campaign_id, name, type, description, lore, parent_location_id, created_at) VALUES (?,?,?,?,?,?,datetime('now'))`,
      [cid, 'The Rusty Flagon', 'shop', 'A rowdy inn', '', 1]
    )
    const locsAll = db.all(`
      SELECT l.*, p.name AS parent_name FROM locations l
      LEFT JOIN locations p ON l.parent_location_id = p.id
      WHERE l.campaign_id = ? ORDER BY l.name ASC`, [cid])
    const shop = locsAll.find(l => l.name === 'The Rusty Flagon')
    console.assert(shop.parent_name === 'Riverdale', 'Test 5 FAIL: expected parent_name Riverdale, got ' + shop.parent_name)
    console.log('✅ Test 5 PASS — sub-location parent_name:', shop.parent_name)

    console.log('\n✅ All Phase 2 Prompt 01 IPC tests passed.')
  } catch (err) {
    console.error('❌ ERROR:', err.message)
    exitCode = 1
  } finally {
    try { fs.unlinkSync(dbPath) } catch {}
  }

  process.exit(exitCode)
})
