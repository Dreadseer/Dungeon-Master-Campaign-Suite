import { describe, it, expect } from 'vitest'
import {
  getCellIndex,
  initFog,
  isCellRevealed,
  setCellRevealed,
  setBrushRevealed,
  getMapDimensions,
  isCellInViewport,
} from '../fogUtils.js'

// Note on naming: the Phase 0 brief calls this function `getGridDimensions`.
// The actual export is `getMapDimensions` (fogUtils.js:31). Tested under its
// real name; no rename, since renaming an export is a change to shipped code
// and Phase 0 is meant to add coverage, not behaviour.

// Helper: list the indices of every revealed cell, for readable assertions.
const revealedIndices = (fog) =>
  fog.reduce((acc, v, i) => (v === true ? [...acc, i] : acc), [])

describe('getCellIndex', () => {
  it('is row-major: index = row * numCols + col', () => {
    expect(getCellIndex(0, 0, 10)).toBe(0)
    expect(getCellIndex(3, 0, 10)).toBe(3)
    expect(getCellIndex(0, 1, 10)).toBe(10)
    expect(getCellIndex(4, 2, 10)).toBe(24)
  })

  it('round-trips against manual decomposition', () => {
    const numCols = 7
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < numCols; col++) {
        const i = getCellIndex(col, row, numCols)
        expect(i % numCols).toBe(col)
        expect(Math.floor(i / numCols)).toBe(row)
      }
    }
  })

  it('the last cell of a grid is numCols * numRows - 1', () => {
    expect(getCellIndex(9, 4, 10)).toBe(49)
  })
})

describe('initFog', () => {
  it('allocates numCols * numRows cells', () => {
    expect(initFog(10, 4)).toHaveLength(40)
    expect(initFog(1, 1)).toHaveLength(1)
  })

  it('defaults every cell to hidden', () => {
    expect(initFog(3, 3).every(v => v === false)).toBe(true)
  })

  it('can start fully revealed', () => {
    expect(initFog(3, 3, true).every(v => v === true)).toBe(true)
  })

  it('a zero dimension yields an empty mask', () => {
    expect(initFog(0, 5)).toEqual([])
    expect(initFog(5, 0)).toEqual([])
  })
})

describe('isCellRevealed', () => {
  const numCols = 4
  const fog = initFog(numCols, 4)
  fog[getCellIndex(2, 1, numCols)] = true

  it('reads the cell at the computed index', () => {
    expect(isCellRevealed(fog, 2, 1, numCols)).toBe(true)
    expect(isCellRevealed(fog, 1, 2, numCols)).toBe(false)
  })

  it('returns false (not undefined) for an out-of-range cell', () => {
    expect(isCellRevealed(fog, 99, 99, numCols)).toBe(false)
  })
})

describe('setCellRevealed', () => {
  const numCols = 4

  it('reveals exactly one cell', () => {
    const next = setCellRevealed(initFog(numCols, 4), 2, 1, numCols, true)
    expect(revealedIndices(next)).toEqual([6])
  })

  it('does not mutate the input array', () => {
    const fog = initFog(numCols, 4)
    const next = setCellRevealed(fog, 2, 1, numCols, true)
    expect(fog[6]).toBe(false)
    expect(next).not.toBe(fog)
  })

  it('can re-hide a revealed cell', () => {
    const revealed = setCellRevealed(initFog(numCols, 4), 2, 1, numCols, true)
    const hidden = setCellRevealed(revealed, 2, 1, numCols, false)
    expect(revealedIndices(hidden)).toEqual([])
  })
})

