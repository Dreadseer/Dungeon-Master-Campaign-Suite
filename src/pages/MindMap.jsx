import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  getNodesBounds, getViewportForBounds,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toPng }                                      from 'html-to-image'
import useCampaignStore                               from '../stores/campaignStore'
import { useMindMapData }                             from '../hooks/useMindMapData'
import { applyDagreLayout, NODE_CONFIG }              from '../utils/mindMapUtils'
import NPCNode                                        from '../components/mindmap/nodes/NPCNode'
import LocationNode                                   from '../components/mindmap/nodes/LocationNode'
import FactionNode                                    from '../components/mindmap/nodes/FactionNode'
import ItemNode                                       from '../components/mindmap/nodes/ItemNode'
import MindMapEdge                                    from '../components/mindmap/edges/MindMapEdge'
import NodeDetailPanel                                from '../components/mindmap/NodeDetailPanel'
import MindMapToolbar                                 from '../components/mindmap/MindMapToolbar'
import GraphStatsPanel                                from '../components/mindmap/GraphStatsPanel'
import AIInsightsPanel                                from '../components/mindmap/AIInsightsPanel'
import EdgeCreationModal                              from '../components/mindmap/EdgeCreationModal'
import EdgeContextMenu                                from '../components/mindmap/EdgeContextMenu'

const nodeTypes = {
  npc:      NPCNode,
  location: LocationNode,
  faction:  FactionNode,
  item:     ItemNode,
}
const edgeTypes = { mindMapEdge: MindMapEdge }

const ALL_TYPES = new Set(['npc', 'location', 'faction', 'item'])

