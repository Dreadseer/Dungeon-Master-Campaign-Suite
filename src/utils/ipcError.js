// Renderer-side half of the IPC error contract. The main-process half is
// electron/ipc/registerHandler.js.
//
// When a wrapped main-process handler throws, Electron serialises the rejection
// and the renderer receives an Error whose message looks like:
//
//   Error invoking remote method 'db:locations:delete': Error: FOREIGN KEY constraint failed [db:locations:delete]
//
// Three layers of noise the user should never read: Electron's own prefix, a
// redundant "Error: ", and the channel tag registerHandler appends. This module
// peels all three off and hands back the message plus the channel it came from.

const REMOTE_PREFIX = /^Error invoking remote method '([^']+)':\s*/
const ERROR_PREFIX = /^(?:Uncaught\s+)?Error:\s*/
const CHANNEL_SUFFIX = /\s*\[([a-z][\w:.-]*)\]\s*$/i

const FALLBACK = 'Something went wrong.'

/**
 * Pull a human-readable message and the originating IPC channel out of anything
 * that reached a catch block — an Error from `invoke`, a plain Error, a string,
 * or a rejected value that is none of those.
 *
 * @returns {{ message: string, channel: string|null, raw: unknown }}
 */
export function parseIpcError(err) {
  const raw = err
  let message =
    err instanceof Error ? err.message
      : typeof err === 'string' ? err
        : err && typeof err.message === 'string' ? err.message
          : ''

  let channel = null

  const remote = message.match(REMOTE_PREFIX)
  if (remote) {
    channel = remote[1]
    message = message.slice(remote[0].length)
  }

  // Electron's prefix wraps the stringified Error, so a second "Error: " is
  // normal here. Strip repeatedly — nested invokes can stack them.
  let previous
  do {
    previous = message
    message = message.replace(ERROR_PREFIX, '')
  } while (message !== previous)

  const tagged = message.match(CHANNEL_SUFFIX)
  if (tagged) {
    channel = channel ?? tagged[1]
    message = message.slice(0, tagged.index)
  }

  message = message.trim()
  return { message: message || FALLBACK, channel, raw }
}

// Constraint failures are the ones users actually hit, and SQLite's wording is
// not something to put in front of a DM mid-session. Anything not listed falls
// through unchanged rather than being flattened into a generic apology.
const FRIENDLY = [
  [/FOREIGN KEY constraint failed/i,
    'Something else still refers to this. Remove or reassign it first.'],
  [/UNIQUE constraint failed/i,
    'That name is already taken. Try a different one.'],
  [/NOT NULL constraint failed:\s*\w+\.(\w+)/i,
    (m) => `"${m[1].replace(/_/g, ' ')}" is required.`],
  [/CHECK constraint failed/i,
    'That value is not one this field accepts.'],
  [/SQLITE_BUSY|database is locked/i,
    'The database is busy. Try again in a moment.'],
  [/ENOENT|no such file or directory/i,
    'That file is missing — it may have been moved or deleted.'],
  [/EACCES|EPERM|permission denied/i,
    'Permission denied. Check the file is not open in another program.'],
]

/**
 * parseIpcError plus a plain-language rewrite of the messages users hit most.
 * Unrecognised messages pass through verbatim — a specific error beats a vague one.
 */
export function friendlyIpcError(err) {
  const parsed = parseIpcError(err)
  for (const [pattern, replacement] of FRIENDLY) {
    const match = parsed.message.match(pattern)
    if (match) {
      return {
        ...parsed,
        message: typeof replacement === 'function' ? replacement(match) : replacement,
        technical: parsed.message,
      }
    }
  }
  return { ...parsed, technical: null }
}
