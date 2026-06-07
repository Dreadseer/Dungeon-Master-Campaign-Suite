import { useNavigate } from 'react-router-dom'

const TYPE_PILLS = [
  { key: 'npc',      label: '👤 NPCs'      },
  { key: 'location', label: '🏰 Locations' },
  { key: 'faction',  label: '🛡️ Factions'  },
  { key: 'item',     label: '💎 Items'     },
]

export default function MindMapToolbar({
  // filter state
  visibleTypes,     // Set<string>
  onToggleType,     // (key: string) => void
  factions,         // [{ id, name }]
  factionFilter,    // number | null
  onFactionFilter,  // (id | null) => void
  searchQuery,
  onSearchQuery,
  // layout
  layoutDirection,  // 'TB' | 'LR'
  onAutoLayout,     // () => void
  onToggleDirection,// () => void
  onResetLayout,    // () => void
  // canvas
  onFitView,        // () => void
  onExport,         // () => void
}) {
  const navigate = useNavigate()

  return (
    <div style={s.bar}>
      {/* ── Left cluster: layout ─── */}
      <div style={s.cluster}>
        <button style={s.btnPrimary} onClick={onAutoLayout} title="Run Dagre auto-layout">
          ⚡ Auto Layout
        </button>
        <button style={s.btnGhost} onClick={onToggleDirection} title="Toggle layout direction">
          {layoutDirection === 'TB' ? '↕ TB' : '↔ LR'}
        </button>
        <button style={s.btnGhost} onClick={onResetLayout} title="Reset to default grid positions">
          ↺ Reset
        </button>
      </div>

      <div style={s.divider} />

      {/* ── Centre cluster: type filter pills ─── */}
      <div style={s.cluster}>
        {TYPE_PILLS.map(p => {
          const active = visibleTypes.has(p.key)
          return (
            <button
              key={p.key}
              style={active ? s.pillActive : s.pillOff}
              onClick={() => onToggleType(p.key)}
              title={`Toggle ${p.label} visibility`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div style={s.divider} />

      {/* ── Faction dropdown ─── */}
      <select
        style={s.select}
        value={factionFilter ?? ''}
        onChange={e => onFactionFilter(e.target.value ? Number(e.target.value) : null)}
        title="Filter by faction"
      >
        <option value=''>All Factions</option>
        {factions.map(f => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>

      {/* ── Search ─── */}
      <div style={s.searchWrap}>
        <input
          style={s.searchInput}
          placeholder="Search nodes…"
          value={searchQuery}
          onChange={e => onSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button style={s.clearSearch} onClick={() => onSearchQuery('')} title="Clear search">
            ✕
          </button>
        )}
      </div>

      <div style={s.spacer} />

      {/* ── Right cluster: canvas + nav ─── */}
      <div style={s.cluster}>
        <button style={s.btnGhost} onClick={onFitView} title="Fit all nodes in view">
          ⊡ Fit View
        </button>
        <button
          style={s.btnGhost}
          onClick={() => navigate('/world/connections')}
          title="Add a connection in the World Builder"
        >
          + Connection
        </button>
        {onExport && (
          <button style={s.btnGhost} onClick={onExport} title="Export mind map as PNG (1920×1080)">
            ⬇ Export PNG
          </button>
        )}
      </div>
    </div>
  )
}

const s = {
  bar: {
    position:       'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    height:         48,
    display:        'flex', alignItems: 'center', gap: 6,
    padding:        '0 12px',
    background:     'rgba(13, 10, 5, 0.92)',
    borderBottom:   '1px solid #3a2a10',
    backdropFilter: 'blur(4px)',
    flexShrink:     0,
  },
  cluster: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
  },
  divider: {
    width:      1,
    height:     24,
    background: '#3a2a10',
    margin:     '0 4px',
  },
  spacer: { flex: 1 },

  btnPrimary: {
    padding:      '4px 12px',
    background:   '#2a1f06',
    border:       '1px solid #C9A84C',
    borderRadius: 4,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     12,
    fontWeight:   600,
    whiteSpace:   'nowrap',
  },
  btnGhost: {
    padding:      '4px 10px',
    background:   'none',
    border:       '1px solid #3a2a10',
    borderRadius: 4,
    color:        '#888',
    cursor:       'pointer',
    fontSize:     12,
    whiteSpace:   'nowrap',
  },

  pillActive: {
    padding:      '3px 10px',
    background:   '#2a1f06',
    border:       '1px solid #C9A84C',
    borderRadius: 12,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     11,
    whiteSpace:   'nowrap',
  },
  pillOff: {
    padding:      '3px 10px',
    background:   'none',
    border:       '1px solid #333',
    borderRadius: 12,
    color:        '#555',
    cursor:       'pointer',
    fontSize:     11,
    whiteSpace:   'nowrap',
  },

  select: {
    padding:      '4px 8px',
    background:   '#1a1208',
    border:       '1px solid #3a2a10',
    borderRadius: 4,
    color:        '#c9c0a8',
    fontSize:     12,
    cursor:       'pointer',
    minWidth:     110,
  },

  searchWrap: {
    position: 'relative',
    display:  'flex',
    alignItems: 'center',
  },
  searchInput: {
    padding:      '4px 28px 4px 10px',
    background:   '#1a1208',
    border:       '1px solid #3a2a10',
    borderRadius: 4,
    color:        '#c9c0a8',
    fontSize:     12,
    width:        140,
    outline:      'none',
  },
  clearSearch: {
    position:   'absolute', right: 6,
    background: 'none', border: 'none',
    color:      '#666', cursor: 'pointer',
    fontSize:   11, padding: 0, lineHeight: 1,
  },
}
