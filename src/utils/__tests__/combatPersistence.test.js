import { describe, it, expect } from 'vitest'
import {
  COMBAT_SCHEMA_VERSION,
  normaliseDeathSaves,
  normaliseCombatant,
  serialiseCombat,
  deserialiseCombat,
  combatPayloadChanged,
  describeSavedCombat,
} from '../combatPersistence.js'

const combatant = (over = {}) => ({
  id: 'c1', name: 'Goblin 1', type: 'monster',
  initiative: 14, initiative_mod: 2,
  hp_max: 7, hp_current: 7, ac: 15,
  conditions: [], concentration: false, is_active: false,
  is_player: false, entity_id: null,
  ...over,
})

const liveState = (over = {}) => ({
  campaignId: 3,
  encounterId: 9,
  combatants: [combatant(), combatant({ id: 'c2', name: 'Vex', type: 'player', is_player: true, entity_id: 42 })],
  round: 2,
  phase: 'active',
  log: ['Round 1 begins.', 'Goblin 1 takes 4 damage.'],
  ...over,
})

describe('normaliseDeathSaves', () => {
  it('passes valid counts through', () => {
    expect(normaliseDeathSaves({ successes: 2, failures: 1 })).toEqual({ successes: 2, failures: 1 })
  })

  it('clamps to the 0-3 the rules allow', () => {
    expect(normaliseDeathSaves({ successes: 9, failures: -4 })).toEqual({ successes: 3, failures: 0 })
  })

  it('defaults anything unusable to zero', () => {
    for (const bad of [null, undefined, 'x', 42, [], { successes: 'a' }]) {
      expect(normaliseDeathSaves(bad)).toEqual({ successes: 0, failures: 0 })
    }
  })
})

describe('normaliseCombatant', () => {
  it('fills in every Phase 5 field a pre-Phase-5 combatant lacks', () => {
    const old = combatant()
    const c = normaliseCombatant(old)
    expect(c.temp_hp).toBe(0)
    expect(c.reaction_used).toBe(false)
    expect(c.death_saves).toEqual({ successes: 0, failures: 0 })
    expect(c.legendary_max).toBe(0)
    expect(c.legendary_used).toBe(0)
    expect(c.lair_action_text).toBeNull()
  })

  it('does not overwrite values that are present', () => {
    const c = normaliseCombatant(combatant({
      temp_hp: 5, reaction_used: true, legendary_max: 3, legendary_used: 1,
      death_saves: { successes: 2, failures: 1 }, lair_action_text: 'The ground shakes.',
    }))
    expect(c.temp_hp).toBe(5)
    expect(c.reaction_used).toBe(true)
    expect(c.legendary_max).toBe(3)
    expect(c.legendary_used).toBe(1)
    expect(c.death_saves).toEqual({ successes: 2, failures: 1 })
    expect(c.lair_action_text).toBe('The ground shakes.')
  })

  it('never lets legendary_used exceed legendary_max', () => {
    expect(normaliseCombatant(combatant({ legendary_max: 3, legendary_used: 7 })).legendary_used).toBe(3)
    expect(normaliseCombatant(combatant({ legendary_max: 0, legendary_used: 2 })).legendary_used).toBe(0)
  })

  it('gives each combatant its OWN defaults, not a shared reference', () => {
    // The bug this guards: a single shared [] or {} means damaging one goblin
    // conditions-tags every goblin.
    const a = normaliseCombatant(combatant({ id: 'a' }))
    const b = normaliseCombatant(combatant({ id: 'b' }))
    a.conditions.push('Prone')
    a.death_saves.successes = 2
    expect(b.conditions).toEqual([])
    expect(b.death_saves.successes).toBe(0)
  })

  it('drops non-string conditions rather than rendering [object Object]', () => {
    expect(normaliseCombatant(combatant({ conditions: ['Prone', 42, null, { name: 'x' }] })).conditions)
      .toEqual(['Prone'])
  })

  it('defaults hp_current to hp_max when absent, and keeps 0', () => {
    expect(normaliseCombatant(combatant({ hp_current: undefined, hp_max: 12 })).hp_current).toBe(12)
    expect(normaliseCombatant(combatant({ hp_current: 0 })).hp_current).toBe(0)
  })

  it('allows negative hp_current — some tables track it', () => {
    expect(normaliseCombatant(combatant({ hp_current: -3 })).hp_current).toBe(-3)
  })

  it('defaults ac to 10 when missing', () => {
    const { ac, ...noAc } = combatant()
    expect(normaliseCombatant(noAc).ac).toBe(10)
  })

  it('treats a blank lair action as none', () => {
    expect(normaliseCombatant(combatant({ lair_action_text: '   ' })).lair_action_text).toBeNull()
    expect(normaliseCombatant(combatant({ lair_action_text: 42 })).lair_action_text).toBeNull()
  })

  it('returns null for something that is not a combatant', () => {
    for (const bad of [null, undefined, 'x', 7, []]) expect(normaliseCombatant(bad)).toBeNull()
  })
})

