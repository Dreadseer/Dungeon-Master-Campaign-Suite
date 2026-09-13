// Monster entry shape in encounters.monsters JSON array:
// { id, name, source, source_index, cr, xp, hp_max, hp_current, count, custom_name, notes }

export const CR_XP = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
  1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800,
  6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
  21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000,
  26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000,
}

export const parseCR = (cr) => {
  if (typeof cr === 'number') return Number.isFinite(cr) ? cr : 0
  const map = { '1/8': 0.125, '1/4': 0.25, '1/2': 0.5 }
  const mapped = map[String(cr)]
  if (mapped !== undefined) return mapped
  // `??` only catches null/undefined, so an unparseable string used to leak NaN
  // out of here and become a silent 0-XP monster one layer later in crToXP.
  const parsed = parseFloat(cr)
  return Number.isFinite(parsed) ? parsed : 0
}

export const crToXP = (cr) => CR_XP[parseCR(cr)] ?? 0

// Armour class out of an SRD or homebrew stat block.
//
// The shape is inconsistent and has been through two versions of the dnd5eapi:
// older cached rows store a bare number, newer ones an array of
// { type, value } (a monster can list several, e.g. "natural armor" and
// "with mage armor"). Homebrew from CustomMonsterForm stores a number.
//
// Returns null rather than a default, so the caller can tell "no AC in this
// stat block" from "AC 10", and the lazy backfill in buildCombatants knows
// whether it still needs to look one up.
export const parseArmorClass = (raw) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  }
  if (Array.isArray(raw)) {
    // Take the first usable entry — the SRD lists the creature's base armour
    // first and conditional variants after it.
    for (const entry of raw) {
      const found = parseArmorClass(typeof entry === 'object' && entry !== null ? entry.value : entry)
      if (found != null) return found
    }
    return null
  }
  if (raw !== null && typeof raw === 'object') return parseArmorClass(raw.value ?? raw.base ?? null)
  return null
}

export const createMonsterEntry = (statBlock, source) => ({
  id:           crypto.randomUUID(),
  name:         statBlock.name,
  source,
  source_index: statBlock.index ?? statBlock.id,
  cr:           statBlock.challenge_rating,
  xp:           crToXP(statBlock.challenge_rating),
  hp_max:       statBlock.hit_points ?? 10,
  hp_current:   statBlock.hit_points ?? 10,
  // Phase 5. Before this, createMonsterEntry never wrote an `ac` field, so
  // buildCombatants' `entry.ac ?? 10` meant EVERY monster entered initiative at
  // AC 10 however armoured its stat block said it was.
  ac:           parseArmorClass(statBlock.armor_class),
  // Legendary actions, for the tracker's counter. The SRD lists each action;
  // the count of legendary actions per round is 3 for almost every creature
  // that has them, and the stat block states it in prose rather than a field.
  legendary_max: Array.isArray(statBlock.legendary_actions) && statBlock.legendary_actions.length > 0 ? 3 : 0,
  lair_action_text: typeof statBlock.lair_actions === 'string' ? statBlock.lair_actions
    : Array.isArray(statBlock.lair_actions) && statBlock.lair_actions.length
      ? statBlock.lair_actions.map(a => a?.desc ?? a?.name ?? '').filter(Boolean).join(' ')
      : null,
  count:        1,
  custom_name:  null,
  notes:        '',
})

// ── XP Budget & Difficulty Math (Phase 5 Prompt 02) ────────────────────────

// XP Thresholds per character level [Easy, Medium, Hard, Deadly]
export const XP_THRESHOLDS = {
   1: [25,   50,   75,   100],   2: [50,   100,  150,  200],
   3: [75,   150,  225,  400],   4: [125,  250,  375,  500],
   5: [250,  500,  750,  1100],  6: [300,  600,  900,  1400],
   7: [350,  750,  1100, 1700],  8: [450,  900,  1400, 2100],
   9: [550,  1100, 1600, 2400],  10: [600, 1200, 1900, 2800],
  11: [800,  1600, 2400, 3600],  12: [1000,2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100],  14: [1250,2500, 3800, 5700],
  15: [1400, 2800, 4300, 6400],  16: [1600,3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800],  18: [2100,4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900], 20: [2800,5700, 8500, 12700],
}

// Sum thresholds for all party members at each tier
// characters: array of { level: number }
// returns [easy, medium, hard, deadly]
export const partyThresholds = (characters) =>
  [0, 1, 2, 3].map(tier =>
    characters.reduce((sum, c) => sum + (XP_THRESHOLDS[c.level]?.[tier] ?? 0), 0)
  )

// The DMG "Encounter Multipliers" ladder (p. 82). Index 0 (x0.5) is not
// reachable by monster count alone — it exists only as the rung a party of six
// or more steps down onto.
export const MULTIPLIER_LADDER = [0.5, 1, 1.5, 2, 2.5, 3, 4]

// Rung on MULTIPLIER_LADDER for a given head count, before any party-size shift.
const ladderIndexForCount = (totalMonsterCount) => {
  if (totalMonsterCount <= 1)   return 1   // x1
  if (totalMonsterCount === 2)  return 2   // x1.5
  if (totalMonsterCount <= 6)   return 3   // x2
  if (totalMonsterCount <= 10)  return 4   // x2.5
  if (totalMonsterCount <= 14)  return 5   // x3
  return 6                                 // x4
}

// Monster count multiplier per 5e DMG p. 82, including the party-size
// adjustment the table's footnote requires: a party of fewer than three
// characters uses the next HIGHER multiplier, a party of six or more the next
// LOWER one. Defaults to a party of four, where no shift applies.
export const monsterMultiplier = (totalMonsterCount, partySize = 4) => {
  let index = ladderIndexForCount(totalMonsterCount)
  if (partySize < 3)        index += 1
  else if (partySize >= 6)  index -= 1
  const clamped = Math.min(Math.max(index, 0), MULTIPLIER_LADDER.length - 1)
  return MULTIPLIER_LADDER[clamped]
}

// Adjusted XP = raw XP x multiplier. partySize is threaded through to
// monsterMultiplier so the difficulty rating and the multiplier shown in the UI
// can never disagree.
export const adjustedXP = (monsters, partySize = 4) => {
  const totalCount = monsters.reduce((sum, m) => sum + m.count, 0)
  const raw        = monsters.reduce((sum, m) => sum + (m.xp * m.count), 0)
  return Math.round(raw * monsterMultiplier(totalCount, partySize))
}

// Raw XP — used for player reward (no multiplier)
export const rawXP = (monsters) =>
  monsters.reduce((sum, m) => sum + (m.xp * m.count), 0)

// Difficulty label and color from adjusted XP vs party thresholds
export const difficultyRating = (adjustedXp, thresholds) => {
  const [easy, medium, hard, deadly] = thresholds
  if (adjustedXp < easy)   return { label: 'Trivial', color: '#6B6B6B' }
  if (adjustedXp < medium) return { label: 'Easy',    color: '#2D7A2D' }
  if (adjustedXp < hard)   return { label: 'Medium',  color: '#B8750A' }
  if (adjustedXp < deadly) return { label: 'Hard',    color: '#C0392B' }
  return                          { label: 'Deadly',  color: '#8B0000' }
}

export const xpBudget = (characters, targetDifficulty) => {
  const tierMap = { easy: 0, medium: 1, hard: 2, deadly: 3 }
  const tier    = tierMap[targetDifficulty.toLowerCase()] ?? 1
  return characters.reduce((sum, c) => sum + (XP_THRESHOLDS[c.level]?.[tier] ?? 0), 0)
}
