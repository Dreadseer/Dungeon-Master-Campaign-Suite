# ⚔ DMCS — Phase 3 Agent Prompts
## Map Engine — Claude Code Edition

> **Save this file as:** `DMCS_Phase3_Agent_Prompts.md`
> Place it in the root of your project folder alongside the spec and rules documents.

**Modules covered:** Image Import · Grid · Pan/Zoom · Fog of War · Tokens · DM vs Player View

---

## Prompt Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | Map Manager & Image Import | Map CRUD, file dialog IPC, image copy to userData, thumbnail preview | 1 – 2 hrs |
| 02 | Grid Renderer & Pan/Zoom | React-Konva Stage/Layer setup, grid lines, wheel zoom-to-cursor, pan | 2 – 3 hrs |
| 03 | Fog of War | fogUtils bitmask, fog layer, reveal/hide brush, debounced DB save | 2 – 3 hrs |
| 04 | Unit Tokens & Movement | tokenUtils, MapToken component, drag-snap, AddTokenModal, TokenInspector | 2 – 3 hrs |
| 05 | Polish, DM/Player View & Audit | Mode enforcement, thumbnail gen, viewport optimization, map list polish | 1 – 2 hrs |

*Total estimated time: 8 – 13 hours*

> **⚔ RULE:** Before starting any prompt in this document, open your Claude Code session using the Master Session Opener from `DMCS_Claude_Code_Rules.md`. Update the filename reference to `DMCS_Phase3_Agent_Prompts.md`.

---

## Agent Prompt 01 — Map Manager & Image Import
### *Create maps, link to locations, import background images from disk*

---

### Context

Phase 2 is complete. The World Builder — Factions, Locations, NPCs, Lore, Connections, Dashboard, and Search — are all fully functional. This is Prompt 01 of 05 for Phase 3. You are building the Map Engine, starting with the data layer and image import system before touching any canvas rendering. The goal of this prompt is a working Map Manager page where the DM can create, name, link, and delete maps, and import a background image from their local file system.

---

### Your Task

#### ▸ Step 1 — Install React-Konva

```bash
npm install konva react-konva
```

> **ℹ NOTE:** react-konva requires React 18. Verify: `node -e "const r=require('./node_modules/react/package.json'); console.log(r.version)"` — must be 18.x.

---

#### ▸ Step 2 — Add Map IPC handlers

📄 `electron/ipc/dbHandlers.js`

Append these map handlers to dbHandlers.js:

```javascript
// Maps
ipcMain.handle('db:maps:getAll', (_, campaignId) =>
  db.all(`
    SELECT m.*, l.name as location_name
    FROM maps m
    LEFT JOIN locations l ON m.location_id = l.id
    WHERE m.campaign_id = ?
    ORDER BY m.name ASC`,
    [campaignId]))

ipcMain.handle('db:maps:getById', (_, id) =>
  db.get('SELECT * FROM maps WHERE id = ?', [id]))

ipcMain.handle('db:maps:create', (_, data) =>
  db.run(`
    INSERT INTO maps
      (campaign_id, name, location_id, image_path, grid_size, fog_data, tokens, created_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'))`,
    [data.campaign_id, data.name, data.location_id ?? null,
     data.image_path ?? null, data.grid_size ?? 50,
     JSON.stringify([]), JSON.stringify([])]))

ipcMain.handle('db:maps:update', (_, id, data) =>
  db.run(`
    UPDATE maps SET name=?, location_id=?, grid_size=? WHERE id=?`,
    [data.name, data.location_id ?? null, data.grid_size ?? 50, id]))

ipcMain.handle('db:maps:updateImagePath', (_, id, imagePath) =>
  db.run('UPDATE maps SET image_path=? WHERE id=?', [imagePath, id]))

ipcMain.handle('db:maps:updateFog', (_, id, fogData) =>
  db.run('UPDATE maps SET fog_data=? WHERE id=?', [JSON.stringify(fogData), id]))

ipcMain.handle('db:maps:updateTokens', (_, id, tokens) =>
  db.run('UPDATE maps SET tokens=? WHERE id=?', [JSON.stringify(tokens), id]))

ipcMain.handle('db:maps:delete', (_, id) =>
  db.run('DELETE FROM maps WHERE id=?', [id]))
```

---

#### ▸ Step 3 — Add file dialog IPC handler

📄 `electron/ipc/fileHandlers.js`

Create this new file to handle OS-level file dialogs and file reading:

```javascript
const { ipcMain, dialog, app } = require('electron')
const fs   = require('fs')
const path = require('path')

