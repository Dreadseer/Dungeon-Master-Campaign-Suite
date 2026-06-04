import { useEffect, useRef } from 'react'
import { CONDITIONS } from '../../utils/combatUtils'

export default function ConditionManager({ combatant, onToggleCondition, onToggleConcentration, onClose }) {
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const activeSet = new Set(combatant.conditions ?? [])

  return (
    <div ref={ref} style={s.popover}>
      <div style={s.header}>
        <span style={s.title}>Conditions — {combatant.name}</span>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* 15-condition grid */}
      <div style={s.grid}>
        {CONDITIONS.map(cond => {
          const active = activeSet.has(cond.name)
          return (
            <button
              key={cond.name}
              style={{
                ...s.condBtn,
                ...(active ? { ...s.condBtnActive, background: cond.color + '33', border: `1px solid ${cond.color}` } : {}),
              }}
              title={cond.description}
              onClick={() => onToggleCondition(combatant.id, cond.name)}
            >
              <span style={s.condIcon}>{cond.icon}</span>
              <span style={{ ...s.condLabel, ...(active ? { color: cond.color } : {}) }}>
                {cond.name}
              </span>
              {active && <span style={s.checkMark}>✓</span>}
            </button>
          )
        })}
      </div>

      {/* Concentration toggle */}
      <div style={s.concRow}>
        <button
          style={{
            ...s.concBtn,
            ...(combatant.concentration
              ? { background: '#2a1a3a', border: '1px solid #6a3a9a', color: '#b07cf7' }
              : {}),
          }}
          onClick={() => onToggleConcentration(combatant.id)}
        >
          🎯 {combatant.concentration ? 'Drop Concentration' : 'Mark Concentrating'}
        </button>
        {combatant.concentration && (
          <span style={s.concNote}>Concentrating — click 🎯 in tracker for spell details</span>
        )}
      </div>
    </div>
  )
}

const s = {
  popover: {
    position: 'absolute', zIndex: 50,
    background: '#1e1e1e', border: '1px solid #555',
    borderRadius: 8, padding: 12, width: 320,
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  title:    { color: '#c9a84c', fontSize: 13, fontWeight: 600 },
  closeBtn: {
    background: 'none', border: 'none', color: '#666',
    cursor: 'pointer', fontSize: 14, padding: '0 2px',
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 4, marginBottom: 10,
  },
  condBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 2, padding: '6px 4px', background: '#2a2a2a',
    border: '1px solid #444', borderRadius: 5,
    cursor: 'pointer', position: 'relative',
    transition: 'background 0.1s',
  },
  condBtnActive: {},
  condIcon:  { fontSize: 16 },
  condLabel: { color: '#888', fontSize: 10, textAlign: 'center', lineHeight: 1.2 },
  checkMark: {
    position: 'absolute', top: 2, right: 4,
    color: '#7fc272', fontSize: 9, fontWeight: 700,
  },
  concRow: {
    display: 'flex', flexDirection: 'column', gap: 6,
    borderTop: '1px solid #333', paddingTop: 8,
  },
  concBtn: {
    padding: '6px 12px', background: '#2a2a2a',
    border: '1px solid #444', borderRadius: 5,
    color: '#888', cursor: 'pointer', fontSize: 12,
    textAlign: 'left',
  },
  concNote: { color: '#555', fontSize: 11, fontStyle: 'italic' },
}
