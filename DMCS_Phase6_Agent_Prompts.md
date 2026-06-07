# ⚔ DMCS — Phase 6 Agent Prompts
## Mind Maps — Claude Code Edition

> **Save this file as:** `DMCS_Phase6_Agent_Prompts.md`
> Place it in the root of your project folder alongside the spec and rules documents.

**Modules covered:** React Flow · Node Types · Dagre Layout · Filters · Position Persistence · AI Insights · Export

---

## Prompt Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | React Flow Setup & Node Types | Install @xyflow/react, four custom node components, Mind Map page shell | 1 – 2 hrs |
| 02 | Edge Types & Connection Data | Custom MindMapEdge, useMindMapData hook, NodeDetailPanel with real DB data | 2 – 3 hrs |
| 03 | Dagre Auto-Layout & Filters | applyDagreLayout(), MindMapToolbar with type/faction/search filters, subgraph highlighting | 2 – 3 hrs |
| 04 | Position Persistence & Mini-Map | onNodeDragStop DB save, MiniMap, keyboard shortcuts, GraphStatsPanel | 1 – 2 hrs |
| 05 | Polish, AI Insights & Audit | AI relationship analysis, in-graph edge creation, PNG export, edge context menu, full audit | 2 – 3 hrs |

*Total estimated time: 8 – 13 hours*

> **⚔ RULE:** Before starting any prompt, open your Claude Code session with the Master Session Opener from `DMCS_Claude_Code_Rules.md`. Update the filename to `DMCS_Phase6_Agent_Prompts.md`.

---

## Agent Prompt 01 — React Flow Setup & Node Types
### *Install React Flow, define node components for NPCs, locations, and factions*

---

### Context

Phase 5 is complete. The Encounter Builder, XP Calculator, Initiative Tracker, conditions, combat log, and map integration are all fully working. This is Prompt 01 of 05 for Phase 6. You are building the Mind Map module — an interactive node/edge graph that visualizes relationships between NPCs, locations, factions, and items. The connection data already exists in the connections table from Phase 2. This phase is purely about surfacing it visually using React Flow.

---

### Your Task

#### ▸ Step 1 — Install React Flow and Dagre

```bash
npm install @xyflow/react
npm install @dagrejs/dagre
```

> **ℹ NOTE:** React Flow v12+ uses the `@xyflow/react` package name. Import from `"@xyflow/react"`, NOT the older `"reactflow"` package. Do NOT install the old `"reactflow"` package — they conflict.

---

#### ▸ Step 2 — Add Mind Map position IPC handlers

📄 `electron/ipc/dbHandlers.js`

The `mind_map_positions` table was created in Phase 1 Migration 001. Append these handlers:

```javascript
// Mind Map positions
ipcMain.handle('db:mindmap:getPositions', (_, campaignId) =>
  db.all('SELECT * FROM mind_map_positions WHERE campaign_id = ?', [campaignId]))

ipcMain.handle('db:mindmap:savePosition', (_, data) => {
  const existing = db.get(
    'SELECT id FROM mind_map_positions WHERE campaign_id=? AND entity_type=? AND entity_id=?',
    [data.campaign_id, data.entity_type, data.entity_id])
  if (existing) {
    return db.run(
      'UPDATE mind_map_positions SET x_pos=?, y_pos=? WHERE id=?',
      [data.x_pos, data.y_pos, existing.id])
  }
  return db.run(
    'INSERT INTO mind_map_positions (campaign_id, entity_type, entity_id, x_pos, y_pos) VALUES (?,?,?,?,?)',
    [data.campaign_id, data.entity_type, data.entity_id, data.x_pos, data.y_pos])
})

ipcMain.handle('db:mindmap:savePositions', (_, campaignId, positions) => {
  return db.transaction(() => {
    positions.forEach(p => {
      const existing = db.get(
        'SELECT id FROM mind_map_positions WHERE campaign_id=? AND entity_type=? AND entity_id=?',
        [campaignId, p.entity_type, p.entity_id])
      if (existing) {
        db.run('UPDATE mind_map_positions SET x_pos=?, y_pos=? WHERE id=?',
          [p.x_pos, p.y_pos, existing.id])
      } else {
        db.run('INSERT INTO mind_map_positions (campaign_id, entity_type, entity_id, x_pos, y_pos) VALUES (?,?,?,?,?)',
          [campaignId, p.entity_type, p.entity_id, p.x_pos, p.y_pos])
      }
    })
  })()
})

ipcMain.handle('db:mindmap:clearPositions', (_, campaignId) =>
  db.run('DELETE FROM mind_map_positions WHERE campaign_id=?', [campaignId]))
```

---

#### ▸ Step 3 — Update preload.js

- `db.mindmap.getPositions(campaignId)`
- `db.mindmap.savePosition(data)`
- `db.mindmap.savePositions(campaignId, positions)`
- `db.mindmap.clearPositions(campaignId)`

