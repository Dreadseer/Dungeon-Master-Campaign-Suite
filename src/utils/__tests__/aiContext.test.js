import { describe, it, expect } from 'vitest'
import {
  buildCampaignContext,
  buildWorldSummary,
  existingNames,
  fitList,
  oneLine,
  clampBudget,
  DEFAULT_CONTEXT_BUDGET,
  MIN_CONTEXT_BUDGET,
} from '../aiContext.js'

const many = (n, make) => Array.from({ length: n }, (_, i) => make(i))

const world = (over = {}) => ({
  campaign: { name: 'Waterdeep Nights', world_setting: 'Faerûn' },
  characters: [{ character_name: 'Thorin', race: 'Dwarf', class: 'Fighter', level: 5 }],
  npcs: [{ id: 1, name: 'Volo', role: 'Chronicler' }],
  factions: [{ id: 1, name: 'Harpers', description: 'A secret network of spies.' }],
  locations: [{ id: 1, name: 'Yawning Portal', type: 'shop', description: 'A tavern over a dungeon.' }],
  lore: [{ id: 1, name: 'The Walking Statues' }],
  session: { session_number: 4, title: 'Into the Vault', notes: 'The party broke into the vault.' },
  plots: [{ id: 1, title: 'Who poisoned the duke?', description: 'Unresolved.', status: 'open' }],
  ...over,
})

describe('the budget — the acceptance line', () => {
  it('stays under budget with 60 factions', () => {
    const { prompt, usage } = buildCampaignContext(world({
      factions: many(60, i => ({ id: i, name: `Faction Number ${i}`, description: `A group of people who do things, number ${i}.` })),
    }))
    expect(prompt.length).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET)
    expect(usage.overBudget).toBe(false)
  })

  it('says how many factions it left out rather than implying there are 17', () => {
    // A model told about 17 of 60 with no hint of the rest will assert those 17
    // are all of them.
    const { prompt } = buildCampaignContext(world({
      factions: many(60, i => ({ id: i, name: `Faction Number ${i}`, description: 'x'.repeat(40) })),
    }))
    expect(prompt).toMatch(/more factions/)
  })

  it('stays under budget with a world that is enormous in every dimension', () => {
    const { prompt } = buildCampaignContext(world({
      npcs:      many(500, i => ({ id: i, name: `NPC ${i}`, role: 'Townsfolk' })),
      factions:  many(200, i => ({ id: i, name: `Faction ${i}`, description: 'x'.repeat(200) })),
      locations: many(300, i => ({ id: i, name: `Location ${i}`, type: 'town', description: 'y'.repeat(300) })),
      lore:      many(400, i => ({ id: i, name: `Lore entry ${i}` })),
      characters: many(12, i => ({ character_name: `PC ${i}`, race: 'Human', class: 'Fighter', level: 5 })),
      plots:     many(80, i => ({ id: i, title: `Thread ${i}`, description: 'z'.repeat(200), status: 'open' })),
    }))
    expect(prompt.length).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET)
  })

  it('honours a custom budget', () => {
    const big = world({ npcs: many(300, i => ({ id: i, name: `NPC ${i}` })) })
    expect(buildCampaignContext(big, { budget: 1200 }).prompt.length).toBeLessThanOrEqual(1200)
    expect(buildCampaignContext(big, { budget: 20000 }).prompt.length).toBeLessThanOrEqual(20000)
  })

  it('a bigger budget actually includes more', () => {
    const big = world({ npcs: many(300, i => ({ id: i, name: `NPC number ${i}` })) })
    const small = buildCampaignContext(big, { budget: 1500 }).prompt.length
    const large = buildCampaignContext(big, { budget: 9000 }).prompt.length
    expect(large).toBeGreaterThan(small)
  })

  it('never exceeds the budget across a sweep of sizes', () => {
    for (const n of [0, 1, 7, 40, 250]) {
      for (const budget of [600, 1500, 6000]) {
        const { prompt } = buildCampaignContext(world({
          npcs: many(n, i => ({ id: i, name: `NPC ${i}`, role: 'Guard' })),
          factions: many(n, i => ({ id: i, name: `Faction ${i}`, description: 'd'.repeat(80) })),
          locations: many(n, i => ({ id: i, name: `Loc ${i}`, type: 'town', description: 'e'.repeat(80) })),
        }), { budget })
        expect(prompt.length, `n=${n} budget=${budget}`).toBeLessThanOrEqual(budget)
      }
    }
  })
})

