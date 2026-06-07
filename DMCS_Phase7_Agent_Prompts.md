# ⚔ DMCS — Phase 7 Agent Prompts
## AI Layer — Claude Code Edition

> **Save this file as:** `DMCS_Phase7_Agent_Prompts.md`
> Place it in the root of your project folder alongside the spec and rules documents.

**Modules covered:** PDF Ingestion · Embeddings · RAG Query Engine · Streaming Assistant · Source Attribution

---

## Prompt Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | PDF Ingestion Pipeline | pdf-parse extraction, ~400-token overlapping chunks, pdf_chunks SQLite table, progress IPC | 2 – 3 hrs |
| 02 | Embedding & Vector Index | vectra LocalIndex, nomic-embed-text via Ollama, embed:source, semantic search | 2 – 3 hrs |
| 03 | RAG Query Engine | RAGService with context assembly, source attribution, hybrid keyword fallback | 2 – 3 hrs |
| 04 | AI Assistant Panel | Streaming Claude/Ollama, campaign context injection, multi-turn chat, Rules Q&A mode | 2 – 3 hrs |
| 05 | Polish, Source Mgmt & Audit | Re-indexing, chunk preview, query expansion, AI usage log, Settings panel, full audit | 1 – 2 hrs |

*Total estimated time: 9 – 14 hours*

> **⚔ RULE:** Before starting any prompt, open your Claude Code session with the Master Session Opener from `DMCS_Claude_Code_Rules.md`. Update the filename to `DMCS_Phase7_Agent_Prompts.md`.

---

## Agent Prompt 01 — PDF Ingestion Pipeline
### *Upload PDFs, extract text with pdf-parse, chunk into overlapping segments, store in SQLite*

---

### Context

Phase 6 is complete. The Mind Map visualizes campaign relationships with React Flow, Dagre layout, filters, position persistence, AI insights, and PNG export. This is Prompt 01 of 05 for Phase 7 — the AI Layer. This is the most technically complex phase in the project. You are building the RAG (Retrieval-Augmented Generation) pipeline that lets the DM ask questions and get answers grounded in their actual source books. This prompt handles the first stage: uploading PDF source books, extracting text, and splitting it into searchable chunks stored in SQLite.

---

### Your Task

#### ▸ Step 1 — Install PDF processing packages

```bash
npm install pdf-parse
# @anthropic-ai/sdk is already installed from Phase 1 — verify only
```

> **⚠ WARNING:** `pdf-parse` runs in the Node.js main process only — never import it in any `src/` renderer file. It belongs in `electron/services/` exclusively.

---

#### ▸ Step 2 — Add PDF source IPC handlers

📄 `electron/ipc/dbHandlers.js`

```javascript
// PDF Sources
ipcMain.handle('db:pdf:getAll', (_, campaignId) =>
  db.all('SELECT * FROM pdf_sources WHERE campaign_id = ? ORDER BY indexed_at DESC', [campaignId]))

ipcMain.handle('db:pdf:getById', (_, id) =>
  db.get('SELECT * FROM pdf_sources WHERE id = ?', [id]))

ipcMain.handle('db:pdf:create', (_, data) =>
  db.run(`
    INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count, indexed_at)
    VALUES (?, ?, ?, 'pending', 0, NULL)`,
    [data.campaign_id, data.filename, data.file_path]))

ipcMain.handle('db:pdf:updateStatus', (_, id, status, chunkCount) =>
  db.run(`
    UPDATE pdf_sources SET status=?, chunk_count=?, indexed_at=datetime('now') WHERE id=?`,
    [status, chunkCount ?? 0, id]))

ipcMain.handle('db:pdf:delete', (_, id) => {
  db.run('DELETE FROM pdf_chunks WHERE source_id = ?', [id])
  return db.run('DELETE FROM pdf_sources WHERE id = ?', [id])
})

// PDF Chunks
ipcMain.handle('db:pdf:getChunks', (_, sourceId) =>
  db.all('SELECT id, source_id, chunk_index, page_number, text FROM pdf_chunks WHERE source_id = ? ORDER BY chunk_index ASC', [sourceId]))

ipcMain.handle('db:pdf:insertChunks', (_, sourceId, chunks) => {
  return db.transaction(() => {
    chunks.forEach((chunk, i) => {
      db.run(`
        INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text)
        VALUES (?, ?, ?, ?)`,
        [sourceId, i, chunk.page, chunk.text])
    })
  })()
})

ipcMain.handle('db:pdf:deleteChunks', (_, sourceId) =>
  db.run('DELETE FROM pdf_chunks WHERE source_id = ?', [sourceId]))
```

---

#### ▸ Step 3 — Add pdf_chunks table migration

📄 `electron/database/DatabaseService.js`

Add Migration 003 inside `runMigrations()` after Migration 002:

