# ⚔ DMCS — Phase 8 Agent Prompts
## Player View — Claude Code Edition — **THE FINAL PHASE**

> **Save this file as:** `DMCS_Phase8_Agent_Prompts.md`
> Place it in the root of your project folder alongside the spec and rules documents.

**Modules covered:** Player Window · Character Sheet · Fog-Enforced Map · DM Broadcasts · Session Notes · v1.0.0

---

## Prompt Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | Player Window Architecture | Second BrowserWindow, IPC broadcast channel, /player route, PlayerApp shell, character selector | 2 – 3 hrs |
| 02 | Player Character Sheet View | Read-only sheet with HP sync, saving throws, skills, inventory, spell slots, live broadcasts | 2 – 3 hrs |
| 03 | Player Map View | Fog-enforced MapCanvas in player mode, token visibility on fog, live broadcast map updates | 2 – 3 hrs |
| 04 | DM Broadcast Controls | DMPlayerControls panel, auto-sync fog/tokens, session notes feed, end-combat HP broadcast | 2 – 3 hrs |
| 05 | Polish, Session Mgmt & Final Audit | Reconnect handling, dice roll UX, error boundary, full 8-phase project audit, v1.0.0 tag | 1 – 2 hrs |

*Total estimated time: 9 – 14 hours*

> **⚔ RULE:** Before starting any prompt, open your Claude Code session with the Master Session Opener from `DMCS_Claude_Code_Rules.md`. Update the filename to `DMCS_Phase8_Agent_Prompts.md`.

---

## Agent Prompt 01 — Player Window Architecture
### *Second Electron window, IPC role system, player routing, and character selection*

---

### Context

Phase 7 is complete. The full AI layer is working — PDF ingestion, embedding, RAG pipeline with source attribution, and a streaming AI assistant with campaign context injection. This is Prompt 01 of 05 for Phase 8, the final phase. You are building the Player View — a separate Electron window that players use at the table. It shares the same SQLite database as the DM window but exposes only what the DM has revealed: the player's own character sheet, the fog-enforced map, and session notes the DM has shared.

---

### Your Task

#### ▸ Step 1 — Create the player window in main.js

📄 `electron/main.js`

```javascript
let playerWindow = null

function createPlayerWindow(campaignId) {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.focus()
    return
  }

  playerWindow = new BrowserWindow({
    width:  1200,
    height: 800,
    title:  'DMCS — Player View',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (process.env.NODE_ENV === 'development') {
    playerWindow.loadURL(`http://localhost:5173/player?campaign=${campaignId}`)
  } else {
    playerWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      { hash: `/player?campaign=${campaignId}` }
    )
  }

  playerWindow.on('closed', () => { playerWindow = null })
}

// IPC handlers for player window management
ipcMain.handle('player:openWindow',  (_, campaignId) => { createPlayerWindow(campaignId); return { success: true } })
ipcMain.handle('player:closeWindow', ()              => { if (playerWindow && !playerWindow.isDestroyed()) playerWindow.close(); return { success: true } })
ipcMain.handle('player:isOpen',      ()              => ({ isOpen: !!playerWindow && !playerWindow.isDestroyed() }))
```

---

#### ▸ Step 2 — Add broadcast IPC for DM → Player communication

📄 `electron/main.js`

```javascript
// Broadcast channel: DM sends, main process relays to player window
ipcMain.on('player:broadcast', (event, message) => {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.webContents.send('player:receive', message)
  }
})

// Message types:
// { type: "map:update",     payload: { mapId, fogData, tokens } }
// { type: "map:set",        payload: { mapId } }
// { type: "session:note",   payload: { text, timestamp } }
// { type: "character:sync", payload: { characterId } }
// { type: "ping",           payload: {} }
```

---

#### ▸ Step 3 — Expose player IPC methods in preload.js

- `player.openWindow(campaignId)` — invokes `player:openWindow`
- `player.closeWindow()` — invokes `player:closeWindow`
- `player.isOpen()` — invokes `player:isOpen`
- `player.broadcast(message)` — `ipcRenderer.send('player:broadcast', message)`
- `player.onReceive(callback)` — `ipcRenderer.on('player:receive', callback)`
- `player.offReceive(callback)` — `ipcRenderer.removeListener('player:receive', callback)`

---

#### ▸ Step 4 — Create the player routing structure

📄 `src/App.jsx`

```jsx
import PlayerApp from './PlayerApp'

