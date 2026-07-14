import { Group, Circle, Text, Line } from 'react-konva'
import { tokenToPixel, snapToGrid } from '../../utils/tokenUtils'

export default function MapToken({ token, gridSize, isSelected, onSelect, onDragEnd, mode, stageScale = 1 }) {
  const { x, y } = tokenToPixel(token.col, token.row, gridSize)
  const radius    = gridSize * 0.38
  const label     = token.label ?? token.name ?? ''

  // Keep text at a fixed screen size regardless of zoom level.
  // At low zoom the token circles shrink but labels stay readable.
  const scale      = Math.max(0.15, stageScale)
  const abbrSize   = Math.round(Math.min(14, (gridSize * 0.28)) / scale)
  const labelSize  = Math.round(11 / scale)
  const labelW     = Math.round(90 / scale)

  return (
    <Group
      x={x}
      y={y}
      draggable={mode === 'dm'}
      onClick={(e) => {
        e.cancelBubble = true   // don't bubble to Stage onClick
        onSelect(token)
      }}
      onDblClick={(e) => {
        e.cancelBubble = true   // don't open AddTokenModal when double-clicking a token
      }}
      onDragEnd={(e) => {
        const stage      = e.target.getStage()
        const absPos     = e.target.getAbsolutePosition()
        const sp         = stage.position()
        const ss         = stage.scaleX()
        const stageX     = (absPos.x - sp.x) / ss
        const stageY     = (absPos.y - sp.y) / ss
        const { col, row } = snapToGrid(stageX, stageY, gridSize)
        onDragEnd(token.id, col, row)
      }}
    >
      {/* Outer ring — token type colour */}
      <Circle radius={radius + 3} fill={token.color} />
      {/* Inner fill — darker when selected */}
      <Circle radius={radius} fill={isSelected ? '#2a2a2a' : '#1a1a1a'} />
      {/* White selection ring */}
      {isSelected && (
        <Circle radius={radius + 6} stroke="#ffffff" strokeWidth={1.5} fill={null} />
      )}
      {/* 3-char abbreviation — scaled to stay readable at any zoom */}
      <Text
        text={label.substring(0, 3).toUpperCase()}
        fontSize={abbrSize}
        fill="white"
        fontStyle="bold"
        align="center"
        width={radius * 2}
        offsetX={radius}
        offsetY={abbrSize / 2}
        listening={false}
      />
      {/* Full label below the circle — dark pill background for legibility */}
      <Text
        text={label}
        fontSize={labelSize}
        fill="#ffffff"
        fontStyle="bold"
        align="center"
        width={labelW}
        offsetX={labelW / 2}
        y={radius + 4}
        listening={false}
      />
      {/* Defeated: red X overlay */}
      {token.defeated && (
        <>
          <Line
            points={[-radius * 0.6, -radius * 0.6, radius * 0.6, radius * 0.6]}
            stroke="#e05050" strokeWidth={3} lineCap="round" listening={false}
          />
          <Line
            points={[radius * 0.6, -radius * 0.6, -radius * 0.6, radius * 0.6]}
            stroke="#e05050" strokeWidth={3} lineCap="round" listening={false}
          />
        </>
      )}
    </Group>
  )
}
