import { describe, it, expect } from 'vitest'
import {
  withInstances, normaliseMonsters, instanceHp,
  applyCombatantHp, resetInstances, livingCount, describeWounded,
} from '../monsterInstances.js'

/** An entry as written before Phase 7: one hp_current for the whole type. */
const legacy = (over = {}) => ({
  id: 'm1', name: 'Goblin', source: 'srd', source_index: 'goblin',
  cr: 0.25, xp: 50, hp_max: 7, hp_current: 7, count: 3, ...over,
})

describe('withInstances — the lazy migration', () => {
  it('gives a pre-Phase-7 entry one instance per copy', () => {
    const out = withInstances(legacy())
    expect(out.instances).toHaveLength(3)
    expect(out.instances.every(i => i.hp_current === 7)).toBe(true)
  })

  it('seeds every copy from the entry HP the DM had set, not from full', () => {
    // An entry saved at 4 HP meant "these goblins are hurt". Resetting them to
    // 7 on migration would silently heal them.
    const out = withInstances(legacy({ hp_current: 4 }))
    expect(out.instances.map(i => i.hp_current)).toEqual([4, 4, 4])
  })

  it('leaves an already-migrated entry alone', () => {
    const entry = { ...legacy(), instances: [{ hp_current: 7 }, { hp_current: 2 }, { hp_current: 0 }] }
    expect(withInstances(entry).instances.map(i => i.hp_current)).toEqual([7, 2, 0])
  })

  it('raising the count adds new copies at FULL health', () => {
    const entry = { ...legacy(), count: 5, instances: [{ hp_current: 1 }, { hp_current: 2 }, { hp_current: 3 }] }
    expect(withInstances(entry).instances.map(i => i.hp_current)).toEqual([1, 2, 3, 7, 7])
  })

  it('lowering the count drops from the END, so survivors keep their HP', () => {
    // Truncating from the front would silently renumber which goblin was hurt.
    const entry = { ...legacy(), count: 2, instances: [{ hp_current: 1 }, { hp_current: 2 }, { hp_current: 3 }] }
    expect(withInstances(entry).instances.map(i => i.hp_current)).toEqual([1, 2])
  })

  it('clamps a stored value above hp_max', () => {
    const entry = { ...legacy(), count: 1, hp_max: 7, instances: [{ hp_current: 99 }] }
    expect(withInstances(entry).instances[0].hp_current).toBe(7)
  })

  it('clamps a negative stored value to zero', () => {
    const entry = { ...legacy(), count: 1, instances: [{ hp_current: -12 }] }
    expect(withInstances(entry).instances[0].hp_current).toBe(0)
  })

  it('keeps zero — a dead monster is not a missing value', () => {
    const entry = { ...legacy(), count: 2, instances: [{ hp_current: 0 }, { hp_current: 7 }] }
    expect(withInstances(entry).instances.map(i => i.hp_current)).toEqual([0, 7])
  })

  it('treats a missing or zero count as one copy', () => {
    expect(withInstances(legacy({ count: 0 })).instances).toHaveLength(1)
    expect(withInstances(legacy({ count: undefined })).instances).toHaveLength(1)
  })

  it('never mutates the entry it was given', () => {
    const entry = legacy()
    const snapshot = JSON.stringify(entry)
    withInstances(entry)
    expect(JSON.stringify(entry)).toBe(snapshot)
  })

  it('survives an entry with no HP fields at all', () => {
    const out = withInstances({ id: 'x', name: 'Mystery', count: 2 })
    expect(out.instances).toHaveLength(2)
    expect(out.instances.every(i => i.hp_current >= 0)).toBe(true)
  })

  it('passes nullish through rather than throwing', () => {
    expect(withInstances(null)).toBeNull()
    expect(withInstances('nope')).toBe('nope')
  })
})

describe('normaliseMonsters', () => {
  it('parses the JSON string straight off the row', () => {
    expect(normaliseMonsters(JSON.stringify([legacy()]))[0].instances).toHaveLength(3)
  })

  it('accepts an already-parsed array', () => {
    expect(normaliseMonsters([legacy()])).toHaveLength(1)
  })

  it('returns empty for a corrupt blob rather than throwing mid-session', () => {
    expect(normaliseMonsters('{not json')).toEqual([])
  })

  it('returns empty for nullish', () => {
    expect(normaliseMonsters(null)).toEqual([])
    expect(normaliseMonsters(undefined)).toEqual([])
  })

  it('drops junk entries but keeps the good ones', () => {
    expect(normaliseMonsters([legacy(), null, 'nope', 42])).toHaveLength(1)
  })
})

describe('instanceHp', () => {
  it('reads the i-th copy', () => {
    const entry = { ...legacy(), instances: [{ hp_current: 7 }, { hp_current: 3 }, { hp_current: 0 }] }
    expect(instanceHp(entry, 1)).toBe(3)
    expect(instanceHp(entry, 2)).toBe(0)
  })

  it('falls back to full HP for an out-of-range index', () => {
    expect(instanceHp(legacy(), 99)).toBe(7)
  })
})