describe('setBrushRevealed — brush geometry', () => {
  const numCols = 10
  const numRows = 10

  it('brush size 1 paints a single cell', () => {
    const next = setBrushRevealed(initFog(numCols, numRows), 5, 5, numCols, numRows, 1, true)
    expect(revealedIndices(next)).toEqual([getCellIndex(5, 5, numCols)])
  })

  it('brush size 3 paints a 3x3 square centred on the cell', () => {
    const next = setBrushRevealed(initFog(numCols, numRows), 5, 5, numCols, numRows, 3, true)
    expect(revealedIndices(next)).toHaveLength(9)
    for (let r = 4; r <= 6; r++) {
      for (let c = 4; c <= 6; c++) {
        expect(isCellRevealed(next, c, r, numCols)).toBe(true)
      }
    }
  })

  it('brush size 5 paints a 5x5 square', () => {
    const next = setBrushRevealed(initFog(numCols, numRows), 5, 5, numCols, numRows, 5, true)
    expect(revealedIndices(next)).toHaveLength(25)
  })

  it('an even brush size behaves as the odd size below it (half is floored)', () => {
    // Documented quirk: half = Math.floor(brushSize / 2), and the loop is
    // inclusive on both ends, so 2 and 3 both produce a 3x3 brush.
    const two = setBrushRevealed(initFog(numCols, numRows), 5, 5, numCols, numRows, 2, true)
    const three = setBrushRevealed(initFog(numCols, numRows), 5, 5, numCols, numRows, 3, true)
    expect(two).toEqual(three)
  })

  it('does not mutate the input array', () => {
    const fog = initFog(numCols, numRows)
    const next = setBrushRevealed(fog, 5, 5, numCols, numRows, 3, true)
    expect(fog.every(v => v === false)).toBe(true)
    expect(next).not.toBe(fog)
  })

  it('can un-reveal with the same brush', () => {
    const revealed = initFog(numCols, numRows, true)
    const next = setBrushRevealed(revealed, 5, 5, numCols, numRows, 3, false)
    expect(next.filter(v => v === false)).toHaveLength(9)
  })
})

describe('setBrushRevealed — clamping at all four map edges', () => {
  const numCols = 10
  const numRows = 8
  const paint = (col, row, size = 3) =>
    setBrushRevealed(initFog(numCols, numRows), col, row, numCols, numRows, size, true)

  it('top edge: the row above the map is dropped, not wrapped', () => {
    const next = paint(5, 0)
    expect(revealedIndices(next)).toHaveLength(6)   // 3 wide x 2 tall
    for (let c = 4; c <= 6; c++) {
      expect(isCellRevealed(next, c, 0, numCols)).toBe(true)
      expect(isCellRevealed(next, c, 1, numCols)).toBe(true)
    }
  })

  it('bottom edge: the row below the map is dropped', () => {
    const next = paint(5, numRows - 1)
    expect(revealedIndices(next)).toHaveLength(6)
    for (let c = 4; c <= 6; c++) {
      expect(isCellRevealed(next, c, numRows - 1, numCols)).toBe(true)
      expect(isCellRevealed(next, c, numRows - 2, numCols)).toBe(true)
    }
  })

  it('left edge: does not wrap onto the previous row', () => {
    const next = paint(0, 4)
    expect(revealedIndices(next)).toHaveLength(6)   // 2 wide x 3 tall
    // The cell to the "left" of col 0 on row 4 would be index 39 — the last
    // cell of row 3 — if the clamp were missing. It must stay hidden.
    expect(isCellRevealed(next, numCols - 1, 3, numCols)).toBe(false)
  })

  it('right edge: does not wrap onto the next row', () => {
    const next = paint(numCols - 1, 4)
    expect(revealedIndices(next)).toHaveLength(6)
    expect(isCellRevealed(next, 0, 5, numCols)).toBe(false)
  })

  it('a corner clamps on both axes at once', () => {
    expect(revealedIndices(paint(0, 0))).toHaveLength(4)
    expect(revealedIndices(paint(numCols - 1, 0))).toHaveLength(4)
    expect(revealedIndices(paint(0, numRows - 1))).toHaveLength(4)
    expect(revealedIndices(paint(numCols - 1, numRows - 1))).toHaveLength(4)
  })

  it('a brush larger than the map reveals the whole map and nothing beyond', () => {
    const next = paint(5, 4, 99)
    expect(next).toHaveLength(numCols * numRows)
    expect(next.every(v => v === true)).toBe(true)
  })

  it('a brush centred outside the map paints only the overlapping cells', () => {
    const next = setBrushRevealed(initFog(numCols, numRows), -1, -1, numCols, numRows, 3, true)
    expect(revealedIndices(next)).toEqual([getCellIndex(0, 0, numCols)])
  })
})

