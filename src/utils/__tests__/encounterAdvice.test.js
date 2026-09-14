import { describe, it, expect } from 'vitest'
import {
  buildAdvicePrompt,
  parseAdvice,
  normaliseAdvice,
  findRosterEntry,
  checkAdvice,
  applyAdvice,
  rosterXpTotal,
  describeAdvice,
} from '../encounterAdvice.js'

const mon = (over = {}) => ({
  id: 'm1', name: 'Goblin', source_index: 'goblin', count: 4, cr: '1/4', xp: 50,
  hp_max: 7, hp_current: 7, ...over,
})

const roster = () => [
  mon(),
  mon({ id: 'm2', name: 'Hobgoblin', source_index: 'hobgoblin', count: 1, cr: '1/2', xp: 100 }),
]

const advice = (over = {}) => ({
  action: 'add', monster_index: 'goblin', monster_name: 'Goblin', count: 2, reason: 'r', ...over,
})

describe('buildAdvicePrompt', () => {
  it('demands JSON only', () => {
    const { system } = buildAdvicePrompt({ monsters: roster() })
    expect(system).toMatch(/ONLY valid JSON/i)
  })

  it('gives the model the SRD index of every roster entry', () => {
    // A suggestion naming "the big orc" cannot be applied to anything.
    const { user } = buildAdvicePrompt({ monsters: roster() })
    expect(user).toContain('index "goblin"')
    expect(user).toContain('index "hobgoblin"')
  })

  it('includes the party and difficulty', () => {
    const { user } = buildAdvicePrompt({
      monsters: roster(), partySize: 4, avgLevel: 5, difficulty: 'Hard', adjustedXp: 1200,
    })
    expect(user).toMatch(/4 players/)
    expect(user).toMatch(/average level 5/)
    expect(user).toMatch(/Hard/)
  })

  it('includes the thresholds when they are known', () => {
    const { user } = buildAdvicePrompt({ monsters: roster(), thresholds: [250, 500, 750, 1100] })
    expect(user).toMatch(/deadly 1100/)
  })

  it('forbids inventing creatures', () => {
    expect(buildAdvicePrompt({}).system).toMatch(/Do not invent creatures/i)
  })

  it('allows an empty answer when the encounter is already balanced', () => {
    expect(buildAdvicePrompt({}).system).toMatch(/empty suggestions array/i)
  })

  it('handles an empty roster', () => {
    expect(buildAdvicePrompt({ monsters: [] }).user).toContain('(empty)')
  })

  it('handles being called with nothing', () => {
    expect(() => buildAdvicePrompt()).not.toThrow()
  })
})

describe('parseAdvice', () => {
  it('reads suggestions and the summary', () => {
    const out = parseAdvice(JSON.stringify({ summary: 'Too easy.', suggestions: [advice()] }))
    expect(out.summary).toBe('Too easy.')
    expect(out.suggestions).toHaveLength(1)
  })

  it('keeps the summary when there are no suggestions — that is a real answer', () => {
    const out = parseAdvice('{"summary":"Already well balanced.","suggestions":[]}')
    expect(out.summary).toBe('Already well balanced.')
    expect(out.suggestions).toEqual([])
  })

  it('strips fences', () => {
    const out = parseAdvice('```json\n{"suggestions":[' + JSON.stringify(advice()) + ']}\n```')
    expect(out.suggestions).toHaveLength(1)
  })

  it('drops a malformed suggestion without losing the good ones', () => {
    const out = parseAdvice(JSON.stringify({
      suggestions: [advice(), { action: 'teleport', monster_index: 'x' }],
    }))
    expect(out.suggestions).toHaveLength(1)
  })

  it('throws on unparseable output', () => {
    expect(() => parseAdvice('no json here')).toThrow()
  })
})

