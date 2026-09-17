// Generate a dungeon map — the "party went off-book" button.
//
// Everything runs in the renderer and offline: src/utils/dungeonGen.js builds
// the cells from a seed, paints them onto a canvas, and the canvas becomes the
// map's image. No AI, no network, and the same parameters always give the same
// picture, which is why they are stored on the map (generated_params) — Re-roll
// and Tweak on the map card reopen this modal from them.
//
// Saving always creates a NEW map. Re-rolling over an existing map would throw
// away its image, fog and tokens; a DM who wants the old one gone can delete it.
import { useState, useMemo, useEffect, useRef } from 'react'
import { Stage, Layer, Image as KonvaImage } from 'react-konva'
import EntityModal from '../world/EntityModal'
import {
  SIZE_PRESETS, DENSITIES, THEMES, LIMITS, DEFAULT_PARAMS, GENERATED_GRID_SIZE,
  normaliseParams, generateDungeon, paintDungeon, dungeonImageSize, describeDungeon,
  buildDungeonParams, randomSeed,
} from '../../utils/dungeonGen'
import { notifyError, notifySuccess } from '../../stores/toastStore'

const PREVIEW_W = 500
const PREVIEW_H = 340

function sizeKeyFor(params) {
  const match = Object.entries(SIZE_PRESETS).find(([, v]) => v.cols === params.cols && v.rows === params.rows)
  return match ? match[0] : 'custom'
}

/** Paint a dungeon onto a fresh canvas at `gridSize` px per square. */
function renderToCanvas(dungeon, gridSize) {
  const { width, height } = dungeonImageSize(dungeon, gridSize)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  paintDungeon(canvas.getContext('2d'), dungeon, gridSize)
  return canvas
}

