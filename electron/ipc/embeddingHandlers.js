const { ipcMain } = require('electron')

module.exports = (embeddingService) => {

  // Embed all un-embedded chunks for a source; streams progress events back
  ipcMain.handle('embed:source', async (event, sourceId) => {
    return embeddingService.embedSource(sourceId, (percent, message) => {
      event.sender.send('embed:progress', { sourceId, percent, message })
    })
  })

  // Scan a source book's chunks for item names matching a content type
  ipcMain.handle('embed:scanSource', async (_, sourceId, contentType) => {
    return embeddingService.scanSource(sourceId, contentType)
  })

  // Semantic similarity search across all indexed chunks
  ipcMain.handle('embed:search', async (_, queryText, topK, itemName, sourceId) => {
    return embeddingService.search(queryText, topK ?? 5, itemName ?? null, sourceId ?? null)
  })

  // Remove all vectra index entries for a source (called before delete or re-ingest)
  ipcMain.handle('embed:deleteSource', async (_, sourceId) => {
    return embeddingService.deleteSource(sourceId)
  })

  // Check Ollama availability and whether nomic-embed-text model is pulled
  ipcMain.handle('embed:getStatus', async () => {
    return embeddingService.getStatus()
  })

}
