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
        ...npcs.map((e, i)      => buildNode('npc',      e, posMap[`npc-${e.id}`]      ?? { x: i * 220, y: 0   })),
        ...locations.map((e, i) => buildNode('location', e, posMap[`location-${e.id}`] ?? { x: i * 220, y: 220 })),
        ...factions.map((e, i)  => buildNode('faction',  e, posMap[`faction-${e.id}`]  ?? { x: i * 220, y: 440 })),
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
