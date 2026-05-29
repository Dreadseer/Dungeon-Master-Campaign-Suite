import { useState, useEffect } from 'react'
import { TOKEN_COLORS } from '../../utils/tokenUtils'

const TYPE_LABELS = { player: 'Player', npc: 'NPC', monster: 'Monster', object: 'Object' }

export default function TokenInspector({ token, onDelete, onDeselect }) {
  const [npc,        setNpc]        = useState(null)
  const [showNpc,    setShowNpc]    = useState(false)
  const [loadingNpc, setLoadingNpc] = useState(false)

  // Reset NPC panel when token changes
  useEffect(() => {
    setNpc(null)
    setShowNpc(false)
  }, [token?.id])

  async function handleViewNpc() {
    if (npc) { setShowNpc(v => !v); return }
    setLoadingNpc(true)
    try {
      const data = await window.electronAPI.db.npcs.getById(token.entity_id)
      setNpc(data)
      setShowNpc(true)
    } catch {
      setNpc(null)
    } finally {
      setLoadingNpc(false)
    }
  }

  const ringColor = TOKEN_COLORS[token.type] ?? TOKEN_COLORS.object

  return (
    <div style={s.panel}>
      {/* Header row */}
      <div style={s.header}>
        <span style={{ ...s.ring, background: ringColor }} />
        <span style={s.name}>{token.label}</span>
        <span style={{ ...s.badge, borderColor: ringColor, color: ringColor }}>
          {TYPE_LABELS[token.type] ?? token.type}
        </span>
        <button style={s.xBtn} onClick={onDeselect} title="Deselect">✕</button>
      </div>

      {/* Position */}
      <p style={s.pos}>Col {token.col}, Row {token.row}</p>

      {/* NPC link */}
      {token.entity_type === 'npc' && token.entity_id && (
        <button style={s.viewBtn} onClick={handleViewNpc} disabled={loadingNpc}>
          {loadingNpc ? '…' : showNpc ? '▲ Hide NPC' : '▼ View NPC'}
        </button>
      )}

      {/* Character link placeholder */}
      {token.entity_type === 'character' && (
        <p style={s.ph}>Character sheet — Phase 4</p>
      )}

      {/* NPC quick view */}
      {showNpc && npc && (
        <div style={s.npcPanel}>
          <p style={s.npcName}>{npc.name}</p>
          {(npc.race || npc.class) && (
            <p style={s.npcMeta}>{[npc.race, npc.class].filter(Boolean).join(' · ')}</p>
          )}
          {npc.role && <p style={s.npcMeta}>Role: {npc.role}</p>}
          {npc.notes && <p style={s.npcNotes}>{npc.notes}</p>}
        </div>
      )}

      {/* Delete */}
      <button style={s.deleteBtn} onClick={onDelete}>🗑 Delete Token</button>
    </div>
  )
}

const s = {
  panel: {
    position:   'absolute',
    bottom:     12,
    left:       12,
    background: 'rgba(13,10,5,0.94)',
    border:     '1px solid #3a2a10',
    borderRadius: 6,
    padding:    '0.6rem 0.75rem',
    minWidth:   200,
    maxWidth:   280,
    zIndex:     10,
    boxShadow:  '0 2px 12px rgba(0,0,0,0.6)',
  },
  header: {
    display:    'flex',
    alignItems: 'center',
    gap:        '0.4rem',
    marginBottom: '0.3rem',
  },
  ring: {
    width:        12,
    height:       12,
    borderRadius: '50%',
    flexShrink:   0,
  },
  name: {
    color:        '#e8e0d0',
    fontWeight:   600,
    fontSize:     '0.9rem',
    flex:         1,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  },
  badge: {
    fontSize:     '0.68rem',
    border:       '1px solid',
    borderRadius: 3,
    padding:      '0.05rem 0.3rem',
  },
  xBtn: {
    background: 'none',
    border:     'none',
    color:      '#6b5a3a',
    cursor:     'pointer',
    fontSize:   '0.8rem',
    padding:    0,
    lineHeight: 1,
  },
  pos: {
    color:        '#6b5a3a',
    fontSize:     '0.75rem',
    margin:       '0 0 0.5rem',
  },
  viewBtn: {
    background: 'transparent',
    border:     '1px solid #3a2a10',
    color:      '#a89060',
    borderRadius: 3,
    padding:    '0.2rem 0.5rem',
    cursor:     'pointer',
    fontSize:   '0.75rem',
    marginBottom: '0.5rem',
    display:    'block',
    width:      '100%',
    textAlign:  'left',
  },
  ph: {
    color:        '#4a3a1a',
    fontSize:     '0.72rem',
    fontStyle:    'italic',
    margin:       '0 0 0.5rem',
  },
  npcPanel: {
    background:   '#0a0805',
    border:       '1px solid #2a1c08',
    borderRadius: 4,
    padding:      '0.45rem 0.55rem',
    marginBottom: '0.5rem',
  },
  npcName: {
    color:      '#c9a84c',
    fontSize:   '0.82rem',
    fontWeight: 600,
    margin:     '0 0 0.2rem',
  },
  npcMeta: {
    color:    '#a89060',
    fontSize: '0.75rem',
    margin:   '0 0 0.15rem',
  },
  npcNotes: {
    color:      '#6b5a3a',
    fontSize:   '0.72rem',
    margin:     '0.25rem 0 0',
    fontStyle:  'italic',
    maxHeight:  60,
    overflow:   'hidden',
  },
  deleteBtn: {
    background: 'transparent',
    border:     '1px solid #6a2020',
    color:      '#c06060',
    borderRadius: 3,
    padding:    '0.25rem 0.5rem',
    cursor:     'pointer',
    fontSize:   '0.75rem',
    width:      '100%',
    marginTop:  '0.1rem',
  },
}
