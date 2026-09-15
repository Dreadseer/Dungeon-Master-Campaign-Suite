import { describe, it, expect } from 'vitest'
import {
  TABLE_DICE, DEFAULT_DIE, dieFaces,
  normaliseEntry, parseEntries, entryForRoll, rollTable,
  validateTable, rangeLabel, describeTable, evenRanges,
} from '../tableUtils.js'

/** A complete d20 table: 1-10, 11-15, 16-19, 20. */
const d20Table = () => ({
  die: 'd20',
  entries: JSON.stringify([
    { roll_min: 1, roll_max: 10, label: 'Nothing' },
    { roll_min: 11, roll_max: 15, label: 'Tracks', encounter_id: null },
    { roll_min: 16, roll_max: 19, label: 'Goblin patrol', encounter_id: 7 },
    { roll_min: 20, roll_max: 20, label: 'The dragon' },
  ]),
})

/** A sequence-backed rng, so a "roll" is exactly the number we want. */
const rollsOf = (...values) => {
  let i = 0
  return () => {
    const v = values[i % values.length]
    i++
    return (v - 1) / 20   // inverse of Math.floor(r * 20) + 1, for d20
  }
}

describe('dieFaces', () => {
  it('knows the standard dice', () => {
    expect(dieFaces('d4')).toBe(4)
    expect(dieFaces('d20')).toBe(20)
    expect(dieFaces('d100')).toBe(100)
  })

  it('ignores case and whitespace', () => {
    expect(dieFaces(' D20 ')).toBe(20)
  })

  it('falls back to the default rather than throwing', () => {
    for (const junk of ['d7', '', null, undefined, 42, {}]) {
      expect(dieFaces(junk)).toBe(TABLE_DICE[DEFAULT_DIE])
    }
  })
})

describe('normaliseEntry', () => {
  it('reads a range', () => {
    expect(normaliseEntry({ roll_min: 3, roll_max: 6, label: 'x' }))
      .toEqual({ roll_min: 3, roll_max: 6, label: 'x', encounter_id: null })
  })

  it('a single number entry covers just that number', () => {
    // "7: goblins" means 7 to 7, not 7 to 0.
    expect(normaliseEntry({ roll_min: 7, label: 'goblins' }))
      .toMatchObject({ roll_min: 7, roll_max: 7 })
  })

  it('treats an empty roll_max as a single number', () => {
    expect(normaliseEntry({ roll_min: 7, roll_max: '', label: 'x' }).roll_max).toBe(7)
  })

  it('reads a backwards range the way it was obviously meant', () => {
    expect(normaliseEntry({ roll_min: 12, roll_max: 4, label: 'x' }))
      .toMatchObject({ roll_min: 4, roll_max: 12 })
  })

  it('keeps a linked encounter id as a number', () => {
    expect(normaliseEntry({ roll_min: 1, encounter_id: '9' }).encounter_id).toBe(9)
  })

  it('treats an empty encounter_id as unlinked', () => {
    expect(normaliseEntry({ roll_min: 1, encounter_id: '' }).encounter_id).toBeNull()
    expect(normaliseEntry({ roll_min: 1 }).encounter_id).toBeNull()
  })

  it('trims the label', () => {
    expect(normaliseEntry({ roll_min: 1, label: '  x  ' }).label).toBe('x')
  })

  it('rejects an entry with no usable roll_min', () => {
    for (const bad of [{}, { roll_min: 'abc' }, { label: 'x' }, null, 'nope', 42]) {
      expect(normaliseEntry(bad)).toBeNull()
    }
  })
})

describe('parseEntries', () => {
  it('parses the stored JSON string', () => {
    expect(parseEntries(d20Table().entries)).toHaveLength(4)
  })

  it('accepts an already-parsed array', () => {
    expect(parseEntries([{ roll_min: 1, label: 'x' }])).toHaveLength(1)
  })

  it('returns empty for corrupt JSON rather than throwing', () => {
    expect(parseEntries('{not json')).toEqual([])
  })

  it('returns empty for nullish', () => {
    expect(parseEntries(null)).toEqual([])
    expect(parseEntries(undefined)).toEqual([])
  })

  it('sorts by roll, so display and matching do not depend on insert order', () => {
    const out = parseEntries([
      { roll_min: 16, label: 'c' }, { roll_min: 1, label: 'a' }, { roll_min: 11, label: 'b' },
    ])
    expect(out.map(e => e.label)).toEqual(['a', 'b', 'c'])
  })

  it('drops unusable entries but keeps the good ones', () => {
    expect(parseEntries([{ roll_min: 1, label: 'ok' }, { label: 'no roll' }])).toHaveLength(1)
  })
})

