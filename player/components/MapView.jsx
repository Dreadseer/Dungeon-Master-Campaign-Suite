import { useEffect, useRef, useState, useCallback } from 'react'

export default function MapView({ map }) {
  const canvasRef = useRef(null)
  const imgRef    = useRef(null)
  const [status,   setStatus]   = useState('waiting')
  const [errorMsg, setErrorMsg] = useState('')
  const [offset,   setOffset]   = useState({ x: 0, y: 0 })
  const [scale,    setScale]    = useState(1)

  // Mutable ref so touch/wheel handlers never have stale closures
  const viewRef = useRef({ offset: { x: 0, y: 0 }, scale: 1 })
  useEffect(() => { viewRef.current = { offset, scale } }, [offset, scale])

  const gesture = useRef(null)
  // { type:'pan',   startX, startY, originX, originY }
  // { type:'pinch', dist, midX, midY, originScale, originOffX, originOffY }

  // ── Draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img || !img.complete) return

    const ctx      = canvas.getContext('2d')
    const fogData  = (() => { try { return JSON.parse(map?.fog_data ?? '[]') } catch { return [] } })()
    const tokens   = (() => { try { return JSON.parse(map?.tokens   ?? '[]') } catch { return [] } })()
    const gridSize = map?.grid_size ?? 50
    const numCols  = Math.ceil(img.naturalWidth  / gridSize)

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // ── Map + fog + token circles (all in map-space) ──────────────────────
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(scale, scale)

    ctx.drawImage(img, 0, 0)

    if (fogData.length > 0) {
      const numRows = Math.ceil(img.naturalHeight / gridSize)
      ctx.fillStyle = 'rgba(0,0,0,0.88)'
      for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {
          if (fogData[row * numCols + col] !== true) {
            ctx.fillRect(col * gridSize, row * gridSize, gridSize, gridSize)
          }
        }
      }
    }

    // Collect visible tokens while drawing circles
    const visibleTokens = []
    tokens.forEach(token => {
      const col = token.col ?? 0
      const row = token.row ?? 0
      if (fogData.length > 0 && fogData[row * numCols + col] !== true) return

      const cx    = col * gridSize + gridSize / 2
      const cy    = row * gridSize + gridSize / 2
      const r     = (gridSize / 2) * 0.8
      const color = token.color ?? '#e74c3c'

      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle   = color
      ctx.globalAlpha = 0.85
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#fff'
      ctx.lineWidth   = Math.max(1, 1.5 / scale)
      ctx.stroke()

      if (token.label) {
        visibleTokens.push({
          name: token.label,
          // Convert to screen-space for the label pass
          sx: offset.x + cx * scale,
          sy: offset.y + cy * scale,
        })
      }
    })

    ctx.restore()

    // ── Token labels — drawn in screen-space so they're always readable ───
    if (visibleTokens.length > 0) {
      ctx.save()
      ctx.font         = 'bold 11px Arial'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      visibleTokens.forEach(({ name, sx, sy }) => {
        const label = name.slice(0, 10)
        const tw    = ctx.measureText(label).width
        // Dark pill behind text for legibility on any map
        ctx.fillStyle = 'rgba(0,0,0,0.65)'
        ctx.beginPath()
        ctx.roundRect(sx - tw / 2 - 3, sy - 7, tw + 6, 14, 3)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.fillText(label, sx, sy)
      })
      ctx.restore()
    }
  }, [map, offset, scale])

  // ── Load image when map ID changes ───────────────────────────────────────
  useEffect(() => {
    if (!map) { setStatus('waiting'); return }
    setStatus('loading')
    setOffset({ x: 0, y: 0 })
    setScale(1)

    let cancelled = false
    fetch(`/api/map-image/${map.id}?t=${Date.now()}`)
      .then(r => {
        if (!r.ok) return r.text().then(t => { throw new Error(`${r.status}: ${t.slice(0, 200)}`) })
        return r.blob()
      })
      .then(blob => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
          if (cancelled) { URL.revokeObjectURL(url); return }
          imgRef.current = img
          const canvas = canvasRef.current
          if (canvas) {
            const cw = canvas.parentElement?.clientWidth  || window.innerWidth
            const ch = canvas.parentElement?.clientHeight || window.innerHeight - 52
            canvas.width  = cw
            canvas.height = ch
            const fit = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1)
            setScale(fit)
            setOffset({ x: (cw - img.naturalWidth * fit) / 2, y: (ch - img.naturalHeight * fit) / 2 })
          }
          URL.revokeObjectURL(url)
          setStatus('ready')
        }
        img.onerror = () => { URL.revokeObjectURL(url); setErrorMsg('Image decode failed'); setStatus('error') }
        img.src = url
      })
      .catch(err => { if (!cancelled) { setErrorMsg(err.message); setStatus('error') } })

    return () => { cancelled = true }
  }, [map?.id]) // eslint-disable-line

  useEffect(() => { draw() }, [draw])
  useEffect(() => { draw() }, [map?.fog_data, map?.tokens, draw])

  // ── Resize ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width  = canvas.parentElement?.clientWidth  || window.innerWidth
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight - 52
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [draw])

  // ── Mouse pan ────────────────────────────────────────────────────────────
  const drag = useRef(null)
  const onMouseDown  = (e) => { drag.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y } }
  const onMouseMove  = (e) => {
    if (!drag.current) return
    setOffset({ x: drag.current.ox + e.clientX - drag.current.sx, y: drag.current.oy + e.clientY - drag.current.sy })
  }
  const onMouseUp    = () => { drag.current = null }

  // ── Scroll-to-zoom (mouse wheel) ─────────────────────────────────────────
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const { offset: { x, y }, scale } = viewRef.current
      const factor   = e.deltaY < 0 ? 1.12 : 0.9
      const newScale = Math.min(Math.max(scale * factor, 0.05), 10)
      const rect = el.getBoundingClientRect()
      const mx   = e.clientX - rect.left
      const my   = e.clientY - rect.top
      setOffset({ x: mx - (mx - x) * (newScale / scale), y: my - (my - y) * (newScale / scale) })
      setScale(newScale)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Touch: pan (1 finger) + pinch-to-zoom (2 fingers) ───────────────────
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const dist = (t) => Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY)

    const onTouchStart = (e) => {
      const { offset: { x, y }, scale } = viewRef.current
      if (e.touches.length === 1) {
        gesture.current = { type: 'pan', sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: x, oy: y }
      } else if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect()
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
        gesture.current = { type: 'pinch', dist: dist(e.touches), midX, midY, originScale: scale, ox: x, oy: y }
      }
    }

    const onTouchMove = (e) => {
      e.preventDefault()
      const g = gesture.current
      if (!g) return
      if (g.type === 'pan' && e.touches.length === 1) {
        setOffset({ x: g.ox + e.touches[0].clientX - g.sx, y: g.oy + e.touches[0].clientY - g.sy })
      } else if (g.type === 'pinch' && e.touches.length === 2) {
        const newDist  = dist(e.touches)
        const factor   = newDist / g.dist
        const newScale = Math.min(Math.max(g.originScale * factor, 0.05), 10)
        setScale(newScale)
        setOffset({
          x: g.midX - (g.midX - g.ox) * (newScale / g.originScale),
          y: g.midY - (g.midY - g.oy) * (newScale / g.originScale),
        })
      }
    }

    const onTouchEnd = () => { gesture.current = null }

    // passive: false is required — mobile Chrome ignores preventDefault on passive listeners
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
    }
  }, []) // handlers read from viewRef — no deps needed

  // ── Zoom buttons ─────────────────────────────────────────────────────────
  const zoomBy = useCallback((factor) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { offset: { x, y }, scale } = viewRef.current
    const cx       = canvas.clientWidth  / 2
    const cy       = canvas.clientHeight / 2
    const newScale = Math.min(Math.max(scale * factor, 0.05), 10)
    setScale(newScale)
    setOffset({ x: cx - (cx - x) * (newScale / scale), y: cy - (cy - y) * (newScale / scale) })
  }, [])

  const zoomReset = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return
    const cw  = canvas.clientWidth
    const ch  = canvas.clientHeight
    const fit = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1)
    setScale(fit)
    setOffset({ x: (cw - img.naturalWidth * fit) / 2, y: (ch - img.naturalHeight * fit) / 2 })
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────
  if (!map || status === 'waiting') {
    return (
      <div style={s.center}>
        <div style={{ fontSize: '3rem' }}>🗺️</div>
        <div style={{ color: '#C9A84C', fontFamily: 'Georgia', fontSize: '1.2rem', marginTop: '1rem' }}>
          Waiting for your DM to share a map...
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={s.center}>
        <div style={{ color: '#e74c3c' }}>⚠ {errorMsg}</div>
      </div>
    )
  }

  return (
    <div style={s.container}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}    onMouseLeave={onMouseUp}
    >
      {status === 'loading' && (
        <div style={s.loadingOverlay}>
          <div style={{ color: '#C9A84C', fontFamily: 'Georgia' }}>Loading map...</div>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'block', cursor: drag.current ? 'grabbing' : 'grab' }} />

      {/* Zoom controls */}
      <div style={s.zoomControls}>
        <button style={s.zoomBtn} onClick={() => zoomBy(1.25)} title="Zoom in">+</button>
        <button style={s.zoomBtn} onClick={zoomReset}          title="Fit to screen">⊙</button>
        <button style={s.zoomBtn} onClick={() => zoomBy(0.8)}  title="Zoom out">−</button>
      </div>

      <div style={s.hint}>Drag to pan · Pinch or scroll to zoom</div>
    </div>
  )
}

const s = {
  container: {
    position: 'relative', width: '100%', height: 'calc(100vh - 52px)',
    overflow: 'hidden', background: '#0d0a05', userSelect: 'none',
  },
  center: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: 'calc(100vh - 52px)', flexDirection: 'column', gap: '1rem',
  },
  loadingOverlay: {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
    background: 'rgba(13,10,5,0.7)',
  },
  zoomControls: {
    position: 'absolute', bottom: '2.5rem', right: '1rem',
    display: 'flex', flexDirection: 'column', gap: 6, zIndex: 20,
  },
  zoomBtn: {
    width: 40, height: 40, borderRadius: 8,
    background: 'rgba(13,10,5,0.85)', border: '1px solid #3a2a10',
    color: '#c9a84c', fontSize: '1.3rem', fontWeight: 'bold',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1, touchAction: 'manipulation',
  },
  hint: {
    position: 'absolute', bottom: '0.75rem', left: '50%', transform: 'translateX(-50%)',
    fontSize: '11px', color: '#3a2a10', pointerEvents: 'none',
  },
}