```javascript
// Migration 003 — PDF chunks table
db.run(`
  CREATE TABLE IF NOT EXISTS pdf_chunks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id    INTEGER NOT NULL REFERENCES pdf_sources(id) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL,
    page_number  INTEGER,
    text         TEXT NOT NULL
  )
`)
```

---

#### ▸ Step 4 — Create the PDF Ingestion Service

📄 `electron/services/PdfIngestionService.js`

```javascript
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

  // Extract raw text from a PDF, returns array of { page, text }
  async extractPages(filePath) {
    const buffer = fs.readFileSync(filePath)
    const data   = await pdfParse(buffer)
    // Split full text by form-feed characters (page breaks)
    const pages  = data.text.split(/\f/).map((p, i) => ({ page: i + 1, text: p.trim() }))
      .filter(p => p.text.length > 0)
    return { pages, totalPages: data.numpages }
  }

  // Chunk text into overlapping segments for RAG
  chunkPages(pages, options = {}) {
    const {
      chunkSize   = 400,  // target tokens (~4 chars = 1 token)
      overlapSize = 80,   // overlap tokens between chunks
      minChunkSize = 50,  // skip chunks shorter than this
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

  // Full ingestion pipeline: extract → chunk → store
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
      })()
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
}

module.exports = PdfIngestionService
```

---

#### ▸ Step 5 — Register PDF IPC handlers

📄 `electron/ipc/pdfHandlers.js`

```javascript
const { ipcMain, dialog } = require('electron')

module.exports = (pdfService, db) => {

  ipcMain.handle('pdf:openDialog', async () => {
    const result = await dialog.showOpenDialog({
      title:      'Select Source Book PDF',
      filters:    [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('pdf:ingest', async (event, campaignId, filePath) => {
    const path     = require('path')
    const filename = path.basename(filePath)

    const storedPath = await pdfService.copyPdf(filePath, filename)

    const result   = db.run(
      "INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count) VALUES (?,?,?,'pending',0)",
      [campaignId, filename, storedPath]
    )
    const sourceId = result.lastInsertRowid

    return pdfService.ingest(sourceId, storedPath, (percent, message) => {
      event.sender.send('pdf:progress', { sourceId, percent, message })
    })
  })

  ipcMain.handle('pdf:delete', async (_, sourceId, filePath) => {
    db.run('DELETE FROM pdf_chunks WHERE source_id=?', [sourceId])
    db.run('DELETE FROM pdf_sources WHERE id=?', [sourceId])
    const fs = require('fs')
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return { success: true }
  })

}
```

---

#### ▸ Step 6 — Initialize PdfIngestionService in main.js

```javascript
const PdfIngestionService = require('./services/PdfIngestionService')
global.pdfService = new PdfIngestionService(global.db, app.getPath('userData'))
require('./ipc/pdfHandlers')(global.pdfService, global.db)
```

---

#### ▸ Step 7 — Expose PDF methods in preload.js

- `pdf.openDialog()` · `pdf.ingest(campaignId, filePath)` · `pdf.delete(sourceId, filePath)`
- `pdf.onProgress(callback)` — `ipcRenderer.on('pdf:progress', callback)`
- `pdf.offProgress(callback)` — `ipcRenderer.removeListener('pdf:progress', callback)`

---

#### ▸ Step 8 — Build the PDF Source Manager UI

📄 `src/components/ai/PdfSourceManager.jsx`

**Source list:**
- Fetch `db.pdf.getAll(activeCampaign.id)` on mount
- Each source card: filename, status badge (Pending=gray, Indexed=green, Failed=red, Embedded=blue), chunk count, indexed date
- "+ Upload PDF" button triggers `pdf.openDialog()` — multiple file selection
- Ingest each file sequentially after selection
- "Delete" button: confirms, calls `pdf.delete(sourceId, file_path)`, refreshes list

**Ingestion progress:**
- Inline progress bar under the source card during ingestion
- Register `pdf.onProgress()` on mount, remove on unmount
- Progress: `{ sourceId, percent, message }` — updates the correct card
- At 100%: show "✓ Indexed [X] chunks", refresh list
- On error: show "✗ Ingestion failed" in red with "Retry" button

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// DevTools console — after uploading a PDF
await window.electronAPI.db.pdf.getAll(1)
// Expected: array with status="indexed", chunk_count > 0

