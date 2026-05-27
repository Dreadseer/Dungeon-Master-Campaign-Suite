# ⚔ DUNGEON MASTER'S CAMPAIGN SUITE ⚔

**AI-Assisted Desktop Application — Full System Specification**

*Version 1.0 | Electron + React | SQLite | Claude API + Ollama*

---

## 1. Project Overview

The Dungeon Master's Campaign Suite (DMCS) is an AI-assisted desktop application built for tabletop RPG Dungeon Masters. It centralizes world-building, map management, encounter planning, character tracking, and AI-powered content generation into a single offline-capable tool. All data lives locally on the DM's machine in a portable SQLite database.

| Field | Details |
|---|---|
| **Project Name** | Dungeon Master's Campaign Suite (DMCS) |
| **Platform** | Desktop — Electron + React |
| **Database** | SQLite via better-sqlite3 (single portable .db file) |
| **Source Material** | D&D 5e SRD API (online) + User PDF uploads (local RAG) |
| **AI — Online** | Anthropic Claude API (claude-sonnet-4) |
| **AI — Offline** | Ollama + local model (llama3 or mistral) |
| **Map Engine** | React-Konva (canvas-based grid renderer) |
| **Mind Maps** | React Flow (node/edge relationship graphs) |
| **Primary User** | Dungeon Master (DM view) + Optional Player view |
| **Build Strategy** | Phased — Core World Builder → Tools → AI Layer |

---

## 2. Build Phases & Roadmap

The project is built in 8 sequential phases. Each phase produces a working, testable increment. Phases 1–2 are the foundation that all other modules depend on.

| Phase | Name | Modules | Est. Weeks |
|---|---|---|---|
| **1** | **Foundation** | Electron shell, SQLite schema, SRD API integration, project scaffold | 2 – 3 |
| **2** | **World Builder** | Campaign manager, Towns, NPCs, Shops, Lore, Connections DB | 3 – 4 |
| **3** | **Map Engine** | Grid renderer, Fog of war, Unit placement & movement | 3 – 4 |
| **4** | **Compendium & Sheets** | Items, Spells, Equipment CRUD; Player character sheets | 2 – 3 |
| **5** | **Encounter Tools** | Encounter builder, CR calculator, Initiative tracker | 2 – 3 |
| **6** | **Mind Maps** | React Flow graph views for NPCs, places, factions | 1 – 2 |
| **7** | **AI Layer** | RAG pipeline, PDF ingestion, Claude API + Ollama integration | 3 – 4 |
| **8** | **Player View** | Separate player-facing UI, character sheet access, map reveal | 2 – 3 |

*Note: estimates assume solo developer working part-time. Adjust based on team size and availability.*

---

## 3. Module Specifications

The application is divided into 13 modules. Each module is a self-contained React component tree with its own SQLite data layer, AI hooks, and routing context.

| # | Module | Description | Key Features | Tech |
|---|---|---|---|---|
| **M1** | **Campaign Manager** | Top-level container for all campaign data; create, switch, archive campaigns | Campaign CRUD, metadata, session notes, timeline log | SQLite, React |
| **M2** | **World Builder** | Create and manage towns, regions, shops, factions, and NPCs with relationships | Entity CRUD, tag system, relationship links, lore notes | SQLite, React |
| **M3** | **Lore & Connections** | Track narrative threads, secrets, and faction allegiances across the world | Lore entries, secret flags, NPC motivation tracker | SQLite, React |
| **M4** | **Mind Map View** | Visual graph of connections between NPCs, places, factions, and items | Node/edge graph, filter by type, click-to-navigate | React Flow |
| **M5** | **Map Engine** | Grid-based map editor with image overlay, fog of war, and unit tokens | Grid render, pan/zoom, fog toggle, token placement | React-Konva |
| **M6** | **Unit Movement** | Move and track tokens on the map; support for player and monster units | Drag-to-move, path highlight, turn order sync | React-Konva |
| **M7** | **Compendium** | Browseable and editable reference for items, spells, and equipment | SRD data display, custom entry CRUD, search/filter | SQLite, SRD API |
| **M8** | **Character Sheets** | Full 5e player character sheets — creation, stats, inventory, leveling | Stat blocks, HP tracker, inventory, spell slots | SQLite, React |
| **M9** | **Encounter Builder** | Build and manage combat encounters from SRD + custom monsters | Drag-drop monsters, XP budget, initiative roller | SQLite, SRD API |
| **M10** | **Combat Calculator** | Calculate encounter difficulty by party size, level, and monster CR | XP thresholds, CR adjuster, multi-monster math | React, JS logic |
| **M11** | **Source Material AI** | Query SRD and uploaded PDFs using RAG; AI answers rule questions | PDF ingestion, chunk+embed, semantic search, Q&A | pdf-parse, vectra, Claude API |
| **M12** | **AI DM Assistant** | AI suggests NPC dialogue, encounter hooks, lore continuity, and descriptions | Context-aware prompts, campaign memory, suggestions panel | Claude API, Ollama |
| **M13** | **Player View** | Separate read-only UI for players; access own sheet, see revealed map areas | Role-based access, map fog sync, sheet read-only | React, Electron IPC |

