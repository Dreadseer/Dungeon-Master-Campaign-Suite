// A map's grid: how many cells it has, whether its fog mask still fits, and what
// happens to that mask when the grid size changes.
//
// A fog mask is a flat array of numCols * numRows booleans, where numCols is
// ceil(imageWidth / gridSize). Change gridSize and every index in the saved mask
// means a different cell. Phase 2 made the UI ask before destroying the mask;
// Phase 8 adds `maps.fog_cols` — the column count the mask was painted against —
// so a mismatch is detectable rather than inferred from the length, and replaces
// "clear it or cancel" with a real choice: clear the fog, or KEEP it by resampling
// the painted area onto the new grid.
//
// Three kinds of map, one answer to "how big is the grid?" (mapGridDimensions):
//
//   image     cells come from the image's pixel size ÷ grid size
//   blank     no image; `generated_params` = { kind: 'blank', cols, rows }. The
//             map is defined IN CELLS, so a grid-size change only changes how big
//             each cell is drawn — the mask never needs resampling.
//   fallback  no image and no blank dimensions: the 3000×3000 px default in
//             fogUtils.getMapDimensions, which legacy imageless maps were painted
//             against and must keep for their masks to stay aligned.
//
// electron/server/fogFilter.js carries a CommonJS copy of the dimension logic.
// The two must agree; __tests__/fogFilter.test.js asserts it.

import { getMapDimensions, initFog } from './fogUtils.js'

export const DEFAULT_GRID_SIZE = 50
export const BLANK_LIMITS = Object.freeze({ min: 4, max: 150 })

// ── Parsing ─────────────────────────────────────────────────────────────────

