import { describe, it, expect } from 'vitest'
import {
  CELL, SIZE_PRESETS, DENSITIES, THEMES, LIMITS, DEFAULT_PARAMS,
  normaliseSeed, createRng, normaliseParams, generateDungeon,
  cellAt, reachableFrom, isFullyConnected, countCells, describeDungeon,
  dungeonImageSize, paintDungeon,
} from '../dungeonGen.js'

// A 2D context that records every call, so painting can be compared and bounded
// without a canvas.
function recorder() {
  const calls = []
  const ctx = {}
  for (const m of ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke']) {
    ctx[m] = (...args) => calls.push([m, ...args])
  }
  for (const p of ['fillStyle', 'strokeStyle', 'lineWidth']) {
    Object.defineProperty(ctx, p, { set: v => calls.push([`set:${p}`, v]), get: () => undefined })
  }
  return { ctx, calls }
}

// Many seeds across every density and corridor width — properties must hold for
// all of them, not for a lucky one.
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 1)
const VARIANTS = []
for (const density of Object.keys(DENSITIES)) {
  for (const corridorWidth of [1, 2, 3]) VARIANTS.push({ density, corridorWidth })
}

describe('normaliseSeed', () => {
  it('uses integers as they are', () => {
    expect(normaliseSeed(42)).toBe(42)
    expect(normaliseSeed(0)).toBe(0)
    expect(normaliseSeed('42')).toBe(42)
    expect(normaliseSeed(' 7 ')).toBe(7)
  })

  it('hashes text, the same way every time', () => {
    const a = normaliseSeed('goblin warren')
    expect(Number.isInteger(a)).toBe(true)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(LIMITS.maxSeed)
    expect(normaliseSeed('goblin warren')).toBe(a)
    expect(normaliseSeed('goblin warrens')).not.toBe(a)
  })

  it('refuses what cannot be a seed', () => {
    for (const bad of [null, undefined, '', '   ', -1, 1.5, NaN, Infinity, 2 ** 32, '4294967296', {}, []]) {
      expect(normaliseSeed(bad)).toBeNull()
    }
  })
})

describe('createRng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(42), b = createRng(42)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })

  it('differs between seeds', () => {
    const a = createRng(42), b = createRng(43)
    const seqA = Array.from({ length: 10 }, a.next)
    const seqB = Array.from({ length: 10 }, b.next)
    expect(seqA).not.toEqual(seqB)
  })

  it('stays in [0, 1) and int() stays inside its bounds', () => {
    const rng = createRng(123)
    for (let i = 0; i < 2000; i++) {
      const f = rng.next()
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
      const n = rng.int(3, 9)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(9)
    }
  })

  it('int() reaches both ends of its range', () => {
    const rng = createRng(5)
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(1, 4)))
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })
})

describe('normaliseParams', () => {
  it('gives the defaults for nothing', () => {
    expect(normaliseParams()).toEqual(DEFAULT_PARAMS)
    expect(normaliseParams(null)).toEqual(DEFAULT_PARAMS)
  })

  it('expands a size preset, and lets explicit cols/rows win', () => {
    expect(normaliseParams({ size: 'large' })).toMatchObject(SIZE_PRESETS.large)
    expect(normaliseParams({ size: 'large', cols: 20 })).toMatchObject({ cols: 20, rows: SIZE_PRESETS.large.rows })
  })

  it('clamps sizes and corridor width into what the generator can build', () => {
    const p = normaliseParams({ cols: 5, rows: 900, corridorWidth: 9 })
    expect(p.cols).toBe(LIMITS.minCols)
    expect(p.rows).toBe(LIMITS.maxRows)
    expect(p.corridorWidth).toBe(LIMITS.maxCorridor)
  })

  it('accepts numeric strings from form inputs', () => {
    expect(normaliseParams({ cols: '32', rows: '24', corridorWidth: '2', seed: '99' }))
      .toMatchObject({ cols: 32, rows: 24, corridorWidth: 2, seed: 99 })
  })

  it('falls back on unknown density, theme and seed', () => {
    const p = normaliseParams({ density: 'packed', theme: 'neon', seed: -4 })
    expect(p.density).toBe(DEFAULT_PARAMS.density)
    expect(p.theme).toBe(DEFAULT_PARAMS.theme)
    expect(p.seed).toBe(DEFAULT_PARAMS.seed)
  })

  it('does not treat inherited keys as valid choices', () => {
    expect(normaliseParams({ density: 'toString', theme: 'constructor' }))
      .toMatchObject({ density: DEFAULT_PARAMS.density, theme: DEFAULT_PARAMS.theme })
  })

  it('is idempotent', () => {
    const once = normaliseParams({ size: 'small', density: 'dense', seed: 'crypt', theme: 'crypt' })
    expect(normaliseParams(once)).toEqual(once)
  })
})

