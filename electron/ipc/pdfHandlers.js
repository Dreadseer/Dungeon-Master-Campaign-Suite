const { ipcMain, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')

module.exports = (pdfService, db, pdfExtractionService) => {

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

  // ── Extraction handlers — Phase 7 (Compendium Import) ───────────────────

  // Detect content type for an arbitrary text string (no DB lookup needed)
  ipcMain.handle('pdf:detectChunkType', (_, text) => {
    return { type: pdfExtractionService.detectType(text) }
  })

  // Extract structured fields from a single chunk by DB id
  ipcMain.handle('pdf:extractChunk', async (_, chunkId, useAI) => {
    const chunk = db.get(
      `SELECT pc.id, pc.source_id, pc.chunk_index, pc.page_number, pc.text, ps.filename
       FROM pdf_chunks pc
       JOIN pdf_sources ps ON pc.source_id = ps.id
       WHERE pc.id = ?`,
      [chunkId]
    )
    if (!chunk) return { error: `Chunk ${chunkId} not found` }
    return pdfExtractionService.processChunk(chunk, chunk.filename, useAI ?? false)
  })

  // Extract structured fields from multiple chunks (batch)
  ipcMain.handle('pdf:extractChunks', async (_, chunkIds, useAI) => {
    const results = []
    for (const chunkId of (chunkIds ?? [])) {
      const chunk = db.get(
        `SELECT pc.id, pc.source_id, pc.chunk_index, pc.page_number, pc.text, ps.filename
         FROM pdf_chunks pc
         JOIN pdf_sources ps ON pc.source_id = ps.id
         WHERE pc.id = ?`,
        [chunkId]
      )
      if (!chunk) {
        results.push({ error: `Chunk ${chunkId} not found`, _chunk_id: chunkId })
        continue
      }
      const extracted = await pdfExtractionService.processChunk(chunk, chunk.filename, useAI ?? false)
      results.push(extracted)
    }
    return results
  })

  // Semantic (vector) search filtered to a campaign's embedded sources
  ipcMain.handle('pdf:semanticSearch', async (_, campaignId, query, topK) => {
    return pdfExtractionService.semanticSearch(query, campaignId, topK ?? 10)
  })

}
