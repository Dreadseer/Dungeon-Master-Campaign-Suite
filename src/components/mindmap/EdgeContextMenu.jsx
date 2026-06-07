export default function EdgeContextMenu({ x, y, edge, nodes, onEdit, onDelete, onClose }) {
  const sourceNode = nodes.find(n => n.id === edge.source)
  const targetNode = nodes.find(n => n.id === edge.target)
  const srcName    = sourceNode?.data.label ?? edge.source
  const tgtName    = targetNode?.data.label ?? edge.target
  const relLabel   = edge.label ?? edge.data?.label ?? ''

  return (
    <>
      {/* Transparent backdrop — dismiss on click */}
      <div style={s.backdrop} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />

      {/* Menu */}
      <div style={{ ...s.menu, left: x, top: y }}>
        {/* Entity route header */}
        <div style={s.header}>
          <div style={s.routeLine}>
            <span style={s.entityName}>{srcName}</span>
            <span style={s.arrow}>→</span>
            <span style={s.entityName}>{tgtName}</span>
          </div>
          {relLabel && (
            <div style={s.relLabel}>"{relLabel}"</div>
          )}
        </div>

        {/* Actions */}
        <button style={s.item} onClick={() => { onEdit(); onClose() }}>
          ✏ Edit Relationship
        </button>
        <button style={{ ...s.item, ...s.danger }} onClick={() => { onDelete(); onClose() }}>
          🗑 Delete Connection
        </button>
      </div>
    </>
  )
}

const s = {
  backdrop: {
    position: 'fixed',
    inset:    0,
    zIndex:   50,
    cursor:   'default',
  },
  menu: {
    position:    'fixed',
    zIndex:      51,
    minWidth:    180,
    background:  '#1a1208',
    border:      '1px solid #3a2a10',
    borderRadius: 6,
    boxShadow:   '0 4px 20px rgba(0,0,0,0.8)',
    overflow:    'hidden',
  },

  header: {
    padding:     '8px 12px',
    background:  '#12100a',
    borderBottom:'1px solid #2a2010',
  },
  routeLine: {
    display:    'flex',
    alignItems: 'center',
    gap:        5,
    flexWrap:   'wrap',
  },
  entityName: {
    color:      '#c9c0a8',
    fontSize:   11,
    fontFamily: 'Georgia',
  },
  arrow: {
    color:    '#C9A84C',
    fontSize: 11,
  },
  relLabel: {
    color:    '#666',
    fontSize: 10,
    marginTop: 2,
    fontStyle: 'italic',
  },

  item: {
    display:   'block',
    width:     '100%',
    padding:   '8px 12px',
    background:'none',
    border:    'none',
    borderTop: '1px solid #1e1608',
    color:     '#c9c0a8',
    cursor:    'pointer',
    fontSize:  12,
    textAlign: 'left',
  },
  danger: {
    color: '#c05050',
  },
}
