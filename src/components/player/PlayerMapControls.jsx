// Minimal floating zoom/pan controls for the player map.
// Sits bottom-right of the canvas; does NOT use MapToolbar (DM-only).

export default function PlayerMapControls({ stageScale, setStageScale, setStagePos }) {
  function zoomIn() {
    setStageScale(prev => Math.min(prev * 1.2, 5))
  }

  function zoomOut() {
    setStageScale(prev => Math.max(prev / 1.2, 0.2))
  }

  function resetView() {
    setStageScale(1.0)
    setStagePos({ x: 0, y: 0 })
  }

  return (
    <div style={s.panel}>
      <button style={s.btn} onClick={zoomIn}  title="Zoom in">＋</button>
      <button style={s.btn} onClick={zoomOut} title="Zoom out">－</button>
      <button style={s.btn} onClick={resetView} title="Reset view">⌂</button>
      <span style={s.scaleLabel}>{Math.round(stageScale * 100)}%</span>
    </div>
  )
}

const s = {
  panel: {
    position:   'absolute',
    bottom:     16,
    right:      16,
    display:    'flex',
    flexDirection: 'column',
    gap:        4,
    background: 'rgba(13,10,5,0.88)',
    border:     '1px solid #3a2a10',
    borderRadius: 6,
    padding:    '0.4rem',
    zIndex:     10,
    boxShadow:  '0 2px 12px rgba(0,0,0,0.6)',
    alignItems: 'center',
  },
  btn: {
    background: 'transparent',
    border:     '1px solid #3a2a10',
    color:      '#a89060',
    borderRadius: 4,
    width:      36,
    height:     36,
    cursor:     'pointer',
    fontSize:   '1.1rem',
    display:    'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
    transition: 'border-color 0.15s, color 0.15s',
  },
  scaleLabel: {
    color:    '#6b5a3a',
    fontSize: '0.7rem',
    marginTop: 2,
  },
}