describe('priority — what survives when the world is too big', () => {
  it('the party and the current session outlive the NPC list', () => {
    const { prompt } = buildCampaignContext(world({
      npcs: many(400, i => ({ id: i, name: `NPC ${i}`, role: 'Townsfolk' })),
    }), { budget: 1200 })
    expect(prompt).toContain('Thorin')
    expect(prompt).toContain('Into the Vault')
  })

  it('open plot threads survive too — they are what the DM is running', () => {
    const { prompt } = buildCampaignContext(world({
      locations: many(400, i => ({ id: i, name: `Location ${i}`, description: 'x'.repeat(200) })),
    }), { budget: 1500 })
    expect(prompt).toContain('Who poisoned the duke?')
  })

  it('the instructions header is never truncated away', () => {
    const { prompt } = buildCampaignContext(world(), { budget: MIN_CONTEXT_BUDGET })
    expect(prompt).toMatch(/Dungeon Master/)
  })
})

describe('content', () => {
  it('includes the campaign and its setting', () => {
    expect(buildCampaignContext(world()).prompt).toContain('"Waterdeep Nights"')
    expect(buildCampaignContext(world()).prompt).toContain('Faerûn')
  })

  it('gives locations a one-line description — the old prompt gave none', () => {
    const { prompt } = buildCampaignContext(world())
    expect(prompt).toContain('Yawning Portal')
    expect(prompt).toMatch(/A tavern over a dungeon/)
  })

  it('lists lore titles but not lore bodies', () => {
    const { prompt } = buildCampaignContext(world({
      lore: [{ id: 1, name: 'The Walking Statues', content: 'SECRET BODY TEXT' }],
    }))
    expect(prompt).toContain('The Walking Statues')
    expect(prompt).not.toContain('SECRET BODY TEXT')
  })

  it('only open and active plot threads appear', () => {
    const { prompt } = buildCampaignContext(world({
      plots: [
        { id: 1, title: 'Open thread', status: 'open' },
        { id: 2, title: 'Active thread', status: 'active' },
        { id: 3, title: 'Resolved thread', status: 'resolved' },
        { id: 4, title: 'Abandoned thread', status: 'abandoned' },
      ],
    }))
    expect(prompt).toContain('Open thread')
    expect(prompt).toContain('Active thread')
    expect(prompt).not.toContain('Resolved thread')
    expect(prompt).not.toContain('Abandoned thread')
  })

  it('tells the model the facts are established truth', () => {
    expect(buildCampaignContext(world()).prompt).toMatch(/do not contradict/i)
  })

  it('appends caller-supplied extra text', () => {
    const { prompt } = buildCampaignContext(world(), { extra: 'RETRIEVED LORE HERE' })
    expect(prompt).toContain('RETRIEVED LORE HERE')
  })
})