// Open file picker and return chosen path
ipcMain.handle('file:openImageDialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Map Image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

// Copy image into app userData/maps/ and return new path
// We copy so the map still works if the source file is moved
ipcMain.handle('file:copyMapImage', async (_, sourcePath) => {
  const mapsDir = path.join(app.getPath('userData'), 'maps')
  if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true })
  const ext      = path.extname(sourcePath)
  const filename = `map_${Date.now()}${ext}`
  const destPath = path.join(mapsDir, filename)
  fs.copyFileSync(sourcePath, destPath)
  return destPath
})

// Read image as base64 for canvas rendering
ipcMain.handle('file:readImageAsBase64', (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null
  const ext    = path.extname(filePath).replace('.', '')
  const buffer = fs.readFileSync(filePath)
  return `data:image/${ext};base64,${buffer.toString('base64')}`
})
```

📄 `electron/main.js` — add this line after the other require statements:

```javascript
require('./ipc/fileHandlers')
```

---

#### ▸ Step 4 — Expose file methods in preload.js

Add a `file` object to the electronAPI contextBridge:

- `file.openImageDialog()` — invokes `file:openImageDialog`
- `file.copyMapImage(sourcePath)` — invokes `file:copyMapImage`
- `file.readImageAsBase64(filePath)` — invokes `file:readImageAsBase64`

---

#### ▸ Step 5 — Build the Map Manager page

📄 `src/pages/MapEngine.jsx`

Replace the Phase 1 placeholder with a Map Manager. This page has two views:

**View A — Map List:**
- On mount, fetch `db.maps.getAll(activeCampaign.id)`
- Render each map as a card showing: map name, linked location name (or "No location linked"), grid size, thumbnail preview if `image_path` exists
- Thumbnail: call `file.readImageAsBase64(image_path)` and render as a small 120×80px preview
- "+ New Map" button opens create modal
- "Open Map" button on each card switches to View B with that map loaded
- "Delete" button with confirmation: "Delete [name]? This cannot be undone."
- Empty state: "No maps yet. Create your first battle map."

**Create Map modal:**
- Map Name — text input, required
- Link to Location — select dropdown from `db.locations.getAll()`. Placeholder: "No location linked"
- Grid Size — number input, min 20, max 100, default 50. Label: "Grid cell size (pixels)"
- Background Image — a "Choose Image..." button that calls `file.openImageDialog()`
- When an image is chosen: show its filename and a small preview below the button
- On submit: call `file.copyMapImage(chosenPath)` to get the stored path, then `db.maps.create({ ...formData, image_path: storedPath, campaign_id: activeCampaign.id })`
- After create: refresh list, close modal

**View B — Map Canvas (placeholder for now):**
- When "Open Map" is clicked, store the selected map in local state and switch to View B
- View B for this prompt is a placeholder: show the map name, a "← Back to Maps" button, and the text "Canvas renders in Prompt 02"
- This placeholder will be replaced in Prompt 02

---

#### ▸ Step 6 — Verify sidebar link

The map route already exists from Phase 1 at `/maps → src/pages/MapEngine.jsx`. No new route needed. Verify the sidebar link is present under MAPS.

---

### Verification Steps

> **✓ VERIFY:** Run `npm run dev` and test the full map creation flow:

```javascript
// DevTools console
const cid = 1

// Create a map without an image first
await window.electronAPI.db.maps.create({
  campaign_id: cid, name: "Riverdale Town Square",
  location_id: 1, grid_size: 50
})

const maps = await window.electronAPI.db.maps.getAll(cid)
console.log(maps[0].name, maps[0].location_name)
// Expected: "Riverdale Town Square"  "Riverdale"

console.log(JSON.parse(maps[0].fog_data))   // Expected: []
console.log(JSON.parse(maps[0].tokens))      // Expected: []

