import { abilityMod } from './dnd5e'

// ── Armor table ───────────────────────────────────────────────────────────────
// base_ac:              AC provided by the armor (shield = flat +2 bonus)
// max_dex:              max DEX bonus allowed (null = no cap, 0 = no DEX)
// min_strength:         STR score required to avoid speed penalty (null = none)
// stealth_disadvantage: true if the armor imposes stealth disadvantage
// armor_type:           "light" | "medium" | "heavy" | "shield"

export const ARMOR_TABLE = {
  // ── Light armor — full DEX modifier ──────────────────────────────────────
  'padded':          { base_ac: 11, max_dex: null, min_strength: null, stealth_disadvantage: true,  armor_type: 'light'  },
  'leather':         { base_ac: 11, max_dex: null, min_strength: null, stealth_disadvantage: false, armor_type: 'light'  },
  'studded leather': { base_ac: 12, max_dex: null, min_strength: null, stealth_disadvantage: false, armor_type: 'light'  },
  // ── Medium armor — DEX modifier capped at +2 ─────────────────────────────
  'hide':            { base_ac: 12, max_dex: 2,    min_strength: null, stealth_disadvantage: false, armor_type: 'medium' },
  'chain shirt':     { base_ac: 13, max_dex: 2,    min_strength: null, stealth_disadvantage: false, armor_type: 'medium' },
  'scale mail':      { base_ac: 14, max_dex: 2,    min_strength: null, stealth_disadvantage: true,  armor_type: 'medium' },
  'breastplate':     { base_ac: 14, max_dex: 2,    min_strength: null, stealth_disadvantage: false, armor_type: 'medium' },
  'half plate':      { base_ac: 15, max_dex: 2,    min_strength: null, stealth_disadvantage: true,  armor_type: 'medium' },
  // ── Heavy armor — no DEX bonus ────────────────────────────────────────────
  'ring mail':       { base_ac: 14, max_dex: 0,    min_strength: null, stealth_disadvantage: true,  armor_type: 'heavy'  },
  'chain mail':      { base_ac: 16, max_dex: 0,    min_strength: 13,   stealth_disadvantage: true,  armor_type: 'heavy'  },
  'splint':          { base_ac: 17, max_dex: 0,    min_strength: 15,   stealth_disadvantage: true,  armor_type: 'heavy'  },
  'plate':           { base_ac: 18, max_dex: 0,    min_strength: 15,   stealth_disadvantage: true,  armor_type: 'heavy'  },
  // ── Shield — flat +2 bonus stacks with armor ──────────────────────────────
  'shield':          { base_ac: 2,  max_dex: null, min_strength: null, stealth_disadvantage: false, armor_type: 'shield' },
}

// ── Fuzzy-match an item name to an armor table entry ─────────────────────────
// Checks exact match first, then substring in both directions.
export const matchArmor = (itemName) => {
  const name = (itemName ?? '').toLowerCase().trim()
  if (ARMOR_TABLE[name]) return { key: name, data: ARMOR_TABLE[name] }
  for (const [key, data] of Object.entries(ARMOR_TABLE)) {
    if (name.includes(key) || key.includes(name)) return { key, data }
  }
  return null
}

// ── Unarmored Defense formulas ────────────────────────────────────────────────
// Each function receives the full stats object and returns the base AC.
export const UNARMORED_FORMULAS = {
  Barbarian: (stats) => 10 + abilityMod(stats.dex ?? 10) + abilityMod(stats.con ?? 10),
  Monk:      (stats) => 10 + abilityMod(stats.dex ?? 10) + abilityMod(stats.wis ?? 10),
  default:   (stats) => 10 + abilityMod(stats.dex ?? 10),
}

