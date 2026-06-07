import { Handle, Position } from '@xyflow/react'
import { NODE_CONFIG } from '../../../utils/mindMapUtils'

export default function LocationNode({ data, selected }) {
  const cfg = NODE_CONFIG.location
  return (
    <>
      <Handle type="target" position={Position.Top}    style={{ background: cfg.color }} />
      <Handle type="source" position={Position.Bottom} style={{ background: cfg.color }} />
      <Handle type="target" position={Position.Left}   style={{ background: cfg.color }} />
      <Handle type="source" position={Position.Right}  style={{ background: cfg.color }} />
      <div style={{
        background:   cfg.background,
        border:       `2px solid ${selected ? '#ffffff' : cfg.color}`,
        borderRadius: '8px',
        padding:      '10px 14px',
        minWidth:     '120px',
        maxWidth:     '180px',
        cursor:       'pointer',
        boxShadow:    selected ? `0 0 12px ${cfg.color}` : 'none',
        position:     'relative',
      }}>
        <div style={{ fontSize: '18px', marginBottom: '4px' }}>{cfg.icon}</div>
        <div style={{
          fontFamily: 'Georgia', fontSize: '13px', fontWeight: 'bold',
          color: cfg.color, wordBreak: 'break-word',
        }}>
          {data.label}
        </div>
        {data.subtitle && (
          <div style={{ fontSize: '11px', color: '#8a8a8a', marginTop: '2px', textTransform: 'capitalize' }}>
            {data.subtitle}
          </div>
        )}
        <div style={{
          position: 'absolute', top: '4px', right: '6px',
          fontSize: '9px', color: cfg.color, opacity: 0.7,
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          LOCATION
        </div>
      </div>
    </>
  )
}