describe('getMapDimensions', () => {
  it('divides exactly when the image is a whole number of cells', () => {
    expect(getMapDimensions({ width: 1000, height: 500 }, 50))
      .toEqual({ numCols: 20, numRows: 10 })
  })

  it('rounds UP for a non-divisible image, so the last row/col is partial', () => {
    // 1024 / 50 = 20.48 -> 21 columns; 768 / 50 = 15.36 -> 16 rows.
    expect(getMapDimensions({ width: 1024, height: 768 }, 50))
      .toEqual({ numCols: 21, numRows: 16 })
  })

  it('one pixel over a boundary still adds a whole cell', () => {
    expect(getMapDimensions({ width: 1001, height: 1000 }, 50))
      .toEqual({ numCols: 21, numRows: 20 })
  })

  it('an image smaller than one cell is still one cell', () => {
    expect(getMapDimensions({ width: 10, height: 10 }, 50))
      .toEqual({ numCols: 1, numRows: 1 })
  })

  it('falls back to 3000x3000 when the image size is 0 (blank map)', () => {
    expect(getMapDimensions({ width: 0, height: 0 }, 50))
      .toEqual({ numCols: 60, numRows: 60 })
  })

  it('falls back per-axis, and the fallback is overridable', () => {
    expect(getMapDimensions({ width: 0, height: 500 }, 50))
      .toEqual({ numCols: 60, numRows: 10 })
    expect(getMapDimensions({ width: 0, height: 0 }, 50, 1000, 2000))
      .toEqual({ numCols: 20, numRows: 40 })
  })

  it('a smaller grid size yields proportionally more cells', () => {
    expect(getMapDimensions({ width: 1000, height: 1000 }, 25))
      .toEqual({ numCols: 40, numRows: 40 })
  })
})

describe('isCellInViewport', () => {
  const gridSize = 50
  const canvasSize = { width: 800, height: 600 }
  const origin = { x: 0, y: 0 }

  it('a cell at the canvas origin is visible', () => {
    expect(isCellInViewport(0, 0, gridSize, origin, 1, canvasSize)).toBe(true)
  })

  it('a cell past the right edge is culled', () => {
    expect(isCellInViewport(16, 0, gridSize, origin, 1, canvasSize)).toBe(false)
  })

  it('a cell past the bottom edge is culled', () => {
    expect(isCellInViewport(0, 12, gridSize, origin, 1, canvasSize)).toBe(false)
  })

  it('a cell straddling the left edge is still visible', () => {
    // Cell 0 pushed 25px off-screen left: spans -25..25, so half of it shows.
    expect(isCellInViewport(0, 0, gridSize, { x: -25, y: 0 }, 1, canvasSize)).toBe(true)
  })

  it('a cell entirely off the left edge is culled', () => {
    expect(isCellInViewport(0, 0, gridSize, { x: -50, y: 0 }, 1, canvasSize)).toBe(false)
  })

  it('panning brings a previously culled cell into view', () => {
    expect(isCellInViewport(20, 0, gridSize, origin, 1, canvasSize)).toBe(false)
    expect(isCellInViewport(20, 0, gridSize, { x: -400, y: 0 }, 1, canvasSize)).toBe(true)
  })

  it('zooming out brings distant cells into view', () => {
    expect(isCellInViewport(30, 0, gridSize, origin, 1, canvasSize)).toBe(false)
    expect(isCellInViewport(30, 0, gridSize, origin, 0.25, canvasSize)).toBe(true)
  })
})
