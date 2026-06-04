// Token utilities — Phase 3 Prompt 04
// Token shape stored in maps.tokens JSON array:
// { id, label, type, col, row, color, entity_type, entity_id }

export const TOKEN_COLORS = {
  player:  '#4A90D9',  // blue
  npc:     '#F5A623',  // amber
  monster: '#D0021B',  // red
  object:  '#7B7B7B',  // gray
}

export const createToken = (label, type, col, row, entityType = null, entityId = null) => ({
  id:          crypto.randomUUID(),
  label:       label.trim(),
  type,
  col,
  row,
  color:       TOKEN_COLORS[type] ?? TOKEN_COLORS.object,
  entity_type: entityType,
  entity_id:   entityId,
})

// Convert pixel position → grid cell (top-left corner of the cell the pixel falls in)
export const snapToGrid = (pixelX, pixelY, gridSize) => ({
  col: Math.floor(pixelX / gridSize),
  row: Math.floor(pixelY / gridSize),
})

// Convert grid cell → pixel position at center of cell
export const tokenToPixel = (col, row, gridSize) => ({
  x: col * gridSize + gridSize / 2,
  y: row * gridSize + gridSize / 2,
})
