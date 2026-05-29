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
}) {
  const [savingGrid, setSavingGrid] = useState(false)

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

  const tools = [
    { id: 'pan',      label: '🤚 Pan',        disabled: false },
    { id: 'fog',      label: '🌫️ Fog',        disabled: true,  title: 'Fog of War — Prompt 03' },
    { id: 'token',    label: '🪙 Token',       disabled: true,  title: 'Tokens — Prompt 04' },
  ]

  return (
    <div style={s.toolbar}>
      {/* ── Left: Tool buttons ─────────────────────────── */}
      <div style={s.section}>
        {tools.map(t => (
          <button
            key={t.id}
            style={activeTool === t.id ? { ...s.toolBtn, ...s.toolBtnActive } : s.toolBtn}
            onClick={() => !t.disabled && onToolChange(t.id)}
            disabled={t.disabled}
            title={t.title ?? t.label}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Center: Grid size control ──────────────────── */}
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
    borderColor: '#c9a84c',
    fontWeight: 'bold',
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
