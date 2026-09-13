import { useState, useEffect } from 'react'
import { TOKEN_COLORS } from '../../utils/tokenUtils'

const TYPE_LABELS = { player: 'Player', npc: 'NPC', monster: 'Monster', object: 'Object' }

/**
 * Coarse health, for the players' screen.
 *
 * Players never see a monster's hit point total — working it out is most of what
 * a fight is. "Bloodied" is table language and is fair to show; a number is not.
 */
function healthBand(combatant) {
  if (!combatant || combatant.hp_current == null || !combatant.hp_max) return null
  if (combatant.hp_current <= 0) return { label: 'Down', color: '#e05050' }
  const pct = combatant.hp_current / combatant.hp_max
  if (pct <= 0.25) return { label: 'Badly wounded', color: '#e0a050' }
  if (pct <= 0.5)  return { label: 'Bloodied',      color: '#c9a84c' }
  if (pct < 1)     return { label: 'Wounded',       color: '#9a9a6a' }
  return { label: 'Unharmed', color: '#7fc272' }
}

export default function TokenInspector({ token, combatant = null, onDelete, onDeselect, mode = 'dm' }) {
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

      {/* Live combat state, while this creature is in a running fight.
          The DM sees the numbers; the players' screen sees a band, because
          working out a monster's hit points is most of what a fight is. */}
      {combatant && (
        <div style={s.combatBox}>
          <div style={s.combatTop}>
            <span style={s.combatLabel}>In combat</span>
            {combatant.is_active && <span style={s.turnBadge}>Their turn</span>}
          </div>

          {mode === 'dm' ? (
            combatant.hp_max ? (
              <div style={s.hpBarWrap}>
                <div style={{
                  ...s.hpBarFill,
                  width: `${Math.max(0, Math.min(100, Math.round((combatant.hp_current / combatant.hp_max) * 100)))}%`,
                }} />
                <span style={s.hpBarText}>
                  {combatant.hp_current}/{combatant.hp_max}
                  {combatant.temp_hp > 0 ? ` (+${combatant.temp_hp})` : ''}
                </span>
              </div>
            ) : null
          ) : (
            (() => {
              const band = healthBand(combatant)
              return band ? <p style={{ ...s.band, color: band.color }}>{band.label}</p> : null
            })()
          )}

          {combatant.conditions?.length > 0 && (
            <div style={s.condRow}>
              {combatant.conditions.map(cond => (
                <span key={cond} style={s.condPill}>{cond}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* NPC link — DM only */}
      {mode === 'dm' && token.entity_type === 'npc' && token.entity_id && (
        <button style={s.viewBtn} onClick={handleViewNpc} disabled={loadingNpc}>
          {loadingNpc ? '…' : showNpc ? '▲ Hide NPC' : '▼ View NPC'}
        </button>
      )}

      {/* Character link placeholder — DM only */}
      {mode === 'dm' && token.entity_type === 'character' && (
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

      {/* Delete — DM only */}
      {mode === 'dm' && (
        <button style={s.deleteBtn} onClick={onDelete}>🗑 Delete Token</button>
      )}
    </div>
  )
}

const s = {
  // Live combat readout
  combatBox: {
    background: '#12100c', border: '1px solid #3a2a10',
    borderRadius: 4, padding: '6px 8px', marginBottom: 8,
  },
  combatTop: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 },
  combatLabel: {
    fontSize: 9, color: '#8a7a5a', textTransform: 'uppercase', letterSpacing: 0.6,
  },
  turnBadge: {
    fontSize: 9, color: '#c9a84c', background: '#2a2010',
    border: '1px solid #5a4010', borderRadius: 8, padding: '0 5px',
  },
  hpBarWrap: {
    position: 'relative', height: 14, background: '#1a1a1a',
    border: '1px solid #333', borderRadius: 3, overflow: 'hidden',
  },
  hpBarFill: { height: '100%', background: '#6a2a2a' },
  hpBarText: {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: 10, color: '#e0d5c0',
  },
  band: { fontSize: 12, fontWeight: 600, margin: 0 },
  condRow: { display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 5 },
  condPill: {
    fontSize: 9, background: '#2a2a3a', color: '#aaa',
    border: '1px solid #444', borderRadius: 8, padding: '1px 5px',
  },

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