---

#### ▸ Step 4 — Define node type constants and styles

📄 `src/utils/mindMapUtils.js`

```javascript
export const NODE_TYPES = {
  npc:      'npc',
  location: 'location',
  faction:  'faction',
  item:     'item',
}

export const NODE_CONFIG = {
  npc:      { color: '#4A90D9', background: '#0D1F36', icon: '👤', label: 'NPC'      },
  location: { color: '#C9A84C', background: '#2A1F06', icon: '🏰', label: 'Location' },
  faction:  { color: '#9B59B6', background: '#1E0A2E', icon: '🛡️', label: 'Faction'  },
  item:     { color: '#2ECC71', background: '#062014', icon: '💎', label: 'Item'     },
}

// Build a React Flow node from a DB entity
export const buildNode = (entityType, entity, position = { x: 0, y: 0 }) => ({
  id:       `${entityType}-${entity.id}`,
  type:     entityType,
  position,
  data: {
    label:      entity.name ?? entity.character_name,
    entityType,
    entityId:   entity.id,
    subtitle:   entity.role ?? entity.type ?? entity.alignment ?? '',
    isAlive:    entity.is_alive,
    raw:        entity,
  },
})

// Build a React Flow edge from a DB connection
export const buildEdge = (connection) => ({
  id:       `conn-${connection.id}`,
  source:   `${connection.entity_a_type}-${connection.entity_a_id}`,
  target:   `${connection.entity_b_type}-${connection.entity_b_id}`,
  label:    connection.relationship,
  type:     'mindMapEdge',
  data:     { notes: connection.notes, connectionId: connection.id },
  animated: false,
  style:    { stroke: '#C9A84C', strokeWidth: 1.5 },
})
```

---

#### ▸ Step 5 — Build NPCNode component

📄 `src/components/mindmap/nodes/NPCNode.jsx`

```jsx
import { Handle, Position } from '@xyflow/react'
import { NODE_CONFIG } from '../../../utils/mindMapUtils'

export default function NPCNode({ data, selected }) {
  const cfg = NODE_CONFIG.npc
  return (
    <>
      <Handle type="target" position={Position.Top}    style={{ background: cfg.color }} />
      <Handle type="source" position={Position.Bottom} style={{ background: cfg.color }} />
      <Handle type="target" position={Position.Left}   style={{ background: cfg.color }} />
      <Handle type="source" position={Position.Right}  style={{ background: cfg.color }} />
      <div style={{
        background:   data.isAlive === 0 ? '#1a0000' : cfg.background,
        border:       `2px solid ${selected ? '#ffffff' : cfg.color}`,
        borderRadius: '8px',
        padding:      '10px 14px',
        minWidth:     '120px',
        maxWidth:     '180px',
        cursor:       'pointer',
        boxShadow:    selected ? `0 0 12px ${cfg.color}` : 'none',
        opacity:      data.isAlive === 0 ? 0.6 : 1,
      }}>
        <div style={{ fontSize: '18px', marginBottom: '4px' }}>{cfg.icon}</div>
        <div style={{ fontFamily: 'Georgia', fontSize: '13px', fontWeight: 'bold', color: cfg.color, wordBreak: 'break-word' }}>
          {data.label}
          {data.isAlive === 0 && <span style={{ marginLeft: '4px', fontSize: '10px' }}>💀</span>}
        </div>
        {data.subtitle && (
          <div style={{ fontSize: '11px', color: '#8a8a8a', marginTop: '2px' }}>{data.subtitle}</div>
        )}
        <div style={{ position: 'absolute', top: '4px', right: '6px', fontSize: '9px',
          color: cfg.color, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          NPC
        </div>
      </div>
    </>
  )
}
```

---

#### ▸ Step 6 — Build Location, Faction, and Item node components

📄 `src/components/mindmap/nodes/LocationNode.jsx`
📄 `src/components/mindmap/nodes/FactionNode.jsx`
📄 `src/components/mindmap/nodes/ItemNode.jsx`

Use the same pattern as NPCNode but with each type's `NODE_CONFIG` entry. Key differences:

- **LocationNode:** subtitle shows location type (town/dungeon/shop/etc.), no alive/dead indicator, type label "LOCATION"
- **FactionNode:** subtitle shows alignment, border uses purple (#9B59B6), type label "FACTION"
- **ItemNode:** subtitle shows item rarity or type, type label "ITEM" (only renders if items exist in `compendium_custom`)

---

#### ▸ Step 7 — Build the MindMap page shell

📄 `src/pages/MindMap.jsx`

```jsx
import { ReactFlow, Background, Controls } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import NPCNode      from '../components/mindmap/nodes/NPCNode'
import LocationNode from '../components/mindmap/nodes/LocationNode'
import FactionNode  from '../components/mindmap/nodes/FactionNode'
import ItemNode     from '../components/mindmap/nodes/ItemNode'

const nodeTypes = { npc: NPCNode, location: LocationNode, faction: FactionNode, item: ItemNode }

// Placeholder nodes to confirm rendering
const placeholderNodes = [
  { id: 'npc-1',      type: 'npc',      position: { x: 100, y: 100 }, data: { label: 'Test NPC',     subtitle: 'Innkeeper',       isAlive: 1 } },
  { id: 'location-1', type: 'location', position: { x: 300, y: 200 }, data: { label: 'Test Town',    subtitle: 'town'             } },
  { id: 'faction-1',  type: 'faction',  position: { x: 100, y: 300 }, data: { label: 'Test Faction', subtitle: 'Chaotic Neutral'  } },
]

export default function MindMap() {
  return (
    <div style={{ width: '100%', height: 'calc(100vh - 56px)', background: '#0d0a05' }}>
      <ReactFlow
        nodes={placeholderNodes}
        edges={[]}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="#2d1f0a" gap={24} />
        <Controls />
      </ReactFlow>
    </div>
  )
}
```

---

### Verification Steps

> **✓ VERIFY:**

```bash
# Navigate to /mindmap in the sidebar
```

- Mind Map page renders without console errors
- Three placeholder nodes visible: blue NPC node, gold Location node, purple Faction node
- Each node shows correct icon (👤 🏰 🛡️), label, and subtitle
- React Flow controls (zoom in/out, fit view) work in the bottom-left corner
- Dark background grid renders correctly
- Nodes can be dragged around the canvas

> **ℹ NOTE:** The `@xyflow/react` CSS import is required — without it, nodes render without handles or proper styling. Confirm the import is present in MindMap.jsx.

> **⚠ WARNING:** Do NOT move to Prompt 02 until all four node types render without errors and the React Flow canvas is interactive.

---

## Agent Prompt 02 — Edge Types & Connection Data
### *Load world entities and connections from DB, render edges with relationship labels*

---

### Context

Prompt 01 is complete. React Flow is installed, all four node types render correctly, and the Mind Map page shell works with placeholder data. This prompt replaces placeholder data with real campaign data — loading NPCs, locations, factions, and connections from the database and building a live graph. It also builds the custom edge component for relationship labels.

---

### Your Task

#### ▸ Step 1 — Build the custom edge component

📄 `src/components/mindmap/edges/MindMapEdge.jsx`

```jsx
import { getBezierPath, EdgeLabelRenderer } from '@xyflow/react'

export default function MindMapEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        stroke={selected ? '#ffffff' : '#C9A84C'}
        strokeWidth={selected ? 2 : 1.5}
        strokeOpacity={0.7}
        fill="none"
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position:      'absolute',
            transform:     `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            background:    '#1a1208',
            border:        '1px solid #C9A84C',
            borderRadius:  '4px',
            padding:       '2px 8px',
            fontSize:      '10px',
            color:         '#C9A84C',
            fontFamily:    'Arial',
            letterSpacing: '0.3px',
            pointerEvents: 'all',
            cursor:        'pointer',
            whiteSpace:    'nowrap',
            textTransform: 'lowercase',
            maxWidth:      '120px',
            overflow:      'hidden',
            textOverflow:  'ellipsis',
          }}
          className="nodrag nopan"
        >
          {data?.label ?? ''}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
```

---

#### ▸ Step 2 — Build the graph data loading hook

📄 `src/hooks/useMindMapData.js`

```javascript
import { useState, useEffect, useCallback } from 'react'
import { buildNode, buildEdge } from '../utils/mindMapUtils'

export function useMindMapData(campaignId) {
  const [nodes,   setNodes]   = useState([])
  const [edges,   setEdges]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    try {
      const [npcs, locations, factions, connections, savedPositions] = await Promise.all([
        window.electronAPI.db.npcs.getAll(campaignId),
        window.electronAPI.db.locations.getAll(campaignId),
        window.electronAPI.db.factions.getAll(campaignId),
        window.electronAPI.db.connections.getAll(campaignId),
        window.electronAPI.db.mindmap.getPositions(campaignId),
      ])

      // Build position lookup: "npc-5" → { x, y }
      const posMap = {}
      savedPositions.forEach(p => {
        posMap[`${p.entity_type}-${p.entity_id}`] = { x: p.x_pos, y: p.y_pos }
      })

      // Build nodes — use saved position or default grid placement
      const allNodes = [
        ...npcs.map((e, i)       => buildNode('npc',      e, posMap[`npc-${e.id}`]      ?? { x: i * 220, y: 0   })),
        ...locations.map((e, i)  => buildNode('location', e, posMap[`location-${e.id}`] ?? { x: i * 220, y: 220 })),
        ...factions.map((e, i)   => buildNode('faction',  e, posMap[`faction-${e.id}`]  ?? { x: i * 220, y: 440 })),
      ]

      // Build edges — only include edges where BOTH endpoints exist as nodes
      const nodeIds  = new Set(allNodes.map(n => n.id))
      const allEdges = connections
        .map(buildEdge)
        .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))

      setNodes(allNodes)
      setEdges(allEdges)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => { load() }, [load])

  return { nodes, edges, setNodes, setEdges, loading, error, reload: load }
}
```

---

#### ▸ Step 3 — Wire real data into MindMap.jsx

```jsx
import { ReactFlow, Background, Controls, useNodesState, useEdgesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMindMapData }  from '../hooks/useMindMapData'
import useCampaignStore    from '../stores/campaignStore'
import MindMapEdge         from '../components/mindmap/edges/MindMapEdge'

