import { describe, it, expect } from 'vitest'
import fogFilter from '../fogFilter.js'
// The renderer's copy. fogFilter.js is a deliberate duplicate of this module's
// index maths for the main process; these tests assert the two agree, because a
// divergence between them is a fog leak that nothing else would catch.
import {
  getCellIndex as rendererGetCellIndex,
  isCellRevealed as rendererIsCellRevealed,
  getMapDimensions as rendererGetMapDimensions,
  initFog,
  setBrushRevealed,
} from '../../../src/utils/fogUtils.js'

const {
  getCellIndex,
  isCellRevealed,
  gridDimensions,
  parseJsonArray,
  filterTokensByFog,
  filterMapForPlayer,
  filterBroadcastPayload,
} = fogFilter

const token = (label, col, row) => ({ id: `t-${label}`, label, col, row, type: 'monster' })

// A 1000x800 map at 50px: 20 columns, 16 rows.
const GRID = { numCols: 20, numRows: 16 }
const blankMask = () => new Array(GRID.numCols * GRID.numRows).fill(false)
const maskWith = (...cells) => {
  const mask = blankMask()
  for (const [col, row] of cells) mask[row * GRID.numCols + col] = true
  return mask
}

describe('index maths agrees with the renderer', () => {
  it('getCellIndex matches src/utils/fogUtils.js for the whole grid', () => {
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 20; col++) {
        expect(getCellIndex(col, row, 20)).toBe(rendererGetCellIndex(col, row, 20))
      }
    }
  })

  it('isCellRevealed matches the renderer on a real painted mask', () => {
    // Paint with the renderer's own brush, then read back with both.
    const painted = setBrushRevealed(initFog(20, 16), 10, 8, 20, 16, 3, true)
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 20; col++) {
        expect(isCellRevealed(painted, col, row, 20))
          .toBe(rendererIsCellRevealed(painted, col, row, 20))
      }
    }
  })

  it('gridDimensions matches getMapDimensions, fallback included', () => {
    const cases = [
      [{ width: 1000, height: 800 }, 50],
      [{ width: 1024, height: 768 }, 50],
      [{ width: 1001, height: 999 }, 50],
      [{ width: 10, height: 10 }, 50],
      [{ width: 0, height: 0 }, 50],
      [{ width: 0, height: 500 }, 25],
    ]
    for (const [size, grid] of cases) {
      expect(gridDimensions(size, grid)).toEqual(rendererGetMapDimensions(size, grid))
    }
  })

  it('a null image size falls back to 3000x3000, as the renderer does', () => {
    expect(gridDimensions(null, 50)).toEqual({ numCols: 60, numRows: 60 })
    expect(gridDimensions(null, 50)).toEqual(rendererGetMapDimensions({ width: 0, height: 0 }, 50))
  })

  it('a missing or nonsense grid size falls back to 50', () => {
    for (const bad of [null, undefined, 0, -10, 'abc']) {
      expect(gridDimensions({ width: 1000, height: 800 }, bad)).toEqual({ numCols: 20, numRows: 16 })
    }
  })
})

