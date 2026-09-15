// AI encounter generation — the pure half (Phase 7 task 2).
//
// The capability review's Q8e is specific about the approach, and it is the
// reason this works on a small local model: do NOT ask the model to invent
// monsters. Pre-filter real ones by CR band, hand it that candidate list plus
// the XP budget, and ask it to SELECT and COMPOSE from what it was given. Every
// monster is then guaranteed to exist and every CR to be accurate, and the
// model is left with the one job it is actually good at — taste.
//
// Everything here is pure so the parts that decide whether a generated
// encounter is acceptable are testable: the budget check, the CR band, and the
// rejection rule. The AI call itself lives in the component.
import { extractJsonValue } from './compendiumExtractor.js'
import { crToXP, parseCR, adjustedXP, difficultyRating, partyThresholds } from './encounterUtils.js'

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'deadly']

/** Tier index, for measuring how far off a generated encounter landed. */
const TIER_INDEX = { trivial: 0, easy: 1, medium: 2, hard: 3, deadly: 4 }

const str = (v) => (v == null ? '' : String(v).trim())

/**
 * The CR band worth offering for a budget.
 *
 * A single monster should be able to spend a decent share of the budget without
 * one creature eating all of it, and the floor keeps the list from filling with
 * CR 0 chaff a DM would never pick. Deliberately generous at the low end: a
 * swarm of weak monsters is a legitimate answer, and the multiplier makes it
 * land correctly.
 *
 * @returns {{ min: number, max: number }} CR values, not XP
 */
export function crBandForBudget(budget, partySize = 4) {
  const perHead = Math.max(1, Number(budget) || 0) / Math.max(1, partySize)

  // Highest CR whose solo XP does not exceed the whole budget.
  let max = 0
  for (const [cr, xp] of Object.entries(CR_XP_ENTRIES)) {
    if (xp <= budget) max = Math.max(max, Number(cr))
  }

  // Floor: roughly an eighth of one character's share, so a horde is still on
  // the table but CR 0 is not offered for a level-10 party.
  let min = 0
  for (const [cr, xp] of Object.entries(CR_XP_ENTRIES)) {
    if (xp <= perHead / 8) min = Math.max(min, Number(cr))
  }

  return { min: Math.min(min, max), max: Math.max(max, min) }
}

// Local copy of the CR→XP pairs as entries, so the band scan does not depend on
// key ordering of the imported object.
const CR_XP_ENTRIES = Object.fromEntries(
  [0, 0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(cr => [cr, crToXP(cr)]),
)

/**
 * Narrow a monster list to plausible candidates.
 *
 * `environment` is matched loosely against name and type rather than filtered
 * on strictly — the SRD has no environment field, and a hard filter on a word
 * like "swamp" would return nothing at all. Matches are RANKED first, so a
 * small model sees the thematic ones at the top of a list it may not read to
 * the end of.
 */
export function candidateMonsters(monsters, { budget, partySize = 4, environment = '', limit = 60 } = {}) {
  const band = crBandForBudget(budget, partySize)
  const theme = str(environment).toLowerCase()
  const words = theme.split(/[^a-z]+/).filter(w => w.length > 3)

  const inBand = (Array.isArray(monsters) ? monsters : [])
    .filter(m => m && m.name && (m.index ?? m.id))
    .map(m => ({
      index: str(m.index ?? m.id),
      name: str(m.name),
      cr: parseCR(m.challenge_rating),
      xp: crToXP(m.challenge_rating),
      type: str(m.type),
      source: m.source ?? 'srd',
    }))
    .filter(m => m.cr >= band.min && m.cr <= band.max && m.xp > 0)

  const score = (m) => {
    if (words.length === 0) return 0
    const haystack = `${m.name} ${m.type}`.toLowerCase()
    return words.reduce((n, w) => n + (haystack.includes(w) ? 1 : 0), 0)
  }

  return inBand
    .map(m => ({ ...m, _score: score(m) }))
    .sort((a, b) => b._score - a._score || a.cr - b.cr || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit))
    .map(({ _score, ...m }) => m)
}

/**
 * Build the { system, user } pair.
 *
 * Prompt discipline copied from compendiumExtractor: state the contract, forbid
 * prose around it, and be explicit that the model may only choose from the list.
 */
