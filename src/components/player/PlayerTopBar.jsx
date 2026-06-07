export default function PlayerTopBar({ campaign, activeView, onViewChange, connected, isFullScreen, onToggleFullScreen }) {
  return (
    <div style={s.bar}>
      {/* Campaign name */}
      <div style={s.left}>
        <span style={s.logo}>⚔</span>
        <span style={s.campaignName}>
          {campaign ? campaign.name : 'Player View'}
        </span>
      </div>

      {/* View navigation */}
      <nav style={s.nav}>
        <button
          style={{ ...s.navBtn, ...(activeView === 'character' ? s.navBtnActive : {}) }}
          onClick={() => onViewChange('character')}
        >
          Character
        </button>
        <button
          style={{ ...s.navBtn, ...(activeView === 'map' ? s.navBtnActive : {}) }}
          onClick={() => onViewChange('map')}
        >
          Map
        </button>
      </nav>

      {/* Right: connection status + full screen */}
      <div style={s.right}>
        <span style={{ ...s.statusDot, background: connected ? '#4caf50' : '#e8a020' }} />
        <span style={{ ...s.statusLabel, color: connected ? '#a89060' : '#e8a020' }}>
          {connected ? 'Connected' : 'Waiting…'}
        </span>
        <button
          style={s.fsBtn}
          onClick={onToggleFullScreen}
          title={isFullScreen ? 'Exit Full Screen (Esc)' : 'Full Screen (F11)'}
        >
          {isFullScreen ? '⊡' : '⛶'}
        </button>
      </div>
    </div>
  )
}

const s = {
  bar:          { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1a1208', borderBottom: '1px solid #3a2a10', padding: '0 1rem', height: 48, flexShrink: 0, gap: '1rem' },
  left:         { display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 160 },
  logo:         { fontSize: '1.1rem' },
  campaignName: { color: '#c9a84c', fontWeight: 700, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 },
  nav:          { display: 'flex', gap: '0.25rem' },
  navBtn:       { background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', padding: '0.3rem 1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', minHeight: 44, transition: 'all 0.15s' },
  navBtnActive: { background: '#2a1e0a', borderColor: '#c9a84c', color: '#c9a84c', fontWeight: 700 },
  right:        { display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 130, justifyContent: 'flex-end' },
  statusDot:    { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  statusLabel:  { fontSize: '0.8rem' },
  fsBtn: {
    background:   'transparent',
    border:       '1px solid #3a2a10',
    color:        '#a89060',
    borderRadius: 4,
    width:        30,
    height:       30,
    cursor:       'pointer',
    fontSize:     '1rem',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    marginLeft:   '0.25rem',
    flexShrink:   0,
  },
}