// In the Routes block, BEFORE the DM routes:
<Route path="/player" element={<PlayerApp />} />

// All other DM routes remain under the DM layout wrapper
```

---

#### ▸ Step 5 — Create the PlayerApp shell

📄 `src/PlayerApp.jsx`

```jsx
import { useSearchParams } from 'react-router-dom'
import { useState, useEffect } from 'react'

export default function PlayerApp() {
  const [searchParams]  = useSearchParams()
  const campaignId      = parseInt(searchParams.get('campaign'))
  const [campaign, setCampaign]             = useState(null)
  const [selectedCharId, setSelectedCharId] = useState(null)
  const [activeView, setActiveView]         = useState('character') // "character" | "map"
  const [broadcastMsg, setBroadcastMsg]     = useState(null)

  useEffect(() => {
    if (!campaignId) return
    window.electronAPI.db.campaigns.getById(campaignId).then(setCampaign)
  }, [campaignId])

  useEffect(() => {
    const handler = (_, msg) => setBroadcastMsg(msg)
    window.electronAPI.player.onReceive(handler)
    return () => window.electronAPI.player.offReceive(handler)
  }, [])

  if (!campaignId) return (
    <div style={{ padding: '2rem', color: '#c9a84c', fontFamily: 'Georgia' }}>
      No campaign specified. Ask your DM to open the player view.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0a05', color: '#e8e0d0' }}>
      <PlayerTopBar campaign={campaign} activeView={activeView} onViewChange={setActiveView} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeView === 'character' && (
          <PlayerCharacterSelect
            campaignId={campaignId}
            selectedCharId={selectedCharId}
            onSelectChar={setSelectedCharId}
            broadcastMsg={broadcastMsg}
          />
        )}
        {activeView === 'map' && (
          <PlayerMapView
            campaignId={campaignId}
            broadcastMsg={broadcastMsg}
          />
        )}
      </div>
    </div>
  )
}
```

---

#### ▸ Step 6 — Build the Player TopBar

📄 `src/components/player/PlayerTopBar.jsx`

- Left: campaign name in gold Georgia font, world setting in silver below
- Center: two toggle nav buttons — "Character Sheet" and "Battle Map"
- Right: connection status — "Connected to DM" (green) or "Waiting..." (amber)
- Height: 52px, background: `#0d0a05`, bottom border: `1px solid #2d1f0a`

---

#### ▸ Step 7 — Build the Character Selector

📄 `src/components/player/PlayerCharacterSelect.jsx`

- Fetches all characters for the campaign via `db.characters.getAll(campaignId)`
- Each character as a selectable card: character name, race/class, level badge, player name
- Clicking selects the character and renders `PlayerCharacterSheet`
- "Switch Character" button in the sheet header returns to the selection screen
- If a `character:sync` broadcast arrives, auto-refresh the selected character's data

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// In DM window DevTools:
await window.electronAPI.player.openWindow(1)  // pass your campaign id
// Expected: second Electron window opens titled "DMCS — Player View"

// Test broadcast:
window.electronAPI.player.broadcast({ type: "ping", payload: {} })
// Expected: player window receives the message