// Test file dialog (UI only — click "Choose Image..." in the create modal)
// Expected: OS file picker opens, PNG/JPG/WEBP filter applied
// After selecting: filename shows below button, small preview renders
```

- Map list page loads correctly, shows empty state initially
- Create modal opens, all fields work, Location dropdown populates from DB
- "Choose Image..." opens OS file picker with correct image filters
- After selecting an image: preview renders in the modal
- After creating a map with an image: card shows thumbnail in the list
- "Open Map" switches to the View B placeholder with correct map name

> **⚠ WARNING:** Do NOT move to Prompt 02 until map create/list/delete all work and images copy correctly into `userData/maps/`.

---

## Agent Prompt 02 — Grid Renderer & Pan/Zoom
### *React-Konva canvas, background image overlay, configurable grid, pan & zoom*

---

### Context

Prompt 01 is complete. Maps can be created, linked to locations, and stored with background images. This prompt builds the core canvas renderer using React-Konva. By the end of this prompt you will have a working interactive map with a background image, a configurable grid overlay, and smooth pan and zoom. Fog of war and tokens come in Prompts 03 and 04.

---

### Your Task

#### ▸ Step 1 — Create the MapCanvas component

📄 `src/components/map/MapCanvas.jsx`

**Component props:**
- `map` — the full map object from SQLite (includes image_path, grid_size, fog_data, tokens)
- `mode` — string: `"dm"` or `"player"`. Controls visibility and available tools
- `onFogChange(fogData)` — callback when fog state changes (Prompt 03)
- `onTokensChange(tokens)` — callback when tokens change (Prompt 04)

**State:**
- `stageScale` — number, default 1.0
- `stagePos` — `{ x: 0, y: 0 }`
- `backgroundImage` — HTML Image object or null
- `imageSize` — `{ width: 0, height: 0 }`
- `canvasSize` — `{ width: window.innerWidth - 240, height: window.innerHeight - 56 }`

**Background image loading:**

```javascript
useEffect(() => {
  if (!map.image_path) return
  window.electronAPI.file.readImageAsBase64(map.image_path).then(base64 => {
    if (!base64) return
    const img = new window.Image()
    img.onload = () => {
      setBackgroundImage(img)
      setImageSize({ width: img.width, height: img.height })
    }
    img.src = base64
  })
}, [map.image_path])
```

**Stage structure (JSX):**

```jsx
<Stage
  width={canvasSize.width}
  height={canvasSize.height}
  scaleX={stageScale}
  scaleY={stageScale}
  x={stagePos.x}
  y={stagePos.y}
  onWheel={handleWheel}
  onMouseDown={handleMouseDown}
  onMouseMove={handleMouseMove}
  onMouseUp={handleMouseUp}
  style={{ background: '#0d0a05', cursor: activeTool === 'pan' ? 'grab' : 'crosshair' }}
>
  <Layer>  {/* Background image layer */}
    {backgroundImage && <KonvaImage image={backgroundImage} x={0} y={0} />}
  </Layer>
  <Layer>  {/* Grid layer */}
    {renderGrid()}
  </Layer>
  <Layer>  {/* Fog of war layer — Prompt 03 */}</Layer>
  <Layer>  {/* Token layer — Prompt 04 */}</Layer>
</Stage>
```

**renderGrid() function:**

```javascript
const renderGrid = () => {
  const lines    = []
  const cellSize = map.grid_size
  const w        = imageSize.width  || 3000
  const h        = imageSize.height || 3000
  const color    = 'rgba(201, 168, 76, 0.35)'  // gold, semi-transparent

  // Vertical lines
  for (let x = 0; x <= w; x += cellSize) {
    lines.push(<Line key={`v${x}`} points={[x, 0, x, h]}
      stroke={color} strokeWidth={0.5} listening={false} />)
  }
  // Horizontal lines
  for (let y = 0; y <= h; y += cellSize) {
    lines.push(<Line key={`h${y}`} points={[0, y, w, y]}
      stroke={color} strokeWidth={0.5} listening={false} />)
  }
  return lines
}
```

**Pan behavior (middle-click-drag or right-click-drag):**

```javascript
const [isPanning, setIsPanning]   = useState(false)
const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 })

const handleMouseDown = (e) => {
  if (e.evt.button === 1 || e.evt.button === 2) {
    e.evt.preventDefault()
    setIsPanning(true)
    setLastPanPos({ x: e.evt.clientX, y: e.evt.clientY })
  }
}

const handleMouseMove = (e) => {
  if (!isPanning) return
  const dx = e.evt.clientX - lastPanPos.x
  const dy = e.evt.clientY - lastPanPos.y
  setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }))
  setLastPanPos({ x: e.evt.clientX, y: e.evt.clientY })
}

