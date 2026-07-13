# ⚔ DMCS — Remote Player View
## Claude Code Network Prompts 01 – 03
### LAN + ngrok Network Layer

---

## Prompt Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | PlayerServer & ngrok Infrastructure | Express + socket.io server, TunnelService, IPC handlers, ngrok token in KeyService, graceful shutdown | 2 – 3 hrs |
| 02 | Player Web App | Separate Vite entry, JoinScreen, WebSocket client, CharacterSheet, MapView, dual-port dev setup | 2 – 3 hrs |
| 03 | DM Network Controls UI + Packaging | NetworkSessionPanel, QR codes, player roster, Settings ngrok section, electron-builder config | 2 – 3 hrs |

**Total estimated time: 6 – 9 hours**

> **⚔ PREREQUISITE:** Phase 8 (Player View) must be complete before running these prompts. The Phase 8 `DMPlayerControls` and `PlayerCharacterSheet` components are referenced and extended here. Run Prompt 01, verify the server API works in a browser, then Prompt 02, then Prompt 03.

> **ℹ NGROK ACCOUNT:** ngrok requires a free account to get an auth token. Sign up at ngrok.com — no credit card required. The free tier gives one tunnel at a time, which is all DMCS needs. The token is stored securely via Electron `safeStorage`, never in plain text.

---

## Network Prompt 01 — PlayerServer & ngrok Infrastructure
### *Express + socket.io server, TunnelService, IPC handlers, server lifecycle management*

---

### Context

The existing Phase 8 Player View works as a second Electron `BrowserWindow` on the same machine. This prompt adds a completely separate network layer: an embedded Express + socket.io HTTP server that runs inside the Electron main process, serves the player web app as static files, and pushes live updates via WebSocket. The DM can run in LAN mode (same Wi-Fi) or Internet mode (ngrok public URL). Players connect using any browser on any device — no Electron, no install.

Architecture overview:

```
DM Electron App (main process)
├── Existing IPC layer (unchanged)
├── NEW: PlayerServer (Express + socket.io)
│   ├── GET /          → serves player React bundle (static files)
│   ├── GET /api/...   → read-only character/map/encounter data
│   └── WebSocket      → pushes broadcast events to all connected players
└── NEW: TunnelService (ngrok SDK)
    └── opens public HTTPS tunnel → DM shares URL / QR code

Player (browser on any device)
└── opens URL → loads React SPA → connects WebSocket → receives live updates
```

---

### Your Task

#### ▸ Step 1 — Install dependencies

```bash
npm install express
npm install socket.io
npm install @ngrok/ngrok
npm install qrcode
```

> **ℹ NOTE:** All four packages run in the Electron main process only. Never import them in `src/`. They are Node.js packages and will crash the renderer.

---

#### ▸ Step 2 — Create the PlayerServer service

📄 `electron/server/PlayerServer.js`

