import { describe, it, expect } from 'vitest'
import detection from '../../../electron/services/aiDetection.cjs'

const {
  classifyClaudeError, classifyOllamaError, missingOllamaModels, ollamaPullCommand,
  describeClaude, describeOllama, describeDetection, providerLabel,
  normaliseProvider, shouldFallBackToOllama, statusOf,
  PROVIDERS, DEFAULT_CLAUDE_MODEL,
} = detection

/** An error shaped the way the Anthropic SDK throws them. */
const sdkError = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra })

describe('statusOf', () => {
  it('reads the SDK status field', () => {
    expect(statusOf(sdkError(401, 'x'))).toBe(401)
  })

  it('reads a nested response status', () => {
    expect(statusOf({ response: { status: 404 } })).toBe(404)
  })

  it('falls back to a status embedded in the message', () => {
    expect(statusOf(new Error('Request failed with status 429'))).toBe(429)
  })

  it('is null when there is no status to find', () => {
    expect(statusOf(new Error('ECONNREFUSED'))).toBeNull()
    expect(statusOf(null)).toBeNull()
  })

  it('does not mistake a year or a token count for a status', () => {
    expect(statusOf(new Error('max_tokens 1000 exceeded in 2026'))).toBeNull()
  })

  it('does not mistake a PORT for a status', () => {
    // "ECONNREFUSED 1.2.3.4:443" turned a connection refusal into HTTP 443,
    // which then classified as unknown rather than offline.
    expect(statusOf(new Error('connect ECONNREFUSED 1.2.3.4:443'))).toBeNull()
    expect(statusOf(new Error('connect ECONNREFUSED 127.0.0.1:11434'))).toBeNull()
  })

  it('still reads an explicitly marked status out of a message', () => {
    expect(statusOf(new Error('Request failed with status 404'))).toBe(404)
    expect(statusOf(new Error('HTTP 503 from upstream'))).toBe(503)
  })
})

describe('classifyClaudeError — the distinction that drives behaviour', () => {
  it('401 is a bad key', () => {
    const r = classifyClaudeError(sdkError(401, 'invalid x-api-key'))
    expect(r.kind).toBe('key')
    expect(r.status).toBe(401)
  })

  it('403 is also a bad key', () => {
    expect(classifyClaudeError(sdkError(403, 'forbidden')).kind).toBe('key')
  })

  it('404 is a bad MODEL, not a bad key', () => {
    // The whole point of task 7: falling back to Ollama here would hide a
    // one-field fix behind a silent downgrade.
    const r = classifyClaudeError(sdkError(404, "model: claude-sonnet-5"))
    expect(r.kind).toBe('model')
    expect(r.status).toBe(404)
  })

  it('a not_found_error body is a bad model even without a 404 status', () => {
    expect(classifyClaudeError({ message: 'not_found_error: no such model' }).kind).toBe('model')
  })

  it('429 is rate limiting — key and model are both fine', () => {
    expect(classifyClaudeError(sdkError(429, 'slow down')).kind).toBe('rate')
  })

  it('a connection refusal is offline', () => {
    expect(classifyClaudeError(new Error('connect ECONNREFUSED 1.2.3.4:443')).kind).toBe('offline')
  })

  it('DNS failure is offline', () => {
    expect(classifyClaudeError(new Error('getaddrinfo ENOTFOUND api.anthropic.com')).kind).toBe('offline')
  })

  it('a timeout is offline', () => {
    expect(classifyClaudeError(new Error('Request timed out')).kind).toBe('offline')
  })

  it('a 5xx is offline — their end, not the key', () => {
    expect(classifyClaudeError(sdkError(503, 'overloaded')).kind).toBe('offline')
  })

  it('anything else is reported verbatim rather than flattened', () => {
    const r = classifyClaudeError(sdkError(400, 'max_tokens must be positive'))
    expect(r.kind).toBe('unknown')
    expect(r.message).toBe('max_tokens must be positive')
  })

  it('never throws on junk input', () => {
    for (const junk of [null, undefined, {}, 'a string', 42]) {
      expect(() => classifyClaudeError(junk)).not.toThrow()
      expect(classifyClaudeError(junk).message).toBeTruthy()
    }
  })
})

