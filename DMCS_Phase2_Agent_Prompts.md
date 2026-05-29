# ⚔ DMCS — Phase 2 Agent Prompts
## World Builder — Claude Code Edition

> **Save this file as:** `DMCS_Phase2_Agent_Prompts.md`
> Place it in the root of your project folder alongside the spec and rules documents.

**Modules covered:** Factions · Locations · NPCs · Lore · Connections · Dashboard · Search

---

## Prompt Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | Factions & Locations CRUD | EntityCard, EntityModal components; full Factions + Locations pages | 2 – 3 hrs |
| 02 | NPC Builder | NPCModal with 2-tab layout; alive/dead status; filter bar; join queries | 2 – 3 hrs |
| 03 | Lore & Connections | Lore journal; Connection manager; entity name resolution; NPC connection tab | 2 – 3 hrs |
| 04 | World Builder Dashboard | Dashboard with stats, recent entities, AI suggestions; useWorldData hook | 2 – 3 hrs |
| 05 | Search, Filters & Polish | Global world search; improved filters; skeletons; NPC quick-view; audit | 2 – 3 hrs |

*Total estimated time: 10 – 15 hours*

> **⚔ RULE:** Before starting any prompt in this document, open your Claude Code session using the Master Session Opener from `DMCS_Claude_Code_Rules.md`. Update the filename reference in the opener to `DMCS_Phase2_Agent_Prompts.md` for Phase 2.

---

## Agent Prompt 01 — Factions & Locations CRUD
### *Towns, regions, shops, dungeons, and the factions that control them*

---

### Context

Phase 1 is complete. The Electron shell, SQLite database, SRD cache, AI service, and Campaign Manager are all working. The active campaign is tracked in Zustand and all module routes are guarded by CampaignGuard.

This is Prompt 01 of 05 for Phase 2. You are building the Factions and Locations modules — the two foundational entity types that everything else in the World Builder connects to. NPCs live in locations and belong to factions. Encounters are tied to locations. Maps are linked to locations. Get these right and the rest of Phase 2 snaps into place.

---

### Your Task

#### ▸ Step 1 — Install no new packages

Phase 1 already installed everything needed for this prompt. Do not add any new npm packages. Verify better-sqlite3 is still working:

```bash
node -e "require('better-sqlite3'); console.log('SQLite OK')"
```

---

#### ▸ Step 2 — Add DB helper methods for Factions & Locations

📄 `electron/ipc/dbHandlers.js`

Add the following IPC handlers to the existing dbHandlers.js file. Do not replace existing handlers — append to the file:

**Faction handlers:**

```javascript
// Factions
ipcMain.handle('db:factions:getAll', (_, campaignId) =>
  db.all('SELECT * FROM factions WHERE campaign_id = ? ORDER BY name ASC', [campaignId]))

ipcMain.handle('db:factions:getById', (_, id) =>
  db.get('SELECT * FROM factions WHERE id = ?', [id]))

ipcMain.handle('db:factions:create', (_, data) =>
  db.run(
    'INSERT INTO factions (campaign_id, name, description, alignment, notes, created_at) VALUES (?,?,?,?,?,datetime(\'now\'))',
    [data.campaign_id, data.name, data.description, data.alignment, data.notes]
  ))

ipcMain.handle('db:factions:update', (_, id, data) =>
  db.run(
    'UPDATE factions SET name=?, description=?, alignment=?, notes=? WHERE id=?',
    [data.name, data.description, data.alignment, data.notes, id]
  ))

ipcMain.handle('db:factions:delete', (_, id) =>
  db.run('DELETE FROM factions WHERE id=?', [id]))
```

**Location handlers:**

```javascript
// Locations
ipcMain.handle('db:locations:getAll', (_, campaignId) =>
  db.all(`
    SELECT l.*, p.name as parent_name
    FROM locations l
    LEFT JOIN locations p ON l.parent_location_id = p.id
    WHERE l.campaign_id = ?
    ORDER BY l.name ASC
  `, [campaignId]))

ipcMain.handle('db:locations:getById', (_, id) =>
  db.get('SELECT * FROM locations WHERE id = ?', [id]))

ipcMain.handle('db:locations:getByType', (_, campaignId, type) =>
  db.all('SELECT * FROM locations WHERE campaign_id = ? AND type = ? ORDER BY name ASC', [campaignId, type]))

ipcMain.handle('db:locations:create', (_, data) =>
  db.run(
    'INSERT INTO locations (campaign_id, name, type, description, lore, parent_location_id, created_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))',
    [data.campaign_id, data.name, data.type, data.description, data.lore, data.parent_location_id ?? null]
  ))

ipcMain.handle('db:locations:update', (_, id, data) =>
  db.run(
    'UPDATE locations SET name=?, type=?, description=?, lore=?, parent_location_id=? WHERE id=?',
    [data.name, data.type, data.description, data.lore, data.parent_location_id ?? null, id]
  ))

ipcMain.handle('db:locations:delete', (_, id) =>
  db.run('DELETE FROM locations WHERE id=?', [id]))
```

---

#### ▸ Step 3 — Expose new handlers in preload.js

📄 `electron/preload.js`

Add factions and locations to the db object in the contextBridge exposure. Append to the existing db object — do not replace the campaigns, npcs, or connections entries:

- `db.factions.getAll(campaignId)`
- `db.factions.getById(id)`
- `db.factions.create(data)`
- `db.factions.update(id, data)`
- `db.factions.delete(id)`
- `db.locations.getAll(campaignId)`
- `db.locations.getById(id)`
- `db.locations.getByType(campaignId, type)`
- `db.locations.create(data)`
- `db.locations.update(id, data)`
- `db.locations.delete(id)`

---

#### ▸ Step 4 — Create shared form components

📄 `src/components/world/EntityModal.jsx`

Create a reusable modal wrapper component used by all World Builder forms. Props:

- `title` (string) — shown in the modal header
- `isOpen` (boolean) — controls visibility
- `onClose` (function) — called when overlay or X button is clicked
- `children` — the form content

Style: fixed full-screen overlay `rgba(0,0,0,0.8)`, centered card 560px wide, dark parchment background `#1a1208`, gold border, header with title in gold Georgia font, X close button top right, scrollable body up to 80vh.

📄 `src/components/world/EntityCard.jsx`

Create a reusable card component for displaying any world entity in a list. Props:

- `title` (string) — entity name
- `subtitle` (string) — type, role, or location
- `tags` (array of strings) — rendered as small colored badges
- `meta` (string) — small muted text bottom right (e.g. "Created Jan 2025")
- `onClick` (function) — opens detail/edit view
- `onDelete` (function) — shows inline confirmation before calling back
- `accentColor` (string hex) — left border color, defaults to gold

Style: dark card background `#0d0a05`, left border 4px with accentColor, gold title, silver subtitle, parchment body text. Hover state: slightly lighter background.

---

#### ▸ Step 5 — Build the Factions page

📄 `src/pages/world/Factions.jsx`

**List view:**
- On mount, call `db.factions.getAll(activeCampaign.id)` and display results using EntityCard
- Card shows: faction name (title), alignment (subtitle), description preview (first 100 chars), created date (meta)
- "+ New Faction" button top right opens the create modal
- Clicking a card opens the edit modal pre-filled with that faction's data
- Empty state: "No factions yet. Great stories need sides to take." with a centered create button

**Create / Edit modal (EntityModal wrapper):**

Form fields:
- Faction Name — text input, required
- Alignment — select dropdown: Lawful Good, Neutral Good, Chaotic Good, Lawful Neutral, True Neutral, Chaotic Neutral, Lawful Evil, Neutral Evil, Chaotic Evil, Unknown
- Description — textarea, 3 rows, brief faction summary
- Notes — textarea, 5 rows, DM private notes about this faction
- Submit button: "Create Faction" (create) or "Save Changes" (edit)
- On create: `db.factions.create({ ...formData, campaign_id: activeCampaign.id })`, refresh list, close modal
- On edit: `db.factions.update(id, formData)`, refresh list, close modal

**Delete:**
- EntityCard onDelete calls `db.factions.delete(id)`, then refreshes the list
- Confirmation text: "Delete [name]? Any NPCs linked to this faction will become unaffiliated."

---

#### ▸ Step 6 — Build the Locations page

📄 `src/pages/world/Locations.jsx`

**List view with type filter tabs:**
- Tab bar at top: All | Town | Dungeon | Shop | Region | Landmark
- Selecting a tab filters the list. "All" shows everything.
- Each location renders as an EntityCard:
  - title: location name
  - subtitle: type badge + parent location name if set (e.g. "Shop in Riverdale")
  - tags: ["Has Lore"] if lore field is non-empty, ["Sub-location"] if parent set
  - meta: created date
- Empty state per tab: "No [type]s yet. Add your first one."

**Create / Edit modal form fields:**
- Location Name — text input, required
- Type — select dropdown: town, dungeon, shop, region, landmark
- Parent Location — optional select dropdown populated from `db.locations.getAll()`. Label: "Located within..." Placeholder: "None (top-level location)"
- Description — textarea, 3 rows, player-facing description
- Lore — textarea, 5 rows, DM-only lore and history notes
- Submit: "Create Location" / "Save Changes"
- On submit: validate no location is its own parent. If invalid, show inline error.

**Location hierarchy display:**
- If a location has a parent, show a breadcrumb below the card title: "[Parent Name] > [This Name]"
- Clicking the parent name in the breadcrumb opens that parent's edit modal

---

#### ▸ Step 7 — Add routes and sidebar links

📄 `src/App.jsx`

```
/world/factions    → src/pages/world/Factions.jsx
/world/locations   → src/pages/world/Locations.jsx
```

📄 `src/components/Sidebar.jsx`

Under the WORLD section, add sub-navigation links:
- Factions → `/world/factions`
- Locations → `/world/locations`

Keep the existing World Builder link pointing to `/world` as the section landing page.

---

### Verification Steps

> **✓ VERIFY:** Run `npm run dev` and walk through the full flow:

```javascript
// In DevTools console — test factions IPC
const cid = 1 // use your actual campaign id
await window.electronAPI.db.factions.create({ campaign_id: cid, name: "The Iron Wolves", description: "A mercenary band", alignment: "Chaotic Neutral", notes: "Secret: they work for the Duke" })
// Expected: { lastInsertRowid: 1, changes: 1 }

await window.electronAPI.db.factions.getAll(cid)
// Expected: array with Iron Wolves faction

// In DevTools console — test locations IPC
await window.electronAPI.db.locations.create({ campaign_id: cid, name: "Riverdale", type: "town", description: "A quiet riverside town", lore: "Founded 200 years ago by dwarven miners", parent_location_id: null })
// Expected: { lastInsertRowid: 1, changes: 1 }

await window.electronAPI.db.locations.getAll(cid)
// Expected: array with Riverdale, including parent_name: null
```

- Navigate to `/world/factions` — faction list loads, create modal works, edit modal pre-fills correctly
- Navigate to `/world/locations` — location list loads, type filter tabs work, parent dropdown populates
- Create a sub-location (e.g. "The Rusty Flagon" shop, parent: Riverdale) — breadcrumb shows correctly
- Delete a faction — confirmation dialog appears, faction removed from list after confirm

> **⚠ WARNING:** Do NOT move to Prompt 02 until all IPC console tests pass and both UI pages are functional with create, edit, and delete working correctly.

---

## Agent Prompt 02 — NPC Builder
### *Full NPC creation, stat tracking, and linking to locations & factions*

---

### Context

Prompt 01 is complete. Factions and Locations are fully functional with CRUD operations and IPC wiring. This prompt builds the NPC module — the most frequently used entity in the World Builder. Every NPC links to a location (where they live) and optionally a faction (who they serve). NPCs also have motivation, secrets, and alive/dead status — the fields that make them feel real at the table.

---

### Your Task

#### ▸ Step 1 — Extend NPC IPC handlers

📄 `electron/ipc/dbHandlers.js`

The Phase 1 NPC handlers only covered basic fields. Replace the existing NPC handlers with these expanded versions that include JOIN queries for location and faction names:

```javascript
// NPCs — replace existing NPC handlers
ipcMain.handle('db:npcs:getAll', (_, campaignId) =>
  db.all(`
    SELECT n.*,
           l.name as location_name,
           f.name as faction_name
    FROM npcs n
    LEFT JOIN locations l ON n.location_id = l.id
    LEFT JOIN factions  f ON n.faction_id  = f.id
    WHERE n.campaign_id = ?
    ORDER BY n.name ASC
  `, [campaignId]))

ipcMain.handle('db:npcs:getById', (_, id) =>
  db.get(`
    SELECT n.*,
           l.name as location_name,
           f.name as faction_name
    FROM npcs n
    LEFT JOIN locations l ON n.location_id = l.id
    LEFT JOIN factions  f ON n.faction_id  = f.id
    WHERE n.id = ?
  `, [id]))

ipcMain.handle('db:npcs:getByLocation', (_, locationId) =>
  db.all('SELECT * FROM npcs WHERE location_id = ? ORDER BY name ASC', [locationId]))

ipcMain.handle('db:npcs:getByFaction', (_, factionId) =>
  db.all('SELECT * FROM npcs WHERE faction_id = ? ORDER BY name ASC', [factionId]))

ipcMain.handle('db:npcs:create', (_, data) =>
  db.run(`
    INSERT INTO npcs
      (campaign_id, name, race, class, role, location_id, faction_id,
       notes, secrets, motivation, is_alive, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,datetime('now'))
  `, [data.campaign_id, data.name, data.race, data.class, data.role,
      data.location_id ?? null, data.faction_id ?? null,
      data.notes, data.secrets, data.motivation]))

ipcMain.handle('db:npcs:update', (_, id, data) =>
  db.run(`
    UPDATE npcs
    SET name=?, race=?, class=?, role=?, location_id=?, faction_id=?,
        notes=?, secrets=?, motivation=?, is_alive=?
    WHERE id=?
  `, [data.name, data.race, data.class, data.role,
      data.location_id ?? null, data.faction_id ?? null,
      data.notes, data.secrets, data.motivation, data.is_alive, id]))

ipcMain.handle('db:npcs:toggleAlive', (_, id, isAlive) =>
  db.run('UPDATE npcs SET is_alive=? WHERE id=?', [isAlive ? 1 : 0, id]))

ipcMain.handle('db:npcs:delete', (_, id) =>
  db.run('DELETE FROM npcs WHERE id=?', [id]))
```

---

#### ▸ Step 2 — Update preload.js

📄 `electron/preload.js`

Update the npcs entry in the db contextBridge to expose all new handlers:

- `db.npcs.getAll(campaignId)`
- `db.npcs.getById(id)`
- `db.npcs.getByLocation(locationId)`
- `db.npcs.getByFaction(factionId)`
- `db.npcs.create(data)`
- `db.npcs.update(id, data)`
- `db.npcs.toggleAlive(id, isAlive)`
- `db.npcs.delete(id)`

---

#### ▸ Step 3 — Build the NPC list page

📄 `src/pages/world/NPCs.jsx`

**List view:**
- On mount, fetch `db.npcs.getAll(activeCampaign.id)`
- Render each NPC using EntityCard:
  - title: NPC name + alive/dead indicator (green dot = alive, red skull = dead)
  - subtitle: race + class/role (e.g. "Human Innkeeper" or "Elf Ranger")
  - tags: location_name (blue), faction_name (purple) — only if set
  - meta: created date
