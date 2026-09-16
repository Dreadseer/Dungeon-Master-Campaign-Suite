import { describe, it, expect } from 'vitest'
import {
  paintedCellCount, hasPaintedFog, readFogMask, toGridSize,
  parseGeneratedParams, buildBlankParams, blankDimensions, BLANK_LIMITS,
  mapGridDimensions, isFogStale, needsFogColsBackfill,
  resampleFog, planGridChange, fogForGridChange,
} from '../mapGridUtils.js'
import { initFog, setBrushRevealed, getMapDimensions, isCellRevealed } from '../fogUtils.js'

// Masks built with the renderer's own painting functions, so the fixtures are
// the same shape MapCanvas actually saves.
const unpainted = initFog(20, 16)
const painted3x3 = setBrushRevealed(initFog(20, 16), 10, 8, 20, 16, 3, true)
const fullyRevealed = initFog(20, 16, true)

// A 1000×800 image at 50px is 20×16 cells — the fixtures above.
const IMAGE = { width: 1000, height: 800 }
const imageMap = (over = {}) => ({ image_path: 'C:/maps/a.png', grid_size: 50, fog_data: JSON.stringify(painted3x3), fog_cols: 20, ...over })
const blankMap = (over = {}) => ({ image_path: null, grid_size: 50, generated_params: JSON.stringify({ kind: 'blank', cols: 30, rows: 20 }), fog_data: '[]', ...over })

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

describe('hasPaintedFog / readFogMask', () => {
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

  it('readFogMask never throws', () => {
    expect(readFogMask('{bad')).toEqual([])
    expect(readFogMask('[true,false]')).toEqual([true, false])
  })
})

describe('toGridSize', () => {
  it('accepts positive numbers and numeric strings', () => {
    expect(toGridSize(50)).toBe(50)
    expect(toGridSize('55')).toBe(55)
  })

  it('refuses everything Number() would quietly turn into 0', () => {
    for (const bad of [NaN, undefined, null, 'abc', '', [], false, 0, -50, Infinity]) {
      expect(toGridSize(bad)).toBeNull()
    }
  })
})

describe('generated_params and blank maps', () => {
  it('parses stored params without throwing', () => {
    expect(parseGeneratedParams('{"kind":"blank","cols":10,"rows":8}')).toEqual({ kind: 'blank', cols: 10, rows: 8 })
    expect(parseGeneratedParams({ kind: 'dungeon' })).toEqual({ kind: 'dungeon' })
    for (const bad of [null, undefined, '', '{nope', '[1,2]', '42', 'null']) {
      expect(parseGeneratedParams(bad)).toBeNull()
    }
  })

  it('builds blank params from cell counts, including form strings', () => {
    expect(buildBlankParams(30, 20)).toEqual({ kind: 'blank', cols: 30, rows: 20 })
    expect(buildBlankParams('12', '9')).toEqual({ kind: 'blank', cols: 12, rows: 9 })
  })

  it('refuses a blank size out of range or not a whole number', () => {
    for (const [c, r] of [[0, 10], [10, BLANK_LIMITS.max + 1], [BLANK_LIMITS.min - 1, 10], [10.5, 10], [null, 10], ['', 10]]) {
      expect(buildBlankParams(c, r)).toBeNull()
    }
  })

  it('reads blank dimensions from a blank map', () => {
    expect(blankDimensions(blankMap())).toEqual({ cols: 30, rows: 20 })
  })

  it('a map with an image is never blank, whatever its params say', () => {
    expect(blankDimensions(blankMap({ image_path: 'C:/x.png' }))).toBeNull()
  })

  it('a generated dungeon is not a blank map', () => {
    expect(blankDimensions(blankMap({ generated_params: '{"kind":"dungeon","cols":30,"rows":20}' }))).toBeNull()
  })

  it('ignores corrupt blank params', () => {
    expect(blankDimensions(blankMap({ generated_params: '{"kind":"blank","cols":-3,"rows":20}' }))).toBeNull()
    expect(blankDimensions(blankMap({ generated_params: '{broken' }))).toBeNull()
  })
})

