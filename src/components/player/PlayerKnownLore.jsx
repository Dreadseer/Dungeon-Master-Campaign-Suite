import { useState, useEffect, useCallback } from 'react'

// "What you know" for the in-app Electron player window.
//
// The browser player app has its own version (player/components/KnownLore.jsx)
// because it reaches the data over HTTP with a session token. This window is
// inside Electron, so it goes through IPC — but it must apply the SAME rule:
// show only what the DM revealed, and only the player-facing fields.
//
// The filtering is done here rather than in a handler because these IPC channels
// are the DM's own read-only channels. That is the one meaningful difference
// from the browser path, where the server does the filtering and the client is
// not trusted. Here the window is already on the DM's machine.

const TYPE_LABELS = { lore: 'Lore', npc: 'Person', location: 'Place', faction: 'Faction' }
const TYPE_COLORS = { lore: '#C9A84C', npc: '#6a8abf', location: '#5a9a5a', faction: '#9a6abf' }

export default function PlayerKnownLore({ campaignId, broadcastMsg }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    try {
      const reveals = await window.electronAPI.db.reveals.getForCampaign(campaignId)
      const resolved = []

      for (const reveal of reveals) {
        const item = await resolveReveal(reveal, campaignId)
        if (item) resolved.push(item)
      }
      setItems(resolved)
      setError('')
    } catch (err) {
      setError(err?.message ?? 'Could not load what the party knows.')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => { load() }, [load])

  // A reveal made mid-session should appear without the player reopening the tab.
  useEffect(() => {
    if (broadcastMsg?.type === 'reveals:changed') load()
  }, [broadcastMsg, load])

  if (loading) return <div style={s.state}>Loading…</div>
  if (error)   return <div style={s.state}><span style={s.error}>{error}</span></div>

  if (items.length === 0) {
    return (
      <div style={s.state}>
        <div style={s.emptyIcon}>📖</div>
        <p style={s.emptyTitle}>Nothing yet</p>
        <p style={s.emptyHint}>As your DM reveals people, places and lore, they appear here.</p>
      </div>
    )
  }

  return (
    <div style={s.wrap}>
      <div style={s.headRow}>
        <h2 style={s.heading}>What you know</h2>
        <button style={s.refresh} onClick={load} title="Refresh">↻</button>
      </div>
      <div style={s.list}>
        {items.map(item => (
          <article key={`${item.type}:${item.id}`} style={{ ...s.card, borderLeftColor: TYPE_COLORS[item.type] ?? '#C9A84C' }}>
            <header style={s.cardHead}>
              <span style={{ ...s.cardType, color: TYPE_COLORS[item.type] ?? '#C9A84C' }}>
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              <h3 style={s.cardTitle}>{item.name}</h3>
            </header>
            {item.subtitle && <div style={s.cardSubtitle}>{item.subtitle}</div>}
            {item.summary && <p style={s.cardBody}>{item.summary}</p>}
          </article>
        ))}
      </div>
    </div>
  )
}

// Mirrors PlayerServer._resolveRevealed exactly: only player-facing fields.
// An NPC's secrets/motivation/notes and a location's lore never appear —
// revealing an NPC means the party has met them, not read the DM's notes.
async function resolveReveal(reveal, campaignId) {
  const base = { type: reveal.entity_type, id: reveal.entity_id, revealed_at: reveal.revealed_at }
  const api = window.electronAPI.db

  try {
    switch (reveal.entity_type) {
      case 'npc': {
        const npc = await api.npcs.getById(reveal.entity_id)
        if (!npc || Number(npc.campaign_id) !== Number(campaignId)) return null
        return { ...base, name: npc.name, summary: [npc.race, npc.class, npc.role].filter(Boolean).join(' · ') || null }
      }
      case 'location': {
        const loc = await api.locations.getById(reveal.entity_id)
        if (!loc || Number(loc.campaign_id) !== Number(campaignId)) return null
        return { ...base, name: loc.name, subtitle: loc.type, summary: loc.description ?? null }
      }
      case 'faction': {
        const faction = await api.factions.getById(reveal.entity_id)
        if (!faction || Number(faction.campaign_id) !== Number(campaignId)) return null
        return { ...base, name: faction.name, subtitle: faction.alignment, summary: faction.description ?? null }
      }
      case 'lore': {
        const entry = await api.lore.getById(reveal.entity_id)
        if (!entry || Number(entry.campaign_id) !== Number(campaignId)) return null
        let content = null, category = null
        try {
          const parsed = JSON.parse(entry.data ?? '{}')
          content = parsed.content ?? null
          category = parsed.category ?? null
        } catch { /* malformed blob — the title is still worth showing */ }
        return { ...base, name: entry.name, subtitle: category, summary: content }
      }
      default:
        return null    // unknown type: skip rather than guess what is safe
    }
  } catch {
    return null
  }
}

const s = {
  wrap:        { padding: '1.5rem', maxWidth: 760, margin: '0 auto' },
  headRow:     { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 },
  heading:     { color: '#C9A84C', fontFamily: 'Georgia', fontSize: '1.4rem', margin: 0 },
  refresh:     { marginLeft: 'auto', background: 'none', border: '1px solid #3a2a10', color: '#C9A84C', borderRadius: 4, width: 32, height: 32, cursor: 'pointer', fontSize: '1rem' },
  list:        { display: 'flex', flexDirection: 'column', gap: 10 },
  card:        { background: '#15100a', border: '1px solid #3a2a10', borderLeft: '3px solid', borderRadius: 6, padding: '0.85rem 1rem' },
  cardHead:    { display: 'flex', alignItems: 'baseline', gap: 8 },
  cardType:    { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' },
  cardTitle:   { color: '#e8e0d0', fontSize: '1.05rem', margin: 0, fontFamily: 'Georgia' },
  cardSubtitle:{ color: '#8a7a5a', fontSize: '0.8rem', marginTop: 2 },
  cardBody:    { color: '#c8bda8', fontSize: '0.9rem', lineHeight: 1.55, margin: '8px 0 0', whiteSpace: 'pre-wrap' },
  state:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '4rem 1rem', textAlign: 'center' },
  emptyIcon:   { fontSize: '2.2rem', opacity: 0.5 },
  emptyTitle:  { color: '#C9A84C', fontSize: '1.1rem', margin: 0, fontFamily: 'Georgia' },
  emptyHint:   { color: '#6b6b6b', fontSize: '0.88rem', margin: 0, maxWidth: 340, lineHeight: 1.5 },
  error:       { color: '#e08080', fontSize: '0.9rem' },
}