- "+ New NPC" button opens create modal
- Filter bar below the header: search by name (text input), filter by location (dropdown), filter by faction (dropdown), toggle: Show Dead NPCs (default off)
- All filters work client-side on the fetched array — do not re-query DB on each filter change
- NPC count shown in header: "12 NPCs" (or "3 of 12" when filtered)

**Quick actions on each card:**
- "Toggle Alive/Dead" button — calls `db.npcs.toggleAlive(id, !current_is_alive)`, updates list in place without full refresh
- "Edit" opens the edit modal
- "Delete" shows confirmation with EntityCard onDelete

---

#### ▸ Step 4 — Build the NPC detail modal

📄 `src/components/world/NPCModal.jsx`

Create a dedicated NPC modal (uses EntityModal wrapper) with a two-tab layout:

**Tab 1 — Identity:**
- Name — text input, required
- Race — text input with datalist suggestions: Human, Elf, Dwarf, Halfling, Gnome, Half-Elf, Half-Orc, Tiefling, Dragonborn, Other
- Class / Role — text input (free text — not just D&D classes, e.g. "Blacksmith", "Spy", "Noble")
- Location — select dropdown from `db.locations.getAll()`. Label: "Currently located in..." Placeholder: "Unknown location"
- Faction — select dropdown from `db.factions.getAll()`. Placeholder: "No faction affiliation"
- Status — radio buttons: Alive / Dead

**Tab 2 — Details:**
- Motivation — textarea, 3 rows. Label: "What does this NPC want?" Placeholder: "Their core drive, goal, or need..."
- Notes — textarea, 5 rows. Label: "DM Notes" Placeholder: "Personality, appearance, voice, history..."
- Secrets — textarea, 3 rows. Label: "Secrets (DM Only)" Placeholder: "What they're hiding from the party..."

Style the Secrets field distinctively — dark red border, slightly different background — to visually signal that this is sensitive DM information.

**Modal behavior:**
- Dropdowns for Location and Faction load on modal open — single fetches, cached in component state for the modal lifetime
- Submit creates or updates based on whether an `id` prop is passed
- After submit, close modal and trigger list refresh via callback prop

---

#### ▸ Step 5 — Add NPC route and sidebar link

📄 `src/App.jsx`
```
/world/npcs  → src/pages/world/NPCs.jsx
```

📄 `src/components/Sidebar.jsx`

Add NPCs link under the WORLD section, between Factions and Locations:
- NPCs → `/world/npcs`

---

#### ▸ Step 6 — Update Campaign Manager stat cards

📄 `src/pages/CampaignManager.jsx`

The Phase 1 Campaign Manager stat cards showed NPC count. Now that NPCs have alive/dead status, update the NPC stat card to show two numbers: "8 alive / 2 dead" using the `is_alive` field. Query with `db.npcs.getAll(id)` and compute counts client-side.

---

### Verification Steps

> **✓ VERIFY:** Walk through this full flow before marking Prompt 02 complete:

```javascript
// DevTools console tests
const cid = 1

// Create an NPC linked to a location and faction
await window.electronAPI.db.npcs.create({
  campaign_id: cid,
  name: "Mira Ashveil",
  race: "Human",
  class: "Innkeeper",
  role: "Innkeeper",
  location_id: 1,  // use a real location id from your DB
  faction_id: 1,   // use a real faction id
  notes: "Warm, cautious, hides a scar under her collar.",
  secrets: "She is a retired spy for the Duke.",
  motivation: "To protect her daughter at any cost."
})

// Fetch with joined names
const npcs = await window.electronAPI.db.npcs.getAll(cid)
console.log(npcs[0].location_name, npcs[0].faction_name)
// Expected: "Riverdale"  "The Iron Wolves" (or whatever you created)

// Toggle alive status
await window.electronAPI.db.npcs.toggleAlive(npcs[0].id, false)
const updated = await window.electronAPI.db.npcs.getById(npcs[0].id)
console.log(updated.is_alive) // Expected: 0
```

- NPC list page loads with correct location and faction tags on each card
- Filter by location works client-side — selecting a location hides NPCs from other locations
- "Show Dead NPCs" toggle hides/shows dead NPCs correctly
- Toggle alive/dead on a card updates the indicator instantly without page reload
- NPC modal Tab 1 / Tab 2 switch works, all fields save correctly
- Campaign Manager NPC stat card shows "X alive / Y dead" format

> **⚠ WARNING:** Do NOT move to Prompt 03 until all IPC tests pass and the full NPC create → filter → toggle → edit → delete flow works in the UI.

---

## Agent Prompt 03 — Lore & Connections
### *Narrative threads, secrets, and entity relationship linking*

---

### Context

Prompts 01 and 02 are complete. Factions, Locations, and NPCs all have full CRUD with proper IPC wiring. This prompt builds the Lore & Connections module — the narrative layer that ties everything together. Lore entries track story threads, faction histories, and world secrets. Connections record the relationships between any two entities (NPC to NPC, NPC to Faction, Location to Faction, etc.) and form the data that the Mind Map in Phase 6 will visualize.

---

### Your Task

#### ▸ Step 1 — Add Connections IPC handlers