const src    = await window.electronAPI.db.pdf.getAll(1)
const chunks = await window.electronAPI.db.pdf.getChunks(src[0].id)
console.log(chunks.length)          // matches chunk_count on source record
console.log(chunks[0].text)         // readable PDF text, not garbled binary
console.log(chunks[0].page_number)  // >= 1
```

- "+ Upload PDF" opens OS picker with PDF filter, multi-select works
- Progress bar updates with percent and message during ingestion
- Status badge turns green, chunk count shows after completion
- Deleting a source removes the record and stored file

> **⚠ WARNING:** Do NOT move to Prompt 02 until chunks have readable text and accurate page numbers. Open a chunk in DevTools and read it — garbled or empty text means the PDF parser needs adjustment.

---

## Agent Prompt 02 — Embedding & Vector Index
### *Embed chunks with nomic-embed-text via Ollama, store vectors in vectra, build search index*

---

### Context

Prompt 01 is complete. PDFs are parsed into text, chunked at ~400 tokens with 80-token overlap, and stored in `pdf_chunks`. This prompt builds the second stage: generating embedding vectors for each chunk using Ollama's `nomic-embed-text` model and storing them in a local vectra vector index for semantic search.

---

### Your Task

#### ▸ Step 1 — Install vectra

```bash
npm install vectra
```

> **ℹ NOTE:** vectra is a local vector database that stores embeddings as JSON files on disk in `app.getPath("userData")/vectra/`. No external server required. Lightweight and perfect for a few thousand chunks.

---

#### ▸ Step 2 — Add embedding status columns

📄 `electron/database/DatabaseService.js`

Migration 004:

```javascript
// Migration 004 — Embedding tracking
db.run('ALTER TABLE pdf_chunks ADD COLUMN embedded INTEGER DEFAULT 0')
db.run('ALTER TABLE pdf_chunks ADD COLUMN embedding_model TEXT')
```

---

#### ▸ Step 3 — Create the Embedding Service

📄 `electron/services/EmbeddingService.js`

```javascript
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

  async ensureIndex() {
    if (!await this.index.isIndexCreated()) {
      await this.index.createIndex()
    }
  }

  // Generate embedding vector for a single text string
  async embed(text) {
    const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: this.embedModel, prompt: text }),
    })
    if (!response.ok) throw new Error(`Ollama embed failed: ${response.status}`)
    const data = await response.json()
    return data.embedding  // array of floats
  }

  // Embed all unembedded chunks for a source
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
        }
      })

      this.db.run(
        'UPDATE pdf_chunks SET embedded=1, embedding_model=? WHERE id=?',
        [this.embedModel, chunk.id]
      )

      done++
      onProgress?.(Math.round((done / chunks.length) * 100),
        `Embedding chunk ${done} of ${chunks.length}...`)
    }
    return { embedded: done }
  }

  // Semantic search: find top-k most similar chunks
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

  // Delete all vectors for a source from the index
  async deleteSource(sourceId) {
    await this.ensureIndex()
    const items    = await this.index.listItems()
    const toDelete = items.filter(i => i.metadata.source_id === sourceId)
    for (const item of toDelete) {
      await this.index.deleteItem(item.id)
    }
  }
}

module.exports = EmbeddingService
```

---

#### ▸ Step 4 — Register embedding IPC handlers

📄 `electron/ipc/embeddingHandlers.js`

```javascript
const { ipcMain } = require('electron')

module.exports = (embeddingService) => {

  ipcMain.handle('embed:source', async (event, sourceId) => {
    return embeddingService.embedSource(sourceId, (percent, message) => {
      event.sender.send('embed:progress', { sourceId, percent, message })
    })
  })

  ipcMain.handle('embed:search', async (_, queryText, topK) => {
    return embeddingService.search(queryText, topK ?? 5)
  })

  ipcMain.handle('embed:deleteSource', async (_, sourceId) => {
    return embeddingService.deleteSource(sourceId)
  })

  ipcMain.handle('embed:getStatus', async () => {
    try {
      const res     = await fetch('http://localhost:11434/api/tags')
      const data    = await res.json()
      const hasModel = data.models?.some(m => m.name.includes('nomic-embed-text'))
      return { available: true, hasModel }
    } catch {
      return { available: false, hasModel: false }
    }
  })

}
```

---

#### ▸ Step 5 — Initialize EmbeddingService in main.js

```javascript
const EmbeddingService = require('./services/EmbeddingService')
global.embeddingService = new EmbeddingService(global.db, app.getPath('userData'))
require('./ipc/embeddingHandlers')(global.embeddingService)
```

---

#### ▸ Step 6 — Expose embedding methods in preload.js

- `embed.source(sourceId)` · `embed.search(queryText, topK)` · `embed.deleteSource(sourceId)` · `embed.getStatus()`
- `embed.onProgress(callback)` / `embed.offProgress(callback)`

---

#### ▸ Step 7 — Update PdfSourceManager to trigger embedding

📄 `src/components/ai/PdfSourceManager.jsx`

After `pdf.ingest()` resolves successfully:
- Automatically call `embed.source(sourceId)` with its own progress bar labeled "Generating embeddings..."
- Check `embed.getStatus()` on mount — if Ollama is not running, show warning: "Ollama is required for semantic search. Start Ollama and ensure nomic-embed-text is pulled."
- Two-phase progress: Phase 1 "Extracting & chunking" (`pdf:progress`), Phase 2 "Generating embeddings" (`embed:progress`)
- After both phases complete: status = "embedded"

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// After uploading and embedding a PDF:

const chunks = await window.electronAPI.db.pdf.getChunks(1)
console.log(chunks[0].embedded)         // Expected: 1
console.log(chunks[0].embedding_model)  // Expected: "nomic-embed-text"

const results = await window.electronAPI.embed.search("what is a goblin attack bonus", 3)
console.log(results.length)             // Expected: 3
console.log(results[0].score)           // Expected: number between 0 and 1
console.log(results[0].text)            // Expected: relevant goblin combat text
console.log(results[0].page_number)     // Expected: a page number from the PDF
```

