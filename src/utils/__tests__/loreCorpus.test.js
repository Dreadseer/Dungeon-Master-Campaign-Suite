import { describe, it, expect } from 'vitest'
import {
  buildLoreChunks,
  diffLoreChunks,
  describeLoreSync,
  loreSourceName,
  isLoreSource,
  LORE_SOURCE_PREFIX,
} from '../loreCorpus.js'

const world = (over = {}) => ({
  lore: [{ id: 1, name: 'The Walking Statues', category: 'History', content: 'They guard Waterdeep.', is_secret: 0 }],
  npcs: [{ id: 10, name: 'Volo', race: 'Human', class: 'Bard', role: 'Chronicler', motivation: 'Fame', notes: 'Writes guides.', secrets: '', is_alive: 1 }],
  locations: [{ id: 20, name: 'Yawning Portal', type: 'shop', description: 'A tavern over a dungeon.', lore: '' }],
  factions: [{ id: 30, name: 'Harpers', alignment: 'CG', description: 'A secret network.', notes: '' }],
  ...over,
})

describe('loreSourceName / isLoreSource', () => {
  it('names the sentinel after the campaign', () => {
    expect(loreSourceName('Waterdeep Nights')).toBe(`${LORE_SOURCE_PREFIX}Waterdeep Nights`)
  })

  it('falls back for an unnamed campaign', () => {
    expect(loreSourceName('')).toContain('Untitled campaign')
    expect(loreSourceName(null)).toContain('Untitled campaign')
  })

  it('recognises the generated source', () => {
    expect(isLoreSource({ filename: loreSourceName('X'), file_path: null })).toBe(true)
  })

  it('does NOT mistake a real PDF for it — the sync would rewrite its chunks', () => {
    expect(isLoreSource({ filename: 'Volo\'s Guide.pdf', file_path: 'C:/books/volo.pdf' })).toBe(false)
    // Even a PDF a DM perversely named to match is excluded by having a path.
    expect(isLoreSource({ filename: loreSourceName('X'), file_path: 'C:/books/x.pdf' })).toBe(false)
  })

  it('handles nullish and junk', () => {
    expect(isLoreSource(null)).toBe(false)
    expect(isLoreSource({})).toBe(false)
    expect(isLoreSource({ filename: 42 })).toBe(false)
  })
})

describe('buildLoreChunks', () => {
  it('emits one chunk per entity', () => {
    expect(buildLoreChunks(world())).toHaveLength(4)
  })

  it('leads each chunk with its kind and name', () => {
    const chunks = buildLoreChunks(world())
    expect(chunks.find(c => c.entity_type === 'lore').text).toMatch(/^Lore: The Walking Statues/)
    expect(chunks.find(c => c.entity_type === 'npc').text).toMatch(/^NPC: Volo/)
    expect(chunks.find(c => c.entity_type === 'location').text).toMatch(/^Location: Yawning Portal/)
    expect(chunks.find(c => c.entity_type === 'faction').text).toMatch(/^Faction: Harpers/)
  })

  it('carries a stable key identifying the entity', () => {
    expect(buildLoreChunks(world()).find(c => c.entity_type === 'npc').key).toBe('npc:10')
  })

  it('includes NPC secrets — this index is DM-only', () => {
    const chunks = buildLoreChunks(world({
      npcs: [{ id: 1, name: 'Sera', secrets: 'She is the traitor.' }],
    }))
    const npc = chunks.find(c => c.entity_type === 'npc')
    expect(npc.text).toContain('She is the traitor.')
  })

  it('marks a secret lore entry as secret', () => {
    const chunks = buildLoreChunks({ lore: [{ id: 1, name: 'X', content: 'y', is_secret: 1 }] })
    expect(chunks[0].text).toMatch(/secret from the players/i)
  })

  it('notes a dead NPC, which changes how the AI should talk about them', () => {
    const chunks = buildLoreChunks({ npcs: [{ id: 1, name: 'Ghost', notes: 'n', is_alive: 0 }] })
    expect(chunks[0].text).toMatch(/is dead/i)
  })

  it('omits empty fields rather than writing blank labels', () => {
    const chunks = buildLoreChunks({ npcs: [{ id: 1, name: 'Plain', notes: 'Just a guy.' }] })
    expect(chunks[0].text).not.toMatch(/Motivation:/)
    expect(chunks[0].text).not.toMatch(/\n\n/)
  })

  it('drops an entity with a name and nothing else — it retrieves nothing and costs a call', () => {
    expect(buildLoreChunks({ npcs: [{ id: 1, name: 'Nobody' }] })).toEqual([])
  })

  it('skips entities with no id', () => {
    expect(buildLoreChunks({ npcs: [{ name: 'No id', notes: 'x' }] })).toEqual([])
  })

  it('handles an empty world and no argument', () => {
    expect(buildLoreChunks({})).toEqual([])
    expect(buildLoreChunks()).toEqual([])
  })

  it('handles nullish entries inside the arrays', () => {
    expect(() => buildLoreChunks({ npcs: [null, undefined] })).not.toThrow()
  })
})

