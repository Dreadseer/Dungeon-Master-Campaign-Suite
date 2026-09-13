// Serialising a fight so it survives a crash.
//
// combat_state stores `combatants` and `log_entries` as JSON blobs rather than
// child tables, because the combatant shape is a renderer concern that moves
// with the feature set — Phase 5 alone adds death saves, legendary actions,
// reactions and temp HP. A column per field would be a migration per feature.
//
// The cost of that choice is that yesterday's saved fight can have a different
// shape from today's code. So every blob carries a `schema_version`, and
// `deserialiseCombat` upgrades old shapes on read. A DM mid-campaign should
// never lose a fight because the app updated between sessions.

/** Bump when the combatant shape changes, and add an upgrade step below. */
export const COMBAT_SCHEMA_VERSION = 1

/**
 * Fields every combatant must have, with the value to use when an older save
 * (or a freshly built combatant) lacks them. Written as a factory because
 * arrays and objects must not be shared between combatants.
 */
const COMBATANT_DEFAULTS = () => ({
  conditions: [],
  concentration: false,
  is_active: false,
  temp_hp: 0,
  reaction_used: false,
  death_saves: { successes: 0, failures: 0 },
  legendary_max: 0,
  legendary_used: 0,
  lair_action_text: null,
})

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const toInt = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/** Death saves, normalised and clamped to the 0-3 the rules allow. */
export function normaliseDeathSaves(raw) {
  const src = isObject(raw) ? raw : {}
  const clamp = (v) => Math.min(3, Math.max(0, toInt(v, 0)))
  return { successes: clamp(src.successes), failures: clamp(src.failures) }
}

/**
 * Fill in anything a combatant is missing, without touching what it has.
 * Used both when hydrating a save and when building a fresh fight, so the two
 * paths cannot drift apart.
 */
export function normaliseCombatant(raw) {
  if (!isObject(raw)) return null
  const c = { ...COMBATANT_DEFAULTS(), ...raw }

  c.conditions = Array.isArray(raw.conditions) ? raw.conditions.filter(x => typeof x === 'string') : []
  c.death_saves = normaliseDeathSaves(raw.death_saves)
  c.temp_hp = Math.max(0, toInt(raw.temp_hp, 0))
  c.legendary_max = Math.max(0, toInt(raw.legendary_max, 0))
  // Cannot have spent more legendary actions than exist.
  c.legendary_used = Math.min(c.legendary_max, Math.max(0, toInt(raw.legendary_used, 0)))
  c.reaction_used = raw.reaction_used === true
  c.concentration = raw.concentration === true
  c.is_active = raw.is_active === true
  c.initiative = toInt(raw.initiative, 0)
  c.initiative_mod = toInt(raw.initiative_mod, 0)
  c.hp_max = toInt(raw.hp_max, 0)
  // hp_current is allowed to be negative in some tables' house rules; only the
  // absence of a value is corrected.
  c.hp_current = raw.hp_current == null ? c.hp_max : toInt(raw.hp_current, 0)
  c.ac = toInt(raw.ac, 10)
  c.lair_action_text = typeof raw.lair_action_text === 'string' && raw.lair_action_text.trim()
    ? raw.lair_action_text
    : null

  return c
}

/**
 * Pack live tracker state into the row shape `db:combat:save` expects.
 *
 * @param {object} state { campaignId, encounterId, combatants, round, phase, log }
 */
export function serialiseCombat(state) {
  const combatants = (Array.isArray(state.combatants) ? state.combatants : [])
    .map(normaliseCombatant)
    .filter(Boolean)

  return {
    campaign_id: toInt(state.campaignId, 0),
    encounter_id: toInt(state.encounterId, 0),
    round_count: Math.max(1, toInt(state.round, 1)),
    phase: ['setup', 'active', 'ended'].includes(state.phase) ? state.phase : 'setup',
    combatants: JSON.stringify({
      schema_version: COMBAT_SCHEMA_VERSION,
      combatants,
    }),
    // The log is plain strings or {text, round} entries; it needs no upgrading,
    // but it is versioned alongside so the two blobs stay symmetrical.
    log_entries: JSON.stringify({
      schema_version: COMBAT_SCHEMA_VERSION,
      entries: Array.isArray(state.log) ? state.log.slice(0, 500) : [],
    }),
  }
}

/** Parse a JSON column that may be a string, already-parsed, or rubbish. */
function parseBlob(value) {
  if (isObject(value) || Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return null
  try { return JSON.parse(value) } catch { return null }
}

/**
 * Unpack a combat_state row into tracker state.
 *
 * Returns null when there is nothing usable, so the caller falls back to
 * buildCombatants — a corrupt save should start a fresh fight, not crash the
 * tracker on the one screen a DM needs mid-session.
 *
 * @returns {{ combatants, round, phase, log, upgradedFrom }|null}
 */
export function deserialiseCombat(row) {
  if (!row) return null

  const combatBlob = parseBlob(row.combatants)
  const logBlob = parseBlob(row.log_entries)

  // Two accepted shapes: the versioned envelope, and a bare array from a save
  // written before versioning existed.
  let rawCombatants = null
  let version = 0
  if (Array.isArray(combatBlob)) {
    rawCombatants = combatBlob                 // pre-version save
  } else if (isObject(combatBlob) && Array.isArray(combatBlob.combatants)) {
    rawCombatants = combatBlob.combatants
    version = toInt(combatBlob.schema_version, 0)
  }

  if (!rawCombatants || rawCombatants.length === 0) return null

  const combatants = rawCombatants.map(normaliseCombatant).filter(Boolean)
  if (combatants.length === 0) return null

  const entries = Array.isArray(logBlob) ? logBlob
    : (isObject(logBlob) && Array.isArray(logBlob.entries)) ? logBlob.entries
      : []

  return {
    combatants,
    round: Math.max(1, toInt(row.round_count, 1)),
    phase: ['setup', 'active', 'ended'].includes(row.phase) ? row.phase : 'setup',
    log: entries,
    // Non-null when the save predates the current shape, so the caller can
    // re-save in the new format and the upgrade happens once.
    upgradedFrom: version < COMBAT_SCHEMA_VERSION ? version : null,
  }
}

/**
 * Has anything worth saving changed?
 *
 * The tracker saves on a debounce after every state change, and React hands out
 * new array identities constantly. Comparing the serialised payload means an
 * unchanged fight does not rewrite the row every time a component re-renders.
 */
export function combatPayloadChanged(previousJson, nextPayload) {
  const next = `${nextPayload.round_count}|${nextPayload.phase}|${nextPayload.combatants}|${nextPayload.log_entries}`
  return { changed: previousJson !== next, key: next }
}

/** Summary for the "Combat in progress" link and encounter-list badges. */
export function describeSavedCombat(row) {
  if (!row) return null
  const parsed = deserialiseCombat(row)
  if (!parsed) return null
  const living = parsed.combatants.filter(c => (c.hp_current ?? 0) > 0).length
  return {
    encounterId: row.encounter_id,
    encounterName: row.encounter_name ?? null,
    round: parsed.round,
    phase: parsed.phase,
    combatants: parsed.combatants.length,
    living,
    label: `Resume combat (round ${parsed.round})`,
  }
}