- Ollama warning shows if `nomic-embed-text` is not available
- Two-phase progress bar displays correctly
- Source shows chunk count and "embedded" status after both phases
- `embed.search()` returns semantically relevant results

> **⚠ WARNING:** Do NOT move to Prompt 03 until semantic search returns relevant chunks. If results are empty or irrelevant, verify Ollama is running, `nomic-embed-text` is pulled, and the vectra index was created in the correct path.

---

## Agent Prompt 03 — RAG Query Engine
### *Semantic search, context assembly, grounded AI answers with source attribution*

---

### Context

Prompts 01 and 02 are complete. PDFs are ingested, chunked, embedded, and stored in the vectra vector index. This prompt builds the RAG Query Engine — the orchestrator that takes a question, finds relevant chunks, assembles context, and sends both to Claude/Ollama for a grounded answer with source attribution.

---

### Your Task

#### ▸ Step 1 — Create the RAG Service

📄 `electron/services/RAGService.js`

```javascript
class RAGService {
  constructor(db, embeddingService, aiService) {
    this.db               = db
    this.embeddingService = embeddingService
    this.aiService        = aiService
  }

  async query(question, campaignId, options = {}) {
    const { topK = 5, maxContextLen = 3000, includeSource = true } = options

    // Step 1: Semantic search
    const searchResults = await this.embeddingService.search(question, topK)

    // Step 2: Filter to campaign-specific sources only
    const campaignSourceIds = new Set(
      this.db.all('SELECT id FROM pdf_sources WHERE campaign_id=?', [campaignId])
        .map(s => s.id)
    )
    const relevantChunks = searchResults.filter(r => campaignSourceIds.has(r.source_id))

    // Step 3: Resolve source filenames for attribution
    const sourceMap = {}
    relevantChunks.forEach(chunk => {
      if (!sourceMap[chunk.source_id]) {
        const source = this.db.get('SELECT filename FROM pdf_sources WHERE id=?', [chunk.source_id])
        sourceMap[chunk.source_id] = source?.filename ?? 'Unknown Source'
      }
    })

    // Step 4: Assemble context (truncated to maxContextLen)
    let contextText = ''
    const usedChunks = []
    for (const chunk of relevantChunks) {
      const chunkContext = `[Source: ${sourceMap[chunk.source_id]}, p.${chunk.page_number}]\n${chunk.text}\n\n`
      if ((contextText + chunkContext).length > maxContextLen) break
      contextText += chunkContext
      usedChunks.push({
        source:  sourceMap[chunk.source_id],
        page:    chunk.page_number,
        preview: chunk.text.slice(0, 120) + '...',
        score:   chunk.score,
      })
    }

    // Step 5: No sources found — fall back to general knowledge
    if (!contextText.trim()) {
      const answer = await this.aiService.complete(
        'You are a D&D 5e rules expert. Answer the question clearly and concisely.',
        question
      )
      return { answer, sources: [], noSourcesFound: true }
    }

    // Step 6: Build RAG prompt and get grounded answer
    const systemPrompt = [
      'You are a D&D rules expert assistant.',
      'Answer the question using ONLY the provided source material context.',
      'Be specific and cite the source when relevant.',
      'If the context does not contain enough information, say so clearly.',
      'Keep your answer concise and directly useful at the game table.',
    ].join(' ')

    const userMessage = [
      'SOURCE MATERIAL:',
      contextText,
      '---',
      `QUESTION: ${question}`,
    ].join('\n')

    const answer = await this.aiService.complete(systemPrompt, userMessage)

    return { answer, sources: usedChunks, noSourcesFound: false }
  }
}

module.exports = RAGService
```

---

#### ▸ Step 2 — Register RAG IPC handler

📄 `electron/ipc/aiHandlers.js` — append:

```javascript
ipcMain.handle('ai:ragQuery', async (_, question, campaignId, options) => {
  return global.ragService.query(question, campaignId, options)
})
```

