import { describe, it, expect } from 'vitest'
import {
  buildRecapInput,
  buildRecapPrompt,
  parseRecap,
  hasRecapMaterial,
  isRevealed,
} from '../sessionRecap.js'

const session = { id: 5, session_number: 4, title: 'Into the Vault', notes: 'The party broke into the vault.' }

const lore = [
  { id: 1, name: 'The Ledger Rites', content: 'The guild signs its debts in blood.', is_secret: false },
  { id: 2, name: 'The Traitor Within', content: 'Sera sold them out.', is_secret: true },
]

const npcs = [
  { id: 10, name: 'Sera Vex', role: 'Guildmaster', secrets: 'She is the traitor.' },
  { id: 11, name: 'Durnan', role: 'Innkeeper', secrets: '' },
]

const plots = [
  { id: 1, title: 'Who poisoned the duke?', status: 'open', description: 'It was the steward.', opened_session_id: 5 },
  { id: 2, title: 'Find the vault key', status: 'resolved', description: 'Behind the bar.', resolved_session_id: 5 },
  { id: 3, title: 'An older thread', status: 'open', description: 'x', opened_session_id: 1 },
]

const sessionReveals = [
  { entity_type: 'lore', entity_id: 1, session_id: 5 },
  { entity_type: 'lore', entity_id: 2, session_id: 5 },
  { entity_type: 'npc', entity_id: 10, session_id: 5 },
]

const base = { session, plots, sessionReveals, lore, npcs }

describe('buildRecapInput — the DM variant sees everything', () => {
  it('includes both lore entries, secret or not', () => {
    const input = buildRecapInput(base, { audience: 'dm' })
    expect(input.lore.map(l => l.name)).toEqual(['The Ledger Rites', 'The Traitor Within'])
  })

  it('includes NPC secrets', () => {
    const input = buildRecapInput(base, { audience: 'dm' })
    expect(input.npcs.find(n => n.name === 'Sera Vex').secrets).toBe('She is the traitor.')
  })

  it('includes plot descriptions, which can carry the twist', () => {
    const input = buildRecapInput(base, { audience: 'dm' })
    expect(input.plots.find(p => p.title === 'Who poisoned the duke?').description).toBe('It was the steward.')
  })

  it('takes only the threads that changed in THIS session', () => {
    const input = buildRecapInput(base, { audience: 'dm' })
    expect(input.plots.map(p => p.title)).toEqual(['Who poisoned the duke?', 'Find the vault key'])
  })

  it('marks which threads opened and which closed here', () => {
    const input = buildRecapInput(base, { audience: 'dm' })
    expect(input.plots[0].openedHere).toBe(true)
    expect(input.plots[1].closedHere).toBe(true)
  })
})

