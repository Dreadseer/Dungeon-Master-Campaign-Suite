# ⚔ DMCS — PDF → Compendium Import
## Claude Code Update Prompts 01 – 02

> **Save this file as:** `DMCS_PDF_Compendium_Import.md`

**Updates covered:** Chunk Search · Type Detection · Regex + AI Extraction · Review & Edit · Import to Compendium

---

## Update Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | PDF Chunk Search & Extraction Engine | `PdfExtractionService` with keyword search, type detection, regex + AI extraction, semantic search via vectra | 2 – 3 hrs |
| 02 | PDF Import UI in Compendium | "Import from PDF" button on Custom tab, 3-view import workflow, raw chunk + editable fields + confirm, PDF badge | 2 – 3 hrs |

*Total estimated time: 4 – 6 hours*

> **⚔ PREREQUISITE:** These prompts require Phase 7 (AI Layer) to be complete. At least one PDF must be uploaded, ingested, and embedded (status = "embedded") before this feature can be tested. The `pdf_chunks` table must exist and contain data.

---

## Update Prompt 01 — PDF Chunk Search & Extraction Engine
### *Search indexed PDF chunks, extract item/spell structure from raw text, AI-assisted parsing*

---

### Context

PDF source books have already been ingested, chunked, and embedded in Phase 7. Each chunk is a ~400-token segment stored in the `pdf_chunks` table with `source_id`, `chunk_index`, `page_number`, and `text` columns. The vectra vector index makes these chunks semantically searchable. This prompt builds a server-side extraction engine that searches those existing chunks by keyword or semantic query, identifies chunks that describe items or spells, and parses them into structured compendium-compatible objects — ready for the DM to review and import.

**The extraction engine has two modes:**
- **Regex mode** — fast, no AI required, pattern-matches field labels like "Casting Time:", "Range:", "Rarity:" directly in the raw text
- **AI-assisted mode** — calls the existing `AIService.complete()` with a structured JSON extraction prompt, producing cleaner results for well-formatted sourcebooks

---

### Your Task

#### ▸ Step 1 — Add PDF chunk search IPC handlers

📄 `electron/ipc/dbHandlers.js`

```javascript
// Keyword search across pdf_chunks — no re-embedding needed
ipcMain.handle('db:pdf:searchChunks', (_, campaignId, query, limit) => {
  const q = `%${query}%`
  return db.all(`
    SELECT
      pc.id, pc.source_id, pc.chunk_index, pc.page_number,
      pc.text, ps.filename
    FROM pdf_chunks pc
    JOIN pdf_sources ps ON pc.source_id = ps.id
    WHERE ps.campaign_id = ?
      AND ps.status IN ('indexed', 'embedded')
      AND pc.text LIKE ?
    ORDER BY pc.source_id ASC, pc.chunk_index ASC
    LIMIT ?`,
    [campaignId, q, limit ?? 30]
  )
})

// Get all chunks for a specific source (for browsing)
ipcMain.handle('db:pdf:getChunksBySource', (_, sourceId, offset, limit) =>
  db.all(
    'SELECT id, source_id, chunk_index, page_number, text FROM pdf_chunks WHERE source_id=? ORDER BY chunk_index ASC LIMIT ? OFFSET ?',
    [sourceId, limit ?? 50, offset ?? 0]
  )
)

// Get adjacent chunks for context (chunks surrounding a given chunk_index)
ipcMain.handle('db:pdf:getChunkContext', (_, sourceId, chunkIndex, contextRadius) => {
  const radius = contextRadius ?? 1
  return db.all(
    'SELECT id, chunk_index, page_number, text FROM pdf_chunks WHERE source_id=? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index ASC',
    [sourceId, chunkIndex - radius, chunkIndex + radius]
  )
})
```

Add to preload.js:
- `db.pdf.searchChunks(campaignId, query, limit)`
- `db.pdf.getChunksBySource(sourceId, offset, limit)`
- `db.pdf.getChunkContext(sourceId, chunkIndex, contextRadius)`

---

#### ▸ Step 2 — Create the PDF Extraction Service

📄 `electron/services/PdfExtractionService.js`

