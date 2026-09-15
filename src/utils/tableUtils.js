// Random encounter tables — pure rolling and range logic (Phase 7 task 4).
//
// A table is a die plus a list of entries, each covering a range of results:
//
//   { roll_min, roll_max, label, encounter_id? }
//
// Everything a DM can get wrong building one by hand — a gap that swallows a
// roll, two entries claiming the same number, a range running backwards, a
// d20 table whose entries stop at 12 — is decided here rather than discovered
// when a roll comes back empty at the table. Rolling is client-side by design:
// it needs no database round trip, and a pure function is one that can be
// tested for the property that actually matters, which is that EVERY face of
// the die maps to exactly one entry.

/** Dice a table can use. Values are the number of faces. */
export const TABLE_DICE = {
  d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100,
}

export const DEFAULT_DIE = 'd20'

/** Faces for a die name, defaulting rather than throwing on junk. */
export function dieFaces(die) {
  return TABLE_DICE[String(die ?? '').trim().toLowerCase()] ?? TABLE_DICE[DEFAULT_DIE]
}

const int = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

const str = (v) => (v == null ? '' : String(v).trim())

/**
 * Coerce one stored entry into a usable shape.
 *
 * A single-number entry (roll_min only) is normal — a DM writing "7: goblins"
 * means 7 to 7 — so a missing roll_max mirrors roll_min rather than becoming 0
 * and producing a backwards range that can never match.
 */
export function normaliseEntry(raw) {
  if (!raw || typeof raw !== 'object') return null

  const min = int(raw.roll_min, NaN)
  if (!Number.isFinite(min)) return null

  const rawMax = raw.roll_max == null || raw.roll_max === '' ? min : int(raw.roll_max, min)

  return {
    // A range typed backwards ("12-4") is a slip, not an empty range: read it
    // the way it was obviously meant.
    roll_min: Math.min(min, rawMax),
    roll_max: Math.max(min, rawMax),
    label: str(raw.label),
    encounter_id: raw.encounter_id == null || raw.encounter_id === ''
      ? null
      : int(raw.encounter_id, null),
  }
}

/** Parse the stored `entries` column, which is TEXT holding JSON. */
export function parseEntries(entries) {
  const raw = typeof entries === 'string'
    ? (() => { try { return JSON.parse(entries) } catch { return [] } })()
    : entries

  return (Array.isArray(raw) ? raw : [])
    .map(normaliseEntry)
    .filter(Boolean)
    .sort((a, b) => a.roll_min - b.roll_min || a.roll_max - b.roll_max)
}

/**
 * Which entry does this roll land on?
 *
 * First match wins, after sorting — so overlapping ranges resolve
 * deterministically rather than depending on the order the DM happened to add
 * them in. `validateTable` reports the overlap separately; this does not throw
 * over one, because a table with a flaw should still be rollable.
 */
export function entryForRoll(entries, roll) {
  const list = Array.isArray(entries) ? entries : []
  const n = int(roll, NaN)
  if (!Number.isFinite(n)) return null
  return list.find(e => n >= e.roll_min && n <= e.roll_max) ?? null
}

/**
 * Roll the table once.
 *
 * `rng` is injectable so tests are deterministic and so a caller can replay a
 * roll; it must return a float in [0, 1) like Math.random.
 *
 * @returns {{ roll, entry, die, faces }} — `entry` is null when the table has a
 *          gap at that number, which the UI reports rather than hiding.
 */
export function rollTable(table, rng = Math.random) {
  const faces = dieFaces(table?.die)
  const entries = parseEntries(table?.entries)
  const roll = Math.floor(rng() * faces) + 1
  return { roll, faces, die: `d${faces}`, entry: entryForRoll(entries, roll) }
}

/**
 * Everything wrong with a table, in the order a DM would want to fix it.
 *
 * Reported rather than enforced: a half-built table is a normal state to save
 * and come back to, and refusing to save one would be worse than saying what is
 * still missing.
 *
 * @returns {{ ok, faces, covered, gaps, overlaps, outOfRange, unlabelled }}
 */
