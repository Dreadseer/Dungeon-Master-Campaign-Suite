/**
 * Matching map tokens to combatants.
 *
 * The map and the initiative tracker hold two separate lists that describe the
 * same creatures, joined by nothing stronger than a name. Tokens pushed from the
 * tracker carry entity_type 'character' and the character's id for players, but
 * monsters get neither — they exist only in the encounter's JSON — so the label
 * is all there is to go on for them.
 *
 * Kept pure and separate from the components so the awkward cases (duplicate
 * names, renamed tokens, a token placed by hand) are pinned down by tests
 * rather than discovered mid-session.
 */

/** Names are compared loosely: a token label is typed by hand often enough. */
const norm = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : ''

/**
 * Find the combatant a token represents.
 *
 * Player tokens match on entity_id, which is reliable. Everything else matches
 * on name, which is not — so an ambiguous name matches nothing rather than
 * showing the DM one of two goblins' HP and letting them believe it.
 *
 * @param {object|null} token
 * @param {Array<object>} combatants
 * @returns {object|null}
 */
export function findCombatantForToken(token, combatants) {
  if (!token || !Array.isArray(combatants) || combatants.length === 0) return null

  if (token.entity_type === 'character' && token.entity_id != null) {
    const byId = combatants.find(c => c.is_player && c.entity_id === token.entity_id)
    if (byId) return byId
    // Fall through: a token can outlive the character link it was made with.
  }

  const label = norm(token.label)
  if (!label) return null

  const named = combatants.filter(c => norm(c.name) === label)
  return named.length === 1 ? named[0] : null
}

/**
 * Find the token that represents a combatant — the reverse, used to move the
 * map's selection as turns advance.
 *
 * @param {object|null} combatant
 * @param {Array<object>} tokens
 * @returns {object|null}
 */
export function findTokenForCombatant(combatant, tokens) {
  if (!combatant || !Array.isArray(tokens) || tokens.length === 0) return null

  if (combatant.is_player && combatant.entity_id != null) {
    const byId = tokens.find(t => t.entity_type === 'character' && t.entity_id === combatant.entity_id)
    if (byId) return byId
  }

  const name = norm(combatant.name)
  if (!name) return null

  const named = tokens.filter(t => norm(t.label) === name)
  return named.length === 1 ? named[0] : null
}

/**
 * The subset of a combatant the map needs.
 *
 * The tracker broadcasts its whole roster on every change, and the map window
 * only ever shows these five things — so this is what crosses the window
 * boundary, not the full combatant with its log ids and legendary counters.
 *
 * @param {Array<object>} combatants
 * @returns {Array<object>}
 */
export function summariseForMap(combatants) {
  if (!Array.isArray(combatants)) return []
  return combatants
    .filter(c => c && c.id != null)
    .map(c => ({
      id: c.id,
      name: c.name,
      entity_id: c.entity_id ?? null,
      is_player: !!c.is_player,
      is_active: !!c.is_active,
      hp_current: Number.isFinite(c.hp_current) ? c.hp_current : null,
      hp_max: Number.isFinite(c.hp_max) ? c.hp_max : null,
      temp_hp: Number.isFinite(c.temp_hp) ? c.temp_hp : 0,
      conditions: Array.isArray(c.conditions) ? [...c.conditions] : [],
    }))
}
