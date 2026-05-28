# ⚔ DUNGEON MASTER'S CAMPAIGN SUITE ⚔

**Phase 1 — Foundation**
**Claude Code Agent Prompts 01 – 05**

---

## Prompt Index

| Prompt | Title | Deliverable | Time Est. |
|---|---|---|---|
| **01** | Electron + React Scaffold | Running app with sidebar & 13 routes | 1 – 2 hrs |
| **02** | SQLite DatabaseService | All tables migrated, contextBridge wired | 1 – 2 hrs |
| **03** | SRD API Cache + Progress UI | All 4 SRD resource types cached locally | 1 – 2 hrs |
| **04** | AIService + Settings Page | Claude + Ollama working, key stored securely | 1 – 2 hrs |
| **05** | Campaign Manager | Full CRUD, Zustand store, route guards | 2 – 3 hrs |

*Run prompts in order. Complete all verification steps before proceeding to the next prompt.*

---

## How to Use These Prompts with Claude Code

Each prompt in this document is a complete, self-contained instruction set for Claude Code. Follow this process for every prompt:

**1. Open your terminal in the project folder**
```bash
cd C:\Users\chris\Projects\dmcs   # or wherever you created the project
```

**2. Start a Claude Code session**
```bash
claude
```

**3. Paste the prompt**

Copy everything from the prompt's "Context" section through the final "Verification Steps" section and paste it into the Claude Code prompt. Claude Code will read the full instruction set and execute it.

**4. Watch and verify**

Claude Code will create files, run commands, and report back. Once it finishes, run the verification steps yourself in the Electron DevTools console or PowerShell. Do not proceed until all verification checks pass.

**5. Commit before moving on**
```bash
git add .
git commit -m "Prompt 01 complete: Electron + React scaffold"
```

> **IMPORTANT:** If Claude Code gets stuck or produces an error, paste the error back into the same Claude Code session and ask it to fix the issue. Do not start a new session — context matters.

---

## AGENT PROMPT 01 | Phase 1 — Foundation

### Electron + React Project Scaffold

#### Context

You are building the Dungeon Master's Campaign Suite (DMCS) — an AI-assisted desktop application for tabletop RPG Dungeon Masters. It is built with Electron + React, uses SQLite for local storage, and integrates the Anthropic Claude API with an Ollama offline fallback.

This is Prompt 01 of 05 for Phase 1. Your job is to scaffold the complete project structure — the Electron shell, React renderer, Vite build config, and routing shell with placeholder pages for all 13 modules. No feature logic is written yet. The goal is a running app with a working sidebar and navigation.

#### Your Task

Scaffold the full DMCS project from scratch in the current directory. The user will run this from inside their chosen project folder.

---

**▸ Step 1 — Initialize the project**

```bash
npm create vite@latest . -- --template react
npm install
npm install electron electron-builder concurrently wait-on cross-env --save-dev
npm install react-router-dom zustand
```

---

**▸ Step 2 — Create the Electron main process**

📄 **electron/main.js**

Create this file with the following requirements:

- Import `app`, `BrowserWindow`, `ipcMain`, `shell`, and `safeStorage` from electron
- Create a `createWindow()` function that opens a 1400×900 BrowserWindow with `nodeIntegration: false` and `contextIsolation: true`
- Set `webPreferences.preload` to `path.join(__dirname, 'preload.js')`
- In development, load `http://localhost:5173`. In production, load the built `index.html`
- Handle `app.whenReady()`, `app.on('window-all-closed')`, and `app.on('activate')` lifecycle events
- Export a stub `ipcMain.handle('app:version', () => app.getVersion())` as a placeholder for future IPC handlers

📄 **electron/preload.js**

Create this file with the following requirements:

- Use `contextBridge.exposeInMainWorld` to expose an `electronAPI` object to the renderer
- Expose `getVersion: () => ipcRenderer.invoke('app:version')` as the only method for now
- Add a comment block: `// IPC methods for db, ai, and pdf will be added in Prompt 02-04`

---

**▸ Step 3 — Configure Vite for Electron**

📄 **vite.config.js**

Modify the default Vite config to:

- Set `base` to `"./"` so asset paths work in Electron production builds
- Set `build.outDir` to `"dist/renderer"`
- Keep the React plugin

---

**▸ Step 4 — Update package.json**

Add the following to `package.json`:

```json
"main": "electron/main.js",
"scripts": {
  "dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
  "build": "vite build && electron-builder",
  "electron": "electron ."
},
"build": {
  "appId": "com.dmcs.app",
  "productName": "DM Campaign Suite",
  "directories": { "output": "dist/app" },
  "files": ["dist/renderer/**", "electron/**", "package.json"]
}
```

