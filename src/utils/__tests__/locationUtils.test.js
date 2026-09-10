import { describe, it, expect } from 'vitest'
import {
  ancestorChain,
  wouldCreateCycle,
  findParentCycle,
  MAX_ANCESTOR_HOPS,
} from '../locationUtils.js'

// Shorthand: loc(id, parentId, name)
const loc = (id, parent = null, name = `L${id}`) =>
  ({ id, parent_location_id: parent, name })

// Sword Coast > Neverwinter > Blacklake District > The Moonstone Mask
const NESTED = [
  loc(1, null, 'Sword Coast'),
  loc(2, 1, 'Neverwinter'),
  loc(3, 2, 'Blacklake District'),
  loc(4, 3, 'The Moonstone Mask'),
  loc(9, null, 'Waterdeep'),        // unrelated root
]

describe('ancestorChain', () => {
  it('walks from a leaf to the root, nearest ancestor first', () => {
    expect(ancestorChain(4, NESTED).chain).toEqual([4, 3, 2, 1])
  })

  it('a root is a chain of one', () => {
    expect(ancestorChain(1, NESTED).chain).toEqual([1])
  })

  it('returns an empty chain for a null start', () => {
    expect(ancestorChain(null, NESTED).chain).toEqual([])
    expect(ancestorChain(undefined, NESTED).chain).toEqual([])
    expect(ancestorChain('', NESTED).chain).toEqual([])
  })

  it('treats a dangling parent id as a root rather than throwing', () => {
    // Exactly what migration 009 now produces: the parent was deleted and the
    // child's parent_location_id was set to NULL... but a stale id can still
    // exist in a database written before 009.
    const orphan = [loc(5, 999, 'Orphan')]
    expect(ancestorChain(5, orphan).chain).toEqual([5])
    expect(ancestorChain(5, orphan).cyclic).toBe(false)
  })

  it('reports a two-node cycle instead of looping forever', () => {
    const cyclic = [loc(1, 2), loc(2, 1)]
    const result = ancestorChain(1, cyclic)
    expect(result.cyclic).toBe(true)
    expect(result.chain.length).toBeLessThanOrEqual(2)
  })

  it('reports a three-node cycle', () => {
    const result = ancestorChain(1, [loc(1, 2), loc(2, 3), loc(3, 1)])
    expect(result.cyclic).toBe(true)
  })

  it('reports a self-parent as a cycle', () => {
    expect(ancestorChain(1, [loc(1, 1)]).cyclic).toBe(true)
  })

  it('truncates a chain longer than the hop limit', () => {
    // A legal, acyclic chain of 60 — deeper than any real campaign, but the
    // bound has to exist for data that is already corrupt.
    const deep = Array.from({ length: 60 }, (_, i) => loc(i + 1, i === 0 ? null : i))
    const result = ancestorChain(60, deep)
    expect(result.truncated).toBe(true)
    expect(result.chain).toHaveLength(MAX_ANCESTOR_HOPS)
  })

  it('does not truncate a chain exactly at the limit', () => {
    const exact = Array.from({ length: MAX_ANCESTOR_HOPS }, (_, i) => loc(i + 1, i === 0 ? null : i))
    const result = ancestorChain(MAX_ANCESTOR_HOPS, exact)
    expect(result.truncated).toBe(false)
    expect(result.chain).toHaveLength(MAX_ANCESTOR_HOPS)
  })

  it('matches ids across the string/number boundary', () => {
    // Select elements hand back strings; the database hands back numbers.
    const mixed = [loc('1', null), loc(2, '1')]
    expect(ancestorChain(2, mixed).chain).toEqual([2, '1'])
  })
})

describe('wouldCreateCycle', () => {
  it('a null or empty parent is always fine', () => {
    expect(wouldCreateCycle(4, null, NESTED)).toBe(false)
    expect(wouldCreateCycle(4, '', NESTED)).toBe(false)
    expect(wouldCreateCycle(4, undefined, NESTED)).toBe(false)
  })

  it('rejects a location being its own parent', () => {
    expect(wouldCreateCycle(2, 2, NESTED)).toBe(true)
  })

  it('rejects a location being its own parent across the string boundary', () => {
    expect(wouldCreateCycle(2, '2', NESTED)).toBe(true)
    expect(wouldCreateCycle('2', 2, NESTED)).toBe(true)
  })

  it('rejects a direct swap — parenting to your own child', () => {
    // Neverwinter (2) under Blacklake District (3), which is inside it.
    expect(wouldCreateCycle(2, 3, NESTED)).toBe(true)
  })

  it('rejects a distant descendant — the case the old check missed', () => {
    // Sword Coast (1) under The Moonstone Mask (4), three levels below it.
    // The old guard only compared parent === self, so this was accepted.
    expect(wouldCreateCycle(1, 4, NESTED)).toBe(true)
  })

  it('allows a genuine reparent to an unrelated branch', () => {
    expect(wouldCreateCycle(4, 9, NESTED)).toBe(false)   // Moonstone Mask -> Waterdeep
    expect(wouldCreateCycle(3, 1, NESTED)).toBe(false)   // Blacklake -> Sword Coast
  })

  it('allows parenting a root under a leaf of a different tree', () => {
    expect(wouldCreateCycle(9, 4, NESTED)).toBe(false)   // Waterdeep -> Moonstone Mask
  })

  it('allows every ancestor of a node as a parent for its siblings', () => {
    const sibling = [...NESTED, loc(5, 2, 'Sibling')]
    for (const ancestorId of [1, 2]) {
      expect(wouldCreateCycle(5, ancestorId, sibling)).toBe(false)
    }
  })

  it('refuses to extend an already-cyclic hierarchy', () => {
    const broken = [loc(1, 2), loc(2, 1), loc(3, null)]
    expect(wouldCreateCycle(3, 1, broken)).toBe(true)
  })

  it('tolerates a dangling parent id', () => {
    expect(wouldCreateCycle(1, 999, [loc(1, null)])).toBe(false)
  })
})

describe('findParentCycle — the message the form shows', () => {
  it('returns null when the parent is legitimate', () => {
    expect(findParentCycle(4, 9, NESTED)).toBeNull()
    expect(findParentCycle(4, null, NESTED)).toBeNull()
    expect(findParentCycle(4, '', NESTED)).toBeNull()
  })

  it('keeps the original wording for the self-parent case', () => {
    expect(findParentCycle(2, 2, NESTED)).toBe('A location cannot be its own parent.')
  })

  it('names both locations in a longer loop', () => {
    const message = findParentCycle(1, 4, NESTED)
    expect(message).toContain('The Moonstone Mask')
    expect(message).toContain('Sword Coast')
    expect(message).toContain('loop')
  })

  it('falls back to a generic message when a name is unavailable', () => {
    const broken = [loc(1, 2), loc(2, 1)]
    const message = findParentCycle(3, 1, broken)   // 3 is not in the list
    expect(message).toBe('That parent would create a loop in the location hierarchy.')
  })

  it('returns a string or null, never a boolean', () => {
    for (const [self, parent] of [[4, 9], [2, 2], [1, 4], [4, null]]) {
      const result = findParentCycle(self, parent, NESTED)
      expect(result === null || typeof result === 'string').toBe(true)
    }
  })
})
