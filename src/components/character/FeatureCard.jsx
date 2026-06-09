import { useState } from 'react'

export default function FeatureCard({ name, badge, description, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={s.card}>
      <div
        style={s.header}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={s.name}>{name}</span>
        {badge && (
          <span style={s.badge}>{badge}</span>
        )}
        <span style={s.chevron}>{expanded ? '▲' : '▼'}</span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            style={s.deleteBtn}
            title="Remove"
          >
            ×
          </button>
        )}
      </div>

      {expanded && (
        <div style={s.body}>
          {description
            ? description
            : <em style={{ color: '#6b6b6b' }}>No description added.</em>
          }
        </div>
      )}
    </div>
  )
}

const s = {
  card: {
    border:           '1px solid #2d1f0a',
    borderLeft:       '4px solid #C9A84C',
    borderRadius:     '6px',
    marginBottom:     '6px',
    background:       '#0d0a05',
    flexShrink:       0,
  },
  header: {
    display:     'flex',
    alignItems:  'center',
    padding:     '9px 14px',
    cursor:      'pointer',
    gap:         '0.4rem',
    userSelect:  'none',
  },
  name: {
    flex:        1,
    fontWeight:  'bold',
    color:       '#e8e0d0',
    fontFamily:  'Georgia, serif',
    fontSize:    '0.88rem',
    overflow:    'hidden',
    textOverflow:'ellipsis',
    whiteSpace:  'nowrap',
  },
  badge: {
    fontSize:     '11px',
    color:        '#C9A84C',
    marginRight:  '4px',
    border:       '1px solid #C9A84C',
    borderRadius: '3px',
    padding:      '1px 6px',
    flexShrink:   0,
    whiteSpace:   'nowrap',
  },
  chevron: {
    color:      '#6b6b6b',
    fontSize:   '11px',
    flexShrink: 0,
  },
  deleteBtn: {
    background:  'none',
    border:      'none',
    color:       '#8B0000',
    cursor:      'pointer',
    fontSize:    '1.1rem',
    lineHeight:  1,
    padding:     '0 0.1rem',
    flexShrink:  0,
  },
  body: {
    padding:      '0 14px 12px',
    color:        '#c0b8a8',
    fontSize:     '0.82rem',
    lineHeight:   '1.6',
    borderTop:    '1px solid #2d1f0a',
    paddingTop:   '10px',
    whiteSpace:   'pre-wrap',
  },
}
