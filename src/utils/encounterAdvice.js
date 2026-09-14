// Encounter advisor — structured, appliable suggestions (Phase 6 task 5).
//
// The advisor used to ask for "2-3 specific, actionable suggestions" as prose
// and render the reply as text. The DM read "drop one goblin and add an
// archer", then went and did it by hand in the roster.
//
// The model now answers with operations against the roster, and each one gets
// an Apply button. Everything here is pure: applying an operation is a
// transformation of the monsters array, so the awkward cases — a count of
// zero, removing more than are present, a monster the model invented — are
// tested rather than discovered when a roster silently empties itself.
import { extractJsonValue } from './compendiumExtractor'

export const ADVICE_ACTIONS = ['add', 'remove', 'replace']

const str = (v) => (v == null ? '' : String(v).trim())
const key = (v) => str(v).toLowerCase().replace(/\s+/g, ' ')

const ADVICE_SCHEMA = `{
  "summary": string (one sentence on how the encounter plays as it stands),
  "suggestions": [
    {
      "action": "add" | "remove" | "replace",
      "monster_index": string (the SRD index of the monster to add/remove, e.g. "goblin", "orc-war-chief"),
      "monster_name": string (its display name, e.g. "Goblin"),
      "count": number (how many to add or remove, at least 1),
      "replace_with_index": string (ONLY for "replace" — the SRD index of the replacement),
      "replace_with_name": string (ONLY for "replace" — its display name),
      "reason": string (one sentence: why this helps)
    }
  ]
}`

/**
 * Build the { system, user } pair for the advisor.
 *
 * The roster is given with the SRD indexes the model must answer with, because
 * a suggestion naming "the big orc" cannot be applied to anything.
 */
export function buildAdvicePrompt({ encounter, monsters = [], partySize, avgLevel, difficulty, adjustedXp, thresholds = [] } = {}) {
  const roster = monsters.length
    ? monsters.map(m => `- ${m.count}× ${m.name} (CR ${m.cr ?? '?'}, index "${m.source_index ?? 'unknown'}", ${m.xp ?? 0} XP each)`).join('\n')
    : '(empty)'

  const [easy, medium, hard, deadly] = thresholds

  return {
    system: [
      'You are an expert D&D 5e encounter designer advising a Dungeon Master.',
      'Return ONLY valid JSON — no markdown fences, no explanations, no extra text.',
      'Every suggestion must be an operation on the roster that the app can apply directly.',
      'Use the exact "index" value given for a monster already in the roster. For a monster that is NOT in the roster, use its standard SRD index in lowercase with hyphens (for example "goblin", "orc-war-chief", "young-red-dragon").',
      'Only suggest monsters from the D&D 5e SRD. Do not invent creatures.',
      '"count" is always a positive whole number. Never suggest removing more of a monster than the roster contains.',
      'Give two or three suggestions. If the encounter is already well balanced, return an empty suggestions array and say so in the summary.',
    ].join('\n'),

    user: [
      `Encounter: "${encounter?.name ?? 'Unnamed'}"`,
      `Party: ${partySize} player${partySize === 1 ? '' : 's'}, average level ${avgLevel}`,
      `Current difficulty: ${difficulty ?? 'unknown'} (${Number(adjustedXp ?? 0).toLocaleString()} adjusted XP)`,
      thresholds.length === 4
        ? `Party thresholds — easy ${easy}, medium ${medium}, hard ${hard}, deadly ${deadly}`
        : '',
      '',
      'Roster:',
      roster,
      '',
      'What adjustments would make this encounter better balanced? Return ONLY this JSON:',
      ADVICE_SCHEMA,
    ].filter(l => l !== '').join('\n'),
  }
}

/**
 * Parse the advisor's reply.
 *
 * A malformed suggestion is dropped rather than failing the batch, and the
 * summary survives even when every suggestion is unusable — "this is already
 * well balanced" is a useful answer on its own.
 */
export function parseAdvice(rawText) {
  const data = extractJsonValue(rawText, { allowArray: false })

  const raw = Array.isArray(data?.suggestions) ? data.suggestions : []
  const suggestions = []

  for (const entry of raw) {
    const one = normaliseAdvice(entry)
    if (one) suggestions.push(one)
  }

  return { summary: str(data?.summary), suggestions }
}

export function normaliseAdvice(entry) {
  if (!entry || typeof entry !== 'object') return null

  const action = str(entry.action).toLowerCase()
  if (!ADVICE_ACTIONS.includes(action)) return null

  const monsterIndex = key(entry.monster_index)
  const monsterName = str(entry.monster_name) || str(entry.monster_index)
  if (!monsterIndex && !monsterName) return null

  // A count of 0 or -3 would silently do nothing or invert the operation.
  const count = Math.max(1, Math.floor(Number(entry.count) || 1))

  const out = {
    action, monsterIndex, monsterName, count,
    reason: str(entry.reason),
    replaceWithIndex: key(entry.replace_with_index),
    replaceWithName: str(entry.replace_with_name),
  }

  // A replace with nothing to replace it with is an ambiguous removal, not a
  // replacement — refuse it rather than guessing.
  if (action === 'replace' && !out.replaceWithIndex && !out.replaceWithName) return null

  return out
}

