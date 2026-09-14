// Debounced campaign-lore re-indexing (Phase 6.1 task 16).
//
// Phase 6 indexed lore on demand only, and documented that as a deferral: the
// alternative looked like hooking eight separate world-save components in the
// renderer, with eight chances to miss one.
//
// Doing it in the main process instead makes that unnecessary. Every world
// write already funnels through an IPC handler, so ONE wrapper around those
// handlers covers every save site — including any added later, and including
// writes that never came from a component at all (the batch save, an importer).
//
// The debounce matters because embedding is an Ollama call per changed entity:
// a DM typing in an NPC's notes fires an update per keystroke through the
// autosave, and re-embedding on each would be both slow and pointless.

const DEFAULT_DELAY_MS = 2000

class LoreReindexQueue {
  /**
   * @param {object} loreIndex   CampaignLoreIndex
   * @param {object} opts        { delayMs, log }
   */
  constructor(loreIndex, opts = {}) {
    this.loreIndex = loreIndex
    this.delayMs = opts.delayMs ?? DEFAULT_DELAY_MS
    this.log = opts.log ?? (() => {})
    /** campaignId -> timer. One pending re-index per campaign, not per write. */
    this.timers = new Map()
    /** campaignId -> true while a sync is in flight, so two cannot overlap. */
    this.running = new Set()
    this.enabled = true
  }

  /**
   * Note that a campaign's world changed. Cheap and synchronous — the caller is
   * an IPC handler returning a value to the renderer and must not wait.
   */
  schedule(campaignId) {
    const id = Number(campaignId)
    if (!this.enabled || !Number.isFinite(id) || id <= 0) return

    clearTimeout(this.timers.get(id))
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id)
      this._run(id)
    }, this.delayMs))
  }

  async _run(id) {
    if (this.running.has(id)) {
      // A write landed while the previous sync was still going; re-queue rather
      // than running two syncs over the same chunks at once.
      this.schedule(id)
      return
    }
    this.running.add(id)
    try {
      const name = this.loreIndex.db
        ?.get?.('SELECT name FROM campaigns WHERE id = ?', [id])?.name ?? ''
      const result = await this.loreIndex.sync(id, name)
      if (result?.added || result?.removed) {
        this.log(`[lore] campaign ${id}: +${result.added} -${result.removed} (${result.total} indexed)`)
      }
    } catch (err) {
      // Never surfaced to the DM: this is background upkeep, and a failure
      // degrades retrieval rather than breaking the save that triggered it.
      this.log(`[lore] campaign ${id}: re-index failed — ${err?.message ?? err}`)
    } finally {
      this.running.delete(id)
    }
  }

  /** Flush every pending timer immediately — used on quit and by tests. */
  async flush() {
    const ids = [...this.timers.keys()]
    for (const id of ids) {
      clearTimeout(this.timers.get(id))
      this.timers.delete(id)
    }
    await Promise.all(ids.map(id => this._run(id)))
  }

  stop() {
    this.enabled = false
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}

module.exports = LoreReindexQueue
module.exports.DEFAULT_DELAY_MS = DEFAULT_DELAY_MS
