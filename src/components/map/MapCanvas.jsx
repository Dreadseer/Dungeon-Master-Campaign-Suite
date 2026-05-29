import { useState, useEffect, useRef, useCallback } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Rect, Text } from 'react-konva'
import {
  initFog, isCellRevealed, setBrushRevealed,
  getMapDimensions, isCellInViewport,
} from '../../utils/fogUtils'
import MapToken    from './MapToken'
import AddTokenModal  from './AddTokenModal'
import TokenInspector from './TokenInspector'

// Layout constants — keep in sync with Sidebar, TopBar, and MapToolbar heights
const SIDEBAR_W    = 240
const TOPBAR_H     = 56
const MAPTOOLBAR_H = 46

export default function MapCanvas({
  map,
  mode,
  campaignId,
  onFogChange,
  onTokensChange,
  stageScale,
  stagePos,
  setStageScale,
  setStagePos,
  activeTool,
  fogBrushSize,     // 1 | 3 | 5 — passed from MapEngine via MapToolbar
  gridSize,         // live value from toolbar (may differ from map.grid_size before save)
  canvasSize,
  setCanvasSize,
  // Imperative handles for Reveal All / Hide All from toolbar
  onRevealAll,
  onHideAll,
  registerFogControls,  // callback to expose revealAll/hideAll up to MapEngine
}) {
  const stageRef = useRef(null)

  // Background image
  const [backgroundImage, setBackgroundImage] = useState(null)
  const [imageSize, setImageSize]             = useState({ width: 0, height: 0 })
  const [imageError, setImageError]           = useState(false)

  // Pan state
  const [isPanning,   setIsPanning]   = useState(false)
  const [lastPanPos,  setLastPanPos]  = useState({ x: 0, y: 0 })

  // Fog state
  const [fogData,        setFogData]        = useState([])
  const [isFogPainting,  setIsFogPainting]  = useState(false)
  const saveFogRef = useRef(null)

  // Token state
  const [tokens,            setTokens]            = useState([])
  const [selectedToken,     setSelectedToken]     = useState(null)
  const [showAddTokenModal, setShowAddTokenModal] = useState(false)
  const [addTokenCell,      setAddTokenCell]      = useState({ col: 0, row: 0 })
  const saveTokensRef = useRef(null)

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
  // Uses dmcs-asset:// protocol — no base64/IPC overhead, works with large files
  useEffect(() => {
    setImageError(false)
    if (!map.image_path) {
      setBackgroundImage(null)
      setImageSize({ width: 0, height: 0 })
      return
    }
    const url = window.electronAPI.file.getLocalUrl(map.image_path)
    const img = new window.Image()
    img.onload = () => {
      setBackgroundImage(img)
      setImageSize({ width: img.width, height: img.height })
    }
    img.onerror = (e) => {
      console.error('[MapCanvas] Failed to load image via protocol:', map.image_path, e)
      setImageError(true)
    }
    img.src = url
  }, [map.image_path])

  // ── Fog initialisation ─────────────────────────────────────────────
  // Re-run whenever image dimensions or grid size change (map resize/reimport)
  useEffect(() => {
    const effectiveGrid = gridSize || map.grid_size || 50
    const { numCols, numRows } = getMapDimensions(imageSize, effectiveGrid)
    const saved = map.fog_data ? JSON.parse(map.fog_data) : []
    if (saved.length === numCols * numRows) {
      setFogData(saved)
    } else {
      // Fresh map or dimensions changed — start fully hidden
      setFogData(initFog(numCols, numRows, false))
    }
  }, [imageSize, map.grid_size, map.fog_data]) // eslint-disable-line react-hooks/exhaustive-deps
  // Note: intentionally exclude gridSize from deps — we only reinit on saved grid_size change,
  // not on every live toolbar nudge (that would wipe unsaved fog state).

  // ── Token initialisation ───────────────────────────────────────────
  useEffect(() => {
    try {
      setTokens(map.tokens ? JSON.parse(map.tokens) : [])
    } catch {
      setTokens([])
    }
    setSelectedToken(null)
  }, [map.tokens])

  // ── Debounced fog save ─────────────────────────────────────────────
  const debounceSaveFog = useCallback((next) => {
    clearTimeout(saveFogRef.current)
    saveFogRef.current = setTimeout(() => {
      window.electronAPI.db.maps.updateFog(map.id, next)
      onFogChange?.(next)
    }, 500)
  }, [map.id, onFogChange])

  // ── Token save & mutators ──────────────────────────────────────────
  const saveTokens = useCallback((next) => {
    clearTimeout(saveTokensRef.current)
    saveTokensRef.current = setTimeout(() => {
      window.electronAPI.db.maps.updateTokens(map.id, next)
      onTokensChange?.(next)
    }, 300)
  }, [map.id, onTokensChange])

  const handleTokenDragEnd = useCallback((tokenId, newCol, newRow) => {
    setTokens(prev => {
      const next = prev.map(t => t.id === tokenId ? { ...t, col: newCol, row: newRow } : t)
      saveTokens(next)
      return next
    })
  }, [saveTokens])

  const addToken = useCallback((token) => {
    setTokens(prev => {
      const next = [...prev, token]
      saveTokens(next)
      return next
    })
  }, [saveTokens])

  const deleteSelectedToken = useCallback(() => {
    if (!selectedToken) return
    setTokens(prev => {
      const next = prev.filter(t => t.id !== selectedToken.id)
      saveTokens(next)
      return next
    })
    setSelectedToken(null)
  }, [selectedToken, saveTokens])

  // ── Reveal All / Hide All (exposed to toolbar via registerFogControls) ──
  const revealAll = useCallback(() => {
    const effectiveGrid = gridSize || map.grid_size || 50
    const { numCols, numRows } = getMapDimensions(imageSize, effectiveGrid)
    const next = initFog(numCols, numRows, true)
    setFogData(next)
    window.electronAPI.db.maps.updateFog(map.id, next)
    onFogChange?.(next)
  }, [imageSize, gridSize, map.grid_size, map.id, onFogChange])

  const hideAll = useCallback(() => {
    const effectiveGrid = gridSize || map.grid_size || 50
    const { numCols, numRows } = getMapDimensions(imageSize, effectiveGrid)
    const next = initFog(numCols, numRows, false)
    setFogData(next)
    window.electronAPI.db.maps.updateFog(map.id, next)
    onFogChange?.(next)
  }, [imageSize, gridSize, map.grid_size, map.id, onFogChange])

  // Register controls with parent so toolbar buttons can call them
  useEffect(() => {
    registerFogControls?.({ revealAll, hideAll })
  }, [registerFogControls, revealAll, hideAll])

  // ── Fog brush helpers ──────────────────────────────────────────────
  const pointerToStage = useCallback((e) => {
    const stage   = e.target.getStage()
    const pointer = stage.getPointerPosition()
    return {
      x: (pointer.x - stagePos.x) / stageScale,
      y: (pointer.y - stagePos.y) / stageScale,
    }
  }, [stagePos, stageScale])

  const applyFogBrush = useCallback((e) => {
    if (mode !== 'dm') return
    if (activeTool !== 'fog-reveal' && activeTool !== 'fog-hide') return
    const effectiveGrid = gridSize || map.grid_size || 50
    const { x, y }           = pointerToStage(e)
    const col                 = Math.floor(x / effectiveGrid)
    const row                 = Math.floor(y / effectiveGrid)
    const { numCols, numRows } = getMapDimensions(imageSize, effectiveGrid)
    const revealed             = activeTool === 'fog-reveal'
    const brushSize            = fogBrushSize ?? 1
    const next = setBrushRevealed(fogData, col, row, numCols, numRows, brushSize, revealed)
    setFogData(next)
    debounceSaveFog(next)
  }, [mode, activeTool, gridSize, map.grid_size, imageSize, fogBrushSize,
      fogData, pointerToStage, debounceSaveFog])

  // ── Double-click: open AddTokenModal on empty canvas ──────────────
  const handleDblClick = useCallback((e) => {
    if (activeTool !== 'token') return
    if (mode !== 'dm') return
    // Only fire when clicking on empty stage background (not a token shape)
    if (e.target !== e.target.getStage()) return
    const { x, y }      = pointerToStage(e)
    const effectiveGrid  = gridSize || map.grid_size || 50
    const col            = Math.floor(x / effectiveGrid)
    const row            = Math.floor(y / effectiveGrid)
    setAddTokenCell({ col, row })
    setShowAddTokenModal(true)
  }, [activeTool, mode, pointerToStage, gridSize, map.grid_size])

  // ── Grid renderer ─────────────────────────────────────────────────
  const renderGrid = useCallback(() => {
    const lines    = []
    const cellSize = gridSize || map.grid_size || 50
    const w        = imageSize.width  || 3000
    const h        = imageSize.height || 3000
    const color    = 'rgba(201, 168, 76, 0.35)'

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
      lines.push(<Line key={`v${col}`} points={[x, rowStart * cellSize, x, rowEnd * cellSize]}
        stroke={color} strokeWidth={0.5} listening={false} />)
    }
    for (let row = rowStart; row <= rowEnd; row++) {
      const y = row * cellSize
      lines.push(<Line key={`h${row}`} points={[colStart * cellSize, y, colEnd * cellSize, y]}
        stroke={color} strokeWidth={0.5} listening={false} />)
    }
    return lines
  }, [gridSize, map.grid_size, imageSize, stagePos, stageScale, canvasSize])

  // ── Fog renderer ──────────────────────────────────────────────────
  const renderFog = useCallback(() => {
    if (!fogData.length) return null
    const effectiveGrid        = gridSize || map.grid_size || 50
    const { numCols, numRows } = getMapDimensions(imageSize, effectiveGrid)
    const rects = []

    // TODO Phase 7 optimization: merge fog into a single clipping mask
    for (let row = 0; row < numRows; row++) {
      for (let col = 0; col < numCols; col++) {
        if (isCellRevealed(fogData, col, row, numCols)) continue

        // Viewport cull — skip off-screen fog cells
        if (!isCellInViewport(col, row, effectiveGrid, stagePos, stageScale, canvasSize)) continue

        // In player mode, fog is fully opaque — no hint of what lies beneath
        const alpha = mode === 'player' ? 1.0 : 0.92
        rects.push(
          <Rect
            key={`fog-${col}-${row}`}
            x={col * effectiveGrid}
            y={row * effectiveGrid}
            width={effectiveGrid}
            height={effectiveGrid}
            fill={`rgba(10, 8, 5, ${alpha})`}
            listening={false}
          />
        )
      }
    }
    return rects
  }, [fogData, gridSize, map.grid_size, imageSize, stagePos, stageScale, canvasSize, mode])

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

  // ── Mouse handlers (pan + fog brush) ─────────────────────────────
  const handleMouseDown = useCallback((e) => {
    // Pan: middle or right button
    if (e.evt.button === 1 || e.evt.button === 2) {
      e.evt.preventDefault()
      setIsPanning(true)
      setLastPanPos({ x: e.evt.clientX, y: e.evt.clientY })
      return
    }
    // Fog brush: left button
    if (e.evt.button === 0 && (activeTool === 'fog-reveal' || activeTool === 'fog-hide')) {
      setIsFogPainting(true)
      applyFogBrush(e)
    }
    // Deselect token when clicking empty canvas with token tool
    if (e.evt.button === 0 && activeTool === 'token' && e.target === e.target.getStage()) {
      setSelectedToken(null)
    }
  }, [activeTool, applyFogBrush])

  const handleMouseMove = useCallback((e) => {
    if (isPanning) {
      const dx = e.evt.clientX - lastPanPos.x
      const dy = e.evt.clientY - lastPanPos.y
      setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }))
      setLastPanPos({ x: e.evt.clientX, y: e.evt.clientY })
      return
    }
    if (isFogPainting) {
      applyFogBrush(e)
    }
  }, [isPanning, lastPanPos, setStagePos, isFogPainting, applyFogBrush])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
    setIsFogPainting(false)
  }, [])

  // ── Cursor style ──────────────────────────────────────────────────
  const cursor = isPanning     ? 'grabbing'
    : activeTool === 'pan'     ? 'grab'
    : activeTool === 'fog-reveal' || activeTool === 'fog-hide' ? 'cell'
    : activeTool === 'token'   ? 'crosshair'
    : 'default'

  const effectiveGrid = gridSize || map.grid_size || 50

  return (
    <div style={{ position: 'relative', width: canvasSize.width, height: canvasSize.height }}>
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
        onDblClick={handleDblClick}
        onContextMenu={e => e.evt.preventDefault()}
        style={{ background: '#0d0a05', cursor, display: 'block' }}
      >
        {/* Layer 1 — Background image */}
        <Layer>
          {backgroundImage && (
            <KonvaImage image={backgroundImage} x={0} y={0} listening={false} />
          )}
          {/* Placeholder when no image is loaded — helps DM distinguish
              "image hidden by fog" from "image not loaded" */}
          {!backgroundImage && (
            <Text
              x={20} y={20}
              text={imageError
                ? `⚠ Image failed to load\n${map.image_path}`
                : map.image_path
                  ? '⏳ Loading image…'
                  : '🗺 No background image\nChoose an image when editing this map.'}
              fontSize={14}
              fill={imageError ? '#e05050' : '#6b5a3a'}
              listening={false}
            />
          )}
        </Layer>

        {/* Layer 2 — Grid */}
        <Layer listening={false}>
          {renderGrid()}
        </Layer>

        {/* Layer 3 — Fog of war */}
        <Layer listening={false}>
          {renderFog()}
        </Layer>

        {/* Layer 4 — Tokens */}
        <Layer>
          {tokens.map(token => (
            <MapToken
              key={token.id}
              token={token}
              gridSize={effectiveGrid}
              isSelected={selectedToken?.id === token.id}
              onSelect={setSelectedToken}
              onDragEnd={handleTokenDragEnd}
              mode={mode}
            />
          ))}
        </Layer>
      </Stage>

      {/* Token inspector overlay — bottom-left of canvas */}
      {selectedToken && (
        <TokenInspector
          token={selectedToken}
          onDelete={deleteSelectedToken}
          onDeselect={() => setSelectedToken(null)}
        />
      )}

      {/* Add token modal */}
      {showAddTokenModal && (
        <AddTokenModal
          isOpen={showAddTokenModal}
          onClose={() => setShowAddTokenModal(false)}
          onAdd={(token) => {
            addToken(token)
            setShowAddTokenModal(false)
          }}
          cell={addTokenCell}
          campaignId={campaignId}
        />
      )}
    </div>
  )
}
