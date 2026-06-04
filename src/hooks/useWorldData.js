import { useState, useEffect, useCallback } from 'react'

export function useWorldData(campaignId) {
  const [data, setData] = useState({
    locations: [], factions: [], npcs: [], lore: [], connections: [],
    loading: true, error: null,
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
