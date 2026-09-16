// DM-only map annotations: text labels and simple shapes.
//
// Stored as a JSON array in `maps.annotations`, in stage (map-pixel) space so
// they stay pinned to the map when it is panned or zoomed.
//
//   { id, kind: 'text',   x, y, text, color }
//   { id, kind: 'rect',   x, y, width, height, color }
//   { id, kind: 'circle', x, y, radius, color }
//
// THEY ARE NEVER SHOWN TO PLAYERS. "Secret door here", "the trap triggers on
// this square" — an annotation is the DM's margin note, and one that leaks is
// worse than none. That is enforced in three places, not one:
//   - MapCanvas draws no annotation layer in player mode (annotationsForMode);
//   - electron/server/fogFilter.js strips the column from every map row it
//     serves to a remote player, whatever the renderer does;
//   - nothing on the player side reads the column at all.
//
// Everything that comes out of storage goes through parseAnnotations, which
// drops anything malformed rather than letting one bad entry blank the layer.

export const ANNOTATION_KINDS = Object.freeze(['text', 'rect', 'circle'])
export const ANNOTATION_COLORS = Object.freeze(['#f5c542', '#e05050', '#4fc3f7', '#7ed957', '#ffffff'])
export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[0]
export const MAX_LABEL_LENGTH = 120
// A drag shorter than this is a click, not a shape.
export const MIN_SHAPE_SIZE = 4

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const HEX = /^#[0-9a-f]{6}$/i

function color(value) {
  return typeof value === 'string' && HEX.test(value) ? value : DEFAULT_ANNOTATION_COLOR
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `ann-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

function cleanText(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH) : ''
}

/** One stored annotation, normalised — or null if it cannot be drawn. */
export function normaliseAnnotation(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || raw.id === '') return null
  if (!isNum(raw.x) || !isNum(raw.y)) return null
  const base = { id: raw.id, kind: raw.kind, x: raw.x, y: raw.y, color: color(raw.color) }

  switch (raw.kind) {
    case 'text': {
      const text = cleanText(raw.text)
      return text ? { ...base, text } : null
    }
    case 'rect':
      return isNum(raw.width) && isNum(raw.height) && raw.width > 0 && raw.height > 0
        ? { ...base, width: raw.width, height: raw.height }
        : null
    case 'circle':
      return isNum(raw.radius) && raw.radius > 0 ? { ...base, radius: raw.radius } : null
    default:
      return null
  }
}

/** `maps.annotations` as a clean array. Never throws. */
export function parseAnnotations(value) {
  let list = value
  if (typeof value === 'string') {
    if (value.trim() === '') return []
    try { list = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list.map(normaliseAnnotation).filter(Boolean)
}

/** A label at a point, or null for empty text. */
export function createTextAnnotation(point, text, colorValue, id = newId()) {
  return normaliseAnnotation({ id, kind: 'text', x: point?.x, y: point?.y, text, color: colorValue })
}

/**
 * A rectangle from a drag. The drag can go in any direction; the stored shape is
 * always top-left + positive size. Null for a drag too small to be deliberate.
 */
export function createRectAnnotation(start, end, colorValue, id = newId()) {
  if (!start || !end) return null
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  if (width < MIN_SHAPE_SIZE || height < MIN_SHAPE_SIZE) return null
  return normaliseAnnotation({
    id, kind: 'rect', x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height, color: colorValue,
  })
}

/** A circle centred where the drag started, reaching to where it ended. */
export function createCircleAnnotation(start, end, colorValue, id = newId()) {
  if (!start || !end) return null
  const radius = Math.hypot(end.x - start.x, end.y - start.y)
  if (radius < MIN_SHAPE_SIZE) return null
  return normaliseAnnotation({ id, kind: 'circle', x: start.x, y: start.y, radius, color: colorValue })
}

/** Build whichever shape the active annotation kind draws from a drag. */
export function createShapeAnnotation(kind, start, end, colorValue, id) {
  if (kind === 'rect') return createRectAnnotation(start, end, colorValue, id)
  if (kind === 'circle') return createCircleAnnotation(start, end, colorValue, id)
  return null
}

/** The annotations a view may draw. Players get none, whatever is stored. */
export function annotationsForMode(annotations, mode) {
  return mode === 'dm' ? parseAnnotations(annotations) : []
}

export function removeAnnotation(annotations, id) {
  return parseAnnotations(annotations).filter(a => a.id !== id)
}

export function moveAnnotation(annotations, id, x, y) {
  if (!isNum(x) || !isNum(y)) return parseAnnotations(annotations)
  return parseAnnotations(annotations).map(a => (a.id === id ? { ...a, x, y } : a))
}