describe('generateDungeon — determinism', () => {
  it('ACCEPTANCE: seed 42 twice gives identical output', () => {
    const a = generateDungeon({ seed: 42 })
    const b = generateDungeon({ seed: 42 })
    expect(a).toEqual(b)
  })

  it('same parameters give the same cells, across every variant', () => {
    for (const v of VARIANTS) {
      const a = generateDungeon({ ...v, seed: 9001 })
      const b = generateDungeon({ ...v, seed: 9001 })
      expect(a.cells).toEqual(b.cells)
      expect(a.rooms).toEqual(b.rooms)
      expect(a.doors).toEqual(b.doors)
    }
  })

  it('a different seed gives a different dungeon', () => {
    expect(generateDungeon({ seed: 42 }).cells).not.toEqual(generateDungeon({ seed: 43 }).cells)
  })

  it('the theme changes nothing about the layout', () => {
    expect(generateDungeon({ seed: 42, theme: 'stone' }).cells)
      .toEqual(generateDungeon({ seed: 42, theme: 'parchment' }).cells)
  })

  it('pins seed 42 so an accidental change to the algorithm is noticed', () => {
    // If this fails because the generator was deliberately changed, every stored
    // generated_params will now rebuild a different map. Say so in BUILD_STATUS.
    const d = generateDungeon({ seed: 42 })
    expect(d.params).toEqual(DEFAULT_PARAMS)
    expect(d.rooms.length).toBeGreaterThanOrEqual(4)
    expect(describeDungeon(d)).toMatch(/^\d+ rooms · 40×30 squares · seed 42$/)
  })

  it('records the normalised parameters it actually used', () => {
    const d = generateDungeon({ size: 'small', seed: '17', corridorWidth: '2' })
    expect(d.params).toEqual({ ...DEFAULT_PARAMS, ...SIZE_PRESETS.small, seed: 17, corridorWidth: 2 })
  })
})

