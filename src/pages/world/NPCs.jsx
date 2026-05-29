import { useState, useEffect, useCallback, useMemo } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import EntityCard from '../../components/world/EntityCard'
import NPCModal from '../../components/world/NPCModal'

export default function NPCs() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)
  const [npcs, setNpcs]             = useState([])
  const [locations, setLocations]   = useState([])
  const [factions, setFactions]     = useState([])
  const [modalOpen, setModalOpen]   = useState(false)
  const [editing, setEditing]       = useState(null)

  // Filters
  const [search, setSearch]         = useState('')
  const [filterLoc, setFilterLoc]   = useState('')
  const [filterFac, setFilterFac]   = useState('')
  const [showDead, setShowDead]     = useState(false)

  const load = useCallback(() => {
    if (!activeCampaign?.id) return
    Promise.all([
      window.electronAPI.db.npcs.getAll(activeCampaign.id),
      window.electronAPI.db.locations.getAll(activeCampaign.id),
      window.electronAPI.db.factions.getAll(activeCampaign.id),
    ]).then(([n, l, f]) => { setNpcs(n); setLocations(l); setFactions(f) })
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  // Client-side filtering
  const filtered = useMemo(() => {
    return npcs.filter(n => {
      if (!showDead && !n.is_alive) return false
      if (filterLoc && n.location_id !== Number(filterLoc)) return false
      if (filterFac && n.faction_id  !== Number(filterFac)) return false
      if (search) {
        const q = search.toLowerCase()
        if (!n.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [npcs, search, filterLoc, filterFac, showDead])

  function openCreate() { setEditing(null); setModalOpen(true) }
  function openEdit(npc) { setEditing(npc); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(null) }

  async function handleToggleAlive(npc, e) {
    e.stopPropagation()
    await window.electronAPI.db.npcs.toggleAlive(npc.id, !npc.is_alive)
    // Update in-place without full reload
    setNpcs(prev => prev.map(n => n.id === npc.id ? { ...n, is_alive: npc.is_alive ? 0 : 1 } : n))
  }

  async function handleDelete(npc) {
    await window.electronAPI.db.npcs.delete(npc.id)
    load()
  }

  const countLabel = filtered.length === npcs.length
    ? `${npcs.length} NPC${npcs.length !== 1 ? 's' : ''}`
    : `${filtered.length} of ${npcs.length} NPCs`

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>NPCs</h1>
          <p style={s.count}>{countLabel}</p>
        </div>
        <button style={s.btnPrimary} onClick={openCreate}>+ New NPC</button>
      </div>

      {/* Filter bar */}
      <div style={s.filterBar}>
        <input style={s.searchInput} value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name…" />
        <select style={s.filterSelect} value={filterLoc} onChange={e => setFilterLoc(e.target.value)}>
          <option value="">All Locations</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select style={s.filterSelect} value={filterFac} onChange={e => setFilterFac(e.target.value)}>
          <option value="">All Factions</option>
          {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <label style={s.checkLabel}>
          <input type="checkbox" checked={showDead} onChange={e => setShowDead(e.target.checked)} />
          {' '}Show Dead
        </label>
      </div>

      {npcs.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No NPCs yet. Every great story needs characters.</p>
          <button style={s.btnPrimary} onClick={openCreate}>+ New NPC</button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No NPCs match the current filters.</p>
        </div>
      ) : (
        <div style={s.list}>
          {filtered.map(npc => {
            const tags = []
            if (npc.location_name) tags.push({ label: npc.location_name, color: '#1a1a2a', text: '#6a8abf' })
            if (npc.faction_name)  tags.push({ label: npc.faction_name,  color: '#1e1228', text: '#9a6abf' })

            const aliveIcon = npc.is_alive ? '🟢' : '💀'
            const subtitle = [npc.race, npc.role || npc.class].filter(Boolean).join(' ')

            return (
              <EntityCard
                key={npc.id}
                title={`${aliveIcon} ${npc.name}`}
                subtitle={subtitle || 'Unknown'}
                tags={tags}
                meta={new Date(npc.created_at).toLocaleDateString()}
                onClick={() => openEdit(npc)}
                onDelete={() => handleDelete(npc)}
                accentColor={npc.is_alive ? '#c9a84c' : '#6a3030'}
              >
                <div style={s.cardActions}>
                  <button style={s.actionBtn} onClick={e => handleToggleAlive(npc, e)}>
                    {npc.is_alive ? 'Mark Dead' : 'Mark Alive'}
                  </button>
                </div>
              </EntityCard>
            )
          })}
        </div>
      )}

      <NPCModal
        isOpen={modalOpen}
        npc={editing}
        onClose={closeModal}
        onSaved={load}
      />
    </div>
  )
}

const s = {
  page:         { padding: '2rem', maxWidth: 800 },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  title:        { color: '#c9a84c', fontSize: '1.6rem', margin: 0 },
  count:        { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.2rem 0 0' },
  filterBar:    { display: 'flex', gap: '0.6rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' },
  searchInput:  { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.4rem 0.7rem', fontSize: '0.85rem', outline: 'none', minWidth: 160 },
  filterSelect: { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#a89060', padding: '0.4rem 0.5rem', fontSize: '0.82rem', outline: 'none' },
  checkLabel:   { color: '#a89060', fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' },
  list:         { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty:        { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, gap: '1rem' },
  emptyText:    { color: '#6b5a3a', fontSize: '1rem' },
  cardActions:  { marginTop: '0.4rem' },
  actionBtn:    { background: 'none', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.15rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' },
  btnPrimary:   { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
}
