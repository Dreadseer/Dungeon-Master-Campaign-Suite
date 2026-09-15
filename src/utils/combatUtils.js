import { calculateAC } from './acUtils'
import { normaliseMonsters } from './monsterInstances.js'

// Combatant shape. Persisted since Phase 5 — see combat_state (migration 012)
// and src/utils/combatPersistence.js, which versions this shape so a save made
// by an older build can still be loaded.
//
// { id, name, type, initiative, initiative_mod, hp_max, hp_current, temp_hp,
//   ac, conditions, concentration, reaction_used, death_saves,
//   legendary_max, legendary_used, lair_action_text,
//   is_active, is_player, entity_id, source_entry }

export const rollInitiative = (mod = 0) =>
  Math.floor(Math.random() * 20) + 1 + mod

/**
 * @param {object} encounter  row from `encounters`
 * @param {Array}  characters rows from `characters`
 * @param {object} options
 *   acLookup — (sourceIndex) => number|null, used to backfill AC for monster
 *   entries saved before Phase 5, which have no `ac` field. Supplied by the
 *   tracker from the SRD cache; omitted, those monsters fall back to 10 as
 *   before.
 */
export const buildCombatants = (encounter, characters, options = {}) => {
  // normaliseMonsters rather than JSON.parse: it performs the lazy Phase 7
  // migration, so every entry arrives with one `instances` slot per copy even
  // if the row was written before Phase 7 existed.
  const monsters   = normaliseMonsters(encounter.monsters)
  const combatants = []
  const acLookup   = typeof options.acLookup === 'function' ? options.acLookup : null

  // Expand each monster entry by count into individual combatants
  monsters.forEach(entry => {
    // Entries created before Phase 5 have no `ac`. Rather than defaulting every
    // one of them to 10 forever, look the stat block up by the source_index the
    // entry already carries. Only when that fails do we fall back.
    let ac = entry.ac
    if (ac == null && acLookup && entry.source_index) {
      ac = acLookup(entry.source_index)
    }

    for (let i = 0; i < entry.instances.length; i++) {
      combatants.push({
        id:             crypto.randomUUID(),
        name:           entry.instances.length > 1 ? `${entry.name} ${i + 1}` : entry.name,
        type:           'monster',
        initiative:     0,
        initiative_mod: 0,
        hp_max:         entry.hp_max,
        // Per COPY, not per type. This used to be `entry.hp_current ??
        // entry.hp_max`, so three goblins shared one hit point total.
        hp_current:     entry.instances[i].hp_current,
        temp_hp:        0,
        ac:             ac ?? 10,
        conditions:     [],
        concentration:  false,
        reaction_used:  false,
        death_saves:    { successes: 0, failures: 0 },
        legendary_max:  entry.legendary_max ?? 0,
        legendary_used: 0,
        lair_action_text: entry.lair_action_text ?? null,
        is_active:      false,
        is_player:      false,
        entity_id:      null,
        // What applyCombatantHp maps by on the way back. Position cannot be
        // used: the tracker sorts by initiative and moves the defeated to the
        // end, so the third row is rarely the third goblin.
        entry_id:       entry.id,
        instance_index: i,
        source_entry:   entry,
      })
    }
  })

  // Add player characters
  characters.forEach(char => {
    const stats  = JSON.parse(char.stats ?? '{}')
    const dexMod = Math.floor(((stats.dex ?? 10) - 10) / 2)

    // Player AC was `10 + dexMod`, which ignored armour entirely — a plate-clad
    // fighter entered combat at AC 9. calculateAC reads the inventory, the
    // armour table, shields and unarmoured-defence formulas, and is what the
    // character sheet already displays. Using it here means the tracker and the
    // sheet can no longer disagree.
    let ac = 10 + dexMod
    try {
      const computed = calculateAC(char)?.ac
      if (Number.isFinite(computed)) ac = computed
    } catch {
      // A malformed inventory should cost this one character its armour bonus,
      // not stop the fight from starting.
    }

    combatants.push({
      id:             crypto.randomUUID(),
      name:           char.character_name,
      type:           'player',
      initiative:     0,
      initiative_mod: dexMod,
      hp_max:         char.hp_max,
      hp_current:     char.hp_current,
      temp_hp:        0,
      ac,
      conditions:     [],
      concentration:  false,
      reaction_used:  false,
      death_saves:    stats.death_saves ?? { successes: 0, failures: 0 },
      legendary_max:  0,
      legendary_used: 0,
      lair_action_text: null,
      is_active:      false,
      is_player:      true,
      entity_id:      char.id,
      source_entry:   char,
    })
  })

  return combatants
}

