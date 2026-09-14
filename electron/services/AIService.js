const Anthropic = require('@anthropic-ai/sdk')
const { net }   = require('electron')
const {
  classifyClaudeError, classifyOllamaError, missingOllamaModels,
  normaliseProvider, shouldFallBackToOllama, DEFAULT_CLAUDE_MODEL,
} = require('./aiDetection.cjs')

class AIService {
  constructor() {
    this.mode             = 'offline'
    this.anthropicClient  = null
    // Overridable so a DM can run Ollama on another port or machine — and so
    // the UI driver can point it at a dead port to exercise no-ai mode, which
    // is otherwise untestable on a machine where Ollama is installed.
    this.ollamaBaseUrl    = process.env.DMCS_OLLAMA_URL || 'http://localhost:11434'
    this.ollamaModel      = 'llama3:latest'
    this.anthropicModel   = DEFAULT_CLAUDE_MODEL

    // Why the app is in the mode it is in (Phase 6.1 task 6).
    //
    // Before this, initialize() used a bare `catch {}`: a bad key, a bad model
    // id, and a dead network were indistinguishable, and the DM saw "no-ai"
    // with a saved key on screen and no explanation. Every detection now leaves
    // a record, and the UI renders it.
    this.lastDetection = {
      mode: 'offline',
      provider: 'auto',
      claude: { attempted: false, ok: false, message: 'not checked yet' },
      ollama: { attempted: false, ok: false, message: 'not checked yet' },
      at: null,
    }
  }

  /** The DM's provider choice: 'auto' | 'claude' | 'ollama' (task 9b). */
  _preferredProvider() {
    return normaliseProvider(global.ragSettings?.preferredProvider)
  }

  /** Active Claude model: the saved setting, else the fallback constant (task 8). */
  _claudeModel() {
    const configured = global.ragSettings?.anthropicModel
    return (typeof configured === 'string' && configured.trim())
      ? configured.trim()
      : this.anthropicModel
  }

  /**
   * Try the Claude path. Never throws — it reports.
   *
   * `keyError` is passed when the key could not even be read, so the result can
   * say "a key is saved but could not be decrypted" rather than the misleading
   * "no key saved" the old code produced for that case.
   */
  async _checkClaude(apiKey, keyError = null) {
    const model = this._claudeModel()

    if (keyError) {
      return { attempted: true, ok: false, kind: 'unreadable-key', model, message: keyError }
    }
    if (!apiKey) {
      return { attempted: false, ok: false, kind: 'no-key', model, message: 'no key saved' }
    }

    try {
      const client = new Anthropic({ apiKey })
      await client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      this.anthropicClient = client
      return { attempted: true, ok: true, kind: 'ok', model, status: 200, message: 'ready' }
    } catch (err) {
      const c = classifyClaudeError(err)
      return { attempted: true, ok: false, kind: c.kind, status: c.status, model, message: c.message }
    }
  }

  /** Try the Ollama path. Never throws — it reports, including missing models. */
  async _checkOllama() {
    const url = this.ollamaBaseUrl
    try {
      const body = await this._ollamaGet('/api/tags')
      const tags = body?.models ?? []
      const missing = missingOllamaModels(tags)
      return {
        attempted: true, ok: true, url,
        chatModel: this._ollamaModel(),
        models: tags.map(t => t.name).filter(Boolean),
        missing,
        message: missing.length ? `missing ${missing.join(', ')}` : 'ready',
      }
    } catch (err) {
      const c = classifyOllamaError(err)
      return { attempted: true, ok: false, url, kind: c.kind, missing: [], message: c.message }
    }
  }