describe('shouldFallBackToOllama', () => {
  it('a bad key falls back — Ollama is genuinely the better option', () => {
    expect(shouldFallBackToOllama({ ok: false, kind: 'key' })).toBe(true)
  })

  it('an unreadable stored key falls back too', () => {
    expect(shouldFallBackToOllama({ ok: false, kind: 'unreadable-key' })).toBe(true)
  })

  it('a bad MODEL id does NOT fall back', () => {
    // Otherwise a DM with a working paid key silently ends up on a local model.
    expect(shouldFallBackToOllama({ ok: false, kind: 'model' })).toBe(false)
  })

  it('rate limiting does not fall back — it is transient', () => {
    expect(shouldFallBackToOllama({ ok: false, kind: 'rate' })).toBe(false)
  })

  it('a success never falls back', () => {
    expect(shouldFallBackToOllama({ ok: true, kind: 'model' })).toBe(false)
  })

  it('NO KEY falls back — the commonest setup of all', () => {
    // Written as an allow list this was omitted, and a DM with no key and a
    // healthy Ollama was told no-ai.
    expect(shouldFallBackToOllama({ ok: false, kind: 'no-key' })).toBe(true)
  })

  it('an unrecognised kind falls back rather than stranding the DM', () => {
    expect(shouldFallBackToOllama({ ok: false, kind: 'something-new' })).toBe(true)
  })

  it('handles nothing at all', () => {
    expect(shouldFallBackToOllama(null)).toBe(false)
  })
})

describe('classifyOllamaError', () => {
  it('a refused connection is offline', () => {
    expect(classifyOllamaError(new Error('connect ECONNREFUSED 127.0.0.1:11434')).kind).toBe('offline')
  })

  it("Chromium's net::ERR_ vocabulary is offline too", () => {
    // Electron's net module speaks Chromium error strings, not Node errnos.
    // Matching only the latter classified a dead Ollama as 'unknown'.
    expect(classifyOllamaError(new Error('net::ERR_CONNECTION_REFUSED')).kind).toBe('offline')
    expect(classifyOllamaError(new Error('net::ERR_NAME_NOT_RESOLVED')).kind).toBe('offline')
    expect(classifyClaudeError(new Error('net::ERR_INTERNET_DISCONNECTED')).kind).toBe('offline')
  })

  it('anything else is unknown but still carries its message', () => {
    const r = classifyOllamaError(new Error('something odd'))
    expect(r.kind).toBe('unknown')
    expect(r.message).toBe('something odd')
  })

  it('handles junk', () => {
    expect(classifyOllamaError(null).message).toBeTruthy()
  })
})

describe('missingOllamaModels', () => {
  const tags = [{ name: 'llama3:latest' }, { name: 'nomic-embed-text:latest' }]

  it('finds nothing missing when both are pulled', () => {
    expect(missingOllamaModels(tags)).toEqual([])
  })

  it('ignores the version suffix — llama3:8b still counts as llama3', () => {
    expect(missingOllamaModels([{ name: 'llama3:8b' }, { name: 'nomic-embed-text:v1.5' }])).toEqual([])
  })

  it('reports the chat model when only the embedder is pulled', () => {
    expect(missingOllamaModels([{ name: 'nomic-embed-text:latest' }])).toEqual(['llama3'])
  })

  it('reports the embedder when only the chat model is pulled', () => {
    expect(missingOllamaModels([{ name: 'llama3:latest' }])).toEqual(['nomic-embed-text'])
  })

  it('reports both when nothing is pulled', () => {
    expect(missingOllamaModels([])).toEqual(['llama3', 'nomic-embed-text'])
  })

  it('accepts bare strings as well as tag objects', () => {
    expect(missingOllamaModels(['llama3:latest', 'nomic-embed-text'])).toEqual([])
  })

  it('ignores case', () => {
    expect(missingOllamaModels([{ name: 'Llama3:Latest' }, { name: 'NOMIC-EMBED-TEXT' }])).toEqual([])
  })

  it('handles junk input', () => {
    expect(missingOllamaModels(null)).toHaveLength(2)
    expect(missingOllamaModels([null, {}, { name: '' }])).toHaveLength(2)
  })
})

describe('ollamaPullCommand', () => {
  it('gives the exact command for one missing model', () => {
    expect(ollamaPullCommand(['llama3'])).toBe('ollama pull llama3')
  })

  it('chains both', () => {
    expect(ollamaPullCommand(['llama3', 'nomic-embed-text']))
      .toBe('ollama pull llama3 && ollama pull nomic-embed-text')
  })

  it('is empty when nothing is missing', () => {
    expect(ollamaPullCommand([])).toBe('')
    expect(ollamaPullCommand(null)).toBe('')
  })
})

