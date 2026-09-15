// Per-instance monster HP (Phase 7 task 3).
//
// An encounter's `monsters` JSON stores one entry per monster TYPE with a
// `count`. Until now the entry carried a single `hp_current`, so
// buildCombatants gave every copy the same value:
//
//   hp_current: entry.hp_current ?? entry.hp_max        // combatUtils.js
//
// Three goblins therefore shared one hit point total. Damage one in the tracker
// and either all three changed or — because the tracker kept its own combatant
// list — none of it survived back into the encounter row at all. A DM who
// bloodied two of four ogres, closed the encounter and reopened it got four
// untouched ogres.
//
// Each entry now carries `instances: [{ hp_current }]`, one per copy. The
// migration is LAZY and happens here on read, never in SQL: an encounter row is
// a JSON blob a DM may never open again, and rewriting every one of them in a
// migration would touch rows to fix a problem those rows may not have.

const int = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/** Count is at least 1: a monster entry with 0 copies is not a thing. */
const entryCount = (entry) => Math.max(1, int(entry?.count, 1))

/** Full HP for an entry, falling back through the shapes older rows used. */
const fullHp = (entry) => {
  const max = int(entry?.hp_max, NaN)
  if (Number.isFinite(max) && max > 0) return max
  const cur = int(entry?.hp_current, NaN)
  return Number.isFinite(cur) && cur > 0 ? cur : 1
}

/**
 * Ensure one entry has an `instances` array exactly `count` long.
 *
 * Three cases, all of which happen in practice:
 *   - no instances at all — an entry written before Phase 7. Every copy is
 *     seeded from the entry's own hp_current, so a DM who had set the type's HP
 *     keeps it rather than having it silently reset to full.
 *   - fewer instances than count — the DM raised the count. New copies arrive
 *     at full health, which is what adding a monster means.
 *   - more instances than count — the DM lowered it. The EXTRAS ARE DROPPED
 *     FROM THE END, so the survivors keep the HP they had; truncating from the
 *     front would silently renumber which goblin was wounded.
 *
 * Pure: returns a new entry and never mutates the one given.
 */
export function withInstances(entry) {
  if (!entry || typeof entry !== 'object') return entry

  const count = entryCount(entry)
  const max = fullHp(entry)

  const existing = Array.isArray(entry.instances) ? entry.instances : null

  // The seed for a pre-Phase-7 entry: whatever single value it carried.
  const seeded = Number.isFinite(int(entry.hp_current, NaN)) ? int(entry.hp_current) : max

  const instances = []
  for (let i = 0; i < count; i++) {
    const prior = existing?.[i]
    const hp = prior && Number.isFinite(int(prior.hp_current, NaN))
      ? int(prior.hp_current)
      : (existing ? max : seeded)
    // Clamp: a stored value above max (the DM lowered hp_max later) or below
    // zero would render as a broken HP bar.
    instances.push({ hp_current: Math.max(0, Math.min(max, hp)) })
  }

  return { ...entry, hp_max: max, instances }
}

/**
 * Parse and normalise an encounter's monsters.
 *
 * Accepts the JSON string straight off the row, or an already-parsed array, and
 * always returns an array — a corrupt blob yields [] rather than throwing on
 * the one screen a DM needs mid-session.
 */
export function normaliseMonsters(monsters) {
  const raw = typeof monsters === 'string'
    ? (() => { try { return JSON.parse(monsters) } catch { return [] } })()
    : monsters

  return (Array.isArray(raw) ? raw : [])
    .filter(e => e && typeof e === 'object')
    .map(withInstances)
}

/** HP for the i-th copy of an entry, after normalisation. */
export function instanceHp(entry, index) {
  const normalised = withInstances(entry)
  return normalised.instances?.[index]?.hp_current ?? fullHp(entry)
}

/**
 * Write tracker HP back into the monster entries.
 *
 * Combatants built by buildCombatants carry `entry_id` and `instance_index`,
 * which is what makes this exact rather than positional: a roster reordered by
 * initiative, or with defeated monsters sorted to the end, still maps back to
 * the right copy.
 *
 * Players are ignored — their HP goes to the characters table, not here.
 *
 * @returns {{ monsters: Array, changed: boolean }}
 */
export function applyCombatantHp(monsters, combatants) {
  const normalised = normaliseMonsters(monsters)
  if (normalised.length === 0) return { monsters: normalised, changed: false }

  const byId = new Map(normalised.map(e => [e.id, e]))
  let changed = false

  for (const c of Array.isArray(combatants) ? combatants : []) {
    if (!c || c.is_player) continue
    const entry = byId.get(c.entry_id)
    if (!entry) continue

    const i = int(c.instance_index, -1)
    if (i < 0 || i >= entry.instances.length) continue

    const hp = Math.max(0, Math.min(fullHp(entry), int(c.hp_current, 0)))
    if (entry.instances[i].hp_current !== hp) {
      entry.instances[i] = { ...entry.instances[i], hp_current: hp }
      changed = true
    }
  }

  return { monsters: normalised, changed }
}

/** Reset every copy to full — "heal all" between sessions. */
export function resetInstances(monsters) {
  return normaliseMonsters(monsters).map(entry => ({
    ...entry,
    instances: entry.instances.map(() => ({ hp_current: fullHp(entry) })),
  }))
}

/** How many copies of this entry are still standing, for the encounter list. */
export function livingCount(entry) {
  return withInstances(entry).instances.filter(i => i.hp_current > 0).length
}

/**
 * A short "2/4 standing" for an encounter row, or '' when nothing is hurt.
 *
 * Silent when the encounter is untouched: a list of every encounter reading
 * "4/4 standing" is noise.
 */
export function describeWounded(monsters) {
  const normalised = normaliseMonsters(monsters)
  const total = normalised.reduce((n, e) => n + e.instances.length, 0)
  const living = normalised.reduce((n, e) => n + livingCount(e), 0)
  return total > 0 && living < total ? `${living}/${total} standing` : ''
}
