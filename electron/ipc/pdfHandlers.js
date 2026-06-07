const { ipcMain, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')

module.exports = (pdfService, db) => {

  // Open OS file picker — returns array of selected file paths (or [] if cancelled)
  ipcMain.handle('pdf:openDialog', async () => {
    const result = await dialog.showOpenDialog({
      title:      'Select Source Book PDF',
      filters:    [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  // Full ingest pipeline: copy PDF to storage, create source record, chunk + store
  // Returns { success, chunkCount, sourceId } so the renderer can chain embed:source
  ipcMain.handle('pdf:ingest', async (event, campaignId, filePath) => {
    const filename   = path.basename(filePath)
    const storedPath = await pdfService.copyPdf(filePath, filename)

    const result   = db.run(
      "INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count) VALUES (?,?,?,'pending',0)",
      [campaignId, filename, storedPath]
    )
    const sourceId = Number(result.lastInsertRowid)

    const ingestResult = await pdfService.ingest(sourceId, storedPath, (percent, message) => {
      event.sender.send('pdf:progress', { sourceId, percent, message })
    })
    return { ...ingestResult, sourceId }
  })

  // Re-ingest an existing source (clear old chunks, re-process the stored file)
  ipcMain.handle('pdf:reIngest', async (event, sourceId) => {
    return pdfService.reIngest(sourceId, (percent, message) => {
      event.sender.send('pdf:progress', { sourceId, percent, message })
    })
  })

  // Delete a source: remove db records, chunks, and the stored file from disk
  ipcMain.handle('pdf:delete', async (_, sourceId, filePath) => {
    db.run('DELETE FROM pdf_chunks WHERE source_id=?', [sourceId])
    db.run('DELETE FROM pdf_sources WHERE id=?', [sourceId])
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return { success: true }
  })

}
