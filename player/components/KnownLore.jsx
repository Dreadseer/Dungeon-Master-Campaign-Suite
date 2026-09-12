import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../api'

// "What you know" — everything the DM has explicitly revealed to the party.
//
// This is the only place the player app shows lore, NPC or location prose, and
// it shows exactly the rows behind a reveal. The server decides what is safe to
// send (PlayerServer._resolveRevealed); this component does not filter, because
// a client-side filter is the mistake Phase 2 spent its time undoing.

const TYPE_LABELS = { lore: 'Lore', npc: 'Person', location: 'Place', faction: 'Faction' }
const TYPE_COLORS = { lore: '#C9A84C', npc: '#6a8abf', location: '#5a9a5a', faction: '#9a6abf' }

export default function KnownLore({ campaignId }) {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    try {
      const data = await apiFetch(`/api/campaign/${campaignId}/revealed`)
      setItems(data.items ?? [])
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => { load() }, [load])

  const types = [...new Set(items.map(i => i.type))]
  const shown = filter === 'all' ? items : items.filter(i => i.type === filter)

  if (loading) {
    return <div style={s.state}>Loading what you know…</div>
  }

  if (error) {
    return (
      <div style={s.state}>
        <div style={s.error}>{error}</div>
        <button style={s.retry} onClick={load}>Try again</button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={s.state}>
        <div style={s.emptyIcon}>📖</div>
        <p style={s.emptyTitle}>Nothing yet</p>
        <p style={s.emptyHint}>
          As your DM reveals people, places and lore, they will appear here.
        </p>
        <button style={s.retry} onClick={load}>Refresh</button>
      </div>
    )
  }

  return (
    <div style={s.wrap}>
      <div style={s.headRow}>
        <h2 style={s.heading}>What you know</h2>
        <button style={s.refresh} onClick={load} title="Check for new reveals">↻</button>
      </div>

      {types.length > 1 && (
        <div style={s.filters}>
          <FilterChip label="All" active={filter === 'all'} onClick={() => setFilter('all')} count={items.length} />
          {types.map(t => (
            <FilterChip
              key={t}
              label={TYPE_LABELS[t] ?? t}
              active={filter === t}
              onClick={() => setFilter(t)}
              count={items.filter(i => i.type === t).length}
              color={TYPE_COLORS[t]}
            />
          ))}
        </div>
      )}

      <div style={s.list}>
        {shown.map(item => (
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

function FilterChip({ label, active, onClick, count, color = '#C9A84C' }) {
  return (
    <button
      style={{
        ...s.chip,
        background: active ? color : 'transparent',
        color: active ? '#0d0a05' : color,
        borderColor: color,
      }}
      onClick={onClick}
    >
      {label} {count != null && <span style={{ opacity: 0.7 }}>{count}</span>}
    </button>
  )
}

const s = {
  wrap:        { padding: '1rem', maxWidth: 720, margin: '0 auto' },
  headRow:     { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  heading:     { color: '#C9A84C', fontFamily: 'Georgia', fontSize: '1.3rem', margin: 0 },
  refresh:     { marginLeft: 'auto', background: 'none', border: '1px solid #3a2a10', color: '#C9A84C', borderRadius: 4, width: 30, height: 30, cursor: 'pointer', fontSize: '1rem' },
  filters:     { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 },
  chip:        { border: '1px solid', borderRadius: 12, fontSize: '0.75rem', padding: '3px 10px', cursor: 'pointer' },
  list:        { display: 'flex', flexDirection: 'column', gap: 10 },
  card:        { background: '#15100a', border: '1px solid #3a2a10', borderLeft: '3px solid', borderRadius: 6, padding: '0.8rem 0.9rem' },
  cardHead:    { display: 'flex', alignItems: 'baseline', gap: 8 },
  cardType:    { fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em' },
  cardTitle:   { color: '#e8e0d0', fontSize: '1rem', margin: 0, fontFamily: 'Georgia' },
  cardSubtitle:{ color: '#8a7a5a', fontSize: '0.78rem', marginTop: 2 },
  cardBody:    { color: '#c8bda8', fontSize: '0.88rem', lineHeight: 1.55, margin: '8px 0 0', whiteSpace: 'pre-wrap' },
  state:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '3rem 1rem', textAlign: 'center' },
  emptyIcon:   { fontSize: '2rem', opacity: 0.5 },
  emptyTitle:  { color: '#C9A84C', fontSize: '1.05rem', margin: 0, fontFamily: 'Georgia' },
  emptyHint:   { color: '#6b6b6b', fontSize: '0.85rem', margin: 0, maxWidth: 320, lineHeight: 1.5 },
  error:       { color: '#ffb0b0', fontSize: '0.88rem' },
  retry:       { background: 'none', border: '1px solid #C9A84C', color: '#C9A84C', borderRadius: 4, padding: '5px 14px', fontSize: '0.82rem', cursor: 'pointer', marginTop: 6 },
}
