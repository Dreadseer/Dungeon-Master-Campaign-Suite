// Structured world-building suggestions — prompt, parse, normalise, save.
//
// Phase 6 task 1-2. Before this, the World Builder's AI panel called
// ai.complete once and rendered the reply as <p> lines split on newlines. There
// was no Save, no Apply, no Accept: a DM who liked an idea re-typed it by hand
// into three separate forms.
//
// Everything here is pure so the awkward parts — a model inventing a location
// type the database will reject, two suggestions claiming the same name, a link
// pointing at something that was never saved — are pinned down by tests rather
// than discovered when an INSERT fails mid-save.
//
// The JSON repair rules are NOT reimplemented here; extractJsonObject in
// compendiumExtractor.js is the one parser, shared with the PDF importers.
import { extractJsonValue, repairTruncatedJson } from './compendiumExtractor.js'

/** The four things the World Builder can hold, and the four the AI may propose. */
export const SUGGESTION_KINDS = ['npc', 'location', 'faction', 'lore']

/**
 * `locations.type` carries a CHECK constraint
 * (`DatabaseService.js` — town/dungeon/shop/region/landmark). A model asked for
 * a thieves' guild will happily answer `"type": "guildhall"`, and the INSERT
 * then fails with a constraint error the DM cannot act on. Anything unrecognised
 * becomes 'landmark', which is the vaguest of the five and the safest default.
 */
export const LOCATION_TYPES = ['town', 'dungeon', 'shop', 'region', 'landmark']

const LOCATION_TYPE_ALIASES = {
  city: 'town', village: 'town', settlement: 'town', hamlet: 'town', capital: 'town',
  tavern: 'shop', inn: 'shop', store: 'shop', market: 'shop', guildhall: 'shop',
  ruin: 'dungeon', ruins: 'dungeon', crypt: 'dungeon', lair: 'dungeon', cave: 'dungeon',
  kingdom: 'region', realm: 'region', province: 'region', forest: 'region', wilderness: 'region',
  monument: 'landmark', temple: 'landmark', shrine: 'landmark', tower: 'landmark',
}

export function normaliseLocationType(raw) {
  const value = String(raw ?? '').trim().toLowerCase()
  if (LOCATION_TYPES.includes(value)) return value
  return LOCATION_TYPE_ALIASES[value] ?? 'landmark'
}

const str = (v) => (v == null ? '' : String(v).trim())

/** Names are matched loosely — a model will not reproduce capitalisation exactly. */
export const nameKey = (v) => str(v).toLowerCase().replace(/\s+/g, ' ')

// ── The prompt ───────────────────────────────────────────────────────────────

const SUGGESTION_SCHEMA = `{
  "suggestions": [
    {
      "kind": "npc" | "location" | "faction" | "lore",
      "name": string (the thing's name, unique within this response),
      "fields": {
        // for kind "npc":      { "race": string, "class": string, "role": string, "motivation": string, "secrets": string, "notes": string }
        // for kind "location": { "type": "town"|"dungeon"|"shop"|"region"|"landmark", "description": string, "lore": string }
        // for kind "faction":  { "description": string, "alignment": string, "notes": string }
        // for kind "lore":     { "content": string, "category": string, "is_secret": boolean }
      },
      "links": [
        { "to": string (the name of another thing, from this response or the existing world), "relationship": string (a short phrase, e.g. "leads", "operates from", "rivals") }
      ]
    }
  ]
}`

/**
 * Build the { system, user } pair for a structured suggestion request.
 *
 * Prompt discipline is copied from buildExtractionPrompt: state the output
 * contract, forbid prose around it, and say what to do when a field is unknown.
 *
 * @param {object} opts
 *   campaign      — the active campaign row
 *   request       — free text from the DM, or '' for the generic ask
 *   count         — how many things to propose when there is no specific request
 *   context       — a pre-budgeted world summary (see aiContext.js), or ''
 *   existingNames — names already in the world, so the model does not re-invent them
 */