---

#### ▸ Step 3 — Initialize RAGService in main.js

```javascript
const RAGService = require('./services/RAGService')
global.ragService = new RAGService(global.db, global.embeddingService, global.aiService)
```

Add to preload.js: `ai.ragQuery(question, campaignId, options)`

---

#### ▸ Step 4 — Build the RAG Query UI

📄 `src/components/ai/RAGQueryPanel.jsx`

**Query input:**
- Large text input: "Ask a rules question..." placeholder
- "Ask" button — disabled if no PDFs are embedded for this campaign
- If no embedded sources: "Upload and index a PDF source book to enable rules Q&A"
- Enter submits, Shift+Enter adds newline

**Answer display:**
- Spinner while RAG query is in progress
- Answer rendered with `AnswerRenderer` (see below)
- "Sources consulted" expandable section below the answer

**Source attribution panel:**
- Each source: 📄 [Filename], p.[page] — [preview 120 chars]
- Relevance score as a small progress bar (score × 100%)
- `noSourcesFound` case: amber warning "No relevant passages found. Answer generated from general AI knowledge."

**Query history:**
- Last 10 queries as clickable chips — click to re-run
- Stored in component state only (cleared on reload)
- "Clear History" button

---

#### ▸ Step 5 — Build the Answer Renderer

📄 `src/components/ai/AnswerRenderer.jsx`

```jsx
export default function AnswerRenderer({ text }) {
  const lines = text.split('\n')
  return (
    <div style={{ fontFamily: 'Arial', fontSize: '14px', color: '#e8e0d0', lineHeight: '1.7' }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return <li key={i} style={{ marginLeft: '1.2rem', marginBottom: '4px' }}>{renderInline(line.slice(2))}</li>
        }
        return <p key={i} style={{ marginBottom: '8px' }}>{renderInline(line)}</p>
      })}
    </div>
  )
}

function renderInline(text) {
  // Bold: **text**
  const parts = text.split(/\*\*(.*?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: '#C9A84C' }}>{part}</strong>
      : part
  )
}
```

---

### Verification Steps

> **✓ VERIFY:**

```javascript
const result = await window.electronAPI.ai.ragQuery(
  "What is the attack bonus of a goblin?",
  1,
  { topK: 3 }
)

console.log(result.answer)         // References goblin attack stats from the PDF
console.log(result.sources)        // Shows filename and page numbers
console.log(result.noSourcesFound) // false if goblin info is in the PDF

// Test with content NOT in the source material
const noSource = await window.electronAPI.ai.ragQuery(
  "What is the weather like in Waterdeep today?",
  1
)
console.log(noSource.noSourcesFound) // true
```

- RAG query returns an answer referencing actual content from the uploaded PDF
- Source attribution shows correct filename and page numbers
- Relevance scores are non-zero, ordered highest to lowest
- `noSourcesFound` answer shows the amber warning in the UI
- Answer renderer correctly renders bold and bullet points
- Query history chips allow re-running previous questions

> **⚠ WARNING:** Do NOT move to Prompt 04 until a RAG query returns a grounded answer with correct source attribution from an actual uploaded PDF. Verify the answer references content that is actually on the cited page.

---

## Agent Prompt 04 — AI Assistant Panel
### *Full DM assistant UI with streaming responses, campaign context injection, and multi-turn chat*

---

### Context

Prompts 01–03 are complete. The RAG pipeline is fully functional. This prompt builds the AI Assistant page — the primary DM-facing AI interface combining rules Q&A (RAG), campaign-aware content generation, and a streaming chat interface.

---

### Your Task

#### ▸ Step 1 — Add streaming support to AIService

📄 `electron/services/AIService.js`

```javascript
// Add to AIService class
async stream(systemPrompt, userMessage, onChunk, onDone) {
  if (this.mode === 'online') {
    const stream = await this.anthropicClient.messages.stream({
      model:      this.anthropicModel,
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    })

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        onChunk(chunk.delta.text)
      }
    }
    const final = await stream.finalMessage()
    onDone(final)

  } else if (this.mode === 'offline-ollama') {
    const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: this.ollamaModel, prompt: userMessage, system: systemPrompt, stream: true }),
    })
    const reader  = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText  = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = decoder.decode(value).split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const data = JSON.parse(line)
          if (data.response) { onChunk(data.response); fullText += data.response }
        } catch {}
      }
    }
    onDone({ content: fullText })

  } else {
    throw new Error('No AI service available')
  }
}
```

---

#### ▸ Step 2 — Add streaming IPC handler

📄 `electron/ipc/aiHandlers.js`

