import { describe, it, expect } from 'vitest'
import { paintedCellCount, hasPaintedFog, describeGridChange } from '../mapGridUtils.js'
import { initFog, setBrushRevealed } from '../fogUtils.js'

// Masks built with the renderer's own painting functions, so the fixtures are
// the same shape MapCanvas actually saves.
const unpainted = initFog(20, 16)
const painted3x3 = setBrushRevealed(initFog(20, 16), 10, 8, 20, 16, 3, true)
const fullyRevealed = initFog(20, 16, true)

describe('paintedCellCount', () => {
  it('counts revealed cells in a parsed mask', () => {
    expect(paintedCellCount(painted3x3)).toBe(9)
    expect(paintedCellCount(fullyRevealed)).toBe(320)
    expect(paintedCellCount(unpainted)).toBe(0)
  })

  it('accepts the raw JSON string from maps.fog_data', () => {
    expect(paintedCellCount(JSON.stringify(painted3x3))).toBe(9)
  })

  it('returns 0 for a map that has never been painted', () => {
    for (const empty of [null, undefined, '', '   ', '[]', []]) {
      expect(paintedCellCount(empty)).toBe(0)
    }
  })

  it('returns 0 rather than throwing on malformed JSON', () => {
    for (const bad of ['{not json', '{"a":1}', '42', 'null', 7, {}]) {
      expect(paintedCellCount(bad)).toBe(0)
    }
  })

  it('counts only strict true, matching isCellRevealed', () => {
    // fogUtils compares === true, so 1 and 'true' are not revealed cells.
    expect(paintedCellCount([true, 1, 'true', false, null, undefined])).toBe(1)
  })
})

describe('hasPaintedFog', () => {
  it('is true only when at least one cell is revealed', () => {
    expect(hasPaintedFog(painted3x3)).toBe(true)
    expect(hasPaintedFog(unpainted)).toBe(false)
    expect(hasPaintedFog(null)).toBe(false)
  })

  it('a single revealed cell is enough', () => {
    const one = initFog(20, 16)
    one[0] = true
    expect(hasPaintedFog(one)).toBe(true)
  })
})

describe('describeGridChange', () => {
  it('saving the same size changes nothing and warns about nothing', () => {
    const result = describeGridChange(50, 50, painted3x3)
    expect(result).toMatchObject({ changed: false, clearsFog: false, message: null })
  })

  it('the same size is a no-op even on a fully revealed map', () => {
    expect(describeGridChange(50, 50, fullyRevealed).clearsFog).toBe(false)
  })

  it('a change on an unpainted map needs no confirmation', () => {
    const result = describeGridChange(50, 55, unpainted)
    expect(result.changed).toBe(true)
    expect(result.clearsFog).toBe(false)
    expect(result.message).toBeNull()
  })

  it('a change on a brand-new map with no mask at all needs no confirmation', () => {
    expect(describeGridChange(50, 70, null).clearsFog).toBe(false)
    expect(describeGridChange(50, 70, '[]').clearsFog).toBe(false)
  })

  it('a change on a painted map needs confirmation', () => {
    const result = describeGridChange(50, 55, painted3x3)
    expect(result.changed).toBe(true)
    expect(result.clearsFog).toBe(true)
    expect(result.paintedCells).toBe(9)
  })

  it('the message names both sizes and how much is at stake', () => {
    const { message } = describeGridChange(50, 55, painted3x3)
    expect(message).toContain('50px')
    expect(message).toContain('55px')
    expect(message).toContain('9 revealed cells')
    expect(message).toContain('clear the fog of war')
    expect(message.endsWith('Continue?')).toBe(true)
  })

  it('the message says "cell" for exactly one', () => {
    const one = initFog(20, 16)
    one[0] = true
    expect(describeGridChange(50, 55, one).message).toContain('1 revealed cell ')
  })

  it('warns whether the grid grows or shrinks', () => {
    // Both directions reindex the mask; neither is recoverable.
    expect(describeGridChange(50, 70, painted3x3).clearsFog).toBe(true)
    expect(describeGridChange(50, 30, painted3x3).clearsFog).toBe(true)
  })

  it('warns for the smallest possible nudge', () => {
    // The toolbar steps in 5px, but a 1px change reindexes just as completely.
    expect(describeGridChange(50, 51, painted3x3).clearsFog).toBe(true)
  })

  it('treats a numeric string the same as a number', () => {
    // <input type="number"> hands back strings.
    expect(describeGridChange('50', '50', painted3x3).changed).toBe(false)
    expect(describeGridChange('50', '55', painted3x3).clearsFog).toBe(true)
  })

  it('treats an unusable size as "no change" rather than clearing fog', () => {
    // Failing safe: a NaN from a half-typed input must never be read as a
    // change that destroys the mask.
    // null, '' and [] all coerce to 0 through Number(), which is finite — so a
    // naive check reads them as a real change to 0px, and a change is what
    // destroys the mask. Same trap as electron/server/fogFilter.js.
    for (const bad of [NaN, undefined, null, 'abc', '', [], false, 0, -50]) {
      expect(describeGridChange(50, bad, painted3x3).clearsFog).toBe(false)
      expect(describeGridChange(bad, 50, painted3x3).clearsFog).toBe(false)
    }
  })

  it('reports the real count on a heavily painted map', () => {
    const result = describeGridChange(50, 25, fullyRevealed)
    expect(result.paintedCells).toBe(320)
    expect(result.message).toContain('320 revealed cells')
  })
})
