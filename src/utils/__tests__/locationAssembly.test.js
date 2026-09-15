import { describe, it, expect } from 'vitest'
import {
  matchStatBlock, npcEncounterEntry, figuresAtLocation, entryXp,
  nameKey, PLACEHOLDER_HP, PLACEHOLDER_AC,
} from '../locationAssembly.js'

const npc = (over = {}) => ({
  id: 1, campaign_id: 1, name: 'Anders Solmor', race: 'Human', class: 'Noble',
  role: 'Town councillor', location_id: 10, faction_id: null, is_alive: 1, ...over,
})

const block = (name, over = {}) => ({
  index: name.toLowerCase().replace(/\s+/g, '-'),
  name, challenge_rating: 2, hit_points: 33, armor_class: 15, ...over,
})

describe('matchStatBlock', () => {
  it('matches a stat block by name', () => {
    const m = matchStatBlock(npc({ name: 'Bandit Captain' }), { srd: [block('Bandit Captain')] })
    expect(m.source).toBe('srd')
    expect(m.block.name).toBe('Bandit Captain')
  })

  it('ignores case and spacing', () => {
    expect(matchStatBlock(npc({ name: '  bandit   CAPTAIN ' }), { srd: [block('Bandit Captain')] }))
      .not.toBeNull()
  })

  it('prefers homebrew over SRD — the DM wrote theirs for a reason', () => {
    const m = matchStatBlock(npc({ name: 'Gellan' }), {
      homebrew: [block('Gellan', { hit_points: 99 })],
      srd: [block('Gellan', { hit_points: 1 })],
    })
    expect(m.source).toBe('homebrew')
    expect(m.block.hit_points).toBe(99)
  })

  it('returns null when nothing matches', () => {
    expect(matchStatBlock(npc(), { srd: [block('Goblin')] })).toBeNull()
  })

  it('returns null for an NPC with no name', () => {
    expect(matchStatBlock({ id: 1, name: '' }, { srd: [block('Goblin')] })).toBeNull()
  })

  it('handles missing lists', () => {
    expect(matchStatBlock(npc())).toBeNull()
    expect(matchStatBlock(null, {})).toBeNull()
  })
})

describe('npcEncounterEntry — with a stat block', () => {
  const match = { block: block('Bandit Captain'), source: 'srd' }

  it('keeps the DM\'s name, not the stat block\'s', () => {
    // "Captain Xendros" must not become "Bandit Captain" in the tracker.
    const entry = npcEncounterEntry(npc({ name: 'Captain Xendros' }), match)
    expect(entry.name).toBe('Captain Xendros')
  })

  it('takes HP, AC and XP from the block', () => {
    const entry = npcEncounterEntry(npc(), match)
    expect(entry.hp_max).toBe(33)
    expect(entry.ac).toBe(15)
    expect(entry.xp).toBe(450)   // CR 2
  })

  it('records which block it came from, so the DM can see the source', () => {
    const entry = npcEncounterEntry(npc(), match)
    expect(entry.stat_source).toBe('srd')
    expect(entry.stat_block_index).toBe('bandit-captain')
  })

  it('is marked source: npc, as the brief specifies', () => {
    expect(npcEncounterEntry(npc(), match).source).toBe('npc')
  })

  it('links back to the NPC record', () => {
    expect(npcEncounterEntry(npc({ id: 42 }), match).entity_id).toBe(42)
  })

  it('is not flagged as needing stats', () => {
    expect(npcEncounterEntry(npc(), match).needs_stats).toBe(false)
  })
})

describe('npcEncounterEntry — without a stat block', () => {
  it('uses visible placeholder HP and AC', () => {
    const entry = npcEncounterEntry(npc())
    expect(entry.hp_max).toBe(PLACEHOLDER_HP)
    expect(entry.ac).toBe(PLACEHOLDER_AC)
  })

  it('is flagged so the UI can say the numbers are placeholders', () => {
    // Presenting 11 HP as though it were researched would be worse than saying
    // nothing.
    expect(npcEncounterEntry(npc()).needs_stats).toBe(true)
  })

  it('contributes ZERO XP — no CR means no number anyone chose', () => {
    const entry = npcEncounterEntry(npc())
    expect(entry.xp).toBe(0)
    expect(entry.cr).toBeNull()
  })

  it('carries the role and race as notes, so the row is not anonymous', () => {
    expect(npcEncounterEntry(npc()).notes).toBe('Town councillor · Human')
  })

  it('counts as one', () => {
    expect(npcEncounterEntry(npc()).count).toBe(1)
  })

  it('handles an NPC with no name at all', () => {
    expect(npcEncounterEntry({ id: 1 }).name).toBe('Unnamed NPC')
  })

  it('handles being given nothing', () => {
    expect(() => npcEncounterEntry(null)).not.toThrow()
  })
})

