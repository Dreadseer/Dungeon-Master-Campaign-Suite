const { net } = require('electron')
const { buildIndexableText, srdSectionFor, SRD_SOURCE_FILENAME } = require('./srdIndexText')

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

  // ── SRD indexing for rules Q&A (Phase 3) ──────────────────────────────────
  //
  // Rules Q&A used to require uploading a PDF of a book the DM already owns.
  // The SRD cache has always been sitting in the database, used only for
  // browsing. These methods push it through the same chunk -> embed -> retrieve
  // path as an uploaded book, so rules lookup works on a fresh install.

  /**
   * Serialise every cached SRD row into indexable text.
   * Delegates to ./srdIndexText, which is pure and unit tested — this file
   * cannot be, because it opens with require('electron').
   *
   * @returns {Array<{ resourceType, slug, name, text, section }>}
   */
  buildIndexableText() {
    const rows = this.db.all(
      `SELECT resource_type, slug, data FROM srd_cache
        WHERE resource_type IN ('monster','spell','equipment','class')
        ORDER BY resource_type, slug`
    )

    const entries = []
    for (const row of rows) {
      const text = buildIndexableText(row.resource_type, row.data)
      if (!text) continue   // malformed row — skipped, never fatal
      let name = row.slug
      try { name = JSON.parse(row.data)?.name ?? row.slug } catch { /* keep the slug */ }
      entries.push({
        resourceType: row.resource_type,
        slug: row.slug,
        name,
        text,
        section: srdSectionFor(row.resource_type),
      })
    }
    return entries
  }

  /** The shared SRD source row, or undefined if it has never been built. */
  getSrdSource() {
    return this.db.get(
      'SELECT * FROM pdf_sources WHERE campaign_id IS NULL AND filename = ?',
      [SRD_SOURCE_FILENAME]
    )
  }

  /**
   * Status for the Settings UI. Cheap enough to call on every render.
   */
  getIndexStatus() {
    const cached = this.db.get(
      `SELECT COUNT(*) AS c FROM srd_cache
        WHERE resource_type IN ('monster','spell','equipment','class')`
    )?.c ?? 0

    const source = this.getSrdSource()
    if (!source) {
      return { srdCached: cached, sourceId: null, chunks: 0, embedded: 0, status: 'not-indexed' }
    }

    const chunks = this.db.get('SELECT COUNT(*) AS c FROM pdf_chunks WHERE source_id=?', [source.id])?.c ?? 0
    const embedded = this.db.get(
      'SELECT COUNT(*) AS c FROM pdf_chunks WHERE source_id=? AND embedded=1', [source.id]
    )?.c ?? 0

    return {
      srdCached: cached,
      sourceId: source.id,
      chunks,
      embedded,
      // 'chunked' means the text is searchable by keyword but has no vectors —
      // which is the whole feature in no-Ollama mode, so it is not a failure.
      status: embedded > 0 ? 'embedded' : chunks > 0 ? 'chunked' : 'not-indexed',
    }
  }

  /**
   * Build (or rebuild) the SRD chunk rows. Does NOT embed — embedding needs
   * Ollama and is a separate, optional step, because keyword search over these
   * same chunks already makes rules Q&A work without it.
   *
   * Idempotent: re-running replaces the chunks rather than duplicating them.
   */
  buildSrdIndex(onProgress) {
    const entries = this.buildIndexableText()
    if (entries.length === 0) {
      throw new Error('No SRD data cached yet. Run "Re-seed SRD" first, then index.')
    }

    onProgress?.(0, `Preparing ${entries.length} SRD entries…`)

    let source = this.getSrdSource()
    if (!source) {
      const result = this.db.run(
        `INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count, indexed_at)
         VALUES (NULL, ?, NULL, 'pending', 0, datetime('now'))`,
        [SRD_SOURCE_FILENAME]
      )
      source = { id: Number(result.lastInsertRowid) }
    }
    const sourceId = source.id

    // Replace rather than append. Without this, re-indexing after a re-seed
    // would leave every old chunk in place and double the corpus.
    this.db.run('DELETE FROM pdf_chunks WHERE source_id=?', [sourceId])

    this.db.transaction(() => {
      entries.forEach((entry, i) => {
        this.db.run(
          `INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text, embedded)
           VALUES (?,?,?,?,0)`,
          [sourceId, i, entry.section, entry.text]
        )
      })
      this.db.run(
        `UPDATE pdf_sources SET status='indexed', chunk_count=?, indexed_at=datetime('now') WHERE id=?`,
        [entries.length, sourceId]
      )
    })

    onProgress?.(100, `Indexed ${entries.length} SRD entries.`)
    return { sourceId, chunks: entries.length }
  }

  /**
   * Drop the SRD index. Vector cleanup is the caller's job — SrdService has no
   * embeddingService, and wiring one in for this would invert the dependency.
   */
  clearSrdIndex() {
    const source = this.getSrdSource()
    if (!source) return { cleared: 0 }
    const { c } = this.db.get('SELECT COUNT(*) AS c FROM pdf_chunks WHERE source_id=?', [source.id]) ?? { c: 0 }
    this.db.run('DELETE FROM pdf_chunks WHERE source_id=?', [source.id])
    this.db.run('DELETE FROM pdf_sources WHERE id=?', [source.id])
    return { cleared: c, sourceId: source.id }
  }
}

module.exports = SrdService
