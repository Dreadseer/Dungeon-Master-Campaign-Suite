import { useState } from 'react'

/**
 * Clickable subclass selection card.
 *
 * Props:
 *   subclass  — subclass row from DB (class_name, name, description, unlock_level, features JSON)
 *   selected  — whether this card is the currently selected subclass
 *   onSelect  — called when the card is clicked (for selection)
 */
export default function SubclassCard({ subclass, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  const features = JSON.parse(subclass.features ?? '[]')

  return (
    <div
      onClick={onSelect}
      style={{
        border:       selected ? '2px solid #C9A84C' : '1px solid #2d1f0a',
        borderLeft:   `4px solid ${selected ? '#C9A84C' : '#3d2f1a'}`,
        borderRadius: '8px',
        padding:      '14px',
        marginBottom: '10px',
        background:   selected ? '#1a1208' : '#0d0a05',
        cursor:       onSelect ? 'pointer' : 'default',
        boxShadow:    selected ? '0 0 10px rgba(201,168,76,0.3)' : 'none',
        transition:   'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{
            fontFamily: 'Georgia, serif',
            fontSize:   '16px',
            fontWeight: 'bold',
            color:      selected ? '#C9A84C' : '#e8e0d0',
          }}>
            {subclass.name}
          </div>
          <div style={{ fontSize: '12px', color: '#6b6b6b', marginTop: '2px' }}>
            {subclass.class_name} · Unlocks at Level {subclass.unlock_level}
          </div>
        </div>
        {selected && <span style={{ color: '#C9A84C', fontSize: '20px', flexShrink: 0, marginLeft: 8 }}>✓</span>}
      </div>

      {/* Description */}
      <p style={{ fontSize: '13px', color: '#c0b8a8', marginTop: '8px', lineHeight: '1.5', marginBottom: 0, whiteSpace: 'pre-wrap' }}>
        {subclass.description}
      </p>

      {/* Features toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(ex => !ex) }}
        style={{
          background:  'none',
          border:      'none',
          color:       '#6b6b6b',
          fontSize:    '12px',
          cursor:      'pointer',
          padding:     '4px 0',
          marginTop:   '6px',
        }}
      >
        {expanded
          ? '▲ Hide features'
          : `▼ See ${features.length} feature${features.length !== 1 ? 's' : ''}`}
      </button>

      {/* Feature list */}
      {expanded && (
        <div style={{ marginTop: '8px', borderTop: '1px solid #2d1f0a', paddingTop: '8px' }}>
          {features.map((f, i) => (
            <div key={i} style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 'bold', color: '#C9A84C', fontSize: '13px' }}>{f.name}</span>
                <span style={{ fontSize: '11px', color: '#6b6b6b' }}>(Level {f.level_gained})</span>
              </div>
              <p style={{ fontSize: '12px', color: '#c0b8a8', margin: '2px 0 0', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                {f.description}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
