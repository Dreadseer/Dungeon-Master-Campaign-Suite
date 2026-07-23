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
      const hits = results.map(r => ({
        score:       r.score,
        chunk_id:    r.item.metadata.chunk_id,
        source_id:   r.item.metadata.source_id,
        page_number: r.item.metadata.page_number,
        text:        r.item.metadata.text,
      }))
      return this._expandContiguous(hits)
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

    return this._expandContiguous(ranked)
  }

  // A multi-page entry (e.g. a subclass with several features, or a monster
  // with many actions) is split across several sequential chunks in
  // pdf_chunks. Raw top-K search only returns chunks that are individually
  // similar to the query — a feature's opening sentence scores well (it
  // repeats keywords from the query), but the plain-prose continuation right
  // after it often doesn't and gets left out of the top-K, silently dropping
  // or truncating features.
  //
  // Rather than walking blindly outward from a single anchor (which reaches
  // just as far backward into the PREVIOUS entry as it does forward into the
  // one we want, wasting the downstream character budget), we use the fact
  // that several of the top-K hits already land at different points inside the
  // target entry. We take the span those hits cover — from the earliest to the
  // latest chunk near the anchor — and simply fill the gaps between them, plus
  // a small margin (a little before to catch the heading, a little after to
  // catch a trailing feature whose chunk didn't match the query, e.g. a
  // subclass's capstone). This keeps the whole entry contiguous without
  // dragging in the neighbouring one.
  _expandContiguous(hits) {
    if (!hits.length) return hits

    const anchor = hits.reduce((best, h) => (h.score > best.score ? h : best), hits[0])
    const srcId  = anchor.source_id

    // Map each same-source hit to its chunk_index (vector hits don't carry it).
    const sameSrc = hits.filter(h => h.source_id === srcId)
    const idxRows = this.db.all(
      `SELECT id, chunk_index FROM pdf_chunks
        WHERE source_id = ? AND id IN (${sameSrc.map(() => '?').join(',')})`,
      [srcId, ...sameSrc.map(h => h.chunk_id)]
    )
    const idxById   = new Map(idxRows.map(r => [r.id, r.chunk_index]))
    const anchorIdx = idxById.get(anchor.chunk_id)
    if (anchorIdx == null) return hits

    // Only consider hits in the anchor's neighbourhood so a stray far-away
    // match in the same book can't blow the span wide open.
    const NEIGHBOUR = 12
    const nearIdx = sameSrc
      .map(h => idxById.get(h.chunk_id))
      .filter(ci => ci != null && Math.abs(ci - anchorIdx) <= NEIGHBOUR)

    const BACK_MARGIN = 2   // chunks before the first hit — catches the heading
    const FWD_MARGIN  = 4   // chunks after the last hit — catches a capstone feature
    const lo = Math.min(...nearIdx) - BACK_MARGIN
    const hi = Math.max(...nearIdx) + FWD_MARGIN

    const rows = this.db.all(
      `SELECT id, source_id, chunk_index, page_number, text
         FROM pdf_chunks
        WHERE source_id = ? AND chunk_index BETWEEN ? AND ?
        ORDER BY chunk_index`,
      [srcId, lo, hi]
    )

    const scoreById = new Map(hits.map(h => [h.chunk_id, h.score]))
    const anchorPage = anchor.page_number
    const cluster = []
    for (const r of rows) {
      // Drop chunks whose page drifts too far from the anchor — a guard against
      // the margins spilling into an adjacent entry on the next/previous page.
      if (anchorPage != null && r.page_number != null &&
          Math.abs(r.page_number - anchorPage) > 3) continue
      cluster.push({
        score:       scoreById.get(r.id) ?? anchor.score * 0.8,
        chunk_id:    r.id,
        source_id:   r.source_id,
        page_number: r.page_number,
        text:        r.text,
      })
    }

    // Cluster goes first (already in reading order), ahead of any other-source
    // hits, so the contiguous entry can't be crowded out of the downstream
    // character budget by lower-relevance chunks from elsewhere.
    const seen = new Set(cluster.map(c => c.chunk_id))
    const rest = hits.filter(h => !seen.has(h.chunk_id))
    return [...cluster, ...rest]
  }

  // Scan all chunks for a source book and return candidate item names by type.
  // Uses structural patterns in PDF text (ALL_CAPS monster headers, spell level
  // lines, cost patterns for equipment) rather than AI — fast and offline.
  scanSource(sourceId, contentType) {
    const chunks = this.db.all(
      'SELECT text FROM pdf_chunks WHERE source_id = ? ORDER BY chunk_index',
      [sourceId]
    )

    const names = new Set()

    for (const { text } of chunks) {
      const t = text.replace(/\r/g, '')

      if (contentType === 'monster') {
        // Stat block chunks always contain both "Armor Class" and "Hit Points"
        if (!t.includes('Armor Class') || !t.includes('Hit Points')) continue
        const acPos = t.indexOf('Armor Class')
        const before = t.slice(0, acPos)
        const lines = before.split('\n').map(l => l.trim()).filter(Boolean)
        // Walk back from "Armor Class" to find the ALL_CAPS name line
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i]
          if (line.length >= 3 && line.length <= 60 &&
              /^[A-Z][A-Z\s,'\-\/]{2,}$/.test(line)) {
            names.add(this._toTitleCase(line))
            break
          }
        }
      }

      else if (contentType === 'spell') {
        // Spell entry chunks always have "Casting Time" and "Duration"
        if (!t.includes('Casting Time') || !t.includes('Duration')) continue
        const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
        for (let i = 0; i < lines.length - 1; i++) {
          const next = lines[i + 1]
          if (/^\d+(?:st|nd|rd|th)-level\s+\w+/i.test(next) ||
              /^\w[\w\s]+ cantrip/i.test(next)) {
            const name = lines[i]
            if (/^[A-Z][a-zA-Z\s'\-,]{1,49}$/.test(name) &&
                name.split(' ').length <= 6) {
              names.add(name)
            }
          }
        }
      }

      else if (contentType === 'equipment') {
        // Equipment entries reference a gold/silver/copper piece price
        if (!/\d+\s*(?:gp|sp|cp)\b/i.test(t)) continue
        const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
        if (!lines.length) continue
        // ALL_CAPS header (some books format equipment like monsters)
        const capsLine = lines.find(l =>
          l.length >= 3 && l.length <= 50 && /^[A-Z][A-Z\s,'\-]{2,}$/.test(l)
        )
        if (capsLine) { names.add(this._toTitleCase(capsLine)); continue }
        // Title Case first line, excluding generic section headings
        const first = lines[0]
        if (/^[A-Z][a-zA-Z\s'\-,+]{1,49}$/.test(first) &&
            !/^(?:Chapter|Table|Appendix|Equipment|Weapons|Armor|Adventuring)\b/.test(first)) {
          names.add(first)
        }
      }

      else if (contentType === 'subclass') {
        if (!/\bsubclass\b|\barchetype\b/i.test(t)) continue
        const lines = t.split('\n').map(l => l.trim()).filter(Boolean)
        for (const line of lines) {
          if (/^[A-Z][a-zA-Z\s'\-]{3,49}$/.test(line) &&
              line.split(' ').length >= 2 &&
              line.split(' ').length <= 5 &&
              !/\b(?:The|Your|You|They|When|While|This|These|That|At|If|In|On)\b/.test(line)) {
            names.add(line)
            break
          }
        }
      }
    }

    return [...names].sort()
  }

  _toTitleCase(str) {
    const LOWER = new Set(['of','the','a','an','and','or','in','to','for','with','by','at','from'])
    return str.toLowerCase().split(' ').map((word, i) =>
      i === 0 || !LOWER.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    ).join(' ')
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
