const { registerHandler, registerListener } = require('./registerHandler')
const os          = require('os')
const QRCode      = require('qrcode')

module.exports = (playerServer, tunnelService, keyService) => {

  // ── SERVER LIFECYCLE ────────────────────────────────────────
  registerHandler('server:start', async (_, port) => {
    const result = await playerServer.start(port ?? 3001)
    return { ...result, localUrl: `http://${getLocalIP()}:${result.port}` }
  })

  registerHandler('server:stop', async () => {
    await tunnelService.close()
    await playerServer.stop()
    return { stopped: true }
  })

  registerHandler('server:status', () => ({
    isRunning:  playerServer.isRunning,
    port:       playerServer.port,
    localUrl:   playerServer.isRunning ? `http://${getLocalIP()}:${playerServer.port}` : null,
    tunnelUrl:  tunnelService.getUrl(),
    tunnelOpen: tunnelService.isOpen(),
    players:    playerServer.getConnectedPlayers(),
  }))

  registerHandler('server:getPlayers', () => playerServer.getConnectedPlayers())

  // ── TUNNEL ──────────────────────────────────────────────────
  registerHandler('server:tunnel:open', async () => {
    if (!playerServer.isRunning) throw new Error('Start the server before opening a tunnel')
    const token = keyService.loadNgrokToken()
    if (!token) throw new Error('No ngrok auth token saved. Add one in Settings.')
    const url = await tunnelService.open(playerServer.port, token)
    return { url }
  })

  registerHandler('server:tunnel:close', async () => {
    await tunnelService.close()
    return { closed: true }
  })

  // ── QR CODE ─────────────────────────────────────────────────
  registerHandler('server:qrcode', async (_, url) => {
    return QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#C9A84C', light: '#0d0a05' },
      width: 256,
    })
  })

  // ── NGROK TOKEN MANAGEMENT ───────────────────────────────────
  registerHandler('server:ngrok:saveToken',   (_, token) => { keyService.saveNgrokToken(token); return { saved: true } })
  registerHandler('server:ngrok:hasToken',    ()         => ({ hasToken: keyService.hasNgrokToken() }))
  registerHandler('server:ngrok:deleteToken', ()         => { keyService.deleteNgrokToken(); return { deleted: true } })

  // ── KICK ────────────────────────────────────────────────────
  registerHandler('server:kick', (_, socketId) => {
    const socket = playerServer.io.sockets.sockets.get(socketId)
    if (socket) socket.disconnect(true)
    return { kicked: true }
  })

  // ── BROADCAST passthrough — DM UI → PlayerServer ─────────────
  registerListener('server:broadcast', (_, { campaignId, type, payload }) => {
    playerServer.broadcast(campaignId, type, payload)
  })
}

function getLocalIP() {
  const interfaces = os.networkInterfaces()
  const candidates = []
  for (const [name, addrs] of Object.entries(interfaces)) {
    // Skip WSL2, Hyper-V, VMware, Docker virtual adapters — these are
    // host-only/NAT networks that phones on Wi-Fi cannot reach.
    if (/loopback|vethernet|wsl|hyper.v|vmware|virtualbox|docker/i.test(name)) continue
    for (const iface of addrs) {
      if (iface.family === 'IPv4' && !iface.internal) candidates.push(iface.address)
    }
  }
  // Prefer typical LAN ranges (192.168.x.x, 10.x.x.x) over exotic ones
  return candidates.find(ip => /^192\.168\.|^10\./.test(ip))
      ?? candidates[0]
      ?? 'localhost'
}