const handleMouseUp = () => setIsPanning(false)
```

**Zoom behavior (mouse wheel, zoom to cursor):**

```javascript
const handleWheel = (e) => {
  e.evt.preventDefault()
  const stage    = e.target.getStage()
  const oldScale = stageScale
  const pointer  = stage.getPointerPosition()
  const scaleBy  = 1.05
  const newScale = e.evt.deltaY < 0
    ? Math.min(oldScale * scaleBy, 5)    // max 5×
    : Math.max(oldScale / scaleBy, 0.2)  // min 0.2×

  const mousePointTo = {
    x: (pointer.x - stagePos.x) / oldScale,
    y: (pointer.y - stagePos.y) / oldScale,
  }
  setStageScale(newScale)
  setStagePos({
    x: pointer.x - mousePointTo.x * newScale,
    y: pointer.y - mousePointTo.y * newScale,
  })
}
```

---

#### ▸ Step 2 — Create the MapToolbar component

📄 `src/components/map/MapToolbar.jsx`

Props: `activeTool`, `onToolChange`, `gridSize`, `onGridSizeChange`, `mapName`, `onBack`, `stageScale`, `onResetView`.

- Tool buttons (left side): Pan 🤚, Fog Brush 🌫️ (disabled — Prompt 03), Token 🪙 (disabled — Prompt 04)
- Grid size control (center): minus button, number display, plus button (step 5, min 20, max 100). Changes applied live.
- "Save Grid Size" button — calls `db.maps.update(map.id, { ...map, grid_size: currentGridSize })`
- Map name display (right side)
- "← Maps" back button (right side) — calls `onBack()`
- Zoom level display: "75%" updated from `stageScale` prop
- "Reset View" button — resets scale to 1.0 and position to `{ x: 0, y: 0 }`

---

#### ▸ Step 3 — Wire MapCanvas into MapEngine.jsx

📄 `src/pages/MapEngine.jsx`

- Import and render `MapCanvas` when `activeMap !== null`
- Import and render `MapToolbar` above the canvas
- Lift `stageScale` and `stagePos` state to `MapEngine.jsx` and pass down as props
- Pass `activeTool` state to both components
- "← Maps" in MapToolbar sets `activeMap` back to null

---

#### ▸ Step 4 — Handle canvas resize

```javascript
useEffect(() => {
  const updateSize = () => setCanvasSize({
    width:  window.innerWidth  - 240,  // sidebar width
    height: window.innerHeight - 56,   // topbar height
  })
  window.addEventListener('resize', updateSize)
  return () => window.removeEventListener('resize', updateSize)
}, [])
```

---

### Verification Steps

> **✓ VERIFY:** Open a map and verify the canvas:

- Canvas fills the available space (window width minus sidebar, height minus topbar)
- Background image renders at full size if an image was imported in Prompt 01
- Gold semi-transparent grid lines overlay the image at the correct `grid_size` spacing
- Mouse wheel zooms in/out centered on the cursor position (zoom to cursor, not center)
- Middle-click-drag (or right-click-drag) pans the canvas smoothly
- "Reset View" button returns scale to 100% and position to origin
- Grid size +/- buttons update the grid live without a page reload
- "Save Grid Size" persists the new value:

```javascript
await window.electronAPI.db.maps.getById(1)
// grid_size field should reflect the value you saved
```

> **⚠ WARNING:** Do NOT move to Prompt 03 until zoom-to-cursor, pan, and grid rendering all work correctly on both image and no-image maps.

---

## Agent Prompt 03 — Fog of War
### *Cell-level bitmask, DM reveal/hide brush tools, persisted to SQLite*

---

### Context

Prompts 01 and 02 are complete. The map canvas renders with background image, grid, pan, and zoom. This prompt adds fog of war — a cell-level visibility system where the DM controls which grid cells are revealed to players. The fog state is stored as a 2D boolean array (bitmask) in the SQLite `fog_data` JSON column and persisted on every brush stroke.

---

### Your Task

#### ▸ Step 1 — Define the fog data structure

📄 `src/utils/fogUtils.js`

```javascript
export const getCellIndex = (col, row, numCols) => row * numCols + col

export const initFog = (numCols, numRows, revealed = false) =>
  new Array(numCols * numRows).fill(revealed)

export const isCellRevealed = (fogData, col, row, numCols) =>
  fogData[getCellIndex(col, row, numCols)] === true

export const setCellRevealed = (fogData, col, row, numCols, revealed) => {
  const next = [...fogData]
  next[getCellIndex(col, row, numCols)] = revealed
  return next
}

export const setBrushRevealed = (fogData, col, row, numCols, numRows, brushSize, revealed) => {
  let next = [...fogData]
  const half = Math.floor(brushSize / 2)
  for (let r = row - half; r <= row + half; r++) {
    for (let c = col - half; c <= col + half; c++) {
      if (c >= 0 && c < numCols && r >= 0 && r < numRows) {
        next[getCellIndex(c, r, numCols)] = revealed
      }
    }
  }
  return next
}

export const getMapDimensions = (imageSize, gridSize, fallbackW = 3000, fallbackH = 3000) => {
  const w = imageSize.width  || fallbackW
  const h = imageSize.height || fallbackH
  return {
    numCols: Math.ceil(w / gridSize),
    numRows: Math.ceil(h / gridSize)
  }
}
```

---

#### ▸ Step 2 — Initialize fog state in MapCanvas

```javascript
import { initFog, isCellRevealed, setBrushRevealed, getMapDimensions } from '../../utils/fogUtils'

const [fogData,      setFogData]      = useState([])
const [fogBrushSize, setFogBrushSize] = useState(1) // 1=single cell, 3=3×3, 5=5×5

