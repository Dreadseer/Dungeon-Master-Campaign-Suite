import { useState, useEffect, useRef, useCallback } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import usePlayerStore   from '../../stores/playerStore'

export default function DMPlayerControls({ onClose }) {
  const activeCampaign     = useCampaignStore(s => s.activeCampaign)
  const playerWindowOpen   = usePlayerStore(s => s.playerWindowOpen)
  const setPlayerWindowOpen = usePlayerStore(s => s.setPlayerWindowOpen)
  const autoSync           = usePlayerStore(s => s.autoSync)
  const setAutoSync        = usePlayerStore(s => s.setAutoSync)

  // Map list for push-map dropdown
  const [maps,          setMaps]          = useState([])
  const [selectedMapId, setSelectedMapId] = useState('')

  // Character list for sync buttons
  const [characters, setCharacters] = useState([])

  // Session notes
  const [noteText,    setNoteText]    = useState('')
  const [sentNotes,   setSentNotes]   = useState([])
  const [noteSending, setNoteSending] = useState(false)

  // Status messages
  const [statusMsg, setStatusMsg] = useState('')
  const statusRef = useRef(null)

  // ── Poll player window status every 3s ────────────────────────────────────
  useEffect(() => {
    async function poll() {
      try {
        const { isOpen } = await window.electronAPI.player.isOpen()
        setPlayerWindowOpen(isOpen)
      } catch { setPlayerWindowOpen(false) }
    }
    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [setPlayerWindowOpen])

  // ── Load maps and characters on campaign change ───────────────────────────
  useEffect(() => {
    if (!activeCampaign?.id) return
    window.electronAPI.db.maps.getAll(activeCampaign.id)
      .then(data => {
        setMaps(data ?? [])
        if (data?.length > 0 && !selectedMapId) setSelectedMapId(String(data[0].id))
      }).catch(() => {})
    window.electronAPI.db.characters.getAll(activeCampaign.id)
      .then(data => setCharacters(data ?? []))
      .catch(() => {})
  }, [activeCampaign?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status toast helper ───────────────────────────────────────────────────
  const showStatus = useCallback((msg) => {
    setStatusMsg(msg)
    clearTimeout(statusRef.current)
    statusRef.current = setTimeout(() => setStatusMsg(''), 3000)
  }, [])

  // ── Open / close player window ────────────────────────────────────────────
  async function handleOpen() {
    if (!activeCampaign) return
    await window.electronAPI.player.openWindow(activeCampaign.id)
    setPlayerWindowOpen(true)
    showStatus('✅ Player window opened')
  }

  async function handleClose() {
    await window.electronAPI.player.closeWindow()
    setPlayerWindowOpen(false)
    showStatus('Player window closed')
  }

  // ── Push map to players ───────────────────────────────────────────────────
  async function handlePushMap() {
    const mapId = parseInt(selectedMapId, 10)
    if (!mapId) return
    window.electronAPI.player.broadcast({ type: 'map:set', payload: { mapId } })
    showStatus(`🗺️ Map pushed to players`)
  }

  // ── Sync current fog & tokens ─────────────────────────────────────────────
  async function handleSyncFogTokens() {
    const mapId = parseInt(selectedMapId, 10)
    if (!mapId) return
    try {
      const map = await window.electronAPI.db.maps.getById(mapId)
      if (!map) return
      window.electronAPI.player.broadcast({
        type: 'map:update',
        payload: {
          mapId,
          fogData: JSON.parse(map.fog_data ?? '[]'),
          tokens:  JSON.parse(map.tokens   ?? '[]'),
        },
      })
      showStatus('✅ Fog & tokens synced')
    } catch {
      showStatus('❌ Sync failed')
    }
  }

  // ── Send session note ─────────────────────────────────────────────────────
  async function handleSendNote() {
    const text = noteText.trim()
    if (!text) return
    setNoteSending(true)
    const payload = { text, timestamp: Date.now() }
    window.electronAPI.player.broadcast({ type: 'session:note', payload })
    setSentNotes(prev => [{ ...payload, id: Date.now() }, ...prev].slice(0, 5))
    setNoteText('')
    setNoteSending(false)
    showStatus('📝 Note sent to players')
  }

  // ── Sync all characters ───────────────────────────────────────────────────
  function handleSyncAll() {
    characters.forEach(c => {
      window.electronAPI.player.broadcast({
        type: 'character:sync',
        payload: { characterId: c.id },
      })
    })
    showStatus(`✅ Synced ${characters.length} character${characters.length !== 1 ? 's' : ''}`)
  }

  function handleSyncOne(char) {
    window.electronAPI.player.broadcast({
      type: 'character:sync',
      payload: { characterId: char.id },
    })
    showStatus(`✅ Synced ${char.character_name}`)
  }

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerTitle}>👥 Player View</span>
        <button style={s.closeBtn} onClick={onClose} title="Close panel">✕</button>
      </div>

      {/* Status badge */}
      <div style={s.statusRow}>
        <span style={{ ...s.statusDot, background: playerWindowOpen ? '#4caf50' : '#e05050' }} />
        <span style={{ ...s.statusLabel, color: playerWindowOpen ? '#8ada8a' : '#e05050' }}>
          {playerWindowOpen ? 'OPEN' : 'CLOSED'}
        </span>
      </div>

      {/* Window controls */}
      <div style={s.section}>
        <div style={s.btnRow}>
          <button
            style={{ ...s.btnPrimary, opacity: playerWindowOpen ? 0.45 : 1 }}
            onClick={handleOpen}
            disabled={playerWindowOpen || !activeCampaign}
          >
            Open Player View
          </button>
          <button
            style={{ ...s.btnDanger, opacity: !playerWindowOpen ? 0.45 : 1 }}
            onClick={handleClose}
            disabled={!playerWindowOpen}
          >
            Close
          </button>
        </div>
      </div>

      {/* Map sharing */}
      <div style={s.section}>
        <p style={s.sectionTitle}>Map Sharing</p>
        <select
          style={s.select}
          value={selectedMapId}
          onChange={e => setSelectedMapId(e.target.value)}
        >
          {maps.length === 0 && <option value="">No maps</option>}
          {maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div style={s.btnRow}>
          <button style={s.btnSecondary} onClick={handlePushMap} disabled={!selectedMapId || !playerWindowOpen}>
            Push Map →
          </button>
          <button style={s.btnSecondary} onClick={handleSyncFogTokens} disabled={!selectedMapId || !playerWindowOpen}>
            Sync Fog
          </button>
        </div>

        {/* Auto-sync toggle */}
        <label style={s.toggleRow}>
          <input
            type="checkbox"
            checked={autoSync}
            onChange={e => setAutoSync(e.target.checked)}
            style={{ accentColor: '#c9a84c' }}
          />
          <span style={s.toggleLabel}>
            Auto-sync fog &amp; tokens
            {autoSync && <span style={s.autoSyncBadge}>ON</span>}
          </span>
        </label>
        {autoSync && (
          <p style={s.autoSyncHint}>
            Fog paints broadcast after 500ms · token moves broadcast immediately
          </p>
        )}
      </div>

      {/* Session notes */}
      <div style={s.section}>
        <p style={s.sectionTitle}>Session Notes</p>
        <textarea
          style={s.textarea}
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          placeholder="Share a note with players…"
          rows={3}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSendNote() }}
        />
        <button
          style={s.btnPrimary}
          onClick={handleSendNote}
          disabled={!noteText.trim() || noteSending || !playerWindowOpen}
        >
          Send Note
        </button>

        {sentNotes.length > 0 && (
          <div style={s.noteHistory}>
            <p style={s.sectionTitle}>Last sent</p>
            {sentNotes.map(n => (
              <div key={n.id} style={s.noteHistoryItem}>
                <span style={s.noteHistoryText}>{n.text}</span>
                <span style={s.noteHistoryTime}>{formatAge(n.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Character sync */}
      <div style={s.section}>
        <p style={s.sectionTitle}>Character Sync</p>
        <button
          style={s.btnSecondary}
          onClick={handleSyncAll}
          disabled={characters.length === 0 || !playerWindowOpen}
        >
          Sync All ({characters.length})
        </button>
        {characters.map(c => (
          <button
            key={c.id}
            style={s.charSyncBtn}
            onClick={() => handleSyncOne(c)}
            disabled={!playerWindowOpen}
          >
            {c.character_name}
          </button>
        ))}
      </div>

      {/* Toast status */}
      {statusMsg && <div style={s.toast}>{statusMsg}</div>}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)  return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return `${Math.floor(s / 3600)}h ago`
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  panel: {
    position:      'fixed',
    top:           56,    // below TopBar
    right:         0,
    width:         320,
    height:        'calc(100vh - 56px)',
    background:    '#0d0a05',
    borderLeft:    '1px solid #3a2a10',
    display:       'flex',
    flexDirection: 'column',
    zIndex:        100,
    overflowY:     'auto',
    boxShadow:     '-4px 0 16px rgba(0,0,0,0.5)',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '0.75rem 1rem',
    borderBottom:   '1px solid #2a1c08',
    flexShrink:     0,
  },
  headerTitle: { color: '#c9a84c', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'Georgia, serif' },
  closeBtn:    { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '1rem', padding: 0 },
  statusRow:   { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 1rem 0', flexShrink: 0 },
  statusDot:   { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  statusLabel: { fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.05em' },

  section:      { padding: '0.75rem 1rem', borderBottom: '1px solid #1a1208' },
  sectionTitle: { color: '#a89060', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.5rem', fontWeight: 600 },

  btnRow:     { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' },
  btnPrimary: { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem', flex: 1 },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #3a2a10', padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', width: '100%', marginBottom: '0.35rem', textAlign: 'left' },
  btnDanger:  { background: 'transparent', color: '#e05050', border: '1px solid #6a2020', padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', flexShrink: 0 },

  select:     { width: '100%', background: '#0a0805', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.4rem 0.6rem', fontSize: '0.82rem', marginBottom: '0.5rem', outline: 'none' },

  toggleRow:   { display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginTop: '0.25rem' },
  toggleLabel: { color: '#a89060', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  autoSyncBadge:{ background: '#1a3a1a', border: '1px solid #3a6a3a', color: '#8ada6a', fontSize: '0.68rem', padding: '0.05rem 0.3rem', borderRadius: 3, fontWeight: 700 },
  autoSyncHint: { color: '#4a3a1a', fontSize: '0.72rem', margin: '0.3rem 0 0', lineHeight: 1.5 },

  textarea: { width: '100%', background: '#0a0805', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.5rem', fontSize: '0.82rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: '0.5rem', lineHeight: 1.5 },

  noteHistory:     { marginTop: '0.75rem' },
  noteHistoryItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', padding: '0.3rem 0', borderBottom: '1px solid #1a1208' },
  noteHistoryText: { color: '#a89060', fontSize: '0.78rem', flex: 1, lineHeight: 1.4 },
  noteHistoryTime: { color: '#4a3a1a', fontSize: '0.68rem', flexShrink: 0, marginTop: 2 },

  charSyncBtn: { background: 'transparent', color: '#a89060', border: '1px solid #2a1c08', padding: '0.25rem 0.6rem', borderRadius: 3, cursor: 'pointer', fontSize: '0.78rem', width: '100%', textAlign: 'left', marginBottom: '0.25rem', display: 'block' },

  toast: { position: 'sticky', bottom: 0, background: '#1a2a1a', borderTop: '1px solid #2a5a2a', color: '#8ada8a', fontSize: '0.8rem', padding: '0.5rem 1rem', textAlign: 'center' },
}
