const Anthropic = require('@anthropic-ai/sdk')
const { net }   = require('electron')

class AIService {
  constructor() {
    this.mode             = 'offline'
    this.anthropicClient  = null
    this.ollamaBaseUrl    = 'http://localhost:11434'
    this.ollamaModel      = 'llama3:latest'
    this.anthropicModel   = 'claude-sonnet-4-20250514'
  }

  async initialize(apiKey) {
    if (apiKey) {
      try {
        const client = new Anthropic({ apiKey })
        await client.messages.create({
          model: this.anthropicModel,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        })
        this.anthropicClient = client
        this.mode = 'online'
        return { mode: this.mode }
      } catch {
        // fall through to Ollama check
      }
    }

    try {
      await this._ollamaGet('/api/tags')
      this.mode = 'offline-ollama'
    } catch {
      this.mode = 'no-ai'
    }

    return { mode: this.mode }
  }

  // Active model: prefer saved setting, fall back to constructor default
  _ollamaModel() {
    return global.ragSettings?.ollamaModel || this.ollamaModel
  }

  async complete(systemPrompt, userMessage, options = {}) {
    const start = Date.now()
    let result

    if (this.mode === 'online') {
      const response = await this.anthropicClient.messages.create({
        model:      this.anthropicModel,
        max_tokens: options.maxTokens || 1024,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      })
      result = response.content[0].text

    } else if (this.mode === 'offline-ollama') {
      const body = await this._ollamaPost('/api/generate', {
        model:   this._ollamaModel(),
        prompt:  userMessage,
        system:  systemPrompt,
        stream:  false,
        options: { num_gpu: 0 },
      })
      result = body.response

    } else {
      throw new Error('No AI service available. Please configure an API key or install Ollama.')
    }

    // Non-critical: log usage without blocking the response
    try {
      if (global.db) {
        global.db.run(
          'INSERT INTO ai_usage_log (campaign_id, mode, type, prompt_len, response_len, duration_ms) VALUES (?,?,?,?,?,?)',
          [options.campaignId ?? null, this.mode, options.type ?? 'chat',
           (systemPrompt + userMessage).length, result.length, Date.now() - start]
        )
      }
    } catch { /* logging is non-critical */ }

    return result
  }

  // Streaming completion — fires onChunk(text) for each token, onDone() when finished.
  // messages: [{ role: 'user'|'assistant', content: string }] for multi-turn support.
  async stream(systemPrompt, messages, onChunk, onDone) {
    if (this.mode === 'online') {
      const stream = await this.anthropicClient.messages.stream({
        model:      this.anthropicModel,
        max_tokens: 1024,
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