export const sortByInitiative = (combatants) =>
  [...combatants].sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative
    return b.initiative_mod - a.initiative_mod  // tie-break by DEX mod
  })

export const nextTurn = (combatants, currentIndex) => {
  const next = (currentIndex + 1) % combatants.length
  return combatants.map((c, i) => ({ ...c, is_active: i === next }))
}

// ── Conditions (Phase 5 Prompt 04) ────────────────────────────────────────
export const CONDITIONS = [
  { name: 'Blinded',       color: '#555',    icon: '👁️',  description: "Can't see, auto-fails sight checks, attack rolls have disadvantage in/out" },
  { name: 'Charmed',       color: '#E91E8C', icon: '💕',  description: "Can't attack charmer, charmer has advantage on social checks" },
  { name: 'Deafened',      color: '#795548', icon: '🔇',  description: "Can't hear, auto-fails hearing checks" },
  { name: 'Exhaustion',    color: '#9C27B0', icon: '😫',  description: 'Levels 1-6, each with cumulative penalties' },
  { name: 'Frightened',    color: '#FF5722', icon: '😨',  description: "Disadvantage on checks/attacks while source is in sight, can't move closer" },
  { name: 'Grappled',      color: '#607D8B', icon: '🤝',  description: "Speed 0, ends if grappler incapacitated or out of reach" },
  { name: 'Incapacitated', color: '#F44336', icon: '💫',  description: "Can't take actions or reactions" },
  { name: 'Invisible',     color: '#90A4AE', icon: '👻',  description: "Can't be seen, attack rolls advantage, attacks against have disadvantage" },
  { name: 'Paralyzed',     color: '#FF9800', icon: '🧊',  description: "Incapacitated, auto-fails STR/DEX saves, attacks within 5ft auto-crit" },
  { name: 'Petrified',     color: '#9E9E9E', icon: '🗿',  description: "Transformed to stone, incapacitated, immune to poison/disease" },
  { name: 'Poisoned',      color: '#4CAF50', icon: '🤢',  description: "Disadvantage on attack rolls and ability checks" },
  { name: 'Prone',         color: '#795548', icon: '⬇️',  description: "Disadvantage on attacks, melee attacks from within 5ft have advantage" },
  { name: 'Restrained',    color: '#FF9800', icon: '🕸️',  description: "Speed 0, disadvantage on attacks and DEX saves, attacks against have advantage" },
  { name: 'Stunned',       color: '#F44336', icon: '⭐',  description: "Incapacitated, auto-fails STR/DEX saves, attacks against have advantage" },
  { name: 'Unconscious',   color: '#212121', icon: '💤',  description: "Incapacitated, drops items, prone, auto-fails STR/DEX saves, auto-crit within 5ft" },
]

export const getCondition = (name) => CONDITIONS.find(c => c.name === name)

// ── Phase 5: round bookkeeping, temp HP, legendary actions ───────────────────

/**
 * Everything that resets when the round ticks over.
 *
 * Legendary actions and reactions both refresh "at the start of each turn" /
 * "per round" and were previously tracked nowhere, so a DM had to remember
 * which of three legendary actions a dragon had already spent. Doing it here,
 * purely, means the tracker cannot forget.
 */