```javascript
class PdfExtractionService {
  constructor(db, aiService, embeddingService) {
    this.db               = db
    this.aiService        = aiService
    this.embeddingService = embeddingService
  }

  // ── TYPE DETECTION ──────────────────────────────────────────
  detectType(text) {
    // Spell indicators
    if (/\b(\d+)(?:st|nd|rd|th)[-\s]level\s+(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)/i.test(text)) return 'spell'
    if (/\bcantrip\b/i.test(text) && /\bcasting time\b/i.test(text)) return 'spell'
    if (/casting time[:\s]/i.test(text) && /duration[:\s]/i.test(text) && /components[:\s]/i.test(text)) return 'spell'
    // Item indicators
    if (/\b(weapon|armor|potion|ring|rod|wand|staff|wondrous item|attunement)\b/i.test(text)) return 'item'
    if (/\b(common|uncommon|rare|very rare|legendary|artifact)\b/i.test(text) && /\b(item|weapon|armor|magic)\b/i.test(text)) return 'item'
    // Equipment indicators
    if (/\b(damage|hit points|hit dice)\b/i.test(text) && /\b(lb|pound|gp|gold)\b/i.test(text)) return 'equipment'
    return 'unknown'
  }

  // ── REGEX SPELL EXTRACTION ──────────────────────────────────
  extractSpell(text, sourceName, pageNumber) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const spell = {
      name: lines[0] ?? '', level: 0, school: '',
      casting_time: '', range: '', components: '', duration: '', description: '',
      source: sourceName, page: pageNumber, _confidence: 0,
    }

    // Level + school: "2nd-level Evocation" or "Evocation cantrip"
    const levelMatch = text.match(/(?:(\d+)(?:st|nd|rd|th)[-\s]level|cantrip)\s+(\w+)/i)
    if (levelMatch) {
      spell.level  = levelMatch[1] ? parseInt(levelMatch[1]) : 0
      spell.school = levelMatch[2] ?? ''
      spell._confidence += 30
    }

    const ctMatch    = text.match(/casting time[:\s]+([^\n]+)/i)
    const rangeMatch = text.match(/range[:\s]+([^\n]+)/i)
    const compMatch  = text.match(/components[:\s]+([^\n]+)/i)
    const durMatch   = text.match(/duration[:\s]+([^\n]+)/i)

    if (ctMatch)    { spell.casting_time = ctMatch[1].trim();    spell._confidence += 15 }
    if (rangeMatch) { spell.range        = rangeMatch[1].trim(); spell._confidence += 15 }
    if (compMatch)  { spell.components   = compMatch[1].trim();  spell._confidence += 15 }
    if (durMatch)   { spell.duration     = durMatch[1].trim();   spell._confidence += 15 }

    // Description: everything after the last stat line
    const lastStat = Math.max(
      text.toLowerCase().lastIndexOf('duration'),
      text.toLowerCase().lastIndexOf('components'),
    )
    if (lastStat > 0) {
      const afterStats = text.slice(lastStat)
      const descStart  = afterStats.indexOf('\n')
      if (descStart > 0) spell.description = afterStats.slice(descStart).trim()
    }

    return spell
  }

  // ── REGEX ITEM EXTRACTION ───────────────────────────────────
  extractItem(text, sourceName, pageNumber) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const item = {
      name: lines[0] ?? '', item_type: '', rarity: '',
      requires_attunement: false, description: '',
      properties: '', cost: '', weight: '',
      source: sourceName, page: pageNumber, _confidence: 0,
    }

    const rarityMatch = text.match(/\b(common|uncommon|rare|very rare|legendary|artifact)\b/i)
    if (rarityMatch) {
      item.rarity = rarityMatch[1].charAt(0).toUpperCase() + rarityMatch[1].slice(1)
      item._confidence += 25
    }

    const typeMatch = text.match(/\b(weapon|armor|potion|ring|rod|wand|staff|wondrous item|shield|helm|boots|cloak|amulet|gauntlets|gloves|bracers|belt|adventuring gear)\b/i)
    if (typeMatch) { item.item_type = typeMatch[1]; item._confidence += 20 }

    if (/requires attunement/i.test(text)) { item.requires_attunement = true; item._confidence += 10 }

    const costMatch   = text.match(/(\d+(?:,\d+)?\s*(?:gp|sp|cp|pp))/i)
    const weightMatch = text.match(/([\d½¼¾]+\.?\s*lb\.?)/i)

    if (costMatch)   item.cost   = costMatch[1]
    if (weightMatch) item.weight = weightMatch[1]

    // Description: non-stat lines after the first
    const statHeaders = /^(weapon|armor|wondrous|ring|rod|staff|wand|potion|requires|rarity|cost|weight|damage|ac|properties)/i
    item.description  = lines.slice(1).filter(l => !statHeaders.test(l)).join('\n').trim()

    return item
  }

  // ── AI-ASSISTED EXTRACTION ──────────────────────────────────
  async extractWithAI(chunkText, entryType, sourceName, pageNumber) {
    const typeInstructions = {
      spell: `Extract the following fields from this D&D spell description.
