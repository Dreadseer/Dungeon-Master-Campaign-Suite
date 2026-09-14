// AI session recaps (Phase 6 task 8).
//
// Two audiences, and the difference between them is a safety property rather
// than a wording preference:
//
//   'dm'      — everything: notes, secrets, unrevealed lore, the lot.
//   'players' — only what the party has actually been shown.
//
// The player variant works by FILTERING THE INPUT, not by instructing the model
// to withhold. A model told "do not mention the traitor" will mention the
// traitor — it has the fact in context and the instruction is one line against
// it. Material the players have not seen never reaches the request at all, so
// there is nothing to leak.
//
// One honest limitation, documented rather than papered over: `sessions.notes`
// is free text. A DM who writes "Sera is secretly the traitor" in the notes has
// put a secret somewhere no structural filter can find. The player prompt says
// so and asks for only what the party witnessed, but the notes themselves are
// passed through. That is a prompt-level mitigation, not a guarantee, and the
// UI says as much before the DM shares a player recap.
import { extractJsonValue } from './compendiumExtractor'

export const RECAP_AUDIENCES = ['dm', 'players']

const str = (v) => (v == null ? '' : String(v).trim())

/** Does the reveals list cover this entity? */
export function isRevealed(reveals, entityType, entityId) {
  return (reveals ?? []).some(r =>
    r && r.entity_type === entityType && Number(r.entity_id) === Number(entityId))
}

/**
 * Assemble the material a recap is written from.
 *
 * For 'players', anything the party has not been shown is removed here — which
 * is the whole point. `campaignReveals` is every reveal in the campaign, not
 * just this session's: something revealed three sessions ago is still known.
 *
 * @returns {{ notes, plots, reveals, lore, npcs, omitted: number }}
 */
export function buildRecapInput({
  session, plots = [], sessionReveals = [], campaignReveals = null, lore = [], npcs = [],
} = {}, { audience = 'dm' } = {}) {
  const forPlayers = audience === 'players'
  // Everything the party is known to have seen. A reveal row IS the record of
  // having been shown something, so this session's reveals always count.
  const known = [...(campaignReveals ?? []), ...(sessionReveals ?? [])]

  // Threads that changed state in this session — the spine of any recap.
  const sessionPlots = (plots ?? []).filter(p =>
    p && (p.opened_session_id === session?.id || p.resolved_session_id === session?.id))

  let omitted = 0

  // Lore surfaced in this session. Note there is no is_secret test here: a
  // reveal row means the party WAS shown it, so testing the secret flag against
  // the same list it came from could never fail. Secrecy is decided below, for
  // the entries that have no reveal row at all.
  const loreById = new Map((lore ?? []).map(l => [Number(l.id), l]))
  const revealedLore = []
  const seenLore = new Set()
  for (const r of sessionReveals ?? []) {
    if (r?.entity_type !== 'lore') continue
    const entry = loreById.get(Number(r.entity_id))
    if (!entry) continue
    seenLore.add(Number(entry.id))
    revealedLore.push({ name: str(entry.name), content: str(entry.content), revealed: true })
  }

  // Secret lore the DM holds that the party has NOT been shown. Useful context
  // for the DM's own recap ("what they still do not know"); never for players.
  for (const entry of lore ?? []) {
    if (!entry || seenLore.has(Number(entry.id))) continue
    if (!entry.is_secret) continue
    if (isRevealed(known, 'lore', entry.id)) continue
    if (forPlayers) { omitted++; continue }
    revealedLore.push({ name: str(entry.name), content: str(entry.content), revealed: false })
  }

  // NPCs who came up. Their `secrets` column never goes in a player recap.
  const npcById = new Map((npcs ?? []).map(n => [Number(n.id), n]))
  const involvedNpcs = []
  for (const r of sessionReveals ?? []) {
    if (r?.entity_type !== 'npc') continue
    const npc = npcById.get(Number(r.entity_id))
    if (!npc) continue
    if (forPlayers && npc.secrets) omitted++
    involvedNpcs.push({
      name: str(npc.name),
      role: str(npc.role),
      secrets: forPlayers ? '' : str(npc.secrets),
    })
  }

  return {
    notes: str(session?.notes),
    plots: sessionPlots.map(p => ({
      title: str(p.title),
      status: str(p.status),
      openedHere: p.opened_session_id === session?.id,
      closedHere: p.resolved_session_id === session?.id,
      // A thread's description can carry the twist behind it.
      description: forPlayers ? '' : str(p.description),
    })),
    lore: revealedLore,
    npcs: involvedNpcs,
    omitted,
  }
}

