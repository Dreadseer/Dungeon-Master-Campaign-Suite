import { describe, it, expect } from 'vitest'
import {
  DIFFICULTIES, crBandForBudget, candidateMonsters, buildGenerationPrompt,
  parseGeneratedEncounter, resolveSelection, validateAgainstBudget, retryHint,
} from '../encounterGeneration.js'
import { xpBudget, adjustedXP, partyThresholds, difficultyRating, crToXP } from '../encounterUtils.js'

/** Four level-5 characters — the acceptance scenario. */
const party = () => Array.from({ length: 4 }, () => ({ level: 5 }))

const srd = [
  { index: 'goblin', name: 'Goblin', challenge_rating: 0.25, type: 'humanoid' },
  { index: 'orc', name: 'Orc', challenge_rating: 0.5, type: 'humanoid' },
  { index: 'ogre', name: 'Ogre', challenge_rating: 2, type: 'giant' },
  { index: 'troll', name: 'Troll', challenge_rating: 5, type: 'giant' },
  { index: 'giant-crocodile', name: 'Giant Crocodile', challenge_rating: 5, type: 'beast' },
  { index: 'swamp-hag', name: 'Swamp Hag', challenge_rating: 3, type: 'fey' },
  { index: 'lizardfolk', name: 'Lizardfolk', challenge_rating: 0.5, type: 'humanoid' },
  { index: 'ancient-red-dragon', name: 'Ancient Red Dragon', challenge_rating: 24, type: 'dragon' },
]

describe('crBandForBudget', () => {
  it('caps the band so one monster cannot exceed the whole budget', () => {
    const budget = xpBudget(party(), 'hard')   // 750 x 4 = 3000
    const band = crBandForBudget(budget, 4)
    // CR 8 is 3900 XP — above a 3000 budget, so out.
    expect(band.max).toBeLessThan(8)
  })

  it('keeps weak monsters available, so a horde is still possible', () => {
    const band = crBandForBudget(xpBudget(party(), 'hard'), 4)
    expect(band.min).toBeLessThanOrEqual(0.5)
  })

  it('raises the floor for a high-level party', () => {
    const high = Array.from({ length: 4 }, () => ({ level: 20 }))
    const band = crBandForBudget(xpBudget(high, 'hard'), 4)
    expect(band.min).toBeGreaterThan(0.5)
  })

  it('never returns an inverted band', () => {
    for (const budget of [0, 1, 50, 3000, 200000]) {
      const band = crBandForBudget(budget, 4)
      expect(band.min).toBeLessThanOrEqual(band.max)
    }
  })

  it('survives junk input', () => {
    expect(() => crBandForBudget(null, 0)).not.toThrow()
    expect(() => crBandForBudget('abc', -5)).not.toThrow()
  })
})

