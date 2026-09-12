// Pure helpers for sessions and plot threads.
//
// Session rows come straight out of SQLite, which means `played_on` is whatever
// string was stored and `title` may be null. Every function here tolerates both
// rather than assuming, because these render inside a list a DM scans mid-game.

/** The four states a plot thread can be in, in the order a board should show them. */
export const PLOT_STATUSES = ['open', 'active', 'resolved', 'abandoned']

/** Statuses that mean the thread is finished and should be stamped with a session. */
export const CLOSING_STATUSES = ['resolved', 'abandoned']

export const isClosingStatus = (status) => CLOSING_STATUSES.includes(status)

/**
 * Display name for a session: its title, or "Session N" when untitled.
 * Never returns an empty string — an unlabelled row in a list is unusable.
 */
export function sessionLabel(session) {
  if (!session) return 'Session'
  const title = typeof session.title === 'string' ? session.title.trim() : ''
  if (title) return title
  const n = session.session_number
  return Number.isFinite(n) ? `Session ${n}` : 'Session'
}

/**
 * `played_on` as a readable date, or null when there isn't one.
 *
 * SQLite has no date type, so this column holds whatever was written: an ISO
 * date from the date input, an empty string from a cleared field, or null.
 * Returning null rather than "Invalid Date" lets callers fall back to "no date".
 */
export function formatSessionDate(playedOn, locale = undefined) {
  if (typeof playedOn !== 'string' || playedOn.trim() === '') return null
  // Parse as a plain calendar date. `new Date('2026-09-12')` is parsed as UTC
  // midnight, which in a negative-offset timezone renders as the day before.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(playedOn.trim())
  if (!match) return null
  const [, y, m, day] = match
  const date = new Date(Number(y), Number(m) - 1, Number(day))
  if (Number.isNaN(date.getTime())) return null
  if (date.getMonth() !== Number(m) - 1) return null    // e.g. 2026-02-31 rolled over
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * The next session number for a campaign: one past the highest existing.
 * Gaps are preserved rather than filled — if sessions 1, 2 and 4 exist, the next
 * is 5. A DM who deleted session 3 does not want the next one called 3.
 */
export function nextSessionNumber(sessions) {
  const numbers = (Array.isArray(sessions) ? sessions : [])
    .map(s => s?.session_number)
    .filter(n => Number.isInteger(n) && n > 0)
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1
}

/**
 * Group plot threads by status, always returning all four keys so a board can
 * render an empty column rather than dropping it.
 */
export function groupPlotsByStatus(plots) {
  const groups = Object.fromEntries(PLOT_STATUSES.map(status => [status, []]))
  for (const plot of Array.isArray(plots) ? plots : []) {
    const status = PLOT_STATUSES.includes(plot?.status) ? plot.status : 'open'
    groups[status].push(plot)
  }
  return groups
}

/**
 * One-line summary of where a thread stands, for a card footer.
 * Returns null when there is nothing to say.
 */
export function plotSessionSummary(plot) {
  if (!plot) return null
  const parts = []
  if (Number.isFinite(plot.opened_session_number)) {
    parts.push(`opened in session ${plot.opened_session_number}`)
  }
  if (Number.isFinite(plot.resolved_session_number)) {
    parts.push(`${plot.status === 'abandoned' ? 'abandoned' : 'resolved'} in session ${plot.resolved_session_number}`)
  }
  return parts.length ? parts.join(' · ') : null
}

/**
 * Which statuses a thread may move to from where it is now.
 * Everything can reach everything except its current state — plot threads get
 * reopened often enough that a one-way board would be wrong.
 */
export function allowedTransitions(currentStatus) {
  const current = PLOT_STATUSES.includes(currentStatus) ? currentStatus : 'open'
  return PLOT_STATUSES.filter(s => s !== current)
}
