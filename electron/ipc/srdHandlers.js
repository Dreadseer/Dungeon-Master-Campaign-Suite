const { registerHandler } = require('./registerHandler')

function registerSrdHandlers(db, srdService) {
  registerHandler('srd:seedAll', async (event) => {
    const result = await srdService.seedAll((percent, message) => {
      event.sender.send('srd:progress', { percent, message })
    })

    // Build the rules-Q&A index straight after the first seed, so a DM who has
    // just set the app up can ask a rules question without knowing an indexing
    // step exists. Chunking is local and fast; embedding needs Ollama and is
    // attempted only if it is actually reachable.
    try {
      const status = srdService.getIndexStatus()
      if (status.status === 'not-indexed') {
        event.sender.send('srd:progress', { percent: 100, message: 'Indexing SRD for rules Q&A…' })
        const { sourceId } = srdService.buildSrdIndex()

        const embedStatus = global.embeddingService
          ? await global.embeddingService.getStatus()
          : null
        if (embedStatus?.available && embedStatus?.hasModel) {
          await global.embeddingService.embedSource(sourceId, (percent, message) => {
            event.sender.send('srd:indexProgress', { percent, message })
          })
        }
      }
    } catch (err) {
      // Never fail the seed because indexing failed — the compendium still works.
      console.error('[srd:seedAll] auto-index failed:', err.message)
      event.sender.send('srd:indexProgress', { percent: 100, message: `Indexing skipped: ${err.message}` })
    }

    return result
  })

  // ── Rules-Q&A index (Phase 3) ────────────────────────────────────────────
  registerHandler('srd:getIndexStatus', () => srdService.getIndexStatus())

  // Build the chunk rows. Local and fast; no Ollama needed. On its own this
  // already makes rules Q&A work by keyword search.
  registerHandler('srd:buildIndex', async (event) => {
    return srdService.buildSrdIndex((percent, message) => {
      event.sender.send('srd:indexProgress', { percent, message })
    })
  })

  // Embed the chunks for semantic search. Needs Ollama; reports why if absent.
  registerHandler('srd:embedIndex', async (event) => {
    const status = srdService.getIndexStatus()
    if (!status.sourceId) throw new Error('Build the SRD index first.')

    const embedStatus = await global.embeddingService.getStatus()
    if (!embedStatus.available) {
      throw new Error('Ollama is not running. Rules Q&A still works by keyword search without it.')
    }
    if (!embedStatus.hasModel) {
      throw new Error('The nomic-embed-text model is not installed. Run: ollama pull nomic-embed-text')
    }

    return global.embeddingService.embedSource(status.sourceId, (percent, message) => {
      event.sender.send('srd:indexProgress', { percent, message })
    })
  })

  registerHandler('srd:clearIndex', async () => {
    const status = srdService.getIndexStatus()
    if (status.sourceId) {
      // Drop the vectors first, while the chunk rows they key off still exist.
      try {
        await global.embeddingService?.deleteSource(status.sourceId)
      } catch (err) {
        console.error('[srd:clearIndex] could not drop vectors:', err.message)
      }
    }
    return srdService.clearSrdIndex()
  })

  // ── Monster handlers ─────────────────────────────────────────────────
  registerHandler('srd:getMonsters', (_, filters = {}) => {
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

  registerHandler('srd:getMonsterByIndex', (_, index) => {
    const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['monster', index])
    return row ? JSON.parse(row.data) : null
  })

  // ── Spell handlers ───────────────────────────────────────────────────
  registerHandler('srd:getSpells', (_, filters = {}) => {
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

  registerHandler('srd:getSpellByIndex', (_, index) => {
    const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['spell', index])
    return row ? JSON.parse(row.data) : null
  })

  // ── Equipment handlers ───────────────────────────────────────────────
  registerHandler('srd:getEquipment', (_, filters = {}) => {
    const rows = db.all('SELECT slug, data FROM srd_cache WHERE resource_type = ?', ['equipment'])
    let results = rows.map(r => JSON.parse(r.data))
    if (filters.name)     results = results.filter(e => e.name.toLowerCase().includes(filters.name.toLowerCase()))
    if (filters.category) results = results.filter(e => e.equipment_category?.name?.toLowerCase().includes(filters.category.toLowerCase()))
    return results.map(e => ({
      name: e.name, index: e.index,
      equipment_category: typeof e.equipment_category === 'object' ? e.equipment_category?.name : (e.equipment_category ?? ''), cost: e.cost, weight: e.weight,
    }))
  })

  registerHandler('srd:getEquipmentByIndex', (_, index) => {
    const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['equipment', index])
    return row ? JSON.parse(row.data) : null
  })

  // ── Utility ──────────────────────────────────────────────────────────
  registerHandler('srd:getCacheStats', () =>
    db.all(`SELECT resource_type, COUNT(*) as count FROM srd_cache GROUP BY resource_type`)
  )
}

module.exports = registerSrdHandlers
