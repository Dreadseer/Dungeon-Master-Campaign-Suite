// Compendium extraction utilities — source book import pipeline.
// Pure functions with no IPC or React dependencies so bulk extraction
// (Option B) can call buildExtractionPrompt / parseExtraction in a loop.

export const CONTENT_TYPES = {
  spell:     { label: 'Spell',     icon: '✨', searchHint: 'spell casting components duration' },
  monster:   { label: 'Monster',   icon: '🐉', searchHint: 'monster stat block armor class hit points' },
  equipment: { label: 'Equipment', icon: '⚔️',  searchHint: 'weapon armor equipment cost weight' },
  subclass:  { label: 'Subclass',  icon: '🎓', searchHint: 'subclass archetype features abilities' },
}

// ── JSON schemas sent in the extraction prompt ────────────────────────────────

const SCHEMAS = {
  spell: `{
  "name": string,
  "level": number (0=cantrip, 1-9),
  "school": string ("Abjuration"|"Conjuration"|"Divination"|"Enchantment"|"Evocation"|"Illusion"|"Necromancy"|"Transmutation"),
  "casting_time": string (e.g. "1 action", "1 bonus action", "1 minute"),
  "range": string (e.g. "60 feet", "Self", "Touch"),
  "components_v": boolean,
  "components_s": boolean,
  "components_m": boolean,
  "material": string (material description, or "" if none),
  "duration": string (e.g. "Instantaneous", "Concentration, up to 1 minute"),
  "concentration": boolean,
  "ritual": boolean,
  "classes": string (comma-separated class names that can cast this spell),
  "description": string (full spell description text),
  "higher_levels": string (at higher levels text, or "")
}`,

  monster: `{
  "name": string,
  "size": string ("Tiny"|"Small"|"Medium"|"Large"|"Huge"|"Gargantuan"),
  "type": string (e.g. "humanoid", "beast", "dragon", "undead"),
  "alignment": string (e.g. "neutral evil", "unaligned"),
  "cr": string (e.g. "1/8", "1", "5", "20"),
  "xp": number,
  "armor_class": number,
  "hit_points": number,
  "hit_dice": string (e.g. "8d8 + 16"),
  "speed_walk": string (e.g. "30 ft."),
  "str": number, "dex": number, "con": number,
  "int": number, "wis": number,  "cha": number,
  "save_proficiencies": string[] (ability names e.g. ["str","dex"]),
  "damage_immunities": string,
  "damage_resistances": string,
  "damage_vulnerabilities": string,
  "condition_immunities": string,
  "senses": string (e.g. "darkvision 60 ft., passive Perception 12"),
  "languages": string,
  "special_abilities": [{"name": string, "description": string}],
  "actions": [{"name": string, "description": string}],
  "legendary_actions_text": string (or "")
}`,

  equipment: `{
  "name": string,
  "category": string ("Weapon"|"Armor"|"Adventuring Gear"|"Tool"|"Mount"|"Vehicle"|"Trade Good"|"Other"),
  "cost": string (e.g. "25 gp", "5 sp"),
  "weight": number (pounds, 0 if unknown),
  "description": string,
  "weapon_damage": string (e.g. "1d8", "" if not a weapon),
  "weapon_type": string (e.g. "Martial Melee", "Simple Ranged", "" if not a weapon),
  "weapon_properties": string (comma-separated e.g. "Finesse, Light", "" if not a weapon),
  "armor_base_ac": number (0 if not armor),
  "armor_dex_cap": number or null (null if no cap or not armor),
  "armor_min_str": number or null (null if no requirement),
  "armor_stealth_disadvantage": boolean
}`,

  subclass: `{
  "class_name": string (base class e.g. "Fighter", "Wizard", "Rogue", "Cleric"),
  "name": string (subclass name e.g. "Battle Master", "School of Evocation"),
  "description": string (1-3 sentence flavor/overview),
  "unlock_level": number (level subclass is chosen, typically 1, 2, or 3),
  "features": [
    {"name": string, "level_gained": number, "description": string (COMPLETE feature text verbatim — every paragraph, not just the opening sentence)}
  ]
}`,
}