export default function MapGeneratorModal({
  isOpen,
  onClose,
  campaignId,
  locations = [],
  initial = null,     // { params, name, location_id } to Re-roll or Tweak from
  onSaved,            // (mapId) => void
}) {
  const [params, setParams]         = useState(DEFAULT_PARAMS)
  const [sizeKey, setSizeKey]       = useState('medium')
  const [seedText, setSeedText]     = useState(String(DEFAULT_PARAMS.seed))
  const [name, setName]             = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [locationId, setLocationId] = useState(null)
  const [saving, setSaving]         = useState(false)

  // Reset from `initial` each time the modal opens.
  useEffect(() => {
    if (!isOpen) return
    const p = normaliseParams(initial?.params ?? DEFAULT_PARAMS)
    setParams(p)
    setSizeKey(sizeKeyFor(p))
    setSeedText(String(p.seed))
    setName(initial?.name ?? '')
    setNameTouched(!!initial?.name)
    setLocationId(initial?.location_id ?? null)
  }, [isOpen, initial])

  const dungeon = useMemo(() => generateDungeon(params), [params])

  // Preview: painted small (8px a square) and scaled to fit the stage.
  const previewCanvas = useMemo(() => renderToCanvas(dungeon, 8), [dungeon])
  const fit = Math.min(PREVIEW_W / previewCanvas.width, PREVIEW_H / previewCanvas.height)

  const defaultName = `Dungeon (seed ${params.seed})`
  const finalName = (nameTouched ? name : defaultName).trim()

  function update(patch) {
    setParams(prev => normaliseParams({ ...prev, ...patch }))
  }

  function chooseSize(key) {
    setSizeKey(key)
    if (SIZE_PRESETS[key]) update(SIZE_PRESETS[key])
  }

  function applySeed(text) {
    setSeedText(text)
    // Only a usable seed changes the preview; a half-typed one leaves it alone.
    if (text.trim() !== '') update({ seed: text })
  }

  function reroll() {
    const seed = randomSeed()
    setSeedText(String(seed))
    update({ seed })
  }

  const savingRef = useRef(false)
  async function handleGenerate() {
    if (savingRef.current) return
    if (!finalName) { notifyError(new Error('Give the map a name.'), 'Generate map'); return }
    savingRef.current = true
    setSaving(true)
    try {
      // Full size: one dungeon square is exactly one map grid square, so fog,
      // token snapping and measurement line up with the walls.
      const canvas = renderToCanvas(dungeon, GENERATED_GRID_SIZE)
      const imagePath = await window.electronAPI.file.saveMapImage(canvas.toDataURL('image/png'))
      const result = await window.electronAPI.db.maps.create({
        campaign_id:      campaignId,
        name:             finalName,
        location_id:      locationId || null,
        image_path:       imagePath,
        grid_size:        GENERATED_GRID_SIZE,
        fog_cols:         dungeon.cols,
        feet_per_cell:    5,
        generated_params: buildDungeonParams(params, GENERATED_GRID_SIZE),
      })
      notifySuccess(`Generated "${finalName}" — ${describeDungeon(dungeon)}.`)
      onSaved?.(Number(result.lastInsertRowid))
      onClose?.()
    } catch (err) {
      notifyError(err, 'Generate map')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <EntityModal title={initial ? 'Re-roll / tweak dungeon' : 'Generate a dungeon'} isOpen onClose={onClose}>
      <div data-map-generator>
        <div style={s.preview}>
          <Stage width={PREVIEW_W} height={PREVIEW_H}>
            <Layer listening={false}>
              <KonvaImage
                image={previewCanvas}
                x={(PREVIEW_W - previewCanvas.width * fit) / 2}
                y={(PREVIEW_H - previewCanvas.height * fit) / 2}
                scaleX={fit}
                scaleY={fit}
              />
            </Layer>
          </Stage>
        </div>
        <p style={s.caption} data-generator-summary>{describeDungeon(dungeon)}</p>

        <label style={s.label}>Map name</label>
        <input style={s.input} value={nameTouched ? name : defaultName} data-field="gen-name"
          onChange={e => { setNameTouched(true); setName(e.target.value) }} />

        <div style={s.row}>
          <div style={s.col}>
            <label style={s.label}>Size</label>
            <select style={s.input} value={sizeKey} onChange={e => chooseSize(e.target.value)}>
              {Object.entries(SIZE_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)} ({v.cols}×{v.rows})</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>
          <div style={s.col}>
            <label style={s.label}>Room density</label>
            <select style={s.input} value={params.density} onChange={e => update({ density: e.target.value })}>
              {Object.entries(DENSITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>

        {sizeKey === 'custom' && (
          <div style={s.row}>
            <div style={s.col}>
              <label style={s.label}>Width ({LIMITS.minCols}–{LIMITS.maxCols} squares)</label>
              <input style={s.input} type="number" min={LIMITS.minCols} max={LIMITS.maxCols} defaultValue={params.cols}
                onBlur={e => update({ cols: e.target.value })} />
            </div>
            <div style={s.col}>
              <label style={s.label}>Height ({LIMITS.minRows}–{LIMITS.maxRows} squares)</label>
              <input style={s.input} type="number" min={LIMITS.minRows} max={LIMITS.maxRows} defaultValue={params.rows}
                onBlur={e => update({ rows: e.target.value })} />
            </div>
          </div>
        )}

        <div style={s.row}>
          <div style={s.col}>
            <label style={s.label}>Corridor width</label>
            <select style={s.input} value={params.corridorWidth} onChange={e => update({ corridorWidth: e.target.value })}>
              {[1, 2, 3].map(w => <option key={w} value={w}>{w} square{w > 1 ? 's' : ''}</option>)}
            </select>
          </div>
          <div style={s.col}>
            <label style={s.label}>Theme</label>
            <select style={s.input} value={params.theme} onChange={e => update({ theme: e.target.value })}>
              {Object.entries(THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>

        <div style={s.row}>
          <div style={s.col}>
            <label style={s.label}>Seed — a number or any word</label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input style={{ ...s.input, marginBottom: 0 }} value={seedText} data-field="gen-seed"
                onChange={e => applySeed(e.target.value)} />
              <button type="button" style={s.btnSecondary} onClick={reroll} title="New random seed">🎲 Re-roll</button>
            </div>
          </div>
          <div style={s.col}>
            <label style={s.label}>Location (optional)</label>
            <select style={s.input} value={locationId ?? ''}
              onChange={e => setLocationId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">No location linked</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <p style={s.note}>
          Squares are 5 ft and the grid is set to match the walls. The seed and settings are saved
          with the map, so it can be re-rolled or tweaked later.
        </p>

        <div style={s.footer}>
          <button type="button" style={s.btnPrimary} onClick={handleGenerate} disabled={saving} data-generate>
            {saving ? 'Generating…' : 'Generate'}
          </button>
          <button type="button" style={s.btnSecondary} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </EntityModal>
  )
}

const s = {
  preview:  { background: '#0a0805', border: '1px solid #3a2a10', borderRadius: 4, marginBottom: '0.4rem', display: 'flex', justifyContent: 'center' },
  caption:  { color: '#a89060', fontSize: '0.78rem', margin: '0 0 0.9rem', textAlign: 'center' },
  row:      { display: 'flex', gap: '0.75rem' },
  col:      { flex: 1, minWidth: 0 },
  label:    { display: 'block', color: '#a89060', fontSize: '0.8rem', marginBottom: '0.3rem' },
  input:    { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.4rem 0.6rem', fontSize: '0.88rem', marginBottom: '0.8rem', outline: 'none', boxSizing: 'border-box' },
  note:     { color: '#6b5a3a', fontSize: '0.76rem', margin: '0.2rem 0 0.6rem' },
  footer:   { display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', paddingTop: '0.75rem', borderTop: '1px solid #2a1c08' },
  btnPrimary:   { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary: { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap' },
}