---

**▸ Step 5 — Build the React app shell**

📄 **src/main.jsx**

Standard React 18 entry point rendering `<App />` into `#root`.

📄 **src/App.jsx**

Create the top-level app layout with:

- `BrowserRouter` from react-router-dom wrapping everything
- A persistent `<Sidebar />` component on the left (240px wide)
- A `<TopBar />` component at the top showing "DM Campaign Suite" and a placeholder campaign name
- `<Routes>` on the right rendering the active module page

📄 **src/components/Sidebar.jsx**

Create a sidebar with `NavLink` items for all 13 modules. Group them into sections:

- **CAMPAIGN:** Campaign Manager
- **WORLD:** World Builder, Lore & Connections, Mind Map
- **MAPS:** Map Engine
- **TOOLS:** Compendium, Character Sheets, Encounter Builder, Combat Calculator
- **AI:** AI Assistant
- **SETTINGS:** Settings

Each NavLink navigates to its route. Active link gets a highlighted background. Use a dark parchment color scheme: sidebar background `#1a1208`, text `#c9a84c`, active background `#2d1f0a`.

📄 **src/components/TopBar.jsx**

Simple top bar showing the app name on the left and a placeholder "No Campaign Loaded" badge on the right. Fixed height 56px, background `#0d0a05`, gold border bottom.

---

**▸ Step 6 — Create placeholder pages for all 13 modules**

Create one file per module in `src/pages/`. Each file exports a default React component that renders a centered placeholder with the module name and a brief description:

```
src/pages/CampaignManager.jsx    — "Manage your campaigns, session notes, and timeline"
src/pages/WorldBuilder.jsx       — "Create towns, NPCs, shops, factions, and regions"
src/pages/LoreConnections.jsx    — "Track narrative threads, secrets, and faction allegiances"
src/pages/MindMap.jsx            — "Visualize connections between NPCs, places, and factions"
src/pages/MapEngine.jsx          — "Grid-based battle maps with fog of war and unit tokens"
src/pages/Compendium.jsx         — "Browse and edit items, spells, and equipment"
src/pages/CharacterSheets.jsx    — "Create and manage player character sheets"
src/pages/EncounterBuilder.jsx   — "Build combat encounters from SRD and custom monsters"
src/pages/CombatCalculator.jsx   — "Calculate encounter difficulty by party and CR"
src/pages/AIAssistant.jsx        — "AI-powered DM suggestions and content generation"
src/pages/Settings.jsx           — "Configure API keys, preferences, and app settings"
```

---

**▸ Step 7 — Wire up routes in App.jsx**

Import all 13 page components and add a `<Route>` for each:

```
/              → CampaignManager (index route)
/world         → WorldBuilder
/lore          → LoreConnections
/mindmap       → MindMap
/maps          → MapEngine
/compendium    → Compendium
/characters    → CharacterSheets
/encounters    → EncounterBuilder
/calculator    → CombatCalculator
/ai            → AIAssistant
/settings      → Settings
```

---

**▸ Step 8 — Add base CSS**

📄 **src/index.css**