describe('describeClaude — never silent about a reason', () => {
  it('names the key as the problem on a 401', () => {
    const line = describeClaude({ attempted: true, ok: false, kind: 'key', status: 401, message: 'the key was rejected (HTTP 401)' })
    expect(line).toMatch(/rejected/)
    expect(line).toMatch(/401/)
    expect(line).toMatch(/Re-enter/)
  })

  it('names the MODEL on a 404, and says the key may be fine', () => {
    const line = describeClaude({ attempted: true, ok: false, kind: 'model', status: 404, model: 'claude-sonnet-9' })
    expect(line).toContain('claude-sonnet-9')
    expect(line).toMatch(/key may be fine/i)
  })

  it('says a saved key could not be decrypted — the reported bug', () => {
    const line = describeClaude({
      attempted: true, ok: false, kind: 'unreadable-key',
      message: 'Error while decrypting the ciphertext provided to safeStorage.decryptString.',
    })
    expect(line).toMatch(/could not be decrypted/i)
    expect(line).toMatch(/Re-enter/)
  })

  it('reports the model in use when ready', () => {
    expect(describeClaude({ attempted: true, ok: true, model: 'claude-sonnet-5' }))
      .toContain('claude-sonnet-5')
  })

  it('says why it was not attempted rather than going quiet', () => {
    expect(describeClaude({ attempted: false, message: 'no key saved' })).toMatch(/no key saved/)
  })

  it('always produces something, even for an empty result', () => {
    expect(describeClaude(null)).toBeTruthy()
    expect(describeClaude({ attempted: true, ok: false })).toBeTruthy()
  })
})

describe('describeOllama', () => {
  it('reports readiness with the URL', () => {
    expect(describeOllama({ attempted: true, ok: true, url: 'http://localhost:11434' }))
      .toContain('http://localhost:11434')
  })

  it('names a missing model even though the endpoint answered', () => {
    const line = describeOllama({
      attempted: true, ok: true, url: 'http://localhost:11434', missing: ['nomic-embed-text'],
    })
    expect(line).toContain('nomic-embed-text')
    expect(line).toMatch(/not pulled/)
  })

  it('uses plural wording for two missing models', () => {
    const line = describeOllama({
      attempted: true, ok: true, url: 'u', missing: ['llama3', 'nomic-embed-text'],
    })
    expect(line).toMatch(/are not pulled/)
  })

  it('reports the real error and the URL when unreachable', () => {
    const line = describeOllama({
      attempted: true, ok: false, url: 'http://127.0.0.1:11434',
      message: 'connect ECONNREFUSED 127.0.0.1:11434',
    })
    expect(line).toMatch(/unreachable/)
    expect(line).toContain('ECONNREFUSED')
  })

  it('always produces something', () => {
    expect(describeOllama(null)).toBeTruthy()
  })
})

describe('describeDetection', () => {
  it('returns the two lines in order', () => {
    const [claude, ollama] = describeDetection({
      claude: { attempted: true, ok: true, model: 'm' },
      ollama: { attempted: true, ok: false, url: 'u', message: 'ECONNREFUSED' },
    })
    expect(claude).toMatch(/^Claude:/)
    expect(ollama).toMatch(/^Ollama:/)
  })

  it('copes with an empty detection object', () => {
    expect(describeDetection({})).toHaveLength(2)
    expect(describeDetection(null)).toHaveLength(2)
  })
})

describe('providerLabel — the badge names the provider, not the mode', () => {
  it('names Claude and the model', () => {
    expect(providerLabel({ mode: 'online', claude: { model: 'claude-sonnet-5' } }))
      .toBe('Claude API — claude-sonnet-5')
  })

  it('names Ollama and its chat model', () => {
    expect(providerLabel({ mode: 'offline-ollama', ollama: { chatModel: 'llama3' } }))
      .toBe('Ollama — llama3')
  })

  it('degrades without a model id', () => {
    expect(providerLabel({ mode: 'online', claude: {} })).toBe('Claude API')
  })

  it('says no AI plainly', () => {
    expect(providerLabel({ mode: 'no-ai' })).toBe('No AI configured')
    expect(providerLabel(null)).toBe('No AI configured')
  })
})

describe('normaliseProvider', () => {
  it('accepts the three valid values', () => {
    for (const p of PROVIDERS) expect(normaliseProvider(p)).toBe(p)
  })

  it('ignores case and whitespace', () => {
    expect(normaliseProvider('  Claude ')).toBe('claude')
  })

  it('falls back to auto for anything else', () => {
    for (const junk of ['openai', '', null, undefined, 42, {}]) {
      expect(normaliseProvider(junk)).toBe('auto')
    }
  })
})

describe('DEFAULT_CLAUDE_MODEL', () => {
  it('is a non-empty string used only until the account list is fetched', () => {
    expect(typeof DEFAULT_CLAUDE_MODEL).toBe('string')
    expect(DEFAULT_CLAUDE_MODEL.length).toBeGreaterThan(0)
  })
})
