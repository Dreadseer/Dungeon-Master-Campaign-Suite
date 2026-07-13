import { useEffect, useRef, useState, useCallback } from 'react'

export default function MapView({ map }) {
  const canvasRef  = useRef(null)
  const imgRef     = useRef(null)
  const [status,   setStatus]   = useState('waiting') // waiting | loading | ready | error
  const [errorMsg, setErrorMsg] = useState('')

  // Pan/zoom state
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale,  setScale]  = useState(1)
  const drag     = useRef(null)  // { startX, startY, originX, originY }

  // ── Draw the canvas whenever map data or view state changes ───────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img || !img.complete) return

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(scale, scale)

    // ── Base map image ──────────────────────────────────────────
    ctx.drawImage(img, 0, 0)

    // ── Fog of war ───────────────────────────────────────────────
    const fogData  = (() => { try { return JSON.parse(map.fog_data ?? '[]') } catch { return [] } })()
    const gridSize = map.grid_size ?? 50

    if (fogData.length > 0) {
      const numCols = Math.ceil(img.naturalWidth / gridSize)
      const numRows = Math.ceil(img.naturalHeight / gridSize)
      ctx.fillStyle = 'rgba(0,0,0,0.88)'
      for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {
          const revealed = fogData[row * numCols + col] === true
          if (!revealed) {
            ctx.fillRect(col * gridSize, row * gridSize, gridSize, gridSize)
          }
        }
      }
    }

    // ── Tokens ───────────────────────────────────────────────────
    const tokens  = (() => { try { return JSON.parse(map.tokens ?? '[]') } catch { return [] } })()
    const numCols = fogData.length > 0 ? Math.ceil(img.naturalWidth / gridSize) : 0
    tokens.forEach(token => {
      const col = token.col ?? 0
      const row = token.row ?? 0

      // Hide tokens whose cell is covered by fog
      if (fogData.length > 0) {
        const revealed = fogData[row * numCols + col] === true
        if (!revealed) return
      }

      const x   = col * gridSize + gridSize / 2
      const y   = row * gridSize + gridSize / 2
      const r   = (gridSize / 2) * 0.8
      const color = token.color ?? '#e74c3c'

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle   = color
      ctx.globalAlpha = 0.85
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#fff'
      ctx.lineWidth   = 1.5
      ctx.stroke()

      if (token.name) {
        ctx.font         = `bold ${Math.max(9, gridSize * 0.22)}px Arial`
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle    = '#fff'
        ctx.fillText(token.name.slice(0, 8), x, y)
      }
    })

    ctx.restore()
  }, [map, offset, scale])

  // ── Load image when map changes ───────────────────────────────
  useEffect(() => {
    if (!map) { setStatus('waiting'); return }
    setStatus('loading')
    setOffset({ x: 0, y: 0 })
    setScale(1)

    let cancelled = false
    fetch(`/api/map-image/${map.id}?t=${Date.now()}`)
      .then(r => {
        if (!r.ok) return r.text().then(t => { throw new Error(`Server error ${r.status}: ${t.slice(0, 200)}`) })
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
            const container = canvas.parentElement
            const cw = container?.clientWidth  || window.innerWidth
            const ch = container?.clientHeight || window.innerHeight - 52
            canvas.width  = cw
            canvas.height = ch
            const fitScale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1)
            setScale(fitScale)
            setOffset({
              x: (cw - img.naturalWidth  * fitScale) / 2,
              y: (ch - img.naturalHeight * fitScale) / 2,
            })
          }
          URL.revokeObjectURL(url)
          setStatus('ready')
        }
        img.onerror = () => {
          URL.revokeObjectURL(url)
          setErrorMsg('Image decode failed')
          setStatus('error')
        }
        img.src = url
      })
      .catch(err => {
        if (cancelled) return
        console.error('[MapView] load failed:', err.message)
        setErrorMsg(err.message)
        setStatus('error')
      })

    return () => { cancelled = true }
  }, [map?.id]) // eslint-disable-line

  // Redraw whenever draw function (= deps) changes
  useEffect(() => { draw() }, [draw])

  // ── Resize handler ───────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const container = canvas.parentElement
      canvas.width  = container?.clientWidth  || window.innerWidth
      canvas.height = container?.clientHeight || window.innerHeight - 52
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [draw])

  // ── Re-draw when fog/token data updates (DM sync) ────────────
  useEffect(() => { draw() }, [map?.fog_data, map?.tokens, draw])

  // ── Pan (mouse) ──────────────────────────────────────────────
  const onMouseDown = (e) => {
    drag.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y }
  }
  const onMouseMove = (e) => {
    if (!drag.current) return
    setOffset({
      x: drag.current.originX + (e.clientX - drag.current.startX),
      y: drag.current.originY + (e.clientY - drag.current.startY),
    })
  }
  const onMouseUp = () => { drag.current = null }

  // ── Pan (touch) ──────────────────────────────────────────────
  const touch = useRef(null)
  const onTouchStart = (e) => {
    if (e.touches.length === 1) {
      touch.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, originX: offset.x, originY: offset.y }
    }
  }
  const onTouchMove = (e) => {
    if (!touch.current || e.touches.length !== 1) return
    e.preventDefault()
    setOffset({
      x: touch.current.originX + (e.touches[0].clientX - touch.current.startX),
      y: touch.current.originY + (e.touches[0].clientY - touch.current.startY),
    })
  }
  const onTouchEnd = () => { touch.current = null }

  // ── Scroll to zoom ───────────────────────────────────────────
  const onWheel = (e) => {
    e.preventDefault()
    const factor  = e.deltaY < 0 ? 1.1 : 0.9
    const newScale = Math.min(Math.max(scale * factor, 0.1), 8)
    const rect    = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setOffset(prev => ({
      x: mx - (mx - prev.x) * (newScale / scale),
      y: my - (my - prev.y) * (newScale / scale),
    }))
    setScale(newScale)
  }

  // ── Waiting / no map ─────────────────────────────────────────
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
        <div style={{ color: '#e74c3c', fontSize: '1rem' }}>⚠ {errorMsg}</div>
      </div>
    )
  }

  return (
    <div style={s.container}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {status === 'loading' && (
        <div style={s.loadingOverlay}>
          <div style={{ color: '#C9A84C', fontFamily: 'Georgia' }}>Loading map...</div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
      />
      <div style={s.hint}>Drag to pan · Scroll to zoom</div>
    </div>
  )
}

const s = {
  container: {
    position: 'relative',
    width:    '100%',
    height:   'calc(100vh - 52px)',
    overflow: 'hidden',
    background: '#0d0a05',
    userSelect: 'none',
  },
  center: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    height:         'calc(100vh - 52px)',
    flexDirection:  'column',
    gap:            '1rem',
  },
  loadingOverlay: {
    position:       'absolute',
    inset:          0,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    zIndex:         10,
    background:     'rgba(13,10,5,0.7)',
  },
  hint: {
    position:   'absolute',
    bottom:     '0.75rem',
    left:       '50%',
    transform:  'translateX(-50%)',
    fontSize:   '11px',
    color:      '#3a2a10',
    pointerEvents: 'none',
  },
}
