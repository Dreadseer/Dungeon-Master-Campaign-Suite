const pdfParse = require('pdf-parse')
const fs       = require('fs')
const path     = require('path')

class PdfIngestionService {
  constructor(db, userDataPath) {
    this.db           = db
    this.pdfStorePath = path.join(userDataPath, 'pdfs')
    if (!fs.existsSync(this.pdfStorePath)) {
      fs.mkdirSync(this.pdfStorePath, { recursive: true })
    }
  }

  // Copy PDF into managed storage, return stored path
  async copyPdf(sourcePath, filename) {
    const dest = path.join(this.pdfStorePath, `${Date.now()}_${filename}`)
    fs.copyFileSync(sourcePath, dest)
    return dest
  }

  // Extract raw text from a PDF — returns array of { page, text } and totalPages
  async extractPages(filePath) {
    const buffer = fs.readFileSync(filePath)
    const data   = await pdfParse(buffer)
    // Split full text by form-feed characters (PDF page breaks)
    const pages  = data.text
      .split(/\f/)
      .map((p, i) => ({ page: i + 1, text: p.trim() }))
      .filter(p => p.text.length > 0)
    return { pages, totalPages: data.numpages }
  }

  // Chunk page text into overlapping segments for RAG
  chunkPages(pages, options = {}) {
    const {
      chunkSize    = 400,  // target tokens (~4 chars = 1 token)
      overlapSize  = 80,   // overlap tokens between chunks
      minChunkSize = 50,   // skip chunks shorter than this
    } = options

    const chunkChars   = chunkSize   * 4
    const overlapChars = overlapSize * 4
    const chunks       = []

    for (const { page, text } of pages) {
      let start = 0
      while (start < text.length) {
        const end     = Math.min(start + chunkChars, text.length)
        const segment = text.slice(start, end).trim()
        if (segment.length >= minChunkSize * 4) {
          chunks.push({ page, text: segment })
        }
        if (end >= text.length) break
        start = end - overlapChars
      }
    }
    return chunks
  }

  // Full ingestion pipeline: extract → chunk → store in pdf_chunks
  async ingest(sourceId, filePath, onProgress) {
    try {
      onProgress?.(10, 'Extracting text from PDF...')
      const { pages, totalPages } = await this.extractPages(filePath)
      onProgress?.(30, `Extracted ${totalPages} pages. Splitting into chunks...`)

      const chunks = this.chunkPages(pages)
      onProgress?.(50, `Created ${chunks.length} text chunks. Storing...`)

      this.db.transaction(() => {
        chunks.forEach((chunk, i) => {
          this.db.run(
            'INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text) VALUES (?,?,?,?)',
            [sourceId, i, chunk.page, chunk.text]
          )
        })
      })
      onProgress?.(80, `Stored ${chunks.length} chunks. Updating source record...`)

      this.db.run(
        "UPDATE pdf_sources SET status='indexed', chunk_count=?, indexed_at=datetime('now') WHERE id=?",
        [chunks.length, sourceId]
      )
      onProgress?.(100, 'Ingestion complete.')
      return { success: true, chunkCount: chunks.length }
    } catch (err) {
      this.db.run("UPDATE pdf_sources SET status='failed' WHERE id=?", [sourceId])
      throw err
    }
  }

  // Re-ingest: clear existing chunks/vectors, then run fresh ingestion
  async reIngest(sourceId, onProgress) {
    this.db.run('DELETE FROM pdf_chunks WHERE source_id=?', [sourceId])
    this.db.run("UPDATE pdf_sources SET status='pending', chunk_count=0 WHERE id=?", [sourceId])
    // Clear any existing vectra vectors for this source (if embeddingService is ready)
    if (global.embeddingService) {
      await global.embeddingService.deleteSource(sourceId)
    }
    const source = this.db.get('SELECT * FROM pdf_sources WHERE id=?', [sourceId])
    return this.ingest(sourceId, source.file_path, onProgress)
  }
}

module.exports = PdfIngestionService