export function buildSuggestionPrompt({ campaign, request = '', count = 3, context = '', existingNames = [] } = {}) {
  const wants = str(request)

  const system = [
    'You are an expert D&D 5e world-building assistant for a Dungeon Master.',
    'You propose concrete, saveable world entities — never vague advice.',
    'Return ONLY valid JSON — no markdown fences, no explanations, no extra text.',
    'Every suggestion must be something that can be written down as a record: a named NPC, a named location, a named faction, or a titled piece of lore.',
    'Use "" for string fields you cannot determine, false for booleans, and [] for links. Never invent a field name that is not in the schema.',
    'Names must be unique within your response and must not repeat anything in the existing world list.',
    'Use "links" to connect what you propose — to each other and to things that already exist. A suggestion set that connects to nothing is a poor one.',
    'For a location, "type" MUST be exactly one of: town, dungeon, shop, region, landmark. Pick the closest fit.',
    'Keep descriptions to two or three sentences. This is a database record, not prose.',
  ].join('\n')

  const user = [
    campaign?.name
      ? `Campaign: "${campaign.name}"${campaign.world_setting ? ` — set in ${campaign.world_setting}` : ''}`
      : 'Campaign: (unnamed)',
    '',
    context ? `Here is what already exists in this world:\n${context}\n` : '',
    existingNames.length
      ? `Do not propose anything already named here: ${existingNames.slice(0, 60).join(', ')}\n`
      : '',
    wants
      // The four kinds are spelled out as a required checklist rather than
      // "typically". Asked the softer way, an 8B local model reliably returned
      // a faction, an NPC and a location and simply omitted the lore entry —
      // which is the one that carries the DM's actual fiction.
      ? [
        `The DM asks for: ${wants}`,
        '',
        'Propose everything needed to make that real in the campaign. Your response MUST include all four of these:',
        '  1. a "faction" — the group itself',
        '  2. an "npc" — the person who runs or represents it',
        '  3. a "location" — where it operates from',
        '  4. a "lore" entry — the history or rumour that explains it, with real prose in its "content" field',
        '',
        'Then link them to each other with "links", and to anything in the existing world they would plausibly touch.',
      ].join('\n')
      : `Propose ${count} additions that would develop this world further. Include at least one "lore" entry among them. Link them to each other and to what already exists.`,
    '',
    'Return ONLY this JSON:',
    SUGGESTION_SCHEMA,
  ].filter(l => l !== '').join('\n')

  return { system, user }
}

/**
 * Build the { system, user } pair for pulling records out of text the model
 * already wrote — the AI Assistant's "Save as…".
 *
 * Not buildSuggestionPrompt with a different request: that prompt's "MUST
 * include all four" checklist is right for "invent me a guild" and wrong here.
 * Handed a table of ten NPCs, it told the model to also invent a faction, a
 * location and a lore entry the text never mentioned — and those, plus
 * indented JSON, ran the reply past its token ceiling mid-record.
 */