Replace default Vite CSS with:

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; background: #0d0a05; color: #e8e0d0; height: 100vh; overflow: hidden; }
#root { display: flex; flex-direction: column; height: 100vh; }
.app-layout { display: flex; flex: 1; overflow: hidden; }
.main-content { flex: 1; overflow-y: auto; padding: 2rem; }
```

---

#### Verification Steps

> **VERIFY:** Run these commands after Claude Code completes. All must pass before moving to Prompt 02.

```bash
npm run dev
```

You should see:

- The Electron window opens at 1400×900
- Dark sidebar on the left with all 13 navigation items grouped into sections
- TopBar at the top showing "DM Campaign Suite"
- Clicking each sidebar link changes the main content area to that module's placeholder page
- No console errors in the Electron DevTools (open with `Ctrl+Shift+I`)

> **IMPORTANT:** Do NOT move to Prompt 02 until the Electron window opens and all sidebar navigation links work correctly.

---

## AGENT PROMPT 02 | Phase 1 — Foundation

### SQLite DatabaseService & Schema Migrations

#### Context

Prompt 01 is complete. The Electron + React shell is running with a working sidebar and 13 placeholder pages. This prompt sets up the entire data layer: SQLite via better-sqlite3, a `DatabaseService` class in the main process, all core table migrations, and a secure contextBridge API so the renderer can read and write data without direct DB access.

#### Your Task

---

**▸ Step 1 — Install better-sqlite3 with Electron compatibility**

> **IMPORTANT:** better-sqlite3 is a native Node module. It must be compiled against Electron's internal Node version, not the system Node. Run both commands exactly as written.

```bash
npm install better-sqlite3
npm install @electron/rebuild --save-dev
npx electron-rebuild -f -w better-sqlite3
```

Add a `postinstall` script to `package.json` so it rebuilds automatically after every `npm install`:

```json
"postinstall": "electron-rebuild -f -w better-sqlite3"
```

---

**▸ Step 2 — Create the DatabaseService**

📄 **electron/database/DatabaseService.js**

Create a class `DatabaseService` with the following:

**Constructor**

- Accept a `dbPath` parameter (full path to the `.db` file)
- Open the database: `this.db = new Database(dbPath)`
- Enable WAL mode immediately: `this.db.pragma('journal_mode = WAL')`
- Enable foreign keys: `this.db.pragma('foreign_keys = ON')`
- Call `this.runMigrations()` at the end of the constructor

**`runMigrations()` method**

Create the migrations table first if it does not exist, then run each migration in order. Each migration has an `id` (integer) and a `name` (string). Only run migrations that have not already been recorded in the migrations table.

**Core schema — run as Migration 001**

Create all of the following tables in a single migration:

- `campaigns` — id, name, description, world_setting, created_at, updated_at, session_count
- `locations` — id, campaign_id → campaigns, name, type (town|dungeon|shop|region|landmark), description, lore, parent_location_id → locations (nullable), created_at
- `factions` — id, campaign_id → campaigns, name, description, alignment, notes, created_at
- `npcs` — id, campaign_id → campaigns, name, race, class, role, location_id → locations (nullable), faction_id → factions (nullable), notes, secrets, motivation, is_alive (DEFAULT 1), created_at
- `connections` — id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes
- `characters` — id, campaign_id → campaigns, player_name, character_name, class, race, level (DEFAULT 1), stats (TEXT/JSON), hp_current, hp_max, inventory (TEXT/JSON), spell_slots (TEXT/JSON), notes, created_at
- `encounters` — id, campaign_id → campaigns, name, location_id → locations (nullable), monsters (TEXT/JSON), status (planned|active|completed DEFAULT planned), xp_total, notes, created_at
- `maps` — id, campaign_id → campaigns, name, location_id → locations (nullable), image_path, grid_size (DEFAULT 50), fog_data (TEXT/JSON), tokens (TEXT/JSON), created_at
- `compendium_custom` — id, campaign_id → campaigns, type (item|spell|equipment|monster), name, data (TEXT/JSON), source (custom|srd|pdf_upload), created_at
- `srd_cache` — id, resource_type, slug, data (TEXT/JSON), cached_at
- `pdf_sources` — id, campaign_id → campaigns, filename, file_path, status (pending|indexed|failed), chunk_count, indexed_at
- `mind_map_positions` — id, campaign_id → campaigns, entity_type, entity_id, x_pos REAL, y_pos REAL

**CRUD helper methods**

- `get(sql, params)` — returns one row or undefined
- `all(sql, params)` — returns array of rows
- `run(sql, params)` — returns `{ lastInsertRowid, changes }`
- `transaction(fn)` — wraps `fn` in a SQLite transaction, rolls back on error

---

**▸ Step 3 — Initialize the DB in main.js**

📄 **electron/main.js**

Add the following to the existing `main.js`:

- Import `DatabaseService` and `path`
- Determine the DB path: `path.join(app.getPath('userData'), 'dmcs.db')`
- Create the DatabaseService instance after `app.whenReady()`: `global.db = new DatabaseService(dbPath)`
- Log the DB path to console on startup so the developer can find it

---

**▸ Step 4 — Expose DB methods via contextBridge**

📄 **electron/ipc/dbHandlers.js**

Create this file to register all IPC handlers for database operations. Import `ipcMain` and `global.db`. Register the following handlers:

```javascript
// Campaigns
ipcMain.handle('db:campaigns:getAll',    () => db.all('SELECT * FROM campaigns ORDER BY updated_at DESC'))
ipcMain.handle('db:campaigns:getById',   (_, id) => db.get('SELECT * FROM campaigns WHERE id = ?', [id]))
ipcMain.handle('db:campaigns:create',    (_, data) => db.run('INSERT INTO campaigns (name, description, world_setting, created_at, updated_at, session_count) VALUES (?,?,?,datetime(\'now\'),datetime(\'now\'),0)', [data.name, data.description, data.world_setting]))
ipcMain.handle('db:campaigns:update',    (_, id, data) => db.run('UPDATE campaigns SET name=?, description=?, updated_at=datetime(\'now\') WHERE id=?', [data.name, data.description, id]))
ipcMain.handle('db:campaigns:delete',    (_, id) => db.run('DELETE FROM campaigns WHERE id=?', [id]))

