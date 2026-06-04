import { Group, Circle, Text, Line } from 'react-konva'
import { tokenToPixel, snapToGrid } from '../../utils/tokenUtils'

export default function MapToken({ token, gridSize, isSelected, onSelect, onDragEnd, mode }) {
  const { x, y } = tokenToPixel(token.col, token.row, gridSize)
  const radius    = gridSize * 0.38

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
      {/* 3-char abbreviation */}
      <Text
        text={token.label.substring(0, 3).toUpperCase()}
        fontSize={gridSize * 0.28}
        fill="white"
        fontStyle="bold"
        align="center"
        width={radius * 2}
        offsetX={radius}
        offsetY={gridSize * 0.1}
        listening={false}
      />
      {/* Full label below the circle */}
      <Text
        text={token.label}
        fontSize={9}
        fill="rgba(255,255,255,0.8)"
        align="center"
        width={80}
        offsetX={40}
        y={radius + 5}
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
