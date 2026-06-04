import { useState } from 'react'

export default function MapToolbar({
  activeTool,
  onToolChange,
  gridSize,
  onGridSizeChange,
  mapName,
  onBack,
  stageScale,
  onResetView,
  onSaveGridSize,
  map,
  // Fog of War
  fogBrushSize,
  onFogBrushSizeChange,
  onRevealAll,
  onHideAll,
  // View mode
  viewMode,
  onViewModeChange,
  onUpdateThumbnail,
}) {
  const [savingGrid,  setSavingGrid]  = useState(false)
  const [savingThumb, setSavingThumb] = useState(false)

  async function handleSaveGridSize() {
    setSavingGrid(true)
    await window.electronAPI.db.maps.update(map.id, {
      name:        map.name,
      location_id: map.location_id ?? null,
      grid_size:   gridSize,
    })
    setSavingGrid(false)
    onSaveGridSize?.(gridSize)
  }

  async function handleUpdateThumbnail() {
    setSavingThumb(true)
    await onUpdateThumbnail?.()
    setSavingThumb(false)
  }

  const isFogTool = activeTool === 'fog-reveal' || activeTool === 'fog-hide'
  const isDm      = viewMode === 'dm'

  return (
    <div style={s.toolbar}>
      {/* ── DM / Player mode toggle ────────────────────── */}
      <div style={s.section}>
        <button
          style={isDm ? { ...s.modeBtn, ...s.modeBtnDm } : s.modeBtn}
          onClick={() => onViewModeChange?.('dm')}
          title="DM mode — full editing access"
        >
          🎲 DM
        </button>
        <button
          style={!isDm ? { ...s.modeBtn, ...s.modeBtnPlayer } : s.modeBtn}
          onClick={() => onViewModeChange?.('player')}
          title="Player view — restricted, fog fully opaque"
        >
          👁 Player
        </button>
      </div>

      {/* ── Left: Tool buttons (DM only) ──────────────── */}
      {isDm && (
        <div style={s.section}>
          <button
            style={activeTool === 'pan' ? { ...s.toolBtn, ...s.toolBtnActive } : s.toolBtn}
            onClick={() => onToolChange('pan')}
            title="Pan / Navigate"
          >
            🤚 Pan
          </button>
          <button
            style={activeTool === 'fog-reveal' ? { ...s.toolBtn, ...s.toolBtnActive } : s.toolBtn}
            onClick={() => onToolChange('fog-reveal')}
            title="Fog Reveal — paint to uncover"
          >
            🌟 Reveal
          </button>
          <button
            style={activeTool === 'fog-hide' ? { ...s.toolBtn, ...s.toolBtnActive } : s.toolBtn}
            onClick={() => onToolChange('fog-hide')}
            title="Fog Hide — paint to cover"
          >
            🌫️ Hide
          </button>
          <button
            style={activeTool === 'token' ? { ...s.toolBtn, ...s.toolBtnActive } : s.toolBtn}
            onClick={() => onToolChange('token')}
            title="Token tool — double-click to place, drag to move"
          >
            🪙 Token
          </button>
        </div>
      )}

      {/* Token tool hint (DM only) */}
      {isDm && activeTool === 'token' && (
        <div style={s.section}>
          <span style={s.hint}>Double-click to place · Click to select · Drag to move</span>
        </div>
      )}

      {/* ── Fog controls (DM only, visible when a fog tool is active) ── */}
      {isDm && isFogTool && (
        <div style={s.section}>
          <span style={s.label}>Brush</span>
          {[1, 3, 5].map(size => (
            <button
              key={size}
              style={fogBrushSize === size
                ? { ...s.brushBtn, ...s.brushBtnActive }
                : s.brushBtn}
              onClick={() => onFogBrushSizeChange(size)}
              title={`${size}×${size} brush`}
            >
              {size === 1 ? '1×1' : size === 3 ? '3×3' : '5×5'}
            </button>
          ))}
          <button style={s.fogActionBtn} onClick={onRevealAll} title="Reveal entire map">
            Reveal All
          </button>
          <button style={s.fogActionBtn} onClick={onHideAll} title="Hide entire map">
            Hide All
          </button>
        </div>
      )}

      {/* ── Center: Grid size control (DM only) ───────── */}
      {isDm && (
        <div style={s.section}>
          <span style={s.label}>Grid</span>
          <button style={s.nudgeBtn}
            onClick={() => onGridSizeChange(Math.max(20, gridSize - 5))}
            title="Decrease grid size"
          >−</button>
          <span style={s.gridVal}>{gridSize}px</span>
          <button style={s.nudgeBtn}
            onClick={() => onGridSizeChange(Math.min(100, gridSize + 5))}
            title="Increase grid size"
          >+</button>
          <button style={s.saveBtn} onClick={handleSaveGridSize} disabled={savingGrid}>
            {savingGrid ? '…' : 'Save'}
          </button>
        </div>
      )}

      {/* ── Thumbnail (DM only) ────────────────────────── */}
      {isDm && (
        <div style={s.section}>
          <button style={s.thumbBtn} onClick={handleUpdateThumbnail} disabled={savingThumb}
            title="Capture current view as map thumbnail">
            {savingThumb ? '…' : '📷 Thumbnail'}
          </button>
        </div>
      )}

      {/* ── Center-right: Zoom control ─────────────────── */}
      <div style={s.section}>
        <span style={s.label}>Zoom</span>
        <span style={s.zoomVal}>{Math.round(stageScale * 100)}%</span>
        <button style={s.resetBtn} onClick={onResetView} title="Reset to 100% at origin">
          Reset View
        </button>
      </div>

      {/* ── Right: Map name + back button ─────────────── */}
      <div style={{ ...s.section, marginLeft: 'auto' }}>
        {!isDm && <span style={s.playerBadge}>👁 Player View</span>}
        {map?.location_name && (
          <span style={s.locBadge}>{map.location_name}</span>
        )}
        <span style={s.mapName}>{mapName}</span>
        <button style={s.backBtn} onClick={onBack}>← Maps</button>
      </div>
    </div>
  )
}