describe('buildRecapInput — the player variant omits what was never shown', () => {
  // A reveal row IS the record of having been shown something, so a secret the
  // party was shown this session is fair game — that is what revealing means.
  // What must never reach them is a secret with no reveal row at all.
  const withHiddenSecret = {
    ...base,
    sessionReveals: [{ entity_type: 'lore', entity_id: 1, session_id: 5 },
      { entity_type: 'npc', entity_id: 10, session_id: 5 }],
  }

  it('drops a secret lore entry that has no reveal row', () => {
    const input = buildRecapInput(withHiddenSecret, { audience: 'players' })
    expect(input.lore.map(l => l.name)).toEqual(['The Ledger Rites'])
  })

  it('the DM variant keeps it, flagged as still hidden', () => {
    const input = buildRecapInput(withHiddenSecret, { audience: 'dm' })
    const hidden = input.lore.find(l => l.name === 'The Traitor Within')
    expect(hidden.revealed).toBe(false)
  })

  it('a secret revealed THIS session does reach the players', () => {
    const input = buildRecapInput(base, { audience: 'players' })
    expect(input.lore.map(l => l.name)).toContain('The Traitor Within')
  })

  it('a secret revealed in an EARLIER session also reaches them', () => {
    const input = buildRecapInput(
      { ...withHiddenSecret, campaignReveals: [{ entity_type: 'lore', entity_id: 2, session_id: 2 }] },
      { audience: 'players' },
    )
    // Known, so it is not withheld as a hidden secret — and not "learned this
    // session" either, so it simply does not appear in this recap at all.
    expect(input.lore.map(l => l.name)).not.toContain('The Traitor Within')
    // The only thing still withheld is the NPC secret, never the lore.
    expect(input.omitted).toBe(1)
  })

  it('never carries an NPC\'s secrets', () => {
    const input = buildRecapInput(base, { audience: 'players' })
    expect(input.npcs.find(n => n.name === 'Sera Vex').secrets).toBe('')
  })

  it('still names the NPC — meeting them is not a secret', () => {
    const input = buildRecapInput(base, { audience: 'players' })
    expect(input.npcs.map(n => n.name)).toContain('Sera Vex')
  })

  it('strips plot descriptions', () => {
    const input = buildRecapInput(base, { audience: 'players' })
    expect(input.plots.every(p => p.description === '')).toBe(true)
  })

  it('counts what it left out, so the DM can be told', () => {
    expect(buildRecapInput(base, { audience: 'players' }).omitted).toBeGreaterThan(0)
  })

  it('no unrevealed secret text survives anywhere in the player input', () => {
    // The whole safety property in one assertion.
    const blob = JSON.stringify(buildRecapInput(withHiddenSecret, { audience: 'players' }))
    expect(blob).not.toContain('She is the traitor')     // an NPC secret
    expect(blob).not.toContain('Sera sold them out')     // unrevealed secret lore
    expect(blob).not.toContain('It was the steward')     // a plot description
  })
})

describe('buildRecapInput — edges', () => {
  it('ignores a reveal pointing at a deleted entity', () => {
    const input = buildRecapInput({
      ...base, lore: [], sessionReveals: [{ entity_type: 'lore', entity_id: 999 }],
    }, { audience: 'dm' })
    expect(input.lore).toEqual([])
  })

  it('handles a session with nothing in it', () => {
    const input = buildRecapInput({ session: { id: 1 } }, { audience: 'dm' })
    expect(input.notes).toBe('')
    expect(input.plots).toEqual([])
  })

  it('handles being called with nothing', () => {
    expect(() => buildRecapInput()).not.toThrow()
  })

  it('matches ids across string/number, as SQLite rows can differ', () => {
    const input = buildRecapInput({
      ...base, sessionReveals: [{ entity_type: 'lore', entity_id: '1' }],
    }, { audience: 'dm' })
    // The string id still resolved to the entry, and it counts as revealed.
    expect(input.lore.find(l => l.name === 'The Ledger Rites').revealed).toBe(true)
  })
})

