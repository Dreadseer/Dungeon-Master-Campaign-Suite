const { ipcMain } = require('electron')

// ─────────────────────────────────────────────────────────────────────────────
// Single wrapper for every ipcMain channel in the app.
//
// Without it, a throwing handler reaches the renderer as an unhandled promise
// rejection reading "Error invoking remote method 'db:npcs:delete': Error:
// FOREIGN KEY constraint failed" — if the call site has no `catch`, the user
// sees nothing at all and the button appears to do nothing.
//
// This wrapper does three things:
//   1. logs every failure in the main process with its channel name, so a
//      terminal running `npm run dev` shows what actually broke;
//   2. rethrows a plain Error carrying only the underlying message, so the
//      string that survives IPC serialisation is readable;
//   3. tags the error with the channel via a `[channel]` suffix that the
//      renderer's error helper (src/utils/ipcError.js) parses back off.
//
// Electron always prefixes the renderer-side message with "Error invoking
// remote method '<channel>':" and that cannot be suppressed from here — the
// renderer helper strips it. Between the two, a toast shows just the message.
// ─────────────────────────────────────────────────────────────────────────────

// Errors that are already meant for the user — thrown deliberately by a handler
// with a human-readable message — pass through unchanged. Everything else is
// still surfaced, just logged more loudly.
const messageOf = (err) => {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return 'An unexpected error occurred.'
}

/**
 * Register an ipcMain.handle channel with error logging and clean rethrow.
 * The callback keeps the normal (event, ...args) signature and may be sync or async.
 */
// Channels that change a campaign's world, and how to find the campaign id in
// their arguments. Registered centrally so every save site is covered — the
// eight components Phase 6 deferred, plus the batch save, plus anything added
// later that goes through IPC at all.
//
// `(args) => id` receives the handler arguments WITHOUT the event.
const WORLD_WRITE_CHANNELS = new Map([
  ['db:npcs:create',        (a) => a[0]?.campaign_id],
  ['db:npcs:update',        (a) => a[1]?.campaign_id],
  ['db:npcs:delete',        () => null],
  ['db:npcs:toggleAlive',   () => null],
  ['db:locations:create',   (a) => a[0]?.campaign_id],
  ['db:locations:update',   (a) => a[1]?.campaign_id],
  ['db:locations:delete',   () => null],
  ['db:factions:create',    (a) => a[0]?.campaign_id],
  ['db:factions:update',    (a) => a[1]?.campaign_id],
  ['db:factions:delete',    () => null],
  ['db:lore:create',        (a) => a[0]?.campaign_id],
  ['db:lore:update',        (a) => a[1]?.campaign_id],
  ['db:lore:delete',        () => null],
  ['db:world:saveBatch',    (a) => a[0]?.records?.[0]?.payload?.campaign_id],
  ['db:world:undoBatch',    () => null],
])

/**
 * Queue a lore re-index after a successful world write.
 *
 * Deliberately after the handler has produced its value and never awaited: the
 * renderer is waiting on this call, and embedding takes seconds.
 *
 * Deletes and a few updates carry no campaign id in their arguments, so they
 * fall back to whichever campaign is active — the only one whose index can be
 * being read.
 */
function scheduleReindex(channel, args) {
  const queue = global.loreReindexQueue
  if (!queue) return
  const resolve = WORLD_WRITE_CHANNELS.get(channel)
  if (!resolve) return
  try {
    queue.schedule(resolve(args) ?? global.activeCampaignId ?? null)
  } catch { /* upkeep must never break the write that triggered it */ }
}

function registerHandler(channel, fn) {
  const touchesWorld = WORLD_WRITE_CHANNELS.has(channel)

  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await fn(event, ...args)
      if (touchesWorld) scheduleReindex(channel, args)
      return result
    } catch (err) {
      console.error(`[ipc] ${channel} failed:`, err)
      const clean = new Error(`${messageOf(err)} [${channel}]`)
      clean.channel = channel
      throw clean
    }
  })
}

/**
 * Same wrapper for fire-and-forget ipcMain.on channels. These have no reply
 * path, so a throw here would be an unhandled rejection in the main process and
 * the renderer would never learn anything. Logging is all that is available;
 * channels that need to report back (e.g. ai:stream:start) send their own error
 * event and should keep doing so.
 */
function registerListener(channel, fn) {
  ipcMain.on(channel, async (event, ...args) => {
    try {
      await fn(event, ...args)
    } catch (err) {
      console.error(`[ipc] ${channel} (listener) failed:`, err)
    }
  })
}

module.exports = { registerHandler, registerListener, WORLD_WRITE_CHANNELS }