/**
 * Build the { system, user } pair for a recap.
 *
 * Plain prose out, not JSON: a recap is read by a human, and asking a model for
 * JSON-wrapped prose only adds a parse step that can fail.
 */
export function buildRecapPrompt(input, { audience = 'dm', session, campaign } = {}) {
  const forPlayers = audience === 'players'

  const system = [
    'You write recaps of Dungeons & Dragons sessions.',
    forPlayers
      ? 'You are writing for the PLAYERS. Write only what their characters saw, heard or did. Never mention a plan, motive, twist or identity the party has not discovered — if the notes hint at something the characters do not know, leave it out entirely.'
      : 'You are writing for the Dungeon Master\'s own records. Include everything that matters, secrets and unresolved threads included.',
    'Write flowing prose in the past tense, two or three short paragraphs. No headings, no bullet points, no preamble such as "Here is the recap".',
    'Use only what you are given. Do not invent events, names or outcomes.',
    forPlayers
      ? 'Address the players as "you" collectively where it reads naturally.'
      : 'Refer to the party and NPCs by name.',
  ].join('\n')

  const sections = []

  if (input.notes) {
    sections.push(
      forPlayers
        // Said plainly because the notes cannot be structurally filtered.
        ? `The DM's notes for this session (these are private notes and may mention things the characters never learned — retell only what the party themselves witnessed):\n${input.notes}`
        : `Session notes:\n${input.notes}`,
    )
  }

  if (input.plots?.length) {
    sections.push('Plot threads that changed this session:\n' + input.plots.map(p =>
      `- "${p.title}" (${p.status})${p.openedHere ? ' — opened this session' : ''}${p.closedHere ? ' — closed this session' : ''}${p.description ? `: ${p.description}` : ''}`,
    ).join('\n'))
  }

  const learned = (input.lore ?? []).filter(l => l.revealed !== false)
  if (learned.length) {
    sections.push('What the party learned this session:\n' + learned.map(l =>
      `- ${l.name}${l.content ? `: ${l.content}` : ''}`).join('\n'))
  }

  // DM-only: this section is never built for players, because buildRecapInput
  // does not put unrevealed entries in their input at all.
  const stillHidden = (input.lore ?? []).filter(l => l.revealed === false)
  if (stillHidden.length) {
    sections.push('Still hidden from the party (DM only, for your own reference):\n' + stillHidden.map(l =>
      `- ${l.name}${l.content ? `: ${l.content}` : ''}`).join('\n'))
  }

  if (input.npcs?.length) {
    sections.push('NPCs the party met:\n' + input.npcs.map(n =>
      `- ${n.name}${n.role ? ` (${n.role})` : ''}${n.secrets ? ` [DM only: ${n.secrets}]` : ''}`).join('\n'))
  }

  const user = [
    campaign?.name ? `Campaign: "${campaign.name}"` : '',
    session ? `Session ${session.session_number ?? '?'}${session.title ? ` — ${session.title}` : ''}` : '',
    '',
    sections.join('\n\n'),
    '',
    forPlayers
      ? 'Write the recap to read aloud at the start of the next session.'
      : 'Write the recap for the DM\'s records.',
  ].filter(l => l !== '').join('\n')

  return { system, user }
}

/**
 * Clean a recap for storage.
 *
 * Models add "Here is the recap:" and wrap prose in fences however firmly the
 * prompt says not to.
 */
export function parseRecap(rawText) {
  let text = str(rawText)
  if (!text) return ''

  // A model that returned JSON despite being asked for prose.
  if (text.startsWith('{') || text.startsWith('```json')) {
    try {
      const data = extractJsonValue(text, { allowArray: false })
      const found = data?.recap ?? data?.summary ?? data?.text
      if (found) return str(found)
    } catch { /* not JSON after all — fall through */ }
  }

  text = text.replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').trim()
  // Strip a leading label, with or without a bold marker.
  text = text.replace(/^\**\s*(here(?:'s| is) (?:the |your )?)?(recap|summary)\s*:?\**\s*\n+/i, '')
  return text.trim()
}

/** Is there anything worth writing a recap from? */
export function hasRecapMaterial(input) {
  if (!input) return false
  return Boolean(input.notes) || input.plots?.length > 0
    || input.lore?.length > 0 || input.npcs?.length > 0
}
