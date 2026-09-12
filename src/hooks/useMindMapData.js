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
      // Phase 4 widened connections from three types to eight, so the graph has
      // to be able to draw all eight — an edge whose endpoint is missing is
      // silently dropped below, which would have hidden every new connection.
      // Each loader is individually caught: one failing table should cost its
      // own nodes, not the whole graph.
      const load = (fn) => fn(campaignId).catch(() => [])

      const [
        npcs, locations, factions, lore, maps, encounters, characters, plots,
        connections, savedPositions,
      ] = await Promise.all([
        load(window.electronAPI.db.npcs.getAll),
        load(window.electronAPI.db.locations.getAll),
        load(window.electronAPI.db.factions.getAll),
        load(window.electronAPI.db.lore.getAll),
        load(window.electronAPI.db.maps.getAll),
        load(window.electronAPI.db.encounters.getAll),
        load(window.electronAPI.db.characters.getAll),
        load(window.electronAPI.db.plots.getAll),
        window.electronAPI.db.connections.getAll(campaignId),
        window.electronAPI.db.mindmap.getPositions(campaignId),
      ])

      // Build position lookup: "npc-5" → { x, y }
      const posMap = {}
      savedPositions.forEach(p => {
        posMap[`${p.entity_type}-${p.entity_id}`] = { x: p.x_pos, y: p.y_pos }
      })

      // Build nodes — saved position, or a default row per type.
      const ROWS = [
        ['npc', npcs], ['location', locations], ['faction', factions], ['lore', lore],
        ['map', maps], ['encounter', encounters], ['character', characters], ['plot', plots],
      ]
      const allNodes = ROWS.flatMap(([type, rows], row) =>
        rows.map((e, i) => buildNode(type, e, posMap[`${type}-${e.id}`] ?? { x: i * 220, y: row * 220 }))
      )

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