```javascript
const express    = require('express')
const http       = require('http')
const { Server } = require('socket.io')
const path       = require('path')
const fs         = require('fs')

class PlayerServer {
  constructor(db) {
    this.db         = db
    this.app        = express()
    this.httpServer = http.createServer(this.app)
    this.io         = new Server(this.httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    })
    this.port             = 3001
    this.isRunning        = false
    this.connectedPlayers = new Map()  // socketId → { characterId, playerName }
    this._sessions        = new Map()  // token → { campaignId, playerName }
    this._setupRoutes()
    this._setupSockets()
  }

  // ── STATIC FILE SERVING ───────────────────────────────────────
  _getPlayerBundlePath() {
    const isDev = process.env.NODE_ENV === 'development'
    if (isDev) return null  // dev mode: redirect to Vite on :5174

    // In production: electron-builder puts extraResources in process.resourcesPath
    const resourcesPath = process.resourcesPath
    const playerPath    = path.join(resourcesPath, 'player')
    if (fs.existsSync(playerPath)) return playerPath

    // Fallback for unpacked builds
    const { app } = require('electron')
    return path.join(app.getAppPath(), 'dist', 'player')
  }

  _setupRoutes() {
    this.app.use(express.json())

    // ── READ-ONLY REST API ──────────────────────────────────────

    // Campaign info
    this.app.get('/api/campaign/:id', (req, res) => {
      const campaign = this.db.get('SELECT * FROM campaigns WHERE id=?', [req.params.id])
      if (!campaign) return res.status(404).json({ error: 'Not found' })
      res.json(campaign)
    })

    // Character sheet — strips DM-only fields before sending
    this.app.get('/api/character/:id', (req, res) => {
      const char = this.db.get('SELECT * FROM characters WHERE id=?', [req.params.id])
      if (!char) return res.status(404).json({ error: 'Not found' })
      const { id, campaign_id, player_name, character_name, class: cls,
              race, level, stats, hp_current, hp_max,
              inventory, spell_slots, subclass_name } = char
      res.json({ id, campaign_id, player_name, character_name, class: cls,
                 race, level, stats, hp_current, hp_max,
                 inventory, spell_slots, subclass_name })
    })

    // All characters for campaign (character selection screen)
    this.app.get('/api/campaign/:id/characters', (req, res) => {
      const chars = this.db.all(
        'SELECT id, player_name, character_name, class, race, level, hp_current, hp_max, subclass_name FROM characters WHERE campaign_id=?',
        [req.params.id]
      )
      res.json(chars)
    })

    // Active map
    this.app.get('/api/map/:id', (req, res) => {
      const map = this.db.get('SELECT * FROM maps WHERE id=?', [req.params.id])
      if (!map) return res.status(404).json({ error: 'Not found' })
      res.json(map)
    })

    // Player join — returns a session token
    this.app.post('/api/join', (req, res) => {
      const { campaignId, playerName } = req.body
      if (!campaignId || !playerName) {
        return res.status(400).json({ error: 'campaignId and playerName required' })
      }
      const campaign = this.db.get('SELECT id, name FROM campaigns WHERE id=?', [campaignId])
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' })
      const token = require('crypto').randomUUID()
      this._sessions.set(token, { campaignId: parseInt(campaignId), playerName })
      res.json({ token, campaignName: campaign.name })
    })

    // ── SERVE PLAYER REACT BUNDLE ─────────────────────────────
    const bundlePath = this._getPlayerBundlePath()
    if (bundlePath && fs.existsSync(bundlePath)) {
      this.app.use(express.static(bundlePath))
      // SPA fallback
      this.app.get('*', (req, res) => {
        if (!req.path.startsWith('/api/')) {
          res.sendFile(path.join(bundlePath, 'index.html'))
        }
      })
    } else {
      // Development: redirect to Vite dev server
      this.app.get('/', (req, res) => res.redirect('http://localhost:5174'))
    }
  }

  // ── WEBSOCKET EVENTS ────────────────────────────────────────
  _setupSockets() {
    this.io.on('connection', (socket) => {
      console.log('[PlayerServer] Player connected:', socket.id)

      socket.on('player:identify', (data) => {
        // data: { token, characterId }
        const session = this._sessions.get(data.token)
        if (!session) { socket.emit('error', { message: 'Invalid session' }); return }
        this.connectedPlayers.set(socket.id, {
          characterId: data.characterId,
          playerName:  session.playerName,
          campaignId:  session.campaignId,
        })
        socket.join(`campaign:${session.campaignId}`)
        socket.emit('player:identified', { ok: true })
        this._notifyDM()
      })

      socket.on('disconnect', () => {
        this.connectedPlayers.delete(socket.id)
        this._notifyDM()
        console.log('[PlayerServer] Player disconnected:', socket.id)
      })
    })
  }

  // ── BROADCAST METHODS — called by IPC handlers ───────────────
  broadcast(campaignId, type, payload) {
    this.io.to(`campaign:${campaignId}`).emit(type, payload)
  }

  broadcastToPlayer(socketId, type, payload) {
    this.io.to(socketId).emit(type, payload)
  }

  _notifyDM() {
    const { BrowserWindow } = require('electron')
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) {
        w.webContents.send('server:players-changed', this.getConnectedPlayers())
      }
    })
  }

  getConnectedPlayers() {
    return Array.from(this.connectedPlayers.entries())
      .map(([id, data]) => ({ socketId: id, ...data }))
  }

  // ── LIFECYCLE ────────────────────────────────────────────────
  async start(port) {
    if (this.isRunning) return { port: this.port }
    this.port = port ?? 3001
    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, '0.0.0.0', () => {
        this.isRunning = true
        console.log(`[PlayerServer] Listening on port ${this.port}`)
        resolve({ port: this.port })
      })
      this.httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          this.port++
          this.httpServer.listen(this.port, '0.0.0.0')
        } else {
          reject(err)
        }
      })
    })
  }

  async stop() {
    if (!this.isRunning) return
    return new Promise((resolve) => {
      this.io.close()
      this.httpServer.close(() => {
        this.isRunning = false
        this.connectedPlayers.clear()
        this._sessions.clear()
        console.log('[PlayerServer] Stopped')
        resolve()
      })
    })
  }
}

module.exports = PlayerServer
```

---

#### ▸ Step 3 — Create the TunnelService

📄 `electron/server/TunnelService.js`

```javascript
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
        addr:      localPort,
        authtoken: ngrokAuthToken,
        // Optional — paid plans only:
        // domain: 'my-dmcs.ngrok.app',
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
```

---

#### ▸ Step 4 — Create the server IPC handlers

📄 `electron/ipc/serverHandlers.js`

```javascript
const { ipcMain } = require('electron')
const os          = require('os')
const QRCode      = require('qrcode')

module.exports = (playerServer, tunnelService, keyService) => {

  // ── SERVER LIFECYCLE ────────────────────────────────────────
  ipcMain.handle('server:start', async (_, port) => {
    const result = await playerServer.start(port ?? 3001)
    return { ...result, localUrl: `http://${getLocalIP()}:${result.port}` }
  })

  ipcMain.handle('server:stop', async () => {
    await tunnelService.close()
    await playerServer.stop()
    return { stopped: true }
  })

  ipcMain.handle('server:status', () => ({
    isRunning:  playerServer.isRunning,
    port:       playerServer.port,
    localUrl:   playerServer.isRunning ? `http://${getLocalIP()}:${playerServer.port}` : null,
    tunnelUrl:  tunnelService.getUrl(),
    tunnelOpen: tunnelService.isOpen(),
    players:    playerServer.getConnectedPlayers(),
  }))

  ipcMain.handle('server:getPlayers', () => playerServer.getConnectedPlayers())

  // ── TUNNEL ──────────────────────────────────────────────────
  ipcMain.handle('server:tunnel:open', async () => {
    if (!playerServer.isRunning) throw new Error('Start the server before opening a tunnel')
    const token = keyService.loadNgrokToken()
    if (!token) throw new Error('No ngrok auth token saved. Add one in Settings.')
    const url = await tunnelService.open(playerServer.port, token)
    return { url }
  })

  ipcMain.handle('server:tunnel:close', async () => {
    await tunnelService.close()
    return { closed: true }
  })

  // ── QR CODE ─────────────────────────────────────────────────
  ipcMain.handle('server:qrcode', async (_, url) => {
    return QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#C9A84C', light: '#0d0a05' },  // DMCS gold on dark
      width: 256,
    })
  })

  // ── NGROK TOKEN MANAGEMENT ───────────────────────────────────
  ipcMain.handle('server:ngrok:saveToken',   (_, token) => { keyService.saveNgrokToken(token); return { saved: true } })
  ipcMain.handle('server:ngrok:hasToken',    ()         => ({ hasToken: keyService.hasNgrokToken() }))
  ipcMain.handle('server:ngrok:deleteToken', ()         => { keyService.deleteNgrokToken(); return { deleted: true } })

  // ── BROADCAST passthrough — DM UI → PlayerServer ─────────────
  ipcMain.on('server:broadcast', (_, { campaignId, type, payload }) => {
    playerServer.broadcast(campaignId, type, payload)
  })
}