useEffect(() => {
  const { numCols, numRows } = getMapDimensions(imageSize, map.grid_size)
  const saved = map.fog_data ? JSON.parse(map.fog_data) : []
  if (saved.length === numCols * numRows) {
    setFogData(saved)
  } else {
    setFogData(initFog(numCols, numRows, false))  // all hidden by default
  }
}, [imageSize, map.grid_size, map.fog_data])
```

---

#### ▸ Step 3 — Render fog layer

In the Fog of War Layer (Layer 3 in the Stage):

```javascript
const renderFog = () => {
  if (!fogData.length) return null
  const { numCols, numRows } = getMapDimensions(imageSize, map.grid_size)
  const rects = []
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      if (!isCellRevealed(fogData, col, row, numCols)) {
        rects.push(
          <Rect
            key={`fog-${col}-${row}`}
            x={col * map.grid_size}
            y={row * map.grid_size}
            width={map.grid_size}
            height={map.grid_size}
            fill="rgba(10, 8, 5, 0.92)"
            listening={false}
          />
        )
      }
    }
  }
  return rects
}
```

> **ℹ NOTE:** For large maps (60×60+ cells) rendering thousands of individual Rects causes performance issues. For this phase, the simple rect-per-cell approach is acceptable. Add a comment: `// TODO Phase 7 optimization: merge fog into a single clipping mask`

---

#### ▸ Step 4 — Fog brush interaction

```javascript
const [isFogPainting, setIsFogPainting] = useState(false)

const pixelToCell = (stageX, stageY) => ({
  col: Math.floor(stageX / map.grid_size),
  row: Math.floor(stageY / map.grid_size),
})

const pointerToStage = (e) => {
  const stage   = e.target.getStage()
  const pointer = stage.getPointerPosition()
  return {
    x: (pointer.x - stagePos.x) / stageScale,
    y: (pointer.y - stagePos.y) / stageScale,
  }
}

const applyFogBrush = (e) => {
  if (mode !== 'dm') return
  if (activeTool !== 'fog-reveal' && activeTool !== 'fog-hide') return
  const { x, y }       = pointerToStage(e)
  const { col, row }   = pixelToCell(x, y)
  const { numCols, numRows } = getMapDimensions(imageSize, map.grid_size)
  const revealed       = activeTool === 'fog-reveal'
  const next           = setBrushRevealed(fogData, col, row, numCols, numRows, fogBrushSize, revealed)
  setFogData(next)
  debounceSaveFog(next)
}

// Debounced save — only write to DB after 500ms of inactivity
const saveFogRef = useRef(null)
const debounceSaveFog = (next) => {
  clearTimeout(saveFogRef.current)
  saveFogRef.current = setTimeout(() => {
    window.electronAPI.db.maps.updateFog(map.id, next)
    onFogChange?.(next)
  }, 500)
}

// Wire into existing mouse handlers:
// handleMouseDown: if fog tool active, setIsFogPainting(true) and applyFogBrush(e)
// handleMouseMove: if isFogPainting, applyFogBrush(e)
// handleMouseUp:   setIsFogPainting(false)
```

---

#### ▸ Step 5 — Update MapToolbar for fog tools

📄 `src/components/map/MapToolbar.jsx`

- Enable "Fog Reveal 🌟" tool button — sets `activeTool` to `"fog-reveal"`
- Enable "Fog Hide 🌫️" tool button — sets `activeTool` to `"fog-hide"`
- Brush size toggle buttons: small (1×1), medium (3×3), large (5×5)
- "Reveal All" button — sets all fog cells to `true` and saves
- "Hide All" button — sets all fog cells to `false` and saves
- Pass `brushSize` and `onBrushSizeChange` props to MapCanvas

---

#### ▸ Step 6 — Add Reveal All / Hide All handlers

```javascript
const revealAll = () => {
  const { numCols, numRows } = getMapDimensions(imageSize, map.grid_size)
  const next = initFog(numCols, numRows, true)
  setFogData(next)
  window.electronAPI.db.maps.updateFog(map.id, next)
}

const hideAll = () => {
  const { numCols, numRows } = getMapDimensions(imageSize, map.grid_size)
  const next = initFog(numCols, numRows, false)
  setFogData(next)
  window.electronAPI.db.maps.updateFog(map.id, next)
}
// Expose these via useImperativeHandle or pass as callbacks via props from MapEngine.jsx
```

---

### Verification Steps

> **✓ VERIFY:** Test the full fog of war flow:

- Open a map — all cells are hidden (dark fog covers entire canvas)
- Select "Fog Reveal" tool, paint over cells — background visible through revealed cells
- Select "Fog Hide" tool, paint over revealed cells — fog returns
- Switch to 3×3 brush — painting reveals a 3-cell-wide stroke
- "Reveal All" clears all fog instantly — full map visible
- "Hide All" re-covers the entire map
- Close the map and reopen it — fog state is restored from SQLite correctly

```javascript
const m   = await window.electronAPI.db.maps.getById(1)
const fog = JSON.parse(m.fog_data)
console.log(fog.length)                  // numCols * numRows
console.log(fog.filter(Boolean).length)  // count of revealed cells
```

