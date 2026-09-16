import { useState } from 'react'
import { planGridChange, fogForGridChange } from '../../utils/mapGridUtils'
import { notifyError, notifySuccess, notifyInfo } from '../../stores/toastStore'
import EntityModal from '../world/EntityModal'

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
  // Grid change (Phase 8)
  imageSize,           // the loaded image, so the plan knows the real cell count
  getCurrentFog,       // () => the mask MapCanvas holds NOW, not the one saved at open
  cancelPendingFogSave,// () => drop a debounced fog save that would land after ours
}) {
  const [savingGrid,  setSavingGrid]  = useState(false)
  const [savingThumb, setSavingThumb] = useState(false)
  const [gridPlan,    setGridPlan]    = useState(null)   // non-null while the clear/keep dialog is open

  // The map as it is right now. `map.fog_data` is the mask as it was when the map
  // was OPENED — painting saves straight to the database without updating it —
  // so deciding from it would miss everything painted this session and clear
  // that fog without asking.
  function liveMap() {
    const fog = getCurrentFog?.()
    return Array.isArray(fog) ? { ...map, fog_data: fog } : map
  }

  async function handleSaveGridSize() {
    // An image map's cell count comes from the image. Until it has loaded, any
    // plan would be sized against the 3000px fallback and resample into the
    // wrong grid.
    if (map.image_path && !(imageSize?.width > 0)) {
      notifyInfo('The map image is still loading — try again in a moment.')
      return
    }
    const plan = planGridChange(liveMap(), imageSize, gridSize)
    if (!plan.changed) {
      notifyInfo(`Grid is already ${gridSize}px.`)
      return
    }
    if (plan.needsChoice) {
      setGridPlan(plan)   // the dialog calls commitGridChange with the DM's choice
      return
    }
    await commitGridChange(plan, null)
  }

  async function commitGridChange(plan, choice) {
    setGridPlan(null)
    setSavingGrid(true)
    try {
      // A debounced fog save still in flight would write the OLD-grid mask back
      // over this one half a second later.
      cancelPendingFogSave?.()
      const current = liveMap()
      const { fogData, fogCols } = fogForGridChange(plan, current.fog_data, choice)
      // Grid size, mask and fog_cols in one transaction: two separate writes could
      // leave a new grid with an old mask, which the player server fails closed on.
      await window.electronAPI.db.maps.saveGridChange(map.id, {
        grid_size: gridSize,
        fog_data:  fogData,
        fog_cols:  fogCols,
      })

      const kept = plan.needsChoice && choice === 'keep' && plan.keepable
      notifySuccess(
        !plan.needsChoice ? `Grid set to ${gridSize}px.`
          : kept ? `Grid set to ${gridSize}px. Fog kept and rescaled to ${plan.to.numCols}×${plan.to.numRows}.`
          : `Grid set to ${gridSize}px. Fog cleared.`)
      onSaveGridSize?.(gridSize, { fogData, fogCols })
    } catch (err) {
      notifyError(err, 'Save grid size')
    } finally {
      setSavingGrid(false)
    }
  }

  async function handleUpdateThumbnail() {
    setSavingThumb(true)
    try {
      await onUpdateThumbnail?.()
    } catch (err) {
      notifyError(err, 'Update thumbnail')
    } finally {
      setSavingThumb(false)
    }
  }

  const isFogTool = activeTool === 'fog-reveal' || activeTool === 'fog-hide'
  const isDm      = viewMode === 'dm'

  return (
    <div style={s.toolbar}>
      {gridPlan && (
        <EntityModal title="Grid changed — clear or keep fog?" isOpen onClose={() => setGridPlan(null)}>
          <div data-grid-change-dialog>
            <p style={s.dialogText}>{gridPlan.message}</p>
            <p style={s.dialogText}>
              <strong>Keep</strong> redraws the revealed area on the new grid, so what the party has
              seen stays where it was on the map. Edges may shift by up to one cell.
              {' '}<strong>Clear</strong> hides the whole map again.
            </p>
            {!gridPlan.keepable && (
              <p style={s.dialogWarn}>
                This map's saved fog no longer matches its own grid, so it cannot be rescaled — only cleared.
              </p>
            )}
            <div style={s.dialogFooter}>
              <button style={s.dialogPrimary} onClick={() => commitGridChange(gridPlan, 'keep')}
                disabled={!gridPlan.keepable}>
                Keep fog
              </button>
              <button style={s.dialogDanger} onClick={() => commitGridChange(gridPlan, 'clear')}>
                Clear fog
              </button>
              <button style={s.dialogSecondary} onClick={() => setGridPlan(null)}>Cancel</button>
            </div>
          </div>
        </EntityModal>
      )}
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
  dialogText:      { color: '#e8e0d0', fontSize: '0.88rem', lineHeight: 1.5, margin: '0 0 0.8rem' },
  dialogWarn:      { color: '#e0a050', fontSize: '0.82rem', margin: '0 0 0.8rem' },
  dialogFooter:    { display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', paddingTop: '0.75rem', borderTop: '1px solid #2a1c08' },
  dialogPrimary:   { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.1rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' },
  dialogDanger:    { background: 'transparent', color: '#e05050', border: '1px solid #6a2020', padding: '0.5rem 1.1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  dialogSecondary: { background: 'transparent', color: '#a89060', border: '1px solid #3a2a10', padding: '0.5rem 1.1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
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