function parseMask(fogData) {
  if (Array.isArray(fogData)) return fogData
  if (typeof fogData !== 'string' || fogData.trim() === '') return []
  try {
    const parsed = JSON.parse(fogData)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** A stored fog mask as an array — [] for null, blank or malformed. */
export function readFogMask(fogData) {
  return parseMask(fogData)
}

/**
 * How many cells of a mask are revealed.
 * Accepts the raw JSON string from `maps.fog_data`, a parsed array, or null.
 */
export function paintedCellCount(fogData) {
  const mask = parseMask(fogData)
  let count = 0
  for (const cell of mask) if (cell === true) count++
  return count
}

/** True when this mask has any revealed cell — i.e. the DM has painted. */
export function hasPaintedFog(fogData) {
  return paintedCellCount(fogData) > 0
}

/**
 * A grid size, or null when the value cannot be one.
 *
 * Number() is not enough on its own: Number(null), Number('') and Number([])
 * are all 0, which is finite, so a half-typed or missing input would read as a
 * real change to 0px — and a "change" is what destroys the mask. A grid size
 * must be a positive number, and the only non-number accepted is a numeric
 * string, because <input type="number"> hands those back.
 */
export function toGridSize(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** `maps.generated_params` as an object, or null. Never throws. */
export function parseGeneratedParams(value) {
  let parsed = value
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    try { parsed = JSON.parse(value) } catch { return null }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
}

function cellCount(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return Number.isInteger(n) && n >= BLANK_LIMITS.min && n <= BLANK_LIMITS.max ? n : null
}

/**
 * The stored parameters for a blank map, or null if the size is unusable.
 * Blank maps are sized in cells because that is how a DM thinks about an empty
 * field: "a 30 by 20 room", not "1500 by 1000 pixels".
 */
export function buildBlankParams(cols, rows) {
  const c = cellCount(cols)
  const r = cellCount(rows)
  return c && r ? { kind: 'blank', cols: c, rows: r } : null
}

/**
 * The cell dimensions of a blank map, or null if this is not one.
 * A map with an image is never blank, whatever its params say: the image is
 * what the fog was painted against.
 */
export function blankDimensions(map) {
  if (!map || map.image_path) return null
  const params = parseGeneratedParams(map.generated_params)
  if (!params || params.kind !== 'blank') return null
  const cols = cellCount(params.cols)
  const rows = cellCount(params.rows)
  return cols && rows ? { cols, rows } : null
}

// ── Dimensions ──────────────────────────────────────────────────────────────

/**
 * The grid of a map, in cells and pixels.
 *
 * @param {object} map        a `maps` row (image_path, grid_size, generated_params)
 * @param {{width,height}} imageSize  the loaded image, or {0,0} / null when none
 * @param {number} [gridSize] overrides map.grid_size — the toolbar's live value
 * @returns {{ numCols, numRows, width, height, gridSize, source: 'image'|'blank'|'fallback' }}
 */
export function mapGridDimensions(map, imageSize, gridSize) {
  const g = toGridSize(gridSize) ?? toGridSize(map?.grid_size) ?? DEFAULT_GRID_SIZE

  if (imageSize && imageSize.width > 0 && imageSize.height > 0) {
    const { numCols, numRows } = getMapDimensions(imageSize, g)
    return { numCols, numRows, width: imageSize.width, height: imageSize.height, gridSize: g, source: 'image' }
  }

  const blank = blankDimensions(map)
  if (blank) {
    return { numCols: blank.cols, numRows: blank.rows, width: blank.cols * g, height: blank.rows * g, gridSize: g, source: 'blank' }
  }

  const { numCols, numRows } = getMapDimensions({ width: 0, height: 0 }, g)
  return { numCols, numRows, width: 3000, height: 3000, gridSize: g, source: 'fallback' }
}

/**
 * True when a saved mask cannot be indexed against these dimensions.
 *
 * An empty mask is never stale — it means fog was never painted. Otherwise the
 * length must match, and when the map records `fog_cols` that must match too: a
 * mask can have the right LENGTH for the wrong grid (40×30 and 30×40 are both
 * 1200 cells), and only the stored column count tells those apart.
 */
export function isFogStale(map, dims) {
  const mask = parseMask(map?.fog_data)
  if (mask.length === 0) return false
  if (mask.length !== dims.numCols * dims.numRows) return true
  const fogCols = map?.fog_cols
  return Number.isInteger(fogCols) && fogCols !== dims.numCols
}

/** True for a map whose `fog_cols` has never been recorded (every pre-Phase-8 map). */
export function needsFogColsBackfill(map) {
  return !!map && !Number.isInteger(map.fog_cols)
}

// ── Grid changes ────────────────────────────────────────────────────────────

/**
 * Carry a painted mask onto a new grid.
 *
 * Each new cell takes the state of the old cell under its centre, so what the
 * party has seen stays seen, in the same place on the map. Cells whose centre
 * falls outside the old grid start hidden. Resampling cannot invent detail: a
 * finer grid gets blockier reveals at the old resolution, and a coarser one
 * rounds each reveal to whichever old cell sits under the new centre.
 */
export function resampleFog(mask, from, to) {
  const src = parseMask(mask)
  const next = new Array(to.numCols * to.numRows).fill(false)
  for (let row = 0; row < to.numRows; row++) {
    const oldRow = Math.floor(((row + 0.5) * to.gridSize) / from.gridSize)
    if (oldRow < 0 || oldRow >= from.numRows) continue
    for (let col = 0; col < to.numCols; col++) {
      const oldCol = Math.floor(((col + 0.5) * to.gridSize) / from.gridSize)
      if (oldCol < 0 || oldCol >= from.numCols) continue
      if (src[oldRow * from.numCols + oldCol] === true) next[row * to.numCols + col] = true
    }
  }
  return next
}

/**
 * Decide what saving a new grid size means for the fog.
 *
 * @returns {{
 *   changed: boolean,       // the size is actually different
 *   dimsChanged: boolean,   // ...and the cell count with it (never, for a blank map)
 *   paintedCells: number,
 *   needsChoice: boolean,   // ask the DM: clear or keep?
 *   keepable: boolean,      // the current mask fits its grid, so it can be resampled
 *   from, to,               // mapGridDimensions before and after
 *   message: string|null,
 * }}
 */
export function planGridChange(map, imageSize, nextGridSize) {
  const current = toGridSize(map?.grid_size)
  const next = toGridSize(nextGridSize)
  const changed = current !== null && next !== null && next !== current
  const from = mapGridDimensions(map, imageSize, current ?? undefined)
  const to = mapGridDimensions(map, imageSize, changed ? next : (current ?? undefined))
  const paintedCells = paintedCellCount(map?.fog_data)
  const dimsChanged = changed && (from.numCols !== to.numCols || from.numRows !== to.numRows)
  const keepable = !isFogStale(map, from)
  const needsChoice = dimsChanged && paintedCells > 0

  return {
    changed,
    dimsChanged,
    paintedCells,
    needsChoice,
    keepable,
    from,
    to,
    message: needsChoice
      ? `Changing the grid from ${current}px to ${next}px changes this map from ` +
        `${from.numCols}×${from.numRows} to ${to.numCols}×${to.numRows} cells. ` +
        `${paintedCells} revealed ${paintedCells === 1 ? 'cell' : 'cells'} of fog were painted on the old grid.`
      : null,
  }
}

/**
 * The fog to save for a grid change, given the DM's choice.
 *
 * @param {object} plan    from planGridChange
 * @param {*} fogData      the map's current mask
 * @param {'keep'|'clear'} choice  only consulted when plan.needsChoice
 * @returns {{ fogData: boolean[], fogCols: number }}
 */
export function fogForGridChange(plan, fogData, choice) {
  const mask = parseMask(fogData)
  const fogCols = plan.to.numCols

  // Same cells: the mask indexes identically, whatever happened to the pixels.
  if (!plan.dimsChanged) return { fogData: mask, fogCols }

  // Never painted: stay unpainted rather than turning "no fog" into "all hidden".
  if (mask.length === 0) return { fogData: [], fogCols }

  if (plan.needsChoice && choice === 'keep' && plan.keepable) {
    return { fogData: resampleFog(mask, plan.from, plan.to), fogCols }
  }

  // Clear means back to fully hidden at the new size — what the DM sees on
  // screen. An empty array would read as "no fog at all" to the player server
  // and show players every token on the map.
  return { fogData: initFog(fogCols, plan.to.numRows, false), fogCols }
}