export function validateTable(table) {
  const faces = dieFaces(table?.die)
  const entries = parseEntries(table?.entries)

  const gaps = []
  const overlaps = []
  const outOfRange = []
  const seen = new Map()   // face -> first entry index covering it

  for (const [i, entry] of entries.entries()) {
    if (entry.roll_min < 1 || entry.roll_max > faces) {
      outOfRange.push({
        index: i,
        label: entry.label,
        range: rangeLabel(entry),
        reason: `outside 1–${faces}`,
      })
    }
    for (let n = Math.max(1, entry.roll_min); n <= Math.min(faces, entry.roll_max); n++) {
      if (seen.has(n)) {
        overlaps.push({ roll: n, entries: [seen.get(n), i] })
      } else {
        seen.set(n, i)
      }
    }
  }

  // Gaps as ranges, not a list of 14 loose numbers.
  let runStart = null
  for (let n = 1; n <= faces; n++) {
    const missing = !seen.has(n)
    if (missing && runStart === null) runStart = n
    if ((!missing || n === faces) && runStart !== null) {
      const end = missing ? n : n - 1
      gaps.push({ roll_min: runStart, roll_max: end })
      runStart = null
    }
  }

  const unlabelled = entries
    .map((e, i) => ({ ...e, index: i }))
    .filter(e => !e.label && e.encounter_id == null)
    .map(e => ({ index: e.index, range: rangeLabel(e) }))

  return {
    ok: gaps.length === 0 && overlaps.length === 0 && outOfRange.length === 0 && unlabelled.length === 0,
    faces,
    covered: seen.size,
    gaps,
    overlaps,
    outOfRange,
    unlabelled,
  }
}

/** "7" or "3–6", for display. */
export function rangeLabel(entry) {
  if (!entry) return ''
  return entry.roll_min === entry.roll_max
    ? String(entry.roll_min)
    : `${entry.roll_min}–${entry.roll_max}`
}

/** One plain sentence about a table's state, for a list row. */
export function describeTable(table) {
  const result = validateTable(table)
  if (result.covered === 0) return 'Empty — no entries yet.'
  if (result.ok) return `Complete — all ${result.faces} results covered.`

  const parts = []
  if (result.gaps.length) {
    parts.push(`${result.faces - result.covered} result${result.faces - result.covered === 1 ? '' : 's'} uncovered (${result.gaps.map(rangeLabel).join(', ')})`)
  }
  if (result.overlaps.length) parts.push(`${result.overlaps.length} overlapping`)
  if (result.outOfRange.length) parts.push(`${result.outOfRange.length} outside the die`)
  if (result.unlabelled.length) parts.push(`${result.unlabelled.length} with no label`)
  return parts.join(' · ')
}

/**
 * Spread `count` entries evenly across the die, for a starting skeleton.
 *
 * A d20 table with 6 entries wants ranges of 3, 3, 3, 4, 4, 3 — not five
 * single numbers and one covering fifteen. The remainder is distributed one per
 * entry from the end, which is how published tables are usually laid out.
 */
export function evenRanges(faces, count) {
  const n = Math.max(0, int(count, 0))
  const f = Math.max(1, int(faces, 1))
  if (n === 0) return []
  if (n >= f) return Array.from({ length: f }, (_, i) => ({ roll_min: i + 1, roll_max: i + 1 }))

  const base = Math.floor(f / n)
  let remainder = f % n
  const ranges = []
  let cursor = 1

  for (let i = 0; i < n; i++) {
    // Give the remainder to the LAST entries, so the common results at the
    // start of the table stay narrow.
    const extra = i >= n - remainder ? 1 : 0
    const size = base + extra
    ranges.push({ roll_min: cursor, roll_max: cursor + size - 1 })
    cursor += size
  }
  void remainder
  return ranges
}