describe('empty and malformed worlds', () => {
  it('an empty world still produces a usable prompt', () => {
    const { prompt } = buildCampaignContext({})
    expect(prompt).toMatch(/Dungeon Master/)
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('handles no argument at all', () => {
    expect(() => buildCampaignContext()).not.toThrow()
  })

  it('omits sections that have no data instead of writing empty headings', () => {
    const { prompt } = buildCampaignContext({ campaign: { name: 'X' } })
    expect(prompt).not.toMatch(/Factions:/)
    expect(prompt).not.toMatch(/NPCs:/)
    expect(prompt).not.toMatch(/Locations:/)
  })

  it('copes with entities missing their names', () => {
    expect(() => buildCampaignContext(world({
      npcs: [{ id: 1 }, { id: 2, name: null }],
      factions: [{ id: 1, name: '' }],
    }))).not.toThrow()
  })

  it('copes with a character missing every field', () => {
    const { prompt } = buildCampaignContext(world({ characters: [{}] }))
    expect(prompt).toContain('Unnamed')
  })

  it('reports usage for every section', () => {
    const { usage } = buildCampaignContext(world())
    expect(usage.sections.map(s => s.name)).toEqual(
      ['campaign', 'party', 'session', 'plots', 'locations', 'factions', 'npcs', 'lore'])
    expect(usage.percent).toBeGreaterThan(0)
    expect(usage.budget).toBe(DEFAULT_CONTEXT_BUDGET)
  })
})

describe('clampBudget', () => {
  it('defaults when given nonsense', () => {
    for (const junk of [null, undefined, 'abc', NaN, {}]) {
      expect(clampBudget(junk)).toBe(DEFAULT_CONTEXT_BUDGET)
    }
  })

  it('refuses a budget with no room for facts', () => {
    expect(clampBudget(10)).toBe(MIN_CONTEXT_BUDGET)
    expect(clampBudget(-500)).toBe(MIN_CONTEXT_BUDGET)
  })

  it('caps the top end', () => {
    expect(clampBudget(9_000_000)).toBe(50000)
  })

  it('rounds a fractional budget', () => {
    expect(clampBudget(2000.7)).toBe(2001)
  })
})

describe('fitList', () => {
  it('keeps everything when it fits', () => {
    const r = fitList(['a', 'b', 'c'], 1000)
    expect(r.text).toBe('a, b, c')
    expect(r.omitted).toBe(0)
  })

  it('reports what it left out', () => {
    const r = fitList(['aaaa', 'bbbb', 'cccc', 'dddd'], 20)
    expect(r.omitted).toBeGreaterThan(0)
    expect(r.text).toMatch(/more$/)
  })

  it('skips blank entries without counting them as omitted', () => {
    expect(fitList(['a', '', null, 'b'], 1000).omitted).toBe(0)
  })

  it('returns empty text for an empty list', () => {
    expect(fitList([], 1000).text).toBe('')
  })

  it('never returns more than the budget when at least one item fits', () => {
    const r = fitList(many(50, i => `item-${i}`), 100)
    expect(r.text.length).toBeLessThanOrEqual(100)
  })
})

describe('oneLine', () => {
  it('collapses newlines and runs of whitespace', () => {
    expect(oneLine('a\n\n  b\tc')).toBe('a b c')
  })

  it('truncates with an ellipsis', () => {
    const out = oneLine('x'.repeat(500), 50)
    expect(out.length).toBeLessThanOrEqual(51)
    expect(out.endsWith('…')).toBe(true)
  })

  it('cuts at a word boundary rather than mid-word', () => {
    const source = 'the quick brown fox jumps over'
    const out = oneLine(source, 20)
    const body = out.slice(0, -1)                  // drop the ellipsis
    expect(source.startsWith(body)).toBe(true)     // it is a genuine prefix
    expect(source[body.length]).toBe(' ')          // and it stopped on a space
  })

  it('falls back to a hard cut when there is no nearby space', () => {
    const out = oneLine('supercalifragilisticexpialidocious', 10)
    expect(out).toBe('supercalif…')
  })

  it('handles nullish', () => {
    expect(oneLine(null)).toBe('')
    expect(oneLine(undefined)).toBe('')
  })
})

describe('buildWorldSummary', () => {
  it('drops the assistant header, keeping only the facts', () => {
    const summary = buildWorldSummary(world())
    expect(summary).not.toMatch(/You are an AI assistant/)
    expect(summary).toContain('Waterdeep Nights')
  })

  it('respects the budget too', () => {
    const summary = buildWorldSummary(world({ npcs: many(400, i => ({ id: i, name: `NPC ${i}` })) }), { budget: 900 })
    expect(summary.length).toBeLessThanOrEqual(900)
  })
})

describe('existingNames', () => {
  it('collects every name across the four kinds', () => {
    expect(existingNames(world()).sort()).toEqual(
      ['Harpers', 'The Walking Statues', 'Volo', 'Yawning Portal'])
  })

  it('drops blanks and handles an empty world', () => {
    expect(existingNames({ npcs: [{ name: '' }, { name: null }] })).toEqual([])
    expect(existingNames()).toEqual([])
  })
})
