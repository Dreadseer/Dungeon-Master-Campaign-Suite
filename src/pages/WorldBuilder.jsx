import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useCampaignStore from '../stores/campaignStore'
import { useWorldData } from '../hooks/useWorldData'
import NPCModal from '../components/world/NPCModal'
import AISuggestionPanel from '../components/world/AISuggestionPanel'

export default function WorldBuilder() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)
  const navigate = useNavigate()
  const { locations, factions, npcs, lore, loading, refresh } = useWorldData(activeCampaign?.id)

  const [npcModalOpen, setNpcModalOpen] = useState(false)

  const aliveNpcs = npcs.filter(n => n.is_alive)
  const isEmpty   = !loading && locations.length === 0 && factions.length === 0 && npcs.length === 0 && lore.length === 0

  // Skeleton bar
  const Skel = ({ w = '100%', h = '1rem', mb = '0.5rem' }) => (
    <div style={{ width: w, height: h, background: '#2d1f0a', borderRadius: 4, marginBottom: mb, animation: 'none', opacity: 0.6 }} />
  )

  if (loading) {
    return (
      <div style={s.page}>
        <Skel h="2rem" w="60%" mb="0.5rem" />
        <Skel h="1rem" w="30%" mb="2rem" />
        <div style={s.statRow}>
          {[0,1,2,3].map(i => <Skel key={i} h="3.5rem" w="120px" mb="0" />)}
        </div>
        <div style={s.grid}>
          <div><Skel h="12rem" /></div>
          <div><Skel h="12rem" /></div>
        </div>
        <Skel h="8rem" mb="1rem" />
        <Skel h="6rem" />
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div style={s.page}>
        <div style={s.emptyWelcome}>
          <h1 style={s.title}>{activeCampaign?.name}</h1>
          <p style={s.subtitle}>Your world is empty. Build it one entity at a time.</p>
          <div style={s.emptyGrid}>
            {[
              { icon: '🏰', label: 'Locations', desc: 'Towns, dungeons, shops, regions, landmarks', path: '/world/locations?create=true' },
              { icon: '⚔️', label: 'Factions',  desc: 'Guilds, kingdoms, cults, and organisations', path: '/world/factions?create=true' },
              { icon: '🧑', label: 'NPCs',       desc: 'Characters, villains, allies, and merchants', action: () => setNpcModalOpen(true) },
              { icon: '📜', label: 'Lore',       desc: 'History, secrets, myths, and legends', path: '/world/lore?create=true' },
            ].map(({ icon, label, desc, path, action }) => (
              <div key={label} style={s.emptyCard} onClick={() => path ? navigate(path) : action?.()}>
                <span style={s.emptyIcon}>{icon}</span>
                <strong style={s.emptyLabel}>{label}</strong>
                <p style={s.emptyDesc}>{desc}</p>
                <span style={s.emptyAdd}>+ Add {label}</span>
              </div>
            ))}
          </div>
        </div>
        <NPCModal isOpen={npcModalOpen} npc={null} onClose={() => setNpcModalOpen(false)} onSaved={refresh} />
      </div>
    )
  }

  const recentLocations = [...locations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)
  const recentNpcs      = [...npcs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)
  const recentLore      = [...lore].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 3)

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.title}>{activeCampaign?.name}</h1>
          {activeCampaign?.world_setting && <p style={s.subtitle}>{activeCampaign.world_setting}</p>}
        </div>
      </div>

      {/* Stat chips */}
      <div style={s.statRow}>
        {[
          { label: 'Locations',    count: locations.length, path: '/world/locations' },
          { label: 'Factions',     count: factions.length,  path: '/world/factions' },
          { label: 'NPCs (alive)', count: aliveNpcs.length, path: '/world/npcs' },
          { label: 'Lore Entries', count: lore.length,      path: '/world/lore' },
        ].map(({ label, count, path }) => (
          <button key={label} style={s.statChip} onClick={() => navigate(path)}>
            <span style={s.chipCount}>{count}</span>
            <span style={s.chipLabel}>{label}</span>
          </button>
        ))}
      </div>

      {/* Quick-summary grid */}
      <div style={s.grid}>
        {/* Recent Locations */}
        <div style={s.panel}>
          <h3 style={s.panelTitle}>Recent Locations</h3>
          {recentLocations.length === 0 ? (
            <p style={s.panelEmpty}>No locations yet.</p>
          ) : (
            <ul style={s.compactList}>
              {recentLocations.map(loc => (
                <li key={loc.id} style={s.compactItem}>
                  <span style={s.compactName}>{loc.name}</span>
                  <span style={s.typeBadge}>{loc.type}</span>
                  {loc.parent_name && <span style={s.parentTag}> in {loc.parent_name}</span>}
                </li>
              ))}
            </ul>
          )}
          <button style={s.viewAll} onClick={() => navigate('/world/locations')}>View All Locations →</button>
        </div>

        {/* Recent NPCs */}
        <div style={s.panel}>
          <h3 style={s.panelTitle}>Recent NPCs</h3>
          {recentNpcs.length === 0 ? (
            <p style={s.panelEmpty}>No NPCs yet.</p>
          ) : (
            <ul style={s.compactList}>
              {recentNpcs.map(npc => (
                <li key={npc.id} style={s.compactItem}>
                  <span style={s.aliveIcon}>{npc.is_alive ? '🟢' : '💀'}</span>
                  <span style={s.compactName}>{npc.name}</span>
                  {(npc.race || npc.role || npc.class) && (
                    <span style={s.parentTag}> {[npc.race, npc.role || npc.class].filter(Boolean).join(' ')}</span>
                  )}
                  {npc.faction_name && <span style={s.factionTag}>{npc.faction_name}</span>}
                </li>
              ))}
            </ul>
          )}
          <button style={s.viewAll} onClick={() => navigate('/world/npcs')}>View All NPCs →</button>
        </div>
      </div>

      {/* Factions panel */}
      {factions.length > 0 && (
        <div style={s.fullPanel}>
          <h3 style={s.panelTitle}>Factions</h3>
          <div style={s.factionList}>
            {factions.map(fac => {
              const npcCount = npcs.filter(n => n.faction_id === fac.id).length
              return (
                <div key={fac.id} style={s.factionRow}>
                  <span style={s.factionName}>{fac.name}</span>
                  <span style={s.alignBadge}>{fac.alignment || 'Unknown'}</span>
                  <span style={s.npcCount}>{npcCount} NPC{npcCount !== 1 ? 's' : ''}</span>
                </div>
              )
            })}
          </div>
          <button style={s.viewAll} onClick={() => navigate('/world/factions')}>Manage Factions →</button>
        </div>
      )}

      {/* Recent Lore */}
      {recentLore.length > 0 && (
        <div style={s.fullPanel}>
          <h3 style={s.panelTitle}>Recent Lore</h3>
          <div style={s.loreList}>
            {recentLore.map(entry => {
              let parsed = {}
              try { parsed = JSON.parse(entry.data) } catch {}
              return (
                <div key={entry.id} style={{ ...s.loreCard, ...(parsed.is_secret ? s.loreCardSecret : {}) }}>
                  <div style={s.loreCardHeader}>
                    <span style={s.loreName}>{parsed.is_secret ? '🔒 ' : ''}{entry.name}</span>
                    <span style={s.catBadge}>{parsed.category}</span>
                  </div>
                  <p style={s.lorePreview}>{(parsed.content || '').slice(0, 100)}{(parsed.content || '').length > 100 ? '…' : ''}</p>
                </div>
              )
            })}
          </div>
          <button style={s.viewAll} onClick={() => navigate('/world/lore')}>View All Lore →</button>
        </div>
      )}

      {/* Quick actions */}
      <div style={s.quickActions}>
        <button style={s.btnPrimary} onClick={() => setNpcModalOpen(true)}>+ Add NPC</button>
        <button style={s.btnSecondary} onClick={() => navigate('/world/locations?create=true')}>+ Add Location</button>
        <button style={s.btnSecondary} onClick={() => navigate('/world/factions?create=true')}>+ Add Faction</button>
        <button style={s.btnSecondary} onClick={() => navigate('/world/lore?create=true')}>+ Add Lore Entry</button>
      </div>

      {/* AI Suggestion Panel */}
      <AISuggestionPanel
        activeCampaign={activeCampaign}
        factions={factions}
        locations={locations}
        npcs={npcs}
      />

      <NPCModal isOpen={npcModalOpen} npc={null} onClose={() => setNpcModalOpen(false)} onSaved={refresh} />
    </div>
  )
}

