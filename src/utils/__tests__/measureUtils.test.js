import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FEET_PER_CELL, normaliseFeetPerCell, pointToCell, cellCentre,
  gridSquares, directSquares, measureSegment, measurePath, formatFeet, formatMeasurement,
} from '../measureUtils.js'

const G = 50
// The centre of a cell, as a click would land on a token.
const at = (col, row) => ({ x: col * G + G / 2, y: row * G + G / 2 })

describe('normaliseFeetPerCell', () => {
  it('keeps a positive integer', () => {
    expect(normaliseFeetPerCell(5)).toBe(5)
    expect(normaliseFeetPerCell(10)).toBe(10)
  })

  it('accepts the numeric string an <input type="number"> hands back', () => {
    expect(normaliseFeetPerCell('10')).toBe(10)
  })

  it('falls back to 5 ft for anything that is not a positive integer', () => {
    // Number(null) and Number('') are 0 — a 0 ft square would make every distance 0.
    for (const bad of [null, undefined, '', '  ', 0, -5, 2.5, NaN, 'ten', [], {}]) {
      expect(normaliseFeetPerCell(bad)).toBe(DEFAULT_FEET_PER_CELL)
    }
  })
})

describe('pointToCell / cellCentre', () => {
  it('maps a pixel to the cell it falls in', () => {
    expect(pointToCell({ x: 0, y: 0 }, G)).toEqual({ col: 0, row: 0 })
    expect(pointToCell({ x: 49.9, y: 50 }, G)).toEqual({ col: 0, row: 1 })
    expect(pointToCell({ x: 175, y: 260 }, G)).toEqual({ col: 3, row: 5 })
  })

  it('is null for an unusable point or grid', () => {
    expect(pointToCell(null, G)).toBeNull()
    expect(pointToCell({ x: NaN, y: 1 }, G)).toBeNull()
    expect(pointToCell({ x: 1, y: 1 }, 0)).toBeNull()
    expect(pointToCell({ x: 1, y: 1 }, -50)).toBeNull()
  })

  it('round-trips through the centre of a cell', () => {
    for (const cell of [{ col: 0, row: 0 }, { col: 7, row: 3 }, { col: 19, row: 40 }]) {
      expect(pointToCell(cellCentre(cell, G), G)).toEqual(cell)
    }
  })
})