const nodeTypes = { npc: NPCNode, location: LocationNode, faction: FactionNode, item: ItemNode }
const edgeTypes = { mindMapEdge: MindMapEdge }

export default function MindMap() {
  const { activeCampaign } = useCampaignStore()
  const { nodes: initNodes, edges: initEdges, loading, error, reload }
    = useMindMapData(activeCampaign?.id)

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)

  // Sync hook data into React Flow state when it loads
  useEffect(() => {
    setNodes(initNodes)
    setEdges(initEdges)
  }, [initNodes, initEdges])

  if (!activeCampaign) return (
    <div style={{ padding: '2rem', color: '#c9a84c' }}>
      Select a campaign to view its mind map.
    </div>
  )

  if (loading) return <div style={{ padding: '2rem', color: '#6b6b6b' }}>Loading world graph...</div>
  if (error)   return <div style={{ padding: '2rem', color: '#8b0000' }}>Error: {error}</div>

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 56px)', background: '#0d0a05' }}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
      >
        <Background color="#2d1f0a" gap={24} />
        <Controls />
      </ReactFlow>
    </div>
  )
}
```

---

#### ▸ Step 4 — Build the NodeDetailPanel

📄 `src/components/mindmap/NodeDetailPanel.jsx`

Slide-in right panel (320px wide, dark parchment background) triggered by `onNodeClick`:

- Header: entity icon, type label, entity name in gold
- **For NPCs:** race, class/role, location, faction, alive status, motivation (truncated), "View Full NPC" button
- **For Locations:** type, parent location, description (truncated), "View Location" button
- **For Factions:** alignment, description (truncated), NPC count, "View Faction" button
- "View Full [Entity]" buttons navigate to the relevant World Builder page
- "Show Connections" button — highlights all edges connected to this node
- "Close" (X) button — clears selected node

```javascript
// Wire in MindMap.jsx:
const [selectedNode, setSelectedNode] = useState(null)

const handleNodeClick = useCallback((event, node) => {
  setSelectedNode(node)
}, [])

// In JSX:
// <ReactFlow onNodeClick={handleNodeClick} ...>
// {selectedNode && <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />}
```

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// DevTools console
await window.electronAPI.db.connections.getAll(1)
// Expected: array with entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship

await window.electronAPI.db.mindmap.getPositions(1)
// Expected: [] (no positions saved yet)
```

- Navigate to /mindmap — real campaign NPCs, locations, and factions render as nodes
- If connections exist from Phase 2, edges render with relationship labels mid-edge
- Clicking a node opens NodeDetailPanel with correct entity data
- "View Full NPC" navigates to /world/npcs
- Edges show gold bezier curves with lowercase relationship labels
- No errors when campaign has entities but zero connections

> **⚠ WARNING:** Do NOT move to Prompt 03 until real data loads correctly and NodeDetailPanel shows the right entity information for all three entity types.

---

## Agent Prompt 03 — Dagre Auto-Layout & Filters
### *Auto-layout with Dagre, filter by entity type and faction, highlight subgraphs*

---

### Context

Prompt 02 is complete. Real campaign data loads into the graph, edges render with relationship labels, and the NodeDetailPanel shows entity details. This prompt adds Dagre auto-layout, filter controls, and subgraph highlighting.

---

### Your Task

#### ▸ Step 1 — Implement Dagre auto-layout

📄 `src/utils/mindMapUtils.js` — append:

```javascript
import dagre from '@dagrejs/dagre'

const NODE_WIDTH  = 180
const NODE_HEIGHT = 80

export const applyDagreLayout = (nodes, edges, direction = 'TB') => {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, ranksep: 120, nodesep: 80, edgesep: 40 })

  nodes.forEach(node => g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach(edge => g.setEdge(edge.source, edge.target))

  dagre.layout(g)

  return nodes.map(node => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH  / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    }
  })
}
```

---

#### ▸ Step 2 — Build the MindMap toolbar

📄 `src/components/mindmap/MindMapToolbar.jsx`

**Layout controls:**
- "Auto Layout" button — runs `applyDagreLayout(nodes, edges, direction)` and updates node positions
- Direction toggle: TB (top-to-bottom, default) / LR (left-to-right)
- "Reset Layout" button — clears saved positions and re-applies Dagre from scratch