describe('entryForRoll', () => {
  const entries = parseEntries(d20Table().entries)

  it('finds the entry covering a roll', () => {
    expect(entryForRoll(entries, 1).label).toBe('Nothing')
    expect(entryForRoll(entries, 10).label).toBe('Nothing')
    expect(entryForRoll(entries, 11).label).toBe('Tracks')
    expect(entryForRoll(entries, 20).label).toBe('The dragon')
  })

  it('matches at both edges of a range', () => {
    expect(entryForRoll(entries, 16).label).toBe('Goblin patrol')
    expect(entryForRoll(entries, 19).label).toBe('Goblin patrol')
  })

  it('EVERY face of the die maps to an entry — the property that matters', () => {
    for (let n = 1; n <= 20; n++) {
      expect(entryForRoll(entries, n), `roll ${n}`).not.toBeNull()
    }
  })

  it('returns null for a roll in a gap', () => {
    const gapped = parseEntries([{ roll_min: 1, roll_max: 5, label: 'x' }])
    expect(entryForRoll(gapped, 9)).toBeNull()
  })

  it('resolves an overlap deterministically, by sorted order', () => {
    const overlapping = parseEntries([
      { roll_min: 5, roll_max: 10, label: 'second' },
      { roll_min: 1, roll_max: 7, label: 'first' },
    ])
    expect(entryForRoll(overlapping, 6).label).toBe('first')
  })

  it('handles junk input', () => {
    expect(entryForRoll(entries, 'abc')).toBeNull()
    expect(entryForRoll(null, 5)).toBeNull()
  })
})

describe('rollTable', () => {
  it('rolls within the die', () => {
    for (let i = 0; i < 300; i++) {
      const { roll } = rollTable(d20Table())
      expect(roll).toBeGreaterThanOrEqual(1)
      expect(roll).toBeLessThanOrEqual(20)
    }
  })

  it('never rolls 0 or faces+1 at the extremes of the rng', () => {
    expect(rollTable(d20Table(), () => 0).roll).toBe(1)
    expect(rollTable(d20Table(), () => 0.9999999).roll).toBe(20)
  })

  it('resolves to the right entry', () => {
    expect(rollTable(d20Table(), rollsOf(20)).entry.label).toBe('The dragon')
    expect(rollTable(d20Table(), rollsOf(12)).entry.label).toBe('Tracks')
  })

  it('reports the die it actually used', () => {
    expect(rollTable({ die: 'd6', entries: '[]' }).die).toBe('d6')
    expect(rollTable({ die: 'nonsense', entries: '[]' }).die).toBe('d20')
  })

  // The acceptance line: roll a d20 table ten times, every result maps.
  it('ten rolls of a complete table all map to an entry', () => {
    for (let i = 0; i < 10; i++) {
      expect(rollTable(d20Table()).entry).not.toBeNull()
    }
  })

  it('returns a null entry rather than throwing when the table has a gap', () => {
    const partial = { die: 'd20', entries: [{ roll_min: 1, roll_max: 2, label: 'x' }] }
    const out = rollTable(partial, rollsOf(19))
    expect(out.entry).toBeNull()
    expect(out.roll).toBe(19)
  })

  it('survives a table with no entries at all', () => {
    expect(() => rollTable({ die: 'd20' })).not.toThrow()
    expect(rollTable({ die: 'd20' }).entry).toBeNull()
  })

  it('survives being handed nothing', () => {
    expect(() => rollTable(null)).not.toThrow()
  })
})

