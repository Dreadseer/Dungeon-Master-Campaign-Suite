// ── Ability score helpers ────────────────────────────────────────────────────

/** Raw numeric modifier from an ability score (e.g. 16 → 3). */
export const abilityMod = (score) => Math.floor((score - 10) / 2)

/** Formatted modifier string with sign (e.g. 16 → "+3", 8 → "-1"). */
export const modStr = (score) => {
  const m = abilityMod(score)
  return m >= 0 ? `+${m}` : `${m}`
}

// ── Proficiency bonus ────────────────────────────────────────────────────────

/** Proficiency bonus for a given character level (levels 1–20). */
export const profBonus = (level) => Math.ceil(level / 4) + 1

// ── Saving throws & skills ───────────────────────────────────────────────────

/**
 * Saving throw or skill bonus.
 * @param {number} score     - Ability score
 * @param {number} level     - Character level
 * @param {boolean} isProficient
 */
export const savingThrow = (score, level, isProficient) => {
  const base = abilityMod(score)
  return isProficient ? base + profBonus(level) : base
}

export const skillBonus = savingThrow

/** Passive Perception = 10 + Perception bonus. */
export const passivePerception = (wisScore, level, isProficient) =>
  10 + skillBonus(wisScore, level, isProficient)

// ── Spellcasting ─────────────────────────────────────────────────────────────

export const spellSaveDC      = (abilityScore, level) => 8 + profBonus(level) + abilityMod(abilityScore)
export const spellAttackBonus = (abilityScore, level) => profBonus(level) + abilityMod(abilityScore)

// ── Skill → ability mapping ──────────────────────────────────────────────────

export const SKILL_ABILITY = {
  acrobatics:     'dex',
  animal_handling:'wis',
  arcana:         'int',
  athletics:      'str',
  deception:      'cha',
  history:        'int',
  insight:        'wis',
  intimidation:   'cha',
  investigation:  'int',
  medicine:       'wis',
  nature:         'int',
  perception:     'wis',
  performance:    'cha',
  persuasion:     'cha',
  religion:       'int',
  sleight_of_hand:'dex',
  stealth:        'dex',
  survival:       'wis',
}

/** All 18 skills as `{ key, label, ability }` objects. */
export const SKILLS = Object.keys(SKILL_ABILITY).map(key => ({
  key,
  label:  key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
  ability: SKILL_ABILITY[key],
}))

// ── Spell slots ──────────────────────────────────────────────────────────────

/**
 * Spell slots by caster type and character level.
 * Each value is an array indexed 0 = 1st-level slots, 1 = 2nd-level, etc.
 */
export const SPELL_SLOTS = {
  full: {
     1: [2],
     2: [3],
     3: [4,2],
     4: [4,3],
     5: [4,3,2],
     6: [4,3,3],
     7: [4,3,3,1],
     8: [4,3,3,2],
     9: [4,3,3,3,1],
    10: [4,3,3,3,2],
    11: [4,3,3,3,2,1],
    12: [4,3,3,3,2,1],
    13: [4,3,3,3,2,1,1],
    14: [4,3,3,3,2,1,1],
    15: [4,3,3,3,2,1,1,1],
    16: [4,3,3,3,2,1,1,1],
    17: [4,3,3,3,2,1,1,1,1],
    18: [4,3,3,3,3,1,1,1,1],
    19: [4,3,3,3,3,2,1,1,1],
    20: [4,3,3,3,3,2,2,1,1],
  },
  half: {
     1: [],
     2: [2],
     3: [3],
     4: [3],
     5: [4,2],
     6: [4,2],
     7: [4,3],
     8: [4,3],
     9: [4,3,2],
    10: [4,3,2],
    11: [4,3,3],
    12: [4,3,3],
    13: [4,3,3,1],
    14: [4,3,3,1],
    15: [4,3,3,2],
    16: [4,3,3,2],
    17: [4,3,3,3,1],
    18: [4,3,3,3,1],
    19: [4,3,3,3,2],
    20: [4,3,3,3,2],
  },
}

/**
 * Returns 'full', 'half', or null for non-casters.
 * Matches substring so "Eldritch Knight Fighter" still returns null
 * (EK gets special handling; simplified here as non-caster).
 */