describe('normaliseAdvice', () => {
  it('floors a count at 1 — zero would silently do nothing', () => {
    expect(normaliseAdvice(advice({ count: 0 })).count).toBe(1)
  })

  it('never lets a negative count invert the operation', () => {
    expect(normaliseAdvice(advice({ action: 'remove', count: -3 })).count).toBe(1)
  })

  it('rounds a fractional count', () => {
    expect(normaliseAdvice(advice({ count: 2.8 })).count).toBe(2)
  })

  it('lowercases the index so matching is reliable', () => {
    expect(normaliseAdvice(advice({ monster_index: 'Orc-War-Chief' })).monsterIndex).toBe('orc-war-chief')
  })

  it('falls back to the index when there is no display name', () => {
    expect(normaliseAdvice({ action: 'add', monster_index: 'goblin' }).monsterName).toBe('goblin')
  })

  it('rejects an unknown action', () => {
    expect(normaliseAdvice(advice({ action: 'summon' }))).toBeNull()
  })

  it('rejects a replace with nothing to replace it with', () => {
    // An ambiguous removal dressed as a replacement.
    expect(normaliseAdvice(advice({ action: 'replace' }))).toBeNull()
  })

  it('accepts a replace that names its replacement', () => {
    const out = normaliseAdvice(advice({
      action: 'replace', replace_with_index: 'orc', replace_with_name: 'Orc',
    }))
    expect(out.replaceWithIndex).toBe('orc')
  })

  it('rejects an entry naming no monster at all', () => {
    expect(normaliseAdvice({ action: 'add', count: 2 })).toBeNull()
  })

  it('rejects nullish and non-objects', () => {
    for (const junk of [null, undefined, 'x', 42]) expect(normaliseAdvice(junk)).toBeNull()
  })
})

describe('findRosterEntry', () => {
  it('matches on SRD index first', () => {
    expect(findRosterEntry(roster(), 'hobgoblin', 'Goblin').name).toBe('Hobgoblin')
  })

  it('falls back to the display name', () => {
    expect(findRosterEntry(roster(), 'not-an-index', 'Goblin').name).toBe('Goblin')
  })

  it('ignores case', () => {
    expect(findRosterEntry(roster(), 'GOBLIN')).not.toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(findRosterEntry(roster(), 'beholder', 'Beholder')).toBeNull()
  })

  it('handles a missing roster', () => {
    expect(findRosterEntry(null, 'goblin')).toBeNull()
  })
})

describe('checkAdvice', () => {
  it('an add of something present is applicable with no lookup', () => {
    expect(checkAdvice(normaliseAdvice(advice()), roster())).toEqual({ ok: true })
  })

  it('an add of something new needs a stat block', () => {
    const r = checkAdvice(normaliseAdvice(advice({ monster_index: 'orc', monster_name: 'Orc' })), roster())
    expect(r).toEqual({ ok: true, needsLookup: true })
  })

  it('a remove of something absent is refused, with a reason', () => {
    const r = checkAdvice(normaliseAdvice(advice({ action: 'remove', monster_index: 'orc', monster_name: 'Orc' })), roster())
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/not in this encounter/)
  })

  it('a replace of something absent is refused', () => {
    const r = checkAdvice(normaliseAdvice(advice({
      action: 'replace', monster_index: 'orc', monster_name: 'Orc',
      replace_with_index: 'goblin', replace_with_name: 'Goblin',
    })), roster())
    expect(r.ok).toBe(false)
  })

  it('handles a null suggestion', () => {
    expect(checkAdvice(null, roster()).ok).toBe(false)
  })
})

describe('applyAdvice — add', () => {
  it('bumps the count of a monster already present', () => {
    const out = applyAdvice(normaliseAdvice(advice({ count: 2 })), roster())
    expect(out.changed).toBe(true)
    expect(out.monsters.find(m => m.name === 'Goblin').count).toBe(6)
    expect(out.note).toBe('Goblin ×4 → ×6')
  })

  it('appends a new entry when one is supplied', () => {
    const entry = { id: 'new', name: 'Orc', source_index: 'orc', count: 1, xp: 100 }
    const out = applyAdvice(
      normaliseAdvice(advice({ monster_index: 'orc', monster_name: 'Orc', count: 3 })),
      roster(), entry,
    )
    expect(out.monsters).toHaveLength(3)
    expect(out.monsters.at(-1).count).toBe(3)
  })

  it('is a no-op rather than a half-written entry when the stat block is missing', () => {
    const out = applyAdvice(
      normaliseAdvice(advice({ monster_index: 'orc', monster_name: 'Orc' })), roster(), null)
    expect(out.changed).toBe(false)
    expect(out.monsters).toHaveLength(2)
  })
})

