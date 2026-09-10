import { describe, it, expect, test } from 'vitest'
import {
  rollInitiative,
  buildCombatants,
  sortByInitiative,
  nextTurn,
  CONDITIONS,
  getCondition,
} from '../combatUtils.js'
import { createMonsterEntry } from '../encounterUtils.js'

// buildCombatants takes an encounter row straight from SQLite, so `monsters` is
// a JSON *string*, not an array. These helpers build rows in that shape.
const encounterWith = (monsters) => ({ monsters: JSON.stringify(monsters) })

const character = (name, { dex = 10, hp_max = 30, hp_current = 30, id = 1 } = {}) => ({
  id,
  character_name: name,
  hp_max,
  hp_current,
  stats: JSON.stringify({ dex }),
})

const monsterEntry = (name, count, extra = {}) => ({
  id: `entry-${name}`,
  name,
  count,
  hp_max: 7,
  hp_current: 7,
  ...extra,
})

describe('rollInitiative', () => {
  it('stays within 1-20 with no modifier', () => {
    for (let i = 0; i < 500; i++) {
      const roll = rollInitiative()
      expect(roll).toBeGreaterThanOrEqual(1)
      expect(roll).toBeLessThanOrEqual(20)
    }
  })

  it('shifts the whole range by the modifier', () => {
    for (let i = 0; i < 500; i++) {
      const roll = rollInitiative(3)
      expect(roll).toBeGreaterThanOrEqual(4)
      expect(roll).toBeLessThanOrEqual(23)
    }
  })

  it('handles a negative modifier', () => {
    for (let i = 0; i < 200; i++) {
      const roll = rollInitiative(-2)
      expect(roll).toBeGreaterThanOrEqual(-1)
      expect(roll).toBeLessThanOrEqual(18)
    }
  })

  it('returns integers', () => {
    for (let i = 0; i < 100; i++) {
      expect(Number.isInteger(rollInitiative(2))).toBe(true)
    }
  })
})