describe('generateDungeon — structure', () => {
  it('ACCEPTANCE: every room is reachable, for every seed and variant', () => {
    for (const v of VARIANTS) {
      for (const seed of SEEDS.slice(0, 12)) {
        const d = generateDungeon({ ...v, seed })
        expect(isFullyConnected(d), `seed ${seed} ${JSON.stringify(v)}`).toBe(true)
        const seen = reachableFrom(d, d.rooms[0].cx, d.rooms[0].cy)
        for (const room of d.rooms) expect(seen[room.cy * d.cols + room.cx]).toBe(true)
      }
    }
  })

  it('is connected at the extremes of size', () => {
    for (const size of [{ cols: LIMITS.minCols, rows: LIMITS.minRows }, { cols: LIMITS.maxCols, rows: LIMITS.maxRows }]) {
      for (const seed of SEEDS.slice(0, 5)) {
        expect(isFullyConnected(generateDungeon({ ...size, seed, density: 'dense' }))).toBe(true)
      }
    }
  })

  it('has cells for every square of the map', () => {
    const d = generateDungeon({ cols: 33, rows: 27, seed: 1 })
    expect(d.cells).toHaveLength(33 * 27)
    expect(d.cells.every(c => Object.values(CELL).includes(c))).toBe(true)
  })

  it('keeps a solid wall around the edge of the map', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const d = generateDungeon({ seed, corridorWidth: 3, density: 'dense' })
      for (let c = 0; c < d.cols; c++) {
        expect(cellAt(d, c, 0)).toBe(CELL.WALL)
        expect(cellAt(d, c, d.rows - 1)).toBe(CELL.WALL)
      }
      for (let r = 0; r < d.rows; r++) {
        expect(cellAt(d, 0, r)).toBe(CELL.WALL)
        expect(cellAt(d, d.cols - 1, r)).toBe(CELL.WALL)
      }
    }
  })

  it('rooms are at least 3×3, inside the map, and never overlap', () => {
    for (const seed of SEEDS) {
      const d = generateDungeon({ seed, density: 'dense' })
      for (const r of d.rooms) {
        expect(r.w).toBeGreaterThanOrEqual(3)
        expect(r.h).toBeGreaterThanOrEqual(3)
        expect(r.x).toBeGreaterThanOrEqual(1)
        expect(r.y).toBeGreaterThanOrEqual(1)
        expect(r.x + r.w).toBeLessThanOrEqual(d.cols - 1)
        expect(r.y + r.h).toBeLessThanOrEqual(d.rows - 1)
      }
      for (let i = 0; i < d.rooms.length; i++) {
        for (let j = i + 1; j < d.rooms.length; j++) {
          const a = d.rooms[i], b = d.rooms[j]
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
          expect(apart).toBe(true)
        }
      }
    }
  })

  it('every room cell is floor', () => {
    const d = generateDungeon({ seed: 42 })
    for (const r of d.rooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) expect(cellAt(d, x, y)).toBe(CELL.FLOOR)
      }
    }
  })

  it('density changes how many rooms there are', () => {
    const avg = (density) => SEEDS.reduce((n, seed) => n + generateDungeon({ seed, density, size: 'large' }).rooms.length, 0) / SEEDS.length
    expect(avg('dense')).toBeGreaterThan(avg('medium'))
    expect(avg('medium')).toBeGreaterThan(avg('sparse'))
  })

  it('wider corridors carve more corridor', () => {
    const corridors = (w) => countCells(generateDungeon({ seed: 42, corridorWidth: w })).corridor
    expect(corridors(2)).toBeGreaterThan(corridors(1))
    expect(corridors(3)).toBeGreaterThan(corridors(2))
  })
})

describe('doors', () => {
  it('are marked on the grid where they are listed', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const d = generateDungeon({ seed })
      for (const { col, row } of d.doors) expect(cellAt(d, col, row)).toBe(CELL.DOOR)
      expect(countCells(d).door).toBe(d.doors.length)
    }
  })

  it('appear in ordinary dungeons', () => {
    const total = SEEDS.reduce((n, seed) => n + generateDungeon({ seed }).doors.length, 0)
    expect(total).toBeGreaterThan(SEEDS.length)
  })

  it('sit in a wall gap: walls on both sides, a room on one side and passage on the other', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const d = generateDungeon({ seed })
      for (const { col, row } of d.doors) {
        const wallsLR = cellAt(d, col - 1, row) === CELL.WALL && cellAt(d, col + 1, row) === CELL.WALL
        const wallsUD = cellAt(d, col, row - 1) === CELL.WALL && cellAt(d, col, row + 1) === CELL.WALL
        expect(wallsLR || wallsUD).toBe(true)
        const [a, b] = wallsLR
          ? [cellAt(d, col, row - 1), cellAt(d, col, row + 1)]
          : [cellAt(d, col - 1, row), cellAt(d, col + 1, row)]
        expect(a).not.toBe(CELL.WALL)
        expect(b).not.toBe(CELL.WALL)
      }
    }
  })

  it('are not placed on wide corridors, which meet rooms as archways', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      expect(generateDungeon({ seed, corridorWidth: 2 }).doors).toEqual([])
      expect(generateDungeon({ seed, corridorWidth: 3 }).doors).toEqual([])
    }
  })
})

