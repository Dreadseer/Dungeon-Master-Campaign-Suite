// Campaign context for AI prompts, under a character budget.
//
// Phase 6 task 6. buildSystemPrompt used to live in AIAssistant.jsx and
// interpolated *every* player character and *every* faction with no cap, so a
// campaign with 60 factions put 60 names into every single message — silently,
// with no truncation and no warning. It also showed the model no lore, no
// locations, no descriptions, and no plot: it knew a world had "12 locations"
// and not what any of them were.
//
// This module is pure so the budget can actually be asserted rather than
// assumed. It mirrors RAGService's maxContextLen approach (a character budget
// applied section by section) rather than counting tokens, because the app has
// no tokeniser and must not gain a dependency for one. Characters are a
// conservative proxy: roughly 4 characters per token for English prose, so a
// 6000-character budget is about 1500 tokens.

/** Default total budget, configurable in Settings (rag-settings.json). */
export const DEFAULT_CONTEXT_BUDGET = 6000

/** Below this there is no room for anything but the header — refuse to go lower. */
export const MIN_CONTEXT_BUDGET = 500

export const clampBudget = (value) => {
  // Number(null) is 0 and Number('') is 0, both finite — so an unset setting
  // would clamp to the MINIMUM budget rather than the default, quietly starving
  // every prompt in the app. Unset means unset.
  if (value == null || value === '') return DEFAULT_CONTEXT_BUDGET
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_CONTEXT_BUDGET
  return Math.max(MIN_CONTEXT_BUDGET, Math.min(50000, Math.round(n)))
}

const str = (v) => (v == null ? '' : String(v).trim())

/** One line, collapsed and cut to `max` characters on a word boundary if possible. */
export function oneLine(text, max = 120) {
  const flat = str(text).replace(/\s+/g, ' ')
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…'
}

/**
 * Fit as many items as the remaining budget allows.
 *
 * Returns the joined text plus how many were left out, so the prompt can say
 * "and 43 more" instead of pretending the world is smaller than it is. That
 * matters: a model told about 17 of 60 factions with no hint of the rest will
 * confidently assert those 17 are all of them.
 */
export function fitList(items, budget, { separator = ', ', moreLabel = 'more' } = {}) {
  const kept = []
  let used = 0

  for (const item of items) {
    const text = str(item)
    if (!text) continue
    const cost = used === 0 ? text.length : text.length + separator.length
    // Always leave room for the "and N more" tail.
    if (used + cost > budget - 16 && kept.length > 0) break
    if (used + cost > budget) break
    kept.push(text)
    used += cost
  }

  const omitted = items.filter(i => str(i)).length - kept.length
  let text = kept.join(separator)
  if (omitted > 0 && kept.length > 0) text += ` and ${omitted} ${moreLabel}`

  return { text, kept: kept.length, omitted }
}

// ── Section builders ─────────────────────────────────────────────────────────
//
// Order is priority order. Everything above a section gets its characters first,
// so when a world is too big to describe it is the long tail of NPC names that
// is lost, never the party or the session the DM is actually running.

function sectionCampaign(world) {
  const c = world.campaign
  if (!c?.name) return ''
  return `Campaign: "${c.name}"${c.world_setting ? ` — set in ${c.world_setting}` : ''}`
}

function sectionParty(world, budget) {
  const chars = world.characters ?? []
  if (chars.length === 0) return ''
  const described = chars.map(c =>
    `${str(c.character_name) || 'Unnamed'} (${str(c.race) || '?'} ${str(c.class) || '?'} Lv.${c.level ?? 1})`)
  const { text } = fitList(described, budget, { moreLabel: 'more party members' })
  return text ? `Party: ${text}` : ''
}

function sectionSession(world, budget) {
  const s = world.session
  if (!s) return ''
  const head = `Current session: #${s.session_number ?? '?'}${s.title ? ` — ${str(s.title)}` : ''}`
  const body = oneLine(s.recap || s.notes, Math.max(0, budget - head.length - 2))
  return body ? `${head}\n${body}` : head
}

function sectionPlots(world, budget) {
  const open = (world.plots ?? []).filter(p => p.status === 'open' || p.status === 'active')
  if (open.length === 0) return ''
  const described = open.map(p => {
    const d = oneLine(p.description, 70)
    return `${str(p.title)}${d ? ` — ${d}` : ''}`
  })
  const { text } = fitList(described, budget, { separator: '\n  • ', moreLabel: 'more open threads' })
  return text ? `Open plot threads:\n  • ${text}` : ''
}

function sectionLocations(world, budget) {
  const locs = world.locations ?? []
  if (locs.length === 0) return ''
  const described = locs.map(l => {
    const d = oneLine(l.description, 70)
    return `${str(l.name)}${l.type ? ` (${str(l.type)})` : ''}${d ? ` — ${d}` : ''}`
  })
  const { text } = fitList(described, budget, { separator: '\n  • ', moreLabel: 'more locations' })
  return text ? `Locations:\n  • ${text}` : ''
}

