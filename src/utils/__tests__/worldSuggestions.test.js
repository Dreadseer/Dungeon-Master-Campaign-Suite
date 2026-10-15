import { describe, it, expect } from 'vitest'
import {
  buildSuggestionPrompt,
  buildExtractPrompt,
  parseSuggestions,
  normaliseSuggestion,
  normaliseLocationType,
  toCreatePayload,
  buildEntityIndex,
  buildConnectionRows,
  findNameClashes,
  buildContradictionPrompt,
  parseContradictions,
  LOCATION_TYPES,
  nameKey,
} from '../worldSuggestions.js'

const wrap = (suggestions) => JSON.stringify({ suggestions })

describe('buildSuggestionPrompt', () => {
  it('states the JSON contract and forbids prose around it', () => {
    const { system } = buildSuggestionPrompt({ campaign: { name: 'X' } })
    expect(system).toMatch(/ONLY valid JSON/i)
    expect(system).toMatch(/no markdown fences/i)
  })

  it('names the five legal location types, so the model cannot invent one', () => {
    const { system } = buildSuggestionPrompt({ campaign: { name: 'X' } })
    for (const t of LOCATION_TYPES) expect(system).toContain(t)
  })

  it('carries the free-text request through', () => {
    const { user } = buildSuggestionPrompt({
      campaign: { name: 'Waterdeep Nights' },
      request: 'a rival thieves guild in Waterdeep',
    })
    expect(user).toContain('a rival thieves guild in Waterdeep')
  })

  it('asks for a linked set when there is a specific request', () => {
    const { user } = buildSuggestionPrompt({ campaign: { name: 'X' }, request: 'a guild' })
    expect(user).toMatch(/faction/i)
    expect(user).toMatch(/link/i)
  })

  it('requires all four kinds, not "typically" them', () => {
    // Asked the softer way, llama3 reliably returned faction + npc + location
    // and omitted the lore entry — the one carrying the DM's actual fiction.
    const { user } = buildSuggestionPrompt({ campaign: { name: 'X' }, request: 'a guild' })
    expect(user).toMatch(/MUST include all four/)
    for (const kind of ['faction', 'npc', 'location', 'lore']) {
      expect(user).toContain(`"${kind}"`)
    }
  })

  it('asks for at least one lore entry even in the generic case', () => {
    const { user } = buildSuggestionPrompt({ campaign: { name: 'X' } })
    expect(user).toMatch(/at least one "lore" entry/)
  })

  it('falls back to the generic ask with a count', () => {
    const { user } = buildSuggestionPrompt({ campaign: { name: 'X' }, count: 5 })
    expect(user).toMatch(/Propose 5 additions/)
  })

  it('includes the campaign setting when there is one', () => {
    const { user } = buildSuggestionPrompt({ campaign: { name: 'X', world_setting: 'Faerûn' } })
    expect(user).toContain('Faerûn')
  })

  it('survives no campaign at all', () => {
    expect(() => buildSuggestionPrompt({})).not.toThrow()
    expect(buildSuggestionPrompt({}).user).toContain('(unnamed)')
  })

  it('lists existing names so the model does not re-invent them', () => {
    const { user } = buildSuggestionPrompt({ campaign: { name: 'X' }, existingNames: ['Volo', 'Durnan'] })
    expect(user).toContain('Volo')
    expect(user).toContain('Durnan')
  })

  it('caps the existing-name list — a 500-NPC campaign must not blow the prompt', () => {
    const names = Array.from({ length: 500 }, (_, i) => `NPC ${i}`)
    const { user } = buildSuggestionPrompt({ campaign: { name: 'X' }, existingNames: names })
    expect(user).not.toContain('NPC 400')
  })
})

