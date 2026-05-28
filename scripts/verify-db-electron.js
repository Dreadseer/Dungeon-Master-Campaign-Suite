// Runs as an Electron main process (no window) to verify DatabaseService
const { app } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

app.whenReady().then(() => {
  const DatabaseService = require('../electron/database/DatabaseService')
  const dbPath = path.join(os.tmpdir(), 'dmcs-verify-' + Date.now() + '.db')
  let exitCode = 0

  try {
    const db = new DatabaseService(dbPath)

    // Test 1
    const empty = db.all('SELECT * FROM campaigns ORDER BY updated_at DESC')
    if (Array.isArray(empty) && empty.length === 0) {
      console.log('✅ Test 1 PASS — getAll() =>', JSON.stringify(empty))
    } else {
      console.error('❌ Test 1 FAIL — expected [], got', empty)
      exitCode = 1
    }

    // Test 2
    const result = db.run(
      `INSERT INTO campaigns (name, description, world_setting, created_at, updated_at, session_count)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), 0)`,
      ['Test Campaign', 'Phase 1 test', 'Forgotten Realms']
    )
    if (result.lastInsertRowid === 1 && result.changes === 1) {
      console.log('✅ Test 2 PASS — create =>', JSON.stringify(result))
    } else {
      console.error('❌ Test 2 FAIL', result)
      exitCode = 1
    }

    // Test 3
    const rows = db.all('SELECT * FROM campaigns ORDER BY updated_at DESC')
    if (rows.length === 1 && rows[0].name === 'Test Campaign') {
      console.log('✅ Test 3 PASS — getAll() =>', JSON.stringify(rows[0]))
    } else {
      console.error('❌ Test 3 FAIL', rows)
      exitCode = 1
    }

    // Table check
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name != '_migrations' ORDER BY name`)
    const names = tables.map(t => t.name)
    const expected = ['campaigns','characters','compendium_custom','connections',
                      'encounters','factions','locations','maps',
                      'mind_map_positions','npcs','pdf_sources','srd_cache']
    const missing = expected.filter(t => !names.includes(t))
    if (missing.length === 0) {
      console.log('✅ Tables PASS — all 12 present:', names.join(', '))
    } else {
      console.error('❌ Tables FAIL — missing:', missing)
      exitCode = 1
    }

  } catch (err) {
    console.error('❌ ERROR:', err.message)
    exitCode = 1
  } finally {
    try { fs.unlinkSync(dbPath) } catch {}
  }

  process.exit(exitCode)
})