---

## 4. Data Architecture

### 4.1 SQLite Database Design

All campaign data is stored in a single SQLite file (`campaign.db`) per campaign. The file is portable — a DM can copy it, back it up, or share it. The schema uses foreign keys throughout and enables WAL mode for safe concurrent reads from the player view.

#### Core Tables

**campaigns**
- `id` INTEGER PRIMARY KEY
- `name` TEXT NOT NULL
- `description` TEXT
- `created_at` DATETIME
- `session_count` INTEGER DEFAULT 0

**npcs**
- `id` INTEGER PRIMARY KEY
- `campaign_id` INTEGER → campaigns.id
- `name` TEXT NOT NULL
- `race` TEXT
- `class` TEXT
- `role` TEXT
- `location_id` INTEGER → locations.id
- `faction_id` INTEGER → factions.id
- `notes` TEXT
- `secrets` TEXT
- `motivation` TEXT
- `is_alive` BOOLEAN DEFAULT 1

**locations**
- `id` INTEGER PRIMARY KEY
- `campaign_id` INTEGER → campaigns.id
- `name` TEXT NOT NULL
- `type` TEXT (town | dungeon | shop | region | landmark)
- `description` TEXT
- `lore` TEXT
- `parent_location_id` INTEGER → locations.id (nullable)

**connections**
- `id` INTEGER PRIMARY KEY
- `entity_a_type` TEXT (npc | location | faction | item)
- `entity_a_id` INTEGER
- `entity_b_type` TEXT
- `entity_b_id` INTEGER
- `relationship` TEXT (ally | enemy | member | owns | knows | etc.)
- `notes` TEXT

**characters**
- `id` INTEGER PRIMARY KEY
- `campaign_id` INTEGER → campaigns.id
- `player_name` TEXT
- `character_name` TEXT NOT NULL
- `class` TEXT
- `race` TEXT
- `level` INTEGER DEFAULT 1
- `stats` TEXT (JSON: STR/DEX/CON/INT/WIS/CHA)
- `hp_current` INTEGER
- `hp_max` INTEGER
- `inventory` TEXT (JSON array)
- `spell_slots` TEXT (JSON)
- `notes` TEXT

**encounters**
- `id` INTEGER PRIMARY KEY
- `campaign_id` INTEGER → campaigns.id
- `name` TEXT
- `location_id` INTEGER → locations.id
- `monsters` TEXT (JSON: [{monster_id, count, custom_hp}])
- `status` TEXT (planned | active | completed)
- `xp_total` INTEGER
- `notes` TEXT

**maps**
- `id` INTEGER PRIMARY KEY
- `campaign_id` INTEGER → campaigns.id
- `name` TEXT
- `location_id` INTEGER → locations.id
- `image_path` TEXT (local file path)
- `grid_size` INTEGER DEFAULT 50 (pixels per cell)
- `fog_data` TEXT (JSON bitmask of revealed cells)
- `tokens` TEXT (JSON array of {unit_id, x, y, color})

**compendium_custom**
- `id` INTEGER PRIMARY KEY
- `campaign_id` INTEGER → campaigns.id
- `type` TEXT (item | spell | equipment | monster)
- `name` TEXT NOT NULL
- `data` TEXT (JSON — flexible schema per type)
- `source` TEXT (custom | srd | pdf_upload)

---

### 4.2 SRD API Integration

The D&D 5th Edition SRD API (`https://www.dnd5eapi.co/api`) provides free, structured JSON for monsters, spells, classes, items, and more. All SRD data is fetched on first launch and cached to SQLite — the app never makes live API calls during gameplay.

- `GET /api/monsters` — returns full monster stat blocks including CR, HP, actions, abilities
- `GET /api/spells` — returns all SRD spells with level, school, components, description
- `GET /api/equipment` — returns weapons, armor, and adventuring gear
- `GET /api/classes` — returns class hit dice, proficiencies, and feature progressions
- **Cache strategy:** store full JSON blob in `srd_cache` table keyed by endpoint + slug
- **Refresh strategy:** version check on app launch; only re-fetch if SRD version changes

---

### 4.3 PDF Upload & RAG Pipeline

When a DM uploads a sourcebook PDF, the application runs it through a 4-step RAG (Retrieval-Augmented Generation) pipeline so the AI can answer rule questions grounded in the actual book text.