describe('buildCombatants — monster count expansion', () => {
  it('numbers the copies when count > 1', () => {
    const combatants = buildCombatants(encounterWith([monsterEntry('Goblin', 3)]), [])
    expect(combatants.map(c => c.name)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3'])
  })

  it('leaves the name bare when count is 1', () => {
    const combatants = buildCombatants(encounterWith([monsterEntry('Ogre', 1)]), [])
    expect(combatants.map(c => c.name)).toEqual(['Ogre'])
  })

  it('expands several entries independently', () => {
    const combatants = buildCombatants(
      encounterWith([monsterEntry('Goblin', 2), monsterEntry('Ogre', 1)]),
      [],
    )
    expect(combatants.map(c => c.name)).toEqual(['Goblin 1', 'Goblin 2', 'Ogre'])
  })

  it('gives every copy its own id and its own HP pool', () => {
    const combatants = buildCombatants(encounterWith([monsterEntry('Goblin', 3)]), [])
    expect(new Set(combatants.map(c => c.id)).size).toBe(3)

    combatants[0].hp_current = 1
    expect(combatants[1].hp_current).toBe(7)
  })

  it('every copy points back at the same source entry', () => {
    const combatants = buildCombatants(encounterWith([monsterEntry('Goblin', 2)]), [])
    expect(combatants[0].source_entry).toBe(combatants[1].source_entry)
  })

  it('falls back to hp_max when hp_current is missing', () => {
    const entry = { id: 'e', name: 'Goblin', count: 1, hp_max: 7 }
    expect(buildCombatants(encounterWith([entry]), [])[0].hp_current).toBe(7)
  })

  it('handles an encounter with no monsters column at all', () => {
    expect(buildCombatants({}, [])).toEqual([])
  })

  it('handles an empty monster list', () => {
    expect(buildCombatants(encounterWith([]), [])).toEqual([])
  })
})

describe('buildCombatants — player characters', () => {
  it('derives initiative_mod from the DEX score', () => {
    const combatants = buildCombatants(encounterWith([]), [
      character('Lira', { dex: 18 }),   // +4
      character('Borin', { dex: 8 }),   // -1
      character('Ash', { dex: 10 }),    //  0
    ])
    expect(combatants.map(c => c.initiative_mod)).toEqual([4, -1, 0])
  })

  it('defaults DEX to 10 when stats are missing', () => {
    const combatants = buildCombatants(encounterWith([]), [
      { id: 1, character_name: 'Nameless', hp_max: 10, hp_current: 10 },
    ])
    expect(combatants[0].initiative_mod).toBe(0)
  })

  it('flags players and links them to their character row', () => {
    const combatants = buildCombatants(encounterWith([]), [character('Lira', { id: 42 })])
    expect(combatants[0].is_player).toBe(true)
    expect(combatants[0].type).toBe('player')
    expect(combatants[0].entity_id).toBe(42)
  })

  it('flags monsters as non-players with no entity link', () => {
    const combatants = buildCombatants(encounterWith([monsterEntry('Goblin', 1)]), [])
    expect(combatants[0].is_player).toBe(false)
    expect(combatants[0].type).toBe('monster')
    expect(combatants[0].entity_id).toBeNull()
  })

  it('puts monsters before players and starts everyone inactive', () => {
    const combatants = buildCombatants(
      encounterWith([monsterEntry('Goblin', 2)]),
      [character('Lira')],
    )
    expect(combatants.map(c => c.type)).toEqual(['monster', 'monster', 'player'])
    expect(combatants.every(c => c.is_active === false)).toBe(true)
    expect(combatants.every(c => c.initiative === 0)).toBe(true)
    expect(combatants.every(c => c.concentration === false)).toBe(true)
    expect(combatants.every(c => c.conditions.length === 0)).toBe(true)
  })
})

describe('sortByInitiative', () => {
  const combatant = (name, initiative, initiative_mod) => ({ name, initiative, initiative_mod })

  it('sorts descending by initiative', () => {
    const sorted = sortByInitiative([
      combatant('Low', 5, 0),
      combatant('High', 22, 0),
      combatant('Mid', 14, 0),
    ])
    expect(sorted.map(c => c.name)).toEqual(['High', 'Mid', 'Low'])
  })

  it('breaks a tie on the higher DEX modifier', () => {
    const sorted = sortByInitiative([
      combatant('SlowHands', 15, 1),
      combatant('QuickHands', 15, 4),
    ])
    expect(sorted.map(c => c.name)).toEqual(['QuickHands', 'SlowHands'])
  })

  it('applies the DEX tiebreak within each initiative group', () => {
    const sorted = sortByInitiative([
      combatant('A', 15, 0),
      combatant('B', 20, 1),
      combatant('C', 15, 3),
      combatant('D', 20, 5),
    ])
    expect(sorted.map(c => c.name)).toEqual(['D', 'B', 'C', 'A'])
  })

  it('handles a negative DEX modifier in the tiebreak', () => {
    const sorted = sortByInitiative([
      combatant('Clumsy', 12, -2),
      combatant('Average', 12, 0),
    ])
    expect(sorted.map(c => c.name)).toEqual(['Average', 'Clumsy'])
  })

  it('does not mutate the input array', () => {
    const input = [combatant('Low', 5, 0), combatant('High', 22, 0)]
    const sorted = sortByInitiative(input)
    expect(input.map(c => c.name)).toEqual(['Low', 'High'])
    expect(sorted).not.toBe(input)
  })

  it('is a no-op on empty and single-element lists', () => {
    expect(sortByInitiative([])).toEqual([])
    expect(sortByInitiative([combatant('Solo', 10, 0)]).map(c => c.name)).toEqual(['Solo'])
  })
})

describe('nextTurn', () => {
  const roster = () => [
    { name: 'A', is_active: true },
    { name: 'B', is_active: false },
    { name: 'C', is_active: false },
  ]

  it('advances the active flag by one', () => {
    const next = nextTurn(roster(), 0)
    expect(next.map(c => c.is_active)).toEqual([false, true, false])
  })

  it('wraps from the last combatant back to the first', () => {
    const next = nextTurn(roster(), 2)
    expect(next.map(c => c.is_active)).toEqual([true, false, false])
  })

  it('completes a full round back to the start', () => {
    let list = roster()
    for (let i = 0; i < 3; i++) list = nextTurn(list, i)
    expect(list.findIndex(c => c.is_active)).toBe(0)
  })

  it('exactly one combatant is active afterwards', () => {
    expect(nextTurn(roster(), 1).filter(c => c.is_active)).toHaveLength(1)
  })

  it('does not mutate the input objects', () => {
    const list = roster()
    nextTurn(list, 0)
    expect(list[0].is_active).toBe(true)
    expect(list[1].is_active).toBe(false)
  })

  it('a single combatant stays active', () => {
    expect(nextTurn([{ name: 'Solo', is_active: true }], 0)[0].is_active).toBe(true)
  })
})

describe('CONDITIONS', () => {
  it('covers all 15 PHB conditions', () => {
    expect(CONDITIONS).toHaveLength(15)
    expect(CONDITIONS.map(c => c.name)).toEqual([
      'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled',
      'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned',
      'Prone', 'Restrained', 'Stunned', 'Unconscious',
    ])
  })

  it('every condition has a name, colour, icon and description', () => {
    for (const c of CONDITIONS) {
      expect(c.name).toBeTruthy()
      expect(c.color).toMatch(/^#[0-9A-Fa-f]{3,6}$/)
      expect(c.icon).toBeTruthy()
      expect(c.description).toBeTruthy()
    }
  })

  it('condition names are unique', () => {
    expect(new Set(CONDITIONS.map(c => c.name)).size).toBe(CONDITIONS.length)
  })

  it('getCondition looks a condition up by exact name', () => {
    expect(getCondition('Prone').icon).toBe('⬇️')
    expect(getCondition('Unconscious').name).toBe('Unconscious')
  })

  it('getCondition is case-sensitive and returns undefined for a miss', () => {
    expect(getCondition('prone')).toBeUndefined()
    expect(getCondition('Nonexistent')).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// KNOWN BUG — documented here, fixed in Phase 5.
//
// buildCombatants reads `entry.ac ?? 10` (combatUtils.js:24), but the monster
// entry it reads from is produced by createMonsterEntry (encounterUtils.js:21),
// which never writes an `ac` field. So every monster in every encounter enters
// initiative at AC 10, however armoured the stat block says it is.
//
// Same convention as encounterUtils.test.js: one passing test pinning the
// current behaviour, one `it.fails` tripwire that errors the moment it is fixed.
// ─────────────────────────────────────────────────────────────────────────────

describe('KNOWN BUG (fixed in Phase 5)', () => {
  const statBlock = {
    index: 'young-red-dragon',
    name: 'Young Red Dragon',
    challenge_rating: 10,
    hit_points: 178,
    armor_class: 18,
  }

  it('createMonsterEntry does not carry AC out of the stat block', () => {
    const entry = createMonsterEntry(statBlock, 'srd')
    expect(entry.armor_class).toBeUndefined()
    expect(entry.ac).toBeUndefined()
    // It does carry HP and XP correctly, so the omission is specific to AC.
    expect(entry.hp_max).toBe(178)
    expect(entry.xp).toBe(5900)
  })

  it('so every monster combatant is built at AC 10', () => {
    const entry = createMonsterEntry(statBlock, 'srd')
    const combatants = buildCombatants(encounterWith([entry]), [])
    expect(combatants[0].ac).toBe(10)
  })

  it.fails('a monster should enter combat with the AC on its stat block', () => {
    const entry = createMonsterEntry(statBlock, 'srd')
    const combatants = buildCombatants(encounterWith([entry]), [])
    expect(combatants[0].ac).toBe(18)
  })

  it('buildCombatants does honour an ac field when one is present', () => {
    // The reader is not broken — nothing upstream ever populates the field.
    const combatants = buildCombatants(
      encounterWith([monsterEntry('Armoured Goblin', 1, { ac: 16 })]),
      [],
    )
    expect(combatants[0].ac).toBe(16)
  })

  test.todo('Phase 5: createMonsterEntry should write ac from statBlock.armor_class')

  // Related, same root area: player AC is 10 + dexMod, ignoring armour entirely.
  it('player AC currently ignores armour and is 10 + DEX mod', () => {
    const combatants = buildCombatants(encounterWith([]), [character('Plate Knight', { dex: 8 })])
    expect(combatants[0].ac).toBe(9)
  })

  test.todo('Phase 5: player AC should come from equipped armour, not 10 + DEX')
})
