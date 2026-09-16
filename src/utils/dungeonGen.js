// Procedural dungeon generator — a map in ten seconds when the party goes off-book.
//
// Binary space partitioning, the classic room-and-corridor algorithm:
//
//   1. Split the map rectangle in two, and split each half again, until the
//      pieces ("leaves") are too small to split. Density sets how small.
//   2. Put one room inside each leaf, with at least a cell of wall around it.
//   3. Walk back up the tree joining the two halves at every split with an
//      L-shaped corridor between their two closest rooms. Because every split is
//      joined exactly once, the result is a spanning tree over the rooms — every
//      room is reachable, and that is a property of the construction, not luck.
//   4. Mark doors where a one-wide corridor passes through a room's wall.
//
// DETERMINISM IS THE CONTRACT. Everything random comes from one seeded PRNG
// consumed in a fixed order, so the same parameters give the same cells, the
// same image, byte for byte — which is what makes `maps.generated_params` worth
// storing: a generated map can be re-rolled, tweaked, or rebuilt from its seed.
// Never call Math.random() in this file.
//
// Pure: cells in, cells out. Painting takes any object with the CanvasRendering
// Context2D methods it uses, so tests can hand it a recorder.

export const CELL = Object.freeze({ WALL: 0, FLOOR: 1, CORRIDOR: 2, DOOR: 3 })
export const CELL_NAMES = Object.freeze(['wall', 'floor', 'corridor', 'door'])

export const SIZE_PRESETS = Object.freeze({
  small:  { cols: 30, rows: 22 },
  medium: { cols: 40, rows: 30 },
  large:  { cols: 60, rows: 44 },
})

// minLeaf is the smallest piece BSP will leave. Smaller pieces → more rooms.
export const DENSITIES = Object.freeze({
  sparse: { label: 'Sparse', minLeaf: 14 },
  medium: { label: 'Medium', minLeaf: 10 },
  dense:  { label: 'Dense',  minLeaf: 7 },
})

export const THEMES = Object.freeze({
  stone:     { label: 'Stone',     wall: '#1b1a18', floor: '#8a8272', corridor: '#6f685b', door: '#7a4a1e', edge: '#0c0b0a' },
  cavern:    { label: 'Cavern',    wall: '#231a12', floor: '#6d5a43', corridor: '#5a4a37', door: '#3f2c18', edge: '#120d08' },
  crypt:     { label: 'Crypt',     wall: '#15161c', floor: '#5d6170', corridor: '#4a4d59', door: '#6b5a2a', edge: '#08090c' },
  parchment: { label: 'Parchment', wall: '#3b2f22', floor: '#e8dcc0', corridor: '#d4c4a0', door: '#8b5a2b', edge: '#2a2016' },
})

export const LIMITS = Object.freeze({
  minCols: 16, maxCols: 100,
  minRows: 12, maxRows: 100,
  minCorridor: 1, maxCorridor: 3,
  maxSeed: 0xffffffff,
})

export const DEFAULT_PARAMS = Object.freeze({
  cols: SIZE_PRESETS.medium.cols,
  rows: SIZE_PRESETS.medium.rows,
  density: 'medium',
  corridorWidth: 1,
  seed: 42,
  theme: 'stone',
})

// ── Seeds and the PRNG ──────────────────────────────────────────────────────

/**
 * A seed as an unsigned 32-bit integer.
 * Integers (and numeric strings) are used as-is, so "seed 42" means 42. Any
 * other text is hashed (FNV-1a), so a DM can type "goblin warren" and get the
 * same dungeon every time they type it. Anything unusable → null.
 */