describe('applyCombatantHp — the round trip', () => {
  const combatant = (over = {}) => ({
    entry_id: 'm1', instance_index: 0, hp_current: 7, is_player: false, ...over,
  })

  it('writes tracker HP back to the right copy', () => {
    const { monsters, changed } = applyCombatantHp([legacy()], [
      combatant({ instance_index: 0, hp_current: 7 }),
      combatant({ instance_index: 1, hp_current: 2 }),
      combatant({ instance_index: 2, hp_current: 0 }),
    ])
    expect(changed).toBe(true)
    expect(monsters[0].instances.map(i => i.hp_current)).toEqual([7, 2, 0])
  })

  it('maps by id and index, not by position', () => {
    // The tracker sorts by initiative and pushes the defeated to the end, so
    // positional mapping would write the wrong goblin's HP.
    const { monsters } = applyCombatantHp([legacy()], [
      combatant({ instance_index: 2, hp_current: 1 }),
      combatant({ instance_index: 0, hp_current: 5 }),
    ])
    expect(monsters[0].instances.map(i => i.hp_current)).toEqual([5, 7, 1])
  })

  it('ignores players — their HP goes to the characters table', () => {
    const { monsters, changed } = applyCombatantHp([legacy()], [
      combatant({ is_player: true, hp_current: 1 }),
    ])
    expect(changed).toBe(false)
    expect(monsters[0].instances.every(i => i.hp_current === 7)).toBe(true)
  })

  it('ignores a combatant whose entry no longer exists', () => {
    const { changed } = applyCombatantHp([legacy()], [combatant({ entry_id: 'gone' })])
    expect(changed).toBe(false)
  })

  it('ignores an out-of-range instance index', () => {
    const { changed } = applyCombatantHp([legacy()], [combatant({ instance_index: 9 })])
    expect(changed).toBe(false)
  })

  it('clamps an absurd tracker value into range', () => {
    const { monsters } = applyCombatantHp([legacy()], [
      combatant({ instance_index: 0, hp_current: -50 }),
      combatant({ instance_index: 1, hp_current: 999 }),
    ])
    expect(monsters[0].instances[0].hp_current).toBe(0)
    expect(monsters[0].instances[1].hp_current).toBe(7)
  })

  it('reports changed:false when nothing actually differs', () => {
    const { changed } = applyCombatantHp([legacy()], [combatant({ hp_current: 7 })])
    expect(changed).toBe(false)
  })

  it('handles an empty or nullish combatant list', () => {
    expect(applyCombatantHp([legacy()], []).changed).toBe(false)
    expect(applyCombatantHp([legacy()], null).changed).toBe(false)
  })

  it('handles no monsters', () => {
    expect(applyCombatantHp([], [combatant()]).monsters).toEqual([])
  })

  // The acceptance property: damage survives a save/reload cycle.
  it('HP survives a full round trip through JSON', () => {
    const { monsters } = applyCombatantHp([legacy()], [
      combatant({ instance_index: 1, hp_current: 2 }),
    ])
    const reloaded = normaliseMonsters(JSON.stringify(monsters))
    expect(reloaded[0].instances.map(i => i.hp_current)).toEqual([7, 2, 7])
  })
})

describe('resetInstances', () => {
  it('heals every copy to full', () => {
    const wounded = [{ ...legacy(), instances: [{ hp_current: 0 }, { hp_current: 1 }, { hp_current: 2 }] }]
    expect(resetInstances(wounded)[0].instances.map(i => i.hp_current)).toEqual([7, 7, 7])
  })

  it('handles an empty list', () => {
    expect(resetInstances([])).toEqual([])
  })
})

describe('livingCount', () => {
  it('counts copies above zero', () => {
    const entry = { ...legacy(), instances: [{ hp_current: 0 }, { hp_current: 1 }, { hp_current: 7 }] }
    expect(livingCount(entry)).toBe(2)
  })

  it('counts every copy of an untouched entry', () => {
    expect(livingCount(legacy())).toBe(3)
  })
})

describe('describeWounded', () => {
  it('is silent when nothing is hurt — a list of "4/4" everywhere is noise', () => {
    expect(describeWounded([legacy()])).toBe('')
  })

  it('reports how many are standing once something is down', () => {
    const wounded = [{ ...legacy(), instances: [{ hp_current: 0 }, { hp_current: 7 }, { hp_current: 7 }] }]
    expect(describeWounded(wounded)).toBe('2/3 standing')
  })

  it('counts across several entries', () => {
    const mixed = [
      { ...legacy(), count: 2, instances: [{ hp_current: 0 }, { hp_current: 7 }] },
      { ...legacy(), id: 'm2', name: 'Orc', count: 1, hp_max: 15, instances: [{ hp_current: 0 }] },
    ]
    expect(describeWounded(mixed)).toBe('1/3 standing')
  })

  it('is silent for an empty encounter', () => {
    expect(describeWounded([])).toBe('')
    expect(describeWounded(null)).toBe('')
  })
})
