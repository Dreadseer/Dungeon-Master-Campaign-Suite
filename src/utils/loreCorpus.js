// Turning a campaign's own tables into retrievable text (Phase 6 task 7).
//
// DMCS already has a working retrieval pipeline — EmbeddingService writes
// vectors for pdf_chunks and RAGService queries them — but it has only ever
// been pointed at PDFs. The capability review's phrasing is exact: aiming it at
// the campaign's own tables is "a metadata change and a second index namespace,
// not a new system".
//
// So campaign lore is indexed as an ordinary source: one sentinel pdf_sources
// row per campaign, with one pdf_chunk per entity. embedSource, search and
// deleteSource then work unchanged.
//
// This module is the pure part: what text each entity contributes, and how to
// tell which chunks actually changed. Deciding a chunk is unchanged is what
// keeps a re-sync from re-embedding a 300-entity campaign on every save, so it
// is worth testing rather than assuming.

/** Marks the generated source. A real PDF never has this prefix and no file_path. */
export const LORE_SOURCE_PREFIX = 'Campaign lore — '

export const loreSourceName = (campaignName) =>
  `${LORE_SOURCE_PREFIX}${String(campaignName ?? '').trim() || 'Untitled campaign'}`

/**
 * Is this source row the generated lore index rather than a real document?
 *
 * Used as a guard before regenerating chunks: the sync rewrites the chunks it
 * owns, and must never touch a PDF the DM imported.
 */
export const isLoreSource = (source) =>
  Boolean(source)
  && typeof source.filename === 'string'
  && source.filename.startsWith(LORE_SOURCE_PREFIX)
  && !source.file_path

const str = (v) => (v == null ? '' : String(v).trim())

/** Join the non-empty parts, so an entity with no description does not emit blank lines. */
const lines = (...parts) => parts.filter(p => str(p)).join('\n')

/**
 * One chunk per entity.
 *
 * The entity's kind and name lead the text because that is what a query is
 * usually about — "does the thieves' guild have a rival?" should match the
 * faction entry on the word "guild" even before the embedding does its work.
 *
 * Secrets ARE included. This index is only ever read by the DM's own assistant
 * and the contradiction check; the player-facing paths (Phase 2's server, the
 * player recap) never touch it.
 */
export function buildLoreChunks({ lore = [], npcs = [], locations = [], factions = [] } = {}) {
  const chunks = []

  const push = (entityType, entityId, name, text) => {
    const body = str(text)
    if (!str(name) && !body) return
    chunks.push({
      key: `${entityType}:${entityId}`,
      entity_type: entityType,
      entity_id: entityId,
      name: str(name),
      text: body,
    })
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

  // An entity whose every text field is empty contributes only its own name,
  // which retrieves nothing useful and costs an embedding call.
  return chunks.filter(c => c.text.split('\n').length > 1)
}

/**
 * Compare freshly built chunks against what is already stored.
 *
 * Re-embedding is the expensive step — an Ollama call per chunk — so a sync
 * that rewrote everything would make saving one NPC re-embed the whole world.
 *
 * @param {Array} next     from buildLoreChunks
 * @param {Array} existing rows already in pdf_chunks for the sentinel source,
 *                         each { id, chunk_index, text }
 * @returns {{ added, changed, unchanged, removed }}
 */
export function diffLoreChunks(next, existing = []) {
  const byText = new Map()
  for (const row of existing ?? []) {
    if (!row) continue
    const t = str(row.text)
    if (!byText.has(t)) byText.set(t, [])
    byText.get(t).push(row)
  }

  const added = []
  const unchanged = []
  const matchedIds = new Set()

  for (const chunk of next ?? []) {
    const pool = byText.get(chunk.text)
    const hit = pool?.find(r => !matchedIds.has(r.id))
    if (hit) {
      matchedIds.add(hit.id)
      unchanged.push({ ...chunk, id: hit.id })
    } else {
      added.push(chunk)
    }
  }

  // Anything stored that nothing in `next` matched is stale: the entity was
  // edited (so its text changed) or deleted outright.
  const removed = (existing ?? []).filter(r => r && !matchedIds.has(r.id))

  return { added, changed: added.length + removed.length, unchanged, removed }
}

/** A short line for the UI: what a sync would actually do. */
export function describeLoreSync({ added = [], removed = [], unchanged = [] } = {}) {
  if (added.length === 0 && removed.length === 0) {
    return unchanged.length
      ? `Up to date — ${unchanged.length} ${unchanged.length === 1 ? 'entry' : 'entries'} indexed.`
      : 'Nothing to index yet.'
  }
  const parts = []
  if (added.length) parts.push(`${added.length} to embed`)
  if (removed.length) parts.push(`${removed.length} stale to drop`)
  if (unchanged.length) parts.push(`${unchanged.length} unchanged`)
  return parts.join(', ')
}
