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
