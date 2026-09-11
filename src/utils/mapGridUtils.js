// Fog and grid size are coupled, and nothing in the schema says so.
//
// A fog mask is a flat array of numCols * numRows booleans, where numCols is
// ceil(imageWidth / gridSize). Change gridSize and every index in the saved mask
// means a different cell. MapCanvas already notices — it compares the saved
// length against the new dimensions and starts over from fully hidden
// (MapCanvas.jsx:104) — but it does that silently, so a DM who nudges the grid
// from 50px to 55px to line it up with their battle map watches an evening of
// painted fog disappear with no warning and no undo.
//
// Worse, the stale mask stays in the database until they paint again, which is
// what the server's mask-length check (electron/server/fogFilter.js) has to fail
// closed on: it cannot tell a stale mask from a correct one, only that the
// length is wrong.
//
// Phase 8 adds a fog_cols column so the mismatch can be detected properly. Until
// then, these helpers let the UI ask before destroying the mask.

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

/**
 * A grid size, or null when the value cannot be one.
 *
 * Number() is not enough on its own: Number(null), Number('') and Number([])
 * are all 0, which is finite, so a half-typed or missing input would read as a
 * real change to 0px — and a "change" is what destroys the mask. A grid size
 * must be a positive number, and the only non-number accepted is a numeric
 * string, because <input type="number"> hands those back.
 */
function toGridSize(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Decide what saving a new grid size should do.
 *
 * @param {number} currentGridSize  the size stored on the map
 * @param {number} nextGridSize     the size the toolbar is about to save
 * @param {string|Array|null} fogData  the map's saved mask
 * @returns {{ changed: boolean, clearsFog: boolean, paintedCells: number, message: string|null }}
 */
export function describeGridChange(currentGridSize, nextGridSize, fogData) {
  const current = toGridSize(currentGridSize)
  const next = toGridSize(nextGridSize)
  const changed = current !== null && next !== null && next !== current
  const paintedCells = paintedCellCount(fogData)

  // Saving the same size is a no-op for the mask, however much fog is painted.
  if (!changed) {
    return { changed: false, clearsFog: false, paintedCells, message: null }
  }

  // A grid change on an unpainted map destroys nothing worth warning about.
  if (paintedCells === 0) {
    return { changed: true, clearsFog: false, paintedCells: 0, message: null }
  }

  return {
    changed: true,
    clearsFog: true,
    paintedCells,
    message:
      `Changing the grid from ${current}px to ${next}px will clear the fog of war on this map ` +
      `(${paintedCells} revealed ${paintedCells === 1 ? 'cell' : 'cells'} will be lost). ` +
      `The fog mask is indexed by grid size, so it cannot be rescaled. Continue?`,
  }
}