/** Find a roster entry by SRD index, falling back to its display name. */
export function findRosterEntry(monsters, index, name) {
  if (!Array.isArray(monsters)) return null
  return monsters.find(m => index && key(m.source_index) === key(index))
    ?? monsters.find(m => name && key(m.name) === key(name))
    ?? null
}

/**
 * Can this suggestion be applied to the roster as it stands?
 *
 * Returns why not, so the button can be disabled with a reason rather than
 * failing silently on click.
 *
 * @returns {{ ok: boolean, needsLookup?: boolean, reason?: string }}
 */
export function checkAdvice(suggestion, monsters = []) {
  if (!suggestion) return { ok: false, reason: 'Malformed suggestion' }

  const target = findRosterEntry(monsters, suggestion.monsterIndex, suggestion.monsterName)

  if (suggestion.action === 'remove') {
    if (!target) return { ok: false, reason: `${suggestion.monsterName} is not in this encounter` }
    return { ok: true }
  }

  if (suggestion.action === 'add') {
    // Already present: applying is a count bump, which needs no stat block.
    return target ? { ok: true } : { ok: true, needsLookup: true }
  }

  // replace
  if (!target) return { ok: false, reason: `${suggestion.monsterName} is not in this encounter` }
  const replacement = findRosterEntry(monsters, suggestion.replaceWithIndex, suggestion.replaceWithName)
  return replacement ? { ok: true } : { ok: true, needsLookup: true }
}

/**
 * Apply a suggestion to the roster.
 *
 * Pure: returns a NEW monsters array and never mutates the one given.
 *
 * `newEntry` is a roster entry built by the caller from an SRD stat block, for
 * the cases checkAdvice flagged as needsLookup. Without it, an add/replace of a
 * monster not already present is a no-op rather than a half-written entry.
 *
 * @returns {{ monsters: Array, changed: boolean, note: string }}
 */
export function applyAdvice(suggestion, monsters = [], newEntry = null) {
  const list = Array.isArray(monsters) ? monsters : []
  const target = findRosterEntry(list, suggestion?.monsterIndex, suggestion?.monsterName)

  if (suggestion?.action === 'remove') {
    if (!target) return { monsters: list, changed: false, note: 'Nothing to remove' }
    const remaining = (target.count ?? 1) - suggestion.count
    if (remaining <= 0) {
      return {
        monsters: list.filter(m => m !== target),
        changed: true,
        note: `Removed ${target.name}`,
      }
    }
    return {
      monsters: list.map(m => m === target ? { ...m, count: remaining } : m),
      changed: true,
      note: `${target.name} ×${target.count ?? 1} → ×${remaining}`,
    }
  }

  if (suggestion?.action === 'add') {
    if (target) {
      const next = (target.count ?? 1) + suggestion.count
      return {
        monsters: list.map(m => m === target ? { ...m, count: next } : m),
        changed: true,
        note: `${target.name} ×${target.count ?? 1} → ×${next}`,
      }
    }
    if (!newEntry) return { monsters: list, changed: false, note: 'Stat block not found' }
    return {
      monsters: [...list, { ...newEntry, count: suggestion.count }],
      changed: true,
      note: `Added ${suggestion.count}× ${newEntry.name}`,
    }
  }

  if (suggestion?.action === 'replace') {
    if (!target) return { monsters: list, changed: false, note: 'Nothing to replace' }

    // Take out however many the suggestion names, then put the replacement in.
    const removed = applyAdvice(
      { ...suggestion, action: 'remove' }, list,
    )

    const existingReplacement = findRosterEntry(
      removed.monsters, suggestion.replaceWithIndex, suggestion.replaceWithName)

    if (existingReplacement) {
      const next = (existingReplacement.count ?? 1) + suggestion.count
      return {
        monsters: removed.monsters.map(m => m === existingReplacement ? { ...m, count: next } : m),
        changed: true,
        note: `${target.name} → ${existingReplacement.name} ×${suggestion.count}`,
      }
    }

    if (!newEntry) return { monsters: list, changed: false, note: 'Stat block not found' }
    return {
      monsters: [...removed.monsters, { ...newEntry, count: suggestion.count }],
      changed: true,
      note: `${target.name} → ${newEntry.name} ×${suggestion.count}`,
    }
  }

  return { monsters: list, changed: false, note: 'Unknown action' }
}

/** XP total for the roster, matching how MonsterRoster computes it before saving. */
export function rosterXpTotal(monsters = []) {
  return (Array.isArray(monsters) ? monsters : [])
    .reduce((sum, m) => sum + (m.xp ?? 0) * (m.count ?? 1), 0)
}

/** A short human label for the operation, used on the Apply button. */
export function describeAdvice(suggestion) {
  if (!suggestion) return ''
  const n = suggestion.count
  if (suggestion.action === 'add') return `Add ${n}× ${suggestion.monsterName}`
  if (suggestion.action === 'remove') return `Remove ${n}× ${suggestion.monsterName}`
  return `Replace ${n}× ${suggestion.monsterName} with ${suggestion.replaceWithName || suggestion.replaceWithIndex}`
}
