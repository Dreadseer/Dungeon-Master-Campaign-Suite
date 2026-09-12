import { describe, it, expect } from 'vitest'
import srdIndexText from '../srdIndexText.js'

const { buildIndexableText, srdSectionFor, srdSectionName, SRD_SOURCE_FILENAME } = srdIndexText

// Fixtures follow the dnd5eapi.co shapes the app already reads elsewhere
// (MonsterStatBlock.jsx, SpellDetail.jsx), trimmed to the fields that matter.

const GOBLIN = {
  index: 'goblin', name: 'Goblin', size: 'Small', type: 'humanoid',
  subtype: 'goblinoid', alignment: 'neutral evil',
  armor_class: [{ type: 'armor', value: 15 }],
  hit_points: 7, hit_dice: '2d6',
  speed: { walk: '30 ft.' },
  strength: 8, dexterity: 14, constitution: 10,
  intelligence: 10, wisdom: 8, charisma: 8,
  proficiencies: [{ proficiency: { name: 'Skill: Stealth' }, value: 6 }],
  damage_immunities: [], condition_immunities: [],
  senses: { darkvision: '60 ft.', passive_perception: 9 },
  languages: 'Common, Goblin',
  challenge_rating: 0.25, xp: 50,
  special_abilities: [{ name: 'Nimble Escape', desc: 'The goblin can take the Disengage or Hide action as a bonus action on each of its turns.' }],
  actions: [{ name: 'Scimitar', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.' }],
}

const FIREBALL = {
  index: 'fireball', name: 'Fireball', level: 3,
  school: { name: 'Evocation' },
  casting_time: '1 action', range: '150 feet',
  components: ['V', 'S', 'M'], material: 'a tiny ball of bat guano and sulfur',
  duration: 'Instantaneous', concentration: false, ritual: false,
  desc: [
    'A bright streak flashes from your pointing finger to a point you choose within range and then blossoms with a low roar into an explosion of flame.',
    'Each creature in a 20-foot-radius sphere centered on that point must make a Dexterity saving throw.',
  ],
  higher_level: ['When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6 for each slot level above 3rd.'],
  damage: { damage_type: { name: 'Fire' } },
  dc: { dc_type: { name: 'DEX' } },
  classes: [{ name: 'Sorcerer' }, { name: 'Wizard' }],
}

const LONGSWORD = {
  index: 'longsword', name: 'Longsword',
  equipment_category: { name: 'Weapon' },
  weapon_category: 'Martial', weapon_range: 'Melee',
  damage: { damage_dice: '1d8', damage_type: { name: 'Slashing' } },
  two_handed_damage: { damage_dice: '1d10', damage_type: { name: 'Slashing' } },
  properties: [{ name: 'Versatile' }],
  cost: { quantity: 15, unit: 'gp' }, weight: 3,
}

const BARBARIAN = {
  index: 'barbarian', name: 'Barbarian', hit_die: 12,
  proficiencies: [{ name: 'Light Armor' }, { name: 'Shields' }],
  saving_throws: [{ name: 'STR' }, { name: 'CON' }],
  subclasses: [{ name: 'Berserker' }],
}

describe('monsters', () => {
  const text = buildIndexableText('monster', GOBLIN)

  it('leads with the name and the type label', () => {
    expect(text.startsWith('Goblin — Monster')).toBe(true)
  })

  it('includes the stat line a DM would ask about', () => {
    expect(text).toContain('Armor Class 15 (armor)')
    expect(text).toContain('Hit Points 7 (2d6)')
    expect(text).toContain('Speed walk 30 ft.')
  })

  it('renders ability scores with their modifiers', () => {
    expect(text).toContain('STR 8 (-1)')
    expect(text).toContain('DEX 14 (+2)')
    expect(text).toContain('CON 10 (+0)')
  })

  it('renders a fractional CR the way the book prints it', () => {
    expect(text).toContain('Challenge 1/4 (50 XP)')
  })

  it('includes special abilities and actions in full', () => {
    expect(text).toContain('Nimble Escape. The goblin can take the Disengage')
    expect(text).toContain('Scimitar. Melee Weapon Attack: +4 to hit')
  })

  it('omits empty sections rather than printing empty labels', () => {
    expect(text).not.toContain('Damage Immunities')
    expect(text).not.toContain('Condition Immunities')
    expect(text).not.toContain('Reactions')
    expect(text).not.toContain('Legendary Actions')
  })

  it('handles armor_class as a bare number, the older cache shape', () => {
    const older = buildIndexableText('monster', { ...GOBLIN, armor_class: 15 })
    expect(older).toContain('Armor Class 15')
  })

  it('renders CR 0 and whole-number CRs', () => {
    expect(buildIndexableText('monster', { ...GOBLIN, challenge_rating: 0, xp: 10 }))
      .toContain('Challenge 0 (10 XP)')
    expect(buildIndexableText('monster', { ...GOBLIN, challenge_rating: 17, xp: 18000 }))
      .toContain('Challenge 17 (18000 XP)')
  })

  it('includes legendary actions when present', () => {
    const dragon = {
      ...GOBLIN, name: 'Adult Red Dragon',
      legendary_actions: [{ name: 'Tail Attack', desc: 'The dragon makes a tail attack.' }],
    }
    expect(buildIndexableText('monster', dragon)).toContain('Legendary Actions:\nTail Attack.')
  })
})

describe('spells', () => {
  const text = buildIndexableText('spell', FIREBALL)

  it('leads with the name and level line', () => {
    expect(text.startsWith('Fireball — Spell')).toBe(true)
    expect(text).toContain('3rd-level Evocation')
  })

  it('includes the casting block', () => {
    expect(text).toContain('Casting Time: 1 action')
    expect(text).toContain('Range: 150 feet')
    expect(text).toContain('Components: V, S, M (a tiny ball of bat guano and sulfur)')
    expect(text).toContain('Duration: Instantaneous')
  })

  it('includes the full description, not a preview', () => {
    expect(text).toContain('A bright streak flashes')
    expect(text).toContain('20-foot-radius sphere')
  })

  it('includes the at-higher-levels text', () => {
    expect(text).toContain('At Higher Levels: When you cast this spell using a spell slot of 4th')
  })

  it('names the damage type and the save', () => {
    expect(text).toContain('Damage type: Fire')
    expect(text).toContain('Saving throw: DEX')
  })

  it('labels a cantrip as such', () => {
    expect(buildIndexableText('spell', { ...FIREBALL, level: 0 })).toContain('Cantrip Evocation')
  })

  it('marks concentration in the duration line', () => {
    const conc = { ...FIREBALL, concentration: true, duration: 'up to 1 minute' }
    expect(buildIndexableText('spell', conc)).toContain('Duration: Concentration, up to 1 minute')
  })

  it('marks a ritual', () => {
    expect(buildIndexableText('spell', { ...FIREBALL, ritual: true })).toContain('Ritual: yes')
  })

  it('accepts school as a plain string, the older cache shape', () => {
    expect(buildIndexableText('spell', { ...FIREBALL, school: 'Evocation' }))
      .toContain('3rd-level Evocation')
  })
})

describe('equipment', () => {
  const text = buildIndexableText('equipment', LONGSWORD)

  it('leads with the name and category', () => {
    expect(text.startsWith('Longsword — Equipment')).toBe(true)
    expect(text).toContain('Weapon, Martial')
  })

  it('includes damage, properties, cost and weight', () => {
    expect(text).toContain('Damage: 1d8 Slashing')
    expect(text).toContain('Two-handed damage: 1d10 Slashing')
    expect(text).toContain('Properties: Versatile')
    expect(text).toContain('Cost: 15 gp')
    expect(text).toContain('Weight: 3')
  })

  it('includes armour fields for armour', () => {
    const plate = {
      name: 'Plate', equipment_category: { name: 'Armor' }, armor_category: 'Heavy',
      armor_class: { base: 18 }, str_minimum: 15, stealth_disadvantage: true,
      cost: { quantity: 1500, unit: 'gp' },
    }
    const armour = buildIndexableText('equipment', plate)
    expect(armour).toContain('Strength minimum: 15')
    expect(armour).toContain('Stealth: disadvantage')
  })
})

describe('classes', () => {
  const text = buildIndexableText('class', BARBARIAN)

  it('includes hit die, proficiencies, saves and subclasses', () => {
    expect(text.startsWith('Barbarian — Class')).toBe(true)
    expect(text).toContain('Hit Die: d12')
    expect(text).toContain('Proficiencies: Light Armor, Shields')
    expect(text).toContain('Saving Throw Proficiencies: STR, CON')
    expect(text).toContain('Subclasses: Berserker')
  })

  it('includes spellcasting info when the class has it', () => {
    const wizard = {
      name: 'Wizard', hit_die: 6,
      spellcasting: {
        spellcasting_ability: { name: 'INT' },
        info: [{ name: 'Cantrips', desc: ['You know three cantrips of your choice.'] }],
      },
    }
    const text2 = buildIndexableText('class', wizard)
    expect(text2).toContain('Spellcasting Ability: INT')
    expect(text2).toContain('Cantrips. You know three cantrips')
  })
})

describe('input handling — one bad row must not abort the whole index', () => {
  it('accepts a raw JSON string, which is how srd_cache stores it', () => {
    expect(buildIndexableText('monster', JSON.stringify(GOBLIN))).toContain('Goblin — Monster')
  })

  it('returns empty string for malformed JSON', () => {
    expect(buildIndexableText('monster', '{not json')).toBe('')
  })

  it('returns empty string for an unknown resource type', () => {
    expect(buildIndexableText('artifact', GOBLIN)).toBe('')
    expect(buildIndexableText(undefined, GOBLIN)).toBe('')
  })

  it('returns empty string for nullish or non-object data', () => {
    for (const bad of [null, undefined, 42, true, '']) {
      expect(buildIndexableText('monster', bad)).toBe('')
    }
  })

  it('produces something usable from a row with almost nothing in it', () => {
    const sparse = buildIndexableText('monster', { name: 'Mystery' })
    expect(sparse).toBe('Mystery — Monster')
  })

  it('never returns a string with leading or trailing whitespace', () => {
    for (const [type, row] of [['monster', GOBLIN], ['spell', FIREBALL], ['equipment', LONGSWORD], ['class', BARBARIAN]]) {
      const out = buildIndexableText(type, row)
      expect(out).toBe(out.trim())
    }
  })

  it('never emits a label with nothing after it', () => {
    // A line ending in ':' is legitimate when it is a block heading — "Actions:"
    // sits above its entries. What must never appear is a label with neither a
    // value on the same line nor content on the next.
    for (const [type, row] of [['monster', GOBLIN], ['spell', FIREBALL], ['equipment', LONGSWORD]]) {
      const lines = buildIndexableText(type, row).split('\n')
      lines.forEach((line, i) => {
        if (!/:\s*$/.test(line.trim())) return
        const next = lines[i + 1]
        expect(next?.trim(), `${type}: dangling label "${line}"`).toBeTruthy()
      })
    }
  })

  it('omits a block heading entirely when the block is empty', () => {
    const noActions = buildIndexableText('monster', { ...GOBLIN, actions: [], special_abilities: [] })
    expect(noActions).not.toContain('Actions:')
    expect(noActions).not.toContain('Special Abilities:')
  })

  it('survives a row whose nested fields are the wrong type', () => {
    const weird = { name: 'Weird', speed: 'fast', armor_class: 'thirteen', actions: 'not an array' }
    expect(() => buildIndexableText('monster', weird)).not.toThrow()
    expect(buildIndexableText('monster', weird)).toContain('Weird — Monster')
  })
})

describe('section numbers', () => {
  it('gives each resource type a stable section', () => {
    expect(srdSectionFor('monster')).toBe(1)
    expect(srdSectionFor('spell')).toBe(2)
    expect(srdSectionFor('equipment')).toBe(3)
    expect(srdSectionFor('class')).toBe(4)
  })

  it('falls back to 0 for an unknown type', () => {
    expect(srdSectionFor('artifact')).toBe(0)
  })

  it('maps sections back to names for citations', () => {
    expect(srdSectionName(1)).toBe('Monsters')
    expect(srdSectionName(2)).toBe('Spells')
    expect(srdSectionName(3)).toBe('Equipment')
    expect(srdSectionName(4)).toBe('Classes')
    expect(srdSectionName(99)).toBe('SRD')
  })

  it('names the sentinel source so every layer agrees on it', () => {
    expect(SRD_SOURCE_FILENAME).toBe('SRD 5.1')
  })
})
