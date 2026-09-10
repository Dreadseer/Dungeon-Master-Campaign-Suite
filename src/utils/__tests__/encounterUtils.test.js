import { describe, it, expect, test } from 'vitest'
import {
  parseCR,
  crToXP,
  XP_THRESHOLDS,
  partyThresholds,
  monsterMultiplier,
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
// KNOWN BUGS — documented here, fixed in Phase 1.
//
// Each is written twice:
//   - a passing test pinning the *current, wrong* behaviour, so the bug is a
//     recorded fact rather than folklore;
//   - an `it.fails` test asserting the *correct* behaviour. `it.fails` passes
//     only while its body throws, so the moment Phase 1 lands the fix that test
//     errors and forces the modifier to be removed. It is a tripwire, not a
//     skipped test.
// A `test.todo` accompanies each, so `npm test` prints a visible todo count.
// ─────────────────────────────────────────────────────────────────────────────

describe('KNOWN BUGS (fixed in Phase 1)', () => {
  describe('BUG 1: CR_XP has no entries for CR 25-29', () => {
    it('currently returns 0 for CR 25 through 29', () => {
      for (const cr of [25, 26, 27, 28, 29]) {
        expect(crToXP(cr)).toBe(0)
      }
    })

    it.fails('should return the DMG values for CR 25-29', () => {
      const dmg = { 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000 }
      for (const [cr, xp] of Object.entries(dmg)) {
        expect(crToXP(Number(cr))).toBe(xp)
      }
    })

    test.todo('Phase 1: add CR 25-29 to CR_XP (75000/90000/105000/120000/135000)')
  })

  describe('BUG 2: parseCR returns NaN for unparseable input', () => {
    it('currently returns NaN, because ?? only catches null and undefined', () => {
      expect(parseCR('bogus')).toBeNaN()
      expect(parseCR('')).toBeNaN()
      expect(parseCR(undefined)).toBeNaN()
    })

    it('the NaN reaches crToXP and silently becomes a 0-XP monster', () => {
      // CR_XP[NaN] is undefined, so `?? 0` catches it one layer later — the
      // encounter undercounts rather than displaying NaN. Silent, which is worse.
      expect(crToXP('bogus')).toBe(0)
    })

    it.fails('should fall back to 0 for unparseable input', () => {
      expect(parseCR('bogus')).toBe(0)
    })

    test.todo('Phase 1: parseCR should Number.isNaN-guard its parseFloat result')
  })

  describe('BUG 3: no party-size multiplier shift (DMG p. 82)', () => {
    // The DMG: a party of fewer than three characters uses the NEXT HIGHER
    // multiplier; a party of six or more uses the NEXT LOWER. The ladder is
    // [0.5, 1, 1.5, 2, 2.5, 3, 4]. monsterMultiplier takes only the monster
    // count, so both shifts are simply absent.
    //
    // The `it.fails` cases below assume Phase 1 adds an optional second
    // parameter, monsterMultiplier(count, partySize). If Phase 1 chooses a
    // different signature, update these rather than deleting them.
    it('currently ignores any second argument', () => {
      expect(monsterMultiplier(1, 2)).toBe(1)
      expect(monsterMultiplier(1, 6)).toBe(1)
      expect(monsterMultiplier(4, 2)).toBe(2)
      expect(monsterMultiplier(4, 6)).toBe(2)
    })

    it.fails('should step UP one rung for a party of fewer than 3', () => {
      expect(monsterMultiplier(1, 2)).toBe(1.5)
      expect(monsterMultiplier(4, 2)).toBe(2.5)
    })

    it.fails('should step DOWN one rung for a party of 6 or more', () => {
      expect(monsterMultiplier(1, 6)).toBe(0.5)
      expect(monsterMultiplier(4, 6)).toBe(1.5)
    })

    test.todo('Phase 1: monsterMultiplier(count, partySize) with the DMG shift')
  })
})