export function buildExtractPrompt({ campaign, sourceText = '', context = '' } = {}) {
  const { system } = buildSuggestionPrompt({ campaign })

  const user = [
    campaign?.name
      ? `Campaign: "${campaign.name}"${campaign.world_setting ? ` — set in ${campaign.world_setting}` : ''}`
      : 'Campaign: (unnamed)',
    '',
    context ? `Here is what already exists in this world:\n${context}\n` : '',
    'Extract every concrete NPC, location, faction and piece of lore described in the text below, exactly as described.',
    'Return only the kinds the text actually contains — if it only describes NPCs, return only NPCs. Do not invent anything that is not there.',
    'Keep everything the text says about each one. For an NPC, put their job or position in "role", and their appearance, hooks and quirks in "notes".',
    'Only add a link when the text states the connection.',
    'Write the JSON compactly, without indentation, so that long lists fit.',
    '',
    'Return ONLY this JSON:',
    SUGGESTION_SCHEMA,
    '',
    '--- The text to extract from ---',
    str(sourceText),
  ].filter(l => l !== '').join('\n')

  return { system, user }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Turn raw model output into normalised suggestions.
 *
 * Anything unusable is dropped rather than thrown on: a model that returns four
 * good suggestions and one with no name should give the DM four cards, not an
 * error. A response with nothing usable in it returns an empty array, and the
 * caller tells the DM to try again.
 *
 * A reply cut off mid-record (the model ran out of output tokens) keeps every
 * suggestion that was complete, and says so with `truncated`.
 *
 * @returns {{ suggestions: Array, dropped: number, truncated: boolean }}
 */
export function parseSuggestions(rawText) {
  // allowArray: asked for { suggestions: [...] }, local models often answer
  // with just the array. Both shapes are accepted.
  let data
  let truncated = false
  try {
    data = extractJsonValue(rawText)
  } catch (err) {
    data = repairTruncatedJson(rawText)
    if (data == null) throw err
    truncated = true
  }

  const raw = Array.isArray(data?.suggestions) ? data.suggestions
    : Array.isArray(data) ? data
      : null
  if (!raw) return { suggestions: [], dropped: 0, truncated }

  const seen = new Set()
  const suggestions = []
  let dropped = 0

  for (const entry of raw) {
    const one = normaliseSuggestion(entry)
    if (!one) { dropped++; continue }
    // A model asked for a guild sometimes proposes the same NPC twice.
    if (seen.has(one.kind + '::' + nameKey(one.name))) { dropped++; continue }
    seen.add(one.kind + '::' + nameKey(one.name))
    suggestions.push(one)
  }

  return { suggestions, dropped, truncated }
}

/** One suggestion, with every field coerced to the type the save step expects. */
export function normaliseSuggestion(entry) {
  if (!entry || typeof entry !== 'object') return null

  const kind = str(entry.kind).toLowerCase()
  if (!SUGGESTION_KINDS.includes(kind)) return null

  const name = str(entry.name)
  if (!name) return null

  const f = (entry.fields && typeof entry.fields === 'object') ? entry.fields : {}

  let fields
  if (kind === 'npc') {
    fields = {
      race: str(f.race), class: str(f.class), role: str(f.role),
      motivation: str(f.motivation), secrets: str(f.secrets), notes: str(f.notes),
    }
  } else if (kind === 'location') {
    fields = {
      type: normaliseLocationType(f.type),
      description: str(f.description), lore: str(f.lore),
    }
  } else if (kind === 'faction') {
    fields = {
      description: str(f.description), alignment: str(f.alignment), notes: str(f.notes),
    }
  } else {
    fields = {
      content: str(f.content ?? f.description),
      category: str(f.category) || 'General',
      is_secret: Boolean(f.is_secret),
    }
  }

  const links = (Array.isArray(entry.links) ? entry.links : [])
    .map(l => ({ to: str(l?.to), relationship: str(l?.relationship) }))
    .filter(l => l.to)

  return { kind, name, fields, links }
}

// ── Saving ───────────────────────────────────────────────────────────────────

/**
 * The exact payload each existing create channel expects.
 *
 * These four shapes are read straight off the INSERT statements in
 * dbHandlers.js. Getting one wrong is a silent column of NULLs, not an error.
 */
export function toCreatePayload(suggestion, campaignId) {
  const { kind, name, fields } = suggestion
  if (kind === 'npc') {
    return {
      campaign_id: campaignId, name,
      race: fields.race, class: fields.class, role: fields.role,
      location_id: null, faction_id: null,
      notes: fields.notes, secrets: fields.secrets, motivation: fields.motivation,
    }
  }
  if (kind === 'location') {
    return {
      campaign_id: campaignId, name,
      type: fields.type, description: fields.description, lore: fields.lore,
      parent_location_id: null, has_own_map: false, floor_number: null,
    }
  }
  if (kind === 'faction') {
    return {
      campaign_id: campaignId, name,
      description: fields.description, alignment: fields.alignment, notes: fields.notes,
    }
  }
  return {
    campaign_id: campaignId, name,
    content: fields.content, category: fields.category, is_secret: fields.is_secret,
  }
}

/** The connections table names lore rows 'lore'; the others match their kind. */
const CONNECTION_ENTITY_TYPE = { npc: 'npc', location: 'location', faction: 'faction', lore: 'lore' }

/**
 * Build an index of name → { type, id } from things that exist.
 *
 * `saved` is what the current batch just wrote; `existing` is the world as it
 * already was. Saved entries win a name collision, because a link inside one
 * response almost certainly means the thing in that response.
 */
export function buildEntityIndex({ saved = [], existing = {} } = {}) {
  const index = new Map()

  const add = (type, id, name) => {
    const key = nameKey(name)
    if (!key || id == null) return
    if (!index.has(key)) index.set(key, { type, id, name: str(name) })
  }

  for (const s of saved) add(CONNECTION_ENTITY_TYPE[s.kind] ?? s.kind, s.id, s.name)

  for (const npc of existing.npcs ?? []) add('npc', npc.id, npc.name)
  for (const loc of existing.locations ?? []) add('location', loc.id, loc.name)
  for (const fac of existing.factions ?? []) add('faction', fac.id, fac.name)
  for (const lore of existing.lore ?? []) add('lore', lore.id, lore.name)

  return index
}

/**
 * Turn each suggestion's `links` into connections rows.
 *
 * A link whose target cannot be resolved is reported rather than dropped
 * silently — the DM should be told "2 links could not be matched" instead of
 * quietly getting fewer connections than the card promised.
 *
 * Self-links and duplicates (including A→B when B→A is already present) are
 * removed: the connections table is undirected in practice, and the Mind Map
 * draws both as one edge.
 *
 * @returns {{ rows: Array, unresolved: Array<{from: string, to: string}> }}
 */
export function buildConnectionRows(suggestions, index, campaignId) {
  const rows = []
  const unresolved = []
  const seenPairs = new Set()

  for (const s of suggestions) {
    const from = index.get(nameKey(s.name))
    if (!from) continue          // this suggestion was not saved

    for (const link of s.links ?? []) {
      const to = index.get(nameKey(link.to))
      if (!to) { unresolved.push({ from: s.name, to: link.to }); continue }
      if (to.type === from.type && to.id === from.id) continue

      // Undirected: order the pair so A→B and B→A collapse to one row.
      const a = `${from.type}:${from.id}`
      const b = `${to.type}:${to.id}`
      const pair = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seenPairs.has(pair)) continue
      seenPairs.add(pair)

      rows.push({
        campaign_id: campaignId,
        entity_a_type: from.type, entity_a_id: from.id,
        entity_b_type: to.type,   entity_b_id: to.id,
        relationship: link.relationship || 'related to',
        notes: '',
      })
    }
  }

  return { rows, unresolved }
}