> **⚠ WARNING:** Do NOT move to Prompt 04 until fog state persists correctly across map close/reopen and the debounced save is working (not writing to DB on every mouse move).

---

## Agent Prompt 04 — Unit Tokens & Movement
### *Token placement, drag-to-move, snap-to-grid, NPC/character stat block links*

---

### Context

Prompts 01–03 are complete. The map canvas has a background image, grid, pan/zoom, and fog of war. This prompt adds unit tokens — circular icons that represent players, NPCs, and monsters on the map. Tokens snap to the grid, can be dragged to new positions, are color-coded by type, and link back to their NPC or character record in the World Builder.

---

### Your Task

#### ▸ Step 1 — Define the token data structure

📄 `src/utils/tokenUtils.js`

```javascript
// Token shape stored in maps.tokens JSON array:
// { id, label, type, col, row, color, entity_type, entity_id }

export const TOKEN_COLORS = {
  player:  '#4A90D9',  // blue
  npc:     '#F5A623',  // amber
  monster: '#D0021B',  // red
  object:  '#7B7B7B',  // gray
}

export const createToken = (label, type, col, row, entityType = null, entityId = null) => ({
  id:          crypto.randomUUID(),
  label,
  type,
  col,
  row,
  color:       TOKEN_COLORS[type] ?? TOKEN_COLORS.object,
  entity_type: entityType,
  entity_id:   entityId,
})

export const snapToGrid = (pixelX, pixelY, gridSize) => ({
  col: Math.floor(pixelX / gridSize),
  row: Math.floor(pixelY / gridSize),
})

export const tokenToPixel = (col, row, gridSize) => ({
  x: col * gridSize + gridSize / 2,  // center of cell
  y: row * gridSize + gridSize / 2,
})
```

---

#### ▸ Step 2 — Build the MapToken Konva component

📄 `src/components/map/MapToken.jsx`

```jsx
import { Group, Circle, Text } from 'react-konva'
import { tokenToPixel, snapToGrid } from '../../utils/tokenUtils'

export default function MapToken({ token, gridSize, isSelected, onSelect, onDragEnd, mode }) {
  const { x, y } = tokenToPixel(token.col, token.row, gridSize)
  const radius    = gridSize * 0.38

  return (
    <Group
      x={x} y={y}
      draggable={mode === 'dm'}
      onClick={() => onSelect(token)}
      onDragEnd={(e) => {
        const stage      = e.target.getStage()
        const absPos     = e.target.getAbsolutePosition()
        const stagePos   = stage.position()
        const stageScale = stage.scaleX()
        const stageX     = (absPos.x - stagePos.x) / stageScale
        const stageY     = (absPos.y - stagePos.y) / stageScale
        const { col, row } = snapToGrid(stageX, stageY, gridSize)
        onDragEnd(token.id, col, row)
      }}
    >
      {/* Outer ring — token type color */}
      <Circle radius={radius + 3} fill={token.color} />
      {/* Inner fill */}
      <Circle radius={radius} fill={isSelected ? '#2a2a2a' : '#1a1a1a'} />
      {/* Selection ring */}
      {isSelected && <Circle radius={radius + 5} stroke={'#ffffff'} strokeWidth={1.5} fill={'transparent'} />}
      {/* 3-char label */}
      <Text
        text={token.label.substring(0, 3).toUpperCase()}
        fontSize={gridSize * 0.28}
        fill="white"
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
        offsetX={gridSize * 0.14}
        offsetY={gridSize * 0.1}
        listening={false}
      />
      {/* Full name below */}
      <Text
        text={token.label}
        fontSize={9}
        fill="rgba(255,255,255,0.8)"
        align="center"
        offsetX={40}
        y={radius + 4}
        width={80}
        listening={false}
      />
    </Group>
  )
}
```

---

#### ▸ Step 3 — Wire tokens into MapCanvas

```javascript
const [tokens,        setTokens]        = useState([])
const [selectedToken, setSelectedToken] = useState(null)

useEffect(() => {
  setTokens(map.tokens ? JSON.parse(map.tokens) : [])
}, [map.tokens])

const saveTokensRef = useRef(null)
const saveTokens = (next) => {
  clearTimeout(saveTokensRef.current)
  saveTokensRef.current = setTimeout(() => {
    window.electronAPI.db.maps.updateTokens(map.id, next)
    onTokensChange?.(next)
  }, 300)
}

const handleTokenDragEnd = (tokenId, newCol, newRow) => {
  const next = tokens.map(t => t.id === tokenId ? { ...t, col: newCol, row: newRow } : t)
  setTokens(next)
  saveTokens(next)
}

const addToken = (token) => {
  const next = [...tokens, token]
  setTokens(next)
  saveTokens(next)
}

const deleteSelectedToken = () => {
  if (!selectedToken) return
  const next = tokens.filter(t => t.id !== selectedToken.id)
  setTokens(next)
  setSelectedToken(null)
  saveTokens(next)
}
```

