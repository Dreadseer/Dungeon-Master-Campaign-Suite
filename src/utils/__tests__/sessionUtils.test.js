import { describe, it, expect } from 'vitest'
import {
  PLOT_STATUSES,
  CLOSING_STATUSES,
  isClosingStatus,
  sessionLabel,
  formatSessionDate,
  nextSessionNumber,
  groupPlotsByStatus,
  plotSessionSummary,
  allowedTransitions,
} from '../sessionUtils.js'

const session = (over = {}) => ({ id: 1, session_number: 1, title: null, played_on: null, ...over })

describe('sessionLabel', () => {
  it('prefers the title', () => {
    expect(sessionLabel(session({ title: 'Into the Haunted House' }))).toBe('Into the Haunted House')
  })

  it('falls back to "Session N" when untitled', () => {
    expect(sessionLabel(session({ session_number: 7 }))).toBe('Session 7')
  })

  it('treats a whitespace-only title as untitled', () => {
    expect(sessionLabel(session({ title: '   ', session_number: 3 }))).toBe('Session 3')
  })

  it('never returns an empty string', () => {
    for (const bad of [null, undefined, {}, { title: '' }, { session_number: null }]) {
      expect(sessionLabel(bad).length).toBeGreaterThan(0)
    }
  })

  it('handles a non-string title without throwing', () => {
    expect(sessionLabel(session({ title: 42, session_number: 2 }))).toBe('Session 2')
  })
})

describe('formatSessionDate', () => {
  it('renders an ISO date', () => {
    // Asserted through the same locale call the function makes, so this does not
    // break on a machine with different locale defaults.
    const expected = new Date(2026, 8, 12).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    expect(formatSessionDate('2026-09-12')).toBe(expected)
  })

  it('parses as a calendar date, not UTC midnight', () => {
    // `new Date('2026-09-12')` is UTC midnight, which renders as the 11th in any
    // negative-offset timezone. The day component must survive.
    expect(formatSessionDate('2026-09-12')).toContain('12')
  })

  it('accepts a datetime and uses only the date part', () => {
    expect(formatSessionDate('2026-09-12 20:30:00')).toContain('12')
  })

  it('returns null for an absent date', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(formatSessionDate(empty)).toBeNull()
    }
  })

  it('returns null rather than "Invalid Date" for junk', () => {
    for (const junk of ['not a date', '12/09/2026', 42, {}, []]) {
      expect(formatSessionDate(junk)).toBeNull()
    }
  })

  it('rejects a date that rolled over', () => {
    // 2026-02-31 would silently become 3 March.
    expect(formatSessionDate('2026-02-31')).toBeNull()
  })

  it('accepts a leap day in a leap year', () => {
    expect(formatSessionDate('2024-02-29')).not.toBeNull()
  })

  it('rejects a leap day in a non-leap year', () => {
    expect(formatSessionDate('2026-02-29')).toBeNull()
  })
})

describe('nextSessionNumber', () => {
  it('starts at 1 for a campaign with no sessions', () => {
    expect(nextSessionNumber([])).toBe(1)
    expect(nextSessionNumber(null)).toBe(1)
    expect(nextSessionNumber(undefined)).toBe(1)
  })

  it('is one past the highest', () => {
    expect(nextSessionNumber([{ session_number: 1 }, { session_number: 2 }])).toBe(3)
  })

  it('does not depend on ordering', () => {
    expect(nextSessionNumber([{ session_number: 5 }, { session_number: 2 }, { session_number: 9 }])).toBe(10)
  })

  it('preserves gaps rather than filling them', () => {
    // Sessions 1, 2, 4 exist because 3 was deleted. The next is 5, not 3 — a DM
    // who deleted session 3 does not want the next one called 3.
    expect(nextSessionNumber([{ session_number: 1 }, { session_number: 2 }, { session_number: 4 }])).toBe(5)
  })

  it('ignores malformed rows', () => {
    expect(nextSessionNumber([{ session_number: 3 }, { session_number: null }, {}, null, { session_number: 'x' }, { session_number: 0 }]))
      .toBe(4)
  })
})