function getLocalIP() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return 'localhost'
}
```

---

#### ▸ Step 5 — Extend KeyService for the ngrok token

📄 `electron/services/KeyService.js`

Add these four methods to the existing `KeyService` class, using the same `safeStorage` pattern as the Anthropic API key:

```javascript
saveNgrokToken(token) {
  const encrypted = safeStorage.encryptString(token)
  fs.writeFileSync(path.join(this.dataPath, 'ngrok.key'), encrypted)
}

loadNgrokToken() {
  const keyFile = path.join(this.dataPath, 'ngrok.key')
  if (!fs.existsSync(keyFile)) return null
  return safeStorage.decryptString(fs.readFileSync(keyFile))
}

hasNgrokToken() {
  return fs.existsSync(path.join(this.dataPath, 'ngrok.key'))
}

deleteNgrokToken() {
  const keyFile = path.join(this.dataPath, 'ngrok.key')
  if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile)
}
```

---

#### ▸ Step 6 — Initialize in main.js

📄 `electron/main.js`

```javascript
const PlayerServer  = require('./server/PlayerServer')
const TunnelService = require('./server/TunnelService')

// After db and keyService are initialized:
global.playerServer  = new PlayerServer(global.db)
global.tunnelService = new TunnelService()

require('./ipc/serverHandlers')(global.playerServer, global.tunnelService, global.keyService)

// Graceful shutdown
app.on('before-quit', async () => {
  await global.tunnelService.close()
  await global.playerServer.stop()
})
```

---

#### ▸ Step 7 — Expose in preload.js

```javascript
// Add to contextBridge exposure:
server: {
  start:            ()       => ipcRenderer.invoke('server:start'),
  stop:             ()       => ipcRenderer.invoke('server:stop'),
  status:           ()       => ipcRenderer.invoke('server:status'),
  getPlayers:       ()       => ipcRenderer.invoke('server:getPlayers'),
  tunnel: {
    open:           ()       => ipcRenderer.invoke('server:tunnel:open'),
    close:          ()       => ipcRenderer.invoke('server:tunnel:close'),
  },
  qrCode:           (url)    => ipcRenderer.invoke('server:qrcode', url),
  ngrok: {
    saveToken:      (token)  => ipcRenderer.invoke('server:ngrok:saveToken', token),
    hasToken:       ()       => ipcRenderer.invoke('server:ngrok:hasToken'),
    deleteToken:    ()       => ipcRenderer.invoke('server:ngrok:deleteToken'),
  },
  broadcast:        (msg)    => ipcRenderer.send('server:broadcast', msg),
  onPlayersChanged: (cb)     => ipcRenderer.on('server:players-changed', cb),
  offPlayersChanged:(cb)     => ipcRenderer.removeListener('server:players-changed', cb),
},
```

---

### Verification Steps

```javascript
// DevTools console in the DM window:

// 1. Start the server
const result = await window.electronAPI.server.start()
console.log(result)
// Expected: { port: 3001, localUrl: "http://192.168.x.x:3001" }

// 2. Check status
const status = await window.electronAPI.server.status()
console.log(status.isRunning)  // true
console.log(status.localUrl)   // "http://192.168.x.x:3001"

// 3. Open http://192.168.x.x:3001/api/campaign/1 in a browser on the same Wi-Fi
//    Expected: JSON response with campaign data

// 4. Save a token and open a tunnel
await window.electronAPI.server.ngrok.saveToken('your_ngrok_auth_token')
const tunnel = await window.electronAPI.server.tunnel.open()
console.log(tunnel.url)
// Expected: "https://abc123.ngrok-free.app"

// 5. Generate a QR code
const qr = await window.electronAPI.server.qrCode(tunnel.url)
console.log(qr.slice(0, 30))
// Expected: "data:image/png;base64,iVBOR..."

// 6. Open the tunnel URL on your phone — should reach the API