export const resetForNewRound = (combatants) =>
  (Array.isArray(combatants) ? combatants : []).map(c => ({
    ...c,
    legendary_used: 0,
    reaction_used: false,
  }))

/**
 * Apply damage or healing, temp HP first.
 *
 * Temporary hit points are not hit points: they absorb damage before real HP,
 * they do not stack with each other, and healing never restores them. Getting
 * this wrong in the other direction (healing into temp HP) is the common bug.
 *
 * @param {object} combatant
 * @param {number} delta  negative to damage, positive to heal
 * @returns {{ combatant, absorbed, applied, overkill }}
 */
export function applyHPDelta(combatant, delta) {
  const amount = Math.trunc(Number(delta) || 0)
  const tempBefore = Math.max(0, Math.trunc(Number(combatant?.temp_hp) || 0))
  const hpBefore = Math.trunc(Number(combatant?.hp_current) || 0)
  const hpMax = Math.trunc(Number(combatant?.hp_max) || 0)

  if (amount >= 0) {
    // Healing never touches temp HP, and never exceeds the maximum.
    const healed = Math.min(hpMax, hpBefore + amount)
    return {
      combatant: { ...combatant, hp_current: healed, temp_hp: tempBefore },
      absorbed: 0,
      applied: healed - hpBefore,
      overkill: 0,
    }
  }

  const damage = Math.abs(amount)
  const absorbed = Math.min(tempBefore, damage)
  const toHp = damage - absorbed
  const hpAfter = hpBefore - toHp

  return {
    combatant: {
      ...combatant,
      temp_hp: tempBefore - absorbed,
      // Floor at 0: a creature is at 0 HP and dying, not at -12.
      hp_current: Math.max(0, hpAfter),
    },
    absorbed,
    applied: toHp,
    overkill: hpAfter < 0 ? Math.abs(hpAfter) : 0,
  }
}

/**
 * Grant temporary hit points. They do not stack — 5e says take the higher.
 */
export const grantTempHP = (combatant, amount) => {
  const granted = Math.max(0, Math.trunc(Number(amount) || 0))
  const current = Math.max(0, Math.trunc(Number(combatant?.temp_hp) || 0))
  return { ...combatant, temp_hp: Math.max(current, granted) }
}

/** Spend one legendary action, if any remain. */
export const spendLegendaryAction = (combatant) => {
  const max = Math.max(0, Math.trunc(Number(combatant?.legendary_max) || 0))
  const used = Math.max(0, Math.trunc(Number(combatant?.legendary_used) || 0))
  if (used >= max) return combatant
  return { ...combatant, legendary_used: used + 1 }
}

export const restoreLegendaryAction = (combatant) => {
  const used = Math.max(0, Math.trunc(Number(combatant?.legendary_used) || 0))
  return { ...combatant, legendary_used: Math.max(0, used - 1) }
}

/** The synthetic initiative-20 row, when anything in the fight has lair actions. */
export const LAIR_ACTION_INITIATIVE = 20

export function lairActionRow(combatants) {
  const withLair = (Array.isArray(combatants) ? combatants : [])
    .filter(c => typeof c?.lair_action_text === 'string' && c.lair_action_text.trim())
  if (withLair.length === 0) return null

  return {
    id: 'lair-actions',
    name: 'Lair Actions',
    type: 'lair',
    initiative: LAIR_ACTION_INITIATIVE,
    // Loses initiative ties to creatures, per "initiative count 20, losing
    // initiative ties".
    initiative_mod: -Infinity,
    is_lair: true,
    hp_max: null,
    hp_current: null,
    ac: null,
    conditions: [],
    lair_action_text: withLair.map(c => c.lair_action_text).join(' '),
    sources: withLair.map(c => c.name),
  }
}

/** Is this row the synthetic lair marker rather than a creature? */
export const isLairRow = (c) => c?.is_lair === true || c?.type === 'lair'
