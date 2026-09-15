import { useState, useEffect, useCallback } from 'react'
import {
  figuresAtLocation, matchStatBlock, npcEncounterEntry, entryXp,
} from '../../utils/locationAssembly'
import { rollTable, describeTable, parseEntries } from '../../utils/tableUtils'
import { notifyError } from '../../stores/toastStore'

// "Notable figures here" (Phase 7 task 1).
//
// The data has existed since Phase 1 — npcs.location_id — and nothing in the
// Encounter Builder had ever read it. An encounter tied to the Snapping Line
// knew the location's name and nothing about who was standing in it.
//
// No AI anywhere in this component: it is a join the app could always have done.

export default function LocationFigures({ locationId, campaignId, monsters = [], onAdd }) {
  const [figures, setFigures] = useState([])
  const [tables, setTables]   = useState([])
  const [statBlocks, setStatBlocks] = useState({ homebrew: [], srd: [] })
  const [loading, setLoading] = useState(false)
  const [rolled, setRolled]   = useState(null)

  const load = useCallback(async () => {
    if (!locationId) { setFigures([]); setTables([]); return }
    setLoading(true)
    try {
      const api = window.electronAPI.db
      // allSettled: an empty SRD cache or a missing table must not blank the
      // whole panel — the NPC list is the part that matters.
      const [npcsHere, connections, allNpcs, locTables, homebrew, srd] = await Promise.allSettled([
        api.npcs.getByLocation(locationId),
        api.connections.getForEntity('location', locationId),
        api.npcs.getAll(campaignId),
        api.encounterTables.getByLocation(locationId),
        api.compendium.getAll(campaignId, 'monster'),
        window.electronAPI.srd.getMonsters({}),
      ])
      const val = (r, fallback = []) => (r.status === 'fulfilled' && r.value != null ? r.value : fallback)

      setStatBlocks({
        homebrew: val(homebrew).map(row => {
          // compendium_custom stores the block in a JSON `data` column.
          let data = {}
          try { data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {}) } catch { /* unusable */ }
          return { ...data, name: row.name, id: row.id, index: row.id }
        }),
        srd: val(srd),
      })

      setTables(val(locTables))
      setFigures(figuresAtLocation({
        locationId,
        npcsHere: val(npcsHere),
        connections: val(connections),
        allNpcs: val(allNpcs),
        existingEntries: monsters,
      }))
    } catch (err) {
      notifyError(err, 'Load figures at this location')
    } finally {
      setLoading(false)
    }
  }, [locationId, campaignId, monsters])

  useEffect(() => { load() }, [load])

  function handleAdd(npc) {
    const match = matchStatBlock(npc, statBlocks)
    onAdd?.(npcEncounterEntry(npc, match))
  }

  function handleRoll(table) {
    setRolled({ tableId: table.id, ...rollTable(table) })
  }

  if (!locationId) return null
  if (loading) return <p style={s.note}>Looking up who is here…</p>
  if (figures.length === 0 && tables.length === 0) {
    return <p style={s.note}>Nobody is filed at this location yet.</p>
  }

  return (
    <div style={s.panel} data-location-figures>
      {figures.length > 0 && (
        <>
          <div style={s.head}>
            <span style={s.title}>Notable figures here</span>
            <span style={s.count}>{figures.length}</span>
          </div>

          {figures.map(({ npc, via }) => {
            const match = matchStatBlock(npc, statBlocks)
            const preview = npcEncounterEntry(npc, match)
            return (
              <div key={npc.id} style={s.row}>
                <span style={s.name}>{npc.name}</span>
                {via !== 'here' && <span style={s.via}>{via}</span>}
                <span style={s.meta}>
                  {match
                    ? `${preview.hp_max} HP · AC ${preview.ac} · ${entryXp(preview)} XP`
                    : 'no stat block — placeholder HP/AC you can edit'}
                </span>
                <button type="button" style={s.addBtn} onClick={() => handleAdd(npc)}>
                  + Add
                </button>
              </div>
            )
          })}
        </>
      )}

      {tables.length > 0 && (
        <>
          <div style={{ ...s.head, marginTop: figures.length ? '0.8rem' : 0 }}>
            <span style={s.title}>Encounter tables here</span>
            <span style={s.count}>{tables.length}</span>
          </div>
          {tables.map(table => {
            const hit = rolled?.tableId === table.id ? rolled : null
            return (
              <div key={table.id} style={s.row}>
                <span style={s.name}>{table.name}</span>
                <span style={s.meta}>
                  {hit
                    ? `rolled ${hit.roll} — ${hit.entry?.label || 'nothing covers that result'}`
                    : `${table.die} · ${parseEntries(table.entries).length} entries · ${describeTable(table)}`}
                </span>
                <button type="button" style={s.rollBtn} onClick={() => handleRoll(table)}>
                  🎲 Roll
                </button>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

const s = {
  panel: { background: '#14100a', border: '1px solid #2a2010', borderRadius: 4, padding: '0.7rem 0.8rem', marginTop: '0.8rem' },
  head:  { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' },
  title: { color: '#c9a84c', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: 0.5 },
  count: { color: '#7a6035', fontSize: '0.72rem', border: '1px solid #3a2a10', borderRadius: 8, padding: '0 6px' },
  row:   { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', borderTop: '1px solid #1e1608' },
  name:  { color: '#e8e0d0', fontSize: '0.85rem', flexShrink: 0 },
  via:   { color: '#7fb3d5', fontSize: '0.7rem', border: '1px solid #2a5a8a', borderRadius: 8, padding: '0 6px' },
  meta:  { color: '#6b5a3a', fontSize: '0.75rem', flex: 1, textAlign: 'right' },
  addBtn:  { background: '#2a2010', color: '#c9a84c', border: '1px solid #8a6a2a', borderRadius: 4, padding: '0.2rem 0.7rem', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0 },
  rollBtn: { background: '#10263a', color: '#7fb3d5', border: '1px solid #2a5a8a', borderRadius: 4, padding: '0.2rem 0.7rem', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0 },
  note:  { color: '#6b5a3a', fontSize: '0.8rem', fontStyle: 'italic', marginTop: '0.6rem' },
}