```javascript
// Streaming uses events, not handle/invoke
ipcMain.on('ai:stream:start', async (event, { systemPrompt, userMessage, requestId }) => {
  try {
    await aiService.stream(
      systemPrompt,
      userMessage,
      (chunk) => event.sender.send('ai:stream:chunk',  { requestId, chunk }),
      (final) => event.sender.send('ai:stream:done',   { requestId }),
    )
  } catch (err) {
    event.sender.send('ai:stream:error', { requestId, error: err.message })
  }
})
```

Add to preload.js:
- `ai.streamStart(systemPrompt, userMessage, requestId)` — `ipcRenderer.send('ai:stream:start', ...)`
- `ai.onStreamChunk(callback)` / `ai.onStreamDone(callback)` / `ai.onStreamError(callback)` / `ai.offStream()`

---

#### ▸ Step 3 — Build the AI Assistant page

📄 `src/pages/AIAssistant.jsx`

Two-panel layout:
- **Left (60%):** Chat interface — conversation history + streaming response
- **Right (40%):** Toolbox — quick-action templates + PDF source status

**Chat interface:**
- Scrollable conversation history
- User messages: right-aligned, gold border
- AI responses: left-aligned, dark background
- Streaming: tokens appear progressively with blinking cursor
- Textarea input (auto-growing, max 5 lines) + "Ask" button
- Mode indicator below input: "Claude API" (green) / "Local AI — Ollama" (amber) / "No AI" (red)
- "Clear Conversation" button

**Campaign context injection (invisible to DM):**

```javascript
const buildSystemPrompt = (activeCampaign, characters, npcs, factions) => [
  'You are an AI assistant for a Dungeon Master running a D&D 5e campaign.',
  'Be helpful, creative, and specific. Keep responses concise and immediately usable.',
  '',
  `Campaign: "${activeCampaign.name}" set in ${activeCampaign.world_setting}`,
  characters.length
    ? `Characters: ${characters.map(c => `${c.character_name} (${c.race} ${c.class} Lv.${c.level})`).join(', ')}`
    : '',
  npcs.length
    ? `Notable NPCs: ${npcs.slice(0,5).map(n => n.name).join(', ')}${npcs.length > 5 ? ` and ${npcs.length-5} more` : ''}`
    : '',
  factions.length
    ? `Active factions: ${factions.map(f => f.name).join(', ')}`
    : '',
].filter(Boolean).join('\n')
```

**Multi-turn conversation:**
- History as `[{ role: "user"|"assistant", content: string }]`
- Full history sent on each message (last 20 messages max)

---

#### ▸ Step 4 — Build the AI Toolbox panel

📄 `src/components/ai/AIToolbox.jsx`

**Quick prompts by category (clicking inserts editable text into input):**

- **WORLD BUILDING:** "Describe this location for my players", "Generate a rumor table for [location]", "What might an NPC in [faction] know about [topic]?"
- **COMBAT:** "Create a dramatic encounter intro for this fight", "Describe the aftermath of defeating [monster]", "Generate loot appropriate for CR [X]"
- **STORY:** "What secrets might [NPC] be hiding?", "Create a plot twist involving [faction]", "How might [NPC] react to the party's actions?"
- **RULES:** "Explain how [rule] works", "What happens when [edge case]?", "Compare [ability A] vs [ability B]"

**PDF Sources status:**
- Compact list of indexed PDF sources for this campaign
- "+ Upload PDF" button (links to PDF source manager)
- "Rules Q&A Mode" toggle — when on, every message routes through RAG pipeline first

---

#### ▸ Step 5 — Implement streaming in the chat

```javascript
const handleSend = async () => {
  if (!input.trim() || isStreaming) return

  const userMessage = input.trim()
  setInput('')
  setIsStreaming(true)

  const newHistory = [...history, { role: 'user', content: userMessage }]
  setHistory(newHistory)
  setHistory(h => [...h, { role: 'assistant', content: '' }])  // placeholder

  const requestId = crypto.randomUUID()

  // Route through RAG if Rules Q&A mode is on
  if (ragMode && hasEmbeddedSources) {
    const result = await window.electronAPI.ai.ragQuery(userMessage, activeCampaign.id)
    setHistory(h => {
      const next = [...h]
      next[next.length - 1] = { role: 'assistant', content: result.answer, sources: result.sources }
      return next
    })
    setIsStreaming(false)
    return
  }

  // Regular streaming
  window.electronAPI.ai.onStreamChunk(({ requestId: rid, chunk }) => {
    if (rid !== requestId) return
    setHistory(h => {
      const next = [...h]
      next[next.length - 1] = { ...next[next.length - 1], content: next[next.length - 1].content + chunk }
      return next
    })
  })

  window.electronAPI.ai.onStreamDone(({ requestId: rid }) => {
    if (rid !== requestId) return
    setIsStreaming(false)
    window.electronAPI.ai.offStream()
  })

  window.electronAPI.ai.streamStart(
    buildSystemPrompt(activeCampaign, characters, npcs, factions),
    userMessage,
    requestId
  )
}
```

