import { describe, it, expect } from 'vitest'
import {
  findCombatantForToken,
  findTokenForCombatant,
  summariseForMap,
} from '../tokenCombatLink.js'

const tok = (over = {}) => ({
  id: 't1', label: 'Goblin', type: 'monster', col: 0, row: 0,
  entity_type: null, entity_id: null, ...over,
})

const cbt = (over = {}) => ({
  id: 'c1', name: 'Goblin', is_player: false, entity_id: null,
  hp_current: 7, hp_max: 7, temp_hp: 0, conditions: [], ...over,
})

describe('findCombatantForToken', () => {
  it('matches a player token by entity_id, not by name', () => {
    const token = tok({ label: 'Old name', entity_type: 'character', entity_id: 42 })
    const match = findCombatantForToken(token, [
      cbt({ id: 'c1', name: 'Thorin', is_player: true, entity_id: 42 }),
      cbt({ id: 'c2', name: 'Old name' }),
    ])
    expect(match.id).toBe('c1')
  })

  it('falls back to the name when the entity link no longer resolves', () => {
    // A token can outlive the character it was made from.
    const token = tok({ label: 'Thorin', entity_type: 'character', entity_id: 999 })
    const match = findCombatantForToken(token, [cbt({ id: 'c1', name: 'Thorin', is_player: true, entity_id: 42 })])
    expect(match.id).toBe('c1')
  })

  it('does not match a character entity_id to a monster carrying the same id', () => {
    const token = tok({ label: 'Nothing', entity_type: 'character', entity_id: 5 })
    expect(findCombatantForToken(token, [cbt({ entity_id: 5, is_player: false })])).toBeNull()
  })

  it('matches a monster token by name', () => {
    expect(findCombatantForToken(tok({ label: 'Goblin' }), [cbt({ name: 'Goblin' })]).id).toBe('c1')
  })

  it('ignores case and stray whitespace in names', () => {
    const match = findCombatantForToken(tok({ label: '  goblin   boss ' }), [cbt({ name: 'Goblin Boss' })])
    expect(match).not.toBeNull()
  })

  it('refuses to guess between two combatants with the same name', () => {
    // Showing one of two goblins' HP and letting the DM believe it is worse
    // than showing nothing.
    const match = findCombatantForToken(tok({ label: 'Goblin' }), [
      cbt({ id: 'c1', name: 'Goblin' }),
      cbt({ id: 'c2', name: 'Goblin' }),
    ])
    expect(match).toBeNull()
  })

  it('returns null for a token nothing in the fight matches', () => {
    expect(findCombatantForToken(tok({ label: 'Barrel' }), [cbt()])).toBeNull()
  })

  it('returns null for a blank label', () => {
    expect(findCombatantForToken(tok({ label: '   ' }), [cbt({ name: '   ' })])).toBeNull()
  })

  it('handles nullish and empty input', () => {
    expect(findCombatantForToken(null, [cbt()])).toBeNull()
    expect(findCombatantForToken(tok(), [])).toBeNull()
    expect(findCombatantForToken(tok(), null)).toBeNull()
  })
})

describe('findTokenForCombatant', () => {
  it('matches a player by entity_id', () => {
    const match = findTokenForCombatant(
      cbt({ name: 'Thorin', is_player: true, entity_id: 42 }),
      [tok({ id: 't9', label: 'Renamed', entity_type: 'character', entity_id: 42 })],
    )
    expect(match.id).toBe('t9')
  })

  it('matches a monster by name', () => {
    expect(findTokenForCombatant(cbt({ name: 'Goblin' }), [tok({ id: 't3', label: 'Goblin' })]).id).toBe('t3')
  })

  it('refuses to guess between two tokens with the same label', () => {
    const match = findTokenForCombatant(cbt({ name: 'Goblin' }), [
      tok({ id: 't1', label: 'Goblin' }),
      tok({ id: 't2', label: 'Goblin' }),
    ])
    expect(match).toBeNull()
  })

  it('handles nullish and empty input', () => {
    expect(findTokenForCombatant(null, [tok()])).toBeNull()
    expect(findTokenForCombatant(cbt(), [])).toBeNull()
    expect(findTokenForCombatant(cbt(), null)).toBeNull()
  })
})

describe('summariseForMap', () => {
  it('keeps only what the map shows', () => {
    const [out] = summariseForMap([cbt({
      legendary_used: 2, death_saves: { successes: 1, failures: 0 }, initiative: 17,
    })])
    expect(Object.keys(out).sort()).toEqual([
      'conditions', 'entity_id', 'hp_current', 'hp_max',
      'id', 'is_active', 'is_player', 'name', 'temp_hp',
    ])
  })

  it('copies the conditions array rather than sharing it across the window', () => {
    const source = cbt({ conditions: ['Prone'] })
    const [out] = summariseForMap([source])
    out.conditions.push('Blinded')
    expect(source.conditions).toEqual(['Prone'])
  })

  it('normalises missing HP to null rather than NaN', () => {
    const [out] = summariseForMap([{ id: 'c1', name: 'x' }])
    expect(out.hp_current).toBeNull()
    expect(out.hp_max).toBeNull()
    expect(out.temp_hp).toBe(0)
  })

  it('drops entries with no id — they cannot be keyed or matched', () => {
    expect(summariseForMap([cbt(), { name: 'no id' }, null])).toHaveLength(1)
  })

  it('coerces the flags to real booleans', () => {
    const [out] = summariseForMap([cbt({ is_player: 1, is_active: undefined })])
    expect(out.is_player).toBe(true)
    expect(out.is_active).toBe(false)
  })

  it('handles nullish input', () => {
    expect(summariseForMap(null)).toEqual([])
    expect(summariseForMap('nonsense')).toEqual([])
  })
})
