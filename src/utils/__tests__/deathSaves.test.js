import { describe, it, expect } from 'vitest'
import { applyDeathSave, rollDeathSave, emptyDeathSaves, isDying, DEATH_SAVE_TARGET } from '../dnd5e.js'

const at = (successes, failures) => ({ successes, failures })

describe('the DC', () => {
  it('is 10, per the PHB', () => {
    expect(DEATH_SAVE_TARGET).toBe(10)
  })

  it('10 succeeds and 9 fails — the boundary is not off by one', () => {
    expect(applyDeathSave(emptyDeathSaves(), 10).outcome).toBe('success')
    expect(applyDeathSave(emptyDeathSaves(), 9).outcome).toBe('failure')
  })
})

describe('natural 20 — the rule Phase 5 corrects', () => {
  // The old CharacterSheet roller gave successes + 2. The actual rule is that
  // the creature regains 1 hit point and stops dying.
  it('revives rather than adding two successes', () => {
    const r = applyDeathSave(at(1, 2), 20)
    expect(r.revived).toBe(true)
    expect(r.outcome).toBe('critical-success')
  })

  it('clears both counters, because the dying condition has ended', () => {
    const r = applyDeathSave(at(2, 2), 20)
    expect(r.successes).toBe(0)
    expect(r.failures).toBe(0)
  })

  it('is not reported as stable — stable is 0 HP, revived is 1 HP', () => {
    const r = applyDeathSave(at(2, 0), 20)
    expect(r.stable).toBe(false)
    expect(r.revived).toBe(true)
  })

  it('saves a character who was one failure from death', () => {
    const r = applyDeathSave(at(0, 2), 20)
    expect(r.dead).toBe(false)
    expect(r.revived).toBe(true)
  })

  it('says so in plain language', () => {
    expect(applyDeathSave(emptyDeathSaves(), 20).message).toMatch(/1 hit point/i)
  })
})

describe('natural 1 — two failures', () => {
  it('adds two failures', () => {
    expect(applyDeathSave(emptyDeathSaves(), 1).failures).toBe(2)
  })

  it('kills outright from one existing failure', () => {
    const r = applyDeathSave(at(0, 1), 1)
    expect(r.failures).toBe(3)
    expect(r.dead).toBe(true)
  })

  it('does not overshoot past three', () => {
    expect(applyDeathSave(at(0, 2), 1).failures).toBe(3)
  })

  it('leaves successes alone', () => {
    expect(applyDeathSave(at(2, 0), 1).successes).toBe(2)
  })
})

describe('ordinary rolls', () => {
  it('10 through 19 are successes', () => {
    for (let roll = 10; roll <= 19; roll++) {
      expect(applyDeathSave(emptyDeathSaves(), roll).outcome, `roll ${roll}`).toBe('success')
    }
  })

  it('2 through 9 are failures', () => {
    for (let roll = 2; roll <= 9; roll++) {
      expect(applyDeathSave(emptyDeathSaves(), roll).outcome, `roll ${roll}`).toBe('failure')
    }
  })

  it('each success adds exactly one', () => {
    expect(applyDeathSave(at(1, 0), 15).successes).toBe(2)
  })

  it('each failure adds exactly one', () => {
    expect(applyDeathSave(at(0, 1), 5).failures).toBe(2)
  })
})

describe('stabilising at three successes', () => {
  it('third success is stable', () => {
    const r = applyDeathSave(at(2, 1), 12)
    expect(r.successes).toBe(3)
    expect(r.stable).toBe(true)
    expect(r.dead).toBe(false)
  })

  it('stable is reported in the message', () => {
    expect(applyDeathSave(at(2, 0), 12).message).toMatch(/stable/i)
  })

  it('never counts past three', () => {
    expect(applyDeathSave(at(3, 0), 18).successes).toBe(3)
  })
})

describe('dying at three failures', () => {
  it('third failure is dead', () => {
    const r = applyDeathSave(at(1, 2), 5)
    expect(r.failures).toBe(3)
    expect(r.dead).toBe(true)
  })

  it('dead is reported in the message', () => {
    expect(applyDeathSave(at(0, 2), 3).message).toMatch(/dead/i)
  })
})

describe('input handling', () => {
  it('treats a missing current state as fresh', () => {
    for (const bad of [null, undefined, {}, 'x', 42]) {
      expect(applyDeathSave(bad, 15).successes).toBe(1)
    }
  })

  it('clamps a corrupted current state into range', () => {
    expect(applyDeathSave(at(9, -4), 15).successes).toBe(3)
    expect(applyDeathSave(at(9, -4), 15).failures).toBe(0)
  })

  it('clamps the roll to 1-20 rather than trusting it', () => {
    expect(applyDeathSave(emptyDeathSaves(), 99).roll).toBe(20)
    expect(applyDeathSave(emptyDeathSaves(), -3).roll).toBe(1)
    expect(applyDeathSave(emptyDeathSaves(), 'x').roll).toBe(1)
  })

  it('never mutates the state it was given', () => {
    const current = at(1, 1)
    applyDeathSave(current, 20)
    expect(current).toEqual({ successes: 1, failures: 1 })
  })

  it('always reports the roll it used', () => {
    for (let roll = 1; roll <= 20; roll++) {
      expect(applyDeathSave(emptyDeathSaves(), roll).roll).toBe(roll)
    }
  })
})

describe('rollDeathSave', () => {
  it('produces valid results across many rolls', () => {
    for (let i = 0; i < 400; i++) {
      const r = rollDeathSave(emptyDeathSaves())
      expect(r.roll).toBeGreaterThanOrEqual(1)
      expect(r.roll).toBeLessThanOrEqual(20)
      expect(r.successes + r.failures).toBeLessThanOrEqual(3)
      expect(['success', 'failure', 'critical-success', 'critical-failure']).toContain(r.outcome)
    }
  })

  it('a fight cannot be both revived and dead', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDeathSave(at(0, 2))
      expect(r.revived && r.dead).toBe(false)
    }
  })
})

describe('isDying', () => {
  it('is true for a player at 0 HP with fewer than three failures', () => {
    expect(isDying({ is_player: true, hp_current: 0, death_saves: at(0, 1) })).toBe(true)
  })

  it('is false for a monster at 0 HP — monsters just die', () => {
    expect(isDying({ is_player: false, hp_current: 0, death_saves: at(0, 0) })).toBe(false)
  })

  it('is false above 0 HP', () => {
    expect(isDying({ is_player: true, hp_current: 3 })).toBe(false)
  })

  it('is false once dead', () => {
    expect(isDying({ is_player: true, hp_current: 0, death_saves: at(0, 3) })).toBe(false)
  })

  it('counts negative HP as dying', () => {
    expect(isDying({ is_player: true, hp_current: -4, death_saves: at(0, 0) })).toBe(true)
  })

  it('handles a combatant with no death_saves yet', () => {
    expect(isDying({ is_player: true, hp_current: 0 })).toBe(true)
  })

  it('handles nullish input', () => {
    expect(isDying(null)).toBe(false)
    expect(isDying(undefined)).toBe(false)
  })
})