---

### Verification Steps

> **✓ VERIFY:**

- Navigate to /ai — two-panel layout renders correctly
- Send a message — appears right-aligned in gold, AI response streams token by token
- While streaming: "Ask" button disabled, cursor blinks at end of response
- Mode indicator shows correct AI mode
- Quick prompt cards: clicking inserts editable prompt text into input
- Campaign context: ask "What are my players' character names?" — AI lists them without being told
- Multi-turn: follow up on a previous answer — AI retains context
- "Rules Q&A Mode" on: same question routes through RAG, sources panel appears
- Streaming works offline with Ollama

> **⚠ WARNING:** Do NOT move to Prompt 05 until streaming works (tokens appear progressively), campaign context is injected automatically, and the Rules Q&A mode toggle routes through RAG with source attribution.

---

## Agent Prompt 05 — AI Layer Polish, Source Management & Phase 7 Audit
### *Re-indexing, chunk preview, query expansion, AI usage tracking, and phase completion*

---

### Context

Prompts 01–04 are complete. The full RAG pipeline works end to end — PDFs ingested and embedded, grounded answers with source attribution, streaming AI assistant with campaign context. This final Phase 7 prompt polishes source management, adds re-indexing, refines search quality, adds AI usage tracking, and runs the full audit.

---

### Your Task

#### ▸ Step 1 — Add re-indexing support

📄 `electron/services/PdfIngestionService.js`

```javascript
// Add to PdfIngestionService
async reIngest(sourceId, onProgress) {
  this.db.run('DELETE FROM pdf_chunks WHERE source_id=?', [sourceId])
  this.db.run("UPDATE pdf_sources SET status='pending', chunk_count=0 WHERE id=?", [sourceId])
  await global.embeddingService.deleteSource(sourceId)
  const source = this.db.get('SELECT * FROM pdf_sources WHERE id=?', [sourceId])
  return this.ingest(sourceId, source.file_path, onProgress)
}
```

📄 `electron/ipc/pdfHandlers.js` — add handler:

```javascript
ipcMain.handle('pdf:reIngest', async (event, sourceId) => {
  return pdfService.reIngest(sourceId, (percent, message) => {
    event.sender.send('pdf:progress', { sourceId, percent, message })
  })
})
```

Expose in preload.js: `pdf.reIngest(sourceId)`. Add "Re-index" button on failed source cards.

---

#### ▸ Step 2 — Add chunk preview UI

📄 `src/components/ai/PdfSourceManager.jsx`

Add "Preview Chunks" expandable section to each source card:
- Fetches `db.pdf.getChunks(sourceId)` on expand
- Shows first 5 chunks: Chunk #N, page X, text (truncated to 200 chars)
- "Show all [N] chunks" button reveals all (paginated in groups of 20)
- Lets the DM verify PDF was parsed correctly before asking questions

---

#### ▸ Step 3 — Search quality improvements

📄 `electron/services/RAGService.js`

**Hybrid search fallback** — if semantic scores are low, supplement with keyword search:

```javascript
// In RAGService.query(), after semantic search:
const goodResults = searchResults.filter(r => r.score > 0.5)
if (goodResults.length < 2) {
  const keywords = question.toLowerCase().split(' ').filter(w => w.length > 3)
  const keywordResults = keywords.length > 0
    ? this.db.all(`
        SELECT id as chunk_id, source_id, page_number, text, 0.4 as score
        FROM pdf_chunks
        WHERE source_id IN (SELECT id FROM pdf_sources WHERE campaign_id=?)
        AND (${keywords.map(() => 'text LIKE ?').join(' OR ')})
        LIMIT 5`,
        [campaignId, ...keywords.map(k => `%${k}%`)]
      )
    : []
  const merged = [...goodResults, ...keywordResults]
  const seen   = new Set()
  relevantChunks = merged.filter(r => {
    if (seen.has(r.chunk_id)) return false
    seen.add(r.chunk_id); return true
  }).sort((a, b) => b.score - a.score)
}
```

**Query expansion** — improve recall for common D&D terms:

```javascript
const expandQuery = (q) => {
  const expansions = {
    'attack':      'attack roll hit bonus',
    'damage':      'damage dice roll',
    'spell':       'spell casting spellcasting',
    'save':        'saving throw',
    'dc':          'difficulty class',
    'proficiency': 'proficiency bonus',
    'reaction':    'reaction action bonus action',
  }
  const words = q.toLowerCase().split(' ')
  const extra  = words.flatMap(w => expansions[w] ? [expansions[w]] : [])
  return extra.length > 0 ? `${q} ${extra.join(' ')}` : q
}
// Use expandedQuestion for embedding, display original question in UI
```

---

#### ▸ Step 4 — Add AI usage tracking

