import { useState } from 'react'

export default function EntityCard({
  title, subtitle, tags = [], meta, onClick, onDelete,
  accentColor = '#c9a84c', children,
}) {
  const [confirming, setConfirming] = useState(false)

  function handleDelete(e) {
    e.stopPropagation()
    if (!confirming) { setConfirming(true); return }
    setConfirming(false)
    onDelete()
  }

  function handleCancelDelete(e) {
    e.stopPropagation()
    setConfirming(false)
  }

  return (
    <div
      style={{ ...s.card, borderLeftColor: accentColor }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = '#141008'}
      onMouseLeave={e => e.currentTarget.style.background = '#0d0a05'}
    >
      <div style={s.top}>
        <div style={s.left}>
          <div style={{ ...s.title, color: accentColor === '#c9a84c' ? '#e8e0d0' : accentColor }}>
            {title}
          </div>
          {subtitle && <div style={s.subtitle}>{subtitle}</div>}
          {tags.length > 0 && (
            <div style={s.tags}>
              {tags.map((tag, i) => (
                <span key={i} style={{ ...s.tag, background: tag.color || '#2d1f0a', color: tag.text || '#c9a84c' }}>
                  {typeof tag === 'string' ? tag : tag.label}
                </span>
              ))}
            </div>
          )}
          {children}
        </div>
        <div style={s.right}>
          {meta && <span style={s.meta}>{meta}</span>}
          {onDelete && (
            confirming ? (
              <div style={s.confirmRow} onClick={e => e.stopPropagation()}>
                <span style={s.confirmText}>Sure?</span>
                <button style={s.btnYes} onClick={handleDelete}>Yes</button>
                <button style={s.btnNo}  onClick={handleCancelDelete}>No</button>
              </div>
            ) : (
              <button style={s.deleteBtn} onClick={handleDelete} title="Delete">✕</button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

const s = {
  card: {
    background: '#0d0a05', borderLeft: '4px solid #c9a84c',
    borderRadius: '0 6px 6px 0', padding: '0.9rem 1rem',
    cursor: 'pointer', transition: 'background 0.1s',
    border: '1px solid #2a1c08', borderLeftWidth: 4,
  },
  top:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' },
  left:     { flex: 1, minWidth: 0 },
  right:    { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem', flexShrink: 0 },
  title:    { fontSize: '0.95rem', fontWeight: 'bold', color: '#e8e0d0', marginBottom: '0.2rem' },
  subtitle: { fontSize: '0.8rem', color: '#a89060', marginBottom: '0.35rem' },
  tags:     { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' },
  tag:      { fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: 10, background: '#2d1f0a', color: '#c9a84c' },
  meta:     { fontSize: '0.72rem', color: '#5a4a2a', whiteSpace: 'nowrap' },
  deleteBtn:    { background: 'none', border: 'none', color: '#6a3030', cursor: 'pointer', fontSize: '0.8rem', padding: '0.1rem 0.3rem' },
  confirmRow:   { display: 'flex', alignItems: 'center', gap: '0.3rem' },
  confirmText:  { fontSize: '0.75rem', color: '#e05050' },
  btnYes:       { background: '#6a1a1a', color: '#ffaaaa', border: 'none', borderRadius: 3, padding: '0.15rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' },
  btnNo:        { background: '#2d1f0a', color: '#a89060', border: 'none', borderRadius: 3, padding: '0.15rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' },
}
