export default function EntityModal({ title, isOpen, onClose, children }) {
  if (!isOpen) return null
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.card} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <h2 style={s.title}>{title}</h2>
          <button style={s.close} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={s.body}>{children}</div>
      </div>
    </div>
  )
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  card: {
    background: '#1a1208', border: '1px solid #c9a84c', borderRadius: 8,
    width: 560, maxWidth: '95vw', maxHeight: '80vh',
    display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '1.25rem 1.5rem', borderBottom: '1px solid #3a2a10', flexShrink: 0,
  },
  title: {
    color: '#c9a84c', fontSize: '1.15rem', fontFamily: 'Georgia, serif', margin: 0,
  },
  close: {
    background: 'none', border: 'none', color: '#7a6035', fontSize: '1rem',
    cursor: 'pointer', padding: '0.25rem 0.5rem', lineHeight: 1,
  },
  body: {
    padding: '1.5rem', overflowY: 'auto', flex: 1,
  },
}
