import { useState, useEffect, useCallback, useRef } from 'react'
import MapCanvas         from '../map/MapCanvas'
import PlayerMapControls from './PlayerMapControls'

const PLAYER_TOPBAR_H = 48

export default function PlayerMapView({ campaignId, broadcastMsg }) {
  // Map state
  const [activeMap,    setActiveMap]    = useState(null)
  const [maps,         setMaps]         = useState([])
  const [loading,      setLoading]      = useState(false)

  // Distance measurement — Shift+hover
  const [distLabel,    setDistLabel]    = useState(null)   // { x, y, text }
  const mapContainerRef = useRef(null)

  // Canvas / stage state — lifted so PlayerMapControls can drive zoom/reset
  const [stageScale,  setStageScale]  = useState(1.0)
  const [stagePos,    setStagePos]    = useState({ x: 0, y: 0 })
  const [canvasSize,  setCanvasSize]  = useState({
    width:  window.innerWidth,
    height: window.innerHeight - PLAYER_TOPBAR_H,
  })

  // Pulse animation state for the waiting icon
  const pulseRef  = useRef(null)
  const [pulse,   setPulse]  = useState(false)

  // ── Load all campaign maps (for waiting screen grid) ──────────────────────
  const loadMaps = useCallback(async () => {
    if (!campaignId) return
    setLoading(true)
    try {
      const data = await window.electronAPI.db.maps.getAll(campaignId)
      setMaps(data ?? [])
    } catch {
      setMaps([])
    }
    setLoading(false)
  }, [campaignId])

  useEffect(() => { loadMaps() }, [loadMaps])

  // ── Distance measurement: Shift+hover ─────────────────────────────────────
  useEffect(() => {
    if (!activeMap) return

    function onKeyUp(e)   { if (e.key === 'Shift') setDistLabel(null) }

    function onMouseMove(e) {
      if (!e.shiftKey) { setDistLabel(null); return }
      const rect = mapContainerRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = rect.left + rect.width  / 2
      const cy = rect.top  + rect.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const pixels     = Math.sqrt(dx * dx + dy * dy)
      const gridPx     = activeMap.grid_size ?? 50
      const squares    = pixels / gridPx
      const feet       = Math.round(squares * 5)
      setDistLabel({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: `${feet} ft` })
    }

    window.addEventListener('keyup', onKeyUp)
    const el = mapContainerRef.current
    if (el) el.addEventListener('mousemove', onMouseMove)

    return () => {
      window.removeEventListener('keyup', onKeyUp)
      if (el) el.removeEventListener('mousemove', onMouseMove)
    }
  }, [activeMap])

  // ── Waiting-screen pulse animation ────────────────────────────────────────
  useEffect(() => {
    if (activeMap) return  // don't run when map is showing
    pulseRef.current = setInterval(() => setPulse(p => !p), 1000)
    return () => clearInterval(pulseRef.current)
  }, [activeMap])

  // ── Broadcast handler: map:set and map:update ─────────────────────────────
  useEffect(() => {
    if (!broadcastMsg) return

    if (broadcastMsg.type === 'map:set') {
      window.electronAPI.db.maps.getById(broadcastMsg.payload.mapId).then(map => {
        if (map) {
          setActiveMap(map)
          setStageScale(1.0)
          setStagePos({ x: 0, y: 0 })
        }
      })
    }

    if (broadcastMsg.type === 'map:update' && activeMap) {
      if (broadcastMsg.payload.mapId === activeMap.id) {
        setActiveMap(prev => ({
          ...prev,
          fog_data: JSON.stringify(broadcastMsg.payload.fogData),
          tokens:   JSON.stringify(broadcastMsg.payload.tokens),
        }))
      }
    }
  }, [broadcastMsg, activeMap]) // eslint-disable-line react-hooks/exhaustive-deps
  // Note: activeMap in deps ensures fresh ID check on map:update.
  // map:set re-runs after activeMap changes but the redundant getById call is harmless.

  // ── Waiting screen ────────────────────────────────────────────────────────
  if (!activeMap) {
    return (
      <div style={s.waitRoot}>
        {/* Pulsing map icon */}
        <div style={{ ...s.waitIcon, transform: pulse ? 'scale(1.05)' : 'scale(1.0)', transition: 'transform 1s ease-in-out' }}>
          🗺️
        </div>
        <p style={s.waitTitle}>Waiting for the DM to share a map…</p>
        <p style={s.waitSub}>Your Dungeon Master will push a map when combat begins.</p>

        {/* Campaign maps read-only grid */}
        {maps.length > 0 && (
          <div style={s.mapsSection}>
            <p style={s.mapsSectionTitle}>Available Maps</p>
            <div style={s.mapsGrid}>
              {maps.map(m => (
                <div key={m.id} style={s.mapChip}>{m.name}</div>
              ))}
            </div>
          </div>
        )}

        {/* Refresh button */}
        <button
          style={s.refreshBtn}
          onClick={loadMaps}
          disabled={loading}
          title="Re-fetch maps in case the DM added one after this window opened"
        >
          {loading ? '↺ Loading…' : '↺ Refresh Maps'}
        </button>
      </div>
    )
  }

  // ── Active map view ───────────────────────────────────────────────────────
  return (
    <div style={s.mapRoot} ref={mapContainerRef}>
      <MapCanvas
        map={activeMap}
        mode="player"
        onFogChange={null}
        onTokensChange={null}
        stageScale={stageScale}
        stagePos={stagePos}
        setStageScale={setStageScale}
        setStagePos={setStagePos}
        activeTool="pan"
        fogBrushSize={1}
        gridSize={activeMap.grid_size}
        canvasSize={canvasSize}
        setCanvasSize={setCanvasSize}
        // No fog/thumbnail controls needed in player mode
        registerFogControls={null}
        registerThumbnailGen={null}
      />

      <PlayerMapControls
        stageScale={stageScale}
        setStageScale={setStageScale}
        setStagePos={setStagePos}
      />

      {/* Distance measurement label — appears near cursor when Shift held */}
      {distLabel && (
        <div style={{
          ...s.distLabel,
          left: distLabel.x + 12,
          top:  distLabel.y - 10,
        }}>
          {distLabel.text}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  // Waiting screen
  waitRoot: {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    height:         `calc(100vh - ${PLAYER_TOPBAR_H}px)`,
    gap:            '0.75rem',
    padding:        '2rem',
    background:     '#0d0a05',
  },
  waitIcon:  { fontSize: '4rem', lineHeight: 1, userSelect: 'none' },
  waitTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.4rem', margin: 0, textAlign: 'center' },
  waitSub:   { color: '#6b6b6b', fontSize: '0.9rem', margin: 0, textAlign: 'center' },

  mapsSection:      { marginTop: '1rem', textAlign: 'center', maxWidth: 480 },
  mapsSectionTitle: { color: '#a89060', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' },
  mapsGrid:         { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center' },
  mapChip:          { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 4, color: '#a89060', fontSize: '0.82rem', padding: '0.2rem 0.6rem' },

  refreshBtn: {
    marginTop:  '1.5rem',
    background: 'transparent',
    border:     '1px solid #3a2a10',
    color:      '#a89060',
    borderRadius: 4,
    padding:    '0.4rem 1rem',
    cursor:     'pointer',
    fontSize:   '0.85rem',
  },

  // Active map
  mapRoot: {
    position:  'relative',
    width:     '100%',
    height:    `calc(100vh - ${PLAYER_TOPBAR_H}px)`,
    overflow:  'hidden',
    background: '#0d0a05',
  },

  distLabel: {
    position:    'absolute',
    pointerEvents: 'none',
    background:  'rgba(13,10,5,0.85)',
    border:      '1px solid #c9a84c',
    borderRadius: 4,
    color:       '#c9a84c',
    fontSize:    '0.82rem',
    fontWeight:  700,
    padding:     '2px 6px',
    zIndex:      30,
    whiteSpace:  'nowrap',
    userSelect:  'none',
  },
}