describe('mapGridDimensions', () => {
  it('an image map is sized by its image', () => {
    expect(mapGridDimensions(imageMap(), IMAGE)).toEqual({
      numCols: 20, numRows: 16, width: 1000, height: 800, gridSize: 50, source: 'image',
    })
  })

  it('agrees with getMapDimensions for images', () => {
    for (const g of [20, 35, 50, 73, 100]) {
      const { numCols, numRows } = mapGridDimensions(imageMap(), { width: 2317, height: 1601 }, g)
      expect({ numCols, numRows }).toEqual(getMapDimensions({ width: 2317, height: 1601 }, g))
    }
  })

  it('a blank map is sized in cells, drawn at cols × grid_size', () => {
    expect(mapGridDimensions(blankMap(), { width: 0, height: 0 })).toEqual({
      numCols: 30, numRows: 20, width: 1500, height: 1000, gridSize: 50, source: 'blank',
    })
  })

  it('getMapDimensions alone would get a blank map wrong — which is why this wraps it', () => {
    // The 3000×3000 fallback gives 60×60 cells for a map the DM asked to be 30×20.
    expect(getMapDimensions({ width: 0, height: 0 }, 50)).toEqual({ numCols: 60, numRows: 60 })
    expect(mapGridDimensions(blankMap(), null)).toMatchObject({ numCols: 30, numRows: 20 })
  })

  it('a blank map keeps its cell count when the grid size changes', () => {
    expect(mapGridDimensions(blankMap(), null, 70)).toMatchObject({ numCols: 30, numRows: 20, width: 2100 })
  })

  it('a legacy imageless map keeps the 3000×3000 fallback its mask was painted against', () => {
    expect(mapGridDimensions({ image_path: null, grid_size: 50 }, null)).toMatchObject({
      numCols: 60, numRows: 60, source: 'fallback',
    })
  })

  it('the live toolbar size overrides the stored one, and a bad size falls back', () => {
    expect(mapGridDimensions(imageMap(), IMAGE, 25).numCols).toBe(40)
    expect(mapGridDimensions(imageMap({ grid_size: null }), IMAGE, '').gridSize).toBe(50)
  })
})

describe('isFogStale', () => {
  const dims = { numCols: 20, numRows: 16 }

  it('a never-painted map is not stale', () => {
    expect(isFogStale(imageMap({ fog_data: '[]' }), dims)).toBe(false)
    expect(isFogStale(imageMap({ fog_data: null }), dims)).toBe(false)
  })

  it('a mask of the right length and matching fog_cols is current', () => {
    expect(isFogStale(imageMap(), dims)).toBe(false)
  })

  it('a mask of the wrong length is stale', () => {
    expect(isFogStale(imageMap(), { numCols: 22, numRows: 16 })).toBe(true)
  })

  it('catches the case length alone cannot: same cell count, different columns', () => {
    // 20×16 and 16×20 are both 320 cells.
    expect(isFogStale(imageMap({ fog_cols: 20 }), { numCols: 16, numRows: 20 })).toBe(true)
  })

  it('without fog_cols, falls back to the length check', () => {
    expect(isFogStale(imageMap({ fog_cols: null }), { numCols: 16, numRows: 20 })).toBe(false)
  })
})

describe('needsFogColsBackfill', () => {
  it('is true for maps that predate the column', () => {
    expect(needsFogColsBackfill({ fog_cols: null })).toBe(true)
    expect(needsFogColsBackfill({})).toBe(true)
    expect(needsFogColsBackfill({ fog_cols: 20 })).toBe(false)
    expect(needsFogColsBackfill(null)).toBe(false)
  })
})

