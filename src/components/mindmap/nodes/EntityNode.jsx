import { Handle, Position } from '@xyflow/react'
import { NODE_CONFIG } from '../../../utils/mindMapUtils'

// One node component for every entity type, driven by NODE_CONFIG.
//
// Phase 4 widened connections from three types to eight. NPCNode, LocationNode,
// FactionNode and ItemNode are four copies of the same 60 lines differing only
// in which NODE_CONFIG entry they read, so the five new types get this instead
// of five more copies.
//
// React Flow needs a distinct component per registered type name, so
// `entityNode(type)` returns a small bound wrapper — see MindMap.jsx.

export default function EntityNode({ type, data, selected }) {
  const cfg = NODE_CONFIG[type] ?? NODE_CONFIG.npc

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
          color: '#e8e0d0', lineHeight: 1.25,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {data.label}
        </div>
        {data.subtitle && (
          <div style={{
            fontSize: '10px', color: cfg.color, marginTop: '3px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {data.subtitle}
          </div>
        )}
      </div>
    </>
  )
}

/** Bind EntityNode to one type, for React Flow's nodeTypes map. */
export const entityNode = (type) => {
  const Bound = (props) => <EntityNode type={type} {...props} />
  Bound.displayName = `EntityNode(${type})`
  return Bound
}
