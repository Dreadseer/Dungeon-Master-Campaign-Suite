// Fog-of-war bitmask utilities
// Fog is stored as a flat boolean array: fogData[row * numCols + col] === true → revealed

export const getCellIndex = (col, row, numCols) => row * numCols + col

export const initFog = (numCols, numRows, revealed = false) =>
  new Array(numCols * numRows).fill(revealed)

export const isCellRevealed = (fogData, col, row, numCols) =>
  fogData[getCellIndex(col, row, numCols)] === true

export const setCellRevealed = (fogData, col, row, numCols, revealed) => {
  const next = [...fogData]
  next[getCellIndex(col, row, numCols)] = revealed
  return next
}

export const setBrushRevealed = (fogData, col, row, numCols, numRows, brushSize, revealed) => {
  let next = [...fogData]
  const half = Math.floor(brushSize / 2)
  for (let r = row - half; r <= row + half; r++) {
    for (let c = col - half; c <= col + half; c++) {
      if (c >= 0 && c < numCols && r >= 0 && r < numRows) {
        next[getCellIndex(c, r, numCols)] = revealed
      }
    }
  }
  return next
}

export const getMapDimensions = (imageSize, gridSize, fallbackW = 3000, fallbackH = 3000) => {
  const w = imageSize.width  || fallbackW
  const h = imageSize.height || fallbackH
  return {
    numCols: Math.ceil(w / gridSize),
    numRows: Math.ceil(h / gridSize),
  }
}

// Viewport culling helper — returns true if a cell is (partially) visible
export const isCellInViewport = (col, row, gridSize, stagePos, stageScale, canvasSize) => {
  const cellX = col * gridSize * stageScale + stagePos.x
  const cellY = row * gridSize * stageScale + stagePos.y
  const cellW = gridSize * stageScale
  return (
    cellX + cellW > 0 &&
    cellY + cellW > 0 &&
    cellX < canvasSize.width &&
    cellY < canvasSize.height
  )
}