**Entity type filters:**
- Four pill toggle buttons: NPCs | Locations | Factions | Items
- Toggling off a type sets those nodes to `hidden: true`
- Hidden nodes also hide their connected edges
- Default: all types visible

**Faction filter:**
- Dropdown: "All Factions" + one option per faction in the campaign
- Selecting a faction highlights NPC nodes in that faction; others dim to opacity 0.3
- "Clear" button resets the filter

**Search:**
- Text input: "Search entities..."
- Typing filters nodes client-side — non-matching nodes set to `hidden: true`
- Matching node labels highlighted (yellow background)
- Clear (×) button resets search

**View controls:**
- "Fit View" button — calls React Flow's `fitView()`
- "Add Connection" button — opens Phase 2's Create Connection modal; adds edge to graph on save

---

#### ▸ Step 3 — Implement node filtering in MindMap.jsx

```javascript
const [visibleTypes,  setVisibleTypes]  = useState(['npc','location','faction','item'])
const [factionFilter, setFactionFilter] = useState(null)
const [searchQuery,   setSearchQuery]   = useState('')

// Derived display nodes from base nodes + active filters
const displayNodes = useMemo(() => {
  return nodes.map(node => {
    const typeVisible  = visibleTypes.includes(node.type)
    const searchMatch  = !searchQuery || node.data.label.toLowerCase().includes(searchQuery.toLowerCase())
    const factionMatch = !factionFilter || (node.type === 'npc' && node.data.raw?.faction_id === factionFilter)
    const isFocused    = factionFilter !== null

    return {
      ...node,
      hidden: !typeVisible || !searchMatch,
      style: {
        ...node.style,
        opacity: isFocused && !factionMatch && node.type === 'npc' ? 0.25 : 1,
      },
    }
  })
}, [nodes, visibleTypes, factionFilter, searchQuery])

// Hide edges whose source or target is hidden
const displayEdges = useMemo(() => {
  const visibleIds = new Set(displayNodes.filter(n => !n.hidden).map(n => n.id))
  return edges.map(edge => ({
    ...edge,
    hidden: !visibleIds.has(edge.source) || !visibleIds.has(edge.target),
  }))
}, [edges, displayNodes])
```

> **ℹ NOTE:** Pass `displayNodes` and `displayEdges` (not `nodes`/`edges`) to the ReactFlow component. The base arrays remain unmodified — filters produce derived display arrays.

---

#### ▸ Step 4 — Implement subgraph highlighting

```javascript
const highlightSubgraph = useCallback((nodeId) => {
  if (!nodeId) {
    // Clear all highlights
    setNodes(nds => nds.map(n => ({ ...n, style: { ...n.style, opacity: 1 } })))
    setEdges(eds => eds.map(e => ({ ...e, style: { ...e.style, strokeOpacity: 0.7 }, animated: false })))
    return
  }

  const connectedEdges = edges.filter(e => e.source === nodeId || e.target === nodeId)
  const connectedIds   = new Set([nodeId, ...connectedEdges.flatMap(e => [e.source, e.target])])

  setNodes(nds => nds.map(n => ({
    ...n,
    style: { ...n.style, opacity: connectedIds.has(n.id) ? 1 : 0.2 }
  })))

  setEdges(eds => eds.map(e => ({
    ...e,
    animated: connectedEdges.some(ce => ce.id === e.id),
    style: {
      ...e.style,
      strokeOpacity: connectedEdges.some(ce => ce.id === e.id) ? 1 : 0.1,
      stroke:        connectedEdges.some(ce => ce.id === e.id) ? '#ffffff' : '#C9A84C',
    }
  })))
}, [edges])

// Call highlightSubgraph(node.id) in handleNodeClick
// Call highlightSubgraph(null) in onPaneClick (clicking the background)
```

---

### Verification Steps

> **✓ VERIFY:**

- "Auto Layout" button reorganizes nodes into a readable hierarchy
- Switching direction to LR re-runs Dagre with left-to-right flow
- Toggle off "NPCs" — all NPC nodes and their edges disappear
- Toggle NPCs back on — they reappear with edges
- Select a faction — NPC nodes in other factions dim to 0.25 opacity
- Search "Mira" — only nodes with "Mira" in the name stay visible
- Click a node — connected nodes bright, unconnected nodes dim, connected edges animate
- Click canvas background — all highlights clear
- "Fit View" centers and scales to show all visible nodes

> **⚠ WARNING:** Do NOT move to Prompt 04 until Dagre layout produces a readable graph and all three filter types work correctly.

---

## Agent Prompt 04 — Position Persistence & Mini-Map
### *Save node positions to SQLite, mini-map overlay, keyboard shortcuts, and graph statistics*

---

### Context

Prompt 03 is complete. Auto-layout, filters, and subgraph highlighting all work. This prompt adds position persistence, the React Flow mini-map, keyboard shortcuts, and a graph statistics panel.

---

### Your Task

