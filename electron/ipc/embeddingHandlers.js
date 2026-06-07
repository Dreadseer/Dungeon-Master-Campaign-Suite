const { ipcMain } = require('electron')

module.exports = (embeddingService) => {

  // Embed all un-embedded chunks for a source; streams progress events back
  ipcMain.handle('embed:source', async (event, sourceId) => {
    return embeddingService.embedSource(sourceId, (percent, message) => {
      event.sender.send('embed:progress', { sourceId, percent, message })
    })
  })

  // Semantic similarity search across all indexed chunks
  ipcMain.handle('embed:search', async (_, queryText, topK) => {
    return embeddingService.search(queryText, topK ?? 5)
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
