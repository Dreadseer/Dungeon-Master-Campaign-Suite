import { describe, it, expect } from 'vitest'
import {
  parseCR,
  crToXP,
  XP_THRESHOLDS,
  partyThresholds,
  monsterMultiplier,
  MULTIPLIER_LADDER,
  adjustedXP,
  rawXP,
  difficultyRating,
  xpBudget,
} from '../encounterUtils.js'

// ─────────────────────────────────────────────────────────────────────────────
// The oracle for this suite is the D&D 5e Dungeon Master's Guide (2014), p. 82:
// "Experience Point Thresholds by Character Level", "Encounter Multipliers",
// and "Experience Points by Challenge Rating". The values below are transcribed
// from the book, not copied from the module under test — that is the point.
// ─────────────────────────────────────────────────────────────────────────────

// [level, easy, medium, hard, deadly]
const DMG_THRESHOLDS = [
  [1, 25, 50, 75, 100],
  [2, 50, 100, 150, 200],
  [3, 75, 150, 225, 400],
  [4, 125, 250, 375, 500],
  [5, 250, 500, 750, 1100],
  [6, 300, 600, 900, 1400],
  [7, 350, 750, 1100, 1700],
  [8, 450, 900, 1400, 2100],
  [9, 550, 1100, 1600, 2400],
  [10, 600, 1200, 1900, 2800],
  [11, 800, 1600, 2400, 3600],
  [12, 1000, 2000, 3000, 4500],
  [13, 1100, 2200, 3400, 5100],
  [14, 1250, 2500, 3800, 5700],
  [15, 1400, 2800, 4300, 6400],
  [16, 1600, 3200, 4800, 7200],
  [17, 2000, 3900, 5900, 8800],
  [18, 2100, 4200, 6300, 9500],
  [19, 2400, 4900, 7300, 10900],
  [20, 2800, 5700, 8500, 12700],
]

const TIERS = ['easy', 'medium', 'hard', 'deadly']

describe('XP_THRESHOLDS — all 80 values against DMG p. 82', () => {
  it('covers exactly levels 1-20 and nothing else', () => {
    expect(Object.keys(XP_THRESHOLDS).map(Number).sort((a, b) => a - b))
      .toEqual(DMG_THRESHOLDS.map(([level]) => level))
  })

  // 20 levels x 4 tiers = 80 individually-named assertions.
  DMG_THRESHOLDS.forEach(([level, ...expected]) => {
    TIERS.forEach((tier, i) => {
      it(`level ${level} ${tier} = ${expected[i]}`, () => {
        expect(XP_THRESHOLDS[level][i]).toBe(expected[i])
      })
    })
  })

  it('stores each level as a 4-element array', () => {
    DMG_THRESHOLDS.forEach(([level]) => {
      expect(XP_THRESHOLDS[level]).toHaveLength(4)
    })
  })
})

describe('partyThresholds', () => {
  it('four level-5 PCs = [1000, 2000, 3000, 4400]', () => {
    const party = [{ level: 5 }, { level: 5 }, { level: 5 }, { level: 5 }]
    expect(partyThresholds(party)).toEqual([1000, 2000, 3000, 4400])
  })

  it('sums a mixed-level party per tier', () => {
    // L1 [25,50,75,100] + L20 [2800,5700,8500,12700]
    expect(partyThresholds([{ level: 1 }, { level: 20 }]))
      .toEqual([2825, 5750, 8575, 12800])
  })

  it('returns all zeroes for an empty party', () => {
    expect(partyThresholds([])).toEqual([0, 0, 0, 0])
  })

  it('treats an out-of-range level as contributing 0 rather than throwing', () => {
    expect(partyThresholds([{ level: 5 }, { level: 99 }]))
      .toEqual([250, 500, 750, 1100])
  })
})