#### ▸ Step 1 — Implement position persistence

📄 `src/pages/MindMap.jsx`

```javascript
const onNodeDragStop = useCallback(async (event, node) => {
  await window.electronAPI.db.mindmap.savePosition({
    campaign_id: activeCampaign.id,
    entity_type: node.type,
    entity_id:   node.data.entityId,
    x_pos:       node.position.x,
    y_pos:       node.position.y,
  })
}, [activeCampaign])

// Wire: <ReactFlow onNodeDragStop={onNodeDragStop} ...>
```

---

#### ▸ Step 2 — Save all positions after Auto Layout

```javascript
const handleAutoLayout = useCallback(async () => {
  const laidOut = applyDagreLayout(nodes, edges, layoutDirection)
  setNodes(laidOut)

  // Batch save all new positions
  const positions = laidOut.map(n => ({
    entity_type: n.type,
    entity_id:   n.data.entityId,
    x_pos:       n.position.x,
    y_pos:       n.position.y,
  }))
  await window.electronAPI.db.mindmap.savePositions(activeCampaign.id, positions)
}, [nodes, edges, layoutDirection, activeCampaign])

const handleResetLayout = useCallback(async () => {
  await window.electronAPI.db.mindmap.clearPositions(activeCampaign.id)
  reload()  // re-runs hook — no saved positions → fresh Dagre
}, [activeCampaign, reload])
```

---

#### ▸ Step 3 — Add the React Flow MiniMap

```jsx
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react'
import { NODE_CONFIG } from '../utils/mindMapUtils'

// Inside <ReactFlow>:
<MiniMap
  nodeColor={(node) => NODE_CONFIG[node.type]?.color ?? '#6b6b6b'}
  nodeStrokeColor="#C9A84C"
  nodeStrokeWidth={2}
  maskColor="rgba(13, 10, 5, 0.85)"
  style={{
    background:   '#1a1208',
    border:       '1px solid #C9A84C',
    borderRadius: '4px',
  }}
/>
```

---

#### ▸ Step 4 — Add keyboard shortcuts

```javascript
useEffect(() => {
  const handleKey = (e) => {
    if (e.key === 'Escape') {
      setSelectedNode(null)
      highlightSubgraph(null)
    }
    if (e.key === 'l' && !e.ctrlKey && !e.metaKey) handleAutoLayout()
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey) fitView({ duration: 400 })
  }
  window.addEventListener('keydown', handleKey)
  return () => window.removeEventListener('keydown', handleKey)
}, [handleAutoLayout, highlightSubgraph, fitView])
```

> **ℹ NOTE:** `useReactFlow()` must be called inside a component that is a child of `<ReactFlowProvider>`. Wrap MindMap in a `ReactFlowProvider` in `App.jsx`, or move the `fitView` logic inside a sub-component.

---

#### ▸ Step 5 — Build the GraphStatsPanel

📄 `src/components/mindmap/GraphStatsPanel.jsx`

Compact info panel positioned top-left of the canvas. Collapsed by default, expand on click:

- Node count by type: "NPCs: 8  |  Locations: 5  |  Factions: 3"
- Edge count: "Connections: 14"
- Isolated nodes (amber if > 0): "3 entities have no connections"
- Most connected: "Most connected: Mira Ashveil (6 connections)"

```javascript
// Add to mindMapUtils.js
export const graphStats = (nodes, edges) => {
  const countByType = nodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})

  const connectionCount = {}
  edges.forEach(e => {
    connectionCount[e.source] = (connectionCount[e.source] ?? 0) + 1
    connectionCount[e.target] = (connectionCount[e.target] ?? 0) + 1
  })

  const connectedNodeIds = new Set(Object.keys(connectionCount))
  const isolated         = nodes.filter(n => !connectedNodeIds.has(n.id))

  const [mostConnectedId, maxConns] = Object.entries(connectionCount)
    .sort(([,a],[,b]) => b - a)[0] ?? [null, 0]
  const mostConnectedNode = nodes.find(n => n.id === mostConnectedId)

  return { countByType, edgeCount: edges.length, isolated, mostConnectedNode, maxConns }
}
```

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// Drag a node, navigate away, return — node should be at dragged position
await window.electronAPI.db.mindmap.getPositions(1)
// Expected: array including the moved node's new x_pos, y_pos

// After "Auto Layout": all positions updated
const positions = await window.electronAPI.db.mindmap.getPositions(1)
console.log(positions.length)  // should equal total node count