export const getCasterType = (className) => {
  const full = ['Bard','Cleric','Druid','Sorcerer','Wizard']
  const half = ['Paladin','Ranger']
  const cls  = className?.trim() ?? ''
  if (full.some(c => cls.toLowerCase().includes(c.toLowerCase()))) return 'full'
  if (half.some(c => cls.toLowerCase().includes(c.toLowerCase()))) return 'half'
  return null
}

/** Primary spellcasting ability by class name. */
export const spellcastingAbility = (className) => {
  const cls = className?.toLowerCase() ?? ''
  if (['wizard'].some(c => cls.includes(c)))                              return 'int'
  if (['cleric','druid','ranger'].some(c => cls.includes(c)))             return 'wis'
  if (['bard','paladin','sorcerer','warlock'].some(c => cls.includes(c))) return 'cha'
  return null
}

// ── Hit dice by class ────────────────────────────────────────────────────────

export const HIT_DICE = {
  Barbarian: 12,
  Fighter:   10, Paladin: 10, Ranger: 10,
  Bard:       8, Cleric: 8,  Druid: 8, Monk: 8, Rogue: 8, Warlock: 8,
  Sorcerer:   6, Wizard: 6,
}

// ── Death saving throws (PHB p. 197) ─────────────────────────────────────────
//
// Extracted from CharacterSheet.jsx in Phase 5 so the character sheet and the
// initiative tracker roll the same way, and so the rules can be tested.
//
// The rule that was wrong before: a natural 20 does NOT give two successes. It
// means the creature regains 1 hit point and is no longer dying — the death
// saves end there, mid-count. That is a much better outcome than "two ticks",
// and a DM using the old behaviour was under-rewarding their players' luck.
//
// The rest, for reference:
//   1        two failures
//   2-9      one failure
//   10-19    one success
//   20       1 HP, dying ends
//   3 successes  stable at 0 HP, no longer making saves
//   3 failures   dead

export const DEATH_SAVE_TARGET = 10   // DC 10, per the PHB

/**
 * Apply one death saving throw.
 *
 * Pure: the caller supplies the roll, so a test can drive every branch and the
 * UI can show the die that was rolled.
 *
 * @param {{successes:number, failures:number}} current
 * @param {number} roll  a d20 result, 1-20
 * @returns {{successes, failures, roll, outcome, revived, stable, dead, message}}
 */
export function applyDeathSave(current, roll) {
  const clamp = (v) => Math.min(3, Math.max(0, Number.isFinite(+v) ? Math.trunc(+v) : 0))
  let successes = clamp(current?.successes)
  let failures = clamp(current?.failures)

  const d20 = Math.min(20, Math.max(1, Math.trunc(Number(roll) || 1)))

  let outcome
  let revived = false

  if (d20 === 20) {
    // Not two successes — 1 hit point, and the dying condition ends.
    outcome = 'critical-success'
    revived = true
    successes = 0
    failures = 0
  } else if (d20 === 1) {
    outcome = 'critical-failure'
    failures = clamp(failures + 2)
  } else if (d20 >= DEATH_SAVE_TARGET) {
    outcome = 'success'
    successes = clamp(successes + 1)
  } else {
    outcome = 'failure'
    failures = clamp(failures + 1)
  }

  const stable = !revived && successes >= 3
  const dead = failures >= 3

  const message =
    revived ? `Natural 20 — back up with 1 hit point.`
      : dead ? `Rolled ${d20} — three failures. Dead.`
        : stable ? `Rolled ${d20} — three successes. Stable at 0 HP.`
          : outcome === 'critical-failure' ? `Natural 1 — two failures (${failures}/3).`
            : outcome === 'success' ? `Rolled ${d20} — success (${successes}/3).`
              : `Rolled ${d20} — failure (${failures}/3).`

  return { successes, failures, roll: d20, outcome, revived, stable, dead, message }
}

/** Roll a d20 and apply it. Separated so the pure part stays testable. */
export function rollDeathSave(current) {
  return applyDeathSave(current, Math.floor(Math.random() * 20) + 1)
}

/** A fresh, cleared set of death saves. */
export const emptyDeathSaves = () => ({ successes: 0, failures: 0 })

/** Should this combatant be making death saves? Players only, at 0 HP. */
export const isDying = (combatant) =>
  !!combatant?.is_player && (combatant?.hp_current ?? 0) <= 0 &&
  (combatant?.death_saves?.failures ?? 0) < 3