📄 `electron/ipc/dbHandlers.js`

Replace the stub connections handlers from Phase 1 with these complete versions:

```javascript
// Connections — replace Phase 1 stub handlers
ipcMain.handle('db:connections:getAll', (_, campaignId) =>
  db.all(`
    SELECT c.*
    FROM connections c
    WHERE c.campaign_id = ?
    ORDER BY c.relationship ASC
  `, [campaignId]))

ipcMain.handle('db:connections:getForEntity', (_, entityType, entityId) =>
  db.all(`
    SELECT * FROM connections
    WHERE (entity_a_type = ? AND entity_a_id = ?)
       OR (entity_b_type = ? AND entity_b_id = ?)`,
    [entityType, entityId, entityType, entityId]))

ipcMain.handle('db:connections:create', (_, data) =>
  db.run(`
    INSERT INTO connections
      (campaign_id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes)
    VALUES (?,?,?,?,?,?,?)`,
    [data.campaign_id, data.entity_a_type, data.entity_a_id,
     data.entity_b_type, data.entity_b_id, data.relationship, data.notes]))

ipcMain.handle('db:connections:update', (_, id, data) =>
  db.run(`
    UPDATE connections SET relationship=?, notes=? WHERE id=?`,
    [data.relationship, data.notes, id]))

ipcMain.handle('db:connections:delete', (_, id) =>
  db.run('DELETE FROM connections WHERE id=?', [id]))
```

> **ℹ NOTE:** The connections table needs a `campaign_id` column for the getAll query. Add Migration 002 to `DatabaseService.js` to add this column if it does not exist: `ALTER TABLE connections ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id)`

---

#### ▸ Step 2 — Add Lore Entries IPC handlers

Lore entries are stored in the `compendium_custom` table using `type = 'lore'`. Add these handlers:

```javascript
// Lore entries (stored in compendium_custom with type='lore')
ipcMain.handle('db:lore:getAll', (_, campaignId) =>
  db.all(`
    SELECT * FROM compendium_custom
    WHERE campaign_id = ? AND type = 'lore'
    ORDER BY name ASC`,
    [campaignId]))

ipcMain.handle('db:lore:getById', (_, id) =>
  db.get('SELECT * FROM compendium_custom WHERE id = ?', [id]))

ipcMain.handle('db:lore:create', (_, data) =>
  db.run(`
    INSERT INTO compendium_custom
      (campaign_id, type, name, data, source, created_at)
    VALUES (?, 'lore', ?, ?, 'custom', datetime('now'))`,
    [data.campaign_id, data.name,
     JSON.stringify({ content: data.content, category: data.category, is_secret: data.is_secret ?? false })]))

ipcMain.handle('db:lore:update', (_, id, data) =>
  db.run(`
    UPDATE compendium_custom
    SET name=?, data=? WHERE id=?`,
    [data.name,
     JSON.stringify({ content: data.content, category: data.category, is_secret: data.is_secret ?? false }),
     id]))

ipcMain.handle('db:lore:delete', (_, id) =>
  db.run('DELETE FROM compendium_custom WHERE id=?', [id]))
```

---

#### ▸ Step 3 — Update preload.js

Add the new channels to the contextBridge db object:

- `db.connections.getAll(campaignId)`
- `db.connections.getForEntity(entityType, entityId)`
- `db.connections.create(data)`
- `db.connections.update(id, data)`
- `db.connections.delete(id)`
- `db.lore.getAll(campaignId)`
- `db.lore.getById(id)`
- `db.lore.create(data)`
- `db.lore.update(id, data)`
- `db.lore.delete(id)`

---

#### ▸ Step 4 — Build the Lore page

📄 `src/pages/world/Lore.jsx`

**List view:**
- Display lore entries as EntityCards grouped by category
- Category filter tabs: All | History | Faction | Location | Secret | Other
- Secret entries show with a 🔒 icon and a red-tinted card background
- "+ New Lore Entry" button opens create modal
- Each card: title (entry name), category badge, content preview (first 150 chars), created date

**Create / Edit modal:**
- Entry Name — text input, required
- Category — select: History, Faction, Location, Secret, Other
- Is Secret — checkbox. When checked, this entry is DM-only and shown with lock icon
- Content — textarea, 8 rows, the actual lore text
- On submit: parse the data JSON column correctly using the structure defined in the IPC handler

**Full-view mode:**
- Clicking a lore card opens a read-only full view (not the edit modal) showing the full content with proper line breaks
- Full view has an "Edit" button that switches to the edit modal, and a "Close" button

---

#### ▸ Step 5 — Build the Connections page

📄 `src/pages/world/Connections.jsx`

**Connection list:**
- Fetch `db.connections.getAll(activeCampaign.id)` on mount
- Each connection displays as a row: [Entity A Name] ←→ [Relationship] ←→ [Entity B Name]
- Entity names must be resolved from their IDs — build a `resolveEntityName(type, id)` helper that queries the correct table based on type (`npc → npcs`, `location → locations`, `faction → factions`)
- Filter dropdown: filter by entity type (show only NPC connections, only Faction connections, etc.)
- "+ New Connection" button opens create modal
- Delete button on each row with inline confirmation