describe('candidateMonsters', () => {
  const budget = xpBudget(party(), 'hard')

  it('drops monsters far above the budget', () => {
    const out = candidateMonsters(srd, { budget, partySize: 4 })
    expect(out.find(m => m.index === 'ancient-red-dragon')).toBeUndefined()
  })

  it('keeps monsters inside the band', () => {
    const out = candidateMonsters(srd, { budget, partySize: 4 })
    expect(out.map(m => m.index)).toContain('ogre')
    expect(out.map(m => m.index)).toContain('troll')
  })

  it('carries the XP each monster is worth, so the model can do the arithmetic', () => {
    const ogre = candidateMonsters(srd, { budget, partySize: 4 }).find(m => m.index === 'ogre')
    expect(ogre.xp).toBe(450)
    expect(ogre.cr).toBe(2)
  })

  it('RANKS thematic matches first rather than filtering on them', () => {
    // A hard filter on "swamp" would return nothing at all from the SRD.
    const out = candidateMonsters(srd, { budget, partySize: 4, environment: 'swamp' })
    expect(out[0].index).toBe('swamp-hag')
    expect(out.length).toBeGreaterThan(1)
  })

  it('still returns a full list when the theme matches nothing', () => {
    const out = candidateMonsters(srd, { budget, partySize: 4, environment: 'interdimensional' })
    expect(out.length).toBeGreaterThan(3)
  })

  it('honours the limit, so a small model is not handed 300 lines', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      index: `m${i}`, name: `Monster ${i}`, challenge_rating: 1, type: 'beast',
    }))
    expect(candidateMonsters(many, { budget, limit: 40 })).toHaveLength(40)
  })

  it('accepts homebrew entries keyed by id rather than index', () => {
    const out = candidateMonsters([{ id: 'hb1', name: 'Bog Wretch', challenge_rating: 1, source: 'homebrew' }], { budget })
    expect(out[0].index).toBe('hb1')
    expect(out[0].source).toBe('homebrew')
  })

  it('drops entries with no name or no identifier', () => {
    expect(candidateMonsters([{ name: 'No id' }, { index: 'x' }, null], { budget })).toEqual([])
  })

  it('handles junk input', () => {
    expect(candidateMonsters(null, { budget })).toEqual([])
    expect(candidateMonsters(srd, {})).toBeInstanceOf(Array)
  })
})

describe('buildGenerationPrompt', () => {
  const candidates = candidateMonsters(srd, { budget: 3000, partySize: 4 })

  it('demands JSON only', () => {
    expect(buildGenerationPrompt({ candidates }).system).toMatch(/ONLY valid JSON/i)
  })

  it('forbids inventing monsters, in as many words', () => {
    const { system } = buildGenerationPrompt({ candidates })
    expect(system).toMatch(/Never invent a monster/i)
    expect(system).toMatch(/ONLY use monsters from the candidate list/i)
  })

  it('lists every candidate with its index and XP', () => {
    const { user } = buildGenerationPrompt({ candidates })
    expect(user).toContain('index: ogre')
    expect(user).toContain('450 XP each')
  })

  it('states the budget and the party', () => {
    const { user } = buildGenerationPrompt({ candidates, budget: 3000, partySize: 4, avgLevel: 5 })
    expect(user).toContain('3000')
    expect(user).toMatch(/4 characters of about level 5/)
  })

  it('spells out the multiplier ladder, since the model must apply it', () => {
    expect(buildGenerationPrompt({ candidates }).system).toMatch(/3-6 x2/)
  })

  it('includes location and theme when given', () => {
    const { user } = buildGenerationPrompt({ candidates, location: 'Mere of Dead Men', theme: 'swamp ambush' })
    expect(user).toContain('Mere of Dead Men')
    expect(user).toContain('swamp ambush')
  })

  it('survives an empty candidate list', () => {
    expect(buildGenerationPrompt({}).user).toContain('(none)')
  })
})