  /**
   * Decide the mode, and record why.
   *
   * @param {string|null} apiKey   the decrypted key, or null
   * @param {object} opts
   *   keyError — why the key could not be read, when that is the situation
   */
  async initialize(apiKey, opts = {}) {
    const provider = this._preferredProvider()
    const keyError = opts.keyError ?? null

    const skipped = (why) => ({ attempted: false, ok: false, message: why })

    // With a provider explicitly chosen, only that provider is checked, and a
    // failure does NOT silently fall through to the other one (task 9b).
    let claude = provider === 'ollama'
      ? skipped('not selected — provider is set to Ollama')
      : await this._checkClaude(apiKey, keyError)

    let ollama = provider === 'claude'
      ? skipped('not selected — provider is set to Claude API')
      : await this._checkOllama()

    let mode
    if (provider === 'claude') {
      mode = claude.ok ? 'online' : 'no-ai'
    } else if (provider === 'ollama') {
      mode = ollama.ok ? 'offline-ollama' : 'no-ai'
    } else if (claude.ok) {
      mode = 'online'
    } else if (!shouldFallBackToOllama(claude)) {
      // A bad MODEL id is one editable field. Falling back here is how a DM
      // with a working paid key ends up on a local model wondering why.
      mode = 'no-ai'
    } else {
      mode = ollama.ok ? 'offline-ollama' : 'no-ai'
    }

    if (mode !== 'online') this.anthropicClient = null
    this.mode = mode
    this.lastDetection = { mode, provider, claude, ollama, at: new Date().toISOString() }

    return { mode, detection: this.lastDetection }
  }

  getDetection() {
    return this.lastDetection
  }

  /**
   * Test the Claude provider directly (task 10).
   *
   * Deliberately NOT routed through complete(): that reports the MODE, so a DM
   * whose key is fine but whose mode is 'no-ai' got "No AI service available"
   * and learned nothing. This talks to the provider whatever the mode is.
   */
  async testClaude(apiKey, keyError = null) {
    const result = await this._checkClaude(apiKey, keyError)
    return {
      ok: result.ok,
      status: result.status ?? null,
      model: result.model,
      kind: result.kind,
      message: result.ok ? `HTTP 200 — ${result.model} responded` : result.message,
    }
  }

  /** Test the Ollama provider directly, including which models are pulled. */
  async testOllama() {
    const result = await this._checkOllama()
    return {
      ok: result.ok,
      url: result.url,
      models: result.models ?? [],
      missing: result.missing ?? [],
      message: result.message,
    }
  }

  /** The account's real model list, for the Settings dropdown (task 8). */
  async listClaudeModels(apiKey) {
    if (!apiKey) throw new Error('No API key saved.')
    const client = new Anthropic({ apiKey })
    const page = await client.models.list({ limit: 100 })
    return (page?.data ?? []).map(m => ({ id: m.id, name: m.display_name ?? m.id }))
  }

  // Active model: prefer saved setting, fall back to constructor default
  _ollamaModel() {
    return global.ragSettings?.ollamaModel || this.ollamaModel
  }

  // A failed call is recorded with response_len = FAILED_RESPONSE_LEN.
  //
  // ai_usage_log has no status column and adding one would mean a migration for
  // a diagnostic table, so an existing column carries the flag instead: a
  // response of negative length is not a real measurement, which makes it an
  // unambiguous sentinel. getUsageStats counts rows below zero as failures.
  static get FAILED_RESPONSE_LEN() { return -1 }

  async complete(systemPrompt, userMessage, options = {}) {
    const start = Date.now()
    let result

    try {
      result = await this._complete(systemPrompt, userMessage, options)
    } catch (err) {
      // Log the failure, then rethrow — the caller still needs to know.
      // Without this, a DM whose key had expired or whose Ollama had stopped saw
      // usage stats claiming everything was fine.
      this._logUsage(options, systemPrompt, userMessage, AIService.FAILED_RESPONSE_LEN, start)
      throw err
    }

    this._logUsage(options, systemPrompt, userMessage, result.length, start)
    return result
  }

  _logUsage(options, systemPrompt, userMessage, responseLen, start) {
    // Non-critical: logging must never turn a working call into a failed one.
    try {
      if (global.db) {
        global.db.run(
          'INSERT INTO ai_usage_log (campaign_id, mode, type, prompt_len, response_len, duration_ms) VALUES (?,?,?,?,?,?)',
          [options.campaignId ?? null, this.mode, options.type ?? 'chat',
           (systemPrompt + userMessage).length, responseLen, Date.now() - start]
        )
      }
    } catch { /* logging is non-critical */ }
  }