**Create Connection modal:**
- Entity A — two fields side by side: Type dropdown (NPC, Location, Faction) and a Name dropdown that populates based on the selected type
- Relationship — text input with datalist suggestions: ally, enemy, member of, rival, family, lover, employer, employee, owns, worships, fears, knows secret of, neutral
- Entity B — same two-field pattern as Entity A
- Notes — textarea, 2 rows, optional context about this relationship
- Validation: Entity A and Entity B cannot be the same entity. Show inline error if they match.
- On submit: `db.connections.create({ campaign_id: activeCampaign.id, ...formData })`

---

#### ▸ Step 6 — Add entity connection panels to NPC and Location pages

📄 `src/components/world/NPCModal.jsx`
- Add a Tab 3: Connections
- On tab open, fetch `db.connections.getForEntity("npc", npc.id)`
- Display each connection as: "[Relationship] with [Other Entity Name]"
- Include a "+ Add Connection" button that opens the Create Connection modal pre-filled with this NPC as Entity A

📄 `src/pages/world/Locations.jsx`
- Below the location edit form, add a collapsible "Connections" section
- Fetch and display connections for the selected location using `db.connections.getForEntity("location", id)`

---

#### ▸ Step 7 — Wire routes and sidebar

📄 `src/App.jsx`
```
/world/lore         → src/pages/world/Lore.jsx
/world/connections  → src/pages/world/Connections.jsx
```

📄 `src/components/Sidebar.jsx`

Add to WORLD section:
- Lore → `/world/lore`
- Connections → `/world/connections`

---

### Verification Steps

> **✓ VERIFY:** Test the full lore and connections flow:

```javascript
const cid = 1

// Create a lore entry
await window.electronAPI.db.lore.create({
  campaign_id: cid,
  name: "The Founding of Riverdale",
  category: "History",
  content: "Three hundred years ago, a band of dwarven miners settled the riverbank...",
  is_secret: false
})

// Verify it reads back with parsed data
const lore = await window.electronAPI.db.lore.getAll(cid)
const parsed = JSON.parse(lore[0].data)
console.log(parsed.category) // Expected: "History"

// Create a connection between two entities
await window.electronAPI.db.connections.create({
  campaign_id: cid,
  entity_a_type: "npc",
  entity_a_id: 1,
  entity_b_type: "faction",
  entity_b_id: 1,
  relationship: "member of",
  notes: "She reports directly to the Faction leader."
})

const conns = await window.electronAPI.db.connections.getForEntity("npc", 1)
console.log(conns.length) // Expected: 1
```

- Lore page renders entries grouped by category, secret entries show lock icon
- Full-view mode shows complete content with line breaks preserved
- Connections page resolves entity names correctly for NPC, Location, and Faction types
- NPC modal Tab 3 shows connections for that NPC and "+ Add Connection" pre-fills Entity A

> **⚠ WARNING:** Do NOT move to Prompt 04 until connection entity name resolution works for all three entity types.

---

## Agent Prompt 04 — World Builder Dashboard
### *Unified campaign world overview — all entities in one place*

---

### Context

Prompts 01–03 are complete. All four World Builder entity types — Factions, Locations, NPCs, and Lore/Connections — have full CRUD and IPC wiring. This prompt builds the World Builder landing page at `/world` — the dashboard that gives the DM a bird's-eye view of their entire campaign world at a glance.

---

### Your Task

#### ▸ Step 1 — Build the World Builder Dashboard

📄 `src/pages/WorldBuilder.jsx`

Replace the Phase 1 placeholder with a fully functional World Builder dashboard.

**Header section:**
- Campaign name as the page title (from `activeCampaign` in Zustand)
- World setting as subtitle (e.g. "Forgotten Realms")
- Four stat chips in a row: Locations count, Factions count, NPCs count (alive only), Lore Entries count
- Each stat chip is clickable — navigates to the relevant module page

**Quick-summary grid (2 columns):**

Left column — Recent Locations:
- Fetch the 5 most recently created locations (`ORDER BY created_at DESC LIMIT 5`)
- Display as a compact list: name, type badge, parent location if set
- "View All Locations →" link at the bottom

Right column — Recent NPCs:
- Fetch the 5 most recently created NPCs
- Display as a compact list: name, race/role, alive indicator, faction tag if set
- "View All NPCs →" link at the bottom

**Factions panel (full width):**
- Fetch all factions for the campaign
- Display each as a horizontal card: faction name (left, bold), alignment badge (center), NPC count for this faction (right)
- NPC count: query `db.npcs.getByFaction(faction.id)` and use `.length`
- "Manage Factions →" link at the bottom

**Recent Lore panel (full width):**
- Fetch the 3 most recently created lore entries
- Display each as a compact card: entry name, category badge, first 100 chars of content, lock icon if `is_secret`
- "View All Lore →" link at the bottom

**Quick-action buttons row:**
- "+ Add NPC" → opens NPCModal directly from the dashboard
- "+ Add Location" → navigates to `/world/locations?create=true`
- "+ Add Faction" → navigates to `/world/factions?create=true`
- "+ Add Lore Entry" → navigates to `/world/lore?create=true`

> **ℹ NOTE:** For the `?create=true` pattern: in each list page, use `useSearchParams()` from react-router-dom. On mount, if `create` param is present, auto-open the create modal and clear the param from the URL.

