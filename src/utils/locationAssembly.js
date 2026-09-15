// Location-aware encounter assembly (Phase 7 task 1).
//
// An encounter tied to a location should know who is standing there. The data
// already existed — npcs.location_id since Phase 1, connections since Phase 2 —
// and nothing had ever read it from the Encounter Builder.
//
// The awkward part, and the reason this is a module rather than three lines in
// a component: an NPC row has no stat block. It has a name, a race, a class and
// some prose. Putting one in an initiative tracker needs hit points and an
// armour class from somewhere, and the honest answer is "from a real stat block
// if one matches by name, otherwise from a placeholder the DM edits". Deciding
// which, and building an entry that the tracker and the XP maths both accept,
// is worth testing.
import { createMonsterEntry, crToXP } from './encounterUtils.js'

const str = (v) => (v == null ? '' : String(v).trim())

/** Names are matched loosely — a DM types "Anders Solmor", the block says "Anders". */
export const nameKey = (v) => str(v).toLowerCase().replace(/\s+/g, ' ')

/** Default hit points and armour class for an NPC with no stat block behind it. */
export const PLACEHOLDER_HP = 11    // a commoner-ish 2d8+2, visible and editable
export const PLACEHOLDER_AC = 12

/**
 * Find a stat block whose name matches this NPC.
 *
 * Homebrew is preferred over SRD: a DM who wrote their own "Gellan Primewater"
 * meant that one, not a coincidence in the monster manual.
 *
 * @param npc         an npcs row
 * @param statBlocks  { homebrew: [], srd: [] }
 */
export function matchStatBlock(npc, { homebrew = [], srd = [] } = {}) {
  const key = nameKey(npc?.name)
  if (!key) return null

  const find = (list, source) => {
    const hit = (list ?? []).find(b => nameKey(b?.name) === key)
    return hit ? { block: hit, source } : null
  }

  return find(homebrew, 'homebrew') ?? find(srd, 'srd') ?? null
}

/**
 * Build a roster entry for an NPC.
 *
 * With a stat block, this is createMonsterEntry with the NPC's name kept — the
 * DM's "Captain Xendros" should not become "Bandit Captain" in the tracker just
 * because that is the block behind it.
 *
 * Without one, it is a named combatant with placeholder HP and AC, marked
 * `needs_stats` so the UI can say so rather than presenting 11 HP as though it
 * were researched.
 *
 * `source: 'npc'` as the brief specifies, and `entity_id` so the tracker can
 * link back to the NPC record.
 */
export function npcEncounterEntry(npc, match = null) {
  const name = str(npc?.name) || 'Unnamed NPC'

  if (match?.block) {
    const base = createMonsterEntry(match.block, match.source)
    return {
      ...base,
      // The DM's name wins over the stat block's.
      name,
      source: 'npc',
      stat_source: match.source,
      stat_block_index: base.source_index,
      entity_id: npc?.id ?? null,
      needs_stats: false,
      notes: str(npc?.role),
    }
  }

  return {
    id: crypto.randomUUID(),
    name,
    source: 'npc',
    source_index: null,
    stat_source: null,
    entity_id: npc?.id ?? null,
    // No stat block means no CR, and no CR means no XP. Zero is honest: the
    // difficulty maths should not credit a number nobody chose.
    cr: null,
    xp: 0,
    hp_max: PLACEHOLDER_HP,
    hp_current: PLACEHOLDER_HP,
    ac: PLACEHOLDER_AC,
    legendary_max: 0,
    lair_action_text: null,
    count: 1,
    custom_name: null,
    // What the panel reads to tell the DM these numbers are placeholders.
    needs_stats: true,
    notes: [str(npc?.role), str(npc?.race)].filter(Boolean).join(' · '),
  }
}

/**
 * Everything standing at a location, ready to offer.
 *
 * `connections` brings in NPCs linked to the location that are not filed under
 * it — a faction's agent who operates there, an enemy who visits. Those are
 * marked so the panel can group them separately from the residents.
 *
 * Already-added NPCs are excluded: offering to add someone twice is how a DM
 * ends up running the same captain against themselves.
 */
export function figuresAtLocation({
  locationId, npcsHere = [], connections = [], allNpcs = [], existingEntries = [],
} = {}) {
  const taken = new Set(
    (existingEntries ?? [])
      .filter(e => e?.source === 'npc' && e.entity_id != null)
      .map(e => Number(e.entity_id)),
  )

  const seen = new Set()
  const figures = []

  const push = (npc, via) => {
    if (!npc || npc.id == null) return
    const id = Number(npc.id)
    if (seen.has(id) || taken.has(id)) return
    seen.add(id)
    figures.push({ npc, via })
  }

  for (const npc of npcsHere) push(npc, 'here')

  // Connections are undirected: the location can be on either side.
  const byId = new Map((allNpcs ?? []).map(n => [Number(n.id), n]))
  for (const link of connections ?? []) {
    if (!link) continue
    let npcId = null
    if (link.entity_a_type === 'location' && Number(link.entity_a_id) === Number(locationId)
      && link.entity_b_type === 'npc') npcId = Number(link.entity_b_id)
    if (link.entity_b_type === 'location' && Number(link.entity_b_id) === Number(locationId)
      && link.entity_a_type === 'npc') npcId = Number(link.entity_a_id)
    if (npcId != null) push(byId.get(npcId), link.relationship || 'connected')
  }

  return figures
}

/** XP an NPC entry contributes, for the panel to show before adding. */
export function entryXp(entry) {
  if (!entry) return 0
  if (Number.isFinite(entry.xp)) return entry.xp
  return entry.cr == null ? 0 : crToXP(entry.cr)
}
