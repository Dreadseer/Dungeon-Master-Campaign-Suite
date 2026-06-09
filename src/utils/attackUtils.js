import { abilityMod, profBonus } from './dnd5e'

export const FINESSE_PROPS = ['finesse']
export const RANGED_PROPS  = ['ammunition', 'thrown', 'ranged']

// Determine ability used for weapon (melee=STR, ranged=DEX, finesse=higher)
export const weaponAbility = (weapon, stats) => {
  const props     = (weapon.properties ?? '').toLowerCase()
  const isRanged  = RANGED_PROPS.some(p => props.includes(p))
  const isFinesse = FINESSE_PROPS.some(p => props.includes(p))
  if (isFinesse) {
    return abilityMod(stats.str ?? 10) >= abilityMod(stats.dex ?? 10) ? 'str' : 'dex'
  }
  return isRanged ? 'dex' : 'str'
}

export const weaponAttackBonus = (weapon, stats, level) => {
  const ability = weaponAbility(weapon, stats)
  const mod     = abilityMod(stats[ability] ?? 10)
  const prof    = weapon.proficient !== false ? profBonus(level) : 0
  const magic   = weapon.magic_bonus ?? 0
  return mod + prof + magic
}

export const formatBonus = (n) => n >= 0 ? `+${n}` : `${n}`

export const weaponDamageStr = (weapon, stats, level) => {
  const ability  = weaponAbility(weapon, stats)
  const mod      = abilityMod(stats[ability] ?? 10)
  const magic    = weapon.magic_bonus ?? 0
  const bonus    = mod + magic
  const die      = weapon.damage_die  ?? '1d4'
  const type     = weapon.damage_type ?? ''
  const bonusStr = bonus !== 0 ? ` ${formatBonus(bonus)}` : ''
  return `${die}${bonusStr} ${type}`.trim()
}

// Detect if an inventory item is a weapon
export const isWeapon = (item) => {
  const t = (item.item_type ?? item.category ?? item.name ?? '').toLowerCase()
  return ['weapon','sword','axe','dagger','bow','crossbow','staff','mace','spear',
          'hammer','club','flail','lance','pike','rapier','scimitar','whip']
    .some(w => t.includes(w))
}

// ── Equipment slot helpers ────────────────────────────────────────────────────

export const detectEquipSlot = (item) => {
  const t = (item.item_type ?? item.category ?? item.name ?? '').toLowerCase()
  if (t.includes('helmet') || t.includes('helm') || t.includes('hood'))   return 'Helmet'
  if (t.includes('boot')   || t.includes('shoe') || t.includes('greave')) return 'Boots'
  if (t.includes('cloak')  || t.includes('cape') || t.includes('mantle')) return 'Cloak'
  if (t.includes('ring'))                                                   return 'Ring'
  if (t.includes('shield'))                                                 return 'Off Hand'
  if (t.includes('armor')  || t.includes('mail')   || t.includes('plate') ||
      t.includes('leather') || t.includes('robe')   || t.includes('chain') ||
      t.includes('scale')   || t.includes('splint')) return 'Armor'
  if (isWeapon(item)) return 'Main Hand'
  return 'Other'
}

export const getEquippedBySlot = (inventory) => {
  const slots = {
    'Main Hand': null, 'Off Hand': null, 'Armor':  null, 'Helmet': null,
    'Ring 1':    null, 'Ring 2':   null, 'Boots':  null, 'Cloak':  null,
  }
  inventory
    .filter(item => item.equipped)
    .forEach(item => {
      const slot = detectEquipSlot(item)
      if (slot === 'Ring') {
        if      (!slots['Ring 1']) slots['Ring 1'] = item
        else if (!slots['Ring 2']) slots['Ring 2'] = item
      } else if (slot in slots && slots[slot] === null) {
        slots[slot] = item
      }
    })
  return slots
}

// Build the full attacks list from all sources
export const buildAttacksList = (character) => {
  const stats   = JSON.parse(character.stats    ?? '{}')
  const inv     = JSON.parse(character.inventory ?? '[]')
  const level   = character.level ?? 1
  const attacks = []

  // 1. Equipped weapons from inventory
  inv
    .filter(item => item.equipped && isWeapon(item))
    .forEach(item => {
      attacks.push({
        id:           item.id,
        name:         item.name,
        source:       'weapon',
        attack_bonus: formatBonus(weaponAttackBonus(item, stats, level)),
        damage:       weaponDamageStr(item, stats, level),
        range:        item.range ?? '5 ft',
        properties:   item.properties ?? '',
        notes:        item.notes ?? '',
      })
    })

  // 2. Extra attacks (racial, class, feats)
  ;(stats.extra_attacks ?? []).forEach(atk => {
    attacks.push({ ...atk, source: atk.source ?? 'feature' })
  })

  // 3. Damage spells from known_spells
  const slots = JSON.parse(character.spell_slots ?? '{}')
  const known = slots.known_spells ?? []
  known
    .filter(s => s.is_damage_spell)
    .forEach(spell => {
      attacks.push({
        id:           `spell-${spell.index}`,
        name:         spell.name,
        source:       'spell',
        attack_bonus: spell.attack_bonus ?? '—',
        damage:       spell.damage ?? '—',
        range:        spell.range ?? '—',
        properties:   `${spell.school ?? ''} • Level ${spell.level === 0 ? 'Cantrip' : spell.level}`,
        notes:        spell.description_short ?? '',
      })
    })

  return attacks
}
