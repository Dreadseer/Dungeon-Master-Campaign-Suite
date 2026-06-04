// Monster entry shape in encounters.monsters JSON array:
// { id, name, source, source_index, cr, xp, hp_max, hp_current, count, custom_name, notes }

export const CR_XP = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
  1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800,
  6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
  21: 33000, 22: 41000, 23: 50000, 24: 62000, 30: 155000,
}

export const parseCR = (cr) => {
  if (typeof cr === 'number') return cr
  const map = { '1/8': 0.125, '1/4': 0.25, '1/2': 0.5 }
  return map[String(cr)] ?? parseFloat(cr) ?? 0
}

export const crToXP = (cr) => CR_XP[parseCR(cr)] ?? 0

export const createMonsterEntry = (statBlock, source) => ({
  id:           crypto.randomUUID(),
  name:         statBlock.name,
  source,
  source_index: statBlock.index ?? statBlock.id,
  cr:           statBlock.challenge_rating,
  xp:           crToXP(statBlock.challenge_rating),
  hp_max:       statBlock.hit_points ?? 10,
  hp_current:   statBlock.hit_points ?? 10,
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

// Monster count multiplier per 5e DMG
export const monsterMultiplier = (totalMonsterCount) => {
  if (totalMonsterCount === 1)  return 1
  if (totalMonsterCount === 2)  return 1.5
  if (totalMonsterCount <= 6)   return 2
  if (totalMonsterCount <= 10)  return 2.5
  if (totalMonsterCount <= 14)  return 3
  return 4
}

// Adjusted XP = raw XP × multiplier
export const adjustedXP = (monsters) => {
  const totalCount = monsters.reduce((sum, m) => sum + m.count, 0)
  const raw        = monsters.reduce((sum, m) => sum + (m.xp * m.count), 0)
  return Math.round(raw * monsterMultiplier(totalCount))
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