describe('applyAdvice — remove', () => {
  it('reduces the count', () => {
    const out = applyAdvice(normaliseAdvice(advice({ action: 'remove', count: 1 })), roster())
    expect(out.monsters.find(m => m.name === 'Goblin').count).toBe(3)
  })

  it('drops the entry entirely when the count reaches zero', () => {
    const out = applyAdvice(normaliseAdvice(advice({ action: 'remove', count: 4 })), roster())
    expect(out.monsters.find(m => m.name === 'Goblin')).toBeUndefined()
    expect(out.monsters).toHaveLength(1)
  })

  it('removing more than are present drops the entry rather than going negative', () => {
    const out = applyAdvice(normaliseAdvice(advice({ action: 'remove', count: 99 })), roster())
    expect(out.monsters).toHaveLength(1)
    expect(out.monsters.every(m => m.count > 0)).toBe(true)
  })

  it('is a no-op when the monster is absent', () => {
    const out = applyAdvice(
      normaliseAdvice(advice({ action: 'remove', monster_index: 'orc', monster_name: 'Orc' })), roster())
    expect(out.changed).toBe(false)
  })
})

describe('applyAdvice — replace', () => {
  const replaceAdvice = (over = {}) => normaliseAdvice(advice({
    action: 'replace', monster_index: 'goblin', monster_name: 'Goblin', count: 2,
    replace_with_index: 'orc', replace_with_name: 'Orc', ...over,
  }))

  it('removes the target and adds the replacement', () => {
    const entry = { id: 'new', name: 'Orc', source_index: 'orc', count: 1, xp: 100 }
    const out = applyAdvice(replaceAdvice(), roster(), entry)
    expect(out.monsters.find(m => m.name === 'Goblin').count).toBe(2)
    expect(out.monsters.find(m => m.name === 'Orc').count).toBe(2)
  })

  it('merges into the replacement when it is already in the roster', () => {
    const out = applyAdvice(
      replaceAdvice({ replace_with_index: 'hobgoblin', replace_with_name: 'Hobgoblin' }),
      roster(),
    )
    expect(out.monsters.find(m => m.name === 'Hobgoblin').count).toBe(3)
    expect(out.monsters.find(m => m.name === 'Goblin').count).toBe(2)
  })

  it('removes the target entirely when replacing all of them', () => {
    const entry = { id: 'new', name: 'Orc', source_index: 'orc', count: 1, xp: 100 }
    const out = applyAdvice(replaceAdvice({ count: 4 }), roster(), entry)
    expect(out.monsters.find(m => m.name === 'Goblin')).toBeUndefined()
    expect(out.monsters.find(m => m.name === 'Orc').count).toBe(4)
  })

  it('is a no-op when the stat block is missing', () => {
    const out = applyAdvice(replaceAdvice(), roster(), null)
    expect(out.changed).toBe(false)
    expect(out.monsters).toHaveLength(2)
  })
})

describe('applyAdvice — purity', () => {
  it('never mutates the roster it was given', () => {
    const original = roster()
    const snapshot = JSON.stringify(original)
    applyAdvice(normaliseAdvice(advice({ count: 5 })), original)
    applyAdvice(normaliseAdvice(advice({ action: 'remove', count: 99 })), original)
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('handles a missing roster', () => {
    expect(applyAdvice(normaliseAdvice(advice()), null).changed).toBe(false)
  })

  it('reports an unknown action rather than throwing', () => {
    expect(applyAdvice({ action: 'nonsense' }, roster()).changed).toBe(false)
  })
})

describe('rosterXpTotal', () => {
  it('multiplies xp by count, as MonsterRoster does before saving', () => {
    expect(rosterXpTotal(roster())).toBe(4 * 50 + 1 * 100)
  })

  it('treats a missing count as one and missing xp as zero', () => {
    expect(rosterXpTotal([{ xp: 50 }, { count: 2 }])).toBe(50)
  })

  it('handles an empty or missing roster', () => {
    expect(rosterXpTotal([])).toBe(0)
    expect(rosterXpTotal(null)).toBe(0)
  })
})

describe('describeAdvice', () => {
  it('labels each action readably', () => {
    expect(describeAdvice(normaliseAdvice(advice()))).toBe('Add 2× Goblin')
    expect(describeAdvice(normaliseAdvice(advice({ action: 'remove', count: 1 })))).toBe('Remove 1× Goblin')
    expect(describeAdvice(normaliseAdvice(advice({
      action: 'replace', replace_with_index: 'orc', replace_with_name: 'Orc',
    })))).toBe('Replace 2× Goblin with Orc')
  })

  it('handles null', () => {
    expect(describeAdvice(null)).toBe('')
  })
})