- **Step 1 — Extract:** pdf-parse converts PDF pages to raw text strings
- **Step 2 — Chunk:** text is split into ~400 token overlapping chunks with metadata (page, source filename)
- **Step 3 — Embed:** each chunk is embedded using a local embedding model (nomic-embed-text via Ollama)
- **Step 4 — Store:** embeddings stored in vectra local vector index; text chunks stored in SQLite
- **Query flow:** user question → embed query → vector similarity search → top-5 chunks → Claude API with chunks as context
- **Source attribution:** every AI answer displays the source chunk and page number it referenced

---

## 5. AI Architecture

### 5.1 Online Mode — Claude API

When the DM has internet access, the app uses the Anthropic Claude API (claude-sonnet-4) for high-quality generation and reasoning. The AI is used as a DM assistant — it never makes autonomous decisions or changes campaign data without explicit DM approval.

- **NPC dialogue generation:** "Generate what Mira the innkeeper might say when the party asks about the missing merchant"
- **Encounter hooks:** "Write a 2-sentence hook introducing this dungeon encounter" — uses location lore as context
- **Lore consistency check:** "Does this new faction conflict with existing campaign history?" — campaign data injected as context
- **Description generation:** "Describe this town for the players" — pulls location notes, connected NPCs, and current season
- **Rule clarification:** "How does Counterspell interact with a reaction?" — queries RAG index first, then prompts Claude with retrieved chunks

---

### 5.2 Offline Mode — Ollama

When offline, the app falls back to a locally-running Ollama instance. The DM must install Ollama separately and pull a model (llama3 recommended). The app detects Ollama availability at startup via a health-check ping.

- **Model recommendation:** llama3:8b (balance of quality and speed on most DM machines)
- **Offline capabilities:** NPC dialogue, descriptions, encounter hooks (same prompts as online mode)
- **Offline limitations:** lower output quality; RAG still works (embeddings are local); no internet rule lookups
- **UI indicator:** clear "OFFLINE — Local AI" badge in the assistant panel when Ollama is active
- **Switching:** app automatically uses Claude API when online; falls back to Ollama if API unreachable

---

### 5.3 AI Prompt Strategy

All AI prompts are built from templates that inject relevant campaign context. The DM's data is never sent to the API without explicit action. Context is always minimal and scoped to the task.

- **System prompt:** establishes DM assistant role, game system (D&D 5e), and output format expectations
- **Campaign context injection:** active campaign name, current location, relevant NPC list, recent session notes
- **RAG context injection:** top-5 retrieved source chunks prepended to user query for rule questions
- **Output format:** AI responses are plain text; structured generation (stat blocks, items) requests JSON output
- **Approval gate:** all AI suggestions appear in a review panel — DM explicitly saves to campaign or discards

---

## 6. UI Architecture

### 6.1 Application Shell

The Electron shell hosts a single React SPA. Navigation is sidebar-based with a persistent campaign context bar at the top. The DM view and Player view are separate Electron windows sharing the same SQLite database via Electron IPC.

- **Sidebar:** Campaign Manager, World Builder, Maps, Compendium, Characters, Encounters, AI Assistant
- **Top bar:** active campaign name, session timer, online/offline AI indicator, player view toggle
- **State management:** Zustand for global campaign state; React Query for SQLite data fetching
- **Routing:** React Router v6 with nested routes per module
- **Theming:** dark parchment theme (DM view), lighter theme (Player view); CSS custom properties

---

### 6.2 Map Engine Details

The map module uses React-Konva (a React wrapper for Konva.js canvas library) to render grid-based battle maps. Maps support image overlays (imported PNG/JPG), a configurable grid, fog of war, and draggable unit tokens.

- **Grid:** configurable cell size (default 5ft = 50px); snap-to-grid for all token movement
- **Image overlay:** DM imports a map image; grid overlays on top with adjustable opacity
- **Fog of war:** cell-level bitmask stored in SQLite; DM reveals/hides cells; players see only revealed cells
- **Tokens:** circular icons with color-coded rings (party = blue, enemy = red, NPC = yellow)
- **Token data:** linked to character or monster record; click token to open stat block panel
- **Pan & zoom:** mouse wheel zoom, middle-click pan; pinch zoom on trackpad
- **DM vs Player:** DM sees full map + fog editor; Player view shows only revealed cells in read-only mode

---

### 6.3 Mind Map View Details

The Mind Map module uses React Flow to render an interactive node/edge graph of connections between entities. Every NPC, location, faction, and major item in the campaign is a node. Connections table records are edges.

- **Node types:** NPC (person icon), Location (castle icon), Faction (shield icon), Item (gem icon)
- **Edge labels:** relationship type from connections table (ally, enemy, member, owns, etc.)
- **Filters:** toggle visibility by entity type, faction, or location
- **Click-to-navigate:** clicking a node opens the full entity record in World Builder
- **Auto-layout:** Dagre algorithm for initial layout; DM can drag nodes to custom positions (positions saved to DB)

