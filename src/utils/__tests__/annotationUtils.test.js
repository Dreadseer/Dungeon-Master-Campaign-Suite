import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ANNOTATION_COLOR, MAX_LABEL_LENGTH, MIN_SHAPE_SIZE,
  normaliseAnnotation, parseAnnotations,
  createTextAnnotation, createRectAnnotation, createCircleAnnotation, createShapeAnnotation,
  annotationsForMode, removeAnnotation, moveAnnotation,
} from '../annotationUtils.js'

const text = { id: 't1', kind: 'text', x: 10, y: 20, text: 'Secret door', color: '#e05050' }
const rect = { id: 'r1', kind: 'rect', x: 100, y: 100, width: 50, height: 30, color: '#4fc3f7' }
const circle = { id: 'c1', kind: 'circle', x: 300, y: 200, radius: 75, color: '#7ed957' }

describe('normaliseAnnotation', () => {
  it('keeps well-formed annotations of every kind', () => {
    expect(normaliseAnnotation(text)).toEqual(text)
    expect(normaliseAnnotation(rect)).toEqual(rect)
    expect(normaliseAnnotation(circle)).toEqual(circle)
  })

  it('drops what cannot be drawn', () => {
    for (const bad of [
      null, 'text', 42, [],
      { ...text, id: '' }, { ...text, id: 7 },
      { ...text, x: NaN }, { ...text, y: '20' },
      { ...text, text: '   ' }, { ...text, text: null },
      { ...rect, width: 0 }, { ...rect, height: -5 }, { ...rect, width: '50' },
      { ...circle, radius: 0 }, { ...circle, radius: Infinity },
      { ...text, kind: 'arrow' },
    ]) {
      expect(normaliseAnnotation(bad)).toBeNull()
    }
  })

  it('replaces an unusable colour with the default rather than dropping the note', () => {
    expect(normaliseAnnotation({ ...text, color: 'javascript:alert(1)' }).color).toBe(DEFAULT_ANNOTATION_COLOR)
    expect(normaliseAnnotation({ ...text, color: undefined }).color).toBe(DEFAULT_ANNOTATION_COLOR)
  })

  it('tidies label whitespace and caps its length', () => {
    expect(normaliseAnnotation({ ...text, text: '  trap\n\ton   this square ' }).text).toBe('trap on this square')
    expect(normaliseAnnotation({ ...text, text: 'x'.repeat(500) }).text).toHaveLength(MAX_LABEL_LENGTH)
  })

  it('strips unknown fields', () => {
    expect(normaliseAnnotation({ ...rect, radius: 9, text: 'nope', secret: true })).toEqual(rect)
  })
})

describe('parseAnnotations', () => {
  it('parses the stored JSON', () => {
    expect(parseAnnotations(JSON.stringify([text, rect, circle]))).toEqual([text, rect, circle])
  })

  it('drops the bad entries and keeps the good ones', () => {
    expect(parseAnnotations([text, { kind: 'rect' }, null, circle])).toEqual([text, circle])
  })

  it('is empty for nothing, malformed JSON, or a non-array', () => {
    for (const v of [null, undefined, '', '  ', '{bad', '{"a":1}', 'null', 42, {}]) {
      expect(parseAnnotations(v)).toEqual([])
    }
  })
})

describe('creating annotations', () => {
  it('a label needs text', () => {
    expect(createTextAnnotation({ x: 5, y: 6 }, 'Lever', '#ffffff', 'a')).toEqual({
      id: 'a', kind: 'text', x: 5, y: 6, text: 'Lever', color: '#ffffff',
    })
    expect(createTextAnnotation({ x: 5, y: 6 }, '  ', '#ffffff', 'a')).toBeNull()
    expect(createTextAnnotation(null, 'Lever')).toBeNull()
  })

  it('generates an id when none is given', () => {
    const a = createTextAnnotation({ x: 1, y: 1 }, 'x')
    const b = createTextAnnotation({ x: 1, y: 1 }, 'x')
    expect(a.id).toBeTruthy()
    expect(a.id).not.toBe(b.id)
  })

  it('a rectangle dragged in any direction is stored top-left with positive size', () => {
    const expected = { id: 'r', kind: 'rect', x: 10, y: 20, width: 90, height: 60, color: DEFAULT_ANNOTATION_COLOR }
    expect(createRectAnnotation({ x: 10, y: 20 }, { x: 100, y: 80 }, null, 'r')).toEqual(expected)
    expect(createRectAnnotation({ x: 100, y: 80 }, { x: 10, y: 20 }, null, 'r')).toEqual(expected)
    expect(createRectAnnotation({ x: 100, y: 20 }, { x: 10, y: 80 }, null, 'r')).toEqual(expected)
  })

  it('a click is not a rectangle', () => {
    expect(createRectAnnotation({ x: 10, y: 10 }, { x: 11, y: 11 }, null, 'r')).toBeNull()
    expect(createRectAnnotation({ x: 10, y: 10 }, { x: 200, y: 10 + MIN_SHAPE_SIZE - 1 }, null, 'r')).toBeNull()
  })

  it('a circle is centred on the drag start', () => {
    expect(createCircleAnnotation({ x: 100, y: 100 }, { x: 130, y: 140 }, '#e05050', 'c')).toEqual({
      id: 'c', kind: 'circle', x: 100, y: 100, radius: 50, color: '#e05050',
    })
    expect(createCircleAnnotation({ x: 100, y: 100 }, { x: 101, y: 100 }, null, 'c')).toBeNull()
  })

  it('createShapeAnnotation dispatches on kind, and makes no shape for text', () => {
    expect(createShapeAnnotation('rect', { x: 0, y: 0 }, { x: 10, y: 10 }, null, 'x').kind).toBe('rect')
    expect(createShapeAnnotation('circle', { x: 0, y: 0 }, { x: 10, y: 10 }, null, 'x').kind).toBe('circle')
    expect(createShapeAnnotation('text', { x: 0, y: 0 }, { x: 10, y: 10 }, null, 'x')).toBeNull()
  })
})

describe('annotationsForMode — DM only', () => {
  const stored = JSON.stringify([text, rect, circle])

  it('the DM sees every annotation', () => {
    expect(annotationsForMode(stored, 'dm')).toHaveLength(3)
  })

  it('a player sees none', () => {
    expect(annotationsForMode(stored, 'player')).toEqual([])
  })

  it('anything that is not explicitly the DM sees none — fail closed', () => {
    for (const mode of [undefined, null, '', 'DM', 'spectator']) {
      expect(annotationsForMode(stored, mode)).toEqual([])
    }
  })
})

describe('removeAnnotation / moveAnnotation', () => {
  it('removes by id and leaves the rest', () => {
    expect(removeAnnotation([text, rect, circle], 'r1')).toEqual([text, circle])
    expect(removeAnnotation([text], 'missing')).toEqual([text])
  })

  it('moves by id', () => {
    expect(moveAnnotation([text, rect], 'r1', 5, 6)).toEqual([text, { ...rect, x: 5, y: 6 }])
  })

  it('ignores a move to an unusable position', () => {
    expect(moveAnnotation([rect], 'r1', NaN, 6)).toEqual([rect])
  })
})