// NPCs
ipcMain.handle('db:npcs:getAll',         (_, campaignId) => db.all('SELECT * FROM npcs WHERE campaign_id=?', [campaignId]))
ipcMain.handle('db:npcs:create',         (_, data) => db.run('INSERT INTO npcs (campaign_id,name,race,class,role,location_id,faction_id,notes,secrets,motivation,is_alive,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,datetime(\'now\'))', [data.campaign_id,data.name,data.race,data.class,data.role,data.location_id,data.faction_id,data.notes,data.secrets,data.motivation]))
ipcMain.handle('db:npcs:update',         (_, id, data) => db.run('UPDATE npcs SET name=?,race=?,class=?,role=?,notes=?,secrets=?,motivation=?,is_alive=? WHERE id=?', [data.name,data.race,data.class,data.role,data.notes,data.secrets,data.motivation,data.is_alive,id]))
ipcMain.handle('db:npcs:delete',         (_, id) => db.run('DELETE FROM npcs WHERE id=?', [id]))

// Locations
ipcMain.handle('db:locations:getAll',    (_, campaignId) => db.all('SELECT * FROM locations WHERE campaign_id=?', [campaignId]))
ipcMain.handle('db:locations:create',    (_, data) => db.run('INSERT INTO locations (campaign_id,name,type,description,lore,parent_location_id,created_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))', [data.campaign_id,data.name,data.type,data.description,data.lore,data.parent_location_id]))
ipcMain.handle('db:locations:update',    (_, id, data) => db.run('UPDATE locations SET name=?,type=?,description=?,lore=? WHERE id=?', [data.name,data.type,data.description,data.lore,id]))
ipcMain.handle('db:locations:delete',    (_, id) => db.run('DELETE FROM locations WHERE id=?', [id]))

// Connections
ipcMain.handle('db:connections:getAll',  (_, campaignId) => db.all('SELECT c.* FROM connections c JOIN npcs n ON (c.entity_a_id=n.id OR c.entity_b_id=n.id) WHERE n.campaign_id=?', [campaignId]))
ipcMain.handle('db:connections:create',  (_, data) => db.run('INSERT INTO connections (entity_a_type,entity_a_id,entity_b_type,entity_b_id,relationship,notes) VALUES (?,?,?,?,?,?)', [data.entity_a_type,data.entity_a_id,data.entity_b_type,data.entity_b_id,data.relationship,data.notes]))
ipcMain.handle('db:connections:delete',  (_, id) => db.run('DELETE FROM connections WHERE id=?', [id]))
```

📄 **electron/preload.js**

Update `preload.js` to expose all db IPC channels. Replace the stub from Prompt 01 with:

- Expose a `db` object on `electronAPI` containing all the `db:*` methods
- Each method calls `ipcRenderer.invoke` with the correct channel and passes through all arguments
- Group methods by entity: `db.campaigns.getAll()`, `db.npcs.create(data)`, `db.locations.getAll(campaignId)`, etc.

---

**▸ Step 5 — Import dbHandlers in main.js**

Add this line near the top of `main.js` after the DatabaseService initialization:

```javascript
require('./ipc/dbHandlers')
```

---

#### Verification Steps

> **VERIFY:** Open Electron DevTools (`Ctrl+Shift+I`) and run these in the Console tab.

```javascript
// Test 1: contextBridge is working
window.electronAPI.db.campaigns.getAll().then(console.log)
// Expected: resolves to an empty array []

// Test 2: create a campaign
window.electronAPI.db.campaigns.create({
  name: "Test Campaign",
  description: "Phase 1 test",
  world_setting: "Forgotten Realms"
}).then(console.log)
// Expected: { lastInsertRowid: 1, changes: 1 }