// ── Main calculation function ─────────────────────────────────────────────────
/**
 * calculateAC(character) → {
 *   ac:          number   — final calculated AC
 *   breakdown:   string   — human-readable formula, e.g. "Chain Mail (16) + Shield (+2) = 18"
 *   wearing:     string   — equipped armor name, or "Unarmored" / "Custom"
 *   has_shield:  boolean  — whether a shield is currently equipped
 *   stealth_dis: boolean  — whether stealth disadvantage applies
 *   warnings:    string[] — STR requirement failures, etc.
 * }
 *
 * Requires: character.stats (JSON string), character.inventory (JSON string),
 *           character.class (string)
 */
export const calculateAC = (character) => {
  const stats    = JSON.parse(character.stats    ?? '{}')
  const inv      = JSON.parse(character.inventory ?? '[]')
  const warnings = []

  // ── Manual override bypasses all calculation ──────────────────────────────
  if (stats.ac_override != null) {
    return {
      ac:          stats.ac_override,
      breakdown:   `Manual override: ${stats.ac_override}`,
      wearing:     'Custom',
      has_shield:  false,
      stealth_dis: false,
      warnings:    [],
    }
  }

  const dexMod   = abilityMod(stats.dex ?? 10)
  const strScore = stats.str ?? 10

  // ── Find equipped armor and shield from inventory ─────────────────────────
  let equippedArmor  = null
  let equippedShield = null

  inv.filter(item => item.equipped).forEach(item => {
    const match = matchArmor(item.name)
    if (!match) return
    if (match.data.armor_type === 'shield') {
      equippedShield = { item, armorData: match.data }
    } else {
      equippedArmor  = { item, armorData: match.data }
    }
  })

  const magicAcBonus = stats.ac_magic_bonus ?? 0
  let baseAC     = 0
  let breakdown  = ''
  let wearing    = 'Unarmored'
  let stealthDis = false

  if (equippedArmor) {
    const ad   = equippedArmor.armorData
    wearing    = equippedArmor.item.name
    stealthDis = ad.stealth_disadvantage

    // STR requirement check
    if (ad.min_strength && strScore < ad.min_strength) {
      warnings.push(`STR ${ad.min_strength} required for ${wearing}. Speed is reduced by 10 ft.`)
    }

    if (ad.armor_type === 'heavy') {
      // Heavy armor: no DEX bonus
      baseAC    = ad.base_ac
      breakdown = `${wearing} (${ad.base_ac})`
    } else {
      // Light / medium armor: add DEX (may be capped)
      const dexBonus = ad.max_dex != null ? Math.min(dexMod, ad.max_dex) : dexMod
      baseAC         = ad.base_ac + dexBonus
      const capNote  = ad.max_dex != null && dexMod > ad.max_dex
        ? ` (capped at +${ad.max_dex})`
        : ''
      breakdown = `${wearing} (${ad.base_ac}) + DEX +${dexBonus}${capNote}`
    }
  } else {
    // ── Unarmored Defense ─────────────────────────────────────────────────
    const className = character.class ?? ''
    const formula   = UNARMORED_FORMULAS[className] ?? UNARMORED_FORMULAS.default
    baseAC          = formula(stats)

    if (className === 'Barbarian') {
      breakdown = `Unarmored Defense (10 + DEX +${dexMod} + CON +${abilityMod(stats.con ?? 10)})`
    } else if (className === 'Monk') {
      breakdown = `Unarmored Defense (10 + DEX +${dexMod} + WIS +${abilityMod(stats.wis ?? 10)})`
    } else {
      breakdown = `Unarmored (10 + DEX +${dexMod})`
    }
  }

  // ── Shield and magic bonuses ──────────────────────────────────────────────
  const shieldBonus = equippedShield ? equippedShield.armorData.base_ac : 0
  if (shieldBonus)  breakdown += ` + Shield (+${shieldBonus})`
  if (magicAcBonus) breakdown += ` + Magic (+${magicAcBonus})`

  const finalAC = baseAC + shieldBonus + magicAcBonus
  breakdown    += ` = ${finalAC}`

  return {
    ac:          finalAC,
    breakdown,
    wearing,
    has_shield:  !!equippedShield,
    stealth_dis: stealthDis,
    warnings,
  }
}
