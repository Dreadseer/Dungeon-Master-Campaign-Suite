import { useState } from 'react'

export default function SessionNotesOverlay({ notes }) {
  const [expanded, setExpanded] = useState(false)
  if (notes.length === 0) return null

  return (
    <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 200 }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ background: '#C9A84C', border: 'none', color: '#0d0a05',
          borderRadius: '50%', width: '44px', height: '44px',
          fontSize: '18px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center' }}
      >
        📜
      </button>
      {expanded && (
        <div style={{ position: 'absolute', bottom: '52px', right: 0, width: '280px',
          background: '#1a1208', border: '1px solid #C9A84C', borderRadius: '8px',
          padding: '12px', maxHeight: '300px', overflowY: 'auto' }}>
          <div style={{ color: '#C9A84C', fontFamily: 'Georgia', fontSize: '14px',
            marginBottom: '8px', fontWeight: 'bold' }}>Session Notes</div>
          {notes.map(note => (
            <div key={note.id} style={{ borderBottom: '1px solid #2d1f0a',
              padding: '6px 0', fontSize: '13px', color: '#c0b8a8' }}>
              {note.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