describe('reachableFrom', () => {
  it('reaches nothing from a wall', () => {
    const d = generateDungeon({ seed: 42 })
    expect(reachableFrom(d, 0, 0).some(Boolean)).toBe(false)
  })

  it('would notice a disconnected dungeon', () => {
    const d = generateDungeon({ seed: 42 })
    // Wall off the first room completely.
    const cut = { ...d, cells: [...d.cells] }
    const r = d.rooms[0]
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
        if (!inside) cut.cells[y * d.cols + x] = CELL.WALL
      }
    }
    expect(isFullyConnected(cut)).toBe(false)
  })

  it('isFullyConnected is false for a dungeon with no rooms', () => {
    expect(isFullyConnected({ cols: 2, rows: 2, cells: [0, 0, 0, 0], rooms: [] })).toBe(false)
  })
})

describe('paintDungeon', () => {
  it('sizes the image at exactly one grid cell per dungeon cell', () => {
    const d = generateDungeon({ cols: 40, rows: 30, seed: 42 })
    expect(dungeonImageSize(d, 50)).toEqual({ width: 2000, height: 1500 })
  })

  it('paints identically for the same dungeon — the image is as deterministic as the cells', () => {
    const a = recorder(), b = recorder()
    paintDungeon(a.ctx, generateDungeon({ seed: 42 }), 50)
    paintDungeon(b.ctx, generateDungeon({ seed: 42 }), 50)
    expect(a.calls).toEqual(b.calls)
    expect(a.calls.length).toBeGreaterThan(10)
  })

  it('never draws outside the image', () => {
    const d = generateDungeon({ seed: 7, density: 'dense' })
    const { width, height } = dungeonImageSize(d, 40)
    const { ctx, calls } = recorder()
    paintDungeon(ctx, d, 40)
    for (const [m, x, y, w, h] of calls) {
      if (m === 'fillRect') {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(x + w).toBeLessThanOrEqual(width)
        expect(y + h).toBeLessThanOrEqual(height)
      }
      if (m === 'moveTo' || m === 'lineTo') {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(width)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(height)
      }
    }
  })

  it('starts with the wall colour over the whole image, then the theme floor', () => {
    const d = generateDungeon({ seed: 42, theme: 'parchment' })
    const { ctx, calls } = recorder()
    paintDungeon(ctx, d, 50)
    expect(calls[0]).toEqual(['set:fillStyle', THEMES.parchment.wall])
    expect(calls[1]).toEqual(['fillRect', 0, 0, 2000, 1500])
    expect(calls).toContainEqual(['set:fillStyle', THEMES.parchment.floor])
  })

  it('an explicit theme overrides the one in the params', () => {
    const d = generateDungeon({ seed: 42, theme: 'stone' })
    const { ctx, calls } = recorder()
    paintDungeon(ctx, d, 50, 'crypt')
    expect(calls[0]).toEqual(['set:fillStyle', THEMES.crypt.wall])
  })

  it('covers every walkable cell with floor paint', () => {
    const d = generateDungeon({ seed: 3 })
    const g = 10
    const { ctx, calls } = recorder()
    paintDungeon(ctx, d, g)
    const painted = new Array(d.cols * d.rows).fill(false)
    for (const [m, x, y, w, h] of calls.slice(2)) {
      if (m !== 'fillRect') continue
      // Door bars are sub-cell; floor runs are whole cells.
      if (w % g !== 0 || h !== g) continue
      for (let c = x / g; c < (x + w) / g; c++) painted[(y / g) * d.cols + c] = true
    }
    d.cells.forEach((cell, i) => {
      if (cell !== CELL.WALL) expect(painted[i]).toBe(true)
    })
  })

  it('draws a door bar for every door', () => {
    const d = generateDungeon({ seed: 42 })
    const { ctx, calls } = recorder()
    paintDungeon(ctx, d, 50)
    const doorStart = calls.findIndex(c => c[0] === 'set:fillStyle' && c[1] === THEMES.stone.door)
    const bars = calls.slice(doorStart).filter(c => c[0] === 'fillRect')
    expect(bars).toHaveLength(d.doors.length)
  })
})