// In player window DevTools:
window.electronAPI.player.onReceive((msg) => console.log("received:", msg))
// Then send a broadcast from DM window — should log the message
```

- Second window opens at 1200×800 with correct title
- Player window shows campaign name in the top bar
- Character selection screen shows all campaign characters
- Clicking a character transitions to the character sheet
- "Switch Character" returns to selection
- DM broadcasts reach the player window
- Closing the player window sets `playerWindow = null` — DM can reopen

> **⚠ WARNING:** Do NOT move to Prompt 02 until the second window opens correctly, characters load, and the broadcast channel works.

---

## Agent Prompt 02 — Player Character Sheet View
### *Read-only character sheet, HP display, saving throws, skills, inventory, and spell slots*

---

### Context

Prompt 01 is complete. The second Electron window opens with the player routing structure, character selection, and DM broadcast channel working. This prompt builds the read-only player character sheet — a simplified, presentation-focused view of the Phase 4 character data. Players can view but not edit anything.

---

### Your Task

#### ▸ Step 1 — Build the Player Character Sheet

📄 `src/components/player/PlayerCharacterSheet.jsx`

Read-only sheet organized into four tabs: **Stats | Inventory | Spells | Notes**

**Sheet header:**
- Character name in large gold Georgia font
- Race · Class · Level in silver below
- AC shield badge: "AC 14" (10 + DEX modifier — base calculation; note in code that full armor AC is a known limitation)
- "Switch Character" button top-right
- Player name label in small muted silver

**HP display (prominent, top of Stats tab):**
- Large "[hp_current] / [hp_max] HP" display
- Full-width color-coded progress bar: green >50%, amber 25–50%, red <25%
- When `hp_current === 0`: show "UNCONSCIOUS" in red bold with death saves display
- HP is fully read-only — no damage/heal controls in the player view

**Ability scores (Stats tab):**
- 6-column grid: STR | DEX | CON | INT | WIS | CHA
- Each cell: ability abbreviation (tiny), score (large), modifier in gold (+N / -N)
- All read-only
- Proficiency Bonus below: "Proficiency Bonus: +3"
- Passive Perception below: "Passive Perception: 14"

**Saving throws (Stats tab):**
- All 6 saves — filled gold dot if proficient, empty circle if not
- Each row: dot, ability name, calculated bonus in gold

**Skills (Stats tab):**
- All 18 skills from `SKILLS` in `dnd5e.js`
- Proficient skills: filled gold dot
- Sorted: proficient first, then alphabetical within each group

**Inventory tab:**
- Table: equipped indicator (🛡️ if equipped), item name, quantity, weight
- Total carried weight: "X.X lbs / Y lbs capacity"
- No add/remove/equip controls — read-only
- Empty state: "No items in inventory"

**Spells tab:**
- Only shown if `getCasterType(character.class) !== null`
- Spellcasting stats bar: Ability, Spell Save DC, Spell Attack Bonus
- Spell slot pips per level — read-only (no use/restore buttons)
- Known spells list: name, level badge, school

**Notes tab:**
- `character.notes` in read-only format with preserved line breaks

---

#### ▸ Step 2 — Live HP sync from broadcasts

```javascript
useEffect(() => {
  if (!broadcastMsg) return
  if (broadcastMsg.type === 'character:sync' &&
      broadcastMsg.payload.characterId === character.id) {
    window.electronAPI.db.characters.getById(character.id)
      .then(setCharacter)
  }
}, [broadcastMsg, character?.id])
```

---

#### ▸ Step 3 — Style for table use

- Font sizes 10% larger than the DM sheet
- High contrast: gold for numbers, white for labels, dark background `#0d0a05`
- Tab buttons: min 44px height (touch-friendly)
- HP bar: 24px tall
- Ability score cells: minimum 80×90px
- Minimum font size 13px everywhere

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// Test HP broadcast sync:
// In DM DevTools:
await window.electronAPI.db.characters.updateHP(1, 10)
window.electronAPI.player.broadcast({
  type: "character:sync",
  payload: { characterId: 1 }
})
// Expected: player window HP bar updates to 10 without page reload
```

- All four tabs render correctly: Stats, Inventory, Spells, Notes
- **Read-only:** no input fields, no editable elements anywhere
- HP broadcast sync: DM damages a character → broadcasts → player HP bar updates live
- Spell tab only shows for spellcasting classes
- Proficient skills sorted first in the skills list
- Font sizes visibly larger than the DM sheet

> **⚠ WARNING:** Do NOT move to Prompt 03 until HP broadcast sync works and the sheet is fully read-only with zero editable elements.

---

## Agent Prompt 03 — Player Map View
### *Fog-enforced canvas, revealed cells only, token visibility, read-only pan/zoom*

---

### Context

Prompts 01 and 02 are complete. The player window has a working character sheet with live HP sync. This prompt builds the Player Map View — the battle map as players see it. It reuses `MapCanvas` from Phase 3 in `"player"` mode: fog fully opaque, tokens visible but not draggable, DM tools hidden, and live updates via DM broadcasts.

---

### Your Task

#### ▸ Step 1 — Build the Player Map View

📄 `src/components/player/PlayerMapView.jsx`

```jsx
import MapCanvas from '../map/MapCanvas'