  async _complete(systemPrompt, userMessage, options = {}) {
    let result

    if (this.mode === 'online') {
      const response = await this.anthropicClient.messages.create({
        model:      this._claudeModel(),
        max_tokens: options.maxTokens || 1024,
        // Disable thinking: this is a structured extraction/chat call, and on
        // models where thinking is on by default it would both consume the
        // max_tokens budget and lead the content array with a thinking block.
        thinking:   { type: 'disabled' },
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      })
      // Read the first text block rather than content[0], which may be a
      // thinking block on thinking-capable models.
      result = response.content.find(b => b.type === 'text')?.text ?? ''

    } else if (this.mode === 'offline-ollama') {
      // Ollama defaults to a 2048-token context window, which silently truncates
      // long extraction prompts (a full subclass/monster) before the model ever
      // sees the later features. Size the window to fit the input plus the
      // requested output so nothing is dropped.
      const maxOut  = options.maxTokens || 1024
      const inputTokens = Math.ceil((systemPrompt.length + userMessage.length) / 4)
      const numCtx  = Math.min(8192, inputTokens + maxOut + 512)
      const body = await this._ollamaPost('/api/generate', {
        model:   this._ollamaModel(),
        prompt:  userMessage,
        system:  systemPrompt,
        stream:  false,
        options: { num_gpu: 0, num_predict: maxOut, num_ctx: numCtx },
      })
      result = body.response

    } else {
      throw new Error('No AI service available. Please configure an API key or install Ollama.')
    }

    return result ?? ''
  }

  // Streaming completion — fires onChunk(text) for each token, onDone() when finished.
  // messages: [{ role: 'user'|'assistant', content: string }] for multi-turn support.
  async stream(systemPrompt, messages, onChunk, onDone) {
    if (this.mode === 'online') {
      const stream = await this.anthropicClient.messages.stream({
        model:      this._claudeModel(),
        max_tokens: 1024,
        thinking:   { type: 'disabled' },
        system:     systemPrompt,
        messages,
      })

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          onChunk(chunk.delta.text)
        }
      }
      await stream.finalMessage()
      onDone()

    } else if (this.mode === 'offline-ollama') {
      // Build a single prompt string from the messages array for Ollama
      const prompt = messages
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n') + '\nAssistant:'

      const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model:   this._ollamaModel(),
          prompt,
          system:  systemPrompt,
          stream:  true,
          options: { num_gpu: 0 },
        }),
      })
      if (!response.ok) throw new Error(`Ollama stream failed: ${response.status}`)

      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value).split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            if (data.response) onChunk(data.response)
          } catch { /* partial JSON line — skip */ }
        }
      }
      onDone()

    } else {
      throw new Error('No AI service available. Please configure an API key or install Ollama.')
    }
  }

  getMode() {
    return this.mode
  }

  _ollamaGet(path) {
    return new Promise((resolve, reject) => {
      const req = net.request({ url: this.ollamaBaseUrl + path, method: 'GET' })
      req.on('response', (res) => {
        let data = ''
        res.on('data', c => { data += c })
        res.on('end', () => {
          if (res.statusCode === 200) resolve(JSON.parse(data))
          else reject(new Error('Ollama HTTP ' + res.statusCode))
        })
      })
      req.on('error', reject)
      req.end()
    })
  }

  _ollamaPost(path, body) {
    return new Promise((resolve, reject) => {
      const req = net.request({ url: this.ollamaBaseUrl + path, method: 'POST' })
      req.setHeader('Content-Type', 'application/json')
      req.on('response', (res) => {
        let data = ''
        res.on('data', c => { data += c })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch (e) { reject(new Error('Ollama JSON parse failed')) }
        })
      })
      req.on('error', reject)
      req.write(JSON.stringify(body))
      req.end()
    })
  }
}

module.exports = AIService
