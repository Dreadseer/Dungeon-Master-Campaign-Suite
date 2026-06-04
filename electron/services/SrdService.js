const { net } = require('electron')

const SRD_RESOURCES = [
  { type: 'monster',   url: 'https://www.dnd5eapi.co/api/monsters' },
  { type: 'spell',     url: 'https://www.dnd5eapi.co/api/spells' },
  { type: 'equipment', url: 'https://www.dnd5eapi.co/api/equipment' },
  { type: 'class',     url: 'https://www.dnd5eapi.co/api/classes' },
]

const CACHE_TTL_DAYS = 30

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET' })
    req.setHeader('Accept', 'application/json')
    req.setHeader('User-Agent', 'DMCS/1.0')
    req.on('response', (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error(`JSON parse failed for ${url}: ${data.slice(0, 120)}`)) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

class SrdService {
  constructor(db) {
    this.db = db
  }

  async fetchAndCache(resourceType, listUrl) {
    const list = await fetchJson(listUrl)
    const slugs = list.results || []
    let fetched = 0
    let skipped = 0

    const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86400 * 1000).toISOString()

    for (const entry of slugs) {
      const existing = this.db.get(
        `SELECT cached_at FROM srd_cache WHERE resource_type = ? AND slug = ?`,
        [resourceType, entry.index]
      )
      if (existing && existing.cached_at > cutoff) {
        skipped++
        continue
      }
      const detail = await fetchJson('https://www.dnd5eapi.co' + entry.url)
      this.db.run(
        `INSERT INTO srd_cache (resource_type, slug, data, cached_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(resource_type, slug) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at`,
        [resourceType, entry.index, JSON.stringify(detail)]
      )
      fetched++
    }

    return { total: slugs.length, fetched, skipped }
  }

  async seedAll(onProgress) {
    const results = {}
    for (let i = 0; i < SRD_RESOURCES.length; i++) {
      const { type, url } = SRD_RESOURCES[i]
      const basePercent = Math.round((i / SRD_RESOURCES.length) * 100)
      onProgress(basePercent, `Fetching ${type}s...`)
      const result = await this.fetchAndCache(type, url)
      results[type] = result
      const donePercent = Math.round(((i + 1) / SRD_RESOURCES.length) * 100)
      onProgress(donePercent, `${type}s complete — ${result.fetched} fetched, ${result.skipped} cached`)
    }
    onProgress(100, 'All game data loaded!')
    return results
  }

  getMonsters(filters = {}) {
    const rows = this.db.all(`SELECT data FROM srd_cache WHERE resource_type = 'monster'`)
    let results = rows.map(r => JSON.parse(r.data))
    if (filters.name) results = results.filter(m => m.name.toLowerCase().includes(filters.name.toLowerCase()))
    if (filters.cr !== undefined) results = results.filter(m => String(m.challenge_rating) === String(filters.cr))
    if (filters.type) results = results.filter(m => m.type && m.type.toLowerCase().includes(filters.type.toLowerCase()))
    return results
  }

  getSpells(filters = {}) {
    const rows = this.db.all(`SELECT data FROM srd_cache WHERE resource_type = 'spell'`)
    let results = rows.map(r => JSON.parse(r.data))
    if (filters.name) results = results.filter(s => s.name.toLowerCase().includes(filters.name.toLowerCase()))
    if (filters.level !== undefined) results = results.filter(s => s.level === Number(filters.level))
    if (filters.school) results = results.filter(s => s.school && s.school.name.toLowerCase().includes(filters.school.toLowerCase()))
    return results
  }

  getEquipment(filters = {}) {
    const rows = this.db.all(`SELECT data FROM srd_cache WHERE resource_type = 'equipment'`)
    let results = rows.map(r => JSON.parse(r.data))
    if (filters.name) results = results.filter(e => e.name.toLowerCase().includes(filters.name.toLowerCase()))
    return results
  }
}

module.exports = SrdService