describe('parseGeneratedEncounter', () => {
  const good = JSON.stringify({
    name: 'Bog Ambush',
    monsters: [{ index: 'lizardfolk', count: 4 }, { index: 'swamp-hag', count: 1 }],
    tactics: 'They rise from the water.',
    notes: 'Difficult terrain throughout.',
  })

  it('reads a clean response', () => {
    const out = parseGeneratedEncounter(good)
    expect(out.name).toBe('Bog Ambush')
    expect(out.monsters).toHaveLength(2)
    expect(out.tactics).toMatch(/rise from the water/)
  })

  it('strips fences, via the shared extractor', () => {
    expect(parseGeneratedEncounter('```json\n' + good + '\n```').monsters).toHaveLength(2)
  })

  it('survives a chatty preamble', () => {
    expect(parseGeneratedEncounter('Sure!\n' + good).monsters).toHaveLength(2)
  })

  it('floors a count at 1 — zero contributes nothing, negative subtracts XP', () => {
    const out = parseGeneratedEncounter('{"monsters":[{"index":"orc","count":0},{"index":"ogre","count":-3}]}')
    expect(out.monsters.map(m => m.count)).toEqual([1, 1])
  })

  it('rounds a fractional count', () => {
    expect(parseGeneratedEncounter('{"monsters":[{"index":"orc","count":2.9}]}').monsters[0].count).toBe(2)
  })

  it('accepts monster_index and slug as aliases for index', () => {
    const out = parseGeneratedEncounter('{"monsters":[{"monster_index":"orc","count":1},{"slug":"ogre","count":1}]}')
    expect(out.monsters.map(m => m.index)).toEqual(['orc', 'ogre'])
  })

  it('drops an entry naming no monster, and says how many', () => {
    const out = parseGeneratedEncounter('{"monsters":[{"index":"orc","count":1},{"count":2}]}')
    expect(out.monsters).toHaveLength(1)
    expect(out.dropped).toBe(1)
  })

  it('defaults the name rather than saving an untitled encounter', () => {
    expect(parseGeneratedEncounter('{"monsters":[]}').name).toBe('Generated encounter')
  })

  it('throws on genuinely unparseable output, so the caller can retry', () => {
    expect(() => parseGeneratedEncounter('the model refused')).toThrow()
  })
})

describe('resolveSelection — the invented-monster guarantee', () => {
  const candidates = candidateMonsters(srd, { budget: 3000, partySize: 4 })

  it('resolves real picks to full candidate records', () => {
    const { monsters } = resolveSelection({ monsters: [{ index: 'ogre', count: 2 }] }, candidates)
    expect(monsters[0]).toMatchObject({ index: 'ogre', name: 'Ogre', cr: 2, xp: 450, count: 2 })
  })

  it('DROPS a monster the model invented, and names it', () => {
    const { monsters, invented } = resolveSelection({
      monsters: [{ index: 'ogre', count: 1 }, { index: 'bog-horror-9000', count: 3 }],
    }, candidates)
    expect(monsters.map(m => m.index)).toEqual(['ogre'])
    expect(invented).toEqual(['bog-horror-9000'])
  })

  it('drops a real monster that was not in the candidate list', () => {
    // The dragon exists, but was filtered out as over budget — offering it
    // anyway would defeat the band.
    const { monsters, invented } = resolveSelection({
      monsters: [{ index: 'ancient-red-dragon', count: 1 }],
    }, candidates)
    expect(monsters).toEqual([])
    expect(invented).toEqual(['ancient-red-dragon'])
  })

  it('merges duplicate picks of the same monster', () => {
    const { monsters } = resolveSelection({
      monsters: [{ index: 'orc', count: 2 }, { index: 'orc', count: 3 }],
    }, candidates)
    expect(monsters).toHaveLength(1)
    expect(monsters[0].count).toBe(5)
  })

  it('matches the index case-insensitively', () => {
    const { monsters } = resolveSelection({ monsters: [{ index: 'OGRE', count: 1 }] }, candidates)
    expect(monsters).toHaveLength(1)
  })

  it('handles an empty selection', () => {
    expect(resolveSelection({ monsters: [] }, candidates).monsters).toEqual([])
    expect(resolveSelection(null, candidates).monsters).toEqual([])
  })
})