function sectionFactions(world, budget) {
  const facs = world.factions ?? []
  if (facs.length === 0) return ''
  const described = facs.map(f => {
    const d = oneLine(f.description, 50)
    return `${str(f.name)}${d ? ` — ${d}` : ''}`
  })
  const { text } = fitList(described, budget, { separator: '\n  • ', moreLabel: 'more factions' })
  return text ? `Factions:\n  • ${text}` : ''
}

function sectionNpcs(world, budget) {
  const npcs = world.npcs ?? []
  if (npcs.length === 0) return ''
  const described = npcs.map(n => {
    const role = str(n.role)
    return `${str(n.name)}${role ? ` (${role})` : ''}`
  })
  const { text } = fitList(described, budget, { moreLabel: 'more NPCs' })
  return text ? `NPCs: ${text}` : ''
}

function sectionLore(world, budget) {
  const lore = world.lore ?? []
  if (lore.length === 0) return ''
  // Titles only. The bodies are what retrieval is for (task 7) — putting them
  // here would consume the whole budget on whichever entries sorted first.
  const { text } = fitList(lore.map(l => str(l.name)), budget, { moreLabel: 'more lore entries' })
  return text ? `Lore entries on record: ${text}` : ''
}

/**
 * Sections in the order they are granted budget.
 *
 * `min` reserves a floor so a huge party cannot starve the session summary.
 * `weight` splits what remains after the reserved floors are met.
 */
const SECTIONS = [
  { name: 'campaign',  build: (w) => sectionCampaign(w),        fixed: true },
  { name: 'party',     build: (w, b) => sectionParty(w, b),     min: 200, weight: 1 },
  { name: 'session',   build: (w, b) => sectionSession(w, b),   min: 300, weight: 1 },
  { name: 'plots',     build: (w, b) => sectionPlots(w, b),     min: 300, weight: 1.5 },
  { name: 'locations', build: (w, b) => sectionLocations(w, b), min: 300, weight: 2 },
  { name: 'factions',  build: (w, b) => sectionFactions(w, b),  min: 200, weight: 1.5 },
  { name: 'npcs',      build: (w, b) => sectionNpcs(w, b),      min: 200, weight: 1.5 },
  { name: 'lore',      build: (w, b) => sectionLore(w, b),      min: 150, weight: 1 },
]

const HEADER = [
  'You are an AI assistant for a Dungeon Master running a D&D 5e campaign.',
  'Be helpful, creative, and specific. Keep responses concise and immediately usable at the game table.',
  'The campaign facts below are the established truth of this world — do not contradict them.',
].join('\n')

/**
 * Assemble the system prompt and report what it cost.
 *
 * @param {object} world   { campaign, characters, npcs, factions, locations, lore, session, plots }
 * @param {object} options { budget, header, extra }
 * @returns {{ prompt: string, usage: object }}
 */
export function buildCampaignContext(world = {}, options = {}) {
  const budget = clampBudget(options.budget ?? DEFAULT_CONTEXT_BUDGET)
  const header = options.header ?? HEADER

  // The header is not negotiable — it carries the instructions, not the facts.
  const forContext = Math.max(0, budget - header.length - 2)

  // Give every section its floor first, then share the remainder by weight.
  const flexible = SECTIONS.filter(s => !s.fixed)
  const reserved = flexible.reduce((sum, s) => sum + s.min, 0)
  const totalWeight = flexible.reduce((sum, s) => sum + s.weight, 0)
  const spare = Math.max(0, forContext - reserved)

  const parts = []
  const sections = []
  let used = 0

  for (const spec of SECTIONS) {
    const remaining = forContext - used

    let allowance
    if (spec.fixed) {
      allowance = remaining
    } else {
      // A section never gets more than what is actually left, so an early
      // section that overran cannot push the total past the budget.
      allowance = Math.min(remaining, spec.min + Math.floor((spare * spec.weight) / totalWeight))
    }

    const text = allowance > 0 ? spec.build(world, allowance) : ''
    const cost = text ? text.length + (parts.length ? 1 : 0) : 0

    if (text && used + cost <= forContext) {
      parts.push(text)
      used += cost
      sections.push({ name: spec.name, chars: text.length, included: true })
    } else {
      sections.push({ name: spec.name, chars: 0, included: false, reason: text ? 'no budget left' : 'empty' })
    }
  }

  const extra = str(options.extra)
  const prompt = [header, ...parts, extra].filter(Boolean).join('\n')

  return {
    prompt,
    usage: {
      total: prompt.length,
      budget,
      headerChars: header.length,
      contextChars: used,
      percent: Math.round((prompt.length / budget) * 100),
      overBudget: prompt.length > budget,
      sections,
    },
  }
}

/**
 * The same world summary without the assistant header — for the suggestion
 * panel, which supplies its own system prompt and wants only the facts.
 */
export function buildWorldSummary(world = {}, options = {}) {
  return buildCampaignContext(world, { ...options, header: '' }).prompt.trim()
}

/** Every name already in the world, for "do not propose these again". */
export function existingNames(world = {}) {
  return [
    ...(world.npcs ?? []).map(n => n.name),
    ...(world.locations ?? []).map(l => l.name),
    ...(world.factions ?? []).map(f => f.name),
    ...(world.lore ?? []).map(l => l.name),
  ].map(str).filter(Boolean)
}
