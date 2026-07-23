# DMCS — Source Book Importer (Developer Onboarding Notes)

> **New to this project? Start here for the feature we are actively working on.**
> Read the root [`README.md`](README.md) first for the big picture (Electron two-process
> model, the IPC chain, the database). This document zooms into one feature: turning an
> uploaded PDF sourcebook into structured Compendium entries.

**Status:** actively maintained. Last worked on: subclass import completeness + connecting
the Claude API (see the *Recent Work & Gotchas* section at the bottom — read it, the
lessons there are the whole reason this doc exists).

> ⚠️ **Do not trust [`DMCS_PDF_Compendium_Import.md`](DMCS_PDF_Compendium_Import.md).**
> That file is an older *build-spec* for a superseded design (`PdfExtractionService`,
> `PdfImportPanel`, a keyword/semantic toggle, `pdf:extractChunk` handlers). **None of
> that shipped.** The real, current implementation is the one described here. When the two
> disagree, this document and the code win.

---

## 1. What the feature does

A Dungeon Master uploads a PDF sourcebook (Player's Handbook, Tasha's, etc.). The app has
already turned that PDF into searchable text chunks (that is the Phase 7 RAG pipeline — see
the README). The **Source Book Importer** lets the DM type the name of a spell, monster,
piece of equipment, or subclass, and the app will:

1. **Find** the relevant passages in the indexed PDF (semantic + keyword search).
2. **Extract** a clean, structured entry from those passages using AI.
3. **Preview** it for the DM to review/rename.
4. **Save** it into the Compendium.

There are two entry points, both living in `src/components/compendium/`:

| Modal | File | What it's for |
|---|---|---|
| **Single Import** | `SourceBookImportModal.jsx` | DM types one name → review → save. Best for one-offs and for subclasses. |
| **Bulk Import** | `BulkImportModal.jsx` | Scan a whole book for all entries of a type → checklist → import many in a loop. |

Both are opened from the **Compendium** page ([`src/pages/Compendium.jsx`](src/pages/Compendium.jsx))
via the **📥 Single Import** / **📦 Bulk Import** buttons.

The four supported content types are defined once in `CONTENT_TYPES`
([`src/utils/compendiumExtractor.js`](src/utils/compendiumExtractor.js)): `spell`, `monster`,
`equipment`, `subclass`.

---

## 2. The pipeline, end to end

Follow the data. This is the single most important thing to understand.

```
DM types "College of Creation"  (renderer / React)
        │
        │  1. SEARCH — find passages
        ▼
window.electronAPI.embed.search(query, k, itemKeys, sourceId)
        │   (preload → ipc/embeddingHandlers.js → EmbeddingService.search)
        ▼
EmbeddingService.search()                       electron/services/EmbeddingService.js
   • vectra vector search for the top-k chunks
   • _expandContiguous(): stitch the neighbouring chunks so a
     multi-page entry arrives whole, not in fragments
   • (fallback) SQLite LIKE keyword search if the vector index is empty
        │  returns: [{ chunk_id, page_number, text, score }, ...]
        │
        │  2. BUILD PROMPT — pure function, no IO
        ▼
buildExtractionPrompt(type, name, chunks)       src/utils/compendiumExtractor.js
   • caps how much source text to send (per-type budget)
   • injects the JSON schema + extraction rules for that type
        │  returns: { system, user }
        │
        │  3. EXTRACT — call the model
        ▼
window.electronAPI.ai.complete(system, user, { maxTokens })
        │   (preload → ipc/aiHandlers.js → AIService.complete)
        ▼
AIService.complete()                            electron/services/AIService.js
   • online  → Claude API (claude-sonnet-5)
   • offline → Ollama (local llama3), num_ctx sized to the request
        │  returns: raw model text (should be JSON)
        │
        │  4. PARSE + NORMALISE
        ▼
parseExtraction(type, rawText)                  src/utils/compendiumExtractor.js
   • strips markdown fences, grabs the outer { ... }, JSON.parse
   • coerces every field to the right type with safe defaults
        │  returns: a clean data object
        │
        │  5. PREVIEW (React) then SAVE
        ▼
subclass  → window.electronAPI.db.subclasses.create(...)   (its own table)
others    → window.electronAPI.db.compendium.create(...)    (compendium_custom)
```

### Why `compendiumExtractor.js` is a *pure* module

It has **no IPC and no React imports** — just functions. That is deliberate: both modals
(single and bulk) import the same `buildExtractionPrompt` / `parseExtraction` /
`extractionMaxTokens`, so the extraction logic lives in exactly one place. If you change how
a type is extracted, you change it once and both modals get it. Keep it that way.

---

## 3. File-by-file map

| File | Layer | Responsibility |
|---|---|---|
| `src/pages/Compendium.jsx` | renderer | Hosts the two import buttons and mounts the modals. |
| `src/components/compendium/SourceBookImportModal.jsx` | renderer | Single-item import UI + the search→extract→preview→save flow. |
| `src/components/compendium/BulkImportModal.jsx` | renderer | Scan → checklist → import-in-a-loop UI. Reuses the same extractor. |
| `src/utils/compendiumExtractor.js` | shared (pure) | `CONTENT_TYPES`, per-type JSON schemas, prompt builder, response parser, token budgets. |
| `electron/services/EmbeddingService.js` | main | `search()` (+ `_expandContiguous` stitching) and `scanSource()` (bulk discovery). |
| `electron/services/AIService.js` | main | `complete(system, user, {maxTokens})` — routes to Claude or Ollama. |
| `electron/ipc/embeddingHandlers.js` | main (IPC) | `embed:search`, `embed:scanSource`. |
| `electron/ipc/aiHandlers.js` | main (IPC) | `ai:complete`. |
| `electron/preload.js` | bridge | Exposes `embed.*` and `ai.complete` to the renderer. |
| `src/components/character/SubclassCard.jsx` | renderer | Displays a saved subclass (where imported subclasses show up). |

