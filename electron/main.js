const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron')
const path = require('path')
const DatabaseService    = require('./database/DatabaseService')
const SrdService         = require('./services/SrdService')
const AIService          = require('./services/AIService')
const KeyService         = require('./services/KeyService')
const registerDbHandlers  = require('./ipc/dbHandlers')
const registerSrdHandlers = require('./ipc/srdHandlers')
const registerAiHandlers  = require('./ipc/aiHandlers')
require('./ipc/fileHandlers')   // file dialog + image copy/read (self-registering)

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
  const dbPath = path.join(app.getPath('userData'), 'dmcs.db')
  console.log('[DB] Path:', dbPath)

  global.db         = new DatabaseService(dbPath)
  global.srdService = new SrdService(global.db)
  global.keyService = new KeyService()
  global.aiService  = new AIService()

  registerDbHandlers(global.db)
  registerSrdHandlers(global.db, global.srdService)
  registerAiHandlers(global.aiService, global.keyService)

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