describe('normaliseLocationType — the CHECK constraint', () => {
  it('passes the five legal values through', () => {
    for (const t of LOCATION_TYPES) expect(normaliseLocationType(t)).toBe(t)
  })

  it('maps common synonyms the model actually returns', () => {
    expect(normaliseLocationType('city')).toBe('town')
    expect(normaliseLocationType('tavern')).toBe('shop')
    expect(normaliseLocationType('ruins')).toBe('dungeon')
    expect(normaliseLocationType('kingdom')).toBe('region')
  })

  it('falls back to landmark rather than failing the INSERT', () => {
    // locations.type has a CHECK constraint; an unmapped value would throw
    // SqliteError on save, which the DM cannot act on.
    expect(normaliseLocationType('guildhall')).toBe('shop')
    expect(normaliseLocationType('interdimensional pocket')).toBe('landmark')
    expect(normaliseLocationType('')).toBe('landmark')
    expect(normaliseLocationType(null)).toBe('landmark')
  })

  it('ignores case and whitespace', () => {
    expect(normaliseLocationType('  TOWN ')).toBe('town')
  })

  it('never returns something outside the constraint', () => {
    for (const junk of ['x', 42, {}, [], undefined, 'Shop!']) {
      expect(LOCATION_TYPES).toContain(normaliseLocationType(junk))
    }
  })
})

describe('parseSuggestions', () => {
  it('reads a clean response', () => {
    const { suggestions } = parseSuggestions(wrap([
      { kind: 'faction', name: 'The Silent Ledger', fields: { description: 'A guild.' }, links: [] },
    ]))
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].kind).toBe('faction')
  })

  it('strips markdown fences, via the shared extractor', () => {
    const raw = '```json\n' + wrap([{ kind: 'npc', name: 'Sera' }]) + '\n```'
    expect(parseSuggestions(raw).suggestions).toHaveLength(1)
  })

  it('survives a chatty preamble', () => {
    const raw = 'Sure! Here is the JSON:\n' + wrap([{ kind: 'npc', name: 'Sera' }])
    expect(parseSuggestions(raw).suggestions).toHaveLength(1)
  })

  it('accepts a bare array, which local models often return', () => {
    // Asked for { suggestions: [...] }, a local model frequently answers with
    // just the array. Reading only the first object out of it — which is what
    // an object-only extractor does — would silently discard the rest.
    const raw = JSON.stringify([
      { kind: 'lore', name: 'The Ledger' },
      { kind: 'npc', name: 'Sera Vex' },
    ])
    expect(parseSuggestions(raw).suggestions).toHaveLength(2)
  })

  it('reads a fenced bare array too', () => {
    const raw = '```json\n' + JSON.stringify([{ kind: 'npc', name: 'Sera' }]) + '\n```'
    expect(parseSuggestions(raw).suggestions).toHaveLength(1)
  })

  it('prefers the wrapper object when both shapes are present', () => {
    // "{ suggestions: [ ... ] }" opens with a brace, so it must not be read as
    // the inner array.
    const { suggestions } = parseSuggestions(wrap([
      { kind: 'npc', name: 'A' }, { kind: 'npc', name: 'B' },
    ]))
    expect(suggestions.map(s => s.name)).toEqual(['A', 'B'])
  })

  it('drops an entry with no name instead of failing the whole batch', () => {
    const { suggestions, dropped } = parseSuggestions(wrap([
      { kind: 'npc', name: 'Sera' },
      { kind: 'npc', name: '' },
    ]))
    expect(suggestions).toHaveLength(1)
    expect(dropped).toBe(1)
  })

  it('drops an unknown kind', () => {
    const { suggestions, dropped } = parseSuggestions(wrap([
      { kind: 'spaceship', name: 'Normandy' },
    ]))
    expect(suggestions).toHaveLength(0)
    expect(dropped).toBe(1)
  })

  it('de-duplicates a name the model proposed twice', () => {
    const { suggestions, dropped } = parseSuggestions(wrap([
      { kind: 'npc', name: 'Sera Vex' },
      { kind: 'npc', name: 'sera vex' },
    ]))
    expect(suggestions).toHaveLength(1)
    expect(dropped).toBe(1)
  })

  it('allows the same name for two different kinds', () => {
    // A faction and its headquarters are often both "The Silent Ledger".
    const { suggestions } = parseSuggestions(wrap([
      { kind: 'faction', name: 'The Silent Ledger' },
      { kind: 'location', name: 'The Silent Ledger' },
    ]))
    expect(suggestions).toHaveLength(2)
  })

  it('returns empty rather than throwing when the object has no suggestions key', () => {
    expect(parseSuggestions('{"result":"nothing"}').suggestions).toEqual([])
  })

  it('throws on genuinely unparseable output, so the caller can say so', () => {
    expect(() => parseSuggestions('the model refused')).toThrow()
  })

  it('flags a clean response as not truncated', () => {
    expect(parseSuggestions(wrap([{ kind: 'npc', name: 'Sera' }])).truncated).toBe(false)
  })
})