describe('diffLoreChunks', () => {
  const chunks = () => buildLoreChunks(world())

  it('reports everything as added against an empty index', () => {
    const d = diffLoreChunks(chunks(), [])
    expect(d.added).toHaveLength(4)
    expect(d.removed).toEqual([])
  })

  it('reports everything unchanged when the text matches', () => {
    const next = chunks()
    const existing = next.map((c, i) => ({ id: i + 1, chunk_index: i, text: c.text }))
    const d = diffLoreChunks(next, existing)
    expect(d.added).toEqual([])
    expect(d.removed).toEqual([])
    expect(d.unchanged).toHaveLength(4)
  })

  it('editing one entity re-embeds only that one', () => {
    // The whole point: saving one NPC must not re-embed a 300-entity campaign.
    const before = chunks()
    const existing = before.map((c, i) => ({ id: i + 1, chunk_index: i, text: c.text }))
    const after = buildLoreChunks(world({
      npcs: [{ id: 10, name: 'Volo', role: 'Chronicler', notes: 'Now writes cookbooks.' }],
    }))
    const d = diffLoreChunks(after, existing)
    expect(d.added).toHaveLength(1)
    expect(d.added[0].entity_type).toBe('npc')
    expect(d.unchanged).toHaveLength(3)
  })

  it('a stale chunk is reported for removal', () => {
    const existing = [{ id: 99, chunk_index: 0, text: 'Lore: A deleted entry\nGone.' }]
    const d = diffLoreChunks(chunks(), existing)
    expect(d.removed.map(r => r.id)).toEqual([99])
  })

  it('carries the stored id through on unchanged chunks', () => {
    const next = chunks()
    const existing = next.map((c, i) => ({ id: i + 7, chunk_index: i, text: c.text }))
    expect(diffLoreChunks(next, existing).unchanged[0].id).toBe(7)
  })

  it('does not match one stored row against two identical new chunks', () => {
    // Two entities can legitimately produce identical text; each still needs
    // its own vector.
    const next = [{ key: 'a', text: 'same' }, { key: 'b', text: 'same' }]
    const d = diffLoreChunks(next, [{ id: 1, text: 'same' }])
    expect(d.unchanged).toHaveLength(1)
    expect(d.added).toHaveLength(1)
  })

  it('handles nullish inputs', () => {
    expect(() => diffLoreChunks(null, null)).not.toThrow()
    expect(diffLoreChunks(null, null).added).toEqual([])
  })

  it('ignores null rows in the stored list', () => {
    expect(() => diffLoreChunks(chunks(), [null])).not.toThrow()
  })
})

describe('describeLoreSync', () => {
  it('says it is up to date when nothing changed', () => {
    expect(describeLoreSync({ unchanged: [1, 2] })).toMatch(/Up to date — 2 entries/)
  })

  it('uses the singular for one entry', () => {
    expect(describeLoreSync({ unchanged: [1] })).toMatch(/1 entry/)
  })

  it('says there is nothing to index for an empty world', () => {
    expect(describeLoreSync({})).toMatch(/Nothing to index/)
  })

  it('counts what will be embedded and dropped', () => {
    const out = describeLoreSync({ added: [1, 2], removed: [3], unchanged: [4] })
    expect(out).toContain('2 to embed')
    expect(out).toContain('1 stale to drop')
    expect(out).toContain('1 unchanged')
  })
})
