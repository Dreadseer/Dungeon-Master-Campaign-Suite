export default function TopBar({ campaignName, playerName, connected, activeView, onViewChange }) {
  return (
    <div style={{ background: '#1a1208', borderBottom: '1px solid #2d1f0a',
      padding: '0 1rem', height: '52px', display: 'flex', alignItems: 'center',
      gap: '1rem', position: 'sticky', top: 0, zIndex: 100 }}>

      {/* Connection indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%',
          background: connected ? '#27ae60' : '#e74c3c',
          boxShadow: connected ? '0 0 6px #27ae60' : 'none' }} />
        <span style={{ fontSize: '12px', color: '#6b6b6b' }}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <span style={{ color: '#C9A84C', fontFamily: 'Georgia', fontSize: '14px', fontWeight: 'bold' }}>
        {campaignName ?? 'DMCS'}
      </span>

      <div style={{ flex: 1 }} />

      {/* View toggle */}
      {['character', 'map'].map(view => (
        <button
          key={view}
          onClick={() => onViewChange(view)}
          style={{ background: activeView === view ? '#C9A84C' : 'transparent',
            border: '1px solid #C9A84C', color: activeView === view ? '#0d0a05' : '#C9A84C',
            padding: '4px 12px', borderRadius: '4px', cursor: 'pointer',
            fontSize: '13px', textTransform: 'capitalize' }}
        >
          {view === 'character' ? '📜 Sheet' : '🗺 Map'}
        </button>
      ))}

      <span style={{ fontSize: '12px', color: '#6b6b6b' }}>{playerName}</span>
    </div>
  )
}
