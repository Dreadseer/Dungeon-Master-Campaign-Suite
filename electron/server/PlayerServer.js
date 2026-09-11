const express    = require('express')
const http       = require('http')
const { Server } = require('socket.io')
const path       = require('path')
const fs         = require('fs')
const { filterMapForPlayer, filterBroadcastPayload } = require('./fogFilter')

// Routes reachable before a token exists. Everything else under /api/ requires
// one — see _requireSession.
const PUBLIC_API_ROUTES = new Set(['/api/join'])

class PlayerServer {
  constructor(db) {
    this.db         = db
    this.app        = express()
    this.httpServer = http.createServer(this.app)
    this.io         = new Server(this.httpServer, {
      // Same-origin only: the player bundle is served by this very Express
      // instance, so a cross-origin websocket has no legitimate caller.
      cors: { origin: (origin, cb) => cb(null, this._isAllowedOrigin(origin)), methods: ['GET', 'POST'] }
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

  // ── ORIGIN POLICY ─────────────────────────────────────────────
  // The player app is served from this same Express instance, so same-origin
  // requests (which send no Origin header, or send our own) are all that is
  // needed. The old `Access-Control-Allow-Origin: *` let any website on the
  // internet read a DM's campaign through a player's browser once they had a
  // token — and with an ngrok tunnel up, the URL is publicly routable.
  //
  // The one real exception is the Vite dev server on :5174, which is a genuine
  // cross-origin caller during development only.
  _isAllowedOrigin(origin) {
    if (!origin) return true                       // same-origin / curl / native fetch

    let host
    try { host = new URL(origin).hostname } catch { return false }

    // The tunnel rewrites Host, so an ngrok origin is this server reached from
    // outside. Accepting it is the point of the tunnel.
    if (/\.ngrok(-free)?\.(app|io|dev)$/i.test(host)) return true

    // Dev-mode Vite origin, and only in dev.
    if (process.env.NODE_ENV === 'development' &&
        /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)) return true

    // Any origin whose host is a LAN address this server could be reached on.
    // Players join over the LAN by IP, and their browser sends that as Origin.
    return this._localHosts().has(host.toLowerCase())
  }

  _localHosts() {
    if (this._localHostCache) return this._localHostCache
    const set = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
    try {
      const os = require('os')
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const iface of addrs ?? []) set.add(String(iface.address).toLowerCase())
      }
    } catch { /* no os info — the defaults still cover localhost */ }
    this._localHostCache = set
    return set
  }

  // ── SESSION / AUTH ────────────────────────────────────────────
  // Tokens are minted by POST /api/join and held in memory only, so they die
  // with the server. There is no refresh and no expiry: a session lasts as long
  // as the DM leaves the server running, which matches how a game night works.
  _tokenFromRequest(req) {
    const header = req.get('authorization') ?? ''
    const bearer = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (bearer) return bearer[1].trim()
    // Query fallback: <img> and EventSource cannot set headers, and the map
    // image is loaded by <img src>.
    if (typeof req.query.token === 'string' && req.query.token) return req.query.token
    return null
  }

  /**
   * Express middleware. Rejects any /api/ request without a valid token and
   * attaches the session to req.session for the route handlers to scope by.
   */
  _requireSession(req, res, next) {
    if (!req.path.startsWith('/api/')) return next()
    if (PUBLIC_API_ROUTES.has(req.path)) return next()

    const token = this._tokenFromRequest(req)
    if (!token) {
      return res.status(401).json({ error: 'Missing session token. Join the campaign first.' })
    }

    const session = this._sessions.get(token)
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session token.' })
    }