In the Token Layer (Layer 4):

```jsx
<Layer>
  {tokens.map(token => (
    <MapToken
      key={token.id}
      token={token}
      gridSize={map.grid_size}
      isSelected={selectedToken?.id === token.id}
      onSelect={setSelectedToken}
      onDragEnd={handleTokenDragEnd}
      mode={mode}
    />
  ))}
</Layer>
```

---

#### ▸ Step 4 — Build the Add Token modal

📄 `src/components/map/AddTokenModal.jsx`

- Label — text input, required
- Type — select: Player, NPC, Monster, Object
- Link to Entity (optional):
  - If type is "player": dropdown of `db.characters.getAll(campaignId)`
  - If type is "npc": dropdown of `db.npcs.getAll(campaignId)`
  - If type is "monster": free text label only
- Color preview — small circle showing the auto-assigned color for the type
- On submit: call `addToken` callback with new token at the clicked cell

Wire the double-click trigger in MapCanvas:

```javascript
const handleDblClick = (e) => {
  if (activeTool !== 'token') return
  if (mode !== 'dm') return
  const { x, y }     = pointerToStage(e)
  const { col, row } = snapToGrid(x, y, map.grid_size)
  setAddTokenCell({ col, row })
  setShowAddTokenModal(true)
}
```

---

#### ▸ Step 5 — Build the Token Inspector panel

📄 `src/components/map/TokenInspector.jsx`

Overlay panel inside the canvas container, bottom-left:

- Token name, type badge, current position ("Col 4, Row 7")
- If `entity_type` is `"npc"`: "View NPC" button that opens NPCQuickView
- If `entity_type` is `"character"`: "View Character" button (placeholder for Phase 4)
- "Delete Token" button — calls `deleteSelectedToken()`
- "Deselect" (X) button — clears `selectedToken`

---

#### ▸ Step 6 — Enable Token tool in MapToolbar

- Token 🪙 button sets `activeTool` to `"token"`
- When token tool active and a token is selected: show "Delete Token" shortcut
- Hint text when token tool active: "Double-click a cell to place a token. Click a token to select it. Drag to move."

---

### Verification Steps

> **✓ VERIFY:** Test the full token flow:

- Select Token tool, double-click a cell — AddTokenModal opens
- Create a Player token (blue ring), NPC token (amber ring), Monster token (red ring)
- Drag a token to a new cell — snaps to grid at new position
- Click a token — TokenInspector shows name, type, position
- Click "View NPC" on an NPC token — NPCQuickView slides in with correct NPC data
- Delete a token — disappears from canvas
- Close and reopen the map — all tokens restore to saved positions

```javascript
const m      = await window.electronAPI.db.maps.getById(1)
const tokens = JSON.parse(m.tokens)
console.log(tokens)  // should show all tokens with col/row positions
```

> **⚠ WARNING:** Do NOT move to Prompt 05 until tokens save/restore correctly, drag-to-snap works, and the NPC quick-view link works from the token inspector.

---

## Agent Prompt 05 — Map Polish, DM vs Player View & Phase 3 Audit
### *Player fog enforcement, map thumbnails, performance, and phase completion*

---

### Context

Prompts 01–04 are complete. The Map Engine has background image import, grid rendering, pan/zoom, fog of war, and token placement/movement. This final Phase 3 prompt enforces the DM vs Player view split, adds map thumbnail generation, improves performance for large maps, and runs a full Phase 3 audit before the git commit.

---

### Your Task

#### ▸ Step 1 — Enforce DM vs Player view

📄 `src/components/map/MapCanvas.jsx`

**DM mode (`mode === "dm"`):**
- All fog cells rendered — DM can see and paint fog
- Fog tools available
- Token drag enabled
- AddTokenModal accessible via double-click
- TokenInspector shows full data including NPC secrets link

**Player mode (`mode === "player"`):**
- Fog cells are fully opaque — players see only revealed cells
- Unrevealed cells render as solid black — no hint of what lies beneath
- Fog tools hidden in toolbar
- Token drag disabled
- AddTokenModal disabled
- TokenInspector shows only token label and type — no entity links

Add a "DM / Player" mode toggle button to MapToolbar. In player mode, toolbar shows a "Player View" badge and hides all DM tools.

---

#### ▸ Step 2 — Add map thumbnail generation

📄 `src/components/map/MapCanvas.jsx`