Remember the **IPC chain rule** from the README: a renderer call like
`window.electronAPI.embed.search(...)` only works if it exists in **all** of preload →
ipc handler → service. If a call returns `undefined`, one of those three layers is missing
the channel.

---

## 4. Two things that make this feature hard (and how we handle them)

### (a) A single entry is scattered across many chunks

The PDF was chopped into ~400-token chunks with overlap. A subclass like *College of
Creation* spans several chunks across 2–3 pages, and even includes a monster-style stat
block in the middle. Naive top-k search returns only the chunks that individually look most
like the query — so the plain continuation paragraphs (which don't repeat the query words)
get dropped, and the AI never sees them.

**Fix:** `EmbeddingService._expandContiguous()` takes the span the top hits already cover
inside the entry and **fills the gaps between them** (plus a small margin before, to catch
the heading, and after, to catch a level-14 capstone). It biases *forward* so it doesn't
drag in the previous entry. The result: the whole entry reaches the model contiguously.

### (b) The model can run out of room and quietly stop

A full subclass copied verbatim can exceed a small output-token budget. When that happens
the model gracefully closes the JSON early — you get *valid* JSON that is silently missing
the last feature. That is why:

- `MAX_PASSAGE_CHARS_BY_TYPE` and `MAX_OUTPUT_TOKENS_BY_TYPE` in `compendiumExtractor.js`
  give `subclass` and `monster` much larger input/output budgets than `spell`/`equipment`.
- `extractionMaxTokens(type)` is threaded all the way through:
  `ai.complete(system, user, { maxTokens: extractionMaxTokens(contentType) })`.

If a junior dev ever sees "the import is missing the last feature / cuts off mid-sentence,"
these two knobs are the first place to look.

---

## 5. How to run and test it locally

1. `npm run dev` (see README). You need **Ollama running** for the *search* step even if
   you use Claude for extraction — embeddings come from Ollama's `nomic-embed-text`.
2. Upload a PDF in **AI Sources** and wait until its status is `embedded`.
3. Go to **Compendium**, pick a tab (e.g. Monsters), click **📥 Single Import**.
4. Type a name that exists in your PDF, click **Search & Extract**, review, save.

Quick DevTools probes (renderer console):

```javascript
// Does search return stitched, contiguous chunks?
const chunks = await window.electronAPI.embed.search("College of Creation level", 14, "College of Creation level", null)
console.log(chunks.map(c => `p${c.page_number}: ${c.text.slice(0,40)}`))

// Is AI online (Claude) or offline (Ollama)?
console.log(await window.electronAPI.ai.getMode())   // { mode: 'online' | 'offline-ollama' | 'no-ai' }
```

---

## 6. Recent Work & Gotchas (the lessons that cost us the most time)

These are the specific things we fixed. Read them — they are non-obvious and will save you
hours.

1. **The online model must be a *current* model ID.** `AIService.anthropicModel` is now
   `claude-sonnet-5`. It used to be a dated Sonnet-4 snapshot that had passed its retirement
   date — so the startup "validate the key" ping got a 404, the code silently fell back to
   Ollama, and the app **never entered online mode even with a valid key**. The tell was
   "Test Connection says CONNECTED but Current mode never changes" — because the test was
   being answered by local Ollama, not Claude. If online mode ever refuses to engage, check
   this model string first.

2. **`ai.complete` reads the first *text* block, not `content[0]`, and disables thinking.**
   Newer Claude models turn on "thinking" by default; that both eats the `max_tokens` budget
   and can make `content[0]` a thinking block (breaking `content[0].text`). The extraction
   path sends `thinking: { type: 'disabled' }` and does
   `response.content.find(b => b.type === 'text')?.text`.

3. **Ollama's default context window is tiny (2048 tokens).** For big subclass/monster
   prompts that silently truncates the *input*. `AIService.complete` now sizes `num_ctx` to
   fit the prompt + requested output. Offline extraction of large entries is still best-effort
   — a local llama3 will not follow the "don't merge the stat block into the feature" style
   instructions as reliably as Claude does. For clean subclass imports, use the Claude API.

4. **Formatting is preserved on purpose.** PDF newlines survive into the chunks, the prompt
   asks the model to keep paragraph/sub-option structure and rejoin hyphen-split words, and
   the preview + `SubclassCard` render with `whiteSpace: 'pre-wrap'` so those line breaks
   actually show. If formatting looks collapsed, check for a missing `pre-wrap`.

5. **Subclasses save to their own table.** `db.subclasses.create` (not `compendium.create`).
   They surface via `SubclassCard.jsx` and the character level-up flow, not the generic
   Compendium browsers.

---

*For the wider architecture (IPC chain, DB schema, all 13 modules) see the root README.
This document is intentionally scoped to the Source Book Importer only.*