export default function PlayerMapView({ campaignId, broadcastMsg }) {
  const [activeMap, setActiveMap] = useState(null)
  const [maps,      setMaps]      = useState([])

  useEffect(() => {
    window.electronAPI.db.maps.getAll(campaignId).then(setMaps)
  }, [campaignId])

  useEffect(() => {
    if (!broadcastMsg) return

    if (broadcastMsg.type === 'map:set') {
      window.electronAPI.db.maps.getById(broadcastMsg.payload.mapId)
        .then(setActiveMap)
    }

    if (broadcastMsg.type === 'map:update' && activeMap) {
      if (broadcastMsg.payload.mapId === activeMap.id) {
        setActiveMap(prev => ({
          ...prev,
          fog_data: JSON.stringify(broadcastMsg.payload.fogData),
          tokens:   JSON.stringify(broadcastMsg.payload.tokens),
        }))
      }
    }
  }, [broadcastMsg, activeMap])

  if (!activeMap) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:'1rem' }}>
      <div style={{ fontSize:'4rem' }}>🗺️</div>
      <div style={{ fontFamily:'Georgia', fontSize:'1.4rem', color:'#c9a84c' }}>Waiting for the DM to share a map...</div>
      <div style={{ fontSize:'1rem', color:'#6b6b6b' }}>Your DM will push a map when combat begins</div>
    </div>
  )

  return (
    <div style={{ width:'100%', height:'calc(100vh - 52px)' }}>
      <MapCanvas
        map={activeMap}
        mode="player"
        onFogChange={null}
        onTokensChange={null}
      />
    </div>
  )
}
```

---

#### ▸ Step 2 — Audit and enforce player mode in MapCanvas

📄 `src/components/map/MapCanvas.jsx`

Verify ALL of these restrictions are enforced when `mode === "player"`:

- Fog renders as **fully opaque solid black** `rgba(0,0,0,1)` — not semi-transparent
- `applyFogBrush()` is a no-op in player mode
- `AddTokenModal` does NOT open on double-click in player mode
- All `MapToken` components have `draggable={false}` in player mode
- `TokenInspector` hides entity links (shows only label and type)
- `MapToolbar` hides all DM tools in player mode
- Right-click context menu disabled in player mode

> **ℹ NOTE:** Add a `renderPlayerFog()` variant: DM mode uses semi-transparent dark overlay (DM can see the fog overlay). Player mode uses solid black `rgba(0,0,0,1)` — fully opaque, zero content visible.

---

#### ▸ Step 3 — Improve the waiting screen

- Pulsing animation on the 🗺️ icon (scale 1.0 → 1.05 → 1.0, 2s loop)
- Show available campaign maps as a read-only grid of map names (players cannot switch maps themselves)
- "Refresh" button to re-fetch maps in case the DM added one after the player window opened

---

#### ▸ Step 4 — Player map controls

📄 `src/components/player/PlayerMapControls.jsx`

Minimal floating control panel (bottom-right of player canvas, does NOT use `MapToolbar`):

- Zoom In (+), Zoom Out (-), Reset View (⌂) buttons
- Pass callbacks to `MapCanvas` using the existing `stageScale`/`stagePos` state pattern from Phase 3
- Pan (middle-click-drag) and zoom (mouse wheel) already work from Phase 3 — confirm they are not restricted in player mode

---

#### ▸ Step 5 — Token visibility enforcement for player mode

📄 `src/components/map/MapCanvas.jsx`

```javascript
// In the token rendering section:
const renderTokens = () => {
  return tokens
    .filter(token => {
      if (mode !== 'player') return true  // DM sees all tokens
      // Player mode: only show tokens on revealed cells
      const { numCols } = getMapDimensions(imageSize, map.grid_size)
      return isCellRevealed(fogData, token.col, token.row, numCols)
    })
    .map(token => (
      <MapToken
        key={token.id}
        token={token}
        gridSize={map.grid_size}
        isSelected={false}
        onSelect={() => {}}
        onDragEnd={() => {}}
        mode={mode}
      />
    ))
}
```

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// Push a map from DM window:
window.electronAPI.player.broadcast({ type: "map:set", payload: { mapId: 1 } })
// Expected: player switches from waiting screen to the map

// Test broadcast fog update:
window.electronAPI.player.broadcast({
  type: "map:update",
  payload: {
    mapId: 1,
    fogData: JSON.parse(map.fog_data),
    tokens:  JSON.parse(map.tokens)
  }
})
// Expected: player map updates fog and tokens without page reload
```