describe('monsterMultiplier — all six DMG bands', () => {
  it('1 monster = x1', () => {
    expect(monsterMultiplier(1)).toBe(1)
  })

  it('2 monsters = x1.5', () => {
    expect(monsterMultiplier(2)).toBe(1.5)
  })

  it('3-6 monsters = x2', () => {
    for (const n of [3, 4, 5, 6]) expect(monsterMultiplier(n)).toBe(2)
  })

  it('7-10 monsters = x2.5', () => {
    for (const n of [7, 8, 9, 10]) expect(monsterMultiplier(n)).toBe(2.5)
  })

  it('11-14 monsters = x3', () => {
    for (const n of [11, 12, 13, 14]) expect(monsterMultiplier(n)).toBe(3)
  })

  it('15+ monsters = x4', () => {
    for (const n of [15, 16, 30, 100]) expect(monsterMultiplier(n)).toBe(4)
  })

  it('band boundaries land on the correct side', () => {
    expect(monsterMultiplier(6)).toBe(2)
    expect(monsterMultiplier(7)).toBe(2.5)
    expect(monsterMultiplier(10)).toBe(2.5)
    expect(monsterMultiplier(11)).toBe(3)
    expect(monsterMultiplier(14)).toBe(3)
    expect(monsterMultiplier(15)).toBe(4)
  })
})

describe('CR_XP / crToXP', () => {
  it('maps the fractional CRs', () => {
    expect(crToXP('1/8')).toBe(25)
    expect(crToXP('1/4')).toBe(50)
    expect(crToXP('1/2')).toBe(100)
    expect(crToXP(0.125)).toBe(25)
    expect(crToXP(0.25)).toBe(50)
    expect(crToXP(0.5)).toBe(100)
  })

  it('maps CR 0 through 24 to the DMG values', () => {
    const dmg = {
      0: 10, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900,
      8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500,
      15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
      21: 33000, 22: 41000, 23: 50000, 24: 62000,
    }
    for (const [cr, xp] of Object.entries(dmg)) {
      expect(crToXP(Number(cr))).toBe(xp)
    }
  })

  it('maps CR 30 to 155000', () => {
    expect(crToXP(30)).toBe(155000)
  })

  it('accepts a numeric CR passed as a string', () => {
    expect(crToXP('5')).toBe(1800)
  })
})

describe('parseCR', () => {
  it('passes numbers through unchanged', () => {
    expect(parseCR(5)).toBe(5)
    expect(parseCR(0.25)).toBe(0.25)
    expect(parseCR(0)).toBe(0)
  })

  it('converts the three fraction strings', () => {
    expect(parseCR('1/8')).toBe(0.125)
    expect(parseCR('1/4')).toBe(0.25)
    expect(parseCR('1/2')).toBe(0.5)
  })

  it('parses numeric strings', () => {
    expect(parseCR('12')).toBe(12)
    expect(parseCR('0.5')).toBe(0.5)
  })
})

describe('rawXP and adjustedXP', () => {
  const goblin = { xp: 50, count: 4 }   // CR 1/4
  const ogre = { xp: 450, count: 1 }    // CR 2

  it('rawXP sums xp x count with no multiplier', () => {
    expect(rawXP([goblin, ogre])).toBe(650)
  })

  it('adjustedXP applies the multiplier for the total head count', () => {
    // 5 monsters total -> x2
    expect(adjustedXP([goblin, ogre])).toBe(1300)
  })

  it('a single monster is unmultiplied', () => {
    expect(adjustedXP([{ xp: 1800, count: 1 }])).toBe(1800)
  })

  it('rounds the multiplied total', () => {
    // 2 monsters -> x1.5; 25 + 25 = 50 -> 75
    expect(adjustedXP([{ xp: 25, count: 1 }, { xp: 25, count: 1 }])).toBe(75)
  })

  it('both return 0 for an empty encounter', () => {
    expect(rawXP([])).toBe(0)
    expect(adjustedXP([])).toBe(0)
  })
})