// After "Reset Layout":
const after = await window.electronAPI.db.mindmap.getPositions(1)
console.log(after.length)  // Expected: 0
```

- Drag NPC "Mira" to a corner, navigate away, return → Mira is at dragged position
- "Auto Layout" reorganizes all nodes and saves new positions
- "Reset Layout" clears positions, reloads with fresh Dagre
- MiniMap renders in bottom-right, node colors match type colors
- Clicking MiniMap region pans the main canvas
- Pressing Escape clears selection and highlights
- Pressing L triggers auto-layout, F fits view
- GraphStatsPanel shows correct counts and most-connected entity

> **⚠ WARNING:** Do NOT move to Prompt 05 until node positions persist across page reloads and the MiniMap displays correctly.

---

## Agent Prompt 05 — Mind Map Polish, AI Insights & Phase 6 Audit
### *AI relationship analysis, in-graph edge creation, PNG export, edge context menu, and phase completion*

---

### Context

Prompts 01–04 are complete. The Mind Map renders all world entities as styled nodes, connections as labeled edges, auto-layout works with Dagre, filters narrow the graph, node positions persist to SQLite, the MiniMap overlays the canvas, and subgraph highlighting works. This final Phase 6 prompt adds AI-powered relationship insights, in-graph edge creation, graph export to PNG, and runs the full Phase 6 audit.

---

### Your Task

#### ▸ Step 1 — Build the AI Relationship Insights panel

📄 `src/components/mindmap/AIInsightsPanel.jsx`

Collapsible panel below the MindMap toolbar. Four analysis buttons:

- **"Analyze Relationships"** — identifies narrative patterns in the visible graph
- **"Find Isolated Entities"** — lists entities with no connections, suggests who they might connect to
- **"Faction Conflicts"** — identifies NPCs in conflicting factions that are directly connected
- **"Story Threads"** — suggests 2-3 plot hooks based on the relationship web

```javascript
// Build a text summary of the visible graph
const buildGraphSummary = (nodes, edges) => {
  const npcNodes = nodes.filter(n => n.type === 'npc'      && !n.hidden)
  const locNodes = nodes.filter(n => n.type === 'location' && !n.hidden)
  const facNodes = nodes.filter(n => n.type === 'faction'  && !n.hidden)
  const visEdges = edges.filter(e => !e.hidden)

  const edgeSummary = visEdges.map(e => {
    const src = nodes.find(n => n.id === e.source)
    const tgt = nodes.find(n => n.id === e.target)
    return `${src?.data.label} ${e.label} ${tgt?.data.label}`
  }).join('; ')

  return [
    `Campaign: ${activeCampaign.name} (${activeCampaign.world_setting})`,
    `Entities visible: ${npcNodes.length} NPCs, ${locNodes.length} locations, ${facNodes.length} factions`,
    `Relationships: ${edgeSummary || 'none'}`,
  ].join('\n')
}

const systemPrompt = `You are an expert D&D Dungeon Master narrative analyst.
Analyze the relationship web described and provide 3 specific, insightful observations.
Focus on drama, conflict, and story potential. Be concise — one sentence per point.
Format as a numbered list.`

const userMessage = `${buildGraphSummary(displayNodes, displayEdges)}

Analyze these relationships and identify the most interesting narrative dynamics.`
```

- Spinner while AI processes
- Numbered insights as a styled list with gold bullets
- "Regenerate" button for fresh analysis
- If `ai.getMode()` is "no-ai": show "Configure your API key in Settings to enable AI insights"

---

#### ▸ Step 2 — Build in-graph edge creation

📄 `src/pages/MindMap.jsx`

```javascript
import { addEdge } from '@xyflow/react'

const [pendingConnection, setPendingConnection] = useState(null)
const [showEdgeModal, setShowEdgeModal]         = useState(false)

// React Flow fires onConnect when DM drags from one node handle to another
const onConnect = useCallback((connection) => {
  setPendingConnection(connection)
  setShowEdgeModal(true)
}, [])

// <ReactFlow onConnect={onConnect} ...>
```

📄 `src/components/mindmap/EdgeCreationModal.jsx`

Small modal after connecting two nodes:

- Shows: "[Source Entity Name] → [Target Entity Name]"
- Relationship text input with datalist (ally, enemy, member of, rival, family, lover, employer, employee, owns, worships, fears, knows secret of, neutral)
- Notes textarea (2 rows, optional)
- On submit: call `db.connections.create()` — parse entity type/id from node ID format (`"npc-5"` → `entity_type="npc"`, `entity_id=5`)
- After saving: `addEdge()` to React Flow edges state, close modal
- Cancel: close modal without saving

---

#### ▸ Step 3 — Add graph export to PNG

```bash
npm install html-to-image
```

📄 `src/pages/MindMap.jsx`

```javascript
import { getNodesBounds, getViewportForBounds } from '@xyflow/react'
import { toPng } from 'html-to-image'

