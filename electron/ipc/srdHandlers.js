const { ipcMain } = require('electron')

function registerSrdHandlers(db, srdService) {
  ipcMain.handle('srd:seedAll', async (event) => {
    return srdService.seedAll((percent, message) => {
      event.sender.send('srd:progress', { percent, message })
    })
  })

  // ── Monster handlers ─────────────────────────────────────────────────
  ipcMain.handle('srd:getMonsters', (_, filters = {}) => {
    const rows = db.all('SELECT slug, data FROM srd_cache WHERE resource_type = ?', ['monster'])
    let results = rows.map(r => JSON.parse(r.data))
    if (filters.name)                                   results = results.filter(m => m.name.toLowerCase().includes(filters.name.toLowerCase()))
    if (filters.cr !== undefined && filters.cr !== '')  results = results.filter(m => String(m.challenge_rating) === String(filters.cr))
    if (filters.type)                                   results = results.filter(m => m.type?.toLowerCase().includes(filters.type.toLowerCase()))
    if (filters.size)                                   results = results.filter(m => m.size?.toLowerCase() === filters.size.toLowerCase())
    return results.map(m => ({
      name: m.name, index: m.index, challenge_rating: m.challenge_rating,
      type: m.type, size: m.size, hit_points: m.hit_points,
    }))
  })

  ipcMain.handle('srd:getMonsterByIndex', (_, index) => {
    const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['monster', index])
    return row ? JSON.parse(row.data) : null
  })

  // ── Spell handlers ───────────────────────────────────────────────────
  ipcMain.handle('srd:getSpells', (_, filters = {}) => {
    const rows = db.all('SELECT slug, data FROM srd_cache WHERE resource_type = ?', ['spell'])
    let results = rows.map(r => JSON.parse(r.data))
    if (filters.name)                                      results = results.filter(s => s.name.toLowerCase().includes(filters.name.toLowerCase()))
    if (filters.level !== undefined && filters.level !== '') results = results.filter(s => s.level === Number(filters.level))
    if (filters.school)                                    results = results.filter(s => s.school?.name?.toLowerCase() === filters.school.toLowerCase())
    if (filters.classes)                                   results = results.filter(s => s.classes?.some(c => c.name.toLowerCase().includes(filters.classes.toLowerCase())))
    return results.map(s => ({
      name: s.name, index: s.index, level: s.level,
      school: typeof s.school === 'object' ? s.school?.name : (s.school ?? ''), casting_time: s.casting_time, range: s.range,
    }))
  })

  ipcMain.handle('srd:getSpellByIndex', (_, index) => {
    const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['spell', index])
    return row ? JSON.parse(row.data) : null
  })

  // ── Equipment handlers ───────────────────────────────────────────────
  ipcMain.handle('srd:getEquipment', (_, filters = {}) => {
    const rows = db.all('SELECT slug, data FROM srd_cache WHERE resource_type = ?', ['equipment'])
    let results = rows.map(r => JSON.parse(r.data))
    if (filters.name)     results = results.filter(e => e.name.toLowerCase().includes(filters.name.toLowerCase()))
    if (filters.category) results = results.filter(e => e.equipment_category?.name?.toLowerCase().includes(filters.category.toLowerCase()))
    return results.map(e => ({
      name: e.name, index: e.index,
      equipment_category: typeof e.equipment_category === 'object' ? e.equipment_category?.name : (e.equipment_category ?? ''), cost: e.cost, weight: e.weight,
    }))
  })

  ipcMain.handle('srd:getEquipmentByIndex', (_, index) => {
    const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['equipment', index])
    return row ? JSON.parse(row.data) : null
  })

  // ── Utility ──────────────────────────────────────────────────────────
  ipcMain.handle('srd:getCacheStats', () =>
    db.all(`SELECT resource_type, COUNT(*) as count FROM srd_cache GROUP BY resource_type`)
  )
}

module.exports = registerSrdHandlers
