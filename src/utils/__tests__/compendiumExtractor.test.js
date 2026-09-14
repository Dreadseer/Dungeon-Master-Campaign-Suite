import { describe, it, expect } from 'vitest'
import {
  extractJsonObject,
  extractJsonValue,
  parseExtraction,
  extractedName,
  extractionMaxTokens,
  CR_TO_XP,
} from '../compendiumExtractor.js'

// This file exists because Phase 6 pulled the JSON repair rules out of
// parseExtraction so world suggestions could share them. The PDF importers have
// depended on those rules since Phase 3 with no test covering them, so the
// refactor was unguarded. These lock the behaviour down.

describe('extractJsonObject', () => {
  it('parses plain JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('strips ```json fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('strips bare ``` fences', () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('ignores a chatty preamble', () => {
    expect(extractJsonObject('Sure, here you go:\n{"a":1}')).toEqual({ a: 1 })
  })

  it('ignores trailing commentary', () => {
    expect(extractJsonObject('{"a":1}\n\nHope that helps!')).toEqual({ a: 1 })
  })

  it('takes the OUTERMOST braces, keeping nested objects intact', () => {
    expect(extractJsonObject('x {"a":{"b":2}} y')).toEqual({ a: { b: 2 } })
  })

  it('does NOT unwrap a top-level array — that is extractJsonValue\'s job', () => {
    // It slices from the first "{" to the LAST "}", which across an array spans
    // the separating comma and fails to parse. That is the long-standing
    // behaviour the importers have always had, and it is the safe direction:
    // parseExtraction wants one object, and quietly taking the first element of
    // an array would hand the caller a different entry than the model returned.
    expect(() => extractJsonObject('[{"a":1},{"a":2}]')).toThrow(SyntaxError)
  })

  it('a single-element array does collapse to its object', () => {
    // Unavoidable consequence of the outermost-braces rule, and harmless.
    expect(extractJsonObject('[{"a":1}]')).toEqual({ a: 1 })
  })

  it('throws a SyntaxError on non-string input rather than a TypeError', () => {
    for (const junk of [null, undefined, 42, {}]) {
      expect(() => extractJsonObject(junk)).toThrow(SyntaxError)
    }
  })

  it('throws when there is no JSON at all', () => {
    expect(() => extractJsonObject('I cannot help with that.')).toThrow()
  })
})

describe('extractJsonValue', () => {
  it('returns a top-level array', () => {
    expect(extractJsonValue('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('returns a top-level object', () => {
    expect(extractJsonValue('{"a":1}')).toEqual({ a: 1 })
  })

  it('prefers whichever bracket opens first', () => {
    expect(extractJsonValue('{"items":[1,2]}')).toEqual({ items: [1, 2] })
    expect(extractJsonValue('[{"a":1}]')).toEqual([{ a: 1 }])
  })

  it('strips fences around an array', () => {
    expect(extractJsonValue('```json\n[1,2]\n```')).toEqual([1, 2])
  })

  it('honours allowArray: false', () => {
    expect(extractJsonValue('[{"a":1}]', { allowArray: false })).toEqual({ a: 1 })
  })
})

describe('parseExtraction still behaves as the importers expect', () => {
  it('coerces a spell, filling missing fields with typed blanks', () => {
    const out = parseExtraction('spell', '{"name":"Fireball","level":"3"}')
    expect(out.level).toBe(3)
    expect(out.school).toBe('')
    expect(out.concentration).toBe(false)
    expect(out.classes).toBe('')
  })

  it('coerces a monster, defaulting AC and HP rather than writing NaN', () => {
    const out = parseExtraction('monster', '{"name":"Goblin"}')
    expect(out.armor_class).toBe(10)
    expect(out.hit_points).toBe(1)
    expect(out.size).toBe('Medium')
    expect(out.actions).toEqual([])
  })

  it('keeps a monster\'s arrays when present', () => {
    const out = parseExtraction('monster', '{"actions":[{"name":"Bite","description":"d"}]}')
    expect(out.actions).toHaveLength(1)
  })

  it('coerces equipment, preserving explicit nulls on the armour caps', () => {
    const out = parseExtraction('equipment', '{"name":"Plate","armor_base_ac":18,"armor_dex_cap":null}')
    expect(out.armor_base_ac).toBe(18)
    expect(out.armor_dex_cap).toBeNull()
  })

  it('coerces a subclass, defaulting unlock_level to 3', () => {
    const out = parseExtraction('subclass', '{"name":"Battle Master","class_name":"Fighter"}')
    expect(out.unlock_level).toBe(3)
    expect(out.features).toEqual([])
  })

  it('works through fences, as the importers receive them', () => {
    expect(parseExtraction('spell', '```json\n{"level":9}\n```').level).toBe(9)
  })

  it('rejects an unknown type', () => {
    expect(() => parseExtraction('starship', '{}')).toThrow(/Unknown content type/)
  })
})

describe('helpers', () => {
  it('extractedName reads the top-level name', () => {
    expect(extractedName({ name: 'Fireball' })).toBe('Fireball')
    expect(extractedName({})).toBe('')
    expect(extractedName(null)).toBe('')
  })

  it('extractionMaxTokens gives the long types headroom', () => {
    expect(extractionMaxTokens('subclass')).toBe(8192)
    expect(extractionMaxTokens('monster')).toBe(8192)
    expect(extractionMaxTokens('spell')).toBe(2048)
    expect(extractionMaxTokens('unknown')).toBe(1536)
  })

  it('CR_TO_XP matches the 5e table at the boundaries', () => {
    expect(CR_TO_XP['0']).toBe(10)
    expect(CR_TO_XP['1/4']).toBe(50)
    expect(CR_TO_XP['1']).toBe(200)
    expect(CR_TO_XP['20']).toBe(25000)
    expect(CR_TO_XP['30']).toBe(155000)
  })
})