---

## 7. Encounter Builder & Combat Calculator

### 7.1 Encounter Builder

The encounter builder lets the DM assemble a combat encounter by selecting monsters from the SRD + custom compendium, assigning counts, and linking the encounter to a map and location.

- **Monster search:** filter SRD + custom monsters by CR, type, environment
- **Drag-to-add:** drag monsters from search panel into the encounter roster
- **Per-monster overrides:** custom HP, custom name, notes (e.g. "this one is the leader")
- **XP calculation:** auto-sums monster XP values and applies 5e multipliers for multiple monsters
- **Map link:** optionally link encounter to a map; tokens auto-populate from encounter roster
- **Initiative roller:** click to roll initiative for all monsters; displays initiative order list

---

### 7.2 Combat Calculator

The combat calculator helps the DM assess encounter difficulty before running it, using the D&D 5e XP threshold system (Easy, Medium, Hard, Deadly) based on party composition.

- **Inputs:** number of players, average party level (or per-player levels), monster list with CRs
- **Outputs:** total adjusted XP, difficulty rating (Easy / Medium / Hard / Deadly), XP per player
- **Multiplier table:** 5e standard multipliers (×1 for 1 monster, ×1.5 for 2, up to ×4 for 15+)
- **Party XP thresholds:** auto-calculated from 5e DMG table based on character levels
- **Recommendation engine:** AI can suggest adding/removing monsters to hit a target difficulty
- **History:** completed encounters logged with actual outcome notes for campaign reference

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **PDF parsing accuracy** | High | Use pdfjs-dist with fallback manual chunking; allow user to review extracted text |
| **RAG hallucination** | High | Always show source chunk alongside AI answer; include confidence indicator |
| **Electron bundle size** | Medium | Use lazy loading for heavy modules (Konva, ReactFlow); defer Ollama model download |
| **Ollama offline model quality** | Medium | Use llama3-8b minimum; clearly label offline vs online AI responses |
| **SQLite concurrency (player view)** | Medium | Use WAL mode; separate read connection for player view; avoid write conflicts |
| **SRD API rate limits** | Low | Cache all SRD responses to SQLite on first load; only re-fetch on version change |
| **Canvas performance (large maps)** | Medium | Virtualize off-screen tiles; limit token count per scene; use requestAnimationFrame |

---

## 9. Phase 1 — First Sprint Checklist

Before any feature module is built, the following foundation must be in place. This is the deliverable for Phase 1.

### Electron + React Scaffold

- [ ] Create Electron app with React renderer via electron-vite or Create React App + electron-builder
- [ ] Configure main process (`main.js`) and renderer process (`App.jsx`) with proper IPC bridge
- [ ] Set up React Router v6 with placeholder routes for all 13 modules
- [ ] Implement sidebar navigation shell with campaign context bar

### SQLite Setup

- [ ] Install better-sqlite3 in Electron main process
- [ ] Create `DatabaseService` class with connection pool, WAL mode, and migration runner
- [ ] Run initial schema migration creating all core tables (campaigns, npcs, locations, connections, characters, encounters, maps, compendium_custom)
- [ ] Expose DB methods to renderer via `contextBridge` (never expose raw DB to renderer)

### SRD API Cache

- [ ] On first launch, fetch monsters, spells, equipment, and classes from dnd5eapi.co
- [ ] Store full JSON responses in `srd_cache` table keyed by resource type + slug
- [ ] Show progress bar during initial SRD fetch; allow skip for offline-first start
- [ ] Verify cache health on each launch; re-fetch stale entries silently in background

### Claude API + Ollama Integration

- [ ] Create `AIService` class with `online()` and `offline()` strategy pattern
- [ ] Online: POST to Anthropic `/v1/messages` with model `claude-sonnet-4`
- [ ] Offline: POST to Ollama `/api/generate` with configurable model name
- [ ] Health check on launch: ping Anthropic API (with key) → if fail, ping Ollama → set mode
- [ ] Store API key in Electron `safeStorage` (encrypted OS keychain, never in plain files)

---

## 10. Next Steps

With this spec approved, the recommended next action is to scaffold Phase 1 using the following agent prompt sequence:

- **Agent Prompt 01** — Electron + React project scaffold with routing shell
- **Agent Prompt 02** — SQLite DatabaseService, schema migrations, contextBridge wiring
- **Agent Prompt 03** — SRD API fetcher, cache layer, and progress UI
- **Agent Prompt 04** — AIService with Claude + Ollama strategy and health check
- **Agent Prompt 05** — Campaign Manager module (CRUD UI + DB integration)

*Each agent prompt should reference this spec document as its source of truth and be written in the numbered format used for Rocket Food Delivery Module 11.*

---

*⚔ End of Specification ⚔*

*Confidential — For Development Use Only*
