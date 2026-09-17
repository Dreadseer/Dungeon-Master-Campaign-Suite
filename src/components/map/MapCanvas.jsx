import { useState, useEffect, useRef, useCallback } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Rect, Text, Circle } from 'react-konva'
import {
  initFog, isCellRevealed, setBrushRevealed, isCellInViewport,
} from '../../utils/fogUtils'
import { mapGridDimensions, needsFogColsBackfill, isFogStale, readFogMask } from '../../utils/mapGridUtils'
import { notifyError } from '../../stores/toastStore'
import MapToken    from './MapToken'
import AddTokenModal  from './AddTokenModal'
import TokenInspector from './TokenInspector'
import { findCombatantForToken, findTokenForCombatant } from '../../utils/tokenCombatLink'
import { measurePath, formatMeasurement } from '../../utils/measureUtils'
import {
  parseAnnotations, annotationsForMode, createTextAnnotation, createShapeAnnotation,
  removeAnnotation, moveAnnotation, DEFAULT_ANNOTATION_COLOR,
} from '../../utils/annotationUtils'

const srOnly = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }

// Layout constants — keep in sync with Sidebar, TopBar, and MapToolbar heights
const SIDEBAR_W      = 240
const TOPBAR_H       = 56
const MAPTOOLBAR_H   = 46
const PLAYER_TOPBAR_H = 48   // PlayerTopBar height

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
  registerFogControls,    // callback to expose revealAll/hideAll up to MapEngine
  registerThumbnailGen,   // callback to expose generateThumbnail up to MapEngine
  combatRoster = [],      // live combatants from the initiative tracker, if a fight is running
  combatSelectedId = null,// whose turn it is, so the map can follow the tracker
  onImageSize,            // (size) => void — the loaded image size, for the toolbar's grid plan
  annotationKind  = 'text',                    // 'text' | 'rect' | 'circle' — chosen in the toolbar
  annotationColor = DEFAULT_ANNOTATION_COLOR,
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

  // Measurement (Phase 8). `measurePoints` are the fixed vertices of the path;
  // `measureCursor` is the free end while a leg is being dragged. Nothing here
  // is saved or sent to players — a ruler is a question the DM asks, not map state.
  const [measurePoints, setMeasurePoints] = useState([])
  const [measureCursor, setMeasureCursor] = useState(null)
  const [isMeasuring,   setIsMeasuring]   = useState(false)

  // Annotations (Phase 8): DM-only labels and shapes, saved to maps.annotations.
  // Never drawn in player mode — annotationsForMode returns nothing for it.
  const [annotations,  setAnnotations]  = useState([])
  const [selectedNote, setSelectedNote] = useState(null)   // annotation id
  const [noteDraft,    setNoteDraft]    = useState(null)   // { start, end } while dragging a shape
  const [labelInput,   setLabelInput]   = useState(null)   // { x, y, text } while typing a label

  useEffect(() => {
    setAnnotations(parseAnnotations(map.annotations))
    setSelectedNote(null)
    setNoteDraft(null)
    setLabelInput(null)
  }, [map.id, map.annotations])

  const saveAnnotations = useCallback((next) => {
    setAnnotations(next)
    window.electronAPI.db.maps.updateAnnotations(map.id, next)
      .catch(err => notifyError(err, 'Save map note'))
  }, [map.id])

  useEffect(() => {
    if (activeTool !== 'annotate') { setSelectedNote(null); setNoteDraft(null); setLabelInput(null) }
  }, [activeTool])

  useEffect(() => {
    if (activeTool !== 'annotate' || !selectedNote) return
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      saveAnnotations(removeAnnotation(annotations, selectedNote))
      setSelectedNote(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTool, selectedNote, annotations, saveAnnotations])

  // Enter commits and unmounts the input, and the unmount can fire its blur —
  // which also commits. The ref makes the second call a no-op.
  const labelDoneRef = useRef(false)
  useEffect(() => { if (labelInput && labelInput.text === '') labelDoneRef.current = false }, [labelInput])

  function commitLabel() {
    if (!labelInput || labelDoneRef.current) return
    labelDoneRef.current = true
    const note = createTextAnnotation({ x: labelInput.x, y: labelInput.y }, labelInput.text, annotationColor)
    setLabelInput(null)
    if (note) saveAnnotations([...annotations, note])
  }

  const clearMeasure = useCallback(() => {
    setMeasurePoints([])
    setMeasureCursor(null)
    setIsMeasuring(false)
  }, [])

  // A ruler left on screen after switching tools is a stale answer.
  useEffect(() => { if (activeTool !== 'measure') clearMeasure() }, [activeTool, clearMeasure])
  useEffect(() => { clearMeasure() }, [map.id, clearMeasure])

  useEffect(() => {
    if (activeTool !== 'measure') return
    const onKey = (e) => { if (e.key === 'Escape') clearMeasure() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTool, clearMeasure])

  // Follow the tracker's turn order: when the active combatant changes, select
  // the token standing for it. Silently does nothing when the creature has no
  // token, or when two tokens share its name and the match is ambiguous.
  // Guarded on the id rather than the effect deps: combatRoster and tokens get
  // fresh identities on every poll and every token save, and without this the
  // selection would snap back to the active combatant every few seconds,
  // overriding whatever the viewer had clicked on.
  const lastFollowedTurn = useRef(null)
  useEffect(() => {
    if (!combatSelectedId || combatSelectedId === lastFollowedTurn.current) return
    const combatant = combatRoster.find(c => c.id === combatSelectedId)
    if (!combatant) return
    const token = findTokenForCombatant(combatant, tokens)
    if (!token) return
    lastFollowedTurn.current = combatSelectedId
    setSelectedToken(token)
  }, [combatSelectedId, combatRoster, tokens])

  // ── Canvas resize listener ─────────────────────────────────────────
  // Player mode: no sidebar, no MapToolbar — full width minus only PlayerTopBar
  useEffect(() => {
    const updateSize = () => {
      if (mode === 'player') {
        setCanvasSize({ width: window.innerWidth, height: window.innerHeight - PLAYER_TOPBAR_H })
      } else {
        setCanvasSize({ width: window.innerWidth - SIDEBAR_W, height: window.innerHeight - TOPBAR_H - MAPTOOLBAR_H })
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [setCanvasSize, mode])

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

  useEffect(() => { onImageSize?.(imageSize) }, [imageSize, onImageSize])

  // ── fog_cols backfill (Phase 8) ─────────────────────────────────────
  // Every map from before migration 014 has fog_cols NULL. Record the column
  // count the first time the map is opened with its real size known — for an
  // image map that means after the image has loaded, or the 3000px fallback
  // would be recorded instead. DM view only; the handler never overwrites a
  // value that is already set.
  const backfilledRef = useRef(null)
  useEffect(() => {
    if (mode !== 'dm' || !needsFogColsBackfill(map)) return
    if (backfilledRef.current === map.id) return
    if (map.image_path && (!backgroundImage || imageError)) return
    backfilledRef.current = map.id
    const { numCols } = mapGridDimensions(map, imageSize, map.grid_size)
    window.electronAPI.db.maps.backfillFogCols(map.id, numCols)
      .catch(err => notifyError(err, 'Record fog grid size'))
  }, [mode, map, backgroundImage, imageError, imageSize])

  // ── Fog initialisation ─────────────────────────────────────────────
  // Re-run whenever image dimensions or grid size change (map resize/reimport)
  useEffect(() => {
    const effectiveGrid = gridSize || map.grid_size || 50
    const dims  = mapGridDimensions(map, imageSize, effectiveGrid)
    const saved = readFogMask(map.fog_data)
    if (saved.length > 0 && !isFogStale(map, dims)) {
      setFogData(saved)
    } else {
      // Fresh map, or a mask painted against another grid (wrong length, or
      // the right length with the wrong fog_cols) — start fully hidden.
      setFogData(initFog(dims.numCols, dims.numRows, false))
    }
  }, [imageSize, map.grid_size, map.fog_data, map.generated_params]) // eslint-disable-line react-hooks/exhaustive-deps
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
  // Every fog save carries the column count it was painted against, so
  // fog_cols always describes the mask actually stored.
  const debounceSaveFog = useCallback((next, numCols) => {
    clearTimeout(saveFogRef.current)
    saveFogRef.current = setTimeout(() => {
      saveFogRef.current = null
      window.electronAPI.db.maps.updateFog(map.id, next, numCols)
        .catch(err => notifyError(err, 'Save fog'))
      onFogChange?.(next)
    }, 500)
  }, [map.id, onFogChange])

  const cancelPendingFogSave = useCallback(() => {
    clearTimeout(saveFogRef.current)
    saveFogRef.current = null
  }, [])

  // The mask as it is on screen, for decisions that must not use the stale one
  // saved on the map row (the grid-change plan).
  const fogDataRef = useRef(fogData)
  fogDataRef.current = fogData
  const getFog = useCallback(() => fogDataRef.current, [])

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
  const fillFog = useCallback((revealed) => {
    // The SAVED grid size, not the live toolbar value: the stored mask has to
    // match the grid stored with it.
    const { numCols, numRows } = mapGridDimensions(map, imageSize, map.grid_size)
    const next = initFog(numCols, numRows, revealed)
    cancelPendingFogSave()
    setFogData(next)
    window.electronAPI.db.maps.updateFog(map.id, next, numCols)
      .catch(err => notifyError(err, revealed ? 'Reveal all' : 'Hide all'))
    onFogChange?.(next)
  }, [map, imageSize, onFogChange, cancelPendingFogSave])

  const revealAll = useCallback(() => fillFog(true), [fillFog])
  const hideAll = useCallback(() => fillFog(false), [fillFog])

  // Register controls with parent so toolbar buttons can call them
  useEffect(() => {
    registerFogControls?.({ revealAll, hideAll, getFog, cancelPendingFogSave })
  }, [registerFogControls, revealAll, hideAll, getFog, cancelPendingFogSave])

  // ── Thumbnail generation (exposed to toolbar via registerThumbnailGen) ──
  const generateThumbnail = useCallback(async () => {
    if (!stageRef.current) return
    const dataUrl = stageRef.current.toDataURL({ pixelRatio: 0.2 })
    const base64  = dataUrl.split(',')[1]
    await window.electronAPI.file.saveThumbnail(map.id, base64)
  }, [map.id])

  useEffect(() => {
    registerThumbnailGen?.(generateThumbnail)
  }, [registerThumbnailGen, generateThumbnail])

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
    const { numCols, numRows } = mapGridDimensions(map, imageSize, effectiveGrid)
    const revealed             = activeTool === 'fog-reveal'
    const brushSize            = fogBrushSize ?? 1
    const next = setBrushRevealed(fogData, col, row, numCols, numRows, brushSize, revealed)
    setFogData(next)
    debounceSaveFog(next, numCols)
  }, [mode, activeTool, gridSize, map, imageSize, fogBrushSize,
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
    const { width: w, height: h } = mapGridDimensions(map, imageSize, cellSize)
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
  }, [gridSize, map, imageSize, stagePos, stageScale, canvasSize])

  // ── Fog renderer ──────────────────────────────────────────────────
  const renderFog = useCallback(() => {
    if (!fogData.length) return null
    const effectiveGrid        = gridSize || map.grid_size || 50
    const { numCols, numRows } = mapGridDimensions(map, imageSize, effectiveGrid)
    const rects = []

    // TODO Phase 7 optimization: merge fog into a single clipping mask
    for (let row = 0; row < numRows; row++) {
      for (let col = 0; col < numCols; col++) {
        if (isCellRevealed(fogData, col, row, numCols)) continue

        // Viewport cull — skip off-screen fog cells
        if (!isCellInViewport(col, row, effectiveGrid, stagePos, stageScale, canvasSize)) continue

        // Player mode: fully opaque solid black — zero content visible beneath.
        // DM mode: semi-transparent dark overlay — DM can still see the map.
        const fill = mode === 'player' ? 'rgba(0,0,0,1)' : 'rgba(10,8,5,0.92)'
        rects.push(
          <Rect
            key={`fog-${col}-${row}`}
            x={col * effectiveGrid}
            y={row * effectiveGrid}
            width={effectiveGrid}
            height={effectiveGrid}
            fill={fill}
            listening={false}
          />
        )
      }
    }
    return rects
  }, [fogData, gridSize, map, imageSize, stagePos, stageScale, canvasSize, mode])

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
    // Pan: middle/right button always; left button when pan tool is active
    if (e.evt.button === 1 || e.evt.button === 2 ||
        (e.evt.button === 0 && activeTool === 'pan')) {
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
    // Measure: drag from a square. Shift-press on a finished measurement adds a
    // leg from where it ended instead of starting over.
    if (e.evt.button === 0 && activeTool === 'measure' && mode === 'dm') {
      const point = pointerToStage(e)
      if (e.evt.shiftKey && measurePoints.length >= 2 && !isMeasuring) {
        setMeasureCursor(point)
      } else {
        setMeasurePoints([point])
        setMeasureCursor(point)
      }
      setIsMeasuring(true)
    }
    // Annotate: a press on empty map starts a note. A press on an existing note
    // is handled by the note itself (it selects, and can be dragged).
    if (e.evt.button === 0 && activeTool === 'annotate' && mode === 'dm' && e.target === e.target.getStage()) {
      const point = pointerToStage(e)
      setSelectedNote(null)
      if (annotationKind === 'text') {
        e.evt.preventDefault()   // keep focus for the label input about to appear
        setLabelInput({ x: point.x, y: point.y, text: '' })
      } else {
        setNoteDraft({ start: point, end: point })
      }
    }
  }, [activeTool, applyFogBrush, mode, pointerToStage, measurePoints.length, isMeasuring, annotationKind])

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
    if (isMeasuring) {
      setMeasureCursor(pointerToStage(e))
    }
    if (noteDraft) {
      const end = pointerToStage(e)
      setNoteDraft(d => (d ? { ...d, end } : d))
    }
  }, [isPanning, lastPanPos, setStagePos, isFogPainting, applyFogBrush, isMeasuring, pointerToStage, noteDraft])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
    setIsFogPainting(false)
    if (noteDraft) {
      // createShapeAnnotation returns null for a drag too small to be deliberate.
      const shape = createShapeAnnotation(annotationKind, noteDraft.start, noteDraft.end, annotationColor)
      setNoteDraft(null)
      if (shape) {
        saveAnnotations([...annotations, shape])
        setSelectedNote(shape.id)
      }
    }
    if (isMeasuring) {
      setIsMeasuring(false)
      const grid = gridSize || map.grid_size || 50
      const last = measurePoints[measurePoints.length - 1]
      const sameSquare = last && measureCursor &&
        Math.floor(last.x / grid) === Math.floor(measureCursor.x / grid) &&
        Math.floor(last.y / grid) === Math.floor(measureCursor.y / grid)
      if (sameSquare) {
        // A click without a drag: nothing to measure. Keep an existing path.
        if (measurePoints.length < 2) clearMeasure()
        setMeasureCursor(null)
      } else if (measureCursor) {
        setMeasurePoints(prev => [...prev, measureCursor])
        setMeasureCursor(null)
      }
    }
  }, [isMeasuring, measurePoints, measureCursor, gridSize, map.grid_size, clearMeasure,
      noteDraft, annotationKind, annotationColor, annotations, saveAnnotations])

  // ── Cursor style ──────────────────────────────────────────────────
  const cursor = isPanning     ? 'grabbing'
    : activeTool === 'pan'     ? 'grab'
    : activeTool === 'fog-reveal' || activeTool === 'fog-hide' ? 'cell'
    : activeTool === 'token'   ? 'crosshair'
    : activeTool === 'measure' ? 'crosshair'
    : activeTool === 'annotate' ? (annotationKind === 'text' ? 'text' : 'crosshair')
    : 'default'

  const effectiveGrid = gridSize || map.grid_size || 50
  const dims = mapGridDimensions(map, imageSize, effectiveGrid)

  const measurement = mode === 'dm' && activeTool === 'measure'
    ? measurePath(isMeasuring && measureCursor ? [...measurePoints, measureCursor] : measurePoints,
        effectiveGrid, map.feet_per_cell)
    : null
  const measureLabel = formatMeasurement(measurement)

  const visibleNotes = annotationsForMode(annotations, mode)
  const draftShape = noteDraft
    ? createShapeAnnotation(annotationKind, noteDraft.start, noteDraft.end, annotationColor, 'draft')
    : null
  const editingNotes = mode === 'dm' && activeTool === 'annotate'

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
          {/* A blank map: a neutral field exactly cols x grid wide, so the
              edge of the map is visible and tokens have somewhere to stand. */}
          {!map.image_path && dims.source === 'blank' && (
            <Rect x={0} y={0} width={dims.width} height={dims.height}
              fill="#2b2620" stroke="#4a3a1a" strokeWidth={2} listening={false} />
          )}
          {/* Placeholder when no image is loaded — helps DM distinguish
              "image hidden by fog" from "image not loaded" */}
          {!backgroundImage && dims.source !== 'blank' && (
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

        {/* Layer 3b — DM annotations. Above the fog so the DM can read them
             through it; below tokens so a note never hides a creature. Drawn
             only in DM mode, and stripped server-side for remote players. */}
        {(visibleNotes.length > 0 || draftShape) && (
          <Layer listening={editingNotes}>
            {[...visibleNotes, ...(draftShape ? [draftShape] : [])].map(note => {
              const selected = note.id === selectedNote
              const common = {
                x: note.x,
                y: note.y,
                draggable: editingNotes && note.id !== 'draft',
                onMouseDown: (e) => { if (editingNotes) { e.cancelBubble = true; setSelectedNote(note.id) } },
                onDragEnd: (e) => saveAnnotations(moveAnnotation(annotations, note.id, e.target.x(), e.target.y())),
                opacity: note.id === 'draft' ? 0.6 : 1,
              }
              if (note.kind === 'text') {
                return (
                  <Text key={note.id} {...common} text={note.text} fontSize={18} fontStyle="bold"
                    fill={note.color} stroke={selected ? '#ffffff' : '#0d0a05'} strokeWidth={selected ? 1.5 : 3}
                    fillAfterStrokeEnabled />
                )
              }
              if (note.kind === 'rect') {
                return (
                  <Rect key={note.id} {...common} width={note.width} height={note.height}
                    stroke={note.color} strokeWidth={selected ? 4 : 2.5} dash={selected ? [8, 4] : undefined}
                    fill={`${note.color}22`} />
                )
              }
              return (
                <Circle key={note.id} {...common} radius={note.radius}
                  stroke={note.color} strokeWidth={selected ? 4 : 2.5} dash={selected ? [8, 4] : undefined}
                  fill={`${note.color}22`} />
              )
            })}
          </Layer>
        )}

        {/* Layer 4 — Tokens
             Player mode: only render tokens on revealed (fog-lifted) cells.
             DM mode: all tokens visible regardless of fog. */}
        <Layer>
          {tokens
            .filter(token => {
              if (mode !== 'player') return true
              return isCellRevealed(fogData, token.col, token.row, dims.numCols)
            })
            .map(token => (
              <MapToken
                key={token.id}
                token={token}
                gridSize={effectiveGrid}
                isSelected={selectedToken?.id === token.id}
                onSelect={setSelectedToken}
                onDragEnd={handleTokenDragEnd}
                mode={mode}
                stageScale={stageScale}
                locked={activeTool === 'measure'}
              />
            ))
          }
        </Layer>

        {/* Layer 5 — Measurement (DM only, never saved or broadcast).
             Sizes are divided by the zoom so the ruler reads the same at any scale. */}
        {measurement && (
          <Layer listening={false}>
            <Line points={measurement.points} stroke="#f5c542" strokeWidth={3 / stageScale}
              dash={[10 / stageScale, 6 / stageScale]} lineCap="round" lineJoin="round" />
            {measurement.points.reduce((acc, v, i) => (i % 2 ? acc : [...acc, [v, measurement.points[i + 1]]]), [])
              .map(([x, y], i) => (
                <Rect key={i} x={x - 4 / stageScale} y={y - 4 / stageScale}
                  width={8 / stageScale} height={8 / stageScale} fill="#f5c542" />
              ))}
            <Text
              x={measurement.points[measurement.points.length - 2] + 12 / stageScale}
              y={measurement.points[measurement.points.length - 1] - 26 / stageScale}
              text={measureLabel}
              fontSize={15 / stageScale}
              fontStyle="bold"
              fill="#fff6d8"
              stroke="#0d0a05"
              strokeWidth={4 / stageScale}
              fillAfterStrokeEnabled
              padding={2 / stageScale}
            />
          </Layer>
        )}
      </Stage>

      {/* The measurement as text, for screen readers and the acceptance driver —
          the Konva label above is pixels on a canvas. */}
      <output data-measure-label aria-live="polite" style={srOnly}>{measureLabel}</output>
      {/* How many notes this view is drawing: 0 in player mode, always. */}
      <output data-annotation-count style={srOnly}>{visibleNotes.length}</output>

      {labelInput && (
        <input
          autoFocus
          data-annotation-input
          placeholder="Note — Enter to place, Esc to cancel"
          value={labelInput.text}
          maxLength={120}
          onChange={e => setLabelInput(l => ({ ...l, text: e.target.value }))}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitLabel() }
            if (e.key === 'Escape') { e.preventDefault(); labelDoneRef.current = true; setLabelInput(null) }
          }}
          onBlur={commitLabel}
          style={{
            position: 'absolute',
            left: labelInput.x * stageScale + stagePos.x,
            top: labelInput.y * stageScale + stagePos.y,
            zIndex: 20, width: 240,
            background: '#0d0a05', color: '#e8e0d0', border: `1px solid ${annotationColor}`,
            borderRadius: 3, padding: '0.25rem 0.45rem', fontSize: '0.85rem', outline: 'none',
          }}
        />
      )}

      {editingNotes && selectedNote && (
        <button
          data-annotation-delete
          onClick={() => { saveAnnotations(removeAnnotation(annotations, selectedNote)); setSelectedNote(null) }}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 20,
            background: '#1a0a0a', color: '#e05050', border: '1px solid #6a2020',
            borderRadius: 4, padding: '0.3rem 0.7rem', cursor: 'pointer', fontSize: '0.8rem',
          }}
        >
          ✕ Delete note
        </button>
      )}

      {/* Token inspector overlay — bottom-left of canvas */}
      {selectedToken && (
        <TokenInspector
          token={selectedToken}
          combatant={findCombatantForToken(selectedToken, combatRoster)}
          onDelete={deleteSelectedToken}
          onDeselect={() => setSelectedToken(null)}
          mode={mode}
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