export function buildGenerationPrompt({
  candidates = [], budget = 0, difficulty = 'medium',
  partySize = 4, avgLevel = 1, location = '', theme = '',
} = {}) {
  const list = candidates
    .map(c => `- ${c.name} | index: ${c.index} | CR ${c.cr} | ${c.xp} XP each${c.type ? ` | ${c.type}` : ''}`)
    .join('\n')

  return {
    system: [
      'You are an expert D&D 5e encounter designer.',
      'Return ONLY valid JSON — no markdown fences, no explanations, no extra text.',
      'You may ONLY use monsters from the candidate list you are given. Never invent a monster, and never use an index that is not in the list.',
      'Compose an encounter whose ADJUSTED XP is close to the target budget. Adjusted XP is the sum of (XP x count) multiplied by a factor for the total number of monsters: 1 monster x1, 2 x1.5, 3-6 x2, 7-10 x2.5, 11-14 x3, 15+ x4.',
      'Prefer two or three monster types over a single creature or a dozen identical ones, unless the theme calls for it.',
      'Schema: { "name": string, "monsters": [ { "index": string, "count": number } ], "tactics": string, "notes": string }',
      '"tactics" is one or two sentences on how they fight. "notes" is anything the DM should know before running it.',
    ].join('\n'),

    user: [
      `Target difficulty: ${difficulty} for ${partySize} character${partySize === 1 ? '' : 's'} of about level ${avgLevel}.`,
      `Target adjusted XP budget: ${budget}.`,
      location ? `Location: ${location}` : '',
      theme ? `Environment and theme: ${theme}` : '',
      '',
      'Candidate monsters — you may use ONLY these:',
      list || '(none)',
      '',
      'Return ONLY the JSON described in the system message.',
    ].filter(l => l !== '').join('\n'),
  }
}

/**
 * Parse a generated encounter.
 *
 * Anything that is not a usable selection is dropped rather than throwing, and
 * the caller decides whether what survived is enough.
 *
 * @returns {{ name, monsters: [{index, count}], tactics, notes, dropped }}
 */
export function parseGeneratedEncounter(rawText) {
  const data = extractJsonValue(rawText, { allowArray: false })

  const raw = Array.isArray(data?.monsters) ? data.monsters : []
  const monsters = []
  let dropped = 0

  for (const m of raw) {
    const index = str(m?.index ?? m?.monster_index ?? m?.slug)
    // A count of 0 would contribute nothing; a negative one would subtract XP.
    const count = Math.max(1, Math.floor(Number(m?.count) || 1))
    if (!index) { dropped++; continue }
    monsters.push({ index, count })
  }

  return {
    name: str(data?.name) || 'Generated encounter',
    monsters,
    tactics: str(data?.tactics),
    notes: str(data?.notes),
    dropped,
  }
}

/**
 * Drop any selection the model made up, and merge duplicate picks.
 *
 * The prompt forbids inventing monsters; this is what makes that guarantee real
 * rather than a request. A model that names three real monsters and one
 * invented one yields three, and the caller is told.
 *
 * @param selection from parseGeneratedEncounter
 * @param candidates the list the model was given
 * @returns {{ monsters: [{index, count, name, cr, xp, source}], invented: string[] }}
 */
export function resolveSelection(selection, candidates) {
  const byIndex = new Map((candidates ?? []).map(c => [c.index.toLowerCase(), c]))
  const merged = new Map()
  const invented = []

  for (const pick of selection?.monsters ?? []) {
    const found = byIndex.get(pick.index.toLowerCase())
    if (!found) { invented.push(pick.index); continue }
    const existing = merged.get(found.index)
    if (existing) existing.count += pick.count
    else merged.set(found.index, { ...found, count: pick.count })
  }

  return { monsters: [...merged.values()], invented }
}

/**
 * Is this encounter close enough to what was asked for?
 *
 * The brief's rule: reject and retry once if it is off by more than one tier.
 * Measured in TIERS rather than raw XP because a Hard encounter that lands
 * slightly into Deadly is a fine encounter, while one that lands on Trivial is
 * not — and the XP distance between those is very different at level 1 and
 * level 20.
 *
 * @returns {{ ok, adjusted, label, target, tiersOff, reason }}
 */
export function validateAgainstBudget(monsters, { characters = [], difficulty = 'medium' } = {}) {
  const partySize = Math.max(1, characters.length)
  const thresholds = partyThresholds(characters)

  const scored = (monsters ?? []).map(m => ({ ...m, xp: m.xp ?? crToXP(m.cr), count: m.count ?? 1 }))
  const adjusted = adjustedXP(scored, partySize)
  const { label } = difficultyRating(adjusted, thresholds)

  const target = str(difficulty).toLowerCase()
  const targetIndex = TIER_INDEX[target] ?? TIER_INDEX.medium
  const actualIndex = TIER_INDEX[label.toLowerCase()] ?? 0
  const tiersOff = actualIndex - targetIndex

  if (scored.length === 0) {
    return { ok: false, adjusted: 0, label: 'Trivial', target, tiersOff: -targetIndex, reason: 'no usable monsters' }
  }

  const ok = Math.abs(tiersOff) <= 1
  return {
    ok,
    adjusted,
    label,
    target,
    tiersOff,
    reason: ok ? '' : `rated ${label} against a ${difficulty} target — ${Math.abs(tiersOff)} tiers ${tiersOff > 0 ? 'too hard' : 'too easy'}`,
  }
}

/** A short line for the retry prompt, telling the model what went wrong. */
export function retryHint(validation, budget) {
  if (!validation || validation.ok) return ''
  return validation.tiersOff > 0
    ? `Your previous attempt was too strong (adjusted ${validation.adjusted} XP against a ${budget} XP budget, rated ${validation.label}). Use fewer or weaker monsters.`
    : `Your previous attempt was too weak (adjusted ${validation.adjusted} XP against a ${budget} XP budget, rated ${validation.label}). Use more or stronger monsters.`
}