// 7. Stop cleanly
await window.electronAPI.server.stop()
const s2 = await window.electronAPI.server.status()
console.log(s2.isRunning)  // false
```

- Server starts on `:3001` (auto-increments if port is taken)
- `GET /api/campaign/:id` returns JSON in a browser
- ngrok token saves and loads securely
- Tunnel URL opens on a phone browser
- QR code generates as a gold-on-dark PNG
- App quit closes the tunnel gracefully

> **⚠ WARNING:** Do NOT move to Prompt 02 until the local API endpoints respond in a browser on the same network AND the ngrok tunnel URL loads on a phone or separate device.

---

## Network Prompt 02 — Player Web App
### *Separate Vite entry point, JoinScreen, WebSocket client, CharacterSheet, MapView*

---

### Context

Prompt 01 is complete. The `PlayerServer` serves a REST API and accepts WebSocket connections. This prompt builds the actual player-facing web app — a separate React SPA with its own Vite entry point, served as static files by Express. Players get a `JoinScreen`, a read-only `CharacterSheet`, and a live `MapView`, all updating in real time over the WebSocket connection.

> **ℹ NOTE:** This is a separate React app from the DM app. It has its own entry point and its own Vite build output (`dist/player/`). It does NOT use Electron APIs — everything goes through `fetch()` and `socket.io-client`.

---

### Your Task

#### ▸ Step 1 — Install socket.io-client

```bash
npm install socket.io-client
```

---

#### ▸ Step 2 — Create the player app entry point

📄 `player/index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0d0a05" />
    <title>DMCS — Player View</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #0d0a05; color: #e8e0d0; font-family: Arial, sans-serif; min-height: 100vh; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.jsx"></script>
  </body>
</html>
```

📄 `player/main.jsx`

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import PlayerWebApp from './PlayerWebApp'

createRoot(document.getElementById('root')).render(<PlayerWebApp />)
```

---

#### ▸ Step 3 — Add a separate Vite config for the player app

📄 `vite.player.config.js`

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root:    resolve(__dirname, 'player'),
  base:    './',
  build: {
    outDir:     resolve(__dirname, 'dist', 'player'),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api':       { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
})
```

Add to `package.json` scripts:

```json
"dev:player": "vite --config vite.player.config.js"
```

---

#### ▸ Step 4 — Create PlayerWebApp root component

📄 `player/PlayerWebApp.jsx`

```jsx
import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import JoinScreen            from './components/JoinScreen'
import CharacterSheet        from './components/CharacterSheet'
import MapView               from './components/MapView'
import TopBar                from './components/TopBar'
import SessionNotesOverlay   from './components/SessionNotesOverlay'

export default function PlayerWebApp() {
  const [session,      setSession]   = useState(null)
  const [character,    setCharacter] = useState(null)
  const [activeMap,    setActiveMap] = useState(null)
  const [sessionNotes, setNotes]     = useState([])
  const [activeView,   setView]      = useState('character')
  const [socket,       setSocket]    = useState(null)
  const [connected,    setConnected] = useState(false)

  // Persist session across page refreshes
  useEffect(() => {
    const saved = sessionStorage.getItem('dmcs-session')
    if (saved) { try { setSession(JSON.parse(saved)) } catch {} }
  }, [])

  // WebSocket connection
  useEffect(() => {
    if (!session) return

    const sock = io(window.location.origin, { transports: ['websocket', 'polling'] })
    setSocket(sock)

    sock.on('connect', () => {
      setConnected(true)
      sock.emit('player:identify', { token: session.token, characterId: character?.id ?? null })
    })
    sock.on('disconnect', () => setConnected(false))

    // Map pushed by DM
    sock.on('map:set', ({ mapId }) => {
      fetch(`/api/map/${mapId}`).then(r => r.json()).then(setActiveMap)
      setView('map')
    })

    // Map fog/token update
    sock.on('map:update', ({ mapId, fogData, tokens }) => {
      setActiveMap(prev => prev?.id === mapId
        ? { ...prev, fog_data: JSON.stringify(fogData), tokens: JSON.stringify(tokens) }
        : prev
      )
    })

    // HP/stats sync
    sock.on('character:sync', ({ characterId }) => {
      if (character?.id === characterId) {
        fetch(`/api/character/${characterId}`).then(r => r.json()).then(setCharacter)
      }
    })

    // DM session note
    sock.on('session:note', ({ text, timestamp }) => {
      setNotes(prev => [{ text, timestamp, id: crypto.randomUUID() }, ...prev].slice(0, 20))
    })

    return () => sock.disconnect()
  }, [session, character?.id])

  const handleJoin = (sessionData) => {
    sessionStorage.setItem('dmcs-session', JSON.stringify(sessionData))
    setSession(sessionData)
  }

  const handleSelectCharacter = (char) => {
    setCharacter(char)
    if (socket?.connected) {
      socket.emit('player:identify', { token: session.token, characterId: char.id })
    }
  }

  if (!session) return <JoinScreen onJoin={handleJoin} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBar
        campaignName={session.campaignName}
        playerName={session.playerName}
        connected={connected}
        activeView={activeView}
        onViewChange={setView}
      />
      <div style={{ flex: 1 }}>
        {activeView === 'character' && (
          <CharacterSheet
            campaignId={session.campaignId}
            character={character}
            onSelectCharacter={handleSelectCharacter}
          />
        )}
        {activeView === 'map' && <MapView map={activeMap} />}
      </div>
      <SessionNotesOverlay notes={sessionNotes} />
    </div>
  )
}
```

---

#### ▸ Step 5 — Build the JoinScreen component

📄 `player/components/JoinScreen.jsx`

```jsx
import { useState } from 'react'