describe('parseSuggestions — a reply cut off at the token ceiling', () => {
  // The reported failure: ten NPCs extracted from a chat table, output stopped
  // mid-record, and JSON.parse threw "Expected ',' or ']' after array element"
  // — losing every NPC, not just the last one.
  const npc = (n) => `    {
      "kind": "npc",
      "name": "NPC ${n}",
      "fields": { "role": "Scavenger", "notes": "Says \\"hi\\" — and {braces} in a string" },
      "links": [ { "to": "NPC ${n + 1}", "relationship": "owes" } ]
    }`
  const cutOff = `{\n  "suggestions": [\n${[1, 2, 3].map(npc).join(',\n')},\n    {\n      "kind": "npc",\n      "name": "NPC 4",\n      "fields": { "role": "Scav`

  it('keeps every suggestion that was complete', () => {
    const { suggestions, truncated } = parseSuggestions(cutOff)
    expect(truncated).toBe(true)
    expect(suggestions.map(s => s.name)).toEqual(['NPC 1', 'NPC 2', 'NPC 3'])
  })

  it('ignores brackets and quotes inside strings', () => {
    const { suggestions } = parseSuggestions(cutOff)
    expect(suggestions[0].fields.notes).toBe('Says "hi" — and {braces} in a string')
  })

  it('drops a half-written suggestion rather than saving part of it', () => {
    // Cut inside NPC 4's links: its links array has one whole element, which
    // must not make the half-record look complete.
    const raw = cutOff.replace(/"fields": \{ "role": "Scav$/,
      '"fields": {}, "links": [ { "to": "A", "relationship": "b" }, { "to": "B"')
    expect(parseSuggestions(raw).suggestions.map(s => s.name)).toEqual(['NPC 1', 'NPC 2', 'NPC 3'])
  })

  it('works on a bare array too', () => {
    const raw = '[{"kind":"npc","name":"A"},{"kind":"npc","name":"B"},{"kind":"np'
    const { suggestions, truncated } = parseSuggestions(raw)
    expect(truncated).toBe(true)
    expect(suggestions.map(s => s.name)).toEqual(['A', 'B'])
  })

  it('still throws when nothing was complete', () => {
    expect(() => parseSuggestions('{"suggestions": [{"kind": "npc", "na')).toThrow()
  })
})

describe('buildExtractPrompt — "Save as…" on a chat message', () => {
  const table = '| 1 | Dolores Finch | Ticket-booth attendant | Knows a shortcut |'

  it('carries the text to extract from', () => {
    const { user } = buildExtractPrompt({ campaign: { name: 'X' }, sourceText: table })
    expect(user).toContain('Dolores Finch')
  })

  it('does NOT demand all four kinds — a list of NPCs is only NPCs', () => {
    const { user } = buildExtractPrompt({ campaign: { name: 'X' }, sourceText: table })
    expect(user).not.toMatch(/MUST include all four/)
    expect(user).toMatch(/only NPCs/)
  })

  it('keeps the same JSON contract and location types as suggestions', () => {
    const { system, user } = buildExtractPrompt({ campaign: { name: 'X' }, sourceText: table })
    expect(system).toMatch(/ONLY valid JSON/i)
    for (const t of LOCATION_TYPES) expect(system).toContain(t)
    expect(user).toContain('"suggestions"')
  })

  it('asks for compact JSON, so a long list fits the output budget', () => {
    expect(buildExtractPrompt({ sourceText: table }).user).toMatch(/compactly/)
  })
})

describe('normaliseSuggestion — field coercion per kind', () => {
  it('gives an npc exactly the npc fields', () => {
    const n = normaliseSuggestion({ kind: 'npc', name: 'Sera', fields: { race: 'Tiefling', bogus: 'x' } })
    expect(Object.keys(n.fields).sort()).toEqual(['class', 'motivation', 'notes', 'race', 'role', 'secrets'])
    expect(n.fields.race).toBe('Tiefling')
  })

  it('gives a faction exactly the faction fields', () => {
    const f = normaliseSuggestion({ kind: 'faction', name: 'Guild', fields: {} })
    expect(Object.keys(f.fields).sort()).toEqual(['alignment', 'description', 'notes'])
  })

  it('gives lore a content field, accepting description as an alias', () => {
    // Models routinely return "description" for lore however the schema is worded.
    const l = normaliseSuggestion({ kind: 'lore', name: 'The Pact', fields: { description: 'Long ago…' } })
    expect(l.fields.content).toBe('Long ago…')
  })

  it('defaults a lore category rather than writing an empty one', () => {
    expect(normaliseSuggestion({ kind: 'lore', name: 'X', fields: {} }).fields.category).toBe('General')
  })

  it('coerces is_secret to a real boolean', () => {
    expect(normaliseSuggestion({ kind: 'lore', name: 'X', fields: { is_secret: 'yes' } }).fields.is_secret).toBe(true)
    expect(normaliseSuggestion({ kind: 'lore', name: 'X', fields: {} }).fields.is_secret).toBe(false)
  })

  it('trims whitespace out of names', () => {
    expect(normaliseSuggestion({ kind: 'npc', name: '  Sera  ' }).name).toBe('Sera')
  })

  it('copes with fields missing entirely', () => {
    const n = normaliseSuggestion({ kind: 'npc', name: 'Sera' })
    expect(n.fields.race).toBe('')
  })

  it('drops links with no target', () => {
    const n = normaliseSuggestion({
      kind: 'npc', name: 'Sera',
      links: [{ to: 'Guild', relationship: 'leads' }, { to: '', relationship: 'x' }, null],
    })
    expect(n.links).toHaveLength(1)
  })

  it('rejects nullish and non-object input', () => {
    for (const junk of [null, undefined, 'x', 42, []]) expect(normaliseSuggestion(junk)).toBeNull()
  })
})

describe('toCreatePayload — matches the INSERT statements', () => {
  const campaignId = 7

  it('npc payload carries every column the handler binds', () => {
    const p = toCreatePayload(normaliseSuggestion({
      kind: 'npc', name: 'Sera', fields: { race: 'Tiefling', class: 'Rogue', role: 'Guildmaster', motivation: 'Power', secrets: 'A traitor', notes: 'n' },
    }), campaignId)
    expect(p).toEqual({
      campaign_id: 7, name: 'Sera', race: 'Tiefling', class: 'Rogue', role: 'Guildmaster',
      location_id: null, faction_id: null, notes: 'n', secrets: 'A traitor', motivation: 'Power',
    })
  })

  it('location payload clamps the type', () => {
    const p = toCreatePayload(normaliseSuggestion({
      kind: 'location', name: 'The Vault', fields: { type: 'guildhall', description: 'd' },
    }), campaignId)
    expect(p.type).toBe('shop')
    expect(p.parent_location_id).toBeNull()
  })

  it('faction payload', () => {
    const p = toCreatePayload(normaliseSuggestion({
      kind: 'faction', name: 'Ledger', fields: { description: 'd', alignment: 'LE', notes: 'n' },
    }), campaignId)
    expect(p).toEqual({ campaign_id: 7, name: 'Ledger', description: 'd', alignment: 'LE', notes: 'n' })
  })

  it('lore payload uses content/category/is_secret, as db:lore:create expects', () => {
    const p = toCreatePayload(normaliseSuggestion({
      kind: 'lore', name: 'The Pact', fields: { content: 'c', category: 'History', is_secret: true },
    }), campaignId)
    expect(p).toEqual({ campaign_id: 7, name: 'The Pact', content: 'c', category: 'History', is_secret: true })
  })
})

describe('buildEntityIndex', () => {
  it('indexes what was just saved', () => {
    const idx = buildEntityIndex({ saved: [{ kind: 'faction', id: 3, name: 'The Ledger' }] })
    expect(idx.get('the ledger')).toEqual({ type: 'faction', id: 3, name: 'The Ledger' })
  })

  it('indexes what already existed', () => {
    const idx = buildEntityIndex({ existing: { npcs: [{ id: 9, name: 'Volo' }] } })
    expect(idx.get('volo').type).toBe('npc')
  })

  it('the just-saved batch wins a name collision', () => {
    const idx = buildEntityIndex({
      saved: [{ kind: 'faction', id: 1, name: 'Ledger' }],
      existing: { npcs: [{ id: 2, name: 'Ledger' }] },
    })
    expect(idx.get('ledger')).toEqual({ type: 'faction', id: 1, name: 'Ledger' })
  })

  it('skips entries with no id', () => {
    expect(buildEntityIndex({ saved: [{ kind: 'npc', id: null, name: 'X' }] }).size).toBe(0)
  })

  it('handles being given nothing', () => {
    expect(buildEntityIndex().size).toBe(0)
    expect(buildEntityIndex({}).size).toBe(0)
  })
})

describe('buildConnectionRows', () => {
  const campaignId = 4

  const guildSet = [
    { kind: 'faction', name: 'The Silent Ledger', fields: {}, links: [{ to: 'Sera Vex', relationship: 'led by' }] },
    { kind: 'npc', name: 'Sera Vex', fields: {}, links: [{ to: 'The Vault', relationship: 'operates from' }] },
    { kind: 'location', name: 'The Vault', fields: {}, links: [] },
  ]
  const index = buildEntityIndex({
    saved: [
      { kind: 'faction', id: 1, name: 'The Silent Ledger' },
      { kind: 'npc', id: 2, name: 'Sera Vex' },
      { kind: 'location', id: 3, name: 'The Vault' },
    ],
  })

  it('produces one row per resolvable link', () => {
    const { rows, unresolved } = buildConnectionRows(guildSet, index, campaignId)
    expect(rows).toHaveLength(2)
    expect(unresolved).toEqual([])
  })

  it('rows carry the campaign and both typed endpoints', () => {
    const { rows } = buildConnectionRows(guildSet, index, campaignId)
    expect(rows[0]).toEqual({
      campaign_id: 4,
      entity_a_type: 'faction', entity_a_id: 1,
      entity_b_type: 'npc', entity_b_id: 2,
      relationship: 'led by', notes: '',
    })
  })

  it('links to something that already existed resolve too', () => {
    const idx = buildEntityIndex({
      saved: [{ kind: 'faction', id: 1, name: 'Ledger' }],
      existing: { locations: [{ id: 50, name: 'Waterdeep' }] },
    })
    const { rows } = buildConnectionRows(
      [{ kind: 'faction', name: 'Ledger', links: [{ to: 'Waterdeep', relationship: 'operates in' }] }],
      idx, campaignId,
    )
    expect(rows[0].entity_b_id).toBe(50)
    expect(rows[0].entity_b_type).toBe('location')
  })

  it('reports unresolved links rather than dropping them quietly', () => {
    const { rows, unresolved } = buildConnectionRows(
      [{ kind: 'faction', name: 'The Silent Ledger', links: [{ to: 'Nobody At All', relationship: 'x' }] }],
      index, campaignId,
    )
    expect(rows).toHaveLength(0)
    expect(unresolved).toEqual([{ from: 'The Silent Ledger', to: 'Nobody At All' }])
  })

  it('collapses A→B and B→A into one row', () => {
    const { rows } = buildConnectionRows([
      { kind: 'faction', name: 'The Silent Ledger', links: [{ to: 'Sera Vex', relationship: 'led by' }] },
      { kind: 'npc', name: 'Sera Vex', links: [{ to: 'The Silent Ledger', relationship: 'leads' }] },
    ], index, campaignId)
    expect(rows).toHaveLength(1)
  })

  it('ignores a self-link', () => {
    const { rows } = buildConnectionRows(
      [{ kind: 'faction', name: 'The Silent Ledger', links: [{ to: 'The Silent Ledger', relationship: 'is' }] }],
      index, campaignId,
    )
    expect(rows).toHaveLength(0)
  })

  it('skips a suggestion that was not saved', () => {
    const { rows } = buildConnectionRows(
      [{ kind: 'npc', name: 'Never Saved', links: [{ to: 'Sera Vex', relationship: 'x' }] }],
      index, campaignId,
    )
    expect(rows).toHaveLength(0)
  })

  it('defaults a blank relationship rather than writing NULL', () => {
    const { rows } = buildConnectionRows(
      [{ kind: 'faction', name: 'The Silent Ledger', links: [{ to: 'Sera Vex', relationship: '' }] }],
      index, campaignId,
    )
    expect(rows[0].relationship).toBe('related to')
  })

  it('matches names case-insensitively', () => {
    const { rows } = buildConnectionRows(
      [{ kind: 'faction', name: 'The Silent Ledger', links: [{ to: 'SERA VEX', relationship: 'led by' }] }],
      index, campaignId,
    )
    expect(rows).toHaveLength(1)
  })

  it('handles suggestions with no links at all', () => {
    expect(buildConnectionRows([{ kind: 'npc', name: 'Sera Vex' }], index, campaignId).rows).toEqual([])
  })

  // The acceptance line: one request → faction + npc + lore + >= 2 connections.
  it('a guild request yields at least two connections', () => {
    const set = [
      { kind: 'faction', name: 'The Silent Ledger', links: [{ to: 'Sera Vex', relationship: 'led by' }, { to: 'Ledger Rites', relationship: 'described in' }] },
      { kind: 'npc', name: 'Sera Vex', links: [] },
      { kind: 'lore', name: 'Ledger Rites', links: [] },
    ]
    const idx = buildEntityIndex({ saved: [
      { kind: 'faction', id: 1, name: 'The Silent Ledger' },
      { kind: 'npc', id: 2, name: 'Sera Vex' },
      { kind: 'lore', id: 3, name: 'Ledger Rites' },
    ] })
    expect(buildConnectionRows(set, idx, campaignId).rows.length).toBeGreaterThanOrEqual(2)
  })
})

describe('findNameClashes', () => {
  it('flags a suggestion whose name already exists', () => {
    const clashes = findNameClashes(
      [{ kind: 'npc', name: 'Volo' }],
      { npcs: [{ id: 1, name: 'Volo' }] },
    )
    expect(clashes).toEqual([{ name: 'Volo', kind: 'npc', existingType: 'npc' }])
  })

  it('is quiet when nothing clashes', () => {
    expect(findNameClashes([{ kind: 'npc', name: 'Sera' }], { npcs: [{ id: 1, name: 'Volo' }] })).toEqual([])
  })

  it('handles no existing world', () => {
    expect(findNameClashes([{ kind: 'npc', name: 'Sera' }])).toEqual([])
  })
})

describe('contradiction check', () => {
  it('asks for conflicts only against stated facts', () => {
    const { system } = buildContradictionPrompt({ kind: 'npc', name: 'X', fields: {} }, [])
    expect(system).toMatch(/ONLY when the proposal directly contradicts/i)
    expect(system).toMatch(/silent on something/i)
  })

  it('includes the retrieved lore', () => {
    const { user } = buildContradictionPrompt(
      { kind: 'faction', name: 'Ledger', fields: {} },
      [{ text: 'The Shadow Thieves hold a monopoly.', source: 'Guild lore' }],
    )
    expect(user).toContain('Shadow Thieves hold a monopoly')
  })

  it('says so when there is no lore to check against', () => {
    const { user } = buildContradictionPrompt({ kind: 'npc', name: 'X', fields: {} }, [])
    expect(user).toMatch(/no established lore/i)
  })

  it('parses a conflict verdict', () => {
    const r = parseContradictions('{"conflicts":[{"with":"Guild lore","issue":"Two monopolies."}],"verdict":"conflicts"}')
    expect(r.verdict).toBe('conflicts')
    expect(r.conflicts[0].issue).toBe('Two monopolies.')
  })

  it('parses a clear verdict', () => {
    expect(parseContradictions('{"conflicts":[],"verdict":"clear"}').verdict).toBe('clear')
  })

  it('treats unparseable output as clear — an advisory must never block a save', () => {
    expect(parseContradictions('the model rambled').verdict).toBe('clear')
    expect(parseContradictions('').verdict).toBe('clear')
    expect(parseContradictions(null).verdict).toBe('clear')
  })

  it('derives the verdict from the conflicts, not the model\'s own label', () => {
    // A model that says "conflicts" but lists none has found nothing.
    expect(parseContradictions('{"conflicts":[],"verdict":"conflicts"}').verdict).toBe('clear')
  })

  it('drops a conflict with no issue text', () => {
    expect(parseContradictions('{"conflicts":[{"with":"x"}]}').conflicts).toEqual([])
  })
})

describe('nameKey', () => {
  it('normalises case and internal whitespace', () => {
    expect(nameKey('  The   Silent  Ledger ')).toBe('the silent ledger')
  })

  it('handles nullish', () => {
    expect(nameKey(null)).toBe('')
  })
})