describe('serialiseCombat', () => {
  it('produces the row shape the handler expects', () => {
    const row = serialiseCombat(liveState())
    expect(row.campaign_id).toBe(3)
    expect(row.encounter_id).toBe(9)
    expect(row.round_count).toBe(2)
    expect(row.phase).toBe('active')
    expect(typeof row.combatants).toBe('string')
    expect(typeof row.log_entries).toBe('string')
  })

  it('stamps the schema version into both blobs', () => {
    const row = serialiseCombat(liveState())
    expect(JSON.parse(row.combatants).schema_version).toBe(COMBAT_SCHEMA_VERSION)
    expect(JSON.parse(row.log_entries).schema_version).toBe(COMBAT_SCHEMA_VERSION)
  })

  it('rejects an invalid phase rather than writing it', () => {
    // The column has a CHECK; failing here beats a constraint error mid-combat.
    expect(serialiseCombat(liveState({ phase: 'nonsense' })).phase).toBe('setup')
  })

  it('floors the round at 1', () => {
    expect(serialiseCombat(liveState({ round: 0 })).round_count).toBe(1)
    expect(serialiseCombat(liveState({ round: -5 })).round_count).toBe(1)
  })

  it('caps the log so a long fight cannot grow the row without bound', () => {
    const long = Array.from({ length: 900 }, (_, i) => `entry ${i}`)
    expect(JSON.parse(serialiseCombat(liveState({ log: long })).log_entries).entries).toHaveLength(500)
  })

  it('survives a combatant array containing junk', () => {
    const row = serialiseCombat(liveState({ combatants: [combatant(), null, 'x', undefined] }))
    expect(JSON.parse(row.combatants).combatants).toHaveLength(1)
  })

  it('handles an empty fight', () => {
    const row = serialiseCombat(liveState({ combatants: [], log: [] }))
    expect(JSON.parse(row.combatants).combatants).toEqual([])
  })
})

