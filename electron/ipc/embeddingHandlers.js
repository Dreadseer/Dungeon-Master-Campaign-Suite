const { registerHandler } = require('./registerHandler')

module.exports = (embeddingService) => {

  // Embed all un-embedded chunks for a source; streams progress events back
  registerHandler('embed:source', async (event, sourceId) => {
    return embeddingService.embedSource(sourceId, (percent, message) => {
      event.sender.send('embed:progress', { sourceId, percent, message })
    })
  })

  // Scan a source book's chunks for item names matching a content type
  registerHandler('embed:scanSource', async (_, sourceId, contentType) => {
    return embeddingService.scanSource(sourceId, contentType)
  })

  // Semantic similarity search across all indexed chunks
  registerHandler('embed:search', async (_, queryText, topK, itemName, sourceId) => {
    return embeddingService.search(queryText, topK ?? 5, itemName ?? null, sourceId ?? null)
  })

  // Remove all vectra index entries for a source (called before delete or re-ingest)
  registerHandler('embed:deleteSource', async (_, sourceId) => {
    return embeddingService.deleteSource(sourceId)
  })

  // Check Ollama availability and whether nomic-embed-text model is pulled
  registerHandler('embed:getStatus', async () => {
    return embeddingService.getStatus()
  })

}