Return ONLY a JSON object with these exact keys:
{ "name": string, "level": number (0=cantrip), "school": string,
  "casting_time": string, "range": string, "components": string,
  "duration": string, "description": string }`,
      item: `Extract the following fields from this D&D magic item description.
Return ONLY a JSON object with these exact keys:
{ "name": string, "item_type": string, "rarity": string,
  "requires_attunement": boolean, "description": string,
  "properties": string, "cost": string, "weight": string }`,
      equipment: `Extract the following fields from this D&D equipment entry.
Return ONLY a JSON object with these exact keys:
{ "name": string, "category": string, "cost": string,
  "weight": string, "damage": string, "damage_type": string,
  "properties": string, "description": string }`,
    }

    const systemPrompt = 'You are a D&D 5e data extraction assistant. Extract structured data from the provided text. Return ONLY valid JSON. No markdown, no explanation, no backticks. If a field cannot be determined, use an empty string.'

    const userMessage = [
      typeInstructions[entryType] ?? typeInstructions.item,
      '',
      'SOURCE TEXT:',
      chunkText.slice(0, 1500),
    ].join('\n')

    try {
      const raw     = await this.aiService.complete(systemPrompt, userMessage)
      const cleaned = raw.replace(/```json|```/g, '').trim()
      const parsed  = JSON.parse(cleaned)
      return { ...parsed, source: sourceName, page: pageNumber, _ai_extracted: true, _confidence: 90 }
    } catch (err) {
      console.error('[PdfExtractionService] AI extraction failed:', err.message)
      return null
    }
  }

  // ── MAIN ENTRY POINT ────────────────────────────────────────
  async processChunk(chunk, sourceFilename, useAI = false) {
    const type = this.detectType(chunk.text)
    if (type === 'unknown') return null

    let extracted = null

    if (useAI && this.aiService.getMode() !== 'no-ai') {
      extracted = await this.extractWithAI(chunk.text, type, sourceFilename, chunk.page_number)
    }

    if (!extracted) {
      if (type === 'spell')     extracted = this.extractSpell(chunk.text, sourceFilename, chunk.page_number)
      else                      extracted = this.extractItem(chunk.text,  sourceFilename, chunk.page_number)
    }

    return {
      ...extracted,
      _type:        type,
      _chunk_id:    chunk.id,
      _source_id:   chunk.source_id,
      _chunk_index: chunk.chunk_index,
      _page:        chunk.page_number,
      _raw_text:    chunk.text,
    }
  }

  // ── SEMANTIC SEARCH via vectra ───────────────────────────────
  async semanticSearch(query, campaignId, topK = 10) {
    try {
      const results = await this.embeddingService.search(query, topK)
      const sources = new Set(
        this.db.all('SELECT id FROM pdf_sources WHERE campaign_id=?', [campaignId]).map(s => s.id)
      )
      return results
        .filter(r => sources.has(r.source_id))
        .map(r => ({
          chunk_id:    r.chunk_id,
          source_id:   r.source_id,
          page_number: r.page_number,
          text:        r.text,
          score:       r.score,
        }))
    } catch {
      return []  // vectra not available or not yet indexed
    }
  }
}

module.exports = PdfExtractionService
```