// Per-type disambiguation hints for the AI prompt
function _ignoreHint(type) {
  switch (type) {
    case 'spell':
      return 'If the passages contain magic items, equipment, or monsters with similar names, ignore them entirely.'
    case 'monster':
      return 'If the passages contain spells, equipment, or magic items with similar names, ignore them entirely.'
    case 'equipment':
      return 'Include magic items and wondrous items — they count as equipment. Ignore any spells or monsters with similar names.'
    case 'subclass':
      return 'If the passages contain spells, equipment, or monster entries, ignore them entirely. Include EVERY feature the subclass grants at every level (there are often 4 or more, ending with a high-level capstone around level 14) — do not skip any feature even if the passages are long or a feature appears near the very end. Copy each feature\'s full description verbatim, not a shortened summary. A feature is a named heading followed by a line like "6th-level <Subclass> feature"; use that line to set level_gained. IMPORTANT: some features reference a creature stat block (for example a "Dancing Item" block with Armor Class, Hit Points, Speed, STR/DEX/CON scores, Senses, and its own ACTIONS list). That stat block is NOT a subclass feature — never create a feature for it and never merge its lines into a feature\'s description; extract only the class-feature prose. For the top-level "description" field use the subclass\'s introductory flavor paragraph(s) — ignore italic margin quotes, art captions, and author bylines (e.g. a "—Tasha" caption or a stray "TASHA" line).'
    default:
      return ''
  }
}

function _userIgnoreHint(type, name) {
  if (type === 'equipment') {
    return `This may be a magic item or wondrous item — extract all its properties and the COMPLETE description text verbatim.`
  }
  return `If you see an unrelated entry with a similar name, skip it.`
}

// ── Build prompt pair { system, user } for ai.complete() ─────────────────────

// Max characters of source text to send per request — keeps local models within
// their context window (~8k tokens ≈ ~6k chars of source + prompt overhead).
// Subclasses and monsters often span multiple features/actions across several
// pages of source text, so they get a much larger budget than single-entry
// types — a full subclass (4+ features, each several paragraphs verbatim) can
// run past 12k chars of source once the surrounding chunks are stitched in.
const MAX_PASSAGE_CHARS = 4000
const MAX_PASSAGE_CHARS_BY_TYPE = {
  subclass: 20000,
  monster:  12000,
}

// Max output tokens for the extraction response. When the model senses it is
// near this ceiling it gracefully closes the JSON early — which silently drops
// later features and truncates long descriptions mid-sentence. A full subclass
// copied verbatim can exceed 4k tokens, so give the multi-section types plenty
// of headroom.
const MAX_OUTPUT_TOKENS_BY_TYPE = {
  subclass: 8192,
  monster:  8192,
  spell:    2048,
  equipment: 2048,
}

export function extractionMaxTokens(type) {
  return MAX_OUTPUT_TOKENS_BY_TYPE[type] ?? 1536
}

export function buildExtractionPrompt(type, name, chunks) {
  // Trim passages to fit within the local model's context window.
  const maxPassageChars = MAX_PASSAGE_CHARS_BY_TYPE[type] ?? MAX_PASSAGE_CHARS
  let total = 0
  const cappedChunks = []
  for (const c of chunks) {
    if (total + c.text.length > maxPassageChars) break
    cappedChunks.push(c)
    total += c.text.length
  }

  const passages = cappedChunks
    .map((c, i) => `--- Passage ${i + 1} (page ${c.page_number}) ---\n${c.text}`)
    .join('\n\n')

  return {
    system: [
      'You are a precise D&D 5e data extraction assistant.',
      'Extract structured data from provided source book passages.',
      'Return ONLY valid JSON — no markdown fences, no explanations, no extra text.',
      'If a field cannot be determined from the passages, use: "" for strings, 0 for numbers, false for booleans, [] for arrays.',
      'Do not invent or fabricate content — only extract what is explicitly stated in the passages.',
      'Description and feature-text fields must be copied verbatim and in full — every sentence and paragraph. Never shorten, summarize, or stop after the first sentence.',
      'Preserve the original paragraph structure in text fields: separate paragraphs with a blank line ("\\n\\n"). When a feature lists named sub-options (for example "Ability Check.", "Attack Roll.", "Saving Throw."), start each one on its own new paragraph beginning with that bold lead-in term.',
      'The source text comes from a PDF and may contain artifacts: words split across line breaks by a hyphen (e.g. "intangi-ble" or "Cre- ation"), stray page numbers, garbled characters, and column headers/footers. Rejoin hyphen-split words into whole words, drop the stray artifacts, and otherwise keep the wording exactly as written.',
      `CRITICAL: You are extracting a ${type.toUpperCase()} entry only. ${_ignoreHint(type)} Only read the ${type} entry.`,
    ].join('\n'),

    user: [
      `Extract the D&D 5e ${type} entry for "${name}" from these source book passages.`,
      `Read ONLY the ${type} entry for "${name}". ${_userIgnoreHint(type, name)}`,
      '',
      passages,
      '',
      `Return ONLY this JSON for the ${type} named "${name}":`,
      SCHEMAS[type],
    ].join('\n'),
  }
}

