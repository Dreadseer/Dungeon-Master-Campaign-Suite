import { useNavigate } from 'react-router-dom'
import { NODE_CONFIG } from '../../utils/mindMapUtils'

export default function NodeDetailPanel({ node, allNodes, onClose, onHighlight }) {
  const navigate = useNavigate()

  if (!node) return null

  const cfg      = NODE_CONFIG[node.type] ?? NODE_CONFIG.npc
  const data     = node.data
  const raw      = data.raw ?? {}

  // Count NPCs that belong to this faction (for faction panel)
  const factionNPCCount = node.type === 'faction'
    ? allNodes.filter(n => n.type === 'npc' && n.data.raw?.faction_id === data.entityId).length
    : 0

  // Truncate long text for display
  const truncate = (str, max = 120) =>
    str && str.length > max ? str.slice(0, max) + '…' : (str ?? '')

  const renderBody = () => {
    switch (node.type) {
      case 'npc':
        return (
          <div style={s.body}>
            {raw.race  && <Row label="Race"       value={raw.race} />}
            {raw.class && <Row label="Class"      value={raw.class} />}
            {raw.role  && <Row label="Role"       value={raw.role} />}
            {raw.location_name  && <Row label="Location"  value={raw.location_name} />}
            {raw.faction_name   && <Row label="Faction"   value={raw.faction_name} />}
            <Row label="Status" value={raw.is_alive === 0 ? '💀 Deceased' : '✅ Alive'} />
            {raw.motivation && (
              <div style={s.textBlock}>
                <div style={s.textLabel}>Motivation</div>
                <div style={s.textVal}>{truncate(raw.motivation)}</div>
              </div>
            )}
            <div style={s.btnRow}>
              <button style={s.navBtn} onClick={() => { onClose(); navigate('/world/npcs') }}>
                View Full NPC →
              </button>
            </div>
          </div>
        )

      case 'location':
        return (
          <div style={s.body}>
            {raw.type   && <Row label="Type"   value={raw.type}   />}
            {raw.parent_name && <Row label="Parent" value={raw.parent_name} />}
            {raw.description && (
              <div style={s.textBlock}>
                <div style={s.textLabel}>Description</div>
                <div style={s.textVal}>{truncate(raw.description)}</div>
              </div>
            )}
            <div style={s.btnRow}>
              <button style={s.navBtn} onClick={() => { onClose(); navigate('/world/locations') }}>
                View Location →
              </button>
            </div>
          </div>
        )

      case 'faction':
        return (
          <div style={s.body}>
            {raw.alignment   && <Row label="Alignment" value={raw.alignment} />}
            <Row label="Members" value={`${factionNPCCount} NPC${factionNPCCount !== 1 ? 's' : ''}`} />
            {raw.description && (
              <div style={s.textBlock}>
                <div style={s.textLabel}>Description</div>
                <div style={s.textVal}>{truncate(raw.description)}</div>
              </div>
            )}
            <div style={s.btnRow}>
              <button style={s.navBtn} onClick={() => { onClose(); navigate('/world/factions') }}>
                View Faction →
              </button>
            </div>
          </div>
        )

      case 'item':
        return (
          <div style={s.body}>
            {raw.type && <Row label="Type" value={raw.type} />}
            {raw.description && (
              <div style={s.textBlock}>
                <div style={s.textLabel}>Description</div>
                <div style={s.textVal}>{truncate(raw.description)}</div>
              </div>
            )}
            <div style={s.btnRow}>
              <button style={s.navBtn} onClick={() => { onClose(); navigate('/compendium') }}>
                View in Compendium →
              </button>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={{ ...s.header, borderColor: cfg.color }}>
        <div style={s.headerLeft}>
          <span style={s.icon}>{cfg.icon}</span>
          <div>
            <div style={{ ...s.entityName, color: cfg.color }}>{data.label}</div>
            <div style={s.typeLabel}>{cfg.label}</div>
          </div>
        </div>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* Body */}
      {renderBody()}

      {/* Footer: Show Connections */}
      <div style={s.footer}>
        <button
          style={s.highlightBtn}
          onClick={() => onHighlight?.(node.id)}
          title="Highlight all connections for this entity"
        >
          ✦ Show Connections
        </button>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      <span style={s.rowVal}>{value}</span>
    </div>
  )
}

const s = {
  panel: {
    position:    'absolute', right: 0, top: 0, bottom: 0,
    width:       320, zIndex: 20,
    background:  '#12100a', borderLeft: '1px solid #3a2a10',
    display:     'flex', flexDirection: 'column',
    boxShadow:   '-4px 0 24px rgba(0,0,0,0.7)',
    overflow:    'hidden',
  },
  header: {
    display:      'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding:      '14px 16px', background: '#1a1208',
    borderBottom: '2px solid',
    flexShrink:   0,
  },
  headerLeft: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  icon:       { fontSize: 24, marginTop: 2 },
  entityName: { fontSize: 15, fontWeight: 700, fontFamily: 'Georgia', wordBreak: 'break-word' },
  typeLabel:  { fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: '#666',
    cursor: 'pointer', fontSize: 16, padding: '0 2px', flexShrink: 0,
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '12px 16px',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  rowLabel: { color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 },
  rowVal:   { color: '#c9c0a8', fontSize: 12, textAlign: 'right' },
  textBlock: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 },
  textLabel: { color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  textVal:   { color: '#888', fontSize: 12, lineHeight: 1.5 },
  btnRow:    { marginTop: 4 },
  navBtn: {
    padding: '6px 14px', background: '#1a2a1a', color: '#7fc272',
    border: '1px solid #2d5a27', borderRadius: 4, cursor: 'pointer', fontSize: 12,
    width: '100%',
  },
  footer: {
    padding: '10px 16px', borderTop: '1px solid #2a2010',
    background: '#1a1208', flexShrink: 0,
  },
  highlightBtn: {
    width: '100%', padding: '7px 14px', background: '#2a1f06',
    border: '1px solid #C9A84C', borderRadius: 4, cursor: 'pointer',
    fontSize: 12, color: '#C9A84C',
  },
}
