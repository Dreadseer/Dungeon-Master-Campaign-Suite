import { describe, it, expect } from 'vitest'
import {
  resetForNewRound,
  applyHPDelta,
  grantTempHP,
  spendLegendaryAction,
  restoreLegendaryAction,
  lairActionRow,
  isLairRow,
  LAIR_ACTION_INITIATIVE,
  sortByInitiative,
} from '../combatUtils.js'

const c = (over = {}) => ({
  id: 'c1', name: 'Goblin', hp_max: 20, hp_current: 20, temp_hp: 0,
  reaction_used: false, legendary_max: 0, legendary_used: 0, lair_action_text: null,
  ...over,
})

describe('resetForNewRound', () => {
  it('clears legendary actions and reactions', () => {
    const [out] = resetForNewRound([c({ legendary_max: 3, legendary_used: 3, reaction_used: true })])
    expect(out.legendary_used).toBe(0)
    expect(out.reaction_used).toBe(false)
  })

  it('leaves HP, conditions and everything else alone', () => {
    const before = c({ hp_current: 4, conditions: ['Prone'], temp_hp: 3, legendary_used: 2 })
    const [after] = resetForNewRound([before])
    expect(after.hp_current).toBe(4)
    expect(after.conditions).toEqual(['Prone'])
    expect(after.temp_hp).toBe(3)
  })

  it('does not mutate the input', () => {
    const before = c({ legendary_used: 2, reaction_used: true })
    resetForNewRound([before])
    expect(before.legendary_used).toBe(2)
    expect(before.reaction_used).toBe(true)
  })

  it('handles an empty or nullish roster', () => {
    expect(resetForNewRound([])).toEqual([])
    expect(resetForNewRound(null)).toEqual([])
  })
})

describe('applyHPDelta — temp HP absorbs first', () => {
  it('damage comes off temp HP before real HP', () => {
    const r = applyHPDelta(c({ hp_current: 20, temp_hp: 5 }), -3)
    expect(r.combatant.temp_hp).toBe(2)
    expect(r.combatant.hp_current).toBe(20)
    expect(r.absorbed).toBe(3)
    expect(r.applied).toBe(0)
  })

  it('damage larger than temp HP spills into real HP', () => {
    const r = applyHPDelta(c({ hp_current: 20, temp_hp: 5 }), -8)
    expect(r.combatant.temp_hp).toBe(0)
    expect(r.combatant.hp_current).toBe(17)
    expect(r.absorbed).toBe(5)
    expect(r.applied).toBe(3)
  })

  it('exactly consuming temp HP leaves real HP untouched', () => {
    const r = applyHPDelta(c({ hp_current: 20, temp_hp: 5 }), -5)
    expect(r.combatant.temp_hp).toBe(0)
    expect(r.combatant.hp_current).toBe(20)
  })

  it('floors at 0 rather than going negative', () => {
    const r = applyHPDelta(c({ hp_current: 4 }), -10)
    expect(r.combatant.hp_current).toBe(0)
    expect(r.overkill).toBe(6)
  })

  it('reports overkill, which a DM needs for instant death', () => {
    // Damage exceeding max HP past 0 kills outright rather than dropping to dying.
    expect(applyHPDelta(c({ hp_current: 1, hp_max: 20 }), -25).overkill).toBe(24)
  })

  it('healing never restores temp HP', () => {
    // The common bug is the other direction — healing topping up temp HP.
    const r = applyHPDelta(c({ hp_current: 5, temp_hp: 0 }), +6)
    expect(r.combatant.hp_current).toBe(11)
    expect(r.combatant.temp_hp).toBe(0)
  })

  it('healing leaves existing temp HP in place', () => {
    const r = applyHPDelta(c({ hp_current: 5, temp_hp: 4 }), +6)
    expect(r.combatant.temp_hp).toBe(4)
  })

  it('healing never exceeds hp_max', () => {
    expect(applyHPDelta(c({ hp_current: 18, hp_max: 20 }), +10).combatant.hp_current).toBe(20)
  })

  it('healing from 0 brings a creature back above 0', () => {
    expect(applyHPDelta(c({ hp_current: 0 }), +1).combatant.hp_current).toBe(1)
  })

  it('a zero delta changes nothing', () => {
    const r = applyHPDelta(c({ hp_current: 12, temp_hp: 3 }), 0)
    expect(r.combatant.hp_current).toBe(12)
    expect(r.combatant.temp_hp).toBe(3)
  })

  it('does not mutate the combatant', () => {
    const before = c({ hp_current: 20, temp_hp: 5 })
    applyHPDelta(before, -8)
    expect(before.hp_current).toBe(20)
    expect(before.temp_hp).toBe(5)
  })

  it('copes with missing or junk fields', () => {
    const r = applyHPDelta({ hp_max: 10 }, -3)
    expect(Number.isFinite(r.combatant.hp_current)).toBe(true)
    expect(applyHPDelta(c(), 'abc').combatant.hp_current).toBe(20)
  })
})

