const { dialog, app } = require('electron')
const { registerHandler } = require('./registerHandler')
const fs   = require('fs')
const path = require('path')

// Open OS file picker — returns chosen file path or null if cancelled
registerHandler('file:openImageDialog', async () => {
  const result = await dialog.showOpenDialog({
    title:      'Select Map Image',
    filters:    [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

// Copy image into userData/maps/ so map still works if source is moved
registerHandler('file:copyMapImage', async (_, sourcePath) => {
  const mapsDir = path.join(app.getPath('userData'), 'maps')
  if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true })
  const ext      = path.extname(sourcePath).toLowerCase()
  const filename = `map_${Date.now()}${ext}`
  const destPath = path.join(mapsDir, filename)
  fs.copyFileSync(sourcePath, destPath)
  return destPath
})

// Save a generated map image into userData/maps/, the same place an uploaded
// one is copied to, so db:maps:delete cleans it up the same way.
//
// Not file:saveExportedImage: that one opens a "Export Mind Map" save dialog and
// writes wherever the DM points it. A generated map is app data, not an export —
// and a map whose image lives in a user-chosen folder would have that file
// deleted from under them when the map is deleted.
registerHandler('file:saveMapImage', async (_, dataUrl) => {
  const prefix = 'data:image/png;base64,'
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) {
    throw new Error('Generated map image must be a PNG data URL')
  }
  const buffer = Buffer.from(dataUrl.slice(prefix.length), 'base64')
  // A PNG starts with an 8-byte signature. A zero-byte or corrupt export would
  // save a map that can never load, so refuse it here rather than there.
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Generated map image is not a valid PNG')
  }
  const mapsDir = path.join(app.getPath('userData'), 'maps')
  if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true })
  const destPath = path.join(mapsDir, `map_${Date.now()}_${require('crypto').randomUUID().slice(0, 8)}_generated.png`)
  fs.writeFileSync(destPath, buffer)
  return destPath
})

// Read image from disk and return as base64 data URL for canvas rendering
registerHandler('file:readImageAsBase64', (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null
  const ext    = path.extname(filePath).replace('.', '').toLowerCase()
  const mime   = ext === 'jpg' ? 'jpeg' : ext   // jpg → jpeg for valid MIME
  const buffer = fs.readFileSync(filePath)
  return `data:image/${mime};base64,${buffer.toString('base64')}`
})

// Save a canvas-generated thumbnail to userData/maps/thumbs/
registerHandler('file:saveThumbnail', async (_, mapId, base64) => {
  const thumbsDir = path.join(app.getPath('userData'), 'maps', 'thumbs')
  if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true })
  const destPath = path.join(thumbsDir, `thumb_${mapId}.png`)
  fs.writeFileSync(destPath, Buffer.from(base64, 'base64'))
  return destPath
})

// Read a stored thumbnail and return as base64 data URL
registerHandler('file:readThumbnail', (_, mapId) => {
  const thumbPath = path.join(app.getPath('userData'), 'maps', 'thumbs', `thumb_${mapId}.png`)
  if (!fs.existsSync(thumbPath)) return null
  const buffer = fs.readFileSync(thumbPath)
  return `data:image/png;base64,${buffer.toString('base64')}`
})

// Export mind map canvas as PNG — opens OS save dialog, writes file, returns saved path
registerHandler('file:saveExportedImage', async (_, campaignName, dataUrl) => {
  const safeName = (campaignName ?? 'campaign').replace(/[^a-zA-Z0-9_-]/g, '_')
  const result   = await dialog.showSaveDialog({
    title:       'Export Mind Map',
    defaultPath: `${safeName}_mind_map.png`,
    filters:     [{ name: 'PNG Image', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return null
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'))
  return result.filePath
})
