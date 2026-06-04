const { ipcMain, dialog, app } = require('electron')
const fs   = require('fs')
const path = require('path')

// Open OS file picker — returns chosen file path or null if cancelled
ipcMain.handle('file:openImageDialog', async () => {
  const result = await dialog.showOpenDialog({
    title:      'Select Map Image',
    filters:    [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

// Copy image into userData/maps/ so map still works if source is moved
ipcMain.handle('file:copyMapImage', async (_, sourcePath) => {
  const mapsDir = path.join(app.getPath('userData'), 'maps')
  if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true })
  const ext      = path.extname(sourcePath).toLowerCase()
  const filename = `map_${Date.now()}${ext}`
  const destPath = path.join(mapsDir, filename)
  fs.copyFileSync(sourcePath, destPath)
  return destPath
})

// Read image from disk and return as base64 data URL for canvas rendering
ipcMain.handle('file:readImageAsBase64', (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null
  const ext    = path.extname(filePath).replace('.', '').toLowerCase()
  const mime   = ext === 'jpg' ? 'jpeg' : ext   // jpg → jpeg for valid MIME
  const buffer = fs.readFileSync(filePath)
  return `data:image/${mime};base64,${buffer.toString('base64')}`
})

// Save a canvas-generated thumbnail to userData/maps/thumbs/
ipcMain.handle('file:saveThumbnail', async (_, mapId, base64) => {
  const thumbsDir = path.join(app.getPath('userData'), 'maps', 'thumbs')
  if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true })
  const destPath = path.join(thumbsDir, `thumb_${mapId}.png`)
  fs.writeFileSync(destPath, Buffer.from(base64, 'base64'))
  return destPath
})

// Read a stored thumbnail and return as base64 data URL
ipcMain.handle('file:readThumbnail', (_, mapId) => {
  const thumbPath = path.join(app.getPath('userData'), 'maps', 'thumbs', `thumb_${mapId}.png`)
  if (!fs.existsSync(thumbPath)) return null
  const buffer = fs.readFileSync(thumbPath)
  return `data:image/png;base64,${buffer.toString('base64')}`
})
