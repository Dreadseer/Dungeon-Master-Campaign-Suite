import { describe, it, expect } from 'vitest'
import {
  rollInitiative,
  buildCombatants,
  sortByInitiative,
  nextTurn,
  CONDITIONS,
  getCondition,
} from '../combatUtils.js'
import { createMonsterEntry, parseArmorClass } from '../encounterUtils.js'

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

describe('buildCombatants — per-instance HP (Phase 7 task 3)', () => {
  it('gives each copy its OWN hit points', () => {
    // This used to be `entry.hp_current ?? entry.hp_max` for every copy, so
    // three goblins shared one total and damaging one damaged all of them.
    const entry = { ...monsterEntry('Goblin', 3), hp_max: 7, instances: [
      { hp_current: 7 }, { hp_current: 3 }, { hp_current: 0 },
    ] }
    const combatants = buildCombatants(encounterWith([entry]), [])
    expect(combatants.map(c => c.hp_current)).toEqual([7, 3, 0])
  })

  it('migrates a pre-Phase-7 entry, seeding every copy from its single value', () => {
    const legacy = { ...monsterEntry('Goblin', 3), hp_max: 7, hp_current: 4 }
    delete legacy.instances
    const combatants = buildCombatants(encounterWith([legacy]), [])
    expect(combatants.map(c => c.hp_current)).toEqual([4, 4, 4])
  })

  it('tags each combatant with the entry and copy it came from', () => {
    // applyCombatantHp maps by these on the way back. Position cannot be used:
    // the tracker sorts by initiative and moves the defeated to the end.
    const entry = { ...monsterEntry('Goblin', 2), id: 'entry-1' }
    const combatants = buildCombatants(encounterWith([entry]), [])
    expect(combatants.map(c => c.entry_id)).toEqual(['entry-1', 'entry-1'])
    expect(combatants.map(c => c.instance_index)).toEqual([0, 1])
  })

  it('survives a corrupt monsters blob rather than blanking the tracker', () => {
    expect(() => buildCombatants({ monsters: '{not json' }, [])).not.toThrow()
    expect(buildCombatants({ monsters: '{not json' }, [])).toEqual([])
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
// FIXED IN PHASE 5 — this was an `it.fails` tripwire from Phase 0 onward.
// The tripwire did its job: it began erroring the moment the fix landed.
// ─────────────────────────────────────────────────────────────────────────────

describe('monster AC (fixed in Phase 5)', () => {
  const statBlock = {
    index: 'young-red-dragon', name: 'Young Red Dragon',
    challenge_rating: 10, hit_points: 178, armor_class: 18,
  }

  it('createMonsterEntry carries AC out of the stat block', () => {
    expect(createMonsterEntry(statBlock, 'srd').ac).toBe(18)
  })

  it('a monster enters combat with the AC on its stat block, not 10', () => {
    const entry = createMonsterEntry(statBlock, 'srd')
    expect(buildCombatants(encounterWith([entry]), [])[0].ac).toBe(18)
  })

  it('a goblin shows AC 15', () => {
    // The acceptance line, in the shape the SRD actually stores it.
    const goblin = { index: 'goblin', name: 'Goblin', challenge_rating: 0.25, hit_points: 7,
                     armor_class: [{ type: 'armor', value: 15 }] }
    const entry = createMonsterEntry(goblin, 'srd')
    expect(entry.ac).toBe(15)
    expect(buildCombatants(encounterWith([entry]), [])[0].ac).toBe(15)
  })

  it('reads the array shape the newer cache uses, taking the first entry', () => {
    expect(parseArmorClass([{ type: 'natural', value: 17 }, { type: 'armor', value: 20 }])).toBe(17)
  })

  it('reads a bare number, the older cache shape', () => {
    expect(parseArmorClass(13)).toBe(13)
  })

  it('returns null when the stat block has no AC, so a lookup can fill it in', () => {
    for (const bad of [null, undefined, '', [], {}, 'abc']) {
      expect(parseArmorClass(bad)).toBeNull()
    }
  })

  it('an entry saved BEFORE Phase 5 gets its AC looked up on load', () => {
    // Pre-Phase-5 encounter JSON has no `ac` field at all. Rather than
    // defaulting it to 10 forever, buildCombatants looks the stat block up by
    // the source_index the entry already carries.
    const legacy = { id: 'e1', name: 'Goblin', count: 1, hp_max: 7, source_index: 'goblin' }
    const withLookup = buildCombatants(encounterWith([legacy]), [], {
      acLookup: (index) => (index === 'goblin' ? 15 : null),
    })
    expect(withLookup[0].ac).toBe(15)
  })

  it('falls back to 10 only when the lookup also fails', () => {
    const legacy = { id: 'e1', name: 'Homebrew Thing', count: 1, hp_max: 20, source_index: 'unknown' }
    expect(buildCombatants(encounterWith([legacy]), [], { acLookup: () => null })[0].ac).toBe(10)
    expect(buildCombatants(encounterWith([legacy]), [])[0].ac).toBe(10)
  })
})

describe('player AC (fixed in Phase 5)', () => {
  it('uses the armour the character is wearing, not 10 + DEX', () => {
    // Chain mail is AC 16 flat. The old formula gave 10 + dexMod = 9 for a
    // DEX 8 fighter, which is worse than wearing nothing.
    const fighter = {
      id: 1, character_name: 'Plate Knight', hp_max: 40, hp_current: 40,
      stats: JSON.stringify({ dex: 8 }),
      inventory: JSON.stringify([{ name: 'Chain Mail', equipped: true }]),
    }
    const ac = buildCombatants(encounterWith([]), [fighter])[0].ac
    expect(ac).toBeGreaterThan(9)
  })

  it('honours a manual AC override from the sheet', () => {
    const char = {
      id: 2, character_name: 'Override', hp_max: 10, hp_current: 10,
      stats: JSON.stringify({ dex: 14, ac_override: 21 }), inventory: '[]',
    }
    expect(buildCombatants(encounterWith([]), [char])[0].ac).toBe(21)
  })

  it('still produces a usable AC when the inventory is malformed', () => {
    // A broken inventory should cost this character its armour bonus, not stop
    // the fight from starting.
    const char = {
      id: 3, character_name: 'Broken Bag', hp_max: 10, hp_current: 10,
      stats: JSON.stringify({ dex: 14 }), inventory: '{not json',
    }
    const c = buildCombatants(encounterWith([]), [char])[0]
    expect(Number.isFinite(c.ac)).toBe(true)
    expect(c.ac).toBeGreaterThanOrEqual(10)
  })

  it('carries existing death saves in from the character sheet', () => {
    const dying = {
      id: 4, character_name: 'Bleeding Out', hp_max: 20, hp_current: 0,
      stats: JSON.stringify({ dex: 12, death_saves: { successes: 1, failures: 2 } }),
      inventory: '[]',
    }
    expect(buildCombatants(encounterWith([]), [dying])[0].death_saves)
      .toEqual({ successes: 1, failures: 2 })
  })
})

describe('Phase 5 combatant fields', () => {
  const goblin = { id: 'e', name: 'Goblin', count: 2, hp_max: 7, ac: 15 }

  it('every combatant starts with the new fields', () => {
    for (const c of buildCombatants(encounterWith([goblin]), [])) {
      expect(c.temp_hp).toBe(0)
      expect(c.reaction_used).toBe(false)
      expect(c.death_saves).toEqual({ successes: 0, failures: 0 })
      expect(c.legendary_used).toBe(0)
    }
  })

  it('legendary_max comes from the entry', () => {
    const dragon = { id: 'd', name: 'Adult Red Dragon', count: 1, hp_max: 256, ac: 19, legendary_max: 3 }
    expect(buildCombatants(encounterWith([dragon]), [])[0].legendary_max).toBe(3)
  })

  it('createMonsterEntry sets legendary_max from the stat block', () => {
    const withLegendary = createMonsterEntry({
      name: 'Ancient Dragon', challenge_rating: 24, hit_points: 546, armor_class: 22,
      legendary_actions: [{ name: 'Detect' }, { name: 'Tail Attack' }, { name: 'Wing Attack' }],
    }, 'srd')
    expect(withLegendary.legendary_max).toBe(3)
  })

  it('a creature without legendary actions gets 0', () => {
    expect(createMonsterEntry({ name: 'Goblin', challenge_rating: 0.25, hit_points: 7 }, 'srd').legendary_max).toBe(0)
  })

  it('each combatant gets its OWN death_saves object', () => {
    const [a, b] = buildCombatants(encounterWith([goblin]), [])
    a.death_saves.failures = 2
    expect(b.death_saves.failures).toBe(0)
  })
})