- Waiting screen shows with pulsing icon when no map is pushed
- `map:set` broadcast switches player to the specified map immediately
- Fog is **fully opaque black** — zero content visible through it
- Tokens on fogged cells are invisible to the player
- Tokens on revealed cells are visible but not draggable
- Player can pan and zoom independently
- `PlayerMapControls` zoom/reset buttons work
- `map:update` broadcast updates fog and tokens live

> **⚠ WARNING:** Do NOT move to Prompt 04 until token-on-fog visibility is enforced and `map:update` broadcasts update the player view live.

---

## Agent Prompt 04 — DM Broadcast Controls
### *Push maps to players, sync fog reveals, live token updates, session notes sharing*

---

### Context

Prompts 01–03 are complete. The player window has a working character sheet with HP sync, and a fog-enforced map view with live broadcast updates. This prompt builds the DM-side controls — the panel in the DM window where the DM pushes maps, syncs fog/tokens, shares session notes, and manages the player session.

---

### Your Task

#### ▸ Step 1 — Build the DM Player Control Panel

📄 `src/components/player/DMPlayerControls.jsx`

A collapsible panel that appears in the DM window when working with the player view. Docks to the right side of the MapEngine page and is accessible from the TopBar.

**Panel header:**
- "Player View" label with green "OPEN" or red "CLOSED" status badge
- "Open Player View" button — `player.openWindow(activeCampaign.id)` — disabled if already open
- "Close Player View" button — `player.closeWindow()` — disabled if not open
- Status polled every 3 seconds via `player.isOpen()`

**Map sharing section:**
- Dropdown: "Push Map to Players" — lists all campaign maps
- On select: `player.broadcast({ type: "map:set", payload: { mapId: selected.id } })`
- "Sync Current Fog & Tokens" button — reads active map and broadcasts `map:update`
- **Auto-sync toggle** — when enabled, every fog paint and token move is broadcast with 500ms debounce

**Session Notes section:**
- Textarea: "Share a note with players..."
- "Send Note" button — broadcasts `{ type: "session:note", payload: { text, timestamp: Date.now() } }`
- Last 5 sent notes shown as a history list

**Character sync section:**
- "Sync All Characters" button — broadcasts `{ type: "character:sync", payload: { characterId: null } }`
- Individual "Sync [Name]" button per character

---

#### ▸ Step 2 — Add auto-sync to MapEngine

📄 `src/pages/MapEngine.jsx`

