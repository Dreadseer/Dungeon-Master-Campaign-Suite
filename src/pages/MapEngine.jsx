import { useState, useEffect, useCallback } from 'react'
import useCampaignStore from '../stores/campaignStore'
import EntityModal from '../components/world/EntityModal'
import Skeleton from '../components/ui/Skeleton'
import MapCanvas from '../components/map/MapCanvas'
import MapToolbar from '../components/map/MapToolbar'

const SIDEBAR_W    = 240
const TOPBAR_H     = 56
const MAPTOOLBAR_H = 46

export default function MapEngine() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  // ── View A state ───────────────────────────────────────────────────
  const [maps, setMaps]           = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading]     = useState(true)
  const [activeMap, setActiveMap] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  // Form state
  const [form, setForm]           = useState({ name: '', location_id: null, grid_size: 50 })
  const [chosenImagePath, setChosenImagePath] = useState(null)
  const [imagePreview, setImagePreview]       = useState(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  // Thumbnails: { mapId: base64 | null }
  const [thumbnails, setThumbnails] = useState({})

  // ── View B (canvas) lifted state ───────────────────────────────────
  const [stageScale,   setStageScale]   = useState(1.0)
  const [stagePos,     setStagePos]     = useState({ x: 0, y: 0 })
  const [activeTool,   setActiveTool]   = useState('pan')
  const [currentGridSize, setCurrentGridSize] = useState(50)    // live toolbar value
  const [canvasSize,   setCanvasSize]   = useState({
    width:  window.innerWidth  - SIDEBAR_W,
    height: window.innerHeight - TOPBAR_H - MAPTOOLBAR_H,
  })

  // ── Reset canvas state when a new map is opened ────────────────────
  function openMap(map) {
    setActiveMap(map)
    setStageScale(1.0)
    setStagePos({ x: 0, y: 0 })
    setActiveTool('pan')
    setCurrentGridSize(map.grid_size || 50)
  }

  // ── Data loading ───────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!activeCampaign?.id) return
    setLoading(true)
    const [m, l] = await Promise.all([
      window.electronAPI.db.maps.getAll(activeCampaign.id),
      window.electronAPI.db.locations.getAll(activeCampaign.id),
    ])
    setMaps(m)
    setLocations(l)
    setLoading(false)

    // Load thumbnails for all maps
    const thumbEntries = await Promise.all(
      m.map(async map => [map.id, await window.electronAPI.file.readThumbnail(map.id)])
    )
    setThumbnails(Object.fromEntries(thumbEntries))
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  // ── Modal helpers ──────────────────────────────────────────────────
  function openCreate() {
    setForm({ name: '', location_id: null, grid_size: 50 })
    setChosenImagePath(null)
    setImagePreview(null)
    setError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setChosenImagePath(null)
    setImagePreview(null)
    setError('')
  }

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleChooseImage() {
    const sourcePath = await window.electronAPI.file.openImageDialog()
    if (!sourcePath) return
    setChosenImagePath(sourcePath)
    const base64 = await window.electronAPI.file.readImageAsBase64(sourcePath)
    setImagePreview(base64)
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Map name is required.'); return }
    setSaving(true)

    let storedImagePath = null
    if (chosenImagePath) {
      storedImagePath = await window.electronAPI.file.copyMapImage(chosenImagePath)
    }

    await window.electronAPI.db.maps.create({
      campaign_id: activeCampaign.id,
      name:        form.name.trim(),
      location_id: form.location_id || null,
      grid_size:   Number(form.grid_size) || 50,
      image_path:  storedImagePath,
    })

    setSaving(false)
    load()
    closeModal()
  }

  async function handleDelete(map) {
    await window.electronAPI.db.maps.delete(map.id)
    if (activeMap?.id === map.id) setActiveMap(null)
    load()
  }

  // ── View B — Canvas ────────────────────────────────────────────────
  if (activeMap) {
    return (
      <div style={s.viewB}>
        <MapToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          gridSize={currentGridSize}
          onGridSizeChange={setCurrentGridSize}
          mapName={activeMap.name}
          onBack={() => { setActiveMap(null); load() }}
          stageScale={stageScale}
          onResetView={() => { setStageScale(1.0); setStagePos({ x: 0, y: 0 }) }}
          onSaveGridSize={(gs) => {
            // Reflect saved grid size back into the activeMap record
            setActiveMap(prev => ({ ...prev, grid_size: gs }))
          }}
          map={activeMap}
        />
        <MapCanvas
          map={activeMap}
          mode="dm"
          onFogChange={null}
          onTokensChange={null}
          stageScale={stageScale}
          stagePos={stagePos}
          setStageScale={setStageScale}
          setStagePos={setStagePos}
          activeTool={activeTool}
          gridSize={currentGridSize}
          canvasSize={canvasSize}
          setCanvasSize={setCanvasSize}
        />
      </div>
    )
  }

  // ── View A — Map List ──────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Maps</h1>
          <p style={s.count}>{maps.length} map{maps.length !== 1 ? 's' : ''}</p>
        </div>
        <button style={s.btnPrimary} onClick={openCreate}>+ New Map</button>
      </div>

      {loading ? (
        <Skeleton count={3} height="7rem" />
      ) : maps.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No maps yet. Create your first battle map.</p>
          <button style={s.btnPrimary} onClick={openCreate}>+ New Map</button>
        </div>
      ) : (
        <div style={s.grid}>
          {maps.map(map => {
            const thumb = thumbnails[map.id]
            const tokenCount = (() => { try { return JSON.parse(map.tokens || '[]').length } catch { return 0 } })()
            const fogArr     = (() => { try { return JSON.parse(map.fog_data || '[]') } catch { return [] } })()
            const fogPct     = fogArr.length ? Math.round(fogArr.filter(Boolean).length / fogArr.length * 100) : null

            return (
              <div key={map.id} style={s.card}>
                <div style={s.thumbWrap}>
                  {thumb
                    ? <img src={thumb} alt={map.name} style={s.thumb} />
                    : map.image_path
                      ? <ImageThumb imagePath={map.image_path} />
                      : <div style={s.thumbPlaceholder}>🗺</div>
                  }
                </div>

                <div style={s.cardBody}>
                  <div style={s.cardHeader}>
                    <span style={s.mapName}>{map.name}</span>
                    {map.location_name && (
                      <span style={s.locBadge}>{map.location_name}</span>
                    )}
                  </div>

                  <div style={s.cardMeta}>
                    <span style={s.metaItem}>Grid: {map.grid_size}px</span>
                    {tokenCount > 0 && <span style={s.metaItem}>{tokenCount} token{tokenCount !== 1 ? 's' : ''}</span>}
                    {fogPct !== null && <span style={s.metaItem}>{fogPct}% revealed</span>}
                    <span style={s.metaDate}>{new Date(map.created_at).toLocaleDateString()}</span>
                  </div>

                  <div style={s.cardActions}>
                    <button style={s.btnPrimary} onClick={() => openMap(map)}>Open Map</button>
                    <DeleteBtn onConfirm={() => handleDelete(map)} name={map.name} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Map modal */}
      <EntityModal title="New Map" isOpen={modalOpen} onClose={closeModal}>
        <form onSubmit={handleCreate}>
          <label style={s.label}>Map Name *</label>
          <input style={s.input} value={form.name} onChange={e => setField('name', e.target.value)}
            placeholder="Riverdale Town Square" autoFocus />
          {error && <p style={s.err}>{error}</p>}

          <label style={s.label}>Link to Location (optional)</label>
          <select style={s.input} value={form.location_id ?? ''}
            onChange={e => setField('location_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">No location linked</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>

          <label style={s.label}>Grid Cell Size (pixels)</label>
          <input style={s.input} type="number" min={20} max={100} value={form.grid_size}
            onChange={e => setField('grid_size', e.target.value)} />

          <label style={s.label}>Background Image</label>
          <div style={s.imageRow}>
            <button style={s.btnSecondary} type="button" onClick={handleChooseImage}>
              Choose Image…
            </button>
            {chosenImagePath && (
              <span style={s.filename}>
                {chosenImagePath.split(/[/\\]/).pop()}
              </span>
            )}
          </div>
          {imagePreview && (
            <img src={imagePreview} alt="Preview" style={s.imagePreview} />
          )}

          <div style={s.footer}>
            <button style={s.btnPrimary} type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create Map'}
            </button>
            <button style={s.btnSecondary} type="button" onClick={closeModal}>Cancel</button>
          </div>
        </form>
      </EntityModal>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function ImageThumb({ imagePath }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    window.electronAPI.file.readImageAsBase64(imagePath).then(setSrc)
  }, [imagePath])
  if (!src) return <div style={s.thumbPlaceholder}>⏳</div>
  return <img src={src} alt="map" style={s.thumb} />
}

function DeleteBtn({ onConfirm, name }) {
  const [confirm, setConfirm] = useState(false)
  if (confirm) return (
    <span style={{ fontSize: '0.78rem' }}>
      <span style={{ color: '#a89060' }}>Delete {name}? </span>
      <button style={db.yes} onClick={onConfirm}>Yes</button>
      <button style={db.no}  onClick={() => setConfirm(false)}>No</button>
    </span>
  )
  return <button style={db.del} onClick={() => setConfirm(true)}>Delete</button>
}
const db = {
  yes: { background: 'none', border: 'none', color: '#e05050', cursor: 'pointer', fontSize: '0.78rem', marginRight: '0.3rem' },
  no:  { background: 'none', border: 'none', color: '#a89060', cursor: 'pointer', fontSize: '0.78rem' },
  del: { background: 'none', border: '1px solid #6a2020', color: '#c06060', borderRadius: 3, padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.78rem' },
}

const s = {
  // View B — escape main-content's 2rem padding so canvas fills edge-to-edge
  viewB: {
    margin: '-2rem',                       // cancel main-content padding: 2rem
    height: 'calc(100vh - 56px)',          // fill from below topbar to window bottom
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#0d0a05',
  },

  // View A
  page:        { padding: '2rem', maxWidth: 900 },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  title:       { color: '#c9a84c', fontSize: '1.6rem', margin: 0, fontFamily: 'Georgia, serif' },
  count:       { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.2rem 0 0' },
  empty:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, gap: '1rem' },
  emptyText:   { color: '#6b5a3a', fontSize: '1rem' },

  grid:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' },
  card:        { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 8, overflow: 'hidden' },
  thumbWrap:   { height: 120, background: '#0a0805', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb:       { width: '100%', height: '100%', objectFit: 'cover' },
  thumbPlaceholder: { fontSize: '2.5rem', color: '#3a2a10' },
  cardBody:    { padding: '0.85rem' },
  cardHeader:  { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' },
  mapName:     { color: '#e8e0d0', fontSize: '0.95rem', fontWeight: 600, flex: 1 },
  locBadge:    { background: '#1a2a1a', color: '#5a9a5a', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 3 },
  cardMeta:    { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.7rem' },
  metaItem:    { color: '#6b5a3a', fontSize: '0.75rem' },
  metaDate:    { color: '#4a3a1a', fontSize: '0.72rem', marginLeft: 'auto' },
  cardActions: { display: 'flex', gap: '0.5rem', alignItems: 'center' },

  // Modal
  label:       { display: 'block', color: '#a89060', fontSize: '0.82rem', marginBottom: '0.35rem' },
  input:       { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.9rem', marginBottom: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  imageRow:    { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' },
  filename:    { color: '#a89060', fontSize: '0.82rem', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 },
  imagePreview:{ display: 'block', width: '100%', maxHeight: 140, objectFit: 'contain', borderRadius: 4, marginBottom: '0.9rem', border: '1px solid #3a2a10' },
  footer:      { display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', paddingTop: '0.75rem', borderTop: '1px solid #2a1c08', marginTop: '0.5rem' },
  err:         { color: '#e05050', fontSize: '0.82rem', marginTop: '-0.6rem', marginBottom: '0.75rem' },
  btnPrimary:  { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },
}