// ── Outer shell: provides ReactFlowProvider, guards, data ─────────────────
export default function MindMap() {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const {
    nodes: initNodes,
    edges: initEdges,
    loading, error, reload,
  } = useMindMapData(activeCampaign?.id)

  if (!activeCampaign) {
    return (
      <div style={s.centerMsg}>
        <p style={s.centerText}>Select a campaign to view its mind map.</p>
      </div>
    )
  }
  if (loading) {
    return (
      <div style={s.centerMsg}>
        <p style={s.centerText}>Loading world graph…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div style={s.centerMsg}>
        <p style={{ ...s.centerText, color: '#8b0000' }}>Error: {error}</p>
      </div>
    )
  }
  if (initNodes.length === 0) {
    return (
      <div style={s.centerMsg}>
        <p style={s.centerText}>No entities yet.</p>
        <p style={s.centerSub}>
          Add NPCs, locations, and factions in the World Builder to populate this map.
        </p>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <MindMapInner
        initNodes={initNodes}
        initEdges={initEdges}
        reload={reload}
        activeCampaign={activeCampaign}
      />
    </ReactFlowProvider>
  )
}

// ── Inner component: useReactFlow() is safe here ──────────────────────────
function MindMapInner({ initNodes, initEdges, reload, activeCampaign }) {
  const { fitView } = useReactFlow()

  // ── Base RF state ──────────────────────────────────────────────────────
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)

  useEffect(() => {
    setNodes(initNodes)
    setEdges(initEdges)
  }, [initNodes, initEdges, setNodes, setEdges])

  // ── Filter / toolbar state ─────────────────────────────────────────────
  const [visibleTypes,    setVisibleTypes]    = useState(ALL_TYPES)
  const [factionFilter,   setFactionFilter]   = useState(null)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [layoutDirection, setLayoutDirection] = useState('TB')

  // ── Highlight state (separate Sets — avoids memo override) ────────────
  const [highlightNodeIds, setHighlightNodeIds] = useState(new Set())
  const [highlightEdgeIds, setHighlightEdgeIds] = useState(new Set())

  // ── Selected node ──────────────────────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState(null)

  // ── Edge creation / editing ────────────────────────────────────────────
  const [pendingConnection, setPendingConnection] = useState(null)
  const [editingEdge,       setEditingEdge]       = useState(null)
  const [showEdgeModal,     setShowEdgeModal]     = useState(false)

  // ── Edge context menu ─────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState(null) // { x, y, edge }

  // ── Clear highlight ────────────────────────────────────────────────────
  const clearHighlight = useCallback(() => {
    setHighlightNodeIds(new Set())
    setHighlightEdgeIds(new Set())
  }, [])

  // ── Node click / pane click ────────────────────────────────────────────
  const handleNodeClick  = useCallback((_e, node) => setSelectedNode(node), [])
  const handlePaneClick  = useCallback(() => {
    setSelectedNode(null)
    clearHighlight()
    setContextMenu(null)
  }, [clearHighlight])

  // ── Subgraph highlight ─────────────────────────────────────────────────
  const highlightSubgraph = useCallback((nodeId) => {
    const connectedEdgeIds = new Set()
    const connectedNodeIds = new Set([nodeId])

    edges.forEach(e => {
      if (e.source === nodeId || e.target === nodeId) {
        connectedEdgeIds.add(e.id)
        connectedNodeIds.add(e.source)
        connectedNodeIds.add(e.target)
      }
    })

    setHighlightNodeIds(connectedNodeIds)
    setHighlightEdgeIds(connectedEdgeIds)
  }, [edges])

  // ── In-graph edge creation ─────────────────────────────────────────────
  const onConnect = useCallback((connection) => {
    setPendingConnection(connection)
    setEditingEdge(null)
    setShowEdgeModal(true)
  }, [])

  const closeEdgeModal = useCallback(() => {
    setShowEdgeModal(false)
    setPendingConnection(null)
    setEditingEdge(null)
  }, [])

  const handleEdgeSave = useCallback((savedEdge) => {
    if (editingEdge) {
      setEdges(eds => eds.map(e => e.id === savedEdge.id ? savedEdge : e))
    } else {
      setEdges(eds => [...eds, savedEdge])
    }
    closeEdgeModal()
  }, [editingEdge, setEdges, closeEdgeModal])

  // ── Edge context menu ─────────────────────────────────────────────────
  const onEdgeContextMenu = useCallback((e, edge) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, edge })
  }, [])

  const handleEdgeEdit = useCallback((edge) => {
    setEditingEdge(edge)
    setPendingConnection(null)
    setShowEdgeModal(true)
  }, [])

  const handleEdgeDelete = useCallback(async (edge) => {
    if (!edge.data?.connectionId) return
    await window.electronAPI.db.connections.delete(edge.data.connectionId)
    setEdges(eds => eds.filter(e => e.id !== edge.id))
  }, [setEdges])

  // ── Faction list for dropdown ──────────────────────────────────────────
  const factions = useMemo(
    () => nodes
      .filter(n => n.type === 'faction')
      .map(n => ({ id: n.data.entityId, name: n.data.label }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  )

  // ── Derived display arrays (filter + highlight) ────────────────────────
  const displayNodes = useMemo(() => {
    const q            = searchQuery.toLowerCase().trim()
    const hasHighlight = highlightNodeIds.size > 0

    return nodes
      .filter(n => {
        if (!visibleTypes.has(n.type)) return false
        if (factionFilter !== null && n.type === 'npc' && n.data.raw?.faction_id !== factionFilter) return false
        if (factionFilter !== null && n.type === 'faction' && n.data.entityId !== factionFilter) return false
        if (q && !n.data.label?.toLowerCase().includes(q)) return false
        return true
      })
      .map(n => {
        if (!hasHighlight) return n
        const dimmed = !highlightNodeIds.has(n.id)
        return {
          ...n,
          style: {
            ...n.style,
            opacity:    dimmed ? 0.25 : 1,
            transition: 'opacity 0.2s',
          },
        }
      })
  }, [nodes, visibleTypes, factionFilter, searchQuery, highlightNodeIds])

  const displayEdges = useMemo(() => {
    const visibleIds   = new Set(displayNodes.map(n => n.id))
    const hasHighlight = highlightEdgeIds.size > 0

    return edges
      .filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map(e => {
        if (!hasHighlight) return e
        const dimmed = !highlightEdgeIds.has(e.id)
        return {
          ...e,
          style: {
            ...e.style,
            opacity:    dimmed ? 0.1 : 1,
            transition: 'opacity 0.2s',
          },
        }
      })
  }, [edges, displayNodes, highlightEdgeIds])

  // ── Position persistence ───────────────────────────────────────────────
  const onNodeDragStop = useCallback(async (_e, node) => {
    await window.electronAPI.db.mindmap.savePosition({
      campaign_id: activeCampaign.id,
      entity_type: node.type,
      entity_id:   node.data.entityId,
      x_pos:       node.position.x,
      y_pos:       node.position.y,
    })
  }, [activeCampaign])

  // ── Toolbar handlers ───────────────────────────────────────────────────
  const handleToggleType = useCallback((key) => {
    setVisibleTypes(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  const handleAutoLayout = useCallback(async () => {
    const laid = applyDagreLayout(nodes, edges, layoutDirection)
    setNodes(laid)

    const positions = laid.map(n => ({
      entity_type: n.type,
      entity_id:   n.data.entityId,
      x_pos:       n.position.x,
      y_pos:       n.position.y,
    }))
    await window.electronAPI.db.mindmap.savePositions(activeCampaign.id, positions)

    requestAnimationFrame(() => fitView({ padding: 0.15, duration: 400 }))
  }, [nodes, edges, layoutDirection, setNodes, fitView, activeCampaign])

  const handleToggleDirection = useCallback(() => {
    setLayoutDirection(d => d === 'TB' ? 'LR' : 'TB')
  }, [])

  const handleResetLayout = useCallback(async () => {
    await window.electronAPI.db.mindmap.clearPositions(activeCampaign.id)
    reload()
  }, [activeCampaign, reload])

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.15, duration: 300 })
  }, [fitView])

  // ── PNG export ─────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    try {
      const bounds   = getNodesBounds(nodes)
      const imgW     = 1920
      const imgH     = 1080
      const viewport = getViewportForBounds(bounds, imgW, imgH, 0.5, 2, 0.1)
      const el       = document.querySelector('.react-flow__viewport')
      if (!el) return

      const dataUrl = await toPng(el, {
        backgroundColor: '#0d0a05',
        width:           imgW,
        height:          imgH,
        style: {
          width:     `${imgW}px`,
          height:    `${imgH}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        },
      })

      await window.electronAPI.file.saveExportedImage(activeCampaign.name, dataUrl)
    } catch (err) {
      console.error('[MindMap] Export failed:', err)
    }
  }, [nodes, activeCampaign])

  // ── Keyboard shortcuts (stable refs — listener installed once) ────────
  const autoLayoutRef = useRef(handleAutoLayout)
  const fitViewRef    = useRef(handleFitView)
  const clearHlRef    = useRef(clearHighlight)

  useEffect(() => { autoLayoutRef.current = handleAutoLayout }, [handleAutoLayout])
  useEffect(() => { fitViewRef.current    = handleFitView    }, [handleFitView])
  useEffect(() => { clearHlRef.current    = clearHighlight   }, [clearHighlight])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') {
        setSelectedNode(null)
        clearHlRef.current()
        setContextMenu(null)
      }
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey) autoLayoutRef.current()
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey) fitViewRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={s.wrapper}>
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <MindMapToolbar
        visibleTypes={visibleTypes}
        onToggleType={handleToggleType}
        factions={factions}
        factionFilter={factionFilter}
        onFactionFilter={setFactionFilter}
        searchQuery={searchQuery}
        onSearchQuery={setSearchQuery}
        layoutDirection={layoutDirection}
        onAutoLayout={handleAutoLayout}
        onToggleDirection={handleToggleDirection}
        onResetLayout={handleResetLayout}
        onFitView={handleFitView}
        onExport={handleExport}
      />

      {/* ── Canvas ────────────────────────────────────────────────── */}
      <div style={s.canvas}>
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgeContextMenu={onEdgeContextMenu}
          fitView
          minZoom={0.1}
          maxZoom={2}
        >
          <Background color="#2d1f0a" gap={24} />
          <Controls />
          <MiniMap
            nodeColor={node => NODE_CONFIG[node.type]?.color ?? '#6b6b6b'}
            nodeStrokeColor="#C9A84C"
            nodeStrokeWidth={2}
            maskColor="rgba(13, 10, 5, 0.85)"
            style={{
              background:   '#1a1208',
              border:       '1px solid #C9A84C',
              borderRadius: 4,
            }}
          />
        </ReactFlow>

        {/* Graph stats — top-left overlay */}
        <div style={s.statsAnchor}>
          <GraphStatsPanel nodes={displayNodes} edges={displayEdges} />
        </div>

        {/* AI Insights — top-center overlay */}
        <div style={s.aiAnchor}>
          <AIInsightsPanel
            nodes={displayNodes}
            edges={displayEdges}
            campaignName={activeCampaign.name}
          />
        </div>

        {/* Node detail panel — right overlay */}
        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            allNodes={nodes}
            onClose={() => {
              setSelectedNode(null)
              clearHighlight()
            }}
            onHighlight={highlightSubgraph}
          />
        )}

        {/* Edge context menu */}
        {contextMenu && (
          <EdgeContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            edge={contextMenu.edge}
            nodes={nodes}
            onEdit={() => handleEdgeEdit(contextMenu.edge)}
            onDelete={() => handleEdgeDelete(contextMenu.edge)}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>

      {/* Edge creation / edit modal — outside canvas so it's not clipped */}
      {showEdgeModal && (
        <EdgeCreationModal
          nodes={nodes}
          connection={pendingConnection}
          editingEdge={editingEdge}
          activeCampaign={activeCampaign}
          onSave={handleEdgeSave}
          onCancel={closeEdgeModal}
        />
      )}
    </div>
  )
}

const s = {
  wrapper: {
    width:         '100%',
    height:        'calc(100vh - 56px)',
    background:    '#0d0a05',
    display:       'flex',
    flexDirection: 'column',
    position:      'relative',
  },
  canvas: {
    flex:      1,
    position:  'relative',
    marginTop: 48,   // toolbar height
  },
  statsAnchor: {
    position:      'absolute',
    top:           8,
    left:          8,
    zIndex:        10,
    pointerEvents: 'none',
  },
  aiAnchor: {
    position:      'absolute',
    top:           8,
    left:          '50%',
    transform:     'translateX(-50%)',
    zIndex:        11,
    pointerEvents: 'none',
  },
  centerMsg: {
    width:          '100%',
    height:         'calc(100vh - 56px)',
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    background:     '#0d0a05',
  },
  centerText: { color: '#c9a84c', fontSize: 16, margin: 0 },
  centerSub:  { color: '#555',    fontSize: 13, margin: 0, textAlign: 'center', maxWidth: 360 },
}