---

#### ▸ Step 2 — Add useWorldData hook

📄 `src/hooks/useWorldData.js`

```javascript
import { useState, useEffect, useCallback } from 'react'

export function useWorldData(campaignId) {
  const [data, setData] = useState({
    locations: [], factions: [], npcs: [], lore: [], connections: [],
    loading: true, error: null
  })

  const refresh = useCallback(async () => {
    if (!campaignId) return
    try {
      const [locations, factions, npcs, lore, connections] = await Promise.all([
        window.electronAPI.db.locations.getAll(campaignId),
        window.electronAPI.db.factions.getAll(campaignId),
        window.electronAPI.db.npcs.getAll(campaignId),
        window.electronAPI.db.lore.getAll(campaignId),
        window.electronAPI.db.connections.getAll(campaignId),
      ])
      setData({ locations, factions, npcs, lore, connections, loading: false, error: null })
    } catch (err) {
      setData(prev => ({ ...prev, loading: false, error: err.message }))
    }
  }, [campaignId])

  useEffect(() => { refresh() }, [refresh])

  return { ...data, refresh }
}
```

Update `WorldBuilder.jsx` and any World Builder pages that make multiple DB calls to use this hook instead of independent `useState + useEffect` patterns.

---

#### ▸ Step 3 — Add loading and empty states

The dashboard should handle three states gracefully:

- **Loading:** show skeleton placeholders (gray animated bars) while data fetches — do not show empty state during load
- **Empty world:** if all counts are 0, show a "Your world is empty" welcome panel with a brief description of each module and its create button — first-time DM onboarding
- **Populated world:** the full dashboard as described above

---

#### ▸ Step 4 — Add AI suggestion panel

📄 `src/components/world/AISuggestionPanel.jsx`

Create a collapsible panel at the bottom of the World Builder dashboard:

- Collapsed by default — a single "✨ AI World Suggestions" toggle button
- On expand, check AI mode via `window.electronAPI.ai.getMode()`
- If mode is "no-ai", show: "Configure your API key in Settings to enable AI suggestions"
- If AI is available, show a "Generate Suggestions" button

On click, call `window.electronAPI.ai.complete()` with:

```javascript
// System prompt
const systemPrompt = `You are an expert Dungeon Master assistant.
The DM will give you a summary of their campaign world.
Suggest 3 specific, actionable world-building ideas.
Each suggestion should be one or two sentences.
Format your response as a numbered list: 1. ... 2. ... 3. ...`

// User message — inject real campaign data
const userMessage = `My campaign "${activeCampaign.name}" is set in ${activeCampaign.world_setting}.
It has ${factions.length} factions, ${locations.length} locations, and ${npcs.length} NPCs.
Recent additions: ${npcs.slice(0,3).map(n => n.name).join(', ')}.
Give me 3 world-building suggestions to develop this world further.`
```

- Display the AI response as a styled list with a ✨ icon
- Show a spinner while waiting for the response
- Add a "Regenerate" button to get new suggestions

---

### Verification Steps

> **✓ VERIFY:** Verify the full World Builder dashboard:

- Navigate to `/world` — dashboard loads with correct counts for all 4 entity types
- Clicking a stat chip navigates to the correct module page
- "Recent Locations" and "Recent NPCs" show the 5 most recent, sorted by `created_at DESC`
- Factions panel shows NPC count per faction accurately
- Quick-action "+ Add NPC" opens NPCModal directly from the dashboard
- `/world/locations?create=true` auto-opens the create modal on load and clears the URL param
- With no entities, the empty-world welcome panel shows
- `useWorldData` hook: verify all 5 entity types load in a single coordinated fetch using `Promise.all`
- AI suggestion panel: toggle opens it, generate button calls AI and displays formatted suggestions

> **⚠ WARNING:** Do NOT move to Prompt 05 until the dashboard stat counts are accurate, the `?create=true` pattern works for all three pages, and the AI suggestion panel displays a real AI response.

---

## Agent Prompt 05 — World Builder Search, Filters & Polish
### *Global search, cross-entity filtering, and Phase 2 completion*

---

### Context

Prompts 01–04 are complete. All World Builder modules — Factions, Locations, NPCs, Lore, Connections, and the Dashboard — are built and functional. This final Phase 2 prompt adds global search across all world entities, improves filters on individual pages, adds empty states and loading skeletons consistently, and polishes the UI to production quality before Phase 3 begins.

---

### Your Task

#### ▸ Step 1 — Add global world search IPC handler

📄 `electron/ipc/dbHandlers.js`

```javascript
ipcMain.handle('db:world:search', (_, campaignId, query) => {
  const q = `%${query}%`
  const locations = db.all(`SELECT id, name, type, 'location' as entity_type FROM locations WHERE campaign_id=? AND (name LIKE ? OR description LIKE ? OR lore LIKE ?)`, [campaignId, q, q, q])
  const factions  = db.all(`SELECT id, name, alignment as subtitle, 'faction' as entity_type FROM factions WHERE campaign_id=? AND (name LIKE ? OR description LIKE ? OR notes LIKE ?)`, [campaignId, q, q, q])
  const npcs      = db.all(`SELECT id, name, role as subtitle, 'npc' as entity_type FROM npcs WHERE campaign_id=? AND (name LIKE ? OR notes LIKE ? OR motivation LIKE ?)`, [campaignId, q, q, q])
  const lore      = db.all(`SELECT id, name, 'lore' as entity_type FROM compendium_custom WHERE campaign_id=? AND type='lore' AND name LIKE ?`, [campaignId, q])
  return { locations, factions, npcs, lore,
           total: locations.length + factions.length + npcs.length + lore.length }
})
```