---

#### ▸ Step 3 — Register extraction IPC handlers

📄 `electron/ipc/pdfHandlers.js` — add to the existing module factory:

```javascript
ipcMain.handle('pdf:extractChunk', async (_, chunkId, useAI) => {
  const chunk = db.get(
    'SELECT pc.*, ps.filename FROM pdf_chunks pc JOIN pdf_sources ps ON pc.source_id=ps.id WHERE pc.id=?',
    [chunkId]
  )
  if (!chunk) return null
  return pdfExtractionService.processChunk(chunk, chunk.filename, useAI ?? false)
})

ipcMain.handle('pdf:extractChunks', async (_, chunkIds, useAI) => {
  const results = []
  for (const id of chunkIds) {
    const chunk = db.get(
      'SELECT pc.*, ps.filename FROM pdf_chunks pc JOIN pdf_sources ps ON pc.source_id=ps.id WHERE pc.id=?',
      [id]
    )
    if (!chunk) continue
    const extracted = await pdfExtractionService.processChunk(chunk, chunk.filename, useAI ?? false)
    if (extracted) results.push(extracted)
  }
  return results
})

ipcMain.handle('pdf:semanticSearch', async (_, campaignId, query, topK) => {
  return pdfExtractionService.semanticSearch(query, campaignId, topK ?? 10)
})

ipcMain.handle('pdf:detectChunkType', (_, text) => {
  return { type: pdfExtractionService.detectType(text) }
})
```

---

#### ▸ Step 4 — Initialize PdfExtractionService in main.js

```javascript
const PdfExtractionService = require('./services/PdfExtractionService')
global.pdfExtractionService = new PdfExtractionService(
  global.db,
  global.aiService,
  global.embeddingService
)
// Update the pdfHandlers call to pass the new service:
require('./ipc/pdfHandlers')(global.pdfService, global.db, global.pdfExtractionService)
```

Update the `pdfHandlers.js` factory signature:
```javascript
module.exports = (pdfService, db, pdfExtractionService) => { ... }
```

---

#### ▸ Step 5 — Expose extraction methods in preload.js

- `pdf.extractChunk(chunkId, useAI)` — invokes `pdf:extractChunk`
- `pdf.extractChunks(chunkIds, useAI)` — invokes `pdf:extractChunks`
- `pdf.semanticSearch(campaignId, query, topK)` — invokes `pdf:semanticSearch`
- `pdf.detectChunkType(text)` — invokes `pdf:detectChunkType`

---

### Verification Steps

> **✓ VERIFY:** Test the extraction engine in DevTools:

```javascript
// 1. Find spell-like chunks
const chunks = await window.electronAPI.db.pdf.searchChunks(1, "Casting Time", 5)
console.log(chunks[0].text.slice(0, 200))  // should look like a spell entry

// 2. Regex extraction
const extracted = await window.electronAPI.pdf.extractChunk(chunks[0].id, false)
console.log(extracted._type)         // "spell"
console.log(extracted.name)          // spell name from first line
console.log(extracted.casting_time)  // e.g. "1 action"
console.log(extracted._confidence)   // number > 0 (higher = better match)

// 3. AI extraction (requires AI configured)
const aiExtracted = await window.electronAPI.pdf.extractChunk(chunks[0].id, true)
console.log(aiExtracted._ai_extracted)  // true
console.log(aiExtracted.name)           // cleaner result

// 4. Semantic search (requires vectra embeddings)
const semResults = await window.electronAPI.pdf.semanticSearch(1, "fire damage spell", 5)
console.log(semResults[0].score)                   // 0 to 1
console.log(semResults[0].text.slice(0, 100))      // fire-related content

// 5. Item detection
const itemChunks = await window.electronAPI.db.pdf.searchChunks(1, "requires attunement", 5)
const itemEx     = await window.electronAPI.pdf.extractChunk(itemChunks[0].id, false)
console.log(itemEx._type)   // "item"
console.log(itemEx.rarity)  // e.g. "Uncommon"
```