export default function JoinScreen({ onJoin }) {
  const [campaignId, setCampaignId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')

  const handleJoin = async () => {
    if (!campaignId || !playerName.trim()) {
      setError('Campaign ID and your name are both required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/join', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ campaignId: parseInt(campaignId), playerName: playerName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Join failed')
      onJoin({ token: data.token, campaignId: parseInt(campaignId), campaignName: data.campaignName, playerName: playerName.trim() })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: '2rem' }}>
      <div style={{ background: '#1a1208', border: '2px solid #C9A84C', borderRadius: '12px',
        padding: '2rem', width: '100%', maxWidth: '400px' }}>
        <h1 style={{ fontFamily: 'Georgia', color: '#C9A84C', fontSize: '1.6rem',
          textAlign: 'center', marginBottom: '0.5rem' }}>⚔ DMCS Player View</h1>
        <p style={{ color: '#6b6b6b', textAlign: 'center', fontSize: '0.875rem', marginBottom: '2rem' }}>
          Enter the session details your DM shared with you
        </p>

        <label style={{ display: 'block', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#6b6b6b', textTransform: 'uppercase',
            letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Campaign ID</span>
          <input
            type="number"
            value={campaignId}
            onChange={e => setCampaignId(e.target.value)}
            placeholder="1"
            style={{ width: '100%', background: '#0d0a05', border: '1px solid #3d2f1a',
              color: '#e8e0d0', padding: '8px 12px', borderRadius: '6px', fontSize: '1rem' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#6b6b6b', textTransform: 'uppercase',
            letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Your Name</span>
          <input
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            placeholder="Thorin Ironforge"
            style={{ width: '100%', background: '#0d0a05', border: '1px solid #3d2f1a',
              color: '#e8e0d0', padding: '8px 12px', borderRadius: '6px', fontSize: '1rem' }}
          />
        </label>

        {error && (
          <div style={{ background: '#2a0a00', border: '1px solid #8B0000', borderRadius: '6px',
            padding: '8px 12px', color: '#f08080', fontSize: '0.875rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <button
          onClick={handleJoin}
          disabled={loading}
          style={{ width: '100%', background: loading ? '#3d2f1a' : '#C9A84C', border: 'none',
            color: '#0d0a05', fontWeight: 'bold', padding: '12px', borderRadius: '6px',
            fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Joining...' : 'Join Session'}
        </button>
      </div>
    </div>
  )
}
```

---

#### ▸ Step 6 — Build the TopBar component

📄 `player/components/TopBar.jsx`

```jsx
export default function TopBar({ campaignName, playerName, connected, activeView, onViewChange }) {
  return (
    <div style={{ background: '#1a1208', borderBottom: '1px solid #2d1f0a',
      padding: '0 1rem', height: '52px', display: 'flex', alignItems: 'center',
      gap: '1rem', position: 'sticky', top: 0, zIndex: 100 }}>

      {/* Connection indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%',
          background: connected ? '#27ae60' : '#e74c3c',
          boxShadow: connected ? '0 0 6px #27ae60' : 'none' }} />
        <span style={{ fontSize: '12px', color: '#6b6b6b' }}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <span style={{ color: '#C9A84C', fontFamily: 'Georgia', fontSize: '14px', fontWeight: 'bold' }}>
        {campaignName ?? 'DMCS'}
      </span>

      <div style={{ flex: 1 }} />

      {/* View toggle */}
      {['character', 'map'].map(view => (
        <button
          key={view}
          onClick={() => onViewChange(view)}
          style={{ background: activeView === view ? '#C9A84C' : 'transparent',
            border: '1px solid #C9A84C', color: activeView === view ? '#0d0a05' : '#C9A84C',
            padding: '4px 12px', borderRadius: '4px', cursor: 'pointer',
            fontSize: '13px', textTransform: 'capitalize' }}
        >
          {view === 'character' ? '📜 Sheet' : '🗺 Map'}
        </button>
      ))}

      <span style={{ fontSize: '12px', color: '#6b6b6b' }}>{playerName}</span>
    </div>
  )
}
```

---

#### ▸ Step 7 — Build the player CharacterSheet component

📄 `player/components/CharacterSheet.jsx`

On mount with no character selected: `fetch('/api/campaign/:id/characters')` and show character selection cards. On character selected: `fetch('/api/character/:id')` for the full record.

Key implementation notes:
- Import `calculateAC` from `../../src/utils/acUtils` (adjust relative path as needed — the function is pure JS with no Electron dependencies)
- Import `abilityMod`, `proficiencyBonus` from `../../src/utils/dnd5e`
- Display the same four-tab layout: **Stats | Attacks | Inventory | Spells**
- HP bar with color coding (green > 50%, amber > 25%, red ≤ 25%)
- AC, Proficiency Bonus, Speed, Passive Perception stat chips — same as Phase 8
- Fully read-only — no editable inputs

Character selection screen (when `character` is null):

```jsx
// Fetch on mount
useEffect(() => {
  fetch(`/api/campaign/${campaignId}/characters`)
    .then(r => r.json())
    .then(setCharacters)
}, [campaignId])

// Render character cards
{characters.map(char => (
  <div
    key={char.id}
    onClick={() => {
      fetch(`/api/character/${char.id}`).then(r => r.json()).then(full => {
        setCharacter(full)
        onSelectCharacter(full)
      })
    }}
    style={{ border: '1px solid #2d1f0a', borderLeft: '4px solid #C9A84C',
      borderRadius: '8px', padding: '1rem', cursor: 'pointer', marginBottom: '8px',
      background: '#1a1208' }}
  >
    <div style={{ fontFamily: 'Georgia', color: '#C9A84C', fontSize: '16px' }}>
      {char.character_name}
    </div>
    <div style={{ color: '#6b6b6b', fontSize: '13px', marginTop: '4px' }}>
      {char.race} · {char.class} · Level {char.level}
    </div>
    <div style={{ color: '#c0b8a8', fontSize: '13px', marginTop: '2px' }}>
      HP {char.hp_current} / {char.hp_max}
    </div>
  </div>
))}
```

---

#### ▸ Step 8 — Build the MapView component

📄 `player/components/MapView.jsx`

```jsx
import MapCanvas from '../../src/components/map/MapCanvas'

export default function MapView({ map }) {
  if (!map) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 'calc(100vh - 52px)', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ fontSize: '3rem' }}>🗺️</div>
        <div style={{ color: '#C9A84C', fontFamily: 'Georgia', fontSize: '1.2rem' }}>
          Waiting for your DM to share a map...
        </div>
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 52px)' }}>
      <MapCanvas map={map} mode="player" onFogChange={null} onTokensChange={null} />
    </div>
  )
}
```

---

#### ▸ Step 9 — Build the SessionNotesOverlay component

📄 `player/components/SessionNotesOverlay.jsx`

```jsx
import { useState } from 'react'

export default function SessionNotesOverlay({ notes }) {
  const [expanded, setExpanded] = useState(false)
  if (notes.length === 0) return null

  return (
    <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 200 }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ background: '#C9A84C', border: 'none', color: '#0d0a05',
          borderRadius: '50%', width: '44px', height: '44px',
          fontSize: '18px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center' }}
      >
        📜
      </button>
      {expanded && (
        <div style={{ position: 'absolute', bottom: '52px', right: 0, width: '280px',
          background: '#1a1208', border: '1px solid #C9A84C', borderRadius: '8px',
          padding: '12px', maxHeight: '300px', overflowY: 'auto' }}>
          <div style={{ color: '#C9A84C', fontFamily: 'Georgia', fontSize: '14px',
            marginBottom: '8px', fontWeight: 'bold' }}>Session Notes</div>
          {notes.map(note => (
            <div key={note.id} style={{ borderBottom: '1px solid #2d1f0a',
              padding: '6px 0', fontSize: '13px', color: '#c0b8a8' }}>
              {note.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

### Verification Steps

```bash
# Terminal 1 — DM app
npm run dev

# Terminal 2 — Player app dev server
npm run dev:player
```

```javascript
// 1. Start the PlayerServer from DM DevTools
await window.electronAPI.server.start()

// 2. Open http://localhost:5174 in a browser
//    Expected: JoinScreen renders

// 3. Enter Campaign ID 1 + a player name → Join Session
//    Expected: character selection screen appears

// 4. Select a character
//    Expected: character sheet with stats, HP bar, tabs

// 5. Push a map from DM DevTools
window.electronAPI.server.broadcast({
  campaignId: 1,
  type: 'map:set',
  payload: { mapId: 1 }
})
//    Expected: player browser switches to map view automatically

// 6. Push a HP sync
window.electronAPI.server.broadcast({
  campaignId: 1,
  type: 'character:sync',
  payload: { characterId: 1 }
})
//    Expected: HP bar in browser refreshes

// 7. Stop the server
await window.electronAPI.server.stop()
//    Expected: TopBar shows "Disconnected", amber indicator
```

- JoinScreen renders and `POST /api/join` returns a token
- Character selection shows all campaign characters
- Character sheet displays stats, HP bar, and tabs correctly
- Map view shows "Waiting..." when no map is pushed
- `map:set` broadcast switches player to map view automatically
- `character:sync` broadcast refreshes the HP bar
- Works on a phone browser via the LAN IP address

> **⚠ WARNING:** Do NOT move to Prompt 03 until the full join → character selection → character sheet → map push flow works in a real browser, including on a mobile device on the same Wi-Fi network.

---

## Network Prompt 03 — DM Network Controls UI + Packaging
### *NetworkSessionPanel, QR codes, player roster, ngrok settings, electron-builder*

---

### Context

Prompts 01 and 02 are complete. The server runs, the tunnel works, and the player web app connects. This prompt builds the DM UI for managing network sessions, adds ngrok configuration to Settings, wires the dual-broadcast into `DMPlayerControls`, and configures `electron-builder` to package everything — the DM app, player web app, and Express server — into a single executable.

---

### Your Task

#### ▸ Step 1 — Build the NetworkSessionPanel

📄 `src/components/network/NetworkSessionPanel.jsx`

A slide-in panel (320px wide, from the right) with four sections:

**Section 1 — Server controls:**
- Server status: large green "ONLINE" / red "OFFLINE" badge
- "Start Server" button → `server.start()` → updates status
- "Stop Server" button → `server.stop()` → confirmation if players connected
- Port display: `"Listening on port 3001"` in small monospace
- Local URL chip with copy-to-clipboard on click

**Section 2 — Connection mode:**
- Two tabs: "LAN Mode" (default) | "Internet Mode (ngrok)"
- LAN Mode: shows local IP URL + QR code
- Internet Mode: "Open Tunnel" button (if token saved) or amber warning linking to Settings
- "Open Tunnel" → `server.tunnel.open()` → shows public URL + new QR code
- "Close Tunnel" button when tunnel is active
- Tunnel URL chip in gold border, copy on click

**Section 3 — QR Code:**
- Fetch QR via `server.qrCode(activeUrl)` whenever the active URL changes
- Display at 200×200 with "Scan to join" label
- Raw URL in small monospace below for manual entry
- "Regenerate" button

**Section 4 — Connected players roster:**
- Real-time list via `server.onPlayersChanged` listener
- Each entry: player name, character name (if identified), green connection dot
- "0 players connected" empty state
- "Kick" button per player (calls a new IPC handler below)

Add a kick handler to `serverHandlers.js`:

```javascript
ipcMain.handle('server:kick', (_, socketId) => {
  const socket = playerServer.io.sockets.sockets.get(socketId)
  if (socket) socket.disconnect(true)
  return { kicked: true }
})
```

Add to preload: `server.kick: (socketId) => ipcRenderer.invoke('server:kick', socketId)`

---

#### ▸ Step 2 — Add "🌐 Network" button to the DM TopBar

📄 `src/components/TopBar.jsx`

```jsx
// Add alongside the existing "👥 Player View" button:
const [serverRunning, setServerRunning] = useState(false)
const [showNetwork,   setShowNetwork]   = useState(false)

// Poll server status every 5 seconds
useEffect(() => {
  const check = async () => {
    const status = await window.electronAPI.server.status()
    setServerRunning(status.isRunning)
  }
  check()
  const interval = setInterval(check, 5000)
  return () => clearInterval(interval)
}, [])

// Button JSX
<button onClick={() => setShowNetwork(n => !n)} style={{ position: 'relative', ... }}>
  🌐 Network
  {serverRunning && (
    <span style={{ position: 'absolute', top: '2px', right: '2px',
      width: '8px', height: '8px', borderRadius: '50%',
      background: '#27ae60', boxShadow: '0 0 4px #27ae60' }} />
  )}
</button>

{showNetwork && (
  <NetworkSessionPanel
    onClose={() => setShowNetwork(false)}
    activeCampaign={activeCampaign}
  />
)}
```

---

#### ▸ Step 3 — Wire dual-broadcast into DMPlayerControls

📄 `src/components/player/DMPlayerControls.jsx`

```javascript
// Add server status check
const [serverRunning, setServerRunning] = useState(false)
useEffect(() => {
  window.electronAPI.server.status().then(s => setServerRunning(s.isRunning))
}, [])

// Replace all player.broadcast() calls with this helper:
const broadcastUpdate = (type, payload) => {
  // 1. Existing: Electron IPC to local Phase 8 player window
  window.electronAPI.player.broadcast({ type, payload })

  // 2. NEW: WebSocket to all browser players
  if (serverRunning && activeCampaign?.id) {
    window.electronAPI.server.broadcast({
      campaignId: activeCampaign.id,
      type,
      payload,
    })
  }
}

// Use broadcastUpdate() everywhere:
// broadcastUpdate('map:set',         { mapId })
// broadcastUpdate('map:update',      { mapId, fogData, tokens })
// broadcastUpdate('character:sync',  { characterId })
// broadcastUpdate('session:note',    { text, timestamp })
```

---

#### ▸ Step 4 — Add ngrok settings section to the Settings page

📄 `src/pages/Settings.jsx`

Add a "Network Play" section below the existing AI Configuration section:

```jsx
// State
const [hasToken,     setHasToken]   = useState(false)
const [tokenInput,   setTokenInput] = useState('')
const [tokenSaved,   setTokenSaved] = useState(false)
const [testResult,   setTestResult] = useState(null)

useEffect(() => {
  window.electronAPI.server.ngrok.hasToken().then(r => setHasToken(r.hasToken))
}, [])

// Render
<section style={{ ... }}>
  <h3>Network Play</h3>

  <p style={{ color: '#6b6b6b', fontSize: '13px', marginBottom: '1rem' }}>
    ngrok lets your players connect from anywhere over the internet.
    Get a free auth token — no credit card required.
  </p>

  <a
    onClick={() => window.electronAPI.shell.openExternal('https://dashboard.ngrok.com/get-started/your-authtoken')}
    style={{ color: '#4A90D9', cursor: 'pointer', fontSize: '13px' }}
  >
    Get your free ngrok token →
  </a>

  <div style={{ marginTop: '1rem' }}>
    {hasToken ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: '#27ae60', fontSize: '13px' }}>✓ Token saved</span>
        <input type="password" value="••••••••••••••••" disabled
          style={{ background: '#0d0a05', border: '1px solid #2d1f0a',
            color: '#6b6b6b', padding: '6px 10px', borderRadius: '4px' }} />
        <button onClick={async () => {
          await window.electronAPI.server.ngrok.deleteToken()
          setHasToken(false)
        }}>Remove</button>
      </div>
    ) : (
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="password"
          placeholder="Paste your ngrok auth token..."
          value={tokenInput}
          onChange={e => setTokenInput(e.target.value)}
          style={{ flex: 1, background: '#0d0a05', border: '1px solid #C9A84C',
            color: '#e8e0d0', padding: '6px 10px', borderRadius: '4px' }}
        />
        <button onClick={async () => {
          await window.electronAPI.server.ngrok.saveToken(tokenInput)
          setHasToken(true)
          setTokenInput('')
          setTokenSaved(true)
          setTimeout(() => setTokenSaved(false), 3000)
        }}>Save Token</button>
      </div>
    )}
    {tokenSaved && <div style={{ color: '#27ae60', fontSize: '12px', marginTop: '4px' }}>Token saved securely.</div>}
  </div>

  {/* Test button */}
  <button
    onClick={async () => {
      setTestResult('Testing...')
      try {
        await window.electronAPI.server.start()
        const { url } = await window.electronAPI.server.tunnel.open()
        setTestResult(`✓ Tunnel works: ${url}`)
        setTimeout(async () => {
          await window.electronAPI.server.tunnel.close()
          setTestResult(null)
        }, 5000)
      } catch (err) {
        setTestResult(`✗ ${err.message}`)
      }
    }}
    disabled={!hasToken}
    style={{ marginTop: '1rem', opacity: hasToken ? 1 : 0.4, ... }}
  >
    Test Tunnel
  </button>
  {testResult && <div style={{ fontSize: '12px', marginTop: '4px', color: testResult.startsWith('✓') ? '#27ae60' : '#e74c3c' }}>{testResult}</div>}

  {/* Port preference */}
  <div style={{ marginTop: '1.5rem' }}>
    <label>
      Preferred port
      <input
        type="number"
        defaultValue={localStorage.getItem('dmcs-preferred-port') ?? 3001}
        onChange={e => localStorage.setItem('dmcs-preferred-port', e.target.value)}
        style={{ marginLeft: '8px', width: '80px', ... }}
      />
    </label>
  </div>
</section>
```

Also add `shell.openExternal` to preload.js:
```javascript
shell: { openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url) }
```

And the handler in main.js:
```javascript
const { shell } = require('electron')
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
```

---

#### ▸ Step 5 — Configure electron-builder for packaging

📄 `package.json`

```json
"build": {
  "appId": "com.dmcs.app",
  "productName": "DM Campaign Suite",
  "asar": true,
  "directories": {
    "output": "dist/app"
  },
  "files": [
    "dist/renderer/**",
    "electron/**",
    "package.json",
    "node_modules/**"
  ],
  "extraResources": [
    {
      "from": "dist/player",
      "to":   "player",
      "filter": ["**/*"]
    }
  ],
  "win": {
    "target": "nsis",
    "icon": "assets/icon.ico"
  },
  "mac": {
    "target": "dmg",
    "icon": "assets/icon.icns"
  },
  "linux": {
    "target": "AppImage",
    "icon": "assets/icon.png"
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

Update build scripts:

```json
"scripts": {
  "dev":          "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
  "dev:player":   "vite --config vite.player.config.js",
  "build":        "vite build && vite build --config vite.player.config.js && electron-builder",
  "build:player": "vite build --config vite.player.config.js",
  "dist":         "npm run build"
}
```

The build order matters: DM app Vite build → player app Vite build → electron-builder. The `extraResources` config copies `dist/player/` into the packaged app at `process.resourcesPath/player`, which is where `_getPlayerBundlePath()` in `PlayerServer.js` looks for it.

---

### Verification Steps

```javascript
// ── UI VERIFICATION ────────────────────────────────────────────
// 1. TopBar "🌐 Network" button appears
// 2. Click → NetworkSessionPanel slides in (320px, right side)
// 3. "Start Server" → status turns green, local URL appears
// 4. QR code generates and displays
// 5. "Internet Mode" tab → "Open Tunnel" → tunnel URL + new QR code appears
// 6. Scan QR on phone → JoinScreen loads in mobile browser
// 7. Join → select character → character sheet renders on phone

// ── DUAL BROADCAST VERIFICATION ──────────────────────────────
// Open local Phase 8 player window AND web browser player
// Push a map from DMPlayerControls
// Expected: BOTH update simultaneously

// ── PLAYER ROSTER ─────────────────────────────────────────────
// Connect 2 browsers → roster shows both players
// Click "Kick" on one → that browser returns to JoinScreen

// ── SETTINGS VERIFICATION ─────────────────────────────────────
// Settings → "Network Play" section visible
// Enter ngrok token → saved → shows masked + Remove button
// "Test Tunnel" → shows tunnel URL, then auto-closes after 5 seconds

// ── BUILD VERIFICATION ────────────────────────────────────────
// npm run build
// Expected: dist/renderer/ contains DM app
// Expected: dist/player/ contains player web app
// Expected: dist/app/ contains packaged executable

// Install and run the packaged .exe / .dmg / .AppImage
// Expected: DM app launches, campaigns load normally
// Expected: Start server → players connect via browser
// Expected: ngrok tunnel works in the packaged build
```

Checklist:
- NetworkSessionPanel shows server status, URL, QR code, player roster
- Switching to Internet Mode and opening the tunnel updates the QR code to the public URL
- Clicking URL chips copies them to clipboard
- Player roster updates live as players join and leave
- "Kick" disconnects a player and they return to JoinScreen
- DMPlayerControls dual-broadcasts to both the local Electron window and all browser players
- Settings page has ngrok token section with save/remove/test
- `npm run build` completes without errors
- Packaged executable starts, server starts, player app loads from bundled files
- Players can connect to the packaged app via ngrok on phones and laptops

> **⚠ IMPORTANT:** For the packaged build, always run `npm run build` (not just `npm run build:player`). This builds both Vite bundles before calling electron-builder. If players see a blank page after connecting to the packaged app, the player bundle path is resolving incorrectly — add a `console.log` to `_getPlayerBundlePath()` in production mode to confirm where it's looking.

---

*⚔ End of Remote Player Network Prompts ⚔*