/** Which suggestions clash with something already in the world, by name. */
export function findNameClashes(suggestions, existing = {}) {
  const taken = buildEntityIndex({ existing })
  return suggestions
    .filter(s => taken.has(nameKey(s.name)))
    .map(s => ({ name: s.name, kind: s.kind, existingType: taken.get(nameKey(s.name)).type }))
}

// ── Contradiction check (task 7) ─────────────────────────────────────────────

/**
 * Ask the model whether a suggestion conflicts with lore the DM already has.
 *
 * Deliberately conservative in what it accepts back: an empty or unparseable
 * answer means "no conflicts found", never a blocked save. The button is an
 * advisory, and a broken advisory must not stop a DM writing to their own world.
 */
export function buildContradictionPrompt(suggestion, loreChunks = []) {
  const passages = loreChunks
    .map((c, i) => `--- Existing lore ${i + 1}${c.source ? ` (${c.source})` : ''} ---\n${str(c.text)}`)
    .join('\n\n')

  return {
    system: [
      'You check proposed D&D campaign additions against a world\'s established lore.',
      'Return ONLY valid JSON — no markdown fences, no explanations.',
      'Report a conflict ONLY when the proposal directly contradicts a stated fact. Do not report a conflict merely because the lore is silent on something, and do not report stylistic differences.',
      'Schema: { "conflicts": [ { "with": string (which lore), "issue": string (one sentence) } ], "verdict": "clear" | "conflicts" }',
    ].join('\n'),
    user: [
      `Proposed ${suggestion.kind}: "${suggestion.name}"`,
      JSON.stringify(suggestion.fields, null, 2),
      '',
      passages || '(no established lore was found for this topic)',
      '',
      'Return ONLY the JSON described in the system message.',
    ].join('\n'),
  }
}

export function parseContradictions(rawText) {
  let data
  try { data = extractJsonValue(rawText, { allowArray: false }) } catch { return { verdict: 'clear', conflicts: [] } }

  const conflicts = (Array.isArray(data?.conflicts) ? data.conflicts : [])
    .map(c => ({ with: str(c?.with), issue: str(c?.issue) }))
    .filter(c => c.issue)

  return { verdict: conflicts.length > 0 ? 'conflicts' : 'clear', conflicts }
}