describe('parseJsonArray', () => {
  it('parses a JSON array string', () => {
    expect(parseJsonArray('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('passes an array through untouched', () => {
    const arr = [{ a: 1 }]
    expect(parseJsonArray(arr)).toBe(arr)
  })

  it('returns [] for anything that is not an array', () => {
    for (const bad of [null, undefined, '', '   ', 'not json', '{"a":1}', '42', '"str"', 7, {}]) {
      expect(parseJsonArray(bad)).toEqual([])
    }
  })
})

describe('filterTokensByFog — the core rule', () => {
  it('keeps a token on a revealed cell and drops one on a hidden cell', () => {
    const tokens = [token('seen', 5, 5), token('hidden', 15, 12)]
    const result = filterTokensByFog(tokens, maskWith([5, 5]), GRID)
    expect(result.tokens.map(t => t.label)).toEqual(['seen'])
  })

  it('returns the tokens unchanged when no fog has been painted', () => {
    // MapView treats an empty mask as "no fog, draw everything"; a map with no
    // fog has nothing to hide, so the server matches rather than hiding all.
    const tokens = [token('a', 1, 1), token('b', 2, 2)]
    const result = filterTokensByFog(tokens, [], GRID)
    expect(result.tokens).toHaveLength(2)
    expect(result.reason).toBe('no-fog')
  })

  it('returns nothing for an empty token list', () => {
    expect(filterTokensByFog([], maskWith([0, 0]), GRID).tokens).toEqual([])
  })

  it('drops every token when the grid is unknown', () => {
    const tokens = [token('a', 1, 1)]
    for (const grid of [null, undefined, {}, { numCols: 0, numRows: 5 }, { numCols: NaN, numRows: 5 }]) {
      const result = filterTokensByFog(tokens, maskWith([1, 1]), grid)
      expect(result.tokens).toEqual([])
      expect(result.reason).toBe('unknown-grid')
    }
  })

  it('drops every token when the mask length does not match the grid', () => {
    // The smear case: the mask was painted at a different grid size, so every
    // index into it means something else. Withhold rather than guess.
    const tokens = [token('a', 1, 1)]
    const wrongMask = new Array(100).fill(true)
    const result = filterTokensByFog(tokens, wrongMask, GRID)
    expect(result.tokens).toEqual([])
    expect(result.reason).toMatch(/^mask-mismatch:100!=320$/)
  })

  it('drops a token with no usable position', () => {
    const allRevealed = new Array(320).fill(true)
    const bad = [
      { id: 1, label: 'no coords' },
      { id: 2, label: 'null col', col: null, row: 3 },
      { id: 3, label: 'string col', col: 'x', row: 3 },
      { id: 4, label: 'fractional', col: 1.5, row: 3 },
      { id: 5, label: 'negative', col: -1, row: 3 },
      { id: 6, label: 'past right edge', col: 20, row: 3 },
      { id: 7, label: 'past bottom edge', col: 3, row: 16 },
      // Everything below coerces to 0 via Number(), which would place it at
      // column 0 — revealed, in this fixture. Found by this test.
      { id: 8, label: 'empty string', col: '', row: '' },
      { id: 9, label: 'false', col: false, row: false },
      { id: 10, label: 'empty array', col: [], row: [] },
      { id: 11, label: 'undefined col', col: undefined, row: 0 },
      null,
      'not an object',
    ]
    expect(filterTokensByFog(bad, allRevealed, GRID).tokens).toEqual([])
  })

  it('keeps tokens at every corner of a fully revealed map', () => {
    const allRevealed = new Array(320).fill(true)
    const corners = [token('tl', 0, 0), token('tr', 19, 0), token('bl', 0, 15), token('br', 19, 15)]
    expect(filterTokensByFog(corners, allRevealed, GRID).tokens).toHaveLength(4)
  })

  it('a truthy-but-not-true mask cell counts as hidden', () => {
    // The renderer's isCellRevealed uses === true. 1 and 'true' are not.
    const mask = blankMask()
    mask[5 * 20 + 5] = 1
    expect(filterTokensByFog([token('a', 5, 5)], mask, GRID).tokens).toEqual([])
  })

  it('does not mutate the tokens it is given', () => {
    const tokens = [token('a', 5, 5), token('b', 6, 6)]
    const copy = JSON.parse(JSON.stringify(tokens))
    filterTokensByFog(tokens, maskWith([5, 5]), GRID)
    expect(tokens).toEqual(copy)
  })

  it('matches what the player app would have drawn, cell by cell', () => {
    // Paint a 5x5 brush at (10,8) with the renderer's own function, then place a
    // token on every cell and check the server's verdict against MapView's rule.
    const painted = setBrushRevealed(initFog(20, 16), 10, 8, 20, 16, 5, true)
    const all = []
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 20; col++) all.push(token(`${col},${row}`, col, row))
    }
    const kept = new Set(filterTokensByFog(all, painted, GRID).tokens.map(t => t.label))
    for (const t of all) {
      const rendererWouldDraw = painted[t.row * 20 + t.col] === true
      expect(kept.has(t.label)).toBe(rendererWouldDraw)
    }
    expect(kept.size).toBe(25)
  })
})

