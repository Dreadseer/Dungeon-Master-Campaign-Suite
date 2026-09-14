// Indexing a campaign's own tables for retrieval (Phase 6 task 7).
//
// DMCS already had a working retrieval pipeline pointed exclusively at PDFs.
// Rather than build a second one, campaign lore is indexed as an ordinary
// source: one sentinel pdf_sources row per campaign, one pdf_chunk per entity.
// EmbeddingService.embedSource, .search and .deleteSource then work unchanged.
//
// The sentinel is identified by its filename prefix AND a null file_path. Every
// write below is scoped to a source that passes that test, so a re-sync can
// never touch the chunks of a PDF the DM imported.

const LORE_SOURCE_PREFIX = 'Campaign lore — '

const str = (v) => (v == null ? '' : String(v).trim())
const lines = (...parts) => parts.filter(p => str(p)).join('\n')

/**
 * Build one chunk per entity.
 *
 * Mirrors src/utils/loreCorpus.js, which is the tested renderer-side copy used
 * for the preview. Kept as a small duplicate rather than shared because
 * electron/ is CommonJS and src/ is ESM, and the build does not bridge them —
 * the alternative is a bundling step for one function. The two are covered by
 * the same expectations: loreCorpus.test.js for the shape, and
 * verify-lore-index.mjs for this copy against a real database.
 */
function buildLoreChunks({ lore = [], npcs = [], locations = [], factions = [] } = {}) {
  const chunks = []

  const push = (entityType, entityId, name, text) => {
    const body = str(text)
    if (!str(name) && !body) return
    chunks.push({ key: `${entityType}:${entityId}`, entity_type: entityType, entity_id: entityId, name: str(name), text: body })
  }

  for (const l of lore) {
    if (!l || l.id == null) continue
    push('lore', l.id, l.name, lines(
      `Lore: ${str(l.name)}`,
      l.category ? `Category: ${str(l.category)}` : '',
      l.is_secret ? 'This entry is secret from the players.' : '',
      str(l.content),
    ))
  }

  for (const n of npcs) {
    if (!n || n.id == null) continue
    push('npc', n.id, n.name, lines(
      `NPC: ${str(n.name)}`,
      [str(n.race), str(n.class)].filter(Boolean).join(' '),
      n.role ? `Role: ${str(n.role)}` : '',
      n.motivation ? `Motivation: ${str(n.motivation)}` : '',
      n.notes ? `Notes: ${str(n.notes)}` : '',
      n.secrets ? `Secret: ${str(n.secrets)}` : '',
      n.is_alive === 0 ? 'This NPC is dead.' : '',
    ))
  }

  for (const l of locations) {
    if (!l || l.id == null) continue
    push('location', l.id, l.name, lines(
      `Location: ${str(l.name)}`,
      l.type ? `Type: ${str(l.type)}` : '',
      str(l.description),
      l.lore ? `Lore: ${str(l.lore)}` : '',
    ))
  }

  for (const f of factions) {
    if (!f || f.id == null) continue
    push('faction', f.id, f.name, lines(
      `Faction: ${str(f.name)}`,
      f.alignment ? `Alignment: ${str(f.alignment)}` : '',
      str(f.description),
      f.notes ? `Notes: ${str(f.notes)}` : '',
    ))
  }

  return chunks.filter(c => c.text.split('\n').length > 1)
}

class CampaignLoreIndex {
  constructor(db, embeddingService) {
    this.db = db
    this.embeddingService = embeddingService
  }

  sourceName(campaignName) {
    return `${LORE_SOURCE_PREFIX}${str(campaignName) || 'Untitled campaign'}`
  }

  /** The sentinel row for a campaign, or null. Never returns a real PDF. */
  findSource(campaignId) {
    const row = this.db.get(
      `SELECT * FROM pdf_sources
       WHERE campaign_id = ? AND file_path IS NULL AND filename LIKE ?
       ORDER BY id LIMIT 1`,
      [campaignId, `${LORE_SOURCE_PREFIX}%`],
    )
    return row ?? null
  }

  ensureSource(campaignId, campaignName) {
    const existing = this.findSource(campaignId)
    if (existing) {
      // Keep the label in step with a renamed campaign.
      const wanted = this.sourceName(campaignName)
      if (existing.filename !== wanted) {
        this.db.run('UPDATE pdf_sources SET filename = ? WHERE id = ?', [wanted, existing.id])
        existing.filename = wanted
      }
      return existing
    }

    const result = this.db.run(
      `INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count, indexed_at)
       VALUES (?, ?, NULL, 'pending', 0, datetime('now'))`,
      [campaignId, this.sourceName(campaignName)],
    )
    return this.findSource(campaignId) ?? { id: Number(result.lastInsertRowid), campaign_id: campaignId }
  }

  /** Read the campaign's world tables. */
  readWorld(campaignId) {
    const lore = this.db
      .all(`SELECT id, name, data FROM compendium_custom WHERE campaign_id = ? AND type = 'lore'`, [campaignId])
      .map(row => {
        let parsed = {}
        try { parsed = JSON.parse(row.data ?? '{}') } catch { /* a corrupt blob indexes as title-only */ }
        return { id: row.id, name: row.name, content: parsed.content, category: parsed.category, is_secret: parsed.is_secret }
      })

    return {
      lore,
      npcs: this.db.all('SELECT id, name, race, class, role, motivation, notes, secrets, is_alive FROM npcs WHERE campaign_id = ?', [campaignId]),
      locations: this.db.all('SELECT id, name, type, description, lore FROM locations WHERE campaign_id = ?', [campaignId]),
      factions: this.db.all('SELECT id, name, alignment, description, notes FROM factions WHERE campaign_id = ?', [campaignId]),
    }
  }