```javascript
const handleFogChange = useCallback((fogData) => {
  if (autoSync && playerWindowOpen) {
    clearTimeout(fogBroadcastRef.current)
    fogBroadcastRef.current = setTimeout(() => {
      window.electronAPI.player.broadcast({
        type: 'map:update',
        payload: {
          mapId:   activeMap.id,
          fogData: fogData,
          tokens:  JSON.parse(activeMap.tokens ?? '[]'),
        }
      })
    }, 500)
  }
}, [autoSync, playerWindowOpen, activeMap])

const handleTokensChange = useCallback((tokens) => {
  if (autoSync && playerWindowOpen) {
    window.electronAPI.player.broadcast({
      type: 'map:update',
      payload: {
        mapId:   activeMap.id,
        fogData: JSON.parse(activeMap.fog_data ?? '[]'),
        tokens:  tokens,
      }
    })
  }
}, [autoSync, playerWindowOpen, activeMap])

// Pass to MapCanvas: onFogChange={handleFogChange} onTokensChange={handleTokensChange}
```

---

#### ▸ Step 3 — Build the Session Notes display in the player window

📄 `src/components/player/PlayerSessionNotes.jsx`

Floating overlay (bottom-right, collapsible):

- "Session Notes" header with toggle arrow
- Notes list: text + relative timestamp ("just now", "2 min ago")
- New notes animate in with a brief gold flash
- Maximum 20 notes in local state
- Red dot badge on collapsed header when new notes have arrived

```javascript
// In PlayerApp, handle session:note broadcast:
if (broadcastMsg.type === 'session:note') {
  setSessionNotes(prev => [{
    text:      broadcastMsg.payload.text,
    timestamp: broadcastMsg.payload.timestamp,
    id:        crypto.randomUUID(),
  }, ...prev].slice(0, 20))
}
```

---

#### ▸ Step 4 — Add DMPlayerControls to the TopBar

📄 `src/components/TopBar.jsx`

- "👥 Player View" button — green dot when open, no dot when closed
- Clicking toggles the `DMPlayerControls` side panel (slides in from right, 320px wide)
- Panel overlays the main content area — does not push content aside

---

#### ▸ Step 5 — Broadcast character sync from end combat

📄 `src/components/encounter/InitiativeTracker.jsx`

```javascript
// In handleEndCombat(), after bulkUpdateHP():
if (playerUpdates.length > 0) {
  playerUpdates.forEach(u => {
    window.electronAPI.player.broadcast({
      type: 'character:sync',
      payload: { characterId: u.id }
    })
  })
}
```

---

### Verification Steps

> **✓ VERIFY:**

- Open player window from DM TopBar "👥 Player View" button → panel slides in, status shows "OPEN"
- "Push Map to Players" dropdown → select map → player window switches immediately
- Enable "Auto-sync" → paint fog in DM view → player fog updates within 500ms
- Enable "Auto-sync" → move a token → player token position updates
- Send a session note → appears in player window bottom-right with gold flash animation
- "Sync All Characters" → player character HP updates (damage a character first to test)
- End combat in initiative tracker → `character:sync` broadcasts fire → player sheet HP updates
- Close player window from DM panel → status shows "CLOSED" → "Open Player View" re-enables

> **⚠ WARNING:** Do NOT move to Prompt 05 until auto-sync fog updates appear in the player window within 500ms of painting, and session notes appear with the animation.

---

## Agent Prompt 05 — Player View Polish, Session Management & Final Project Audit
### *Reconnect handling, dice roll UX, error boundary, complete 8-phase audit, and v1.0.0 tag*

---

### Context

Prompts 01–04 are complete. The player window architecture, read-only character sheet with HP sync, fog-enforced map view with live updates, DM broadcast controls, session notes, and auto-sync are all working. This is the final prompt of the final phase. It adds player window reconnect handling, polishes the player UX, and runs a comprehensive audit of the complete 8-phase DMCS project.

---