const s = {
  page:         { padding: '2rem', maxWidth: 900 },
  pageHeader:   { marginBottom: '1.25rem' },
  title:        { color: '#c9a84c', fontSize: '1.8rem', margin: 0, fontFamily: 'Georgia, serif' },
  subtitle:     { color: '#8a7a5a', fontSize: '0.95rem', margin: '0.3rem 0 0' },

  statRow:      { display: 'flex', gap: '0.75rem', marginBottom: '1.75rem', flexWrap: 'wrap' },
  statChip:     { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 8, padding: '0.65rem 1.1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', minWidth: 100, transition: 'border-color 0.15s' },
  chipCount:    { color: '#c9a84c', fontSize: '1.6rem', fontWeight: 'bold', lineHeight: 1 },
  chipLabel:    { color: '#6b5a3a', fontSize: '0.72rem' },

  grid:         { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' },
  panel:        { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 6, padding: '1rem' },
  fullPanel:    { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 6, padding: '1rem', marginBottom: '1rem' },
  panelTitle:   { color: '#a89060', fontSize: '0.78rem', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 0.75rem' },
  panelEmpty:   { color: '#4a3a1a', fontSize: '0.85rem' },

  compactList:  { listStyle: 'none', padding: 0, margin: '0 0 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  compactItem:  { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' },
  compactName:  { color: '#e8e0d0', fontSize: '0.88rem', fontWeight: 500 },
  aliveIcon:    { fontSize: '0.65rem' },
  typeBadge:    { background: '#1a2a1a', color: '#5a9a5a', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 3 },
  parentTag:    { color: '#6b5a3a', fontSize: '0.78rem' },
  factionTag:   { background: '#1e1228', color: '#9a6abf', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 3 },

  factionList:  { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' },
  factionRow:   { display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0.75rem', background: '#100d08', borderRadius: 4 },
  factionName:  { color: '#e8e0d0', fontSize: '0.92rem', fontWeight: 600, flex: 1 },
  alignBadge:   { color: '#9a8060', fontSize: '0.78rem', background: '#1e1810', padding: '0.15rem 0.5rem', borderRadius: 3 },
  npcCount:     { color: '#6b5a3a', fontSize: '0.78rem' },

  loreList:     { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' },
  loreCard:     { background: '#100d08', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.6rem 0.8rem' },
  loreCardSecret: { border: '1px solid #4a1a1a', background: '#130808' },
  loreCardHeader: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.3rem' },
  loreName:     { color: '#e8e0d0', fontSize: '0.88rem', fontWeight: 500, flex: 1 },
  catBadge:     { color: '#a89060', fontSize: '0.7rem', background: '#1a1208', padding: '0.1rem 0.4rem', borderRadius: 3, border: '1px solid #3a2a10' },
  lorePreview:  { color: '#6b5a3a', fontSize: '0.8rem', margin: 0, lineHeight: 1.5 },

  viewAll:      { background: 'none', border: 'none', color: '#6a8abf', fontSize: '0.8rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' },

  quickActions: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1.5rem' },
  btnPrimary:   { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary: { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },

  // Empty state
  emptyWelcome: { maxWidth: 700, margin: '0 auto', paddingTop: '1rem' },
  emptyGrid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.5rem' },
  emptyCard:    { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 8, padding: '1.25rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  emptyIcon:    { fontSize: '1.6rem' },
  emptyLabel:   { color: '#c9a84c', fontSize: '1rem' },
  emptyDesc:    { color: '#6b5a3a', fontSize: '0.82rem', margin: 0 },
  emptyAdd:     { color: '#a89060', fontSize: '0.8rem', marginTop: '0.25rem' },
}
