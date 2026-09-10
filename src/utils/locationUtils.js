// Locations form a tree via parent_location_id. Nothing in the database enforces
// that it stays a tree: SQLite has no way to express "this self-reference must be
// acyclic", so a cycle (A's parent is B, B's parent is A) is perfectly legal
// storage and only becomes a problem when something walks the chain.
//
// The form previously rejected only the single-hop case — a location being its
// own parent. Every longer cycle was accepted.

// A cycle needs a bound as well as a visited set. The visited set catches any
// cycle reachable from the node being edited; the hop limit is the backstop for
// data that is already corrupt before this code runs.
export const MAX_ANCESTOR_HOPS = 50

/**
 * Walk up from `startId` through parent_location_id and return the chain,
 * nearest ancestor first. Stops at the root, at a broken link, on revisiting a
 * node, or after MAX_ANCESTOR_HOPS.
 *
 * @param {number|string|null} startId
 * @param {Array<{id: number, parent_location_id: number|null}>} locations
 * @returns {{ chain: number[], truncated: boolean, cyclic: boolean }}
 */
export function ancestorChain(startId, locations) {
  const byId = new Map(locations.map(l => [String(l.id), l]))
  const chain = []
  const seen = new Set()

  let currentId = startId == null ? null : String(startId)
  let hops = 0

  while (currentId != null && currentId !== '') {
    if (seen.has(currentId)) return { chain, truncated: false, cyclic: true }
    if (hops++ >= MAX_ANCESTOR_HOPS) return { chain, truncated: true, cyclic: false }

    const node = byId.get(currentId)
    if (!node) break                       // dangling parent id — treat as a root

    seen.add(currentId)
    chain.push(node.id)

    const parent = node.parent_location_id
    currentId = parent == null || parent === '' ? null : String(parent)
  }

  return { chain, truncated: false, cyclic: false }
}

/**
 * Would setting `locationId`'s parent to `parentId` create a cycle?
 *
 * True when the proposed parent is the location itself, or when the location
 * already sits somewhere in that parent's ancestry.
 */
export function wouldCreateCycle(locationId, parentId, locations) {
  if (parentId == null || parentId === '') return false
  if (String(parentId) === String(locationId)) return true

  const { chain, truncated, cyclic } = ancestorChain(parentId, locations)
  if (chain.some(id => String(id) === String(locationId))) return true

  // Two ways the proposed parent's own ancestry can already be broken:
  // `cyclic`, meaning the walk looped before reaching a root, and `truncated`,
  // meaning it ran past the hop limit. Neither is a cycle this edit would
  // *create*, but attaching to either spreads a hierarchy that nothing walking
  // upward can traverse. Refusing is the conservative call.
  return cyclic || truncated
}

/**
 * Validation message for the location form, or null when the parent is fine.
 * Returning the string rather than a boolean keeps the wording next to the rule.
 */
export function findParentCycle(locationId, parentId, locations) {
  if (parentId == null || parentId === '') return null

  if (String(parentId) === String(locationId)) {
    return 'A location cannot be its own parent.'
  }

  if (wouldCreateCycle(locationId, parentId, locations)) {
    const self = locations.find(l => String(l.id) === String(locationId))
    const parent = locations.find(l => String(l.id) === String(parentId))
    return parent && self
      ? `"${parent.name}" is already inside "${self.name}", so this would create a loop.`
      : 'That parent would create a loop in the location hierarchy.'
  }

  return null
}
