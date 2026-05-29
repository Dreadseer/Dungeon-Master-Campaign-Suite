import { useState, useEffect, useRef, useCallback } from 'react'
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva'

// Layout constants — keep in sync with Sidebar, TopBar, and MapToolbar heights
const SIDEBAR_W    = 240
const TOPBAR_H     = 56
const MAPTOOLBAR_H = 46

export default function MapCanvas({
  map,
  mode,
  onFogChange,
  onTokensChange,
  stageScale,
  stagePos,
  setStageScale,
  setStagePos,
  activeTool,
  gridSize,         // live value from toolbar (may differ from map.grid_size before save)
  canvasSize,
  setCanvasSize,
}) {
  const stageRef = useRef(null)

  // Background image
  const [backgroundImage, setBackgroundImage] = useState(null)
  const [imageSize, setImageSize]             = useState({ width: 0, height: 0 })

  // Pan state
  const [isPanning,   setIsPanning]   = useState(false)
  const [lastPanPos,  setLastPanPos]  = useState({ x: 0, y: 0 })

  // ── Canvas resize listener ─────────────────────────────────────────
  useEffect(() => {
    const updateSize = () => setCanvasSize({
      width:  window.innerWidth  - SIDEBAR_W,
      height: window.innerHeight - TOPBAR_H - MAPTOOLBAR_H,
    })
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [setCanvasSize])

  // ── Background image loader ────────────────────────────────────────
  useEffect(() => {
    if (!map.image_path) {
      setBackgroundImage(null)
      setImageSize({ width: 0, height: 0 })
      return
    }
    window.electronAPI.file.readImageAsBase64(map.image_path).then(base64 => {
      if (!base64) return
      const img = new window.Image()
      img.onload = () => {
        setBackgroundImage(img)
        setImageSize({ width: img.width, height: img.height })
      }
      img.src = base64
    })
  }, [map.image_path])

  // ── Grid renderer ─────────────────────────────────────────────────
  const renderGrid = useCallback(() => {
    const lines    = []
    const cellSize = gridSize || map.grid_size || 50
    const w        = imageSize.width  || 3000
    const h        = imageSize.height || 3000
    const color    = 'rgba(201, 168, 76, 0.35)'

    // Viewport-bounded range to avoid drawing off-screen lines
    const visX0 = (-stagePos.x) / stageScale
    const visY0 = (-stagePos.y) / stageScale
    const visX1 = visX0 + canvasSize.width  / stageScale
    const visY1 = visY0 + canvasSize.height / stageScale

    const colStart = Math.max(0, Math.floor(visX0 / cellSize))
    const colEnd   = Math.min(Math.ceil(w / cellSize), Math.ceil(visX1 / cellSize) + 1)
    const rowStart = Math.max(0, Math.floor(visY0 / cellSize))
    const rowEnd   = Math.min(Math.ceil(h / cellSize), Math.ceil(visY1 / cellSize) + 1)

    for (let col = colStart; col <= colEnd; col++) {
      const x = col * cellSize
      lines.push(
        <Line key={`v${col}`} points={[x, rowStart * cellSize, x, rowEnd * cellSize]}
          stroke={color} strokeWidth={0.5} listening={false} />
      )
    }
    for (let row = rowStart; row <= rowEnd; row++) {
      const y = row * cellSize
      lines.push(
        <Line key={`h${row}`} points={[colStart * cellSize, y, colEnd * cellSize, y]}
          stroke={color} strokeWidth={0.5} listening={false} />
      )
    }
    return lines
  }, [gridSize, map.grid_size, imageSize, stagePos, stageScale, canvasSize])

  // ── Zoom to cursor ────────────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.evt.preventDefault()
    const stage    = e.target.getStage()
    const oldScale = stageScale
    const pointer  = stage.getPointerPosition()
    const scaleBy  = 1.05
    const newScale = e.evt.deltaY < 0
      ? Math.min(oldScale * scaleBy, 5)
      : Math.max(oldScale / scaleBy, 0.2)

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    }
    setStageScale(newScale)
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }, [stageScale, stagePos, setStageScale, setStagePos])

  // ── Pan (middle-click or right-click drag) ────────────────────────
  const handleMouseDown = useCallback((e) => {
    if (e.evt.button === 1 || e.evt.button === 2) {
      e.evt.preventDefault()
      setIsPanning(true)
      setLastPanPos({ x: e.evt.clientX, y: e.evt.clientY })
    }
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!isPanning) return
    const dx = e.evt.clientX - lastPanPos.x
    const dy = e.evt.clientY - lastPanPos.y
    setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }))
    setLastPanPos({ x: e.evt.clientX, y: e.evt.clientY })
  }, [isPanning, lastPanPos, setStagePos])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // ── Cursor style ──────────────────────────────────────────────────
  const cursor = isPanning ? 'grabbing'
    : activeTool === 'pan' ? 'grab'
    : 'crosshair'

  return (
    <Stage
      ref={stageRef}
      width={canvasSize.width}
      height={canvasSize.height}
      scaleX={stageScale}
      scaleY={stageScale}
      x={stagePos.x}
      y={stagePos.y}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={e => e.evt.preventDefault()}
      style={{ background: '#0d0a05', cursor, display: 'block' }}
    >
      {/* Layer 1 — Background image */}
      <Layer>
        {backgroundImage && (
          <KonvaImage image={backgroundImage} x={0} y={0} listening={false} />
        )}
      </Layer>

      {/* Layer 2 — Grid */}
      <Layer listening={false}>
        {renderGrid()}
      </Layer>

      {/* Layer 3 — Fog of war (Prompt 03) */}
      <Layer>{/* fog renders here */}</Layer>

      {/* Layer 4 — Tokens (Prompt 04) */}
      <Layer>{/* tokens render here */}</Layer>
    </Stage>
  )
}
