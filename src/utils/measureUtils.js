// Distance on a battle map — "can I reach him?"
//
// Two answers, because a DM needs both:
//
//   Grid distance   The 5e rule (PHB "Playing on a Grid"): count squares, and a
//                   diagonal step counts as ONE square. So the distance between
//                   two cells is the larger of the column and row differences,
//                   not their sum and not the hypotenuse.
//   Direct distance The straight-line (Euclidean) distance between the same two
//                   cell centres. It is what a player argues with when grid
//                   distance says a long diagonal is short.
//
// Both are measured between CELL CENTRES. A measurement starts and ends on the
// square a creature occupies, not on the pixel the mouse happened to press, so a
// token three squares away diagonally is 15 ft however carelessly it is clicked.
//
// Pixel space in, feet out. Nothing here touches Konva or the DOM.

export const DEFAULT_FEET_PER_CELL = 5

/**
 * A cell size in feet, or the 5 ft default.
 * Positive integers only: `Number(null)` and `Number('')` are 0, and a 0 ft
 * square would report every distance as 0 — worse than the default.
 */
export function normaliseFeetPerCell(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_FEET_PER_CELL
}

function validGrid(gridSize) {
  return typeof gridSize === 'number' && Number.isFinite(gridSize) && gridSize > 0
}

function validPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
}

/** The cell a stage-space pixel falls in. Null for an unusable point or grid. */
export function pointToCell(point, gridSize) {
  if (!validPoint(point) || !validGrid(gridSize)) return null
  return { col: Math.floor(point.x / gridSize), row: Math.floor(point.y / gridSize) }
}

/** The stage-space pixel at the centre of a cell. */
export function cellCentre(cell, gridSize) {
  return { x: cell.col * gridSize + gridSize / 2, y: cell.row * gridSize + gridSize / 2 }
}

/** Squares between two cells under the 5e rule: a diagonal step is one square. */
export function gridSquares(a, b) {
  return Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row))
}

/** Straight-line distance between two cell centres, in squares. */
export function directSquares(a, b) {
  return Math.hypot(b.col - a.col, b.row - a.row)
}

/**
 * Measure one segment between two stage-space points.
 *
 * @returns {null | {
 *   from: {col,row}, to: {col,row},
 *   squares: number, gridFeet: number, directFeet: number,
 *   points: number[]   // [x1, y1, x2, y2] at the cell centres, ready for a Konva Line
 * }}
 */
export function measureSegment(startPoint, endPoint, gridSize, feetPerCell) {
  const from = pointToCell(startPoint, gridSize)
  const to = pointToCell(endPoint, gridSize)
  if (!from || !to) return null
  const feet = normaliseFeetPerCell(feetPerCell)
  const squares = gridSquares(from, to)
  const a = cellCentre(from, gridSize)
  const b = cellCentre(to, gridSize)
  return {
    from,
    to,
    squares,
    gridFeet: squares * feet,
    directFeet: directSquares(from, to) * feet,
    points: [a.x, a.y, b.x, b.y],
  }
}

/**
 * Measure a chained path: points[0] → points[1] → … → points[n].
 *
 * Grid distance is summed per segment, which is how a creature that turns a
 * corner actually moves. `directFeet` is summed the same way — the length of the
 * path as drawn — and `straightFeet` is the as-the-crow-flies distance from the
 * first point to the last.
 */
export function measurePath(points, gridSize, feetPerCell) {
  const list = Array.isArray(points) ? points : []
  const segments = []
  for (let i = 1; i < list.length; i++) {
    const seg = measureSegment(list[i - 1], list[i], gridSize, feetPerCell)
    if (!seg) return null
    segments.push(seg)
  }
  if (segments.length === 0) return null

  const feet = normaliseFeetPerCell(feetPerCell)
  const first = segments[0].from
  const last = segments[segments.length - 1].to
  const polyline = [...segments[0].points]
  for (const s of segments.slice(1)) polyline.push(s.points[2], s.points[3])

  return {
    segments,
    squares: segments.reduce((sum, s) => sum + s.squares, 0),
    gridFeet: segments.reduce((sum, s) => sum + s.gridFeet, 0),
    directFeet: segments.reduce((sum, s) => sum + s.directFeet, 0),
    straightFeet: directSquares(first, last) * feet,
    points: polyline,
  }
}

/** "15 ft", "21.2 ft" — one decimal, and none when it is a whole number. */
export function formatFeet(feet) {
  if (!Number.isFinite(feet)) return '—'
  const rounded = Math.round(feet * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ft`
}

/**
 * The label drawn beside a measurement.
 * Grid distance first — it is the rules answer — then the direct distance only
 * when it differs, so a straight orthogonal line does not say "15 ft · 15 ft".
 */
export function formatMeasurement(result) {
  if (!result) return ''
  const grid = formatFeet(result.gridFeet)
  const direct = formatFeet(result.segments ? result.straightFeet : result.directFeet)
  const legs = result.segments && result.segments.length > 1 ? ` (${result.segments.length} legs)` : ''
  return direct === grid ? `${grid}${legs}` : `${grid}${legs} · ${direct} direct`
}