describe('difficultyRating', () => {
  const fourLevelFive = [1000, 2000, 3000, 4400]

  it('below the easy threshold is Trivial', () => {
    expect(difficultyRating(999, fourLevelFive).label).toBe('Trivial')
  })

  it('exactly the easy threshold is Easy', () => {
    expect(difficultyRating(1000, fourLevelFive).label).toBe('Easy')
  })

  it('exactly the deadly threshold is Deadly', () => {
    expect(difficultyRating(4400, fourLevelFive).label).toBe('Deadly')
  })

  it('returns a colour with every label', () => {
    for (const xp of [500, 1500, 2500, 3500, 5000]) {
      expect(difficultyRating(xp, fourLevelFive).color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('end-to-end difficulty ratings (review Q8)', () => {
  const party = [{ level: 5 }, { level: 5 }, { level: 5 }, { level: 5 }]

  it('1 x CR 5 against four level-5 PCs = Easy', () => {
    const monsters = [{ xp: crToXP(5), count: 1 }]
    const adj = adjustedXP(monsters)                  // 1800 x 1
    expect(adj).toBe(1800)
    expect(difficultyRating(adj, partyThresholds(party)).label).toBe('Easy')
  })

  it('4 x CR 2 against four level-5 PCs = Hard', () => {
    const monsters = [{ xp: crToXP(2), count: 4 }]
    const adj = adjustedXP(monsters)                  // 1800 x 2
    expect(adj).toBe(3600)
    expect(difficultyRating(adj, partyThresholds(party)).label).toBe('Hard')
  })
})

describe('xpBudget', () => {
  const party = [{ level: 5 }, { level: 5 }, { level: 5 }, { level: 5 }]

  it('returns the summed threshold for the named tier', () => {
    expect(xpBudget(party, 'easy')).toBe(1000)
    expect(xpBudget(party, 'medium')).toBe(2000)
    expect(xpBudget(party, 'hard')).toBe(3000)
    expect(xpBudget(party, 'deadly')).toBe(4400)
  })

  it('is case-insensitive', () => {
    expect(xpBudget(party, 'DEADLY')).toBe(4400)
  })

  it('falls back to medium for an unrecognised tier', () => {
    expect(xpBudget(party, 'nonsense')).toBe(2000)
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// FIXED IN PHASE 1 — these three were `it.fails` tripwires through Phase 0.
// The tripwires did their job: each started erroring the moment the fix landed,
// and each is now a plain assertion of correct behaviour.
// ─────────────────────────────────────────────────────────────────────────────

describe('CR 25-29 (fixed in Phase 1)', () => {
  it('returns the DMG values for CR 25 through 29', () => {
    const dmg = { 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000 }
    for (const [cr, xp] of Object.entries(dmg)) {
      expect(crToXP(Number(cr))).toBe(xp)
    }
  })

  it('the CR ladder is now unbroken from 0 to 30', () => {
    const ratings = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)]
    for (const cr of ratings) {
      expect(crToXP(cr)).toBeGreaterThan(0)
    }
  })

  it('XP still increases monotonically across the whole range', () => {
    const ladder = Array.from({ length: 31 }, (_, cr) => crToXP(cr))
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1])
    }
  })

  it('a CR 27 monster is no longer worth zero XP in an encounter', () => {
    // The practical symptom: a legendary threat contributed nothing to the
    // difficulty rating, so the encounter read "Trivial".
    const monsters = [{ xp: crToXP(27), count: 1 }]
    const party = Array.from({ length: 4 }, () => ({ level: 20 }))
    expect(adjustedXP(monsters)).toBe(105000)
    expect(difficultyRating(adjustedXP(monsters), partyThresholds(party)).label).toBe('Deadly')
  })
})

describe('parseCR NaN guard (fixed in Phase 1)', () => {
  it('falls back to 0 for unparseable input', () => {
    for (const bad of ['bogus', '', '  ', 'CR five', undefined, null, {}, []]) {
      expect(parseCR(bad)).toBe(0)
    }
  })

  it('never returns NaN', () => {
    for (const input of ['bogus', '', undefined, null, NaN, Infinity, -Infinity, '1/4', '12', 7]) {
      expect(Number.isNaN(parseCR(input))).toBe(false)
    }
  })

  it('rejects non-finite numbers too', () => {
    expect(parseCR(NaN)).toBe(0)
    expect(parseCR(Infinity)).toBe(0)
    expect(parseCR(-Infinity)).toBe(0)
  })

  it('still parses everything it parsed before', () => {
    expect(parseCR(5)).toBe(5)
    expect(parseCR('1/8')).toBe(0.125)
    expect(parseCR('1/4')).toBe(0.25)
    expect(parseCR('1/2')).toBe(0.5)
    expect(parseCR('12')).toBe(12)
    expect(parseCR('0.5')).toBe(0.5)
    expect(parseCR(0)).toBe(0)
  })

  it('parses a numeric prefix the way parseFloat always did', () => {
    // Not a behaviour change — recorded so a future tightening is a deliberate choice.
    expect(parseCR('5 (1,800 XP)')).toBe(5)
  })
})

describe('party-size multiplier shift (fixed in Phase 1)', () => {
  it('exposes the DMG ladder, with the x0.5 rung below x1', () => {
    expect(MULTIPLIER_LADDER).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 4])
  })

  it('a party of 3, 4 or 5 gets no shift', () => {
    for (const partySize of [3, 4, 5]) {
      expect(monsterMultiplier(1, partySize)).toBe(1)
      expect(monsterMultiplier(4, partySize)).toBe(2)
      expect(monsterMultiplier(15, partySize)).toBe(4)
    }
  })

  it('a party of fewer than 3 steps UP one rung', () => {
    expect(monsterMultiplier(1, 2)).toBe(1.5)
    expect(monsterMultiplier(2, 2)).toBe(2)
    expect(monsterMultiplier(4, 2)).toBe(2.5)
    expect(monsterMultiplier(8, 2)).toBe(3)
    expect(monsterMultiplier(12, 2)).toBe(4)
  })

  it('a party of 6 or more steps DOWN one rung', () => {
    expect(monsterMultiplier(1, 6)).toBe(0.5)
    expect(monsterMultiplier(2, 6)).toBe(1)
    expect(monsterMultiplier(4, 6)).toBe(1.5)
    expect(monsterMultiplier(8, 7)).toBe(2)
    expect(monsterMultiplier(12, 10)).toBe(2.5)
  })

  it('clamps at both ends of the ladder', () => {
    expect(monsterMultiplier(15, 2)).toBe(4)    // already top rung, cannot go higher
    expect(monsterMultiplier(1, 8)).toBe(0.5)   // already bottom rung, cannot go lower
  })

  it('defaults to a party of four when the argument is omitted', () => {
    for (const count of [1, 2, 4, 8, 12, 20]) {
      expect(monsterMultiplier(count)).toBe(monsterMultiplier(count, 4))
    }
  })

  it('a shift never skips a rung', () => {
    for (const count of [1, 2, 4, 8, 12, 20]) {
      const base = MULTIPLIER_LADDER.indexOf(monsterMultiplier(count, 4))
      expect(MULTIPLIER_LADDER.indexOf(monsterMultiplier(count, 2)))
        .toBe(Math.min(base + 1, MULTIPLIER_LADDER.length - 1))
      expect(MULTIPLIER_LADDER.indexOf(monsterMultiplier(count, 6)))
        .toBe(Math.max(base - 1, 0))
    }
  })

  it('a head count of 0 is treated as the x1 rung', () => {
    expect(monsterMultiplier(0)).toBe(1)
  })
})

describe('adjustedXP threads partySize through (fixed in Phase 1)', () => {
  const monsters = [{ xp: 450, count: 4 }]   // 4 x CR 2 = 1800 raw

  it('defaults to a party of four', () => {
    expect(adjustedXP(monsters)).toBe(3600)          // x2
  })

  it('a duo faces a harder encounter for the same monsters', () => {
    expect(adjustedXP(monsters, 2)).toBe(4500)       // x2.5
  })

  it('a party of six faces an easier one', () => {
    expect(adjustedXP(monsters, 6)).toBe(2700)       // x1.5
  })

  it('the multiplier shown and the multiplier applied cannot disagree', () => {
    // The reason adjustedXP takes partySize at all: the UI displays
    // monsterMultiplier(count, partySize) beside a difficulty derived from
    // adjustedXP. If only one of them knew the party size, they would contradict
    // each other on screen.
    for (const partySize of [1, 2, 3, 4, 5, 6, 8]) {
      const shown = monsterMultiplier(4, partySize)
      expect(adjustedXP(monsters, partySize)).toBe(Math.round(1800 * shown))
    }
  })

  it('changes the difficulty verdict for the same monsters', () => {
    const party5 = (n) => Array.from({ length: n }, () => ({ level: 5 }))
    const verdict = (n) =>
      difficultyRating(adjustedXP(monsters, n), partyThresholds(party5(n))).label

    expect(verdict(4)).toBe('Hard')     // 3600 vs [1000,2000,3000,4400]
    expect(verdict(2)).toBe('Deadly')   // 4500 vs [500,1000,1500,2200]
    expect(verdict(6)).toBe('Easy')     // 2700 vs [1500,3000,4500,6600]
  })
})
