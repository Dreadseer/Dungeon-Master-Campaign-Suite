import { describe, it, expect } from 'vitest'

// Confirms the harness itself runs. Deliberately trivial.
describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