// ── Parse and normalise raw AI output into clean data objects ─────────────────

export function parseExtraction(type, rawText) {
  // Strip markdown fences
  let cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // If the model added explanatory text before or after the JSON object,
  // extract just the outermost { … } block.
  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1)
  }

  const data = JSON.parse(cleaned)

  if (type === 'spell') {
    return {
      level:         Number(data.level ?? 0),
      school:        String(data.school ?? ''),
      casting_time:  String(data.casting_time ?? ''),
      range:         String(data.range ?? ''),
      components_v:  Boolean(data.components_v),
      components_s:  Boolean(data.components_s),
      components_m:  Boolean(data.components_m),
      material:      String(data.material ?? ''),
      duration:      String(data.duration ?? ''),
      concentration: Boolean(data.concentration),
      ritual:        Boolean(data.ritual),
      classes:       String(data.classes ?? ''),
      description:   String(data.description ?? ''),
      higher_levels: String(data.higher_levels ?? ''),
    }
  }

  if (type === 'monster') {
    return {
      size:                   String(data.size ?? 'Medium'),
      type:                   String(data.type ?? ''),
      alignment:              String(data.alignment ?? ''),
      cr:                     String(data.cr ?? '0'),
      xp:                     Number(data.xp ?? 0),
      armor_class:            Number(data.armor_class ?? 10),
      hit_points:             Number(data.hit_points ?? 1),
      hit_dice:               String(data.hit_dice ?? ''),
      speed_walk:             String(data.speed_walk ?? '30 ft.'),
      str:                    Number(data.str ?? 10),
      dex:                    Number(data.dex ?? 10),
      con:                    Number(data.con ?? 10),
      int:                    Number(data.int ?? 10),
      wis:                    Number(data.wis ?? 10),
      cha:                    Number(data.cha ?? 10),
      save_proficiencies:     Array.isArray(data.save_proficiencies) ? data.save_proficiencies : [],
      damage_immunities:      String(data.damage_immunities ?? ''),
      damage_resistances:     String(data.damage_resistances ?? ''),
      damage_vulnerabilities: String(data.damage_vulnerabilities ?? ''),
      condition_immunities:   String(data.condition_immunities ?? ''),
      senses:                 String(data.senses ?? ''),
      languages:              String(data.languages ?? ''),
      special_abilities:      Array.isArray(data.special_abilities) ? data.special_abilities : [],
      actions:                Array.isArray(data.actions) ? data.actions : [],
      legendary_actions_text: String(data.legendary_actions_text ?? ''),
    }
  }

  if (type === 'equipment') {
    return {
      category:                   String(data.category ?? 'Other'),
      cost:                       String(data.cost ?? ''),
      weight:                     Number(data.weight ?? 0),
      description:                String(data.description ?? ''),
      weapon_damage:              String(data.weapon_damage ?? ''),
      weapon_type:                String(data.weapon_type ?? ''),
      weapon_properties:          String(data.weapon_properties ?? ''),
      armor_base_ac:              Number(data.armor_base_ac ?? 0),
      armor_dex_cap:              data.armor_dex_cap != null ? Number(data.armor_dex_cap) : null,
      armor_min_str:              data.armor_min_str != null ? Number(data.armor_min_str) : null,
      armor_stealth_disadvantage: Boolean(data.armor_stealth_disadvantage),
    }
  }

  if (type === 'subclass') {
    return {
      class_name:   String(data.class_name ?? ''),
      name:         String(data.name ?? ''),
      description:  String(data.description ?? ''),
      unlock_level: Number(data.unlock_level ?? 3),
      features:     Array.isArray(data.features) ? data.features : [],
    }
  }

  throw new Error(`Unknown content type: ${type}`)
}

// ── Helpers for the save step ─────────────────────────────────────────────────

// Returns the display name from extracted data (name lives at top level for all types)
export function extractedName(data) {
  return data?.name || ''
}

// CR string → XP value lookup (standard D&D 5e table)
export const CR_TO_XP = {
  '0': 10, '1/8': 25, '1/4': 50, '1/2': 100,
  '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800,
  '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900,
  '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000,
  '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000,
  '21': 33000, '22': 41000, '23': 50000, '24': 62000, '30': 155000,
}
