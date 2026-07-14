import { useState, useEffect, useCallback, useRef } from 'react'
import QRCode from 'qrcode'
import useCampaignStore from '../../stores/campaignStore'

export default function NetworkSessionPanel({ onClose }) {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [status,        setStatus]        = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [tab,           setTab]           = useState('lan')
  const [qrDataUrl,     setQrDataUrl]     = useState(null)
  const [players,       setPlayers]       = useState([])
  const [copied,        setCopied]        = useState(false)
  const [maps,          setMaps]          = useState([])
  const [selectedMapId, setSelectedMapId] = useState('')
  const [pushStatus,    setPushStatus]    = useState('')
  const pollRef = useRef(null)

  // ── Poll server status every 4s ────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const s = await window.electronAPI.server.status()
      setStatus(s)
      setPlayers(s.players ?? [])
    } catch { setStatus(null) }
  }, [])

  useEffect(() => {
    refresh()
    pollRef.current = setInterval(refresh, 4000)
    const onPlayersChanged = (data) => setPlayers(data ?? [])
    window.electronAPI.server.onPlayersChanged(onPlayersChanged)
    return () => {
      clearInterval(pollRef.current)
      window.electronAPI.server.offPlayersChanged(onPlayersChanged)
    }
  }, [refresh])

  // ── Load maps for push-map selector ──────────────────────────────────────────
  useEffect(() => {
    if (!activeCampaign?.id) return
    window.electronAPI.db.maps.getAll(activeCampaign.id)
      .then(data => {
        setMaps(data ?? [])
        if (data?.length > 0 && !selectedMapId) setSelectedMapId(String(data[0].id))
      }).catch(() => {})
  }, [activeCampaign?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Regenerate QR whenever the active URL changes ──────────────────────────
  const activeUrl = tab === 'internet' ? status?.tunnelUrl : status?.localUrl

  const generateQr = useCallback((url) => {
    if (!url) { setQrDataUrl(null); return }
    // For ngrok URLs, append the bypass param so mobile browsers skip the interstitial
    const qrUrl = url.includes('ngrok') ? `${url}?ngrok-skip-browser-warning=1` : url
    QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#C9A84C', light: '#0d0a05' },
      width: 256,
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [])

  useEffect(() => { generateQr(activeUrl) }, [activeUrl, generateQr])

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleStart() {
    setLoading(true); setError('')
    try {
      const preferred = parseInt(localStorage.getItem('dmcs-preferred-port') ?? '3001', 10)
      await window.electronAPI.server.start(preferred)
      await refresh()
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  async function handleStop() {
    if (players.length > 0 && !window.confirm(`${players.length} player(s) connected. Stop server?`)) return
    setLoading(true); setError('')
    try {
      await window.electronAPI.server.stop()
      await refresh()
      setQrDataUrl(null)
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  async function handleOpenTunnel() {
    setLoading(true); setError('')
    try {
      await window.electronAPI.server.tunnel.open()
      await refresh()
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  async function handleCloseTunnel() {
    setLoading(true); setError('')
    try {
      await window.electronAPI.server.tunnel.close()
      await refresh()
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  async function handleKick(socketId) {
    try {
      await window.electronAPI.server.kick(socketId)
    } catch { /* ignore */ }
  }

  async function handleCopy(url) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  async function handlePushMap() {
    const mapId = parseInt(selectedMapId, 10)
    if (!mapId || !activeCampaign?.id) return
    try {
      await window.electronAPI.server.broadcast({
        campaignId: activeCampaign.id,
        type:       'map:set',
        payload:    { mapId },
      })
      setPushStatus('🗺️ Map pushed!')
      setTimeout(() => setPushStatus(''), 3000)
    } catch {
      setPushStatus('❌ Push failed')
      setTimeout(() => setPushStatus(''), 3000)
    }
  }

  const isRunning  = status?.isRunning ?? false
  const tunnelOpen = status?.tunnelOpen ?? false

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerTitle}>🌐 Network Session</span>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={s.scroll}>

        {/* ── Section 1: Server controls ── */}
        <div style={s.section}>
          <div style={s.serverStatus}>
            <div style={{ ...s.statusDot, background: isRunning ? '#27ae60' : '#e74c3c',
              boxShadow: isRunning ? '0 0 6px #27ae60' : 'none' }} />
            <span style={{ ...s.statusText, color: isRunning ? '#5dc45d' : '#e74c3c' }}>
              {isRunning ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>

          {isRunning && status?.port && (
            <div style={s.portLine}>Listening on port {status.port}</div>
          )}

          <div style={s.btnRow}>
            <button style={{ ...s.btnPrimary, opacity: isRunning ? 0.4 : 1 }}
              disabled={isRunning || loading} onClick={handleStart}>
              Start Server
            </button>
            <button style={{ ...s.btnDanger, opacity: !isRunning ? 0.4 : 1 }}
              disabled={!isRunning || loading} onClick={handleStop}>
              Stop
            </button>
          </div>

          {isRunning && status?.localUrl && (
            <div style={s.urlChip} onClick={() => handleCopy(status.localUrl)} title="Click to copy">
              <span style={s.urlText}>{status.localUrl}</span>
              <span style={s.copyBadge}>{copied ? '✓' : '⎘'}</span>
            </div>
          )}
        </div>

        {/* ── Section 2: Connection mode ── */}
        {isRunning && (
          <div style={s.section}>
            <div style={s.tabs}>
              {['lan', 'internet'].map(t => (
                <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
                  onClick={() => setTab(t)}>
                  {t === 'lan' ? '🏠 LAN Mode' : '🌍 Internet (ngrok)'}
                </button>
              ))}
            </div>

            {tab === 'lan' && (
              <p style={s.modeHint}>
                Players on the same Wi-Fi network can connect using the URL above.
              </p>
            )}

            {tab === 'internet' && (
              tunnelOpen ? (
                <div>
                  <div style={{ ...s.urlChip, border: '1px solid #C9A84C' }}
                    onClick={() => handleCopy(`${status.tunnelUrl}?ngrok-skip-browser-warning=1`)} title="Click to copy">
                    <span style={{ ...s.urlText, color: '#C9A84C' }}>{status.tunnelUrl}</span>
                    <span style={s.copyBadge}>{copied ? '✓' : '⎘'}</span>
                  </div>
                  <button style={{ ...s.btnDanger, width: '100%', marginTop: 8 }}
                    onClick={handleCloseTunnel} disabled={loading}>
                    Close Tunnel
                  </button>
                </div>
              ) : (
                <div>
                  <p style={s.modeHint}>
                    Opens a public HTTPS tunnel so players anywhere can connect.
                    Requires an ngrok token in Settings.
                  </p>
                  <button style={{ ...s.btnPrimary, width: '100%' }}
                    onClick={handleOpenTunnel} disabled={loading}>
                    {loading ? 'Opening…' : 'Open Tunnel'}
                  </button>
                </div>
              )
            )}
          </div>
        )}

        {/* ── Section 3: QR Code ── */}
        {isRunning && activeUrl && (
          <div style={s.section}>
            <p style={s.sectionLabel}>Scan to Join</p>
            {qrDataUrl ? (
              <div style={{ textAlign: 'center' }}>
                <img src={qrDataUrl} alt="QR code" width={200} height={200}
                  style={{ display: 'block', margin: '0 auto 8px', borderRadius: 4 }} />
                <div style={s.urlRaw}>{activeUrl}</div>
                <button style={{ ...s.btnSecondary, marginTop: 8 }}
                  onClick={() => generateQr(activeUrl)}>
                  Regenerate
                </button>
              </div>
            ) : (
              <div style={{ color: '#555', fontSize: 12, textAlign: 'center' }}>Generating…</div>
            )}
          </div>
        )}

        {/* ── Section 4: Push map to network players ── */}
        {isRunning && (
          <div style={s.section}>
            <p style={s.sectionLabel}>Push Map to Players</p>
            <select
              style={s.select}
              value={selectedMapId}
              onChange={e => setSelectedMapId(e.target.value)}
            >
              {maps.length === 0 && <option value="">No maps in campaign</option>}
              {maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button
              style={{ ...s.btnPrimary, width: '100%', opacity: (!selectedMapId || maps.length === 0) ? 0.45 : 1 }}
              disabled={!selectedMapId || maps.length === 0}
              onClick={handlePushMap}
            >
              Push Map →
            </button>
            {pushStatus && <div style={s.pushToast}>{pushStatus}</div>}
          </div>
        )}

        {/* ── Section 5: Player roster ── */}
        <div style={s.section}>
          <p style={s.sectionLabel}>
            Connected Players
            <span style={s.playerCount}>{players.length}</span>
          </p>
          {players.length === 0 ? (
            <div style={s.emptyRoster}>No players connected</div>
          ) : (
            players.map(p => (
              <div key={p.socketId} style={s.playerRow}>
                <div style={s.playerDot} />
                <div style={s.playerInfo}>
                  <div style={s.playerName}>{p.playerName}</div>
                  {p.characterId && (
                    <div style={s.playerChar}>Char #{p.characterId}</div>
                  )}
                </div>
                <button style={s.kickBtn} onClick={() => handleKick(p.socketId)}
                  title="Disconnect this player">
                  Kick
                </button>
              </div>
            ))
          )}
        </div>

        {error && <div style={s.errorBox}>{error}</div>}
      </div>
    </div>
  )
}

const s = {
  panel: {
    position: 'fixed', top: 56, right: 0,
    width: 320, height: 'calc(100vh - 56px)',
    background: '#0d0a05', borderLeft: '1px solid #3a2a10',
    display: 'flex', flexDirection: 'column',
    zIndex: 101, boxShadow: '-4px 0 16px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.75rem 1rem', borderBottom: '1px solid #2a1c08', flexShrink: 0,
  },
  headerTitle: { color: '#c9a84c', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'Georgia' },
  closeBtn:    { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '1rem' },
  scroll:      { flex: 1, overflowY: 'auto' },
  section:     { padding: '0.75rem 1rem', borderBottom: '1px solid #1a1208' },
  sectionLabel:{ color: '#a89060', fontSize: '0.75rem', textTransform: 'uppercase',
    letterSpacing: '0.06em', margin: '0 0 0.6rem', display: 'flex',
    alignItems: 'center', gap: 6 },
  serverStatus:{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusDot:   { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  statusText:  { fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.06em' },
  portLine:    { color: '#555', fontSize: '0.75rem', fontFamily: 'monospace', marginBottom: 8 },
  btnRow:      { display: 'flex', gap: 8, marginBottom: 8 },
  btnPrimary:  { flex: 1, background: '#c9a84c', color: '#0d0a05', border: 'none',
    padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #3a2a10',
    padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' },
  btnDanger:   { background: 'transparent', color: '#e05050', border: '1px solid #6a2020',
    padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' },
  urlChip:     { display: 'flex', alignItems: 'center', gap: 6, background: '#1a1208',
    border: '1px solid #3a2a10', borderRadius: 4, padding: '5px 10px',
    cursor: 'pointer', marginTop: 4 },
  urlText:     { color: '#a89060', fontSize: '0.75rem', fontFamily: 'monospace',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  copyBadge:   { color: '#555', fontSize: '0.8rem', flexShrink: 0 },
  tabs:        { display: 'flex', gap: 4, marginBottom: 10 },
  tab:         { flex: 1, background: 'transparent', border: '1px solid #3a2a10',
    color: '#6b5a3a', padding: '5px 4px', borderRadius: 4,
    cursor: 'pointer', fontSize: '0.75rem' },
  tabActive:   { background: '#1a1208', border: '1px solid #c9a84c', color: '#c9a84c' },
  modeHint:    { color: '#555', fontSize: '0.78rem', lineHeight: 1.5, margin: '0 0 8px' },
  urlRaw:      { color: '#555', fontSize: '0.7rem', fontFamily: 'monospace',
    wordBreak: 'break-all', textAlign: 'center' },
  playerCount: { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 10,
    padding: '1px 7px', fontSize: '0.7rem', color: '#c9a84c' },
  emptyRoster: { color: '#444', fontSize: '0.8rem', fontStyle: 'italic' },
  playerRow:   { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
    borderBottom: '1px solid #12100a' },
  playerDot:   { width: 7, height: 7, borderRadius: '50%', background: '#27ae60',
    boxShadow: '0 0 4px #27ae60', flexShrink: 0 },
  playerInfo:  { flex: 1, minWidth: 0 },
  playerName:  { color: '#c0b8a8', fontSize: '0.82rem', fontWeight: 600 },
  playerChar:  { color: '#555', fontSize: '0.72rem' },
  kickBtn:     { background: 'transparent', border: '1px solid #4a1a1a', color: '#955',
    padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: '0.72rem', flexShrink: 0 },
  select:      { width: '100%', background: '#0a0805', border: '1px solid #3a2a10',
    borderRadius: 4, color: '#e8e0d0', padding: '0.4rem 0.6rem',
    fontSize: '0.82rem', marginBottom: '0.5rem', outline: 'none' },
  pushToast:   { marginTop: 6, color: '#8ada8a', fontSize: '0.78rem', textAlign: 'center' },
  errorBox:    { margin: '0.5rem 1rem', background: '#2a0a00', border: '1px solid #8B0000',
    borderRadius: 4, padding: '8px 12px', color: '#f08080', fontSize: '0.8rem' },
}