- `searchChunks()` returns text chunks containing the keyword
- `detectType()` correctly identifies spell chunks (Casting Time + Duration + Components) vs item chunks (rarity + attunement)
- `extractSpell()` populates name, level, school, casting_time, range, components, duration from a real spell chunk
- `extractItem()` populates name, rarity, item_type, attunement from a real item chunk
- AI extraction returns valid JSON when AI is available and produces cleaner results than regex alone

> **ℹ NOTE:** Regex extraction will not be perfect for every PDF format — that is expected. The review UI in Prompt 02 lets the DM correct any parsing errors before saving to the compendium.

> **⚠ WARNING:** Do NOT move to Prompt 02 until `extractChunk()` returns a structured object with a meaningful name and at least one other populated field for both a spell chunk and an item chunk from your indexed PDFs.

---

## Update Prompt 02 — PDF Import UI in Compendium
### *Search panel on Custom tab, chunk preview, edit extracted fields, one-click import*

---

### Context

Prompt 01 is complete. The `PdfExtractionService` can search indexed chunks, detect type, and extract structured fields with both regex and AI. This prompt builds the DM-facing UI: a slide-in "Import from PDF" panel inside the Compendium Custom tab. The DM searches their indexed source books, previews extracted entries, corrects any parsing errors in editable fields, and imports directly to the custom compendium. The workflow is a three-view sequence: **Search → Preview & Edit → Confirm**.

---

### Your Task

#### ▸ Step 1 — Add "Import from PDF" button to Custom Compendium

📄 `src/components/compendium/CustomBrowser.jsx`

```jsx
// Add next to the existing "+ New Entry" button:
<button
  onClick={() => setShowPdfImport(true)}
  style={{
    background: '#1a1208', border: '1px solid #4A90D9',
    color: '#4A90D9', borderRadius: '6px',
    padding: '8px 16px', cursor: 'pointer',
    fontFamily: 'Arial', fontSize: '14px',
    display: 'flex', alignItems: 'center', gap: '6px',
  }}
>
  📄 Import from PDF
</button>

// State:
const [showPdfImport, setShowPdfImport] = useState(false)

// Render the panel when active:
{showPdfImport && (
  <PdfImportPanel
    campaignId={activeCampaign?.id}
    onImportComplete={() => {
      setShowPdfImport(false)
      refreshList()
    }}
    onClose={() => setShowPdfImport(false)}
  />
)}
```

---

#### ▸ Step 2 — Build the PdfImportPanel component

📄 `src/components/compendium/PdfImportPanel.jsx`

A full-height slide-in panel from the right, **560px wide**, with an overlay backdrop. Three internal views — the user always moves forward or back through them.

**Panel shell:**
- Header: "📄 Import from PDF" + X close button
- Source dropdown: lists all PDFs for this campaign from `db.pdf.getAll(campaignId)` filtered to `status IN ('indexed', 'embedded')`
- If no sources: amber warning "No indexed PDF sources found. Upload and embed a PDF from the AI Assistant page first."

---

#### ▸ Step 3 — View 1: Search & Browse

**Search mode toggle:** "Keyword" (default) | "Semantic"

**Keyword mode:**
- Text input: "Search for a spell or item..." with 400ms debounce
- Calls `db.pdf.searchChunks(campaignId, query, 20)` on keyup
- Results list — each result shows:
  - Filename badge (blue pill)
  - Page number (e.g. "p.142")
  - First 120 chars of text
  - Type badge — calls `pdf.detectChunkType(chunk.text)` per result: 🔮 Spell / 💎 Item / 🗡 Equipment / ❓ Unknown
- Two buttons per result: **"Preview"** (→ View 2) and **"Quick Add"** (extract without preview → View 3)
- "Unknown" type chunks: show "Preview Only" instead of "Quick Add"

**Semantic mode:**
- Same input, but calls `pdf.semanticSearch(campaignId, query, 10)`
- Results include a relevance score bar (score × 100%)
- Hint: "Semantic search uses your embedded chunks. Switch to Keyword if you get no results."

---

#### ▸ Step 4 — View 2: Chunk Preview & Edit

Two-column layout:

**Left column — Raw Chunk Text:**
- Header: "Raw Text — [filename], p.[page]"
- Scrollable `<pre>` block with the full chunk text
- "Get Adjacent Context" button — calls `db.pdf.getChunkContext(sourceId, chunkIndex, 1)` and appends neighboring chunk text
- "Extract with AI ✨" button — calls `pdf.extractChunk(chunkId, true)` and refreshes the right column with AI values

**Right column — Extracted Fields:**
- Header: "Extracted Data" + type badge
- "Type Override" dropdown at the top: lets DM correct wrong auto-detection (Spell / Item / Equipment)
- All fields editable — the DM corrects extraction errors here

**Spell fields:**

| Field | Input |
|---|---|
| Name | text input |
| Level | number input (0 = Cantrip) |
| School | select: Abjuration / Conjuration / Divination / Enchantment / Evocation / Illusion / Necromancy / Transmutation / Other |
| Casting Time | text (e.g. "1 action") |
| Range | text (e.g. "60 feet") |
| Components | text (e.g. "V, S, M (sulfur)") |
| Duration | text (e.g. "Concentration, up to 1 minute") |
| Description | textarea, 6 rows |
| Source Book | text, pre-filled from PDF filename |
| Page | number, pre-filled from chunk metadata |

**Item fields:**

| Field | Input |
|---|---|
| Name | text input |
| Item Type | select: Weapon / Armor / Potion / Ring / Rod / Scroll / Staff / Wand / Wondrous Item / Gear / Other |
| Rarity | select: Common / Uncommon / Rare / Very Rare / Legendary / Artifact |
| Requires Attunement | checkbox |
| Cost | text (e.g. "100 gp") |
| Weight | text (e.g. "3 lb.") |
| Description | textarea, 6 rows |
| Properties | textarea, 3 rows |
| Source Book | text |
| Page | number |

**Equipment fields:**

| Field | Input |
|---|---|
| Name | text input |
| Category | select: Weapon / Armor / Adventuring Gear / Tool / Mount / Vehicle / Trade Good / Other |
| Cost | text |
| Weight | text |
| Damage | text (e.g. "1d8") |
| Damage Type | text (e.g. "slashing") |
| Properties | text (e.g. "Versatile (1d10), Thrown") |
| Description | textarea, 4 rows |
| Source Book | text |
| Page | number |

**Navigation:**
- "← Back to Search" — returns to View 1 without saving
- "Import to Compendium →" — proceeds to View 3 with current field values

---

#### ▸ Step 5 — View 3: Confirm & Import

Read-only summary before saving:

- Type badge + name in large gold Georgia heading
- All populated fields displayed as a clean read-only list
- "Campaign" indicator showing which campaign the entry will be added to
- Source line: "[PDF filename], page [N]" — attribution always preserved

**Save function:**

```javascript
const buildCompendiumData = (extracted, type) => {
  if (type === 'spell') return {
    level:         extracted.level,
    school:        extracted.school,
    casting_time:  extracted.casting_time,
    range:         extracted.range,
    components:    extracted.components,
    duration:      extracted.duration,
    description:   extracted.description,
    source_book:   extracted.source,
    page:          extracted.page,
  }
  if (type === 'item') return {
    item_type:           extracted.item_type,
    rarity:              extracted.rarity,
    requires_attunement: extracted.requires_attunement,
    cost:                extracted.cost,
    weight:              extracted.weight,
    description:         extracted.description,
    properties:          extracted.properties,
    source_book:         extracted.source,
    page:                extracted.page,
  }
  // equipment
  return {
    category:    extracted.category ?? extracted.item_type,
    cost:        extracted.cost,
    weight:      extracted.weight,
    damage:      extracted.damage,
    damage_type: extracted.damage_type,
    properties:  extracted.properties,
    description: extracted.description,
    source_book: extracted.source,
    page:        extracted.page,
  }
}

// On "Import" click:
await window.electronAPI.db.compendium.create({
  campaign_id: campaignId,
  type:        entryType,      // "spell" | "item" | "equipment"
  name:        extracted.name,
  data:        buildCompendiumData(extracted, entryType),
  source:      'pdf_upload',   // marks it as PDF-sourced
})
```

**Buttons:** "Import" (primary gold), "Edit" (→ back to View 2), "Cancel" (→ back to View 1)