describe('groupPlotsByStatus', () => {
  const plots = [
    { id: 1, status: 'open' },
    { id: 2, status: 'active' },
    { id: 3, status: 'active' },
    { id: 4, status: 'resolved' },
  ]

  it('always returns all four keys, so a board can render an empty column', () => {
    const groups = groupPlotsByStatus(plots)
    expect(Object.keys(groups)).toEqual(PLOT_STATUSES)
    expect(groups.abandoned).toEqual([])
  })

  it('puts each thread in its own group', () => {
    const groups = groupPlotsByStatus(plots)
    expect(groups.open).toHaveLength(1)
    expect(groups.active).toHaveLength(2)
    expect(groups.resolved).toHaveLength(1)
  })

  it('preserves the order within a group', () => {
    expect(groupPlotsByStatus(plots).active.map(p => p.id)).toEqual([2, 3])
  })

  it('treats an unknown or missing status as open rather than dropping the row', () => {
    const groups = groupPlotsByStatus([{ id: 9, status: 'nonsense' }, { id: 10 }, { id: 11, status: null }])
    expect(groups.open.map(p => p.id)).toEqual([9, 10, 11])
  })

  it('handles nullish input', () => {
    expect(groupPlotsByStatus(null).open).toEqual([])
    expect(groupPlotsByStatus(undefined).active).toEqual([])
  })
})

describe('plotSessionSummary', () => {
  it('names the opening session', () => {
    expect(plotSessionSummary({ status: 'active', opened_session_number: 2 }))
      .toBe('opened in session 2')
  })

  it('names both when the thread is resolved', () => {
    expect(plotSessionSummary({ status: 'resolved', opened_session_number: 2, resolved_session_number: 7 }))
      .toBe('opened in session 2 · resolved in session 7')
  })

  it('says "abandoned" for an abandoned thread', () => {
    expect(plotSessionSummary({ status: 'abandoned', resolved_session_number: 4 }))
      .toBe('abandoned in session 4')
  })

  it('returns null when there is nothing to say', () => {
    expect(plotSessionSummary({ status: 'open' })).toBeNull()
    expect(plotSessionSummary(null)).toBeNull()
  })

  it('ignores a null session link — the session was deleted', () => {
    // ON DELETE SET NULL leaves the thread alive with no link, which must render
    // as "nothing to say" rather than "opened in session null".
    expect(plotSessionSummary({ status: 'active', opened_session_number: null })).toBeNull()
  })
})

describe('status helpers', () => {
  it('lists the four statuses in board order', () => {
    expect(PLOT_STATUSES).toEqual(['open', 'active', 'resolved', 'abandoned'])
  })

  it('identifies the closing statuses', () => {
    expect(CLOSING_STATUSES).toEqual(['resolved', 'abandoned'])
    expect(isClosingStatus('resolved')).toBe(true)
    expect(isClosingStatus('abandoned')).toBe(true)
    expect(isClosingStatus('open')).toBe(false)
    expect(isClosingStatus('active')).toBe(false)
    expect(isClosingStatus(undefined)).toBe(false)
  })

  it('offers every other status as a transition', () => {
    expect(allowedTransitions('open')).toEqual(['active', 'resolved', 'abandoned'])
    expect(allowedTransitions('resolved')).toEqual(['open', 'active', 'abandoned'])
  })

  it('allows reopening a resolved thread', () => {
    // Threads get reopened often enough that a one-way board would be wrong.
    expect(allowedTransitions('resolved')).toContain('open')
    expect(allowedTransitions('abandoned')).toContain('active')
  })

  it('never offers the current status', () => {
    for (const status of PLOT_STATUSES) {
      expect(allowedTransitions(status)).not.toContain(status)
    }
  })

  it('treats an unknown status as open', () => {
    expect(allowedTransitions('nonsense')).toEqual(['active', 'resolved', 'abandoned'])
  })
})