describe('resampleFog', () => {
  const from = { numCols: 20, numRows: 16, gridSize: 50 }

  it('is the identity when nothing changes', () => {
    expect(resampleFog(painted3x3, from, from)).toEqual(painted3x3)
  })

  it('keeps a reveal in the same place on the map when cells get smaller', () => {
    // Old cell (10,8) spans px 500–550 × 400–450. At 25px that is new cells 20–21 × 16–17.
    const next = resampleFog(painted3x3, from, { numCols: 40, numRows: 32, gridSize: 25 })
    expect(next).toHaveLength(40 * 32)
    for (const [c, r] of [[20, 16], [21, 17], [18, 14], [23, 19]]) {
      expect(isCellRevealed(next, c, r, 40)).toBe(true)
    }
    expect(isCellRevealed(next, 17, 16, 40)).toBe(false)
    expect(isCellRevealed(next, 24, 16, 40)).toBe(false)
    // 9 old cells × 4 new cells each.
    expect(paintedCellCount(next)).toBe(36)
  })

  it('keeps a reveal in the same place when cells get larger', () => {
    // The 3×3 block is old cols 9–11, rows 7–9: px 450–600 × 350–500. A new
    // 100px cell is revealed when its centre falls inside that block.
    const next = resampleFog(painted3x3, from, { numCols: 10, numRows: 8, gridSize: 100 })
    expect(next).toHaveLength(80)
    expect(isCellRevealed(next, 4, 3, 10)).toBe(true)   // centre (450, 350)
    expect(isCellRevealed(next, 5, 4, 10)).toBe(true)   // centre (550, 450)
    expect(isCellRevealed(next, 4, 2, 10)).toBe(false)  // centre (450, 250) — above the block
    expect(isCellRevealed(next, 6, 4, 10)).toBe(false)  // centre (650, 450) — right of it
    expect(paintedCellCount(next)).toBe(4)
  })

  it('hides new cells beyond the old grid', () => {
    const next = resampleFog(fullyRevealed, from, { numCols: 25, numRows: 20, gridSize: 40 })
    // 1000px ÷ 40 = 25 cols exactly: all inside. Rows: 800 ÷ 40 = 20: all inside.
    expect(paintedCellCount(next)).toBe(500)
    const wider = resampleFog(fullyRevealed, { numCols: 20, numRows: 16, gridSize: 50 }, { numCols: 30, numRows: 16, gridSize: 50 })
    expect(isCellRevealed(wider, 19, 0, 30)).toBe(true)
    expect(isCellRevealed(wider, 20, 0, 30)).toBe(false)
  })

  it('never invents a reveal', () => {
    expect(paintedCellCount(resampleFog(unpainted, from, { numCols: 33, numRows: 27, gridSize: 30 }))).toBe(0)
  })

  it('accepts the stored JSON string', () => {
    expect(resampleFog(JSON.stringify(painted3x3), from, from)).toEqual(painted3x3)
  })
})

