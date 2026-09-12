// Turn a cached SRD row into prose a retrieval model can embed.
//
// Rules Q&A used to require the DM to upload a PDF of a book they already own,
// wait for it to chunk, then wait again for Ollama to embed it. Until then the
// Ask button was disabled and the feature did not exist. Meanwhile the app
// already ships a full SRD cache — monsters, spells, equipment, classes — sat in
// `srd_cache` as JSON, used only for browsing.
//
// This module serialises those rows into readable text so they can go through
// the same chunk → embed → retrieve path as an uploaded book, which makes rules
// lookup work on a fresh install with nothing uploaded.
//
// Pure and dependency-free on purpose: SrdService.js opens with
// `require('electron')`, so nothing in it can be unit tested under bare node.
// This file can be, and is.

// ── Formatting helpers ───────────────────────────────────────────────────────
// The dnd5eapi shapes are inconsistent — `school` is sometimes a string and
// sometimes { name }, `armor_class` is a number on old rows and an array of
// { type, value } on new ones. Every helper below tolerates both rather than
// assuming, because a throw here would abort indexing the whole SRD.

const text = (v) => (v == null ? '' : String(v).trim())

const named = (v) => {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(named).filter(Boolean).join(', ')
  if (typeof v === 'object') return text(v.name ?? v.index ?? '')
  return text(v)
}

const list = (v) => {
  if (v == null) return []
  return (Array.isArray(v) ? v : [v]).map(named).filter(Boolean)
}

const paragraphs = (v) => {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join('\n')
  return text(v)
}

const formatAC = (ac) => {
  if (ac == null) return ''
  if (typeof ac === 'number') return String(ac)
  if (Array.isArray(ac)) {
    return ac
      .map(entry => {
        if (entry == null) return ''
        if (typeof entry === 'number') return String(entry)
        const value = text(entry.value)
        const type = named(entry.type ?? entry.armor)
        return type ? `${value} (${type})` : value
      })
      .filter(Boolean)
      .join(', ')
  }
  return text(ac)
}

const formatSpeed = (speed) => {
  if (!speed || typeof speed !== 'object') return text(speed)
  return Object.entries(speed)
    .map(([mode, value]) => `${mode} ${text(value)}`)
    .join(', ')
}

const formatCR = (cr) => {
  if (cr == null) return ''
  const fractions = { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }
  return fractions[cr] ?? String(cr)
}

// Ability scores read back as "STR 18 (+4)", which is how a DM says them and how
// a question about them is likely to be phrased.
const ABILITIES = [
  ['strength', 'STR'], ['dexterity', 'DEX'], ['constitution', 'CON'],
  ['intelligence', 'INT'], ['wisdom', 'WIS'], ['charisma', 'CHA'],
]

const formatAbilities = (row) => {
  const parts = ABILITIES
    .map(([key, label]) => {
      const score = row[key]
      if (typeof score !== 'number') return ''
      const mod = Math.floor((score - 10) / 2)
      return `${label} ${score} (${mod >= 0 ? '+' : ''}${mod})`
    })
    .filter(Boolean)
  return parts.join(', ')
}

// Named blocks — special abilities, actions, reactions, legendary actions — all
// share { name, desc } and all matter for a rules question.
const formatBlocks = (blocks, heading) => {
  const entries = (Array.isArray(blocks) ? blocks : [])
    .map(b => {
      const name = text(b?.name)
      const desc = paragraphs(b?.desc)
      if (!name && !desc) return ''
      return name ? `${name}. ${desc}`.trim() : desc
    })
    .filter(Boolean)
  return entries.length ? `${heading}:\n${entries.join('\n')}` : ''
}

const joinLines = (lines) => lines.filter(Boolean).join('\n').trim()

// ── Per-type serialisers ─────────────────────────────────────────────────────

function monsterText(m) {
  return joinLines([
    `${text(m.name)} — Monster`,
    [named(m.size), named(m.type), named(m.subtype) ? `(${named(m.subtype)})` : '', named(m.alignment)]
      .filter(Boolean).join(' '),
    formatAC(m.armor_class) && `Armor Class ${formatAC(m.armor_class)}`,
    m.hit_points != null && `Hit Points ${text(m.hit_points)}${m.hit_dice ? ` (${text(m.hit_dice)})` : ''}`,
    formatSpeed(m.speed) && `Speed ${formatSpeed(m.speed)}`,
    formatAbilities(m),
    list(m.proficiencies).length && `Proficiencies: ${list(m.proficiencies).join(', ')}`,
    list(m.damage_vulnerabilities).length && `Damage Vulnerabilities: ${list(m.damage_vulnerabilities).join(', ')}`,
    list(m.damage_resistances).length && `Damage Resistances: ${list(m.damage_resistances).join(', ')}`,
    list(m.damage_immunities).length && `Damage Immunities: ${list(m.damage_immunities).join(', ')}`,
    list(m.condition_immunities).length && `Condition Immunities: ${list(m.condition_immunities).join(', ')}`,
    m.senses && `Senses: ${formatSpeed(m.senses)}`,
    text(m.languages) && `Languages: ${text(m.languages)}`,
    m.challenge_rating != null &&
      `Challenge ${formatCR(m.challenge_rating)}${m.xp != null ? ` (${m.xp} XP)` : ''}`,
    formatBlocks(m.special_abilities, 'Special Abilities'),
    formatBlocks(m.actions, 'Actions'),
    formatBlocks(m.reactions, 'Reactions'),
    formatBlocks(m.legendary_actions, 'Legendary Actions'),
  ])
}

