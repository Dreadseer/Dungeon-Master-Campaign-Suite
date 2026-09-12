import { describe, it, expect } from 'vitest'
import queryExpansion from '../queryExpansion.js'
// The renderer's condition list. queryExpansion.js duplicates the names for the
// main process; these tests assert the two agree, so adding a condition in one
// place and forgetting the other fails here rather than silently degrading recall.
import { CONDITIONS } from '../../../src/utils/combatUtils.js'

const { expandQuery, CONDITION_EXPANSIONS, CONDITION_KEYS } = queryExpansion

describe('all 15 conditions are covered', () => {
  it('has an entry for every condition in combatUtils', () => {
    const fromCombatUtils = CONDITIONS.map(c => c.name.toLowerCase()).sort()
    expect(CONDITION_KEYS.slice().sort()).toEqual(fromCombatUtils)
  })

  it('covers exactly 15 conditions, no more', () => {
    expect(CONDITION_KEYS).toHaveLength(15)
    expect(CONDITIONS).toHaveLength(15)
  })

  // The headline assertion the phase asks for: every condition name, typed as a
  // DM would type it, produces an expanded query.
  for (const condition of CONDITIONS) {
    const name = condition.name.toLowerCase()
    it(`"what does the ${name} condition do" expands`, () => {
      const question = `what does the ${name} condition do`
      const expanded = expandQuery(question)
      expect(expanded).not.toBe(question)
      expect(expanded.startsWith(question)).toBe(true)
      expect(expanded.length).toBeGreaterThan(question.length)
    })
  }

  it('every condition expansion mentions the word "condition"', () => {
    for (const [name, expansion] of Object.entries(CONDITION_EXPANSIONS)) {
      expect(expansion, name).toContain('condition')
    }
  })

  it('the restrained expansion carries the rules text, not just the name', () => {
    const expanded = expandQuery('what does the restrained condition do')
    expect(expanded).toContain('speed becomes 0')
    expect(expanded).toContain('disadvantage')
  })
})

describe('punctuation no longer defeats expansion', () => {
  // The original split on ' ' alone, so "grappled?" never matched the table —
  // and a DM typing a question almost always ends it with a question mark.
  it('a trailing question mark still matches', () => {
    expect(expandQuery('is the target grappled?')).not.toBe('is the target grappled?')
  })

  it('parentheses, commas and hyphens still match', () => {
    for (const q of ['(restrained)', 'prone, and blinded', 'half-cover and prone']) {
      expect(expandQuery(q), q).not.toBe(q)
    }
  })

  it('is case-insensitive', () => {
    expect(expandQuery('RESTRAINED')).not.toBe('RESTRAINED')
    expect(expandQuery('Restrained')).not.toBe('Restrained')
  })
})

describe('grammatical variants of a condition name', () => {
  it('matches the stem and the -ing form', () => {
    for (const q of ['grapple', 'grappled', 'grappling']) {
      expect(expandQuery(q), q).not.toBe(q)
    }
    for (const q of ['restrain', 'restrained', 'restraining']) {
      expect(expandQuery(q), q).not.toBe(q)
    }
  })

  it('matches "stun" as well as "stunned"', () => {
    expect(expandQuery('stun')).not.toBe('stun')
    expect(expandQuery('stunned')).not.toBe('stunned')
  })

  it('does not generate a nonsense two-letter alias', () => {
    // The alias generator trims short stems; nothing should expand from 'ed'.
    expect(expandQuery('ed')).toBe('ed')
  })
})

describe('the terms the phase brief calls out by name', () => {
  it('grapple and grappled both expand', () => {
    expect(expandQuery('grapple')).toContain('speed becomes 0')
    expect(expandQuery('grappled')).toContain('speed becomes 0')
  })

  it('opportunity attack expands', () => {
    const expanded = expandQuery('when do I get an opportunity attack')
    expect(expanded).toContain('leaves your reach')
  })

  it('somatic, verbal and material each expand', () => {
    expect(expandQuery('somatic')).toContain('free hand')
    expect(expandQuery('verbal')).toContain('spellcasting components')
    expect(expandQuery('material')).toContain('component pouch')
  })
})

describe('general behaviour', () => {
  it('preserves the original question at the front', () => {
    const q = 'what is the attack bonus of a goblin'
    expect(expandQuery(q).startsWith(q)).toBe(true)
  })

  it('adds each expansion only once however often its trigger appears', () => {
    const expanded = expandQuery('attack attack attack')
    const occurrences = expanded.split('attack roll hit bonus proficiency').length - 1
    expect(occurrences).toBe(1)
  })

  it('does not duplicate an expansion shared by two trigger words', () => {
    // 'save' and 'saving' map to the same string.
    const expanded = expandQuery('what is a saving throw save dc')
    expect(expanded.split('saving throw').length - 1).toBeLessThanOrEqual(3)
  })

  it('leaves a question with no known terms unchanged', () => {
    const q = 'who is the innkeeper in Phandalin'
    expect(expandQuery(q)).toBe(q)
  })

  it('handles empty and non-string input without throwing', () => {
    expect(expandQuery('')).toBe('')
    expect(expandQuery('   ')).toBe('   ')
    expect(expandQuery(null)).toBe('')
    expect(expandQuery(undefined)).toBe('')
    expect(expandQuery(42)).toBe('')
  })

  it('expands several distinct terms in one question', () => {
    const expanded = expandQuery('does a prone creature have disadvantage on an opportunity attack')
    expect(expanded).toContain('crawl')            // prone
    expect(expanded).toContain('two d20 lower')    // disadvantage
    expect(expanded).toContain('leaves your reach') // opportunity
  })

  it('the expansion is appended, never substituted', () => {
    const q = 'restrained'
    const expanded = expandQuery(q)
    expect(expanded.slice(0, q.length)).toBe(q)
    expect(expanded[q.length]).toBe(' ')
  })
})