describe('validateAgainstBudget — the reject-and-retry rule', () => {
  const characters = party()

  /**
   * Build a monster entry directly from the fixture.
   *
   * NOT via candidateMonsters: a huge budget raises the CR FLOOR, which filters
   * out the very goblins and ogres these cases need. The band is tested above;
   * here the subject is the budget verdict.
   */
  const pick = (index, count) => {
    const m = srd.find(x => x.index === index)
    return { index: m.index, name: m.name, cr: m.challenge_rating, xp: crToXP(m.challenge_rating), count }
  }

  it('accepts an encounter on the requested tier', () => {
    // 2 trolls = 3600 raw x1.5 = 5400; hard threshold for 4xL5 is 3000, deadly 4400.
    const out = validateAgainstBudget([pick('troll', 2)], { characters, difficulty: 'deadly' })
    expect(out.label).toBe('Deadly')
    expect(out.ok).toBe(true)
  })

  it('accepts one tier out — a Hard that lands Deadly is still a fine encounter', () => {
    const out = validateAgainstBudget([pick('troll', 2)], { characters, difficulty: 'hard' })
    expect(Math.abs(out.tiersOff)).toBe(1)
    expect(out.ok).toBe(true)
  })

  it('REJECTS more than one tier out', () => {
    // One goblin against four level-5s is Trivial, two tiers below Medium.
    const out = validateAgainstBudget([pick('goblin', 1)], { characters, difficulty: 'hard' })
    expect(out.ok).toBe(false)
    expect(out.tiersOff).toBeLessThan(-1)
    expect(out.reason).toMatch(/too easy/)
  })

  it('says which direction it missed', () => {
    const tooHard = validateAgainstBudget([pick('troll', 6)], { characters, difficulty: 'easy' })
    expect(tooHard.ok).toBe(false)
    expect(tooHard.reason).toMatch(/too hard/)
  })

  it('rejects an empty encounter with a reason', () => {
    const out = validateAgainstBudget([], { characters, difficulty: 'hard' })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/no usable monsters/)
  })

  it('agrees with the calculator the DM will see', () => {
    // The whole point: the generator's verdict and XPCalculator's must match,
    // or a saved encounter rates differently from what generation promised.
    const monsters = [pick('ogre', 3)]
    const out = validateAgainstBudget(monsters, { characters, difficulty: 'hard' })
    const calculator = difficultyRating(adjustedXP(monsters, 4), partyThresholds(characters))
    expect(out.label).toBe(calculator.label)
    expect(out.adjusted).toBe(adjustedXP(monsters, 4))
  })

  it('threads party size through the multiplier', () => {
    const six = Array.from({ length: 6 }, () => ({ level: 5 }))
    const monsters = [pick('orc', 4)]
    expect(validateAgainstBudget(monsters, { characters: six }).adjusted)
      .toBe(adjustedXP(monsters, 6))
  })

  it('handles an unknown difficulty by treating it as medium', () => {
    const out = validateAgainstBudget([pick('ogre', 2)], { characters, difficulty: 'nonsense' })
    expect(out.target).toBe('nonsense')
    expect(Number.isFinite(out.tiersOff)).toBe(true)
  })

  it('survives being called with nothing', () => {
    expect(() => validateAgainstBudget()).not.toThrow()
  })
})

describe('retryHint', () => {
  const characters = party()
  const pick = (index, count) => {
    const m = srd.find(x => x.index === index)
    return { index: m.index, name: m.name, cr: m.challenge_rating, xp: crToXP(m.challenge_rating), count }
  }

  it('tells the model to weaken an over-budget attempt', () => {
    const v = validateAgainstBudget([pick('troll', 6)], { characters, difficulty: 'easy' })
    expect(retryHint(v, 500)).toMatch(/too strong/)
    expect(retryHint(v, 500)).toMatch(/fewer or weaker/)
  })

  it('tells it to strengthen an under-budget attempt', () => {
    const v = validateAgainstBudget([pick('goblin', 1)], { characters, difficulty: 'deadly' })
    expect(retryHint(v, 4400)).toMatch(/too weak/)
    expect(retryHint(v, 4400)).toMatch(/more or stronger/)
  })

  it('is empty when there is nothing to fix', () => {
    const v = validateAgainstBudget([pick('troll', 2)], { characters, difficulty: 'deadly' })
    expect(retryHint(v, 4400)).toBe('')
    expect(retryHint(null, 100)).toBe('')
  })
})

describe('DIFFICULTIES', () => {
  it('matches the tiers xpBudget understands', () => {
    for (const d of DIFFICULTIES) {
      expect(xpBudget(party(), d)).toBeGreaterThan(0)
    }
  })
})