```javascript
const stageRef = useRef(null)

const generateThumbnail = async () => {
  if (!stageRef.current) return
  const stage   = stageRef.current
  const dataUrl = stage.toDataURL({ pixelRatio: 0.2 })  // 20% = small thumbnail
  const base64  = dataUrl.split(',')[1]
  await window.electronAPI.file.saveThumbnail(map.id, base64)
}
// Add ref to Stage: <Stage ref={stageRef} ...>
```

📄 `electron/ipc/fileHandlers.js` — add thumbnail handlers:

```javascript
ipcMain.handle('file:saveThumbnail', async (_, mapId, base64) => {
  const thumbsDir = path.join(app.getPath('userData'), 'maps', 'thumbs')
  if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true })
  const destPath  = path.join(thumbsDir, `thumb_${mapId}.png`)
  fs.writeFileSync(destPath, Buffer.from(base64, 'base64'))
  return destPath
})

ipcMain.handle('file:readThumbnail', (_, mapId) => {
  const thumbPath = path.join(app.getPath('userData'), 'maps', 'thumbs', `thumb_${mapId}.png`)
  if (!fs.existsSync(thumbPath)) return null
  const buffer = fs.readFileSync(thumbPath)
  return `data:image/png;base64,${buffer.toString('base64')}`
})
```

Expose in preload.js:
- `file.saveThumbnail(mapId, base64)`
- `file.readThumbnail(mapId)`

📄 `src/pages/MapEngine.jsx` — update map list:
- Call `file.readThumbnail(map.id)` for each map — display if available, placeholder grid icon if not
- Add "📷 Update Thumbnail" button in MapToolbar that calls `generateThumbnail()`

---

#### ▸ Step 3 — Performance improvements for large maps

**Fog render optimization:**
- Add helper: `isInViewport(col, row, gridSize, stagePos, stageScale, canvasSize)` — returns false for cells outside the visible area
- Wrap the fog rendering loop with this check — only render visible fog rects

**Grid render optimization:**
- Calculate the visible range of columns and rows based on `stagePos`, `stageScale`, and `canvasSize`
- Replace full-map grid loops with viewport-bounded loops

---

#### ▸ Step 4 — Map list improvements

📄 `src/pages/MapEngine.jsx`

- Add search input to filter maps by name
- Show location name badge on each card
- Show token count: `JSON.parse(map.tokens).length` formatted as "3 tokens"
- Show fog coverage: `revealed / total × 100` formatted as "42% revealed"
- Add "Duplicate Map" option — new record with same name + " (copy)", same grid_size and location_id, empty fog and tokens, image file copied to new path

---

#### ▸ Step 5 — Phase 3 audit checklist

Before the commit, verify every item:

- [ ] Map CRUD: create, list, edit name/location/grid, delete — all working
- [ ] Image import: OS file picker opens, image copies to `userData/maps/`, renders on canvas
- [ ] Grid: renders at correct `grid_size`, updates live from toolbar, saves to DB
- [ ] Pan: middle-click-drag pans smoothly, does not interfere with other tools
- [ ] Zoom: mouse wheel zooms to cursor, min 0.2×, max 5×, Reset View works
- [ ] Fog: reveal/hide brush work, 3 brush sizes work, Reveal All / Hide All work
- [ ] Fog persistence: fog saves to DB and restores correctly on map reopen
- [ ] Tokens: place, drag-snap, select, inspect, delete — all working
- [ ] Token persistence: tokens save and restore on map reopen
- [ ] DM mode: all tools available
- [ ] Player mode: fog is opaque, tools hidden, drag disabled
- [ ] Thumbnail: generate and display in map list
- [ ] No console errors on any map operation

---

### Verification Steps

> **✓ VERIFY:** Full Phase 3 end-to-end flow:

- Create a map with an image — thumbnail shows in list after "Update Thumbnail"
- Open map → pan → zoom in/out → grid stays aligned with image
- Paint fog with all three brush sizes — fog restores after map close/reopen
- Place 3 tokens (player, NPC, monster) — they restore after map close/reopen
- Drag tokens to new cells — positions snap correctly and save
- Switch to Player mode — fog is solid black, token drag disabled, tools hidden
- Switch back to DM mode — all tools restored
- "Duplicate Map" creates a copy with empty fog and tokens

```javascript
// Verify token and fog persistence
const m = await window.electronAPI.db.maps.getById(1)
console.log(JSON.parse(m.tokens).length)  // should match tokens on canvas
const fog = JSON.parse(m.fog_data)
console.log(fog.filter(Boolean).length + " revealed of " + fog.length + " total")
```

> **✓ VERIFY:** Phase 3 is complete when the full flow works: create map → import image → paint fog → place tokens → switch to player view → close → reopen → all state restored.

```bash
git add .
git commit -m "[Phase 3] Complete: Map Engine — image import, grid, pan/zoom, fog of war, tokens, DM/player view"
git push
```

---

*⚔ End of Phase 3 Agent Prompts ⚔*