describe('buildRecapPrompt', () => {
  it('the DM variant asks for secrets to be included', () => {
    const { system } = buildRecapPrompt(buildRecapInput(base, { audience: 'dm' }), { audience: 'dm' })
    expect(system).toMatch(/secrets and unresolved threads included/i)
  })

  it('the player variant forbids undiscovered material', () => {
    const { system } = buildRecapPrompt(buildRecapInput(base, { audience: 'players' }), { audience: 'players' })
    expect(system).toMatch(/never mention a plan, motive, twist or identity/i)
  })

  it('warns the model that the notes are private and may overshare', () => {
    // The notes cannot be structurally filtered, so this is the mitigation.
    const { user } = buildRecapPrompt(buildRecapInput(base, { audience: 'players' }), { audience: 'players' })
    expect(user).toMatch(/private notes/i)
    expect(user).toMatch(/only what the party themselves witnessed/i)
  })

  it('the player prompt carries no unrevealed secret text', () => {
    const hidden = {
      ...base,
      sessionReveals: [{ entity_type: 'lore', entity_id: 1, session_id: 5 },
        { entity_type: 'npc', entity_id: 10, session_id: 5 }],
    }
    const { user } = buildRecapPrompt(
      buildRecapInput(hidden, { audience: 'players' }), { audience: 'players', session })
    expect(user).not.toContain('She is the traitor')
    expect(user).not.toContain('Sera sold them out')
    expect(user).not.toMatch(/Still hidden/i)
  })

  it('the DM prompt does carry it', () => {
    const { user } = buildRecapPrompt(
      buildRecapInput(base, { audience: 'dm' }), { audience: 'dm', session })
    expect(user).toContain('She is the traitor')
  })

  it('references the revealed lore — the acceptance line', () => {
    const { user } = buildRecapPrompt(
      buildRecapInput(base, { audience: 'dm' }), { audience: 'dm', session })
    expect(user).toContain('The Ledger Rites')
    expect(user).toContain('The Traitor Within')
  })

  it('asks for prose, not headings or bullets', () => {
    const { system } = buildRecapPrompt({}, {})
    expect(system).toMatch(/No headings, no bullet points/i)
  })

  it('forbids invention', () => {
    expect(buildRecapPrompt({}, {}).system).toMatch(/Do not invent/i)
  })

  it('names the campaign and session when given them', () => {
    const { user } = buildRecapPrompt(buildRecapInput(base, {}), {
      session, campaign: { name: 'Waterdeep Nights' },
    })
    expect(user).toContain('Waterdeep Nights')
    expect(user).toContain('Session 4 — Into the Vault')
  })

  it('survives an empty input', () => {
    expect(() => buildRecapPrompt({}, {})).not.toThrow()
  })
})

describe('parseRecap', () => {
  it('passes clean prose through', () => {
    expect(parseRecap('The party broke into the vault.')).toBe('The party broke into the vault.')
  })

  it('strips a leading label', () => {
    expect(parseRecap('Here is the recap:\n\nThe party fought.')).toBe('The party fought.')
    expect(parseRecap('Recap:\nThe party fought.')).toBe('The party fought.')
    expect(parseRecap("**Here's your summary:**\n\nThey fled.")).toBe('They fled.')
  })

  it('strips fences', () => {
    expect(parseRecap('```\nThe party fought.\n```')).toBe('The party fought.')
  })

  it('unwraps JSON when the model returns it despite being asked for prose', () => {
    expect(parseRecap('{"recap":"The party fought."}')).toBe('The party fought.')
    expect(parseRecap('{"summary":"They fled."}')).toBe('They fled.')
  })

  it('leaves prose that merely starts with a brace-like word alone', () => {
    expect(parseRecap('Recapping the night: they fled.')).toBe('Recapping the night: they fled.')
  })

  it('does not eat the word "recap" mid-sentence', () => {
    expect(parseRecap('The recap: they fled.')).toBe('The recap: they fled.')
  })

  it('handles empty and nullish', () => {
    expect(parseRecap('')).toBe('')
    expect(parseRecap(null)).toBe('')
    expect(parseRecap(undefined)).toBe('')
  })
})

describe('hasRecapMaterial', () => {
  it('is true when there are notes', () => {
    expect(hasRecapMaterial({ notes: 'something' })).toBe(true)
  })

  it('is true when threads changed even with no notes', () => {
    expect(hasRecapMaterial({ notes: '', plots: [{ title: 'x' }] })).toBe(true)
  })

  it('is false for an empty session', () => {
    expect(hasRecapMaterial({ notes: '', plots: [], lore: [], npcs: [] })).toBe(false)
    expect(hasRecapMaterial(null)).toBe(false)
  })
})

describe('isRevealed', () => {
  it('finds a reveal', () => {
    expect(isRevealed(sessionReveals, 'lore', 1)).toBe(true)
  })

  it('does not confuse entity types sharing an id', () => {
    expect(isRevealed(sessionReveals, 'npc', 1)).toBe(false)
  })

  it('handles nullish', () => {
    expect(isRevealed(null, 'lore', 1)).toBe(false)
  })
})