// Test 3: read it back
window.electronAPI.db.campaigns.getAll().then(console.log)
// Expected: array with one campaign object
```

> **IMPORTANT:** Do NOT move to Prompt 03 until all three console tests pass with the expected output.

---

## AGENT PROMPT 03 | Phase 1 — Foundation

### SRD API Fetcher, Cache Layer & Progress UI

#### Context

Prompts 01 and 02 are complete. The Electron shell is running and the SQLite database is initialized with all core tables. This prompt builds the SRD (System Reference Document) data layer — a service that fetches D&D 5e monster, spell, equipment, and class data from the free dnd5eapi.co API and caches it permanently to SQLite so the app never makes live API calls during gameplay.

#### Your Task

---

**▸ Step 1 — Create the SRD Service in the main process**

📄 **electron/services/SrdService.js**

Create a class `SrdService` that accepts a `DatabaseService` instance. Implement the following methods:

**`async fetchAndCache(resourceType, slugListUrl)`**

- Fetch the slug list from `slugListUrl` (e.g. `https://www.dnd5eapi.co/api/monsters`)
- The API returns `{ count, results: [{ index, name, url }] }`
- For each slug, check `srd_cache` table: if `cached_at` exists and is less than 30 days old, skip it
- If not cached, fetch `https://www.dnd5eapi.co` + `url` for the full stat block
- Store the full JSON in `srd_cache` as: `resource_type`, `slug` (index field), `data` (JSON.stringify), `cached_at`
- Return `{ total, fetched, skipped }` counts

**`async seedAll(onProgress)`**

Call `fetchAndCache` for each of these four resource types in order. Call `onProgress(percent, message)` after each one:

```javascript
{ type: "monster",   url: "https://www.dnd5eapi.co/api/monsters" }
{ type: "spell",     url: "https://www.dnd5eapi.co/api/spells" }
{ type: "equipment", url: "https://www.dnd5eapi.co/api/equipment" }
{ type: "class",     url: "https://www.dnd5eapi.co/api/classes" }
```

**`getMonsters(filters)`, `getSpells(filters)`, `getEquipment(filters)`**

- Query `srd_cache` WHERE `resource_type = ?` and return parsed JSON data
- Accept optional filters object: `{ name, cr, type }` for monsters; `{ name, level, school }` for spells
- Filter results in JS after fetching from cache (keep queries simple)
- Return array of parsed data objects

---

**▸ Step 2 — Register SRD IPC handlers**

📄 **electron/ipc/srdHandlers.js**

Create this file and register the following IPC handlers:

```javascript
ipcMain.handle('srd:seedAll', async (event) => {
  return srdService.seedAll((percent, message) => {
    event.sender.send('srd:progress', { percent, message })
  })
})

ipcMain.handle('srd:getMonsters',   (_, filters) => srdService.getMonsters(filters))
ipcMain.handle('srd:getSpells',     (_, filters) => srdService.getSpells(filters))
ipcMain.handle('srd:getEquipment',  (_, filters) => srdService.getEquipment(filters))
ipcMain.handle('srd:getCacheStats', () => db.all('SELECT resource_type, COUNT(*) as count FROM srd_cache GROUP BY resource_type'))
```

---

**▸ Step 3 — Expose SRD methods via preload.js**

📄 **electron/preload.js**

Add an `srd` object to the existing `electronAPI` contextBridge exposure:

- `srd.seedAll()` — invokes `srd:seedAll`
- `srd.getMonsters(filters)` — invokes `srd:getMonsters`
- `srd.getSpells(filters)` — invokes `srd:getSpells`
- `srd.getEquipment(filters)` — invokes `srd:getEquipment`
- `srd.getCacheStats()` — invokes `srd:getCacheStats`
- `srd.onProgress(callback)` — uses `ipcRenderer.on('srd:progress', callback)`

---

**▸ Step 4 — Create the SRD Loader UI component**

📄 **src/components/SrdLoader.jsx**

Create a React component that handles the first-launch SRD fetch experience. This component:

- On mount, calls `window.electronAPI.srd.getCacheStats()` to check if data already exists
- If all 4 resource types are cached, renders nothing (returns null) — fetch is complete
- If cache is empty or partial, renders a modal overlay with a progress bar
- Has a "Load Game Data" button that calls `window.electronAPI.srd.seedAll()`
- Listens to `window.electronAPI.srd.onProgress` to update a progress bar (0–100%)
- Shows the current message ("Fetching monsters... 142/332") below the bar
- On completion, hides the modal and shows a "Game data ready!" toast for 3 seconds
- Has a "Skip for now (offline)" button that dismisses the modal without fetching

Style requirements:

- Modal overlay: fixed, full screen, `rgba(0,0,0,0.85)` background
- Modal card: centered, dark parchment background `#1a1208`, gold border, 480px wide
- Progress bar: gold fill (`#c9a84c`) on dark track (`#2d1f0a`), border-radius 4px
- All text in the DMCS color palette (gold headings, parchment body text)

---

**▸ Step 5 — Mount SrdLoader in App.jsx**

Import `SrdLoader` and render it inside the `BrowserRouter` in `App.jsx`, above the layout div. It will handle its own visibility logic internally.

---