    req.session = session
    next()
  }

  /**
   * Guard for a row that belongs to a campaign. Returns true when the caller's
   * token is for that campaign.
   *
   * 404 rather than 403 is deliberate: a player holding a token for campaign 3
   * should not be able to discover whether map 7 exists in campaign 4. The
   * distinction between "not yours" and "not there" is itself information.
   */
  _ownsCampaign(req, campaignId) {
    return Number(campaignId) === Number(req.session?.campaignId)
  }

  _denyNotFound(res) {
    return res.status(404).json({ error: 'Not found' })
  }

  _setupRoutes() {
    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: false }))

    // CORS + the ngrok interstitial bypass.
    this.app.use((req, res, next) => {
      const origin = req.get('origin')
      if (this._isAllowedOrigin(origin)) {
        // Echo the caller's origin rather than '*' so credentials stay possible
        // and the allowed set stays explicit.
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin)
          res.setHeader('Vary', 'Origin')
        }
      } else {
        // No CORS headers at all — the browser blocks the response.
        console.warn('[PlayerServer] blocked cross-origin request from', origin)
        if (req.method === 'OPTIONS') return res.sendStatus(403)
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
      res.setHeader('Ngrok-Skip-Browser-Warning', 'true')
      if (req.method === 'OPTIONS') return res.sendStatus(204)
      next()
    })

    // Auth gate — everything under /api/ except the public routes.
    this.app.use((req, res, next) => this._requireSession(req, res, next))

    // ── READ-ONLY REST API ──────────────────────────────────────
    // Every route below can assume req.session exists and is valid, and must
    // scope its query to req.session.campaignId.

    this.app.get('/api/campaign/:id', (req, res) => {
      try {
        if (!this._ownsCampaign(req, req.params.id)) return this._denyNotFound(res)
        const campaign = this.db.get('SELECT * FROM campaigns WHERE id=?', [req.params.id])
        if (!campaign) return this._denyNotFound(res)
        res.json(campaign)
      } catch (err) {
        console.error('[PlayerServer] GET /api/campaign/:id', err)
        res.status(500).json({ error: err.message })
      }
    })

    this.app.get('/api/character/:id', (req, res) => {
      try {
        const char = this.db.get('SELECT * FROM characters WHERE id=?', [req.params.id])
        if (!char) return this._denyNotFound(res)
        // A token for campaign 3 must not read a character sheet from campaign 4.
        if (!this._ownsCampaign(req, char.campaign_id)) return this._denyNotFound(res)
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
        if (!this._ownsCampaign(req, req.params.id)) return this._denyNotFound(res)
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
        if (!map) return this._denyNotFound(res)
        if (!this._ownsCampaign(req, map.campaign_id)) return this._denyNotFound(res)

        // Fog is enforced here, not in the browser. Until now the server sent
        // every token and player/components/MapView.jsx declined to draw the
        // hidden ones — a curtain painted on the inside of the window.
        const { map: safe, hidden, reason } = filterMapForPlayer(map)
        if (hidden > 0) {
          console.log(`[PlayerServer] map ${map.id}: withheld ${hidden} token(s) (${reason})`)
        }
        res.json(safe)
      } catch (err) {
        console.error('[PlayerServer] GET /api/map/:id', err)
        res.status(500).json({ error: err.message })
      }
    })

    // Serve the raw map image file from disk
    this.app.get('/api/map-image/:id', (req, res) => {
      try {
        const map = this.db.get('SELECT campaign_id, image_path FROM maps WHERE id=?', [req.params.id])
        if (!map || !map.image_path) return res.status(404).json({ error: 'No image path stored for this map' })
        if (!this._ownsCampaign(req, map.campaign_id)) return this._denyNotFound(res)

        const imgPath = map.image_path

        if (!fs.existsSync(imgPath)) {
          console.error('[PlayerServer] Map image not on disk:', imgPath)
          return res.status(404).json({ error: 'Image not found on disk' })
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
    // Handshake gate: a socket must present a valid token before it is allowed
    // to connect at all. Previously any socket could connect and only
    // player:identify checked the token — which meant an unidentified socket sat
    // connected indefinitely, and could receive anything emitted to a room it
    // managed to join.
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token
        ?? socket.handshake.query?.token
      const session = token ? this._sessions.get(token) : null
      if (!session) return next(new Error('Invalid or missing session token'))
      socket.data.session = session
      next()
    })

    this.io.on('connection', (socket) => {
      const session = socket.data.session
      console.log('[PlayerServer] Player connected:', socket.id, `(campaign ${session.campaignId})`)

      // Join the campaign room immediately. The room is derived from the token,
      // never from anything the client sends.
      socket.join(`campaign:${session.campaignId}`)

      socket.on('player:identify', (data) => {
        // The token is already verified by the handshake; this only records
        // which character the player picked.
        this.connectedPlayers.set(socket.id, {
          characterId: data?.characterId ?? null,
          playerName:  session.playerName,
          campaignId:  session.campaignId,
        })
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
    let outgoing = payload

    // A live map:update carries the same tokens the REST route filters, so it
    // gets the same treatment. Without this, fog would be enforced on load and
    // leak on the next sync.
    if (type === 'map:update' && payload && payload.mapId != null) {
      const map = this._mapForBroadcast(payload.mapId, campaignId)
      const result = filterBroadcastPayload(payload, map)
      outgoing = result.payload
      if (result.hidden > 0) {
        console.log(`[PlayerServer] map:update ${payload.mapId}: withheld ${result.hidden} token(s) (${result.reason})`)
      }
    }

    this.io.to(`campaign:${campaignId}`).emit(type, outgoing)
  }

  // Look up the map row a broadcast refers to, refusing one that belongs to a
  // different campaign than the room being broadcast to.
  _mapForBroadcast(mapId, campaignId) {
    try {
      const map = this.db.get('SELECT id, campaign_id, grid_size, image_path FROM maps WHERE id=?', [mapId])
      if (!map) return null
      if (Number(map.campaign_id) !== Number(campaignId)) return null
      return map
    } catch (err) {
      console.error('[PlayerServer] _mapForBroadcast', err)
      return null   // filterBroadcastPayload withholds every token for a null map
    }
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
        // Tokens die with the server. A restart invalidates every session.
        this._sessions.clear()
        console.log('[PlayerServer] Stopped')
        resolve()
      })
    })
  }
}

module.exports = PlayerServer