### Your Task

#### ▸ Step 1 — Add player window reconnect handling

📄 `src/components/player/PlayerApp.jsx`

```javascript
// Ping the DM window on mount and every 10 seconds
useEffect(() => {
  const ping = () => window.electronAPI.player.broadcast({ type: 'ping', payload: {} })
  ping()
  const interval = setInterval(ping, 10000)
  return () => clearInterval(interval)
}, [])

// Track connection status
const [connected, setConnected] = useState(true)

useEffect(() => {
  const handler = (_, msg) => {
    setConnected(true)
    setBroadcastMsg(msg)
  }
  window.electronAPI.player.onReceive(handler)
  return () => window.electronAPI.player.offReceive(handler)
}, [])
```

Update `PlayerTopBar` to show connection status dynamically:
- No message received in 15 seconds → "Waiting..." in amber
- Message arrives → "Connected" in green

---

#### ▸ Step 2 — Add loading states

- Character selection screen: skeleton loader while characters fetch
- Map view: loading indicator while map image decodes (base64 can be slow for large maps)
- Use the Phase 2 `Skeleton` component if available, otherwise a simple CSS pulse inline

---

#### ▸ Step 3 — Add player window error boundary

📄 `src/components/player/PlayerErrorBoundary.jsx`

```jsx
import { Component } from 'react'

export default class PlayerErrorBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#c9a84c', fontFamily: 'Georgia' }}>
          <h2 style={{ color: '#8b0000', marginBottom: '1rem' }}>⚔ Something went wrong</h2>
          <p style={{ color: '#e8e0d0', marginBottom: '1rem' }}>{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ background: '#c9a84c', color: '#0d0a05', border: 'none',
                     padding: '0.5rem 1rem', cursor: 'pointer', fontFamily: 'Georgia' }}
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

Wrap `PlayerApp` root in this error boundary in the main rendering path.

---

#### ▸ Step 4 — Player UX polish

**Character sheet — dice rolling:**
- "Roll Initiative" button — rolls d20 + DEX modifier, displays result prominently
- Roll animation: number counts up rapidly for 0.5s then lands on the result
- "Roll [Ability] Check" buttons in the ability score grid — each rolls d20 + that modifier

**Map view — distance measurement:**
- Player holds Shift and hovers over the map → show distance from canvas center to cursor in feet
- Distance = `(pixels / grid_size) × 5` feet per square
- Display as a small floating label near the cursor: "30 ft"

**General:**
- "Full Screen" button in player window (calls Electron's `setFullScreen(true)`)
- Keyboard shortcut: F11 toggles full screen, Escape exits

---

#### ▸ Step 5 — Full Screen IPC handler

📄 `electron/main.js`

```javascript
ipcMain.handle('player:setFullScreen', (_, fullScreen) => {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.setFullScreen(fullScreen)
  }
})
```

Expose in preload.js: `player.setFullScreen(fullScreen)`

---

#### ▸ Step 6 — Complete 8-phase project audit

**Phase 1 — Foundation:**
- [ ] Electron shell launches, sidebar navigates all 13 routes
- [ ] SQLite initializes with all tables and migrations (001–005)
- [ ] SRD cache: all 4 resource types loaded
- [ ] AI service: Claude API connects, Ollama fallback works
- [ ] Campaign Manager: create, list, load, switch, delete

**Phase 2 — World Builder:**
- [ ] Factions, Locations (with hierarchy), NPCs (with linked location/faction), Lore, Connections
- [ ] Dashboard: stat chips, recent entities, AI suggestions, `useWorldData` hook
- [ ] Global search: finds entities across all 4 types

**Phase 3 — Map Engine:**
- [ ] Maps: create with image import, thumbnail generation
- [ ] Canvas: grid, pan/zoom, Reset View
- [ ] Fog of war: brush tools, 3 sizes, Reveal All/Hide All, persists to DB
- [ ] Tokens: place, drag-snap, inspect, delete, persist to DB
- [ ] DM vs Player mode enforced

**Phase 4 — Compendium & Sheets:**
- [ ] Compendium: monster/spell/equipment browsers, full stat block panels
- [ ] Custom entries: CRUD for all 4 types, merged into SRD browsers
- [ ] Character sheets: stats, HP, saving throws, skills, inventory, spell slots, level up
- [ ] Death saves, AI character assistant, notes tab

**Phase 5 — Encounter Tools:**
- [ ] Encounter builder: monster roster with overrides
- [ ] XP calculator: correct multipliers and thresholds, difficulty badge
- [ ] Initiative tracker: sorted order, HP management, full lifecycle
- [ ] All 15 conditions, concentration tracking, combat log
- [ ] End combat: HP syncs to character sheets

**Phase 6 — Mind Maps:**
- [ ] All 4 node types render correctly
- [ ] Connections from Phase 2 load as labeled edges
- [ ] Dagre layout (TB and LR), all filters, subgraph highlighting
- [ ] Node position persistence, MiniMap
- [ ] AI insights, in-graph edge creation, PNG export

**Phase 7 — AI Layer:**
- [ ] PDF ingestion: upload, chunk, store with readable text and page numbers
- [ ] Embedding: nomic-embed-text via Ollama, vectra index, semantic search
- [ ] RAG query: grounded answers with source attribution, hybrid fallback
- [ ] Streaming assistant: tokens appear progressively, campaign context injected
- [ ] "Rules Q&A Mode" routes through RAG with source panel

**Phase 8 — Player View:**
- [ ] Player window opens at 1200×800, campaign name in top bar
- [ ] Character selection shows all campaign characters
- [ ] Player character sheet fully read-only with correct stats
- [ ] HP broadcasts from DM window update the player sheet live
- [ ] Map view: fully opaque fog, tokens on fogged cells invisible
- [ ] `map:set` broadcast switches player to the pushed map
- [ ] `map:update` broadcast updates fog and tokens live
- [ ] DM broadcast controls: push map, auto-sync, session notes
- [ ] Session notes appear with gold flash animation
- [ ] End combat broadcasts `character:sync` to player window
- [ ] Player window error boundary handles errors gracefully
- [ ] Full screen toggle works (F11 / Escape)
- [ ] No console errors in either DM or player window

---

### Verification Steps

> **✓ VERIFY:** Final end-to-end session simulation — run this entire flow:

- Launch DMCS → select campaign → Campaign Manager shows correct stats
- Navigate to World Builder → NPCs, Locations, Factions load → AI suggestions work
- Navigate to Mind Map → world entities render as nodes → Dagre layout → click node → detail panel
- Navigate to Maps → create a map with image → paint fog → place 3 tokens
- Open Player View from TopBar → second window appears with campaign name
- In DM window: push the map → player window shows the map with fully opaque fog
- In DM window: enable Auto-sync → paint fog reveals → player map updates within 500ms
- In DM window: send a session note → note appears in player window with gold flash
- Player selects their character → stats, HP, inventory, spells all show correctly
- Navigate to Encounter Builder → build encounter with SRD goblins
- Start combat → roll initiatives → "Begin Combat" → damage combatants
- End combat → player HP updates in player window automatically
- Navigate to Compendium → search "fireball" → add to player character → appears in spell list
- Navigate to /ai → upload a PDF → embed → ask rules question → RAG answer with source attribution

> **✓ VERIFY:** DMCS is complete when this full session flow runs end to end without errors in both windows.

```bash
git add .
git commit -m "[Phase 8] Complete: Player View — second window, character sheet, map view, DM broadcasts, session notes"
git push

# Tag the complete project
git tag -a v1.0.0 -m "DMCS v1.0.0 — All 8 phases complete"
git push origin v1.0.0
```

---

> *⚔ The Dungeon Master's Campaign Suite is complete. ⚔*

---

*⚔ End of Phase 8 Agent Prompts — End of DMCS Development ⚔*