export function normaliseSeed(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= LIMITS.maxSeed ? value : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  if (/^\d+$/.test(text)) {
    const n = Number(text)
    return n <= LIMITS.maxSeed ? n : null
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** mulberry32 — small, fast, and good enough for dungeons. */
export function createRng(seed) {
  let state = (normaliseSeed(seed) ?? 0) >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    /** Integer in [min, max], inclusive. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
  }
}

// ── Parameters ──────────────────────────────────────────────────────────────

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Parameters with every value clamped to something the generator can build.
 * `size` (a preset name) is accepted as a shorthand for cols/rows; explicit
 * cols/rows win over it. Unknown density or theme falls back to the default.
 */
export function normaliseParams(input = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const preset = SIZE_PRESETS[src.size]
  const baseCols = src.cols ?? preset?.cols ?? DEFAULT_PARAMS.cols
  const baseRows = src.rows ?? preset?.rows ?? DEFAULT_PARAMS.rows
  const seed = normaliseSeed(src.seed)
  return {
    cols: clampInt(baseCols, LIMITS.minCols, LIMITS.maxCols, DEFAULT_PARAMS.cols),
    rows: clampInt(baseRows, LIMITS.minRows, LIMITS.maxRows, DEFAULT_PARAMS.rows),
    density: Object.hasOwn(DENSITIES, src.density) ? src.density : DEFAULT_PARAMS.density,
    corridorWidth: clampInt(src.corridorWidth, LIMITS.minCorridor, LIMITS.maxCorridor, DEFAULT_PARAMS.corridorWidth),
    seed: seed ?? DEFAULT_PARAMS.seed,
    theme: Object.hasOwn(THEMES, src.theme) ? src.theme : DEFAULT_PARAMS.theme,
  }
}

// ── Generation ──────────────────────────────────────────────────────────────

function splitLeaf(node, minLeaf, rng) {
  const canCutRows = node.h >= minLeaf * 2
  const canCutCols = node.w >= minLeaf * 2
  if (!canCutRows && !canCutCols) return

  let cutRows
  if (canCutRows && !canCutCols) cutRows = true
  else if (canCutCols && !canCutRows) cutRows = false
  else if (node.w / node.h >= 1.25) cutRows = false   // wide: cut it into left and right
  else if (node.h / node.w >= 1.25) cutRows = true    // tall: cut it into top and bottom
  else cutRows = rng.chance(0.5)

  if (cutRows) {
    const cut = rng.int(minLeaf, node.h - minLeaf)
    node.a = { x: node.x, y: node.y, w: node.w, h: cut }
    node.b = { x: node.x, y: node.y + cut, w: node.w, h: node.h - cut }
  } else {
    const cut = rng.int(minLeaf, node.w - minLeaf)
    node.a = { x: node.x, y: node.y, w: cut, h: node.h }
    node.b = { x: node.x + cut, y: node.y, w: node.w - cut, h: node.h }
  }
  splitLeaf(node.a, minLeaf, rng)
  splitLeaf(node.b, minLeaf, rng)
}

function placeRooms(node, rng, rooms) {
  if (node.a) {
    placeRooms(node.a, rng, rooms)
    placeRooms(node.b, rng, rooms)
    return
  }
  // A cell of wall on every side of the leaf, so neighbouring rooms never merge.
  const availW = node.w - 2
  const availH = node.h - 2
  if (availW < 3 || availH < 3) return
  const w = rng.int(Math.max(3, Math.floor(availW * 0.5)), availW)
  const h = rng.int(Math.max(3, Math.floor(availH * 0.5)), availH)
  const x = node.x + 1 + rng.int(0, availW - w)
  const y = node.y + 1 + rng.int(0, availH - h)
  const room = {
    id: rooms.length + 1,
    x, y, w, h,
    cx: x + Math.floor(w / 2),
    cy: y + Math.floor(h / 2),
  }
  node.room = room
  rooms.push(room)
}

function carve(grid, col, row, value) {
  if (col < 1 || row < 1 || col > grid.cols - 2 || row > grid.rows - 2) return
  const i = row * grid.cols + col
  if (grid.cells[i] === CELL.WALL) grid.cells[i] = value
}

function carveCorridor(grid, from, to, width, horizontalFirst) {
  const lo = -Math.floor((width - 1) / 2)
  const hi = lo + width - 1
  // A straight run, widened perpendicular to travel and extended by the width at
  // both ends so the corner of the L is filled rather than notched.
  const run = (x1, y1, x2, y2) => {
    if (y1 === y2) {
      for (let x = Math.min(x1, x2) + lo; x <= Math.max(x1, x2) + hi; x++) {
        for (let d = lo; d <= hi; d++) carve(grid, x, y1 + d, CELL.CORRIDOR)
      }
    } else {
      for (let y = Math.min(y1, y2) + lo; y <= Math.max(y1, y2) + hi; y++) {
        for (let d = lo; d <= hi; d++) carve(grid, x1 + d, y, CELL.CORRIDOR)
      }
    }
  }
  if (horizontalFirst) {
    run(from.cx, from.cy, to.cx, from.cy)
    run(to.cx, from.cy, to.cx, to.cy)
  } else {
    run(from.cx, from.cy, from.cx, to.cy)
    run(from.cx, to.cy, to.cx, to.cy)
  }
}

function connectTree(node, grid, width, rng) {
  if (!node.a) return node.room ? [node.room] : []
  const left = connectTree(node.a, grid, width, rng)
  const right = connectTree(node.b, grid, width, rng)
  if (left.length && right.length) {
    // The closest pair across the split, so corridors stay short. Ties go to the
    // first found, which is deterministic because both lists are.
    let best = null
    for (const a of left) {
      for (const b of right) {
        const d = Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy)
        if (!best || d < best.d) best = { a, b, d }
      }
    }
    carveCorridor(grid, best.a, best.b, width, rng.chance(0.5))
  }
  return left.concat(right)
}

function markDoors(grid, rooms) {
  const doors = []
  const at = (c, r) => (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) ? CELL.WALL : grid.cells[r * grid.cols + c]
  const consider = (c, r, outC, outR, lateral) => {
    if (at(c, r) !== CELL.CORRIDOR) return
    if (at(c + outC, r + outR) === CELL.WALL) return            // not a passage through the wall
    if (at(c + lateral[0], r + lateral[1]) !== CELL.WALL) return // running along the wall, not through it
    if (at(c - lateral[0], r - lateral[1]) !== CELL.WALL) return
    grid.cells[r * grid.cols + c] = CELL.DOOR
    doors.push({ col: c, row: r })
  }
  for (const room of rooms) {
    for (let c = room.x; c < room.x + room.w; c++) {
      consider(c, room.y - 1, 0, -1, [1, 0])
      consider(c, room.y + room.h, 0, 1, [1, 0])
    }
    for (let r = room.y; r < room.y + room.h; r++) {
      consider(room.x - 1, r, -1, 0, [0, 1])
      consider(room.x + room.w, r, 1, 0, [0, 1])
    }
  }
  return doors
}

/**
 * Generate a dungeon.
 *
 * @returns {{
 *   cols: number, rows: number,
 *   cells: number[],            // row-major, values from CELL
 *   rooms: Array<{id,x,y,w,h,cx,cy}>,
 *   doors: Array<{col,row}>,
 *   params: object              // the normalised parameters actually used
 * }}
 */
export function generateDungeon(input = {}) {
  const params = normaliseParams(input)
  const { cols, rows } = params
  const rng = createRng(params.seed)
  const grid = { cols, rows, cells: new Array(cols * rows).fill(CELL.WALL) }

  const root = { x: 1, y: 1, w: cols - 2, h: rows - 2 }
  splitLeaf(root, DENSITIES[params.density].minLeaf, rng)

  const rooms = []
  placeRooms(root, rng, rooms)
  for (const room of rooms) {
    for (let r = room.y; r < room.y + room.h; r++) {
      for (let c = room.x; c < room.x + room.w; c++) grid.cells[r * cols + c] = CELL.FLOOR
    }
  }

  connectTree(root, grid, params.corridorWidth, rng)

  // Doors only for one-wide corridors. A two- or three-wide passage meeting a
  // room is an archway, and marking it would paint a row of doors.
  const doors = params.corridorWidth === 1 ? markDoors(grid, rooms) : []

  return { cols, rows, cells: grid.cells, rooms, doors, params }
}

// ── Checks ──────────────────────────────────────────────────────────────────

export function cellAt(dungeon, col, row) {
  if (col < 0 || row < 0 || col >= dungeon.cols || row >= dungeon.rows) return CELL.WALL
  return dungeon.cells[row * dungeon.cols + col]
}

/** Row-major booleans: true for every walkable cell reachable from (col, row). */
export function reachableFrom(dungeon, col, row) {
  const seen = new Array(dungeon.cols * dungeon.rows).fill(false)
  if (cellAt(dungeon, col, row) === CELL.WALL) return seen
  const stack = [[col, row]]
  seen[row * dungeon.cols + col] = true
  while (stack.length) {
    const [c, r] = stack.pop()
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr
      if (cellAt(dungeon, nc, nr) === CELL.WALL) continue
      const i = nr * dungeon.cols + nc
      if (seen[i]) continue
      seen[i] = true
      stack.push([nc, nr])
    }
  }
  return seen
}

/**
 * True when every walkable cell — every room, corridor and door — can be reached
 * from the first room. Stronger than "every room is reachable": it also rules out
 * a stray corridor stub cut off from everything.
 */
export function isFullyConnected(dungeon) {
  if (!dungeon.rooms.length) return false
  const seen = reachableFrom(dungeon, dungeon.rooms[0].cx, dungeon.rooms[0].cy)
  return dungeon.cells.every((cell, i) => cell === CELL.WALL || seen[i])
}

export function countCells(dungeon) {
  const counts = { wall: 0, floor: 0, corridor: 0, door: 0 }
  for (const cell of dungeon.cells) counts[CELL_NAMES[cell]]++
  return counts
}

export function describeDungeon(dungeon) {
  const n = dungeon.rooms.length
  return `${n} room${n === 1 ? '' : 's'} · ${dungeon.cols}×${dungeon.rows} squares · seed ${dungeon.params.seed}`
}

// ── Painting ────────────────────────────────────────────────────────────────

export function dungeonImageSize(dungeon, gridSize) {
  return { width: dungeon.cols * gridSize, height: dungeon.rows * gridSize }
}

/**
 * Paint a dungeon onto a 2D context at `gridSize` pixels per cell.
 *
 * One cell of the dungeon is exactly one cell of the map grid, so fog, tokens
 * and measurement line up with the walls without any alignment step. Floors are
 * painted as row runs rather than cell by cell, and every wall edge goes into a
 * single path, so a 100×100 map is a few hundred draw calls, not ten thousand.
 */
export function paintDungeon(ctx, dungeon, gridSize, themeKey) {
  const theme = THEMES[themeKey] ?? THEMES[dungeon.params?.theme] ?? THEMES[DEFAULT_PARAMS.theme]
  const { cols, rows } = dungeon
  const g = gridSize
  const fillFor = [theme.wall, theme.floor, theme.corridor, theme.corridor]

  ctx.fillStyle = theme.wall
  ctx.fillRect(0, 0, cols * g, rows * g)

  for (let r = 0; r < rows; r++) {
    let c = 0
    while (c < cols) {
      const cell = dungeon.cells[r * cols + c]
      if (cell === CELL.WALL) { c++; continue }
      const fill = fillFor[cell]
      let end = c + 1
      while (end < cols && dungeon.cells[r * cols + end] !== CELL.WALL && fillFor[dungeon.cells[r * cols + end]] === fill) end++
      ctx.fillStyle = fill
      ctx.fillRect(c * g, r * g, (end - c) * g, g)
      c = end
    }
  }

  ctx.strokeStyle = theme.edge
  ctx.lineWidth = Math.max(2, Math.round(g / 12))
  ctx.beginPath()
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (dungeon.cells[r * cols + c] === CELL.WALL) continue
      const x = c * g, y = r * g
      if (cellAt(dungeon, c, r - 1) === CELL.WALL) { ctx.moveTo(x, y); ctx.lineTo(x + g, y) }
      if (cellAt(dungeon, c, r + 1) === CELL.WALL) { ctx.moveTo(x, y + g); ctx.lineTo(x + g, y + g) }
      if (cellAt(dungeon, c - 1, r) === CELL.WALL) { ctx.moveTo(x, y); ctx.lineTo(x, y + g) }
      if (cellAt(dungeon, c + 1, r) === CELL.WALL) { ctx.moveTo(x + g, y); ctx.lineTo(x + g, y + g) }
    }
  }
  ctx.stroke()

  // A door is a bar across the passage: walls to its left and right mean the
  // passage runs up-down, so the bar lies across it.
  ctx.fillStyle = theme.door
  for (const { col, row } of dungeon.doors) {
    const x = col * g, y = row * g
    const passageVertical = cellAt(dungeon, col - 1, row) === CELL.WALL && cellAt(dungeon, col + 1, row) === CELL.WALL
    if (passageVertical) ctx.fillRect(x + g * 0.1, y + g * 0.35, g * 0.8, g * 0.3)
    else ctx.fillRect(x + g * 0.35, y + g * 0.1, g * 0.3, g * 0.8)
  }
}