describe('deserialiseCombat — the crash-recovery path', () => {
  const savedRow = (over = {}) => {
    const row = serialiseCombat(liveState())
    return { ...row, round_count: row.round_count, phase: row.phase, ...over }
  }

  it('round-trips a fight exactly', () => {
    const before = liveState()
    const restored = deserialiseCombat(savedRow())
    expect(restored.round).toBe(before.round)
    expect(restored.phase).toBe(before.phase)
    expect(restored.log).toEqual(before.log)
    expect(restored.combatants.map(c => c.name)).toEqual(['Goblin 1', 'Vex'])
  })

  it('restores HP, conditions and concentration as they were', () => {
    const wounded = liveState({
      combatants: [combatant({ hp_current: 2, conditions: ['Prone', 'Poisoned'], concentration: true })],
    })
    const restored = deserialiseCombat(serialiseCombat(wounded))
    expect(restored.combatants[0].hp_current).toBe(2)
    expect(restored.combatants[0].conditions).toEqual(['Prone', 'Poisoned'])
    expect(restored.combatants[0].concentration).toBe(true)
  })

  it('reports no upgrade needed for a current-version save', () => {
    expect(deserialiseCombat(savedRow()).upgradedFrom).toBeNull()
  })

  it('accepts a bare array — a save written before versioning existed', () => {
    const legacy = {
      round_count: 4, phase: 'active',
      combatants: JSON.stringify([combatant({ hp_current: 3 })]),
      log_entries: JSON.stringify(['old entry']),
    }
    const restored = deserialiseCombat(legacy)
    expect(restored.combatants[0].hp_current).toBe(3)
    expect(restored.log).toEqual(['old entry'])
    // Signals the caller to re-save in the new format, so the upgrade happens once.
    expect(restored.upgradedFrom).toBe(0)
  })

  it('backfills Phase 5 fields onto a legacy save', () => {
    const legacy = {
      round_count: 1, phase: 'active',
      combatants: JSON.stringify([combatant()]),
      log_entries: '[]',
    }
    const c = deserialiseCombat(legacy).combatants[0]
    expect(c.temp_hp).toBe(0)
    expect(c.death_saves).toEqual({ successes: 0, failures: 0 })
    expect(c.reaction_used).toBe(false)
  })

  it('returns null rather than crashing on a corrupt blob', () => {
    // A corrupt save should start a fresh fight, not break the one screen a DM
    // needs mid-session.
    for (const bad of ['{not json', 'null', '"a string"', '{}', '[]']) {
      expect(deserialiseCombat({ round_count: 1, phase: 'active', combatants: bad, log_entries: '[]' }))
        .toBeNull()
    }
  })

  it('returns null for a missing row', () => {
    expect(deserialiseCombat(null)).toBeNull()
    expect(deserialiseCombat(undefined)).toBeNull()
  })

  it('returns null when every combatant is junk', () => {
    expect(deserialiseCombat({
      round_count: 1, phase: 'active',
      combatants: JSON.stringify({ schema_version: 1, combatants: [null, 'x'] }),
      log_entries: '[]',
    })).toBeNull()
  })

  it('recovers a fight even when the log blob is corrupt', () => {
    // Losing the log is survivable; losing the combatants is not.
    const row = { ...serialiseCombat(liveState()), log_entries: '{broken' }
    const restored = deserialiseCombat(row)
    expect(restored.combatants).toHaveLength(2)
    expect(restored.log).toEqual([])
  })

  it('falls back to setup for an unrecognised phase', () => {
    expect(deserialiseCombat({ ...serialiseCombat(liveState()), phase: 'nonsense' }).phase).toBe('setup')
  })
})

describe('combatPayloadChanged', () => {
  it('detects a real change', () => {
    const a = serialiseCombat(liveState())
    const b = serialiseCombat(liveState({ round: 3 }))
    const first = combatPayloadChanged(null, a)
    expect(first.changed).toBe(true)
    expect(combatPayloadChanged(first.key, b).changed).toBe(true)
  })

  it('ignores a re-render that changed nothing', () => {
    // React hands out new array identities constantly; without this the tracker
    // would rewrite the row on every render.
    const a = serialiseCombat(liveState())
    const key = combatPayloadChanged(null, a).key
    const identical = serialiseCombat(liveState())
    expect(combatPayloadChanged(key, identical).changed).toBe(false)
  })

  it('notices a single point of damage', () => {
    const a = serialiseCombat(liveState())
    const key = combatPayloadChanged(null, a).key
    const damaged = serialiseCombat(liveState({
      combatants: [combatant({ hp_current: 6 }), combatant({ id: 'c2', name: 'Vex', type: 'player', is_player: true, entity_id: 42 })],
    }))
    expect(combatPayloadChanged(key, damaged).changed).toBe(true)
  })
})

describe('describeSavedCombat', () => {
  it('summarises a saved fight for the resume link', () => {
    const row = { ...serialiseCombat(liveState()), encounter_id: 9, encounter_name: 'Dock Ambush' }
    const d = describeSavedCombat(row)
    expect(d.label).toBe('Resume combat (round 2)')
    expect(d.encounterName).toBe('Dock Ambush')
    expect(d.combatants).toBe(2)
    expect(d.living).toBe(2)
  })

  it('counts only living combatants', () => {
    const row = serialiseCombat(liveState({
      combatants: [combatant({ hp_current: 0 }), combatant({ id: 'c2', hp_current: 5 })],
    }))
    expect(describeSavedCombat(row).living).toBe(1)
  })

  it('returns null for nothing to resume', () => {
    expect(describeSavedCombat(null)).toBeNull()
    expect(describeSavedCombat({ combatants: '[]', log_entries: '[]', round_count: 1, phase: 'setup' })).toBeNull()
  })
})