  /** What a sync would do, without doing it. */
  preview(campaignId) {
    const source = this.findSource(campaignId)
    const next = buildLoreChunks(this.readWorld(campaignId))
    const existing = source
      ? this.db.all('SELECT id, chunk_index, text, embedded FROM pdf_chunks WHERE source_id = ?', [source.id])
      : []

    const storedText = new Map()
    for (const row of existing) {
      if (!storedText.has(row.text)) storedText.set(row.text, [])
      storedText.get(row.text).push(row)
    }

    const matched = new Set()
    let unchanged = 0
    let added = 0
    for (const chunk of next) {
      const hit = (storedText.get(chunk.text) ?? []).find(r => !matched.has(r.id))
      if (hit) { matched.add(hit.id); unchanged++ } else { added++ }
    }
    const removed = existing.filter(r => !matched.has(r.id)).length

    return { sourceId: source?.id ?? null, total: next.length, added, removed, unchanged }
  }

  /**
   * Rebuild the campaign's chunks and embed whatever changed.
   *
   * Unchanged chunks keep their row AND their vector, so editing one NPC does
   * not re-embed a 300-entity campaign — re-embedding is an Ollama call each,
   * and that is the expensive step.
   *
   * Stale rows are deleted, but only ever from the sentinel source: they are
   * regenerated output, not authored content, and the campaign's own tables
   * remain the record. `assertOwnSource` is what guarantees the scope.
   */
  async sync(campaignId, campaignName, onProgress) {
    const source = this.ensureSource(campaignId, campaignName)
    this.assertOwnSource(source)

    const next = buildLoreChunks(this.readWorld(campaignId))
    const existing = this.db.all(
      'SELECT id, chunk_index, text FROM pdf_chunks WHERE source_id = ?', [source.id])

    const storedText = new Map()
    for (const row of existing) {
      if (!storedText.has(row.text)) storedText.set(row.text, [])
      storedText.get(row.text).push(row)
    }

    const matched = new Set()
    const toAdd = []
    for (const chunk of next) {
      const hit = (storedText.get(chunk.text) ?? []).find(r => !matched.has(r.id))
      if (hit) matched.add(hit.id)
      else toAdd.push(chunk)
    }
    const stale = existing.filter(r => !matched.has(r.id))

    // Drop stale vectors before their rows, so the index never points at a
    // chunk id that no longer exists. One call for the whole batch: listItems()
    // walks the entire index, and doing that per chunk is what makes it slow.
    if (stale.length > 0) {
      try {
        await this.embeddingService.deleteChunks(stale.map(r => r.id))
      } catch {
        // Ollama absent, or no index yet. The rows still go, and the orphaned
        // vectors are replaced on the next successful embed.
      }
      for (const row of stale) {
        this.db.run('DELETE FROM pdf_chunks WHERE id = ? AND source_id = ?', [row.id, source.id])
      }
    }

    let index = this.db.get(
      'SELECT COALESCE(MAX(chunk_index), -1) AS maxIndex FROM pdf_chunks WHERE source_id = ?',
      [source.id])?.maxIndex ?? -1

    for (const chunk of toAdd) {
      index++
      this.db.run(
        `INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text, embedded)
         VALUES (?, ?, NULL, ?, 0)`,
        [source.id, index, chunk.text],
      )
    }

    const total = this.db.get(
      'SELECT COUNT(*) AS n FROM pdf_chunks WHERE source_id = ?', [source.id])?.n ?? 0

    this.db.run(
      `UPDATE pdf_sources SET chunk_count = ?, status = 'indexed', indexed_at = datetime('now') WHERE id = ?`,
      [total, source.id])

    // Embedding needs Ollama. A campaign with no embeddings still gives the
    // assistant its lore through aiContext's budgeted summary, so a failure
    // here degrades retrieval rather than breaking the feature.
    let embedded = 0
    let embedError = null
    if (toAdd.length > 0) {
      try {
        const result = await this.embeddingService.embedSource(source.id, onProgress)
        embedded = result?.embedded ?? 0
      } catch (err) {
        embedError = err?.message ?? 'Embedding failed'
      }
    }

    return {
      sourceId: source.id,
      total, added: toAdd.length, removed: stale.length,
      unchanged: matched.size, embedded, embedError,
    }
  }

  /** Refuse to write to anything but the generated source. */
  assertOwnSource(source) {
    const ok = source
      && typeof source.filename === 'string'
      && source.filename.startsWith(LORE_SOURCE_PREFIX)
      && !source.file_path
    if (!ok) {
      throw new Error('Refusing to modify a source that is not the generated campaign lore index')
    }
  }
}

module.exports = CampaignLoreIndex
module.exports.LORE_SOURCE_PREFIX = LORE_SOURCE_PREFIX
module.exports.buildLoreChunks = buildLoreChunks