**▸ Step 6 — Add require to main.js**

In `main.js`, after the DatabaseService initialization:

```javascript
const SrdService = require('./services/SrdService')
global.srdService = new SrdService(global.db)
require('./ipc/srdHandlers')
```

---

#### Verification Steps

> **VERIFY:** Run `npm run dev`, then open DevTools console and verify:

```javascript
// Test 1: cache stats before seeding (should all be 0)
window.electronAPI.srd.getCacheStats().then(console.log)

// Test 2: click "Load Game Data" in the UI
// Watch the progress bar fill. Monsters alone = 332 entries.
// Full seed takes 2–5 minutes depending on connection.

// Test 3: after completion, check cache stats
window.electronAPI.srd.getCacheStats().then(console.log)
// Expected: [{resource_type:"monster",count:332},{resource_type:"spell",...},...]

// Test 4: query a monster
window.electronAPI.srd.getMonsters({ name: "goblin" }).then(console.log)
// Expected: array containing the goblin stat block object
```

> **IMPORTANT:** Do NOT move to Prompt 04 until `getCacheStats()` shows data for all 4 resource types.

---

## AGENT PROMPT 04 | Phase 1 — Foundation

### AIService — Claude API + Ollama Strategy & Health Check

#### Context

Prompts 01–03 are complete. The app shell is running, SQLite is wired up, and SRD data is cached locally. This prompt builds the AI layer — a strategy-pattern `AIService` that uses the Anthropic Claude API when online and falls back to a local Ollama instance when offline. It also builds the Settings page where the user stores their API key, and a persistent AI status indicator in the TopBar.

#### Your Task

---

**▸ Step 1 — Install the Anthropic SDK**

```bash
npm install @anthropic-ai/sdk
```

---

**▸ Step 2 — Create the AIService**

📄 **electron/services/AIService.js**

Create a class `AIService` with a strategy pattern for online/offline AI. Implement the following:

**`constructor()`**

- Set `this.mode = "offline"` initially
- Set `this.anthropicClient = null`
- Set `this.ollamaBaseUrl = "http://localhost:11434"`
- Set `this.ollamaModel = "llama3"`
- Set `this.anthropicModel = "claude-sonnet-4-20250514"`

**`async initialize(apiKey)`**

- If `apiKey` is provided and non-empty, attempt to ping the Anthropic API with a minimal test message
- If the ping succeeds, set `this.mode = "online"` and initialize `this.anthropicClient = new Anthropic({ apiKey })`
- If the ping fails or no `apiKey`, attempt to ping Ollama: `GET http://localhost:11434/api/tags`
- If Ollama responds, set `this.mode = "offline-ollama"`
- If both fail, set `this.mode = "no-ai"`
- Return `{ mode: this.mode }`

**`async complete(systemPrompt, userMessage, options = {})`**

- If mode is `"online"`: call Claude API using `this.anthropicClient.messages.create()`
  - Pass `model`, `max_tokens: 1024`, `system: systemPrompt`, `messages: [{ role: "user", content: userMessage }]`
  - Return the text content of the first content block
- If mode is `"offline-ollama"`: POST to `http://localhost:11434/api/generate` with `{ model, prompt: userMessage, system: systemPrompt, stream: false }`
  - Return `response.response` field
- If mode is `"no-ai"`: throw `new Error("No AI service available. Please configure an API key or install Ollama.")`

**`getMode()`**

- Return `this.mode` — used by the UI to display the current AI status

---

**▸ Step 3 — Secure API key storage**

📄 **electron/services/KeyService.js**

Create a `KeyService` class using Electron's `safeStorage` to encrypt and decrypt the API key:

- `saveKey(key)`: encrypts with `safeStorage.encryptString(key)` and writes the buffer to `app.getPath("userData")/dmcs.key`
- `loadKey()`: reads the file if it exists, decrypts with `safeStorage.decryptString()`, returns the key string or null
- `deleteKey()`: deletes the key file if it exists
- `hasKey()`: returns boolean — checks if the key file exists

---

**▸ Step 4 — Register AI IPC handlers**

📄 **electron/ipc/aiHandlers.js**

Register the following IPC handlers:

```javascript
ipcMain.handle('ai:initialize', async () => {
  const key = keyService.loadKey()
  return aiService.initialize(key)
})

ipcMain.handle('ai:getMode', () => ({ mode: aiService.getMode() }))

ipcMain.handle('ai:complete', async (_, systemPrompt, userMessage) => {
  return aiService.complete(systemPrompt, userMessage)
})

ipcMain.handle('ai:saveKey', async (_, key) => {
  keyService.saveKey(key)
  return aiService.initialize(key)
})

ipcMain.handle('ai:deleteKey', () => {
  keyService.deleteKey()
  aiService.initialize(null)
  return { success: true }
})

ipcMain.handle('ai:hasKey', () => ({ hasKey: keyService.hasKey() }))
```