describe('filterMapForPlayer', () => {
  const measure = () => ({ width: 1000, height: 800 })

  const mapRow = (over = {}) => ({
    id: 1,
    campaign_id: 3,
    name: 'Town',
    grid_size: 50,
    image_path: 'C:/maps/town.png',
    fog_data: JSON.stringify(maskWith([5, 5])),
    tokens: JSON.stringify([token('seen', 5, 5), token('ambush', 15, 12)]),
    ...over,
  })

  it('strips hidden tokens and leaves tokens as a JSON string', () => {
    const { map, hidden } = filterMapForPlayer(mapRow(), { measure })
    const tokens = JSON.parse(map.tokens)
    expect(tokens.map(t => t.label)).toEqual(['seen'])
    expect(hidden).toBe(1)
    expect(typeof map.tokens).toBe('string')
  })

  it('leaves every other column of the row untouched', () => {
    const row = mapRow()
    const { map } = filterMapForPlayer(row, { measure })
    expect(map.id).toBe(row.id)
    expect(map.name).toBe(row.name)
    expect(map.grid_size).toBe(row.grid_size)
    expect(map.fog_data).toBe(row.fog_data)
  })

  it('does not mutate the row it was given', () => {
    const row = mapRow()
    const before = row.tokens
    filterMapForPlayer(row, { measure })
    expect(row.tokens).toBe(before)
  })

  it('uses the 3000x3000 fallback for a map with no image', () => {
    // 3000/50 = 60 columns. A token at col 70 is off-grid and must be dropped.
    const mask = new Array(60 * 60).fill(false)
    mask[2 * 60 + 2] = true
    const row = mapRow({
      image_path: null,
      fog_data: JSON.stringify(mask),
      tokens: JSON.stringify([token('on-grid', 2, 2), token('off-grid', 70, 2)]),
    })
    const { map, grid } = filterMapForPlayer(row, { measure })
    expect(grid).toEqual({ numCols: 60, numRows: 60 })
    expect(JSON.parse(map.tokens).map(t => t.label)).toEqual(['on-grid'])
  })

  it('withholds every token when the image cannot be measured', () => {
    // Missing file, corrupt file, or a format the reader does not know. Falling
    // back to 3000x3000 here would index into the wrong grid and leak.
    const { map, reason, hidden } = filterMapForPlayer(mapRow(), { measure: () => null })
    expect(JSON.parse(map.tokens)).toEqual([])
    expect(reason).toBe('unmeasurable-image')
    expect(hidden).toBe(2)
  })

  it('withholds every token when the mask was painted at another grid size', () => {
    const row = mapRow({ grid_size: 25 })   // mask is sized for 50px
    const { map, reason } = filterMapForPlayer(row, { measure })
    expect(JSON.parse(map.tokens)).toEqual([])
    expect(reason).toMatch(/^mask-mismatch/)
  })

  it('passes tokens through on a map with no fog painted', () => {
    const row = mapRow({ fog_data: '[]' })
    const { map, reason } = filterMapForPlayer(row, { measure })
    expect(JSON.parse(map.tokens)).toHaveLength(2)
    expect(reason).toBe('no-fog')
  })

  it('survives malformed JSON in either column', () => {
    const row = mapRow({ fog_data: '{not json', tokens: 'also not json' })
    const { map } = filterMapForPlayer(row, { measure })
    expect(JSON.parse(map.tokens)).toEqual([])
  })

  it('handles a null map', () => {
    expect(filterMapForPlayer(null).reason).toBe('no-map')
  })
})

describe('filterBroadcastPayload — live updates must not leak what REST hides', () => {
  const measure = () => ({ width: 1000, height: 800 })
  const map = { id: 1, grid_size: 50, image_path: 'C:/maps/town.png' }

  const payload = (over = {}) => ({
    mapId: 1,
    fogData: maskWith([5, 5]),
    tokens: [token('seen', 5, 5), token('ambush', 15, 12)],
    ...over,
  })

  it('strips hidden tokens, leaving them as an array', () => {
    const result = filterBroadcastPayload(payload(), map, { measure })
    expect(result.payload.tokens.map(t => t.label)).toEqual(['seen'])
    expect(Array.isArray(result.payload.tokens)).toBe(true)
    expect(result.hidden).toBe(1)
  })

  it('keeps fogData in the payload — the client still draws the fog itself', () => {
    const result = filterBroadcastPayload(payload(), map, { measure })
    expect(result.payload.fogData).toHaveLength(320)
    expect(result.payload.mapId).toBe(1)
  })

  it('withholds everything for a map the server cannot find', () => {
    const result = filterBroadcastPayload(payload(), null, { measure })
    expect(result.payload.tokens).toEqual([])
    expect(result.reason).toBe('unknown-map')
  })

  it('withholds everything when the image cannot be measured', () => {
    const result = filterBroadcastPayload(payload(), map, { measure: () => null })
    expect(result.payload.tokens).toEqual([])
    expect(result.reason).toBe('unmeasurable-image')
  })

  it('withholds everything on a mask/grid mismatch', () => {
    const result = filterBroadcastPayload(payload({ fogData: new Array(99).fill(true) }), map, { measure })
    expect(result.payload.tokens).toEqual([])
    expect(result.reason).toMatch(/^mask-mismatch/)
  })

  it('is a no-op for a payload carrying no tokens', () => {
    const p = { mapId: 1, fogData: [] }
    expect(filterBroadcastPayload(p, map, { measure }).payload).toBe(p)
  })

  it('handles a null payload', () => {
    expect(filterBroadcastPayload(null, map).reason).toBe('no-payload')
  })

  it('agrees with filterMapForPlayer on the same data', () => {
    // The two paths must never disagree — that is the whole point of filtering
    // the broadcast as well as the REST route.
    const row = {
      id: 1, grid_size: 50, image_path: 'C:/maps/town.png',
      fog_data: JSON.stringify(maskWith([5, 5], [6, 6])),
      tokens: JSON.stringify([token('a', 5, 5), token('b', 6, 6), token('c', 15, 12)]),
    }
    const viaRest = JSON.parse(filterMapForPlayer(row, { measure }).map.tokens).map(t => t.label)
    const viaSocket = filterBroadcastPayload(
      { mapId: 1, fogData: maskWith([5, 5], [6, 6]), tokens: JSON.parse(row.tokens) },
      row, { measure },
    ).payload.tokens.map(t => t.label)
    expect(viaSocket).toEqual(viaRest)
    expect(viaRest).toEqual(['a', 'b'])
  })
})
