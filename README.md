# Dungeon Master's Campaign Suite (DMCS)

An AI-assisted desktop application for tabletop RPG Dungeon Masters. DMCS runs as a local Electron app with a React frontend, a SQLite database, and optional AI features powered by either the Anthropic Claude API (online) or a locally-running Ollama model (offline).

**Version:** 1.0.0 — All 8 phases complete.

---

## Table of Contents

1. [What This App Does](#what-this-app-does)
2. [Tech Stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Installation & First Run](#installation--first-run)
5. [Development Workflow](#development-workflow)
6. [Project Structure](#project-structure)
7. [Architecture Overview](#architecture-overview)
8. [The IPC Chain](#the-ipc-chain)
9. [Database Schema](#database-schema)
10. [Module Reference](#module-reference)
11. [AI Layer](#ai-layer)
12. [Player View](#player-view-phase-8)
13. [State Management](#state-management)
14. [Utility Libraries](#utility-libraries)
15. [Adding a New Feature](#adding-a-new-feature)
16. [Building for Production](#building-for-production)
17. [Troubleshooting](#troubleshooting)

---

## What This App Does

DMCS gives Dungeon Masters a single desktop app to manage an entire campaign:

| Module | What it does |
|---|---|
| Campaign Manager | Create, load, and switch between campaigns |
| World Builder | Factions, Locations, NPCs, Lore, and named Connections between them |
| Mind Map | Interactive React Flow graph of all world entities |
| Map Engine | Upload battle maps, paint fog of war, place tokens |
| Compendium | Browse SRD monsters/spells/equipment; create homebrew entries |
| Character Sheets | Full D&D 5e character sheets with level-up wizard |
| Encounter Builder | Build encounters, calculate XP, run initiative tracker with HP sync |
| Combat Calculator | Standalone XP/CR calculator |
| AI Assistant | RAG-powered rules Q&A with PDF source upload and streaming answers |
| Player View | A separate Electron window for players — fog-enforced map, read-only character sheet, live DM broadcasts |

---

## Tech Stack

| Layer | Library / Tool | Version |
|---|---|---|
| Desktop shell | Electron | 33 |
| UI framework | React | 18 |
| Build tool | Vite | 6 |
| Routing | React Router v6 | 6 |
| State management | Zustand | 5 |
| Database | better-sqlite3 (SQLite) | 12 |
| Map rendering | React-Konva | 18 |
| Mind maps | @xyflow/react (React Flow) + @dagrejs/dagre | 12 / 3 |
| AI — online | Anthropic Claude API (@anthropic-ai/sdk) | 0.100 |
| AI — offline | Ollama (local HTTP) | — |
| PDF parsing | pdf-parse | 2 |
| Vector search | vectra | 0.15 |
| Image export | html-to-image | 1.11 |

> **Important:** These choices are locked for the project. Do not substitute libraries without updating this README and the spec documents.

---

## Prerequisites

Before you can run this project you need the following installed:

### Required

- **Node.js 20+** — [nodejs.org](https://nodejs.org/)
- **npm 10+** — comes with Node.js
- **Python 3** — required by `better-sqlite3` native build (node-gyp dependency)
- **Visual Studio Build Tools** (Windows) or **Xcode Command Line Tools** (macOS) — also required by node-gyp for native compilation

### Optional (for AI features)

- **Anthropic API key** — for Claude-powered AI features. Get one at [console.anthropic.com](https://console.anthropic.com)
- **Ollama** — for fully offline AI. Download at [ollama.ai](https://ollama.ai) then pull the required models:

```bash
ollama pull llama3
ollama pull nomic-embed-text   # required for PDF embedding
```

---

## Installation & First Run

```bash
# 1. Clone the repository
git clone <repo-url>
cd "Dungeon Master Campaign Suite"

# 2. Install dependencies
#    postinstall automatically runs electron-rebuild for better-sqlite3
npm install

# 3. Start in development mode
npm run dev
```

`npm run dev` does two things in parallel:
- Starts the **Vite dev server** on `http://localhost:5173`
- Waits for that server, then launches **Electron** pointing to it

The app window should open within a few seconds. On first launch, DMCS will:
1. Create the SQLite database file at your OS's app data path (`%APPDATA%\dmcs\dmcs.db` on Windows, `~/Library/Application Support/dmcs/dmcs.db` on macOS)
2. Run all 5 database migrations automatically
3. Seed the SRD cache (monsters, spells, equipment, conditions) from the D&D 5e API — this happens once and is stored locally

### Configure AI (optional)

1. Open the app and navigate to **Settings** (bottom of the sidebar)
2. Paste your Anthropic API key — it is stored encrypted using Electron's `safeStorage` (the OS keychain), never in plain text
3. If you have Ollama running locally, the app will detect it automatically and offer it as a fallback

---

## Development Workflow

```bash
npm run dev       # Start Electron + Vite dev server (hot reload for React)
npm run build     # Build renderer with Vite, then package with electron-builder
npm run electron  # Run Electron against an already-running Vite server
```

### Hot reload

The Vite dev server provides hot module replacement for all React components under `src/`. Electron itself does **not** hot reload — if you change anything in `electron/` (main process, preload, database, services, or IPC handlers), you must **quit and restart** `npm run dev`.

### DevTools

- **DM window:** Right-click → Inspect Element, or `Ctrl+Shift+I`
- **Player window:** Same shortcut while the player window is focused

---

## Project Structure

```
Dungeon Master Campaign Suite/
│
├── electron/                       # Main process (Node.js — no DOM, no React)
│   ├── main.js                     # Electron entry: window creation, IPC registration
│   ├── preload.js                  # contextBridge surface — the ONLY bridge to the renderer
│   │
│   ├── database/
│   │   └── DatabaseService.js      # SQLite connection, migrations, all CRUD methods
│   │
│   ├── services/
│   │   ├── AIService.js            # Claude API + Ollama strategy; streaming support
│   │   ├── SrdService.js           # Fetch & cache SRD data (monsters, spells, equipment)
│   │   ├── KeyService.js           # API key encrypt/decrypt via Electron safeStorage
│   │   ├── PdfIngestionService.js  # PDF → text chunks → stored in pdf_chunks table
│   │   ├── EmbeddingService.js     # Embed chunks via Ollama nomic-embed-text; vectra index
│   │   └── RAGService.js           # Semantic search + Claude answer generation
│   │
│   └── ipc/
│       ├── dbHandlers.js           # All db:* ipcMain handlers (CRUD for all tables)
│       ├── aiHandlers.js           # All ai:* ipcMain handlers (generate, stream, RAG)
│       ├── srdHandlers.js          # All srd:* ipcMain handlers (fetch, search cache)
│       ├── pdfHandlers.js          # All pdf:* ipcMain handlers (upload, ingest, status)
│       ├── embeddingHandlers.js    # All embedding:* ipcMain handlers
│       └── fileHandlers.js         # File system helpers (image import, export)
│
├── src/                            # Renderer process (React — no Node.js APIs here)
│   ├── main.jsx                    # React entry point — mounts <App />
│   ├── App.jsx                     # BrowserRouter, AppContent, all routes
│   ├── PlayerApp.jsx               # Standalone root for the /player route
│   ├── index.css                   # Global styles only
│   │
│   ├── pages/                      # One file per top-level module
│   │   ├── CampaignManager.jsx
│   │   ├── WorldBuilder.jsx
│   │   ├── world/                  # Sub-pages: Factions, Locations, NPCs, Lore, Connections
│   │   ├── MapEngine.jsx
│   │   ├── Compendium.jsx
│   │   ├── CharacterSheets.jsx
│   │   ├── EncounterBuilder.jsx
│   │   ├── CombatCalculator.jsx
│   │   ├── MindMap.jsx
│   │   ├── AIAssistant.jsx
│   │   ├── AISources.jsx
│   │   ├── LoreConnections.jsx
│   │   └── Settings.jsx
│   │
│   ├── components/                 # Shared and feature-specific components
│   │   ├── Sidebar.jsx             # Left navigation rail
│   │   ├── TopBar.jsx              # Header bar (DM window only)
│   │   ├── CampaignGuard.jsx       # Redirects to / if no campaign is loaded
│   │   ├── SrdLoader.jsx           # Triggers SRD seed on first launch
│   │   ├── ui/
│   │   │   └── Skeleton.jsx        # Pulsing loading placeholder bars
│   │   ├── map/                    # MapCanvas, MapToolbar, MapToken, AddTokenModal, TokenInspector
│   │   ├── character/              # CharacterSheet, InventoryPanel, SpellSlotsPanel, LevelUpModal, AICharacterAssistant
│   │   ├── compendium/             # MonsterBrowser, SpellBrowser, EquipmentBrowser, stat block panels, homebrew forms
│   │   ├── encounter/              # MonsterRoster, XPCalculator, InitiativeTracker, ConditionManager, CombatLog
│   │   ├── mindmap/                # Nodes, edges, toolbar, detail panel, AI insights
│   │   ├── world/                  # EntityCard, EntityModal, NPCModal, AISuggestionPanel, WorldSearch
│   │   ├── ai/                     # PdfSourceManager, RAGQueryPanel, AnswerRenderer, AIToolbox
│   │   └── player/                 # All player window components (see Player View section)
│   │
│   ├── stores/
│   │   ├── campaignStore.js        # Active campaign (persisted — survives reload)
│   │   └── playerStore.js          # Player panel UI state (not persisted)
│   │
│   └── utils/
│       ├── dnd5e.js                # D&D 5e math: modifiers, saving throws, skills, spell slots
│       ├── fogUtils.js             # Fog bitmask encode/decode, isCellRevealed
│       ├── tokenUtils.js           # Token snap-to-grid helpers
│       ├── encounterUtils.js       # XP thresholds, multipliers, difficulty rating
│       ├── combatUtils.js          # Initiative sort, combat state helpers
│       ├── mindMapUtils.js         # React Flow node/edge builders, Dagre layout
│       └── crColor.js              # Challenge rating → color badge mapping
│
├── package.json
├── vite.config.js
├── DMCS_AI_Spec_Sheet.md           # Master architecture specification
├── DMCS_Phase8_Agent_Prompts.md    # Phase 8 build prompts
└── DMCS_Claude_Code_Rules.md       # AI coding session rules and protocols
```

---

## Architecture Overview

### The Two-Process Model

Electron runs two completely separate JavaScript environments that **cannot share memory**:

```
┌─────────────────────────────────────────────────────────┐
│  MAIN PROCESS  (electron/)                              │
│  Node.js — full OS access                               │
│  • SQLite via better-sqlite3                            │
│  • Anthropic SDK / Ollama HTTP calls                    │
│  • File system (fs, path)                               │
│  • Electron safeStorage (API key encryption)            │
│  • Window creation and management                       │
└─────────────────────────┬───────────────────────────────┘
                           │  IPC — crosses process boundary
                           │  (ipcMain / ipcRenderer)
┌─────────────────────────▼───────────────────────────────┐
│  RENDERER PROCESS  (src/)                               │
│  Browser JS — no Node.js APIs                           │
│  • React + Vite                                         │
│  • window.electronAPI.* (only way to reach main)        │
│  • Zustand stores, React Router, react-konva, etc.      │
└─────────────────────────────────────────────────────────┘
```

> **Rule:** Never `import` `better-sqlite3`, `fs`, `path`, `@anthropic-ai/sdk`, or any other Node.js module inside `src/`. It will crash the renderer immediately. All database and AI calls must go through IPC.

### The contextBridge Surface

`electron/preload.js` is the **only** file that bridges the two processes. It exposes a typed `window.electronAPI` object to the renderer. Every database call, AI call, and file operation in React goes through this object.

```javascript
// From any React component:
const campaigns = await window.electronAPI.db.campaigns.getAll()
const result    = await window.electronAPI.ai.generate({ prompt: '...' })
await window.electronAPI.player.openWindow(campaignId)
```

---

## The IPC Chain

Every database call follows this exact 4-layer path. If you add a new DB feature, you **must** touch all four layers or the feature will silently not work.

```
React Component
    │
    │  window.electronAPI.db.characters.getAll(campaignId)
    ▼
electron/preload.js
    ipcRenderer.invoke("db:characters:getAll", campaignId)
    ▼
electron/ipc/dbHandlers.js
    ipcMain.handle("db:characters:getAll", (_, campaignId) => ...)
    ▼
electron/database/DatabaseService.js
    db.prepare("SELECT * FROM characters WHERE campaign_id = ?").all(campaignId)
    ▼
SQLite file on disk
```

---

## Database Schema

The database is created automatically on first launch. All 5 migrations run in order via `DatabaseService.runMigrations()` — you never need to run them manually.

### Tables

| Table | Purpose |
|---|---|
| `campaigns` | Top-level campaigns. All other tables cascade-delete when a campaign is deleted. |
| `locations` | Places in the world. Supports parent/child hierarchy via `parent_location_id`. |
| `factions` | Organizations, guilds, cults. |
| `npcs` | Non-player characters — linked to a location and/or faction. |
| `connections` | Named relationships between any two entities (NPC↔NPC, Location↔Faction, etc.). |
| `characters` | Player characters. Stats, inventory, and spell slots are stored as JSON strings. |
| `encounters` | Encounter records — monster list (JSON), status, XP total. |
| `maps` | Battle maps. Image stored as base64 data URL. Fog and tokens stored as JSON. |
| `compendium_custom` | Homebrew monsters, spells, equipment, items, and lore entries. |
| `srd_cache` | One-time local cache of SRD data fetched from the D&D 5e API. |
| `pdf_sources` | Uploaded PDF files and their indexing status. |
| `pdf_chunks` | Text chunks extracted from PDFs, with embedding tracking columns. |
| `mind_map_positions` | Saved x/y positions for each entity node in the mind map. |
| `ai_usage_log` | Audit log for AI requests (mode, token counts, duration). |

### JSON Column Conventions

Several columns store structured data as JSON strings (SQLite has no native JSON type). Always `JSON.parse()` before reading and `JSON.stringify()` before writing.

| Table | Column | Shape |
|---|---|---|
| `characters` | `stats` | `{ str, dex, con, int, wis, cha, save_proficiencies: string[], skill_proficiencies: string[], death_saves: { successes, failures } }` |
| `characters` | `inventory` | `Array<{ id, name, quantity, weight, equipped, description }>` |
| `characters` | `spell_slots` | `{ used: {}, known_spells: Array<{ name, level, school }> }` |
| `maps` | `fog_data` | `number[]` — flat bitmask array, one bit per grid cell |
| `maps` | `tokens` | `Array<{ id, label, type, col, row, color, entityId }>` |
| `encounters` | `monsters` | `Array<{ monsterId, name, cr, xp, count, hp_override }>` |

### Migrations

| ID | Name | What it adds |
|---|---|---|
| 001 | `core_schema` | All 12 base tables |
| 002 | `connections_lore` | `campaign_id` on connections; `'lore'` type in compendium_custom |
| 003 | `pdf_chunks` | `pdf_chunks` table for the RAG pipeline |
| 004 | `embedding_columns` | `embedded` and `embedding_model` columns on `pdf_chunks` |
| 005 | `ai_usage_log` | `ai_usage_log` table |

---

## Module Reference

### Phase 1 — Foundation

- **`CampaignManager`** — Create, load, rename, and delete campaigns. The selected campaign object is stored in `campaignStore` (Zustand, persisted to localStorage).
- **`CampaignGuard`** — Wraps all campaign-scoped routes. Redirects to `/` if no campaign is loaded. Use it when adding any new page that requires a campaign.
- **`Settings`** — API key management, AI mode status badge, SRD re-seed button.

### Phase 2 — World Builder

- **`WorldBuilder`** — Dashboard with entity count chips, recently created entities, and AI suggestions.
- **`Factions`, `Locations`, `NPCs`, `Lore`, `Connections`** — CRUD pages for each entity type, accessible from the World Builder submenu.
- **`WorldSearch`** — Global search bar in the TopBar. Fuzzy-searches across all entity types at once.
- **`AISuggestionPanel`** — Asks the AI to suggest new NPCs, factions, or plot hooks based on the current campaign's world data.

### Phase 3 — Map Engine

- **`MapEngine`** — The page that owns the map list, active map state, fog brush settings, and token state. Passes everything down as props to `MapCanvas`.
- **`MapCanvas`** — The react-konva canvas. Renders 4 layers: background image → grid → fog → tokens. Accepts a `mode` prop: `"dm"` (paint fog, drag tokens) or `"player"` (read-only, solid black fog).
- **`MapToolbar`** — Fog brush tools (reveal/hide, 3 sizes), Reveal All, Hide All, Reset View.
- **`MapToken`** — A single draggable token on the canvas. Locked (no drag) in player mode.

### Phase 4 — Compendium & Character Sheets

- **`Compendium`** — Tabs for SRD Monsters, Spells, Equipment, and Custom/Homebrew entries. No `CampaignGuard` — accessible without a loaded campaign. Also hosts the **Source Book Importer** (📥 Single Import / 📦 Bulk Import), which turns indexed PDF passages into structured entries via AI. **This feature has its own onboarding doc: [`DMCS_Source_Book_Importer.md`](DMCS_Source_Book_Importer.md)** — start there before touching import code.
- **`CharacterSheets`** — Lists all player characters for the active campaign; opens the full `CharacterSheet` component.
- **`CharacterSheet`** — Tabs: Stats (ability scores, saves, skills, HP), Inventory, Spell Slots, Death Saves, Notes. Includes a level-up wizard and an AI character assistant.

### Phase 5 — Encounter Tools

- **`EncounterBuilder`** — Build encounters by searching the SRD monster list. Supports HP overrides per monster.
- **`XPCalculator`** — Calculates encounter difficulty (Easy/Medium/Hard/Deadly) using D&D 5e XP thresholds and monster-count multipliers.
- **`InitiativeTracker`** — Full combat lifecycle: roll initiatives, track HP, apply/remove conditions, log damage. On "End Combat", syncs each player character's final HP back to the `characters` table and broadcasts `character:sync` to the player window.
- **`ConditionManager`** — Manages all 15 D&D 5e conditions plus concentration tracking per combatant.

### Phase 6 — Mind Map

- **`MindMap`** — React Flow graph of all world entities. Node types: NPC, Location, Faction, Item. Edges are loaded from the `connections` table. Features: Dagre auto-layout (Top-Bottom and Left-Right), subgraph highlighting, node position persistence, in-graph edge creation, and PNG export.
- **`AIInsightsPanel`** — Asks the AI to generate a narrative paragraph about the relationships visible in the current graph view.

### Phase 7 — AI Layer

- **`AIAssistant`** — Streaming chat assistant. Campaign context (NPCs, locations, factions) is injected into every prompt. "Rules Q&A Mode" routes through the RAG pipeline instead.
- **`AISources`** — Upload PDFs, monitor indexing status, trigger embedding.
- **RAG pipeline** — Upload PDF → chunk text → embed with Ollama `nomic-embed-text` → store in vectra vector index → semantic search on query → Claude generates grounded answer with page-number source attribution.

### Phase 8 — Player View

See the dedicated section below.

---

## AI Layer

### Mode Detection

On startup, the app checks:
1. Is there a valid Anthropic API key in safeStorage? → **`online`** mode (Claude API)
2. Is Ollama running at `http://localhost:11434`? → **`offline-ollama`** mode
3. Neither → **`no-ai`** mode (all AI features hidden; the rest of the app works fine)

The current mode is shown as a badge in the TopBar.

### Online Mode (Claude API)

- Model: `claude-sonnet-5` (set in `electron/services/AIService.js`)
- Used for: world builder suggestions, character assistant, encounter narration, RAG answer generation, Source Book import extraction
- **Gotcha:** this model string must be a *current, non-retired* model ID. If it points at a retired snapshot, the startup key-validation ping 404s, the app silently falls back to Ollama, and online mode never engages even with a valid key. See `DMCS_Source_Book_Importer.md` → *Recent Work & Gotchas*.
- Streaming responses use `ipcMain` events pushed to the renderer via `webContents.send`

### Offline Mode (Ollama)

- Chat model: whichever model is available locally (tries `llama3` by default)
- Embedding model: `nomic-embed-text` (required for PDF indexing — must be pulled before using AI Sources)
- Ollama must be running before the app starts in order to be detected

### RAG Pipeline Step-by-Step

1. User uploads a PDF via **AI Sources**
2. `PdfIngestionService` parses the file, splits it into ~500-token chunks, stores each chunk in `pdf_chunks` with its page number
3. `EmbeddingService` calls Ollama's `nomic-embed-text` model for each chunk; stores the embedding vector in a `vectra` index file alongside the database
4. When a question is asked in Rules Q&A mode, `RAGService` embeds the query, finds the top-k most similar chunks, and sends them to Claude as context
5. Claude's answer includes source attribution (filename + page number)

---

## Player View (Phase 8)

The player view is a **separate Electron BrowserWindow** opened by the DM. It loads the same Vite bundle but routes to `/player?campaign=<id>`, which renders `PlayerApp` instead of the DM layout.

### Opening the player window

The DM clicks **👥 Player View** in the TopBar to open the `DMPlayerControls` panel, then clicks **Open Player View**.

```javascript
// Programmatically, from any DM-side component:
await window.electronAPI.player.openWindow(activeCampaign.id)
```

### DM Broadcast Channel

All communication from the DM window to the player window goes through the main process relay:

```
DM renderer  →  ipcRenderer.send('player:broadcast', message)
                ↓
main.js      →  playerWindow.webContents.send('player:receive', message)
                ↓
Player renderer  ←  ipcRenderer.on('player:receive', handler)
```

**Message types:**

| Type | Payload | Effect in player window |
|---|---|---|
| `map:set` | `{ mapId }` | Loads and displays the specified map; resets pan/zoom |
| `map:update` | `{ mapId, fogData, tokens }` | Updates fog and tokens on the currently active map live |
| `character:sync` | `{ characterId }` | Re-fetches the character from the DB and refreshes the sheet |
| `session:note` | `{ text, timestamp }` | Appends a note to the floating session notes overlay |
| `ping` | `{}` | Resets the 15-second disconnect timer; keeps status green |

### Auto-sync

When the DM enables **Auto-sync** in the DMPlayerControls panel:
- Every fog brush stroke triggers a debounced (500ms) `map:update` broadcast
- Every token drag triggers an immediate `map:update` broadcast

### Player Window Components

All player-facing components live in `src/components/player/`:

| File | What it does |
|---|---|
| `PlayerTopBar.jsx` | Campaign name, Character/Map nav toggle, connection status, full screen button |
| `PlayerCharacterSelect.jsx` | Grid of character cards for the player to pick from |
| `PlayerCharacterSheet.jsx` | Read-only 4-tab sheet (Stats, Inventory, Spells, Notes) with dice roll buttons |
| `PlayerMapView.jsx` | Hosts `MapCanvas` in player mode; handles `map:set`/`map:update` broadcasts; Shift+hover distance measurement |
| `PlayerMapControls.jsx` | Zoom in/out/reset overlay on the map |
| `PlayerSessionNotes.jsx` | Collapsible floating overlay; gold flash animation on new notes |
| `DMPlayerControls.jsx` | DM-side panel: open/close window, push map, auto-sync toggle, send notes, sync characters |
| `PlayerErrorBoundary.jsx` | Class component error boundary; shows a "Try Again" screen instead of crashing |

### Player-Mode Fog

In `"player"` mode, `MapCanvas` renders fog as **solid black `rgba(0,0,0,1)`** — zero content visible through it. In DM mode it uses a semi-transparent dark overlay so the DM can see what is underneath while painting.

Tokens on fogged cells are **filtered out entirely** in player mode — they do not appear even as outlines.

---

## State Management

### `campaignStore` (persisted)

```javascript
import useCampaignStore from './stores/campaignStore'

const activeCampaign    = useCampaignStore(s => s.activeCampaign)
const setActiveCampaign = useCampaignStore(s => s.setActiveCampaign)
```

Persisted to `localStorage` via Zustand's `persist` middleware. Survives page reloads and Vite HMR. Stores the full campaign object so components can read `activeCampaign.name` without an extra DB call.

### `playerStore` (not persisted)

```javascript
import usePlayerStore from './stores/playerStore'

const showPlayerPanel    = usePlayerStore(s => s.showPlayerPanel)    // boolean — DMPlayerControls panel visible
const setShowPlayerPanel = usePlayerStore(s => s.setShowPlayerPanel)
const playerWindowOpen   = usePlayerStore(s => s.playerWindowOpen)   // boolean — player window is open
const autoSync           = usePlayerStore(s => s.autoSync)           // boolean — fog/token auto-broadcast
```

Used to share player panel state between `TopBar`, `App`, `MapEngine`, and `DMPlayerControls` without prop-drilling. Resets on app restart.

---

## Utility Libraries

All D&D 5e math lives in `src/utils/`. Import from here rather than reimplementing these calculations.

### `dnd5e.js` — Character math

```javascript
import {
  abilityMod,           // (score: number) => number
  modStr,               // (score: number) => "+2" | "-1"  (formatted string)
  profBonus,            // (level: number) => number
  savingThrow,          // (score, level, isProficient) => number
  skillBonus,           // (score, level, isProficient) => number
  passivePerception,    // (wisScore, level, isProficient) => number
  getCasterType,        // (className: string) => "full" | "half" | "third" | null
  spellcastingAbility,  // (className: string) => "int" | "wis" | "cha" | null
  SPELL_SLOTS,          // Nested table: SPELL_SLOTS["full"][level] => number[]
  SKILLS,               // Array<{ key: string, label: string, ability: string }>
} from '../utils/dnd5e'
```

### `fogUtils.js` — Fog bitmask

```javascript
import { isCellRevealed, revealCell, hideCell } from '../utils/fogUtils'

// fogData is a flat number[] bitmask — one number per cell, packed as bits
// numCols = how many grid columns the map has
const revealed = isCellRevealed(fogData, col, row, numCols) // => boolean
```

### `encounterUtils.js` — XP and difficulty

```javascript
import { calcEncounterDifficulty } from '../utils/encounterUtils'

// Returns { totalXP, adjustedXP, difficulty: 'Easy' | 'Medium' | 'Hard' | 'Deadly' }
const result = calcEncounterDifficulty(monsters, partyLevels)
```

---

## Adding a New Feature

### New page / route

1. Create `src/pages/MyFeature.jsx`
2. Import it in `src/App.jsx`
3. Add `<Route path="/myfeature" element={<Guarded><MyFeature /></Guarded>} />` inside the routes block in `AppContent`
4. Add a nav entry in `src/components/Sidebar.jsx`

### New database table

You must touch all four layers of the IPC chain:

1. Write the `CREATE TABLE` SQL as a new `const MIGRATION_006` in `electron/database/DatabaseService.js`
2. Add `{ id: 6, name: 'my_table', sql: MIGRATION_006 }` to the `migrations` array
3. Add CRUD methods to `DatabaseService` following the pattern of existing methods
4. Register `ipcMain.handle` calls in `electron/ipc/dbHandlers.js`
5. Expose the new handlers on `window.electronAPI.db.myTable.*` in `electron/preload.js`
6. Call from React: `await window.electronAPI.db.myTable.getAll(campaignId)`

### New AI feature

1. Add a method to `electron/services/AIService.js` (or create a new service file)
2. Register an `ipcMain.handle` in `electron/ipc/aiHandlers.js`
3. Expose it in `electron/preload.js`
4. For streaming responses, push chunks to the renderer with `event.sender.send('ai:chunk', text)` and listen in React with `window.electronAPI.ai.onChunk(handler)`

---

## Building for Production

```bash
npm run build
```

This runs:
1. `vite build` → outputs the renderer to `dist/renderer/`
2. `electron-builder` → packages everything into `dist/app/`

The built app includes the Electron binary, the React bundle, and the `electron/` source. The SQLite database is created in the user's app data directory on first run — it is **not** bundled.

> **Note:** `better-sqlite3` is a native Node.js module compiled for a specific Electron + Node.js version pair. If you upgrade Electron, run `npm run postinstall` (or `npm install`) to recompile it.

---

## Troubleshooting

### Blank white screen on launch

The Vite dev server wasn't ready when Electron started. Wait a few seconds then press `Ctrl+R` in the app window to reload. If it consistently fails, check the terminal for Vite errors.

### `better-sqlite3` fails with "NODE_MODULE_VERSION mismatch"

The native module was compiled for a different Node.js or Electron version. Fix:

```bash
npm run postinstall
# or explicitly:
./node_modules/.bin/electron-rebuild -f -w better-sqlite3
```

### Where is the database file?

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\dmcs\dmcs.db` |
| macOS | `~/Library/Application Support/dmcs/dmcs.db` |
| Linux | `~/.config/dmcs/dmcs.db` |

You can open this file with [DB Browser for SQLite](https://sqlitebrowser.org/) to inspect or debug data directly.

### SRD never loads / compendium is empty

The SRD seed fetches from `https://www.dnd5eapi.co`. If you were offline during first launch it will have failed silently. Go to **Settings** and click **Re-seed SRD** once you have an internet connection.

### AI badge shows "No AI — Check Settings"

One of:
- No API key saved — go to Settings and paste your Anthropic key
- Ollama is not running — run `ollama serve` in a terminal and restart the app
- The API key is invalid — open DevTools and check the console for the specific error

### Player window won't open

The player window requires an active campaign. Make sure the campaign name is visible in the DM window's TopBar, then click **👥 Player View**.

### Changes to `electron/` don't take effect

The main process does not hot-reload. Quit the app completely (`Ctrl+C` in the terminal) and run `npm run dev` again.

### IPC call returns `undefined`

Either the handler is not registered in `dbHandlers.js` / `aiHandlers.js`, or it is not exposed in `preload.js`. Check both files and verify the channel name matches exactly (case-sensitive).
