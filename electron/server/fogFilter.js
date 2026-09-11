// Server-side fog of war enforcement.
//
// Until now fog was a rendering decision: the server sent every token and the
// player's browser declined to draw the ones on unrevealed cells
// (player/components/MapView.jsx). Anyone who opened devtools, or curled
// /api/map/:id, saw the whole board — every ambush, every hidden NPC. Fog was a
// curtain painted on the inside of the window.
//
// This module strips those tokens before they leave the process. It is a
// deliberate duplicate of the index maths in src/utils/fogUtils.js rather than
// an import: that file is an ES module in the renderer bundle, and this one is
// CommonJS loaded by the main process. The two must agree exactly — the tests in
// __tests__/fogFilter.test.js assert against the same fixtures fogUtils uses.
//
// ── The rule that matters ───────────────────────────────────────────────────
// Every function here fails CLOSED. If the grid cannot be determined, or the
// mask does not match the grid, or a token has no position, the token is
// withheld. A token wrongly hidden is a DM re-syncing the map; a token wrongly
// shown is the ambush spoiled. Those are not symmetric.

const { imageSizeFromFile } = require('./imageSize')

// Mirrors getMapDimensions in src/utils/fogUtils.js, including its 3000x3000
// fallback for a map with no image. The fallback is not a guess — the renderer
// uses exactly these numbers to size the mask it saves, so matching it keeps the
// indices aligned for blank maps.
const FALLBACK_DIMENSION = 3000

const getCellIndex = (col, row, numCols) => row * numCols + col

const isCellRevealed = (fogData, col, row, numCols) =>
  fogData[getCellIndex(col, row, numCols)] === true

/**
 * Grid dimensions for a map, mirroring src/utils/fogUtils.js getMapDimensions.
 */
function gridDimensions(imageSize, gridSize) {
  const size = Number(gridSize) > 0 ? Number(gridSize) : 50
  const w = (imageSize && imageSize.width) || FALLBACK_DIMENSION
  const h = (imageSize && imageSize.height) || FALLBACK_DIMENSION
  return { numCols: Math.ceil(w / size), numRows: Math.ceil(h / size) }
}

/**
 * Parse a JSON column that should hold an array, without throwing.
 * Returns [] for null, malformed JSON, or a non-array value.
 */
function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Decide which tokens a player may see.
 *
 * @param {Array} tokens    token objects: { col, row, ... }
 * @param {Array} fogData   flat boolean mask, row-major
 * @param {{numCols:number, numRows:number}} grid
 * @returns {{ tokens: Array, reason: string }} reason explains a full strip
 */
function filterTokensByFog(tokens, fogData, grid) {
  const list = Array.isArray(tokens) ? tokens : []
  const mask = Array.isArray(fogData) ? fogData : []

  if (list.length === 0) return { tokens: [], reason: 'no-tokens' }

  // An empty mask means fog was never painted on this map. The renderer treats
  // that as "no fog, draw everything" (MapView.jsx checks fogData.length > 0),
  // and a map with no fog has nothing to hide, so match it.
  if (mask.length === 0) return { tokens: list, reason: 'no-fog' }

  if (!grid || !Number.isFinite(grid.numCols) || grid.numCols <= 0) {
    return { tokens: [], reason: 'unknown-grid' }
  }

  // The mask length is the one cross-check available without Phase 8's fog_cols
  // column: it must equal numCols * numRows. A mismatch means the mask was
  // painted against a different grid size — the smear this phase's UI guard
  // exists to prevent — and every index into it would be meaningless.
  const expected = grid.numCols * grid.numRows
  if (mask.length !== expected) {
    return { tokens: [], reason: `mask-mismatch:${mask.length}!=${expected}` }
  }

  const visible = list.filter(token => {
    if (!token || typeof token !== 'object') return false
    // Strict: a coordinate must already BE an integer, not merely coerce to one.
    // Number(null), Number(''), Number(false) and Number([]) are all 0, which
    // would silently place a positionless token at column 0 — and on a revealed
    // top-left corner that is a leak.
    const { col, row } = token
    if (!Number.isInteger(col) || !Number.isInteger(row)) return false
    if (col < 0 || row < 0 || col >= grid.numCols || row >= grid.numRows) return false
    return isCellRevealed(mask, col, row, grid.numCols)
  })

  return { tokens: visible, reason: 'filtered' }
}

/**
 * Filter a map row read straight out of SQLite, returning a copy safe to send to
 * a player. `tokens` comes back as a JSON string, the same shape the row had, so
 * callers can hand the result straight to res.json().
 *
 * @param {object} map   a row from `maps`
 * @param {object} deps  injectable for tests: { measure }
 */
function filterMapForPlayer(map, deps = {}) {
  const measure = deps.measure ?? imageSizeFromFile
  if (!map) return { map, reason: 'no-map' }

  const tokens = parseJsonArray(map.tokens)
  const fogData = parseJsonArray(map.fog_data)

  // A map with no image still has a mask, sized against the 3000x3000 fallback.
  const imageSize = map.image_path ? measure(map.image_path) : null

  // Measurement failed on a map that HAS an image path: the file is missing,
  // corrupt, or a format the reader does not know. Fail closed rather than
  // falling back to 3000x3000, which would silently index into the wrong grid.
  if (map.image_path && !imageSize) {
    return {
      map: { ...map, tokens: JSON.stringify([]) },
      reason: 'unmeasurable-image',
      hidden: tokens.length,
    }
  }

  const grid = gridDimensions(imageSize, map.grid_size)
  const result = filterTokensByFog(tokens, fogData, grid)

  return {
    map: { ...map, tokens: JSON.stringify(result.tokens) },
    reason: result.reason,
    hidden: tokens.length - result.tokens.length,
    grid,
  }
}

/**
 * Filter the payload of a `map:update` socket broadcast. Same rules as the REST
 * route — a live update must not leak what the REST route hides.
 *
 * The payload carries fogData and tokens as arrays but no grid, so the map row
 * is looked up to recover grid_size and image_path.
 *
 * @param {object} payload  { mapId, fogData, tokens }
 * @param {object|null} map the `maps` row for payload.mapId, or null
 */
function filterBroadcastPayload(payload, map, deps = {}) {
  const measure = deps.measure ?? imageSizeFromFile
  if (!payload || typeof payload !== 'object') return { payload, reason: 'no-payload' }

  const tokens = parseJsonArray(payload.tokens)
  if (tokens.length === 0) return { payload, reason: 'no-tokens', hidden: 0 }

  // No row for this id: the DM is pushing an update for a map the server cannot
  // verify. Withhold every token.
  if (!map) {
    return { payload: { ...payload, tokens: [] }, reason: 'unknown-map', hidden: tokens.length }
  }

  const imageSize = map.image_path ? measure(map.image_path) : null
  if (map.image_path && !imageSize) {
    return { payload: { ...payload, tokens: [] }, reason: 'unmeasurable-image', hidden: tokens.length }
  }

  const grid = gridDimensions(imageSize, map.grid_size)
  const result = filterTokensByFog(tokens, parseJsonArray(payload.fogData), grid)

  return {
    payload: { ...payload, tokens: result.tokens },
    reason: result.reason,
    hidden: tokens.length - result.tokens.length,
    grid,
  }
}

module.exports = {
  FALLBACK_DIMENSION,
  getCellIndex,
  isCellRevealed,
  gridDimensions,
  parseJsonArray,
  filterTokensByFog,
  filterMapForPlayer,
  filterBroadcastPayload,
}
