import { useState, useEffect, useRef } from 'react'

// Floating overlay (bottom-right), collapsible, max 20 notes.
// Receives notes array from PlayerApp via props.

export default function PlayerSessionNotes({ notes }) {
  const [collapsed,  setCollapsed]  = useState(false)
  const [hasNew,     setHasNew]     = useState(false)
  const [flashId,    setFlashId]    = useState(null)  // id of most-recently-arrived note
  const prevCountRef = useRef(notes.length)

  // Detect new note arrival — flash and badge
  useEffect(() => {
    if (notes.length > prevCountRef.current) {
      const newest = notes[0]
      setFlashId(newest.id)
      setHasNew(collapsed)   // only badge when collapsed
      setTimeout(() => setFlashId(null), 1000)
    }
    prevCountRef.current = notes.length
  }, [notes, collapsed])

  // Clear badge when expanding
  function handleToggle() {
    setCollapsed(c => {
      if (c) setHasNew(false)   // expanding — clear badge
      return !c
    })
  }

  if (notes.length === 0) return null

  return (
    <div style={s.root}>
      {/* Header / toggle */}
      <button style={s.header} onClick={handleToggle}>
        <span style={s.headerLabel}>📝 Session Notes</span>
        <span style={s.headerRight}>
          {hasNew && <span style={s.badge} />}
          <span style={s.arrow}>{collapsed ? '▲' : '▼'}</span>
        </span>
      </button>

      {/* Notes list */}
      {!collapsed && (
        <div style={s.notesList}>
          {notes.map(note => (
            <div
              key={note.id}
              style={{
                ...s.noteItem,
                ...(flashId === note.id ? s.noteFlash : {}),
              }}
            >
              <p style={s.noteText}>{note.text}</p>
              <span style={s.noteTime}>{formatAge(note.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatAge(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)   return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  root: {
    position:   'fixed',
    bottom:     16,
    right:      16,
    width:      280,
    background: 'rgba(13,10,5,0.95)',
    border:     '1px solid #3a2a10',
    borderRadius: 6,
    zIndex:     50,
    boxShadow:  '0 2px 16px rgba(0,0,0,0.7)',
    overflow:   'hidden',
    userSelect: 'none',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '0.5rem 0.75rem',
    background:     'transparent',
    border:         'none',
    cursor:         'pointer',
    width:          '100%',
    borderBottom:   '1px solid #2a1c08',
  },
  headerLabel: { color: '#c9a84c', fontSize: '0.82rem', fontWeight: 700 },
  headerRight: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  badge: {
    width:        8,
    height:       8,
    borderRadius: '50%',
    background:   '#e05050',
    boxShadow:    '0 0 6px rgba(224,80,80,0.8)',
  },
  arrow: { color: '#6b5a3a', fontSize: '0.7rem' },

  notesList: { maxHeight: 240, overflowY: 'auto', padding: '0.25rem 0' },

  noteItem: {
    padding:      '0.45rem 0.75rem',
    borderBottom: '1px solid #1a1208',
    transition:   'background 0.3s ease',
  },
  noteFlash: {
    background:   'rgba(201, 168, 76, 0.18)',
    borderLeft:   '2px solid #c9a84c',
  },
  noteText: {
    color:      '#e8e0d0',
    fontSize:   '0.82rem',
    lineHeight: 1.5,
    margin:     '0 0 0.15rem',
  },
  noteTime: {
    color:    '#4a3a1a',
    fontSize: '0.68rem',
    display:  'block',
  },
}
