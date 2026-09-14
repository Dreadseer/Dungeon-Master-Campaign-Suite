import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import LoreReindexQueue from '../../../electron/services/loreReindexQueue.cjs'

// The queue is what makes central re-indexing affordable: every world write
// schedules one, and embedding is an Ollama call per changed entity. Each rule
// below is a way that could go wrong at a real DM's keyboard.

/** A stand-in for CampaignLoreIndex that records what it was asked to sync. */
const fakeIndex = (opts = {}) => {
  const calls = []
  return {
    calls,
    db: { get: () => ({ name: 'Waterdeep Nights' }) },
    sync: vi.fn(async (id, name) => {
      calls.push({ id, name })
      if (opts.slow) await new Promise(r => setTimeout(r, opts.slow))
      if (opts.throws) throw new Error('Ollama is not running')
      return { added: 1, removed: 0, total: 4 }
    }),
  }
}

describe('LoreReindexQueue', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('does not sync immediately — a keystroke must not embed', () => {
    const index = fakeIndex()
    new LoreReindexQueue(index).schedule(1)
    expect(index.sync).not.toHaveBeenCalled()
  })

  it('syncs once the debounce elapses', async () => {
    const index = fakeIndex()
    const q = new LoreReindexQueue(index, { delayMs: 2000 })
    q.schedule(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(index.sync).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of writes into ONE sync', async () => {
    // Notes autosave fires an update per blur; a roster edit fires several in a
    // row. Each must not cost its own pass over the campaign.
    const index = fakeIndex()
    const q = new LoreReindexQueue(index, { delayMs: 2000 })
    for (let i = 0; i < 20; i++) {
      q.schedule(1)
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(2000)
    expect(index.sync).toHaveBeenCalledTimes(1)
  })

  it('keeps campaigns separate — one debounce each', async () => {
    const index = fakeIndex()
    const q = new LoreReindexQueue(index, { delayMs: 1000 })
    q.schedule(1)
    q.schedule(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(index.calls.map(c => c.id).sort()).toEqual([1, 2])
  })

  it('passes the campaign name through, so the source stays labelled', async () => {
    const index = fakeIndex()
    const q = new LoreReindexQueue(index, { delayMs: 10 })
    q.schedule(7)
    await vi.advanceTimersByTimeAsync(10)
    expect(index.calls[0]).toEqual({ id: 7, name: 'Waterdeep Nights' })
  })

  it('ignores a missing or nonsense campaign id', async () => {
    const index = fakeIndex()
    const q = new LoreReindexQueue(index, { delayMs: 10 })
    for (const bad of [null, undefined, 0, -1, NaN, 'abc', {}]) q.schedule(bad)
    await vi.advanceTimersByTimeAsync(50)
    expect(index.sync).not.toHaveBeenCalled()
  })

  it('swallows a sync failure — background upkeep must not break the save', async () => {
    const index = fakeIndex({ throws: true })
    const logs = []
    const q = new LoreReindexQueue(index, { delayMs: 10, log: (m) => logs.push(m) })
    q.schedule(1)
    await expect(vi.advanceTimersByTimeAsync(10)).resolves.not.toThrow()
    expect(logs.join(' ')).toMatch(/failed/i)
  })

  it('never runs two syncs for one campaign at once', async () => {
    // Two overlapping passes would fight over the same chunk rows.
    const index = fakeIndex({ slow: 500 })
    const q = new LoreReindexQueue(index, { delayMs: 10 })
    q.schedule(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(index.sync).toHaveBeenCalledTimes(1)

    q.schedule(1)                            // arrives mid-flight
    await vi.advanceTimersByTimeAsync(10)
    expect(index.sync).toHaveBeenCalledTimes(1)   // re-queued, not doubled

    await vi.advanceTimersByTimeAsync(1000)
    expect(index.sync).toHaveBeenCalledTimes(2)
  })

  it('flush() runs everything pending at once', async () => {
    const index = fakeIndex()
    const q = new LoreReindexQueue(index, { delayMs: 60000 })
    q.schedule(1)
    q.schedule(2)
    await q.flush()
    expect(index.sync).toHaveBeenCalledTimes(2)
  })

  it('stop() cancels pending work', async () => {
    const index = fakeIndex()
    const q = new LoreReindexQueue(index, { delayMs: 100 })
    q.schedule(1)
    q.stop()
    await vi.advanceTimersByTimeAsync(500)
    expect(index.sync).not.toHaveBeenCalled()
  })

  it('ignores scheduling after stop()', async () => {
    const index = fakeIndex()
    const q = new LoreReindexQueue(index, { delayMs: 10 })
    q.stop()
    q.schedule(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(index.sync).not.toHaveBeenCalled()
  })

  it('copes with an index whose db lookup fails', async () => {
    const index = fakeIndex()
    index.db = { get: () => { throw new Error('no such table') } }
    const q = new LoreReindexQueue(index, { delayMs: 10, log: () => {} })
    q.schedule(1)
    await expect(vi.advanceTimersByTimeAsync(10)).resolves.not.toThrow()
  })
})