describe('figuresAtLocation', () => {
  const here = [npc({ id: 1, name: 'Anders' }), npc({ id: 2, name: 'Gellan' })]
  const all = [...here, npc({ id: 3, name: 'Visiting Agent', location_id: 99 })]

  it('offers the NPCs filed at the location', () => {
    const out = figuresAtLocation({ locationId: 10, npcsHere: here })
    expect(out.map(f => f.npc.name)).toEqual(['Anders', 'Gellan'])
    expect(out.every(f => f.via === 'here')).toBe(true)
  })

  it('brings in NPCs CONNECTED to the location but filed elsewhere', () => {
    const out = figuresAtLocation({
      locationId: 10, npcsHere: here, allNpcs: all,
      connections: [{ entity_a_type: 'npc', entity_a_id: 3, entity_b_type: 'location', entity_b_id: 10, relationship: 'operates in' }],
    })
    expect(out.map(f => f.npc.name)).toContain('Visiting Agent')
    expect(out.find(f => f.npc.id === 3).via).toBe('operates in')
  })

  it('reads a connection with the location on either side', () => {
    const out = figuresAtLocation({
      locationId: 10, allNpcs: all,
      connections: [{ entity_a_type: 'location', entity_a_id: 10, entity_b_type: 'npc', entity_b_id: 3 }],
    })
    expect(out).toHaveLength(1)
  })

  it('ignores connections to a different location', () => {
    const out = figuresAtLocation({
      locationId: 10, allNpcs: all,
      connections: [{ entity_a_type: 'npc', entity_a_id: 3, entity_b_type: 'location', entity_b_id: 77 }],
    })
    expect(out).toEqual([])
  })

  it('ignores connections between two non-locations', () => {
    const out = figuresAtLocation({
      locationId: 10, allNpcs: all,
      connections: [{ entity_a_type: 'npc', entity_a_id: 3, entity_b_type: 'faction', entity_b_id: 1 }],
    })
    expect(out).toEqual([])
  })

  it('never offers the same NPC twice', () => {
    const out = figuresAtLocation({
      locationId: 10, npcsHere: here, allNpcs: all,
      connections: [{ entity_a_type: 'npc', entity_a_id: 1, entity_b_type: 'location', entity_b_id: 10 }],
    })
    expect(out.filter(f => f.npc.id === 1)).toHaveLength(1)
  })

  it('EXCLUDES NPCs already in the encounter', () => {
    // Offering to add the captain twice is how a DM runs him against himself.
    const out = figuresAtLocation({
      locationId: 10, npcsHere: here,
      existingEntries: [{ source: 'npc', entity_id: 1 }],
    })
    expect(out.map(f => f.npc.id)).toEqual([2])
  })

  it('does not treat a monster entry as an added NPC', () => {
    const out = figuresAtLocation({
      locationId: 10, npcsHere: here,
      existingEntries: [{ source: 'srd', entity_id: 1 }],
    })
    expect(out).toHaveLength(2)
  })

  it('handles a location with nobody at it', () => {
    expect(figuresAtLocation({ locationId: 10 })).toEqual([])
    expect(figuresAtLocation({})).toEqual([])
  })
})

describe('entryXp', () => {
  it('reads the entry XP', () => {
    expect(entryXp({ xp: 450 })).toBe(450)
  })

  it('derives from CR when XP is missing', () => {
    expect(entryXp({ cr: 2 })).toBe(450)
  })

  it('is zero for a statless NPC', () => {
    expect(entryXp(npcEncounterEntry(npc()))).toBe(0)
  })

  it('handles nothing', () => {
    expect(entryXp(null)).toBe(0)
  })
})

describe('nameKey', () => {
  it('normalises case and internal whitespace', () => {
    expect(nameKey('  Bandit   Captain ')).toBe('bandit captain')
  })

  it('handles nullish', () => {
    expect(nameKey(null)).toBe('')
  })
})