describe('gridSquares — the 5e rule', () => {
  it('counts a diagonal step as one square', () => {
    expect(gridSquares({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(1)
    expect(gridSquares({ col: 0, row: 0 }, { col: 3, row: 3 })).toBe(3)
  })

  it('is the larger of the column and row differences', () => {
    expect(gridSquares({ col: 2, row: 2 }, { col: 7, row: 4 })).toBe(5)
    expect(gridSquares({ col: 2, row: 2 }, { col: 3, row: 9 })).toBe(7)
  })

  it('is symmetric and zero for the same cell', () => {
    const a = { col: 4, row: 9 }, b = { col: 11, row: 2 }
    expect(gridSquares(a, b)).toBe(gridSquares(b, a))
    expect(gridSquares(a, a)).toBe(0)
  })
})

describe('directSquares', () => {
  it('is the hypotenuse', () => {
    expect(directSquares({ col: 0, row: 0 }, { col: 3, row: 4 })).toBe(5)
    expect(directSquares({ col: 0, row: 0 }, { col: 3, row: 3 })).toBeCloseTo(4.2426, 3)
  })
})

describe('measureSegment', () => {
  it('ACCEPTANCE: two tokens three squares apart diagonally are 15 ft', () => {
    const m = measureSegment(at(2, 2), at(5, 5), G, 5)
    expect(m.squares).toBe(3)
    expect(m.gridFeet).toBe(15)
    expect(m.directFeet).toBeCloseTo(21.21, 2)
  })

  it('snaps to cell centres, so a careless click is still the same distance', () => {
    const careful = measureSegment(at(2, 2), at(5, 5), G, 5)
    const sloppy = measureSegment({ x: 101, y: 149 }, { x: 299, y: 251 }, G, 5)
    expect(sloppy.gridFeet).toBe(careful.gridFeet)
    expect(sloppy.points).toEqual(careful.points)
  })

  it('draws its line between cell centres', () => {
    expect(measureSegment(at(0, 0), at(2, 0), G, 5).points).toEqual([25, 25, 125, 25])
  })

  it('scales with feet per cell', () => {
    expect(measureSegment(at(0, 0), at(4, 1), G, 10).gridFeet).toBe(40)
  })

  it('uses 5 ft when the map has no usable feet_per_cell', () => {
    expect(measureSegment(at(0, 0), at(4, 0), G, null).gridFeet).toBe(20)
  })

  it('is zero within one cell', () => {
    const m = measureSegment({ x: 5, y: 5 }, { x: 45, y: 45 }, G, 5)
    expect(m.gridFeet).toBe(0)
    expect(m.directFeet).toBe(0)
  })

  it('is independent of the grid pixel size', () => {
    const at30 = (c, r) => ({ x: c * 30 + 15, y: r * 30 + 15 })
    expect(measureSegment(at30(1, 1), at30(7, 3), 30, 5).gridFeet).toBe(30)
  })

  it('is null for an unusable grid', () => {
    expect(measureSegment(at(0, 0), at(1, 1), 0, 5)).toBeNull()
  })
})

describe('measurePath — chained segments', () => {
  it('sums grid distance per leg, the way a creature turning a corner moves', () => {
    // 4 squares east, then 3 squares south.
    const m = measurePath([at(0, 0), at(4, 0), at(4, 3)], G, 5)
    expect(m.segments).toHaveLength(2)
    expect(m.squares).toBe(7)
    expect(m.gridFeet).toBe(35)
  })

  it('reports the straight-line distance from the first point to the last', () => {
    const m = measurePath([at(0, 0), at(4, 0), at(4, 3)], G, 5)
    expect(m.straightFeet).toBe(25)   // 3-4-5 triangle
    expect(m.directFeet).toBe(35)     // the path as drawn
  })

  it('flattens the points into one polyline without repeating the joints', () => {
    const m = measurePath([at(0, 0), at(2, 0), at(2, 2)], G, 5)
    expect(m.points).toEqual([25, 25, 125, 25, 125, 125])
  })

  it('a single segment agrees with measureSegment', () => {
    const one = measurePath([at(1, 1), at(6, 3)], G, 5)
    const seg = measureSegment(at(1, 1), at(6, 3), G, 5)
    expect(one.gridFeet).toBe(seg.gridFeet)
    expect(one.straightFeet).toBeCloseTo(seg.directFeet, 10)
  })

  it('is null with fewer than two points', () => {
    expect(measurePath([], G, 5)).toBeNull()
    expect(measurePath([at(0, 0)], G, 5)).toBeNull()
    expect(measurePath(null, G, 5)).toBeNull()
  })

  it('is null if any point is unusable, rather than measuring part of the path', () => {
    expect(measurePath([at(0, 0), { x: NaN, y: 0 }, at(3, 3)], G, 5)).toBeNull()
  })
})

describe('formatFeet / formatMeasurement', () => {
  it('drops the decimal for whole numbers and keeps one otherwise', () => {
    expect(formatFeet(15)).toBe('15 ft')
    expect(formatFeet(21.2132)).toBe('21.2 ft')
    expect(formatFeet(0)).toBe('0 ft')
    expect(formatFeet(NaN)).toBe('—')
  })

  it('shows grid then direct distance for a diagonal', () => {
    expect(formatMeasurement(measureSegment(at(2, 2), at(5, 5), G, 5))).toBe('15 ft · 21.2 ft direct')
  })

  it('does not repeat itself for a straight line', () => {
    expect(formatMeasurement(measureSegment(at(0, 0), at(6, 0), G, 5))).toBe('30 ft')
  })

  it('names the legs of a chained path', () => {
    expect(formatMeasurement(measurePath([at(0, 0), at(4, 0), at(4, 3)], G, 5))).toBe('35 ft (2 legs) · 25 ft direct')
  })

  it('is empty for no measurement', () => {
    expect(formatMeasurement(null)).toBe('')
  })
})
