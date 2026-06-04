const Anthropic = require('@anthropic-ai/sdk')
const { net }   = require('electron')

class AIService {
  constructor() {
    this.mode             = 'offline'
    this.anthropicClient  = null
    this.ollamaBaseUrl    = 'http://localhost:11434'
    this.ollamaModel      = 'llama3'
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

  async complete(systemPrompt, userMessage, options = {}) {
    if (this.mode === 'online') {
      const response = await this.anthropicClient.messages.create({
        model: this.anthropicModel,
        max_tokens: options.maxTokens || 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      })
      return response.content[0].text
    }

    if (this.mode === 'offline-ollama') {
      const body = await this._ollamaPost('/api/generate', {
        model: this.ollamaModel,
        prompt: userMessage,
        system: systemPrompt,
        stream: false,
      })
      return body.response
    }

    throw new Error('No AI service available. Please configure an API key or install Ollama.')
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
