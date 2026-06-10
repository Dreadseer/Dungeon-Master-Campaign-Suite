const { app, BrowserWindow, ipcMain, shell, safeStorage, protocol } = require('electron')
const fs   = require('fs')
const path = require('path')

// ── Player window ─────────────────────────────────────────────────────────────
let playerWindow = null

function createPlayerWindow(campaignId) {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.focus()
    return
  }
  playerWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'DMCS — Player View',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  if (process.env.NODE_ENV === 'development') {
    playerWindow.loadURL(`http://localhost:5173/player?campaign=${campaignId}`)
  } else {
    playerWindow.loadFile(
      path.join(__dirname, '../dist/renderer/index.html'),
      { hash: `/player?campaign=${campaignId}` }
    )
  }
  playerWindow.on('closed', () => { playerWindow = null })
}

ipcMain.handle('player:openWindow',  (_, campaignId) => { createPlayerWindow(campaignId); return { success: true } })
ipcMain.handle('player:closeWindow', ()              => { if (playerWindow && !playerWindow.isDestroyed()) playerWindow.close(); return { success: true } })
ipcMain.handle('player:isOpen',      ()              => ({ isOpen: !!playerWindow && !playerWindow.isDestroyed() }))
ipcMain.handle('player:setFullScreen', (_, fullScreen) => {
  if (playerWindow && !playerWindow.isDestroyed()) playerWindow.setFullScreen(fullScreen)
  return { success: true }
})

// Broadcast relay — DM window sends, player window receives
ipcMain.on('player:broadcast', (_event, message) => {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.webContents.send('player:receive', message)
  }
})

// Must be called before app is ready — registers dmcs-asset:// as a secure scheme
// so Chromium accepts it as an image source when the page is served from localhost
protocol.registerSchemesAsPrivileged([
  { scheme: 'dmcs-asset', privileges: { bypassCSP: true, supportFetchAPI: true, secure: true } },
])

const DatabaseService    = require('./database/DatabaseService')
const SrdService         = require('./services/SrdService')
const AIService          = require('./services/AIService')
const KeyService         = require('./services/KeyService')
const PdfIngestionService  = require('./services/PdfIngestionService')
const EmbeddingService     = require('./services/EmbeddingService')
const RAGService           = require('./services/RAGService')
const PdfExtractionService = require('./services/PdfExtractionService')
const registerDbHandlers   = require('./ipc/dbHandlers')
const registerSrdHandlers  = require('./ipc/srdHandlers')
const registerAiHandlers   = require('./ipc/aiHandlers')
const registerPdfHandlers  = require('./ipc/pdfHandlers')
const registerEmbedHandlers = require('./ipc/embeddingHandlers')
require('./ipc/fileHandlers')   // file dialog + image copy/read (self-registering)

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Electron 25+ requires protocol.handle (not registerFileProtocol).
  // URL format: dmcs-asset:///C:/path/to/file.jpg  (forward slashes, encodeURI-encoded)
  // The renderer constructs these via window.electronAPI.file.getLocalUrl(absPath).
  protocol.handle('dmcs-asset', async (request) => {
    try {
      // Strip scheme + leading slash: "dmcs-asset:///C:/..." → "C:/..."
      const encoded  = request.url.slice('dmcs-asset:///'.length)
      const filePath = decodeURIComponent(encoded)   // handles spaces, brackets, etc.
      const buffer   = await fs.promises.readFile(filePath)
      const ext      = path.extname(filePath).slice(1).toLowerCase()
      const mimeType = MIME[ext] || 'application/octet-stream'
      return new Response(buffer, { headers: { 'Content-Type': mimeType } })
    } catch (err) {
      console.error('[dmcs-asset] Failed to serve:', request.url, err.message)
      return new Response('Not found', { status: 404 })
    }
  })

  const dbPath = path.join(app.getPath('userData'), 'dmcs.db')
  console.log('[DB] Path:', dbPath)

  global.db               = new DatabaseService(dbPath)
  global.srdService       = new SrdService(global.db)
  global.keyService       = new KeyService()
  global.aiService        = new AIService()
  global.pdfService          = new PdfIngestionService(global.db, app.getPath('userData'))
  global.embeddingService    = new EmbeddingService(global.db, app.getPath('userData'))
  global.ragService          = new RAGService(global.db, global.embeddingService, global.aiService)
  global.pdfExtractionService = new PdfExtractionService(global.db, global.aiService, global.embeddingService)

  // RAG settings — load from disk or fall back to defaults
  const ragSettingsPath = path.join(app.getPath('userData'), 'rag-settings.json')
  try {
    global.ragSettings = JSON.parse(fs.readFileSync(ragSettingsPath, 'utf8'))
  } catch {
    global.ragSettings = { topK: 5, scoreThreshold: 0.5, ollamaModel: 'llama3', embedModel: 'nomic-embed-text' }
  }

  registerDbHandlers(global.db)
  registerSrdHandlers(global.db, global.srdService)
  registerAiHandlers(global.aiService, global.keyService)
  registerPdfHandlers(global.pdfService, global.db, global.pdfExtractionService)
  registerEmbedHandlers(global.embeddingService)

  // Auto-initialize AI with saved key (if any)
  const savedKey = global.keyService.loadKey()
  const result   = await global.aiService.initialize(savedKey)
  console.log('[AI] Mode:', result.mode)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('app:version', () => app.getVersion())
