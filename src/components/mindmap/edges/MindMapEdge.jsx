import { getBezierPath, EdgeLabelRenderer } from '@xyflow/react'

export default function MindMapEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        stroke={selected ? '#ffffff' : '#C9A84C'}
        strokeWidth={selected ? 2 : 1.5}
        strokeOpacity={0.7}
        fill="none"
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position:      'absolute',
            transform:     `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            background:    '#1a1208',
            border:        '1px solid #C9A84C',
            borderRadius:  '4px',
            padding:       '2px 8px',
            fontSize:      '10px',
            color:         '#C9A84C',
            fontFamily:    'Arial',
            letterSpacing: '0.3px',
            pointerEvents: 'all',
            cursor:        'pointer',
            whiteSpace:    'nowrap',
            textTransform: 'lowercase',
            maxWidth:      '120px',
            overflow:      'hidden',
            textOverflow:  'ellipsis',
          }}
          className="nodrag nopan"
        >
          {data?.label ?? ''}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
