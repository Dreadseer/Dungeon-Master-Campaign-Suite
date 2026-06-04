import { useEffect, useRef } from 'react'

// Entry type → colour
const TYPE_COLOR = {
  start:      '#c9a84c',
  turn:       '#c9a84c',
  round:      '#c9a84c',
  damage:     '#e05050',
  defeat:     '#e05050',
  heal:       '#7fc272',
  unconscious:'#c9a84c',
  condition:  '#aaa',
  concentration: '#b07cf7',
  end:        '#c9a84c',
}

export default function CombatLog({ entries, onClear }) {
  const bottomRef = useRef(null)

  // Auto-scroll to latest entry
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  const handleExport = () => {
    const text = entries
      .slice()
      .reverse()                                    // oldest first in export
      .map(e => `[Round ${e.round}] ${e.text}`)
      .join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>Combat Log</span>
        <div style={s.headerBtns}>
          <button style={s.iconBtn} onClick={handleExport} title="Copy log to clipboard">📋 Export</button>
          <button style={s.iconBtn} onClick={onClear}      title="Clear log">🗑 Clear</button>
        </div>
      </div>

      <div style={s.entryList}>
        {/* Render newest first */}
        {[...entries].reverse().map(e => (
          <div key={e.id} style={s.entry}>
            <span style={{ ...s.entryText, color: TYPE_COLOR[e.type] ?? '#aaa' }}>
              {e.text}
            </span>
            <span style={s.entryRound}>R{e.round}</span>
          </div>
        ))}
        {entries.length === 0 && (
          <p style={s.empty}>No events yet.</p>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

const s = {
  panel: {
    display: 'flex', flexDirection: 'column',
    width: 260, flexShrink: 0,
    background: '#111', borderLeft: '1px solid #2a2a2a',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', background: '#1a1a1a', borderBottom: '1px solid #2a2a2a',
    flexShrink: 0,
  },
  title:      { color: '#666', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 },
  headerBtns: { display: 'flex', gap: 4 },
  iconBtn: {
    background: 'none', border: 'none', color: '#555',
    cursor: 'pointer', fontSize: 11, padding: '2px 4px',
  },
  entryList: {
    flex: 1, overflowY: 'auto', padding: '6px 0',
    display: 'flex', flexDirection: 'column', gap: 0,
  },
  entry: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 6, padding: '3px 10px',
  },
  entryText:  { fontSize: 11, lineHeight: 1.4, flex: 1 },
  entryRound: { color: '#333', fontSize: 10, flexShrink: 0, marginTop: 1 },
  empty:      { color: '#333', fontSize: 11, textAlign: 'center', padding: '16px 10px', margin: 0 },
}