---

**▸ Step 5 — Expose AI methods via preload.js**

Add an `ai` object to `electronAPI` in `preload.js`:

- `ai.initialize()` — invokes `ai:initialize`
- `ai.getMode()` — invokes `ai:getMode`
- `ai.complete(systemPrompt, userMessage)` — invokes `ai:complete`
- `ai.saveKey(key)` — invokes `ai:saveKey`
- `ai.deleteKey()` — invokes `ai:deleteKey`
- `ai.hasKey()` — invokes `ai:hasKey`

---

**▸ Step 6 — Initialize AIService in main.js**

Add to `main.js` after the SrdService setup:

```javascript
const AIService  = require('./services/AIService')
const KeyService = require('./services/KeyService')
global.keyService = new KeyService()
global.aiService  = new AIService()
require('./ipc/aiHandlers')

// Auto-initialize AI on startup with saved key (if any)
app.whenReady().then(async () => {
  const savedKey = global.keyService.loadKey()
  const result   = await global.aiService.initialize(savedKey)
  console.log('[AI] Mode:', result.mode)
})
```

---

**▸ Step 7 — Update TopBar with AI status indicator**

📄 **src/components/TopBar.jsx**

Update the TopBar component to show a live AI status badge. On mount, call `window.electronAPI.ai.getMode()` and display one of three states:

- `"online"` → green badge: "Claude API"
- `"offline-ollama"` → amber badge: "Local AI (Ollama)"
- `"no-ai"` → red badge: "No AI — Check Settings"

Clicking the badge navigates to `/settings`.

---

**▸ Step 8 — Build the Settings page**

📄 **src/pages/Settings.jsx**

Replace the placeholder with a functional Settings page containing two sections:

**AI Configuration section**

- A password input field labeled "Anthropic API Key"
- On mount, call `ai.hasKey()` — if true, show "••••••••••••" placeholder and a "Remove Key" button
- "Save Key" button calls `ai.saveKey(inputValue)` and shows the returned mode in a status message
- "Remove Key" button calls `ai.deleteKey()` and clears the input
- A status line showing current mode and a "Test Connection" button that calls `ai.complete("You are a helpful assistant.", "Reply with only the word CONNECTED.")` and shows the response

**Ollama Configuration section**

- Informational text: "Ollama runs locally and requires no API key. Install from ollama.com and run: `ollama pull llama3`"
- A "Check Ollama Status" button that calls `ai.initialize()` and updates the displayed mode

---

#### Verification Steps

> **VERIFY:** Test all three AI modes:

```javascript
// Test 1: Enter your Anthropic API key in Settings and click Save Key
// TopBar badge should turn green and show "Claude API"

// Test 2: Click "Test Connection"
// Should display "CONNECTED" in the status area

// Test 3: Open DevTools console and test directly
window.electronAPI.ai.complete(
  "You are a D&D Dungeon Master assistant.",
  "In one sentence, describe a mysterious tavern."
).then(console.log)
// Expected: a one-sentence tavern description from Claude

// Test 4: Click "Remove Key" — badge should change to Ollama or No AI
```

> **IMPORTANT:** Do NOT move to Prompt 05 until the TopBar badge correctly reflects the AI mode and the Test Connection button returns a real AI response.

---

## AGENT PROMPT 05 | Phase 1 — Foundation

### Campaign Manager — Full CRUD UI + DB Integration

#### Context

Prompts 01–04 are complete. The full foundation is in place: Electron shell, SQLite with all tables, SRD cache, and AI service with Claude + Ollama. This final Phase 1 prompt builds the Campaign Manager — the first real feature module. It is the entry point of the app and the parent container for all world data.

#### Your Task

Build a fully functional Campaign Manager page that allows the DM to create, view, select, and delete campaigns. The selected campaign is stored in global Zustand state and drives all other modules.

---

**▸ Step 1 — Create the campaign Zustand store**

📄 **src/stores/campaignStore.js**

```javascript
import { create } from 'zustand'

const useCampaignStore = create((set) => ({
  campaigns: [],
  activeCampaign: null,

  setCampaigns: (campaigns) => set({ campaigns }),
  setActiveCampaign: (campaign) => set({ activeCampaign: campaign }),
  clearActiveCampaign: () => set({ activeCampaign: null }),
}))

export default useCampaignStore
```

---

