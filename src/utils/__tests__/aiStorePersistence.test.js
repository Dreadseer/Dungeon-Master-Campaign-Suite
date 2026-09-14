import { describe, it, expect } from 'vitest'
import { sanitiseHistory, MAX_PERSISTED_MESSAGES } from '../../stores/aiStore.js'

// Only the pure half of the store is unit-tested — the zustand wiring itself is
// exercised by the UI driver. sanitiseHistory is what decides what survives a
// restart, and each rule below is something that broke the page when it did not.

const msg = (over = {}) => ({ role: 'assistant', content: 'hello', ...over })

describe('sanitiseHistory', () => {
  it('keeps ordinary messages', () => {
    expect(sanitiseHistory([msg(), msg({ role: 'user', content: 'hi' })])).toHaveLength(2)
  })

  it('strips the streaming cursor — it is a rendering artefact, not content', () => {
    expect(sanitiseHistory([msg({ content: 'answer▋' })])[0].content).toBe('answer')
  })

  it('strips a cursor that landed mid-string', () => {
    expect(sanitiseHistory([msg({ content: 'a▋b▋c' })])[0].content).toBe('abc')
  })

  it('drops error bubbles — restoring last week\'s failure helps nobody', () => {
    expect(sanitiseHistory([msg(), msg({ isError: true, content: '⚠ Error' })])).toHaveLength(1)
  })

  it('drops a message that was only a cursor, left by a stream cut off mid-flight', () => {
    // Closing the app while streaming leaves a bubble whose entire content is
    // the cursor. Restored, it rendered as an empty assistant bubble forever.
    expect(sanitiseHistory([msg({ content: '▋' })])).toHaveLength(0)
  })

  it('drops whitespace-only content', () => {
    expect(sanitiseHistory([msg({ content: '   ' })])).toHaveLength(0)
  })

  it('preserves RAG sources alongside the answer', () => {
    const out = sanitiseHistory([msg({ sources: [{ source: 'PHB', page: 12 }] })])
    expect(out[0].sources).toHaveLength(1)
  })

  it('caps the log so localStorage cannot grow without bound', () => {
    const many = Array.from({ length: 500 }, (_, i) => msg({ content: `m${i}` }))
    const out = sanitiseHistory(many)
    expect(out).toHaveLength(MAX_PERSISTED_MESSAGES)
  })

  it('keeps the MOST RECENT messages when capping', () => {
    const many = Array.from({ length: 500 }, (_, i) => msg({ content: `m${i}` }))
    expect(sanitiseHistory(many).at(-1).content).toBe('m499')
  })

  it('drops entries with no role', () => {
    expect(sanitiseHistory([{ content: 'orphan' }])).toHaveLength(0)
  })

  it('handles nullish and junk input', () => {
    expect(sanitiseHistory(null)).toEqual([])
    expect(sanitiseHistory(undefined)).toEqual([])
    expect(sanitiseHistory('not an array')).toEqual([])
    expect(sanitiseHistory([null, undefined])).toEqual([])
  })

  it('does not mutate the array it was given', () => {
    const original = [msg({ content: 'x▋' })]
    sanitiseHistory(original)
    expect(original[0].content).toBe('x▋')
  })
})