---

#### ▸ Step 2 — Expose in preload.js

- `db.world.search(campaignId, query)`

---

#### ▸ Step 3 — Build the Global Search component

📄 `src/components/world/WorldSearch.jsx`

- Text input with 🔍 icon, placeholder: "Search world..."
- Debounced — wait 300ms after the user stops typing before calling `db.world.search()`
- Minimum 2 characters before searching
- Results appear in a dropdown panel below the search bar, grouped by entity type
- Each result shows: entity type badge (color-coded), entity name, subtitle if available
- Clicking a result navigates to the correct page and opens that entity's edit modal
- Pressing Escape clears the search and closes the results panel
- If no results: "No world entities match '[query]'"
- Show total result count: "12 results across 3 entity types"

---

#### ▸ Step 4 — Strengthen individual page filters

📄 `src/pages/world/NPCs.jsx`
- Add "Filter by Status" toggle group: All | Alive | Dead (replaces the "Show Dead" checkbox)
- Add "Sort by" dropdown: Name A–Z, Name Z–A, Recently Added, Faction
- Show active filter count badge on the filter bar when any filter is active: "3 filters active"
- "Clear Filters" button appears when any filter is active

📄 `src/pages/world/Locations.jsx`
- Add a search-within-locations text input above the type tabs
- Add a "Has Sub-locations" filter checkbox
- Add "Sort by" dropdown: Name A–Z, Type, Recently Added

---

#### ▸ Step 5 — Consistent loading skeletons

📄 `src/components/ui/Skeleton.jsx`

Create a reusable Skeleton component:

- Props: `width` (string, default "100%"), `height` (string, default "1rem"), `borderRadius` (string, default "4px"), `count` (number of skeleton lines, default 1)
- Renders a pulsing gray rectangle using CSS animation: `@keyframes pulse { 0%,100% { opacity: 0.4 } 50% { opacity: 0.8 } }`
- Color: `#2d1f0a` (dark parchment tone) with the pulse animation

Apply Skeleton to every list page and the dashboard during the `loading: true` state from `useWorldData`.

---

#### ▸ Step 6 — NPC quick-view panel

📄 `src/components/world/NPCQuickView.jsx`

Create a slide-in side panel (not a modal) for quickly viewing an NPC:

- Triggered by clicking the NPC name on the NPC list page (edit icon still opens full modal)
- Slides in from the right — 360px wide, full height, dark background
- Shows: NPC name, race/class, alive status, location, faction, motivation, and notes
- Secrets field is hidden behind a "Reveal Secrets 🔒" toggle button
- "Edit Full Profile" button at bottom opens NPCModal
- "Close" button or clicking outside dismisses the panel

---

#### ▸ Step 7 — Final Phase 2 audit

Before closing Phase 2, perform this consistency audit across all World Builder pages:

- Every page has a loading state (skeleton) and an empty state (descriptive message + create button)
- Every create/edit modal validates required fields and shows inline error messages (red text below the field)
- Every delete action shows a confirmation with the entity name in the message
- Every page that reads from the DB uses `useWorldData` hook or calls `refresh()` after mutations
- The Sidebar WORLD section links all appear and navigate correctly: World Builder, Factions, Locations, NPCs, Lore, Connections
- The `CampaignGuard` correctly blocks all `/world/*` routes when no campaign is active

---

### Verification Steps

> **✓ VERIFY:** Full Phase 2 end-to-end verification:

```javascript
// Test global search
await window.electronAPI.db.world.search(1, "Mira")
// Expected: { npcs: [{id:1, name:"Mira Ashveil", ...}], locations:[], factions:[], lore:[], total:1 }

// Test with a term that matches multiple entity types
await window.electronAPI.db.world.search(1, "river")
// Expected: results in locations (Riverdale) and possibly lore (Founding of Riverdale)
```

- Global search finds entities across all 4 types, grouped correctly in the dropdown
- Clicking a search result navigates to the correct page
- NPC filter: All/Alive/Dead toggle works, sort options reorder the list correctly
- Skeleton loading shows correctly on first render of every list page
- NPC quick-view panel slides in, Reveal Secrets toggle works, "Edit Full Profile" opens NPCModal
- `?create=true` pattern works on Locations, Factions, and Lore pages
- No console errors on any World Builder page

> **✓ VERIFY:** Phase 2 is complete when the full flow works: Dashboard → search → navigate to entity → view quick panel → edit → delete → return to dashboard with updated counts.

```bash
git add .
git commit -m "[Phase 2] Complete: World Builder — Factions, Locations, NPCs, Lore, Connections, Dashboard, Search"
git push
```

---

*⚔ End of Phase 2 Agent Prompts ⚔*