describe('grantTempHP — they do not stack', () => {
  it('takes the higher of the two, per the rules', () => {
    expect(grantTempHP(c({ temp_hp: 5 }), 8).temp_hp).toBe(8)
    expect(grantTempHP(c({ temp_hp: 8 }), 5).temp_hp).toBe(8)
  })

  it('never adds them together', () => {
    expect(grantTempHP(c({ temp_hp: 5 }), 5).temp_hp).toBe(5)
  })

  it('ignores a negative grant', () => {
    expect(grantTempHP(c({ temp_hp: 4 }), -3).temp_hp).toBe(4)
  })

  it('works from nothing', () => {
    expect(grantTempHP(c(), 7).temp_hp).toBe(7)
  })
})

describe('legendary actions', () => {
  it('spends one at a time', () => {
    let dragon = c({ legendary_max: 3, legendary_used: 0 })
    dragon = spendLegendaryAction(dragon)
    expect(dragon.legendary_used).toBe(1)
    dragon = spendLegendaryAction(dragon)
    expect(dragon.legendary_used).toBe(2)
  })

  it('cannot spend more than it has', () => {
    const spent = c({ legendary_max: 3, legendary_used: 3 })
    expect(spendLegendaryAction(spent).legendary_used).toBe(3)
  })

  it('a creature with none cannot spend any', () => {
    expect(spendLegendaryAction(c({ legendary_max: 0 })).legendary_used).toBe(0)
  })

  it('restores one — for a mis-click', () => {
    expect(restoreLegendaryAction(c({ legendary_max: 3, legendary_used: 2 })).legendary_used).toBe(1)
  })

  it('never restores below zero', () => {
    expect(restoreLegendaryAction(c({ legendary_max: 3, legendary_used: 0 })).legendary_used).toBe(0)
  })

  it('resets to full on a new round', () => {
    const spent = c({ legendary_max: 3, legendary_used: 3 })
    expect(resetForNewRound([spent])[0].legendary_used).toBe(0)
  })
})

describe('lair actions', () => {
  it('produces no row when nothing has lair actions', () => {
    expect(lairActionRow([c(), c({ id: 'c2' })])).toBeNull()
    expect(lairActionRow([])).toBeNull()
    expect(lairActionRow(null)).toBeNull()
  })

  it('produces a row at initiative 20 when something does', () => {
    const row = lairActionRow([c({ lair_action_text: 'The ground shakes.' })])
    expect(row.initiative).toBe(LAIR_ACTION_INITIATIVE)
    expect(row.initiative).toBe(20)
    expect(row.name).toBe('Lair Actions')
  })

  it('names which creatures contributed', () => {
    const row = lairActionRow([
      c({ name: 'Adult Red Dragon', lair_action_text: 'Magma erupts.' }),
      c({ id: 'c2', name: 'Goblin' }),
    ])
    expect(row.sources).toEqual(['Adult Red Dragon'])
  })

  it('merges text from several lair-having creatures', () => {
    const row = lairActionRow([
      c({ name: 'A', lair_action_text: 'Magma erupts.' }),
      c({ id: 'c2', name: 'B', lair_action_text: 'Tremors.' }),
    ])
    expect(row.lair_action_text).toBe('Magma erupts. Tremors.')
  })

  it('ignores blank lair text', () => {
    expect(lairActionRow([c({ lair_action_text: '   ' })])).toBeNull()
  })

  it('has no HP or AC — it is not a creature', () => {
    const row = lairActionRow([c({ lair_action_text: 'x' })])
    expect(row.hp_current).toBeNull()
    expect(row.ac).toBeNull()
  })

  it('loses initiative ties to creatures also on 20', () => {
    // "Initiative count 20, losing initiative ties" — the creature acts first.
    const row = lairActionRow([c({ lair_action_text: 'x' })])
    const dragon = c({ name: 'Dragon', initiative: 20, initiative_mod: 2 })
    expect(sortByInitiative([row, dragon]).map(x => x.name)).toEqual(['Dragon', 'Lair Actions'])
  })

  it('still sorts above anything below 20', () => {
    const row = lairActionRow([c({ lair_action_text: 'x' })])
    const goblin = c({ name: 'Goblin', initiative: 14, initiative_mod: 2 })
    expect(sortByInitiative([goblin, row]).map(x => x.name)).toEqual(['Lair Actions', 'Goblin'])
  })

  it('isLairRow identifies it, and not a creature', () => {
    expect(isLairRow(lairActionRow([c({ lair_action_text: 'x' })]))).toBe(true)
    expect(isLairRow(c())).toBe(false)
    expect(isLairRow(null)).toBe(false)
  })
})