**▸ Step 2 — Build the Campaign Manager page**

📄 **src/pages/CampaignManager.jsx**

Replace the placeholder with a full Campaign Manager. The page has two views that toggle based on whether a campaign is active:

**View A — Campaign List (no active campaign)**

- Page header: "Your Campaigns" with a "+ New Campaign" button top right
- On mount, call `window.electronAPI.db.campaigns.getAll()` and display results
- Each campaign renders as a card showing: name (large), description (muted, 2 lines max), world_setting, session_count, and created_at date
- "Load Campaign" button on each card — sets it as the active campaign in Zustand and switches to View B
- "Delete" button on each card — shows a confirmation dialog before calling `db.campaigns.delete(id)` and refreshing the list
- If no campaigns exist, show an empty state: "No campaigns yet. Create your first world." with a centered "+ New Campaign" button

**New Campaign Modal**

- Triggered by the "+ New Campaign" button
- Form fields: Campaign Name (required), Description (textarea), World Setting (text, e.g. "Forgotten Realms", "Homebrew")
- Submit calls `db.campaigns.create(formData)`, refreshes the list, and closes the modal
- Cancel closes the modal without saving
- Modal overlay: same dark parchment style as SrdLoader from Prompt 03

**View B — Active Campaign Dashboard**

- Shows when `activeCampaign` is set in Zustand
- Header: campaign name in large gold text, world setting below it
- A "Switch Campaign" button top right that clears `activeCampaign` and returns to View A
- Four summary stat cards in a 2×2 grid: NPCs (count), Locations (count), Encounters (count), Characters (count)
- Each stat card queries the DB on mount: `db.npcs.getAll(id)`, `db.locations.getAll(id)`, etc. and shows the array length
- A "Session Notes" textarea below the stats — loads from `campaign.description`, auto-saves to `db.campaigns.update()` on blur
- A "Quick Actions" row of buttons: "Add NPC", "Add Location", "New Encounter" — each navigates to the relevant module route

---

**▸ Step 3 — Update TopBar to show active campaign**

📄 **src/components/TopBar.jsx**

Connect the TopBar to the Zustand `campaignStore`:

- Import `useCampaignStore`
- Replace the "No Campaign Loaded" placeholder with: `activeCampaign?.name ?? "No Campaign Loaded"`
- Style: gold text when a campaign is active, muted silver when not

---

**▸ Step 4 — Protect module routes**

📄 **src/components/CampaignGuard.jsx**

Create a wrapper component that checks if `activeCampaign` is set in Zustand. If not, render a centered message: "Select a campaign from the Campaign Manager to use this module." with a button navigating to `/`. If yes, render the children.

Wrap the following routes in `App.jsx` with `CampaignGuard`: `WorldBuilder`, `LoreConnections`, `MindMap`, `MapEngine`, `CharacterSheets`, `EncounterBuilder`, `CombatCalculator`. Leave `CampaignManager`, `Compendium`, `AIAssistant`, and `Settings` unwrapped.

---

**▸ Step 5 — Persist active campaign across reloads**

In the Zustand store, wrap the store with the `persist` middleware from `zustand/middleware`:

- Persist only the `activeCampaign.id` (not the full object) to localStorage under the key `"dmcs-active-campaign"`
- On app load in `CampaignManager.jsx`, if a persisted campaign ID exists, call `db.campaigns.getById(id)` and restore the `activeCampaign` in the store
- If the campaign no longer exists (was deleted), clear the persisted value and show View A

---

#### Verification Steps

> **VERIFY:** Walk through this full flow before declaring Phase 1 complete:

- Open the app — TopBar shows "No Campaign Loaded" in silver
- Campaign Manager shows the empty state (no campaigns exist yet)
- Click "+ New Campaign", fill in the form, submit — campaign appears in the list
- Click "Load Campaign" — TopBar updates to show the campaign name in gold
- Navigate to World Builder in the sidebar — it loads (no guard message since campaign is active)
- Refresh the app (`Ctrl+R`) — active campaign is restored from localStorage
- Go to Settings — AI status shows correctly, Test Connection works
- Return to Campaign Manager, click "Switch Campaign" — TopBar reverts to "No Campaign Loaded"
- Navigate to World Builder — CampaignGuard shows the "Select a campaign" message

> **VERIFY:** Phase 1 is complete when this entire flow works end to end without errors. Commit everything to Git before starting Phase 2.

```bash
git add .
git commit -m "Phase 1 complete: Electron shell, SQLite, SRD cache, AI service, Campaign Manager"
git push
```

---

*Run each prompt in order. Do not skip verification steps.*