const s = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.35rem 0.75rem',
    background: '#0d0a05',
    borderBottom: '1px solid #2a1c08',
    height: 46,
    boxSizing: 'border-box',
    flexShrink: 0,
    overflowX: 'auto',
  },
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    paddingRight: '0.75rem',
    borderRight: '1px solid #2a1c08',
    marginRight: '0.25rem',
  },
  label: {
    color: '#6b5a3a',
    fontSize: '0.72rem',
    marginRight: 2,
  },
  toolBtn: {
    background: 'transparent',
    border: '1px solid #3a2a10',
    color: '#a89060',
    borderRadius: 4,
    padding: '0.25rem 0.55rem',
    cursor: 'pointer',
    fontSize: '0.78rem',
    whiteSpace: 'nowrap',
  },
  toolBtnActive: {
    background: '#c9a84c',
    color: '#0d0a05',
    border: '1px solid #c9a84c',
    fontWeight: 'bold',
  },
  brushBtn: {
    background: 'transparent',
    border: '1px solid #3a2a10',
    color: '#a89060',
    borderRadius: 3,
    padding: '0.18rem 0.45rem',
    cursor: 'pointer',
    fontSize: '0.72rem',
    whiteSpace: 'nowrap',
  },
  brushBtnActive: {
    background: '#3a2a10',
    color: '#c9a84c',
    border: '1px solid #c9a84c',
  },
  fogActionBtn: {
    background: 'transparent',
    border: '1px solid #3a2a10',
    color: '#a89060',
    borderRadius: 3,
    padding: '0.18rem 0.5rem',
    cursor: 'pointer',
    fontSize: '0.72rem',
    whiteSpace: 'nowrap',
  },
  nudgeBtn: {
    background: 'transparent',
    border: '1px solid #3a2a10',
    color: '#a89060',
    borderRadius: 3,
    width: 22,
    height: 22,
    cursor: 'pointer',
    fontSize: '0.9rem',
    lineHeight: '1',
    padding: 0,
    textAlign: 'center',
  },
  gridVal: {
    color: '#e8e0d0',
    fontSize: '0.82rem',
    minWidth: 38,
    textAlign: 'center',
  },
  saveBtn: {
    background: 'transparent',
    border: '1px solid #a89060',
    color: '#a89060',
    borderRadius: 3,
    padding: '0.18rem 0.5rem',
    cursor: 'pointer',
    fontSize: '0.72rem',
  },
  zoomVal: {
    color: '#e8e0d0',
    fontSize: '0.82rem',
    minWidth: 38,
    textAlign: 'center',
  },
  resetBtn: {
    background: 'transparent',
    border: '1px solid #3a2a10',
    color: '#a89060',
    borderRadius: 3,
    padding: '0.18rem 0.5rem',
    cursor: 'pointer',
    fontSize: '0.72rem',
  },
  mapName: {
    color: '#c9a84c',
    fontFamily: 'Georgia, serif',
    fontSize: '0.9rem',
    fontWeight: 600,
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  locBadge: {
    background: '#1a2a1a',
    color: '#5a9a5a',
    fontSize: '0.68rem',
    padding: '0.1rem 0.35rem',
    borderRadius: 3,
  },
  hint: {
    color:     '#6b5a3a',
    fontSize:  '0.72rem',
    fontStyle: 'italic',
    whiteSpace: 'nowrap',
  },
  modeBtn: {
    background:  'transparent',
    border:      '1px solid #3a2a10',
    color:       '#a89060',
    borderRadius: 4,
    padding:     '0.25rem 0.55rem',
    cursor:      'pointer',
    fontSize:    '0.78rem',
    whiteSpace:  'nowrap',
  },
  modeBtnDm: {
    background:  '#1a1208',
    border:      '1px solid #c9a84c',
    color:       '#c9a84c',
    fontWeight:  'bold',
  },
  modeBtnPlayer: {
    background:  '#0a1a0a',
    border:      '1px solid #5a9a5a',
    color:       '#5a9a5a',
    fontWeight:  'bold',
  },
  thumbBtn: {
    background:  'transparent',
    border:      '1px solid #3a2a10',
    color:       '#a89060',
    borderRadius: 3,
    padding:     '0.18rem 0.5rem',
    cursor:      'pointer',
    fontSize:    '0.72rem',
    whiteSpace:  'nowrap',
  },
  playerBadge: {
    background:  '#0a1a0a',
    border:      '1px solid #5a9a5a',
    color:       '#5a9a5a',
    fontSize:    '0.72rem',
    padding:     '0.1rem 0.4rem',
    borderRadius: 3,
    fontWeight:  'bold',
  },
  backBtn: {
    background: 'none',
    border: '1px solid #3a2a10',
    color: '#a89060',
    padding: '0.25rem 0.65rem',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.8rem',
    whiteSpace: 'nowrap',
  },
}
