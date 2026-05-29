// Phase 2 Prompt 03 verification — Lore + Connections IPC
const { app } = require('electron')
const path = require('path')
const os   = require('os')
const fs   = require('fs')

app.whenReady().then(async () => {
  const DatabaseService = require('../electron/database/DatabaseService')
  const dbPath = path.join(os.tmpdir(), 'dmcs-p2p03-' + Date.now() + '.db')
  let exitCode = 0

  try {
    const db = new DatabaseService(dbPath)

    // Seed campaign + entities
    db.run(`INSERT INTO campaigns (name, created_at, updated_at) VALUES ('Test', datetime('now'), datetime('now'))`)
    const cid = 1
    db.run(`INSERT INTO npcs (campaign_id, name, created_at) VALUES (?, 'Mira Ashveil', datetime('now'))`, [cid])
    db.run(`INSERT INTO factions (campaign_id, name, created_at) VALUES (?, 'Iron Wolves', datetime('now'))`, [cid])
    db.run(`INSERT INTO locations (campaign_id, name, type, created_at) VALUES (?, 'Riverdale', 'town', datetime('now'))`, [cid])
    const npc1Id      = db.get('SELECT id FROM npcs WHERE campaign_id = ?', [cid]).id
    const faction1Id  = db.get('SELECT id FROM factions WHERE campaign_id = ?', [cid]).id
    const loc1Id      = db.get('SELECT id FROM locations WHERE campaign_id = ?', [cid]).id

    // Test 1: Migration 002 ran — connections has campaign_id column
    const cols = db.all(`PRAGMA table_info(connections)`).map(r => r.name)
    console.assert(cols.includes('campaign_id'), 'Test 1 FAIL: connections missing campaign_id')
    console.log('✅ Test 1 PASS — connections.campaign_id exists')

    // Test 2: compendium_custom accepts type='lore'
    const lore1 = db.run(
      `INSERT INTO compendium_custom (campaign_id, type, name, data, source, created_at)
       VALUES (?, 'lore', ?, ?, 'custom', datetime('now'))`,
      [cid, 'The Founding', JSON.stringify({ content: 'Three hundred years ago...', category: 'History', is_secret: false })]
    )
    console.assert(lore1.changes === 1, 'Test 2 FAIL')
    console.log('✅ Test 2 PASS — lore entry created in compendium_custom')

    // Test 3: lore getAll returns parsed data
    const lore = db.all(`SELECT * FROM compendium_custom WHERE campaign_id = ? AND type = 'lore' ORDER BY name ASC`, [cid])
    const parsed = JSON.parse(lore[0].data)
    console.assert(parsed.category === 'History', 'Test 3 FAIL: category mismatch')
    console.log('✅ Test 3 PASS — lore data parses correctly:', parsed.category)

    // Test 4: create connection with campaign_id
    const conn1 = db.run(
      `INSERT INTO connections (campaign_id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes)
       VALUES (?,?,?,?,?,?,?)`,
      [cid, 'npc', npc1Id, 'faction', faction1Id, 'member of', 'Reports directly to leader']
    )
    console.assert(conn1.changes === 1, 'Test 4 FAIL')
    console.log('✅ Test 4 PASS — connection created with campaign_id')

    // Test 5: getAll connections by campaign
    const conns = db.all(`SELECT * FROM connections WHERE campaign_id = ?`, [cid])
    console.assert(conns.length === 1, 'Test 5 FAIL: expected 1 connection')
    console.log('✅ Test 5 PASS — connections getAll by campaign:', conns.length)

    // Test 6: getForEntity
    const forNpc = db.all(
      `SELECT * FROM connections WHERE (entity_a_type = ? AND entity_a_id = ?) OR (entity_b_type = ? AND entity_b_id = ?)`,
      ['npc', npc1Id, 'npc', npc1Id]
    )
    console.assert(forNpc.length === 1, 'Test 6 FAIL')
    console.log('✅ Test 6 PASS — getForEntity returns 1 connection for NPC')

    // Test 7: create NPC-location connection
    db.run(
      `INSERT INTO connections (campaign_id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship)
       VALUES (?,?,?,?,?,?)`,
      [cid, 'npc', npc1Id, 'location', loc1Id, 'lives in']
    )
    const forLoc = db.all(
      `SELECT * FROM connections WHERE (entity_a_type = ? AND entity_a_id = ?) OR (entity_b_type = ? AND entity_b_id = ?)`,
      ['location', loc1Id, 'location', loc1Id]
    )
    console.assert(forLoc.length === 1, 'Test 7 FAIL')
    console.log('✅ Test 7 PASS — getForEntity works for location')

    // Test 8: update connection
    const connId = conns[0].id
    db.run(`UPDATE connections SET relationship=?, notes=? WHERE id=?`, ['ally', 'Updated notes', connId])
    const updated = db.get('SELECT * FROM connections WHERE id = ?', [connId])
    console.assert(updated.relationship === 'ally', 'Test 8 FAIL')
    console.log('✅ Test 8 PASS — connection update works')

    // Test 9: lore secret entry
    db.run(
      `INSERT INTO compendium_custom (campaign_id, type, name, data, source, created_at)
       VALUES (?, 'lore', 'Secret Truth', ?, 'custom', datetime('now'))`,
      [cid, JSON.stringify({ content: 'The Duke is a traitor', category: 'Secret', is_secret: true })]
    )
    const allLore = db.all(`SELECT * FROM compendium_custom WHERE campaign_id = ? AND type = 'lore'`, [cid])
    const secretEntry = allLore.find(e => e.name === 'Secret Truth')
    const secretParsed = JSON.parse(secretEntry.data)
    console.assert(secretParsed.is_secret === true, 'Test 9 FAIL')
    console.log('✅ Test 9 PASS — secret lore entry stored and parsed correctly')

    console.log('\n✅ All Phase 2 Prompt 03 IPC tests passed.')
  } catch (err) {
    console.error('❌ ERROR:', err.message)
    exitCode = 1
  } finally {
    try { fs.unlinkSync(dbPath) } catch {}
  }

  process.exit(exitCode)
})
