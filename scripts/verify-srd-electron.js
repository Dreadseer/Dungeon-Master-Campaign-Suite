// Prompt 03 verification — SrdService in Electron main process (no window)
const { app } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.whenReady().then(async () => {
  const DatabaseService = require('../electron/database/DatabaseService')
  const SrdService = require('../electron/services/SrdService')

  const dbPath = path.join(os.tmpdir(), 'dmcs-srd-verify-' + Date.now() + '.db')
  let exitCode = 0

  try {
    const db = new DatabaseService(dbPath)
    const srd = new SrdService(db)

    // Test 1: cache stats before seeding
    const before = db.all(`SELECT resource_type, COUNT(*) as count FROM srd_cache GROUP BY resource_type`)
    console.log('Test 1 — cache stats before seed:', JSON.stringify(before))
    if (before.length === 0) console.log('✅ Test 1 PASS — cache is empty before seed')
    else { console.error('❌ Test 1 unexpected pre-existing data'); exitCode = 1 }

    // Test 2: seed monsters only (quick test — skip full seed which takes minutes)
    console.log('Test 2 — fetching monsters from dnd5eapi.co ...')
    const result = await srd.fetchAndCache('monster', 'https://www.dnd5eapi.co/api/monsters')
    console.log('Fetch result:', JSON.stringify(result))
    if (result.total > 0 && result.fetched > 0) {
      console.log(`✅ Test 2 PASS — fetched ${result.fetched} monsters`)
    } else {
      console.error('❌ Test 2 FAIL — no monsters fetched'); exitCode = 1
    }

    // Test 3: query a monster
    const goblins = srd.getMonsters({ name: 'goblin' })
    if (goblins.length > 0 && goblins[0].name) {
      console.log('✅ Test 3 PASS — goblin query:', goblins[0].name)
    } else {
      console.error('❌ Test 3 FAIL — no goblin found'); exitCode = 1
    }

    // Test 4: cache stats after seeding monsters
    const after = db.all(`SELECT resource_type, COUNT(*) as count FROM srd_cache GROUP BY resource_type`)
    console.log('✅ Test 4 — cache stats after monster seed:', JSON.stringify(after))

    // Test 5: TTL skip (re-fetch same data — should all be skipped)
    const result2 = await srd.fetchAndCache('monster', 'https://www.dnd5eapi.co/api/monsters')
    if (result2.skipped === result.total && result2.fetched === 0) {
      console.log('✅ Test 5 PASS — TTL cache skip working:', JSON.stringify(result2))
    } else {
      console.error('❌ Test 5 FAIL — expected all skipped, got', result2); exitCode = 1
    }

  } catch (err) {
    console.error('❌ ERROR:', err.message)
    exitCode = 1
  } finally {
    try { fs.unlinkSync(dbPath) } catch {}
  }

  process.exit(exitCode)
})
