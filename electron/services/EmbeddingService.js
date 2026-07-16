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

  // Generate an embedding vector for a single text string via Ollama.
  // Tries the new /api/embed endpoint (Ollama ≥ 0.1.26) first; falls back
  // to the legacy /api/embeddings endpoint for older installs.
  async embed(text) {
    // New API (Ollama ≥ 0.1.26): POST /api/embed with `input`
    let response = await fetch(`${this.ollamaUrl}/api/embed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: this.embedModel, input: text, options: { num_gpu: 0 } }),
    })

    if (response.ok) {
      const data = await response.json()
      // New API returns { embeddings: [float[]] }
      const vec = data.embeddings?.[0] ?? data.embedding
      if (!Array.isArray(vec)) throw new Error('Ollama returned no embedding vector')
      return vec
    }

    // If new endpoint fails, try legacy /api/embeddings with `prompt`
    if (response.status === 404) {
      response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: this.embedModel, prompt: text, options: { num_gpu: 0 } }),
      })
      if (response.ok) {
        const data = await response.json()
        if (!data.embedding || !Array.isArray(data.embedding)) {
          throw new Error('Ollama returned no embedding vector')
        }
        return data.embedding
      }
    }

    // Both endpoints failed — extract error body for a useful message
    let detail = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (body.error) detail = body.error
    } catch { /* ignore parse failure */ }

    if (detail.toLowerCase().includes('model') && detail.toLowerCase().includes('not found')) {
      throw new Error(
        `Embedding model "${this.embedModel}" is not installed in Ollama.\n` +
        `Run: ollama pull ${this.embedModel}`
      )
    }
    throw new Error(`Ollama embed failed: ${detail}`)
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

  // Semantic search: find the top-k most similar chunks to a query string.
  // Falls back to SQLite full-text search when the vectra index is empty
  // (e.g. books were processed before CPU-only mode was enabled).
  async search(queryText, topK = 5, itemName = null, sourceId = null) {
    await this.ensureIndex()
    const queryVector = await this.embed(queryText)
    const results     = await this.index.queryItems(queryVector, topK)

    if (results.length > 0) {
      return results.map(r => ({
        score:       r.score,
        chunk_id:    r.item.metadata.chunk_id,
        source_id:   r.item.metadata.source_id,
        page_number: r.item.metadata.page_number,
        text:        r.item.metadata.text,
      }))
    }

    // Vectra index empty — fall back to SQLite keyword search.
    //
    // We use an AND-combination of individual keywords rather than a consecutive
    // phrase match. This is robust against newlines and formatting in PDF text
    // (e.g. "AMULET\nOF\nTHE\nDEVOUT" fails phrase matching but passes AND
    // matching for ["Amulet", "Devout"]).
    //
    // Use itemName (the user's typed name) when available, falling back to the
    // first few words of queryText (which strips the search-hint suffix).
    const STOP = new Set(['of','the','a','an','and','or','in','to','for','with','by','at','from','s'])
    const nameSource = itemName ?? queryText.split(/\s+/).slice(0, 5).join(' ')
    const keywords   = nameSource.trim().split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w.toLowerCase()))

    if (!keywords.length) return []

    // Build: WHERE [source_id=?] AND norm LIKE '%word1%' AND norm LIKE '%word2%' ...
    const norm       = `REPLACE(REPLACE(REPLACE(text, char(10), ' '), char(13), ' '), '  ', ' ')`
    const srcClause  = sourceId ? `source_id = ? AND ` : ''
    const srcParams  = sourceId ? [sourceId] : []
    const andClauses = keywords.map(() => `${norm} LIKE ?`).join(' AND ')

    let rows = this.db.all(
      `SELECT id, source_id, chunk_index, page_number, text, ${norm} AS norm
         FROM pdf_chunks
        WHERE ${srcClause}${andClauses}
        LIMIT ?`,
      [...srcParams, ...keywords.map(k => `%${k}%`), topK * 4]
    )

    // If all-keywords match found nothing, retry with just the first keyword
    if (!rows.length) {
      rows = this.db.all(
        `SELECT id, source_id, chunk_index, page_number, text, ${norm} AS norm
           FROM pdf_chunks
          WHERE ${srcClause}${norm} LIKE ?
          LIMIT ?`,
        [...srcParams, `%${keywords[0]}%`, topK * 4]
      )
    }

    if (!rows.length) return []

    // Score: each keyword occurrence counts, title-position bonus for entries
    // where the name appears in the first 120 chars of the chunk.
    const scored = rows.map(r => {
      const normText = (r.norm || r.text).toLowerCase()
      const count    = keywords.reduce((n, k) => n + this._countOccurrences(normText, k.toLowerCase()), 0)
      const firstPos = normText.indexOf(keywords[0].toLowerCase())
      const titleBonus = firstPos >= 0 && firstPos < 120 ? 2 : 1
      return { r, _score: count * titleBonus }
    })

    const maxScore = Math.max(...scored.map(s => s._score))
    const ranked   = scored
      .map(({ r, _score }) => ({
        score:       maxScore > 0 ? _score / maxScore : 0.5,
        chunk_id:    r.id,
        source_id:   r.source_id,
        chunk_index: r.chunk_index,
        page_number: r.page_number,
        text:        r.text,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.ceil(topK / 2))

    // Fetch the immediately next chunk from the same source if it's on the same
    // or adjacent page — captures multi-paragraph items without bleeding into
    // the next entry.
    const topSeed = ranked[0]
    const seenIds = new Set(ranked.map(c => c.chunk_id))
    const following = []

    if (topSeed) {
      const nextChunk = this.db.get(
        `SELECT id, source_id, chunk_index, page_number, text
           FROM pdf_chunks
          WHERE source_id = ? AND id = ?`,
        [topSeed.source_id, topSeed.chunk_id + 1]
      )
      if (nextChunk && !seenIds.has(nextChunk.id) &&
          nextChunk.page_number <= topSeed.page_number + 1) {
        seenIds.add(nextChunk.id)
        following.push({
          score:       topSeed.score * 0.9,
          chunk_id:    nextChunk.id,
          source_id:   nextChunk.source_id,
          chunk_index: nextChunk.chunk_index,
          page_number: nextChunk.page_number,
          text:        nextChunk.text,
        })
      }
    }

    return [...ranked, ...following].slice(0, topK)
  }

  _countOccurrences(text, phrase) {
    const haystack = text.toLowerCase()
    const needle   = phrase.toLowerCase()
    let count = 0, pos = 0
    while ((pos = haystack.indexOf(needle, pos)) !== -1) { count++; pos++ }
    return count
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
        data.models.some(m => m.name.startsWith('nomic-embed-text'))
      return { available: true, hasModel }
    } catch {
      return { available: false, hasModel: false }
    }
  }
}

module.exports = EmbeddingService
