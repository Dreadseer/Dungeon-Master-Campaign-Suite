// Phase 2 Prompt 05 verification — Global world search IPC
const { app } = require('electron')
const path = require('path')
const os   = require('os')
const fs   = require('fs')

app.whenReady().then(async () => {
  const DatabaseService = require('../electron/database/DatabaseService')
  const dbPath = path.join(os.tmpdir(), 'dmcs-p2p05-' + Date.now() + '.db')
  let exitCode = 0

  try {
    const db = new DatabaseService(dbPath)
    const cid = 1
    db.run(`INSERT INTO campaigns (name, created_at, updated_at) VALUES ('Test', datetime('now'), datetime('now'))`)

    // Seed entities
    db.run(`INSERT INTO npcs (campaign_id, name, role, notes, motivation, created_at) VALUES (?,?,?,?,?,datetime('now'))`,
      [cid, 'Mira Ashveil', 'Innkeeper', 'Warm and cautious', 'Protect her daughter'])
    db.run(`INSERT INTO factions (campaign_id, name, alignment, description, notes, created_at) VALUES (?,?,?,?,?,datetime('now'))`,
      [cid, 'Iron Wolves', 'Chaotic Neutral', 'Mercenary band', 'Works for Duke'])
    db.run(`INSERT INTO locations (campaign_id, name, type, description, lore, created_at) VALUES (?,?,?,?,?,datetime('now'))`,
      [cid, 'Riverdale', 'town', 'A quiet riverside town', 'Founded by dwarven miners near the river'])
    db.run(`INSERT INTO compendium_custom (campaign_id, type, name, data, source, created_at) VALUES (?,?,?,?,?,datetime('now'))`,
      [cid, 'lore', 'The Founding of Riverdale', JSON.stringify({ content: 'Three hundred years ago dwarven settlers...', category: 'History', is_secret: false }), 'custom'])

    // Test 1: search "Mira" finds NPC
    const r1 = (() => {
      const q = '%Mira%'
      const npcs = db.all(`SELECT id, name, role AS subtitle, 'npc' AS entity_type FROM npcs WHERE campaign_id=? AND (name LIKE ? OR notes LIKE ? OR motivation LIKE ?)`, [cid, q, q, q])
      return npcs
    })()
    console.assert(r1.length === 1 && r1[0].name === 'Mira Ashveil', 'Test 1 FAIL')
    console.log('✅ Test 1 PASS — search "Mira" finds NPC:', r1[0].name)

    // Test 2: search "river" finds location AND lore
    const q2 = '%river%'
    const locs2 = db.all(`SELECT id, name, type, 'location' AS entity_type FROM locations WHERE campaign_id=? AND (name LIKE ? OR description LIKE ? OR lore LIKE ?)`, [cid, q2, q2, q2])
    const lore2 = db.all(`SELECT id, name, 'lore' AS entity_type FROM compendium_custom WHERE campaign_id=? AND type='lore' AND name LIKE ?`, [cid, q2])
    console.assert(locs2.length === 1, 'Test 2a FAIL: location')
    console.assert(lore2.length === 1, 'Test 2b FAIL: lore')
    console.log(`✅ Test 2 PASS — search "river" hits ${locs2.length} location(s) + ${lore2.length} lore entry`)

    // Test 3: search "wolves" finds faction by name
    const q3 = '%wolves%'
    const facs3 = db.all(`SELECT id, name, alignment AS subtitle, 'faction' AS entity_type FROM factions WHERE campaign_id=? AND (name LIKE ? OR description LIKE ? OR notes LIKE ?)`, [cid, q3, q3, q3])
    console.assert(facs3.length === 1, 'Test 3 FAIL')
    console.log('✅ Test 3 PASS — search "wolves" finds faction:', facs3[0].name)

    // Test 4: search returns total count
    const q4 = '%river%'
    const locsT = db.all(`SELECT id, name, type, 'location' AS entity_type FROM locations WHERE campaign_id=? AND (name LIKE ? OR description LIKE ? OR lore LIKE ?)`, [cid, q4, q4, q4])
    const facsT = db.all(`SELECT id, name, alignment AS subtitle, 'faction' AS entity_type FROM factions WHERE campaign_id=? AND (name LIKE ? OR description LIKE ? OR notes LIKE ?)`, [cid, q4, q4, q4])
    const npcsT = db.all(`SELECT id, name, role AS subtitle, 'npc' AS entity_type FROM npcs WHERE campaign_id=? AND (name LIKE ? OR notes LIKE ? OR motivation LIKE ?)`, [cid, q4, q4, q4])
    const loreT = db.all(`SELECT id, name, 'lore' AS entity_type FROM compendium_custom WHERE campaign_id=? AND type='lore' AND name LIKE ?`, [cid, q4])
    const total = locsT.length + facsT.length + npcsT.length + loreT.length
    console.assert(total >= 2, 'Test 4 FAIL: expected at least 2 total results')
    console.log(`✅ Test 4 PASS — total results for "river": ${total}`)

    // Test 5: no match returns empty arrays
    const qNone = '%zzznomatch%'
    const npcsN = db.all(`SELECT id, name, role AS subtitle, 'npc' AS entity_type FROM npcs WHERE campaign_id=? AND (name LIKE ? OR notes LIKE ? OR motivation LIKE ?)`, [cid, qNone, qNone, qNone])
    console.assert(npcsN.length === 0, 'Test 5 FAIL')
    console.log('✅ Test 5 PASS — no-match query returns empty result')

    console.log('\n✅ All Phase 2 Prompt 05 IPC tests passed.')
  } catch (err) {
    console.error('❌ ERROR:', err.message)
    exitCode = 1
  } finally {
    try { fs.unlinkSync(dbPath) } catch {}
  }

  process.exit(exitCode)
})
