const { LocalIndex } = require('vectra')
const path           = require('path')

class EmbeddingService {
  constructor(db, userDataPath) {
    this.db         = db
    this.ollamaUrl  = 'http://localhost:11434'
    this.embedModel = 'nomic-embed-text'
    this.indexPath  = path.join(userDataPath, 'vectra')
    this.index      = new LocalIndex(this.indexPath)
  }

  // Ensure the vectra index exists on disk before any operation
  async ensureIndex() {
    if (!await this.index.isIndexCreated()) {
      await this.index.createIndex()
    }
  }

  // Generate an embedding vector for a single text string via Ollama
  async embed(text) {
    const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: this.embedModel, prompt: text }),
    })
    if (!response.ok) {
      throw new Error(`Ollama embed failed: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error('Ollama returned no embedding vector')
    }
    return data.embedding   // float[]
  }

  // Embed all un-embedded chunks for a given source, storing vectors in vectra
  async embedSource(sourceId, onProgress) {
    await this.ensureIndex()

    const chunks = this.db.all(
      'SELECT * FROM pdf_chunks WHERE source_id=? AND embedded=0',
      [sourceId]
    )
    if (!chunks.length) return { embedded: 0 }

    let done = 0
    for (const chunk of chunks) {
      const vector = await this.embed(chunk.text)

      await this.index.insertItem({
        vector,
        metadata: {
          chunk_id:    chunk.id,
          source_id:   chunk.source_id,
          page_number: chunk.page_number,
          text:        chunk.text,
        },
      })

      this.db.run(
        'UPDATE pdf_chunks SET embedded=1, embedding_model=? WHERE id=?',
        [this.embedModel, chunk.id]
      )

      done++
      onProgress?.(
        Math.round((done / chunks.length) * 100),
        `Embedding chunk ${done} of ${chunks.length}…`
      )
    }

    // Mark the source as fully embedded
    this.db.run(
      "UPDATE pdf_sources SET status='embedded' WHERE id=?",
      [sourceId]
    )

    return { embedded: done }
  }

  // Semantic search: find the top-k most similar chunks to a query string
  async search(queryText, topK = 5) {
    await this.ensureIndex()
    const queryVector = await this.embed(queryText)
    const results     = await this.index.queryItems(queryVector, topK)
    return results.map(r => ({
      score:       r.score,
      chunk_id:    r.item.metadata.chunk_id,
      source_id:   r.item.metadata.source_id,
      page_number: r.item.metadata.page_number,
      text:        r.item.metadata.text,
    }))
  }

  // Delete all vectra index entries belonging to a specific source
  async deleteSource(sourceId) {
    await this.ensureIndex()
    const items    = await this.index.listItems()
    const toDelete = items.filter(i => i.metadata.source_id === sourceId)
    for (const item of toDelete) {
      await this.index.deleteItem(item.id)
    }
  }

  // Check whether Ollama is running and nomic-embed-text is available
  async getStatus() {
    try {
      const res  = await fetch(`${this.ollamaUrl}/api/tags`)
      if (!res.ok) return { available: false, hasModel: false }
      const data = await res.json()
      const hasModel = Array.isArray(data.models) &&
        data.models.some(m => m.name.includes('nomic-embed-text'))
      return { available: true, hasModel }
    } catch {
      return { available: false, hasModel: false }
    }
  }
}

module.exports = EmbeddingService