const handleExport = useCallback(async () => {
  const nodesBounds = getNodesBounds(nodes)
  const imageWidth  = 1920
  const imageHeight = 1080
  const viewport    = getViewportForBounds(nodesBounds, imageWidth, imageHeight, 0.5, 2, 0.1)

  const dataUrl = await toPng(document.querySelector('.react-flow__viewport'), {
    backgroundColor: '#0d0a05',
    width:           imageWidth,
    height:          imageHeight,
    style: {
      width:     imageWidth,
      height:    imageHeight,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  })

  await window.electronAPI.file.saveExportedImage(activeCampaign.name, dataUrl)
}, [nodes, activeCampaign])
```

📄 `electron/ipc/fileHandlers.js` — add export handler:

```javascript
ipcMain.handle('file:saveExportedImage', async (_, campaignName, dataUrl) => {
  const { dialog } = require('electron')
  const result = await dialog.showSaveDialog({
    title:       'Export Mind Map',
    defaultPath: `${campaignName}_mind_map.png`,
    filters:     [{ name: 'PNG Image', extensions: ['png'] }]
  })
  if (result.canceled) return null
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'))
  return result.filePath
})
```

Expose in preload.js: `file.saveExportedImage(campaignName, dataUrl)`

---

#### ▸ Step 4 — Add edge right-click context menu

📄 `src/components/mindmap/EdgeContextMenu.jsx`

Small context menu on right-click of an edge:

- "Edit Relationship" — opens Create Connection modal pre-filled with this connection's data
- "Delete Connection" — confirmation, then `db.connections.delete(connectionId)`, remove edge from React Flow state
- Clicking anywhere else dismisses

```javascript
// Wire in MindMap.jsx:
const [contextMenu, setContextMenu] = useState(null)

const onEdgeContextMenu = useCallback((event, edge) => {
  event.preventDefault()
  setContextMenu({ x: event.clientX, y: event.clientY, edge })
}, [])

// <ReactFlow onEdgeContextMenu={onEdgeContextMenu} ...>
```

---

#### ▸ Step 5 — Phase 6 audit checklist

**Node rendering:**
- [ ] All four node types: correct icon, color, label, subtitle
- [ ] Dead NPCs: 💀 indicator, darkened background
- [ ] Selected nodes: white border glow

**Edge rendering:**
- [ ] Gold bezier curves with gold label pills mid-edge
- [ ] Relationship labels in lowercase
- [ ] Selected edges highlight in white

**Data loading:**
- [ ] Real campaign NPCs, locations, factions all load as nodes
- [ ] Phase 2 connections load as labeled edges between correct nodes
- [ ] Edges with no matching endpoint silently filtered out
- [ ] Empty campaign shows "No entities yet" message, not an error

**Layout and filters:**
- [ ] "Auto Layout" (TB and LR): readable hierarchy in both directions
- [ ] Entity type toggles: hiding/showing each type works correctly
- [ ] Faction filter: NPC nodes in other factions dim correctly
- [ ] Search: non-matching nodes hide, matching stay visible
- [ ] Subgraph highlight: clicking dims unconnected nodes, animates connected edges
- [ ] Clicking canvas background clears all highlights

**Persistence:**
- [ ] Dragging a node saves position — restored on reload
- [ ] "Auto Layout" saves all new positions to DB
- [ ] "Reset Layout" clears all positions — next load uses fresh Dagre

**Advanced features:**
- [ ] MiniMap in bottom-right, correct type colors, clicking pans canvas
- [ ] GraphStatsPanel shows correct counts and most-connected node
- [ ] AI Insights: generates relevant observations for visible graph
- [ ] In-graph edge creation: drag handle → modal → saves to DB → edge renders
- [ ] Right-click edge → context menu → "Delete Connection" removes from DB and canvas
- [ ] "Export as PNG" opens OS save dialog, saves readable 1920×1080 PNG
- [ ] Keyboard shortcuts: Escape=clear, L=layout, F=fit
- [ ] No console errors on any mind map operation

---

### Verification Steps

> **✓ VERIFY:** Full Phase 6 end-to-end flow:

- Navigate to /mindmap with a populated campaign from Phase 2
- All entities render as styled nodes, connections as labeled edges
- "Auto Layout" (TB) → readable hierarchy → positions saved to DB
- Drag "Mira Ashveil" to a corner → navigate away → return → Mira is in the corner
- Toggle "NPCs" off → all NPC nodes and edges disappear
- Search "Iron Wolves" → only that faction node stays visible
- Click a node → subgraph highlights, NodeDetailPanel shows entity details
- "View Full NPC" from panel → navigates to World Builder NPC page
- Drag from NPC handle to Faction handle → EdgeCreationModal → set "ally" → edge appears and saves to DB
- Right-click that edge → "Delete Connection" → edge disappears → removed from DB
- AI Insights: "Analyze Relationships" → 3 numbered narrative observations
- "Export as PNG" → OS save dialog → PNG file saves successfully

> **✓ VERIFY:** Phase 6 complete when: load graph → layout → filter → highlight → persist → edit → AI insights → export all work end to end.

```bash
git add .
git commit -m "[Phase 6] Complete: Mind Map — React Flow graph, node types, Dagre layout, filters, position persistence, AI insights, export"
git push
```

---

*⚔ End of Phase 6 Agent Prompts ⚔*
