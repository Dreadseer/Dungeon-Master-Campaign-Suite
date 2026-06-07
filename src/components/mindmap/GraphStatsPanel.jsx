import { useState, useMemo } from 'react'
import { graphStats } from '../../utils/mindMapUtils'

const TYPE_LABELS = { npc: 'NPCs', location: 'Locations', faction: 'Factions', item: 'Items' }

export default function GraphStatsPanel({ nodes, edges }) {
  const [expanded, setExpanded] = useState(false)

  const stats = useMemo(() => graphStats(nodes, edges), [nodes, edges])

  const typeCounts = Object.entries(stats.countByType)
    .filter(([, v]) => v > 0)
    .map(([type, count]) => ({ type, label: TYPE_LABELS[type] ?? type, count }))

  return (
    <div style={{ pointerEvents: 'all' }}>
      {!expanded ? (
        /* ── Collapsed pill ─────────────────────────────────────────── */
        <button style={s.pill} onClick={() => setExpanded(true)} title="Show graph statistics">
          📊 {nodes.length} nodes · {stats.edgeCount} edges
          {stats.isolated.length > 0 && (
            <span style={s.pillWarning}> · ⚠ {stats.isolated.length}</span>
          )}
        </button>
      ) : (
        /* ── Expanded panel ─────────────────────────────────────────── */
        <div style={s.panel}>
          {/* Header */}
          <div style={s.header}>
            <span style={s.headerText}>📊 Graph Statistics</span>
            <button
              style={s.closeBtn}
              onClick={() => setExpanded(false)}
              title="Collapse"
            >
              ✕
            </button>
          </div>

          {/* Node counts by type */}
          <div style={s.section}>
            <div style={s.sectionLabel}>Nodes</div>
            <div style={s.countRow}>
              {typeCounts.map(({ type, label, count }) => (
                <div key={type} style={s.countChip}>
                  <span style={s.countNum}>{count}</span>
                  <span style={s.countLabel}>{label}</span>
                </div>
              ))}
              {typeCounts.length === 0 && (
                <span style={s.dimText}>—</span>
              )}
            </div>
          </div>

          {/* Connections */}
          <div style={s.statRow}>
            <span style={s.statLabel}>Connections</span>
            <span style={s.statVal}>{stats.edgeCount}</span>
          </div>

          {/* Isolated nodes */}
          <div style={s.statRow}>
            <span style={s.statLabel}>Isolated</span>
            <span style={stats.isolated.length > 0 ? s.statWarn : s.statVal}>
              {stats.isolated.length > 0
                ? `${stats.isolated.length} with no connections`
                : 'None'}
            </span>
          </div>

          {/* Most connected */}
          {stats.mostConnectedNode ? (
            <div style={s.statRow}>
              <span style={s.statLabel}>Most connected</span>
              <span style={s.statVal}>
                {stats.mostConnectedNode.data.label}
                <span style={s.dimText}> ({stats.maxConns})</span>
              </span>
            </div>
          ) : (
            <div style={s.statRow}>
              <span style={s.statLabel}>Most connected</span>
              <span style={s.dimText}>—</span>
            </div>
          )}

          {/* Isolated list (if any, up to 5) */}
          {stats.isolated.length > 0 && (
            <div style={s.isolatedSection}>
              <div style={s.sectionLabel}>No connections</div>
              {stats.isolated.slice(0, 5).map(n => (
                <div key={n.id} style={s.isolatedItem}>· {n.data.label}</div>
              ))}
              {stats.isolated.length > 5 && (
                <div style={s.isolatedItem}>
                  + {stats.isolated.length - 5} more
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const s = {
  pill: {
    padding:      '5px 12px',
    background:   'rgba(26, 18, 8, 0.9)',
    border:       '1px solid #3a2a10',
    borderRadius: 12,
    color:        '#888',
    cursor:       'pointer',
    fontSize:     11,
    whiteSpace:   'nowrap',
    backdropFilter: 'blur(4px)',
  },
  pillWarning: {
    color: '#C9A84C',
  },

  panel: {
    width:          220,
    background:     'rgba(18, 14, 8, 0.95)',
    border:         '1px solid #3a2a10',
    borderRadius:   6,
    backdropFilter: 'blur(6px)',
    overflow:       'hidden',
    boxShadow:      '0 4px 16px rgba(0,0,0,0.6)',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '8px 12px',
    background:     '#1a1208',
    borderBottom:   '1px solid #3a2a10',
  },
  headerText: {
    color:      '#C9A84C',
    fontSize:   12,
    fontWeight: 600,
  },
  closeBtn: {
    background: 'none',
    border:     'none',
    color:      '#555',
    cursor:     'pointer',
    fontSize:   12,
    padding:    0,
    lineHeight: 1,
  },

  section: {
    padding: '8px 12px 4px',
  },
  sectionLabel: {
    fontSize:      9,
    color:         '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom:  4,
  },
  countRow: {
    display:  'flex',
    flexWrap: 'wrap',
    gap:      4,
  },
  countChip: {
    display:      'flex',
    flexDirection: 'column',
    alignItems:   'center',
    background:   '#1a1208',
    border:       '1px solid #2a2010',
    borderRadius: 4,
    padding:      '3px 8px',
    minWidth:     40,
  },
  countNum: {
    color:      '#C9A84C',
    fontSize:   14,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  countLabel: {
    color:    '#555',
    fontSize: 9,
  },

  statRow: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'baseline',
    padding:        '4px 12px',
    borderTop:      '1px solid #1e1608',
    gap:            8,
  },
  statLabel: {
    color:    '#555',
    fontSize: 11,
    flexShrink: 0,
  },
  statVal: {
    color:     '#c9c0a8',
    fontSize:  11,
    textAlign: 'right',
  },
  statWarn: {
    color:     '#C9A84C',
    fontSize:  11,
    textAlign: 'right',
  },
  dimText: {
    color:   '#444',
    fontSize: 10,
  },

  isolatedSection: {
    padding:    '6px 12px 8px',
    borderTop:  '1px solid #1e1608',
  },
  isolatedItem: {
    color:      '#666',
    fontSize:   11,
    lineHeight: 1.6,
  },
}