describe('planGridChange', () => {
  it('saving the same size changes nothing and asks nothing', () => {
    const plan = planGridChange(imageMap(), IMAGE, 50)
    expect(plan).toMatchObject({ changed: false, dimsChanged: false, needsChoice: false, message: null })
  })

  it('a change on a painted map asks clear-or-keep, and names what is at stake', () => {
    const plan = planGridChange(imageMap(), IMAGE, 25)
    expect(plan).toMatchObject({ changed: true, dimsChanged: true, needsChoice: true, keepable: true, paintedCells: 9 })
    expect(plan.from).toMatchObject({ numCols: 20, numRows: 16 })
    expect(plan.to).toMatchObject({ numCols: 40, numRows: 32 })
    expect(plan.message).toContain('50px to 25px')
    expect(plan.message).toContain('20×16 to 40×32')
    expect(plan.message).toContain('9 revealed cells')
  })

  it('says "cell" for exactly one', () => {
    const one = initFog(20, 16)
    one[0] = true
    expect(planGridChange(imageMap({ fog_data: JSON.stringify(one) }), IMAGE, 25).message).toContain('1 revealed cell ')
  })

  it('an unpainted map does not ask', () => {
    expect(planGridChange(imageMap({ fog_data: JSON.stringify(unpainted) }), IMAGE, 25).needsChoice).toBe(false)
    expect(planGridChange(imageMap({ fog_data: '[]' }), IMAGE, 25).needsChoice).toBe(false)
  })

  it('asks for a 5px nudge in either direction when the cell count moves', () => {
    // The toolbar steps in 5px. 1000/45 → 23 cols; 1000/55 → 19 cols.
    expect(planGridChange(imageMap(), IMAGE, 45).needsChoice).toBe(true)
    expect(planGridChange(imageMap(), IMAGE, 55).needsChoice).toBe(true)
  })

  it('does NOT ask when a nudge happens to leave the cell count unchanged', () => {
    // 1000/52 = 19.2 → 20 cols; 800/52 = 15.4 → 16 rows. Same grid, and every
    // index still names the same cell — the Phase 2 prompt asked on ANY size
    // change, and so cleared fog it did not need to.
    const plan = planGridChange(imageMap(), IMAGE, 52)
    expect(plan.changed).toBe(true)
    expect(plan.dimsChanged).toBe(false)
    expect(plan.needsChoice).toBe(false)
  })

  it('never asks on a blank map, whose cell count does not depend on grid size', () => {
    const painted = setBrushRevealed(initFog(30, 20), 5, 5, 30, 20, 5, true)
    const plan = planGridChange(blankMap({ fog_data: JSON.stringify(painted) }), null, 80)
    expect(plan.changed).toBe(true)
    expect(plan.dimsChanged).toBe(false)
    expect(plan.needsChoice).toBe(false)
  })

  it('a stale mask can be cleared but not kept', () => {
    const plan = planGridChange(imageMap({ fog_data: JSON.stringify(setBrushRevealed(initFog(7, 7), 1, 1, 7, 7, 1, true)) }), IMAGE, 25)
    expect(plan.needsChoice).toBe(true)
    expect(plan.keepable).toBe(false)
  })

  it('treats an unusable size as no change rather than a change that costs fog', () => {
    for (const bad of [NaN, undefined, null, 'abc', '', [], false, 0, -50]) {
      expect(planGridChange(imageMap(), IMAGE, bad).needsChoice).toBe(false)
      expect(planGridChange(imageMap({ grid_size: bad }), IMAGE, 50).needsChoice).toBe(false)
    }
  })

  it('treats a numeric string the same as a number', () => {
    expect(planGridChange(imageMap({ grid_size: '50' }), IMAGE, '50').changed).toBe(false)
    expect(planGridChange(imageMap({ grid_size: '50' }), IMAGE, '25').needsChoice).toBe(true)
  })
})

describe('fogForGridChange', () => {
  it('ACCEPTANCE: "keep" keeps the painted fog and records the new fog_cols', () => {
    const map = imageMap()
    const plan = planGridChange(map, IMAGE, 25)
    const { fogData, fogCols } = fogForGridChange(plan, map.fog_data, 'keep')
    expect(fogCols).toBe(40)
    expect(fogData).toHaveLength(40 * 32)
    expect(paintedCellCount(fogData)).toBe(36)
  })

  it('ACCEPTANCE: "clear" clears — fully hidden at the new size, not an empty array', () => {
    const map = imageMap()
    const plan = planGridChange(map, IMAGE, 25)
    const { fogData, fogCols } = fogForGridChange(plan, map.fog_data, 'clear')
    expect(fogCols).toBe(40)
    expect(fogData).toHaveLength(40 * 32)
    expect(paintedCellCount(fogData)).toBe(0)
  })

  it('"keep" on a stale mask clears instead of resampling garbage', () => {
    const map = imageMap({ fog_data: JSON.stringify(setBrushRevealed(initFog(7, 7), 1, 1, 7, 7, 1, true)) })
    const plan = planGridChange(map, IMAGE, 25)
    expect(paintedCellCount(fogForGridChange(plan, map.fog_data, 'keep').fogData)).toBe(0)
  })

  it('a never-painted map stays unpainted rather than becoming "all hidden"', () => {
    const map = imageMap({ fog_data: '[]' })
    const plan = planGridChange(map, IMAGE, 25)
    expect(fogForGridChange(plan, map.fog_data, 'clear')).toEqual({ fogData: [], fogCols: 40 })
  })

  it('leaves the mask untouched when the cell count did not change', () => {
    const map = blankMap({ fog_data: JSON.stringify(setBrushRevealed(initFog(30, 20), 5, 5, 30, 20, 3, true)) })
    const plan = planGridChange(map, null, 80)
    const out = fogForGridChange(plan, map.fog_data, 'clear')
    expect(out.fogCols).toBe(30)
    expect(paintedCellCount(out.fogData)).toBe(9)
  })
})