📄 `electron/database/DatabaseService.js`

Migration 005:

```javascript
// Migration 005 — AI usage log
db.run(`
  CREATE TABLE IF NOT EXISTS ai_usage_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id  INTEGER REFERENCES campaigns(id),
    mode         TEXT,
    type         TEXT,
    prompt_len   INTEGER,
    response_len INTEGER,
    duration_ms  INTEGER,
    created_at   DATETIME DEFAULT (datetime('now'))
  )
`)
```

Log every AI call in `AIService.complete()` and `RAGService.query()`:

```javascript
const start  = Date.now()
const result = await /* existing completion logic */
global.db.run(
  'INSERT INTO ai_usage_log (campaign_id, mode, type, prompt_len, response_len, duration_ms) VALUES (?,?,?,?,?,?)',
  [campaignId ?? null, this.mode, type, systemPrompt.length + userMessage.length, result.length, Date.now() - start]
)
```

---

#### ▸ Step 5 — Build the AI Settings panel

📄 `src/pages/Settings.jsx` — add new AI section:

**RAG Settings:**
- topK slider (1–10, default 5): "Number of source chunks to retrieve per question"
- Score threshold slider (0.0–1.0, default 0.5): "Minimum relevance score for hybrid fallback"
- Chunk size info (read-only): "Current chunk size: ~400 tokens with 80-token overlap"

**AI Usage Stats:**
- Total queries this session (from `ai_usage_log`)
- Breakdown: Chat queries vs RAG queries
- Average response time
- "Clear Usage Log" button

**Model Configuration:**
- Online model: display `claude-sonnet-4-20250514` (read-only — locked per spec)
- Offline model: text input for Ollama model name (default "llama3"), saved to safeStorage
- Embedding model: text input (default "nomic-embed-text") — note: changing this requires re-embedding all sources

---

#### ▸ Step 6 — Phase 7 audit checklist

**PDF Ingestion:**
- [ ] PDF file picker: PDF filter, multi-select works
- [ ] Progress bar: shows percent and message during extraction and chunking
- [ ] Chunks stored with readable text and accurate page numbers
- [ ] Status progression: pending → indexed → embedded
- [ ] "Re-index" button on failed sources triggers full re-ingestion
- [ ] "Preview Chunks" shows first 5 chunks with page numbers
- [ ] Deleting a source removes DB records, stored file, and vectra index entries

**Embedding & Vector Search:**
- [ ] Ollama warning shown if nomic-embed-text is not available
- [ ] Two-phase progress: chunking then embedding with separate bars
- [ ] All chunks marked `embedded=1` after embedding completes
- [ ] `embed.search()` returns semantically relevant results ordered by score
- [ ] Hybrid fallback: keyword search supplements when semantic scores are low

**RAG Query Engine:**
- [ ] RAG query returns grounded answer referencing actual PDF content
- [ ] Source attribution shows correct filename and page numbers
- [ ] `noSourcesFound` shows amber warning, falls back to general AI knowledge
- [ ] Query expansion improves recall for common D&D terms
- [ ] Context filtered to campaign-specific sources only

**AI Assistant Panel:**
- [ ] Streaming: tokens appear progressively, cursor blinks
- [ ] User messages right-aligned (gold), AI responses left-aligned
- [ ] Campaign context injected automatically (campaign name, party, NPCs, factions)
- [ ] Multi-turn: AI retains context from earlier messages (last 20)
- [ ] "Rules Q&A Mode" routes through RAG with source attribution panel
- [ ] Quick prompt cards insert editable text into input
- [ ] Mode indicator shows current AI connection status
- [ ] Offline streaming with Ollama works
- [ ] No console errors during a full conversation session

---

### Verification Steps

> **✓ VERIFY:** Full Phase 7 end-to-end flow:

- Upload a D&D source PDF → ingestion progress → embedding progress → status "embedded"
- Navigate to /ai → type "How does Counterspell work?" → Rules Q&A Mode on
- Answer references the uploaded PDF, source attribution shows filename and page
- Turn off Rules Q&A Mode → ask "Describe the atmosphere in [campaign location]"
- Response is campaign-aware (mentions world setting without being told)
- Response streams token by token
- Ask follow-up "What might an NPC there say?" — AI has context from previous answer
- Click a quick prompt card → prompt appears in input → DM edits and sends
- Navigate to Settings → AI section shows usage stats from this session

> **✓ VERIFY:** Phase 7 complete when: upload PDF → embed → RAG query with attribution → streaming chat with campaign context → all work end to end.

```bash
git add .
git commit -m "[Phase 7] Complete: AI layer — PDF ingestion, embeddings, RAG pipeline, streaming assistant, source attribution"
git push
```

---

*⚔ End of Phase 7 Agent Prompts ⚔*
