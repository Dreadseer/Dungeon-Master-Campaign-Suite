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

    if (!isDev) {
      // Production: extraResources places the bundle at process.resourcesPath/player
      const productionPath = path.join(process.resourcesPath, 'player')
      if (fs.existsSync(productionPath)) return productionPath
      // Fallback for unpacked builds
      const { app } = require('electron')
      return path.join(app.getAppPath(), 'dist', 'player')
    }

    // Dev mode: serve the pre-built player bundle from dist/player if it exists.
    // This makes ngrok tunnels work — remote players don't have localhost:5174.
    const devBuildPath = path.join(__dirname, '../../dist/player')
    if (fs.existsSync(devBuildPath)) return devBuildPath

    return null  // No bundle yet — run npm run build:player first
  }

  _setupRoutes() {
    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: false }))

    // Allow cross-origin requests in dev (Vite on :5174 → Express on :3001)
    // Ngrok-Skip-Browser-Warning tells ngrok v3 to bypass its interstitial for ALL clients
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Ngrok-Skip-Browser-Warning', 'true')
      if (req.method === 'OPTIONS') return res.sendStatus(204)
      next()
    })

    // ── READ-ONLY REST API ──────────────────────────────────────

    this.app.get('/api/campaign/:id', (req, res) => {
      try {
        const campaign = this.db.get('SELECT * FROM campaigns WHERE id=?', [req.params.id])
        if (!campaign) return res.status(404).json({ error: 'Not found' })
        res.json(campaign)
      } catch (err) {
        console.error('[PlayerServer] GET /api/campaign/:id', err)
        res.status(500).json({ error: err.message })
      }
    })

    this.app.get('/api/character/:id', (req, res) => {
      try {
        const char = this.db.get('SELECT * FROM characters WHERE id=?', [req.params.id])
        if (!char) return res.status(404).json({ error: 'Not found' })
        const { id, campaign_id, player_name, character_name, class: cls,
                race, level, stats, hp_current, hp_max,
                inventory, spell_slots, subclass_name } = char
        res.json({ id, campaign_id, player_name, character_name, class: cls,
                   race, level, stats, hp_current, hp_max,
                   inventory, spell_slots, subclass_name })
      } catch (err) {
        console.error('[PlayerServer] GET /api/character/:id', err)
        res.status(500).json({ error: err.message })
      }
    })

    this.app.get('/api/campaign/:id/characters', (req, res) => {
      try {
        const chars = this.db.all(
          'SELECT id, player_name, character_name, class, race, level, hp_current, hp_max, subclass_name FROM characters WHERE campaign_id=?',
          [req.params.id]
        )
        res.json(chars)
      } catch (err) {
        console.error('[PlayerServer] GET /api/campaign/:id/characters', err)
        res.status(500).json({ error: err.message })
      }
    })

    this.app.get('/api/map/:id', (req, res) => {
      try {
        const map = this.db.get('SELECT * FROM maps WHERE id=?', [req.params.id])
        if (!map) return res.status(404).json({ error: 'Not found' })
        res.json(map)
      } catch (err) {
        console.error('[PlayerServer] GET /api/map/:id', err)
        res.status(500).json({ error: err.message })
      }
    })

    // Serve the raw map image file from disk
    this.app.get('/api/map-image/:id', (req, res) => {
      try {
        const map = this.db.get('SELECT image_path FROM maps WHERE id=?', [req.params.id])
        if (!map || !map.image_path) return res.status(404).json({ error: 'No image path stored for this map' })

        const imgPath = map.image_path
        console.log('[PlayerServer] Serving map image:', imgPath)

        if (!fs.existsSync(imgPath)) {
          console.error('[PlayerServer] Map image not on disk:', imgPath)
          return res.status(404).json({ error: `Image not found on disk: ${imgPath}` })
        }

        const ext = path.extname(imgPath).toLowerCase()
        const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }
        res.setHeader('Content-Type', mime[ext] || 'image/png')
        fs.createReadStream(imgPath).pipe(res)
      } catch (err) {
        console.error('[PlayerServer] GET /api/map-image/:id', err)
        res.status(500).json({ error: err.message })
      }
    })

    this.app.post('/api/join', (req, res) => {
      try {
        const body       = req.body ?? {}
        const campaignId = body.campaignId
        const playerName = (body.playerName ?? '').trim()
        console.log('[PlayerServer] POST /api/join body:', body)

        if (!campaignId || !playerName) {
          return res.status(400).json({ error: 'campaignId and playerName required' })
        }
        const campaign = this.db.get('SELECT id, name FROM campaigns WHERE id=?', [campaignId])
        if (!campaign) return res.status(404).json({ error: `Campaign ${campaignId} not found` })

        const token = require('crypto').randomUUID()
        this._sessions.set(token, { campaignId: parseInt(campaignId), playerName })
        res.json({ token, campaignName: campaign.name })
      } catch (err) {
        console.error('[PlayerServer] POST /api/join', err)
        res.status(500).json({ error: err.message })
      }
    })

    // ── SERVE PLAYER REACT BUNDLE ─────────────────────────────
    const bundlePath = this._getPlayerBundlePath()
    if (bundlePath && fs.existsSync(bundlePath)) {
      this.app.use(express.static(bundlePath))
      // Express 5 requires a named wildcard — bare '*' is not valid
      this.app.get('/{*splat}', (req, res) => {
        if (!req.path.startsWith('/api/')) {
          res.sendFile(path.join(bundlePath, 'index.html'))
        }
      })
    } else {
      this.app.get('/', (req, res) => res.redirect('http://localhost:5174'))
    }

    // ── GLOBAL JSON ERROR HANDLER ─────────────────────────────
    // eslint-disable-next-line no-unused-vars
    this.app.use((err, req, res, next) => {
      console.error('[PlayerServer] Unhandled error:', err)
      res.status(500).json({ error: err.message ?? 'Internal server error' })
    })
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
