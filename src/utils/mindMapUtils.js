import dagre from '@dagrejs/dagre'

// Every type that can appear on either end of a connection. `item` was defined
// here from the start and never built; Phase 4 replaces it with the types the
// Connections page can now actually link.
export const NODE_TYPES = {
  npc:       'npc',
  location:  'location',
  faction:   'faction',
  lore:      'lore',
  map:       'map',
  encounter: 'encounter',
  character: 'character',
  plot:      'plot',
}

export const NODE_CONFIG = {
  npc:       { color: '#4A90D9', background: '#0D1F36', icon: '👤', label: 'NPC'       },
  location:  { color: '#C9A84C', background: '#2A1F06', icon: '🏰', label: 'Location'  },
  faction:   { color: '#9B59B6', background: '#1E0A2E', icon: '🛡️', label: 'Faction'   },
  lore:      { color: '#D4A017', background: '#241A06', icon: '📖', label: 'Lore'      },
  map:       { color: '#7FA84C', background: '#18220E', icon: '🗺️', label: 'Map'       },
  encounter: { color: '#D0021B', background: '#2A0C0C', icon: '⚔️', label: 'Encounter' },
  character: { color: '#3FA9B5', background: '#08222A', icon: '🎭', label: 'Character' },
  plot:      { color: '#CFB45A', background: '#2A2410', icon: '🧵', label: 'Plot'      },
}

/** The types offered in the Connections picker and the Mind Map filter. */
export const CONNECTABLE_TYPES = Object.keys(NODE_TYPES)

// Build a React Flow node from a DB entity
export const buildNode = (entityType, entity, position = { x: 0, y: 0 }) => ({
  id:       `${entityType}-${entity.id}`,
  type:     entityType,
  position,
  data: {
    // Each table names its display column differently: characters use
    // character_name, plot threads use title, everything else uses name.
    label:      entity.name ?? entity.character_name ?? entity.title ?? 'Untitled',
    entityType,
    entityId:   entity.id,
    subtitle:   entity.role ?? entity.type ?? entity.alignment ?? entity.status ?? entity.class ?? '',
    isAlive:    entity.is_alive,
    raw:        entity,
  },
})

// ── Dagre auto-layout ─────────────────────────────────────────────────────
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

// Graph statistics
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

  const connectedNodeIds    = new Set(Object.keys(connectionCount))
  const isolated            = nodes.filter(n => !connectedNodeIds.has(n.id))
  const [mostConnectedId, maxConns] = Object.entries(connectionCount)
    .sort(([, a], [, b]) => b - a)[0] ?? [null, 0]
  const mostConnectedNode   = nodes.find(n => n.id === mostConnectedId)

  return { countByType, edgeCount: edges.length, isolated, mostConnectedNode, maxConns }
}

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
