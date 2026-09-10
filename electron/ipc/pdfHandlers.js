const { dialog } = require('electron')
const { registerHandler } = require('./registerHandler')
const path = require('path')
const fs   = require('fs')

module.exports = (pdfService, db, pdfExtractionService, embeddingService) => {

  // Open OS file picker — returns array of selected file paths (or [] if cancelled)
  registerHandler('pdf:openDialog', async () => {
    const result = await dialog.showOpenDialog({
      title:      'Select Source Book PDF',
      filters:    [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  // Full ingest pipeline: copy PDF to storage, create source record, chunk + store
  // Returns { success, chunkCount, sourceId } so the renderer can chain embed:source
  registerHandler('pdf:ingest', async (event, campaignId, filePath) => {
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
  registerHandler('pdf:reIngest', async (event, sourceId) => {
    return pdfService.reIngest(sourceId, (percent, message) => {
      event.sender.send('pdf:progress', { sourceId, percent, message })
    })
  })

  // Delete a source: remove its vectors, db records, chunks, and stored file.
  //
  // The vectra index is a separate store keyed by chunk id, so dropping the
  // chunk rows without dropping the vectors left orphaned embeddings that RAG
  // would still retrieve and cite — answers quoting a book the DM had deleted.
  // It runs first, while the chunk rows it keys off still exist.
  //
  // Every filesystem/index step is best-effort: none of them may block the
  // database delete, or the source becomes undeletable.
  registerHandler('pdf:delete', async (_, sourceId, filePath) => {
    try {
      await embeddingService.deleteSource(sourceId)
    } catch (err) {
      console.error(`[pdf:delete] could not drop vectors for source ${sourceId}:`, err.message)
    }

    db.run('DELETE FROM pdf_chunks WHERE source_id=?', [sourceId])
    db.run('DELETE FROM pdf_sources WHERE id=?', [sourceId])

    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch (err) {
      console.error(`[pdf:delete] could not remove file ${filePath}:`, err.message)
    }

    return { success: true }
  })

  // ── Extraction handlers — Phase 7 (Compendium Import) ───────────────────

  // Detect content type for an arbitrary text string (no DB lookup needed)
  registerHandler('pdf:detectChunkType', (_, text) => {
    return { type: pdfExtractionService.detectType(text) }
  })

  // Extract structured fields from a single chunk by DB id
  registerHandler('pdf:extractChunk', async (_, chunkId, useAI) => {
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
  registerHandler('pdf:extractChunks', async (_, chunkIds, useAI) => {
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
  registerHandler('pdf:semanticSearch', async (_, campaignId, query, topK) => {
    return pdfExtractionService.semanticSearch(query, campaignId, topK ?? 10)
  })

}
