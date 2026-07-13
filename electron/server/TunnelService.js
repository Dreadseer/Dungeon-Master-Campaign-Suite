const ngrok = require('@ngrok/ngrok')

class TunnelService {
  constructor() {
    this.listener  = null
    this.publicUrl = null
  }

  async open(localPort, ngrokAuthToken) {
    if (this.listener) await this.close()
    if (!ngrokAuthToken) {
      throw new Error('ngrok auth token required. Get one free at https://dashboard.ngrok.com')
    }
    try {
      this.listener = await ngrok.forward({
        addr:                localPort,
        authtoken:           ngrokAuthToken,
        // Bypass ngrok's browser interstitial on all responses (works on mobile Chrome)
        response_header_add: ['ngrok-skip-browser-warning: true'],
      })
      this.publicUrl = this.listener.url()
      console.log(`[TunnelService] Tunnel open: ${this.publicUrl}`)
      return this.publicUrl
    } catch (err) {
      throw new Error(`ngrok tunnel failed: ${err.message}`)
    }
  }

  async close() {
    if (this.listener) {
      await this.listener.close()
      this.listener  = null
      this.publicUrl = null
      console.log('[TunnelService] Tunnel closed')
    }
  }

  isOpen() { return !!this.listener }
  getUrl()  { return this.publicUrl }
}

module.exports = TunnelService