describe('validateTable', () => {
  it('a complete table is ok', () => {
    const r = validateTable(d20Table())
    expect(r.ok).toBe(true)
    expect(r.covered).toBe(20)
    expect(r.gaps).toEqual([])
  })

  it('reports gaps as ranges, not a list of loose numbers', () => {
    const r = validateTable({ die: 'd20', entries: [
      { roll_min: 1, roll_max: 5, label: 'a' },
      { roll_min: 16, roll_max: 20, label: 'b' },
    ] })
    expect(r.ok).toBe(false)
    expect(r.gaps).toEqual([{ roll_min: 6, roll_max: 15 }])
  })

  it('reports a gap that runs to the last face', () => {
    const r = validateTable({ die: 'd6', entries: [{ roll_min: 1, roll_max: 4, label: 'a' }] })
    expect(r.gaps).toEqual([{ roll_min: 5, roll_max: 6 }])
  })

  it('reports a gap at the start', () => {
    const r = validateTable({ die: 'd6', entries: [{ roll_min: 3, roll_max: 6, label: 'a' }] })
    expect(r.gaps).toEqual([{ roll_min: 1, roll_max: 2 }])
  })

  it('reports overlapping entries', () => {
    const r = validateTable({ die: 'd6', entries: [
      { roll_min: 1, roll_max: 4, label: 'a' },
      { roll_min: 3, roll_max: 6, label: 'b' },
    ] })
    expect(r.overlaps.map(o => o.roll)).toEqual([3, 4])
  })

  it('reports entries outside the die', () => {
    const r = validateTable({ die: 'd6', entries: [
      { roll_min: 1, roll_max: 6, label: 'a' },
      { roll_min: 7, roll_max: 9, label: 'too high' },
    ] })
    expect(r.outOfRange).toHaveLength(1)
    expect(r.outOfRange[0].label).toBe('too high')
  })

  it('an entry outside the die does not count as coverage', () => {
    const r = validateTable({ die: 'd6', entries: [{ roll_min: 7, roll_max: 9, label: 'x' }] })
    expect(r.covered).toBe(0)
    expect(r.gaps).toEqual([{ roll_min: 1, roll_max: 6 }])
  })

  it('reports an entry with neither label nor linked encounter', () => {
    const r = validateTable({ die: 'd4', entries: [{ roll_min: 1, roll_max: 4 }] })
    expect(r.unlabelled).toHaveLength(1)
  })

  it('an entry with only a linked encounter is fine', () => {
    const r = validateTable({ die: 'd4', entries: [{ roll_min: 1, roll_max: 4, encounter_id: 3 }] })
    expect(r.unlabelled).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('an empty table reports the whole die as a gap', () => {
    const r = validateTable({ die: 'd20', entries: [] })
    expect(r.covered).toBe(0)
    expect(r.gaps).toEqual([{ roll_min: 1, roll_max: 20 }])
  })

  it('handles being given nothing', () => {
    expect(() => validateTable(null)).not.toThrow()
    expect(validateTable(null).faces).toBe(20)
  })
})

describe('rangeLabel', () => {
  it('shows a single number alone', () => {
    expect(rangeLabel({ roll_min: 7, roll_max: 7 })).toBe('7')
  })

  it('shows a range with an en dash', () => {
    expect(rangeLabel({ roll_min: 3, roll_max: 6 })).toBe('3–6')
  })

  it('handles null', () => {
    expect(rangeLabel(null)).toBe('')
  })
})

describe('describeTable', () => {
  it('says when a table is complete', () => {
    expect(describeTable(d20Table())).toMatch(/Complete — all 20/)
  })

  it('says when it is empty', () => {
    expect(describeTable({ die: 'd20', entries: [] })).toMatch(/Empty/)
  })

  it('names what is uncovered', () => {
    const out = describeTable({ die: 'd20', entries: [{ roll_min: 1, roll_max: 10, label: 'a' }] })
    expect(out).toMatch(/10 results uncovered/)
    expect(out).toContain('11–20')
  })

  it('uses the singular for one uncovered result', () => {
    const out = describeTable({ die: 'd6', entries: [{ roll_min: 1, roll_max: 5, label: 'a' }] })
    expect(out).toMatch(/1 result uncovered/)
  })
})

describe('evenRanges', () => {
  it('spreads entries across the die', () => {
    expect(evenRanges(20, 4)).toEqual([
      { roll_min: 1, roll_max: 5 }, { roll_min: 6, roll_max: 10 },
      { roll_min: 11, roll_max: 15 }, { roll_min: 16, roll_max: 20 },
    ])
  })

  it('covers every face when the count does not divide evenly', () => {
    const ranges = evenRanges(20, 6)
    expect(ranges[0].roll_min).toBe(1)
    expect(ranges.at(-1).roll_max).toBe(20)
    // No gaps and no overlaps between consecutive ranges.
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].roll_min).toBe(ranges[i - 1].roll_max + 1)
    }
  })

  it('gives the wider ranges to the END, keeping early results narrow', () => {
    const ranges = evenRanges(20, 6)
    const sizes = ranges.map(r => r.roll_max - r.roll_min + 1)
    expect(sizes).toEqual([3, 3, 3, 3, 4, 4])
  })

  it('degrades to one face each when asked for more entries than faces', () => {
    expect(evenRanges(4, 10)).toHaveLength(4)
    expect(evenRanges(4, 10).every(r => r.roll_min === r.roll_max)).toBe(true)
  })

  it('produces a table validateTable calls complete', () => {
    for (const [faces, count] of [[20, 6], [6, 4], [100, 7], [12, 12], [8, 3]]) {
      const entries = evenRanges(faces, count).map((r, i) => ({ ...r, label: `entry ${i}` }))
      const result = validateTable({ die: `d${faces}`, entries })
      expect(result.ok, `d${faces} with ${count} entries`).toBe(true)
    }
  })

  it('handles zero and junk', () => {
    expect(evenRanges(20, 0)).toEqual([])
    expect(evenRanges(20, -3)).toEqual([])
    expect(() => evenRanges(null, null)).not.toThrow()
  })
})