const LEVEL_LABEL = (level) => {
  if (level === 0) return 'Cantrip'
  const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th']
  return `${ordinals[level] ?? `${level}th`}-level`
}

function spellText(s) {
  const school = named(s.school)
  const components = list(s.components).join(', ')
  return joinLines([
    `${text(s.name)} — Spell`,
    [s.level != null ? LEVEL_LABEL(s.level) : '', school].filter(Boolean).join(' '),
    text(s.casting_time) && `Casting Time: ${text(s.casting_time)}`,
    text(s.range) && `Range: ${text(s.range)}`,
    components && `Components: ${components}${s.material ? ` (${text(s.material)})` : ''}`,
    text(s.duration) && `Duration: ${s.concentration ? 'Concentration, ' : ''}${text(s.duration)}`,
    s.ritual === true && 'Ritual: yes',
    list(s.classes).length && `Classes: ${list(s.classes).join(', ')}`,
    paragraphs(s.desc),
    paragraphs(s.higher_level) && `At Higher Levels: ${paragraphs(s.higher_level)}`,
    text(s.attack_type) && `Attack type: ${text(s.attack_type)}`,
    s.damage?.damage_type && `Damage type: ${named(s.damage.damage_type)}`,
    s.dc?.dc_type && `Saving throw: ${named(s.dc.dc_type)}`,
  ])
}

function equipmentText(e) {
  const cost = e.cost ? `${text(e.cost.quantity)} ${text(e.cost.unit)}` : ''
  const damage = e.damage
    ? `${text(e.damage.damage_dice)} ${named(e.damage.damage_type)}`.trim()
    : ''
  return joinLines([
    `${text(e.name)} — Equipment`,
    [named(e.equipment_category), named(e.weapon_category), named(e.armor_category), named(e.gear_category)]
      .filter(Boolean).join(', '),
    named(e.weapon_range) && `Weapon range: ${named(e.weapon_range)}`,
    damage && `Damage: ${damage}`,
    e.two_handed_damage && `Two-handed damage: ${text(e.two_handed_damage.damage_dice)} ${named(e.two_handed_damage.damage_type)}`,
    e.range && (e.range.normal != null) &&
      `Range: ${text(e.range.normal)}${e.range.long ? `/${text(e.range.long)}` : ''}`,
    list(e.properties).length && `Properties: ${list(e.properties).join(', ')}`,
    formatAC(e.armor_class) && `Armor Class: ${formatAC(e.armor_class)}`,
    e.str_minimum ? `Strength minimum: ${text(e.str_minimum)}` : '',
    e.stealth_disadvantage === true && 'Stealth: disadvantage',
    cost && `Cost: ${cost}`,
    e.weight != null && `Weight: ${text(e.weight)}`,
    paragraphs(e.desc),
    paragraphs(e.special),
  ])
}

function classText(c) {
  return joinLines([
    `${text(c.name)} — Class`,
    c.hit_die != null && `Hit Die: d${text(c.hit_die)}`,
    list(c.proficiencies).length && `Proficiencies: ${list(c.proficiencies).join(', ')}`,
    list(c.saving_throws).length && `Saving Throw Proficiencies: ${list(c.saving_throws).join(', ')}`,
    c.spellcasting?.spellcasting_ability &&
      `Spellcasting Ability: ${named(c.spellcasting.spellcasting_ability)}`,
    formatBlocks(c.spellcasting?.info, 'Spellcasting'),
    list(c.subclasses).length && `Subclasses: ${list(c.subclasses).join(', ')}`,
    paragraphs(c.desc),
  ])
}

const SERIALISERS = {
  monster: monsterText,
  spell: spellText,
  equipment: equipmentText,
  class: classText,
}

/**
 * Serialise one `srd_cache` row into indexable text.
 *
 * @param {string} resourceType  'monster' | 'spell' | 'equipment' | 'class'
 * @param {object|string} data   the parsed row, or the raw JSON string
 * @returns {string} '' when the row is unusable — callers skip those
 */
function buildIndexableText(resourceType, data) {
  let row = data
  if (typeof data === 'string') {
    try { row = JSON.parse(data) } catch { return '' }
  }
  if (!row || typeof row !== 'object') return ''

  const serialise = SERIALISERS[resourceType]
  if (!serialise) return ''

  try {
    return serialise(row)
  } catch {
    // One malformed row must not abort indexing the whole SRD.
    return ''
  }
}

// `page_number` is an integer column, and the SRD has no pages. Rather than
// leave it null and print "p.null" in every citation, each resource type gets a
// stable synthetic section number that the UI renders as a section name.
const SECTIONS = { monster: 1, spell: 2, equipment: 3, class: 4 }
const SECTION_NAMES = { 1: 'Monsters', 2: 'Spells', 3: 'Equipment', 4: 'Classes' }

const srdSectionFor = (resourceType) => SECTIONS[resourceType] ?? 0
const srdSectionName = (section) => SECTION_NAMES[section] ?? 'SRD'

/** Is this source the SRD sentinel rather than an uploaded book? */
const SRD_SOURCE_FILENAME = 'SRD 5.1'

module.exports = {
  buildIndexableText,
  srdSectionFor,
  srdSectionName,
  SRD_SOURCE_FILENAME,
  SECTIONS,
}
