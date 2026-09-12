import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { notifyError } from '../../stores/toastStore'

// "Everything attached to this" — the answer to the question a DM asks a second
// before the party walks into a place: what is here, and what do I need open?
//
// Before Phase 4 this was four separate pages and a search. The data was all
// there — npcs.location_id, maps.location_id, encounters.location_id and the
// connections table — with nothing that joined it up in one view.

const LINK_PATHS = {
  npc:       '/world/npcs',
  location:  '/world/locations',
  faction:   '/world/factions',
  lore:      '/world/lore',
  map:       '/maps',
  encounter: '/encounters',
  character: '/characters',
  plot:      '/world/plots',
}

export default function AttachedPanel({ entityType, entityId, entityName, campaignId }) {
  const navigate = useNavigate()
  const [groups, setGroups] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    try {
      // Each call is caught individually: one missing channel should cost that
      // one section, not the whole panel.
      const safe = (p) => p.catch(() => [])

      const [connections, npcs, maps, encounters] = await Promise.all([
        safe(window.electronAPI.db.connections.getForEntity(entityType, entityId)),
        entityType === 'location' ? safe(window.electronAPI.db.npcs.getByLocation(entityId)) : [],
        entityType === 'location' ? safe(window.electronAPI.db.maps.getByLocation(entityId)) : [],
        entityType === 'location' ? safe(window.electronAPI.db.encounters.getByLocation(entityId)) : [],
      ])

      setGroups({ connections, npcs, maps, encounters })
    } catch (err) {
      notifyError(err, 'Load attached items')
      setGroups({ connections: [], npcs: [], maps: [], encounters: [] })
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={s.loading}>Loading connections…</div>
  if (!groups) return null

  const total = groups.connections.length + groups.npcs.length + groups.maps.length + groups.encounters.length
  if (total === 0) {
    return (
      <div style={s.panel}>
        <h3 style={s.heading}>Attached</h3>
        <p style={s.empty}>Nothing is linked to {entityName} yet.</p>
      </div>
    )
  }

  return (
    <div style={s.panel}>
      <h3 style={s.heading}>Attached <span style={s.count}>{total}</span></h3>

      <Group label="NPCs here" items={groups.npcs}
        render={n => n.name} onOpen={() => navigate(LINK_PATHS.npc)} />

      <Group label="Maps" items={groups.maps}
        render={m => m.name} onOpen={() => navigate(LINK_PATHS.map)} />

      <Group label="Encounters" items={groups.encounters}
        render={e => `${e.name}${e.status ? ` · ${e.status}` : ''}`}
        onOpen={() => navigate(LINK_PATHS.encounter)} />

      <Group
        label="Connections"
        items={groups.connections}
        render={(c) => {
          // The row names both ends; show whichever one is not this entity.
          const thisIsA = c.entity_a_type === entityType && Number(c.entity_a_id) === Number(entityId)
          const otherType = thisIsA ? c.entity_b_type : c.entity_a_type
          const otherName = thisIsA
            ? (c.entity_b_name ?? `${c.entity_b_type} #${c.entity_b_id}`)
            : (c.entity_a_name ?? `${c.entity_a_type} #${c.entity_a_id}`)
          return `${c.relationship || 'linked'} → ${otherName} (${otherType})`
        }}
        onOpen={() => navigate('/world/connections')}
      />
    </div>
  )
}

function Group({ label, items, render, onOpen }) {
  if (!items || items.length === 0) return null
  return (
    <div style={s.group}>
      <div style={s.groupHead}>
        <span style={s.groupLabel}>{label}</span>
        <span style={s.groupCount}>{items.length}</span>
        <button style={s.groupOpen} onClick={onOpen}>open ›</button>
      </div>
      {items.slice(0, 8).map((item, i) => (
        <div key={item.id ?? i} style={s.item}>{render(item)}</div>
      ))}
      {items.length > 8 && <div style={s.more}>+{items.length - 8} more</div>}
    </div>
  )
}

const s = {
  panel:      { background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, padding: '0.7rem 0.8rem' },
  heading:    { color: '#a89060', fontSize: '0.82rem', margin: '0 0 8px', display: 'flex', alignItems: 'baseline', gap: 6 },
  count:      { color: '#4a3f28', fontSize: '0.72rem' },
  empty:      { color: '#4a3f28', fontSize: '0.76rem', margin: 0 },
  loading:    { color: '#4a3f28', fontSize: '0.76rem', padding: '0.7rem' },
  group:      { marginBottom: 10 },
  groupHead:  { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 },
  groupLabel: { color: '#6b5a3a', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  groupCount: { color: '#4a3f28', fontSize: '0.7rem' },
  groupOpen:  { marginLeft: 'auto', background: 'none', border: 'none', color: '#6b5a3a', fontSize: '0.7rem', cursor: 'pointer', padding: 0 },
  item:       { color: '#c8bda8', fontSize: '0.78rem', padding: '2px 0 2px 8px', borderLeft: '2px solid #1e1608', lineHeight: 1.4 },
  more:       { color: '#4a3f28', fontSize: '0.7rem', padding: '2px 0 0 8px' },
}