---

#### ▸ Step 6 — Post-import success screen

After a successful import, show a success state inside the panel (do not auto-close):

- "✓ [Entry Name] added to your [Spells / Items / Equipment] compendium" in gold
- "View in Compendium" — closes the panel and navigates to Custom tab filtered to that entry type
- "Import Another" — returns to View 1 with the search query preserved
- "Close" — closes the panel

---

#### ▸ Step 7 — PDF source attribution badge in Custom Compendium

📄 `src/components/compendium/CustomBrowser.jsx`

Entries imported from PDFs have `source = 'pdf_upload'` in the `compendium_custom` table. Update the Custom tab to distinguish them from hand-entered entries:

- PDF-sourced entries: show a **"📄 PDF"** blue badge instead of the purple "Homebrew" badge
- Badge text shows the source book name from `data.source_book` (e.g. "Player's Handbook")
- Hovering the badge shows a tooltip: "Imported from [source_book], p.[page]"

---

#### ▸ Step 8 — "Find in my PDFs" shortcut on SRD entries

📄 `src/components/compendium/SpellDetail.jsx`
📄 `src/components/compendium/EquipmentDetail.jsx`

Add a small secondary action below the existing detail panel buttons. Useful when the DM has an annotated edition of the same spell/item:

```jsx
<button
  onClick={() => {
    setShowPdfImport(true)
    setPdfImportQuery(entry.name)  // pre-fills View 1 search with the entry name
  }}
  style={{ /* small secondary style */ }}
>
  🔍 Find in my PDFs
</button>
```

---

### Verification Steps

> **✓ VERIFY:** Full import workflow:

```javascript
// Prerequisites: at least one PDF indexed and embedded

// 1. Open Compendium → Custom tab
//    Expected: "📄 Import from PDF" button appears next to "+ New Entry"

// 2. Click "Import from PDF" → panel opens (560px, right side)
//    Expected: Source dropdown lists the indexed PDFs

// 3. Keyword search: type "Fireball"
//    Expected: results appear within 400ms, each shows filename, page, text preview, type badge

// 4. Click "Preview" on a spell result
//    Expected: View 2 — left shows raw chunk, right shows extracted fields

// 5. Click "Extract with AI ✨"
//    Expected: right column updates with cleaner AI-extracted values

// 6. Edit the Description field — correct any extraction errors

// 7. Click "Import to Compendium →"
//    Expected: View 3 shows read-only summary with source attribution

// 8. Click "Import"
//    Expected: success screen "✓ Fireball added to your Spells compendium"

// 9. Click "View in Compendium"
//    Expected: Custom tab opens, Fireball shows with blue "📄 PDF" badge

// 10. Hover the PDF badge
//    Expected: tooltip shows "Imported from [filename], p.[page]"

// DevTools: verify the entry
const entries  = await window.electronAPI.db.compendium.getAll(1, "spell")
const fireball = entries.find(e => e.name === "Fireball")
console.log(fireball.source)           // "pdf_upload"
const data = JSON.parse(fireball.data)
console.log(data.source_book)          // PDF filename
console.log(data.page)                 // page number
console.log(data.casting_time)         // "1 action" or similar
console.log(data.level)                // 3
```

- "Import from PDF" button visible on the Custom tab
- Keyword search returns relevant chunks within 400ms
- Type badges correctly identify spells vs items
- View 2: raw text displayed, all extracted fields editable
- "Get Adjacent Context" appends neighboring chunks to the raw text display
- "Extract with AI ✨" produces noticeably cleaner results than regex alone
- Type Override corrects wrong auto-detection
- View 3: confirmation summary shows all fields and source attribution
- Imported entries appear with "📄 PDF" blue badge (not purple "Homebrew")
- Badge tooltip shows source book name and page number
- "Find in my PDFs" on SRD detail panels pre-fills the search

> **⚠ WARNING:** These two prompts are complete when a spell or item can be found in indexed PDF chunks, reviewed and edited in the preview pane, and imported to the compendium with correct source attribution persisted to the database.

---

*⚔ End of PDF → Compendium Import Prompts ⚔*
