const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron')
const path = require('path')
const DatabaseService  = require('./database/DatabaseService')
const SrdService       = require('./services/SrdService')
const registerDbHandlers  = require('./ipc/dbHandlers')
const registerSrdHandlers = require('./ipc/srdHandlers')

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

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'dmcs.db')
  console.log('[DB] Path:', dbPath)

  global.db         = new DatabaseService(dbPath)
  global.srdService = new SrdService(global.db)

  registerDbHandlers(global.db)
  registerSrdHandlers(global.db, global.srdService)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('app:version', () => app.getVersion())
