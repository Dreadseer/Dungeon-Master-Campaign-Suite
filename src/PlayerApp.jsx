import { useSearchParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import PlayerErrorBoundary      from './components/player/PlayerErrorBoundary'
import PlayerTopBar             from './components/player/PlayerTopBar'
import PlayerCharacterSelect    from './components/player/PlayerCharacterSelect'
import PlayerCharacterSheet     from './components/player/PlayerCharacterSheet'
import PlayerMapView            from './components/player/PlayerMapView'
import PlayerSessionNotes       from './components/player/PlayerSessionNotes'

function PlayerAppInner() {
  const [searchParams]                  = useSearchParams()
  const campaignId                      = parseInt(searchParams.get('campaign'))
  const [campaign,        setCampaign]  = useState(null)
  const [selectedCharId,  setSelectedCharId] = useState(null)
  const [activeView,      setActiveView]     = useState('character') // 'character' | 'map'
  const [broadcastMsg,    setBroadcastMsg]   = useState(null)
  const [connected,       setConnected]      = useState(true)
  const [sessionNotes,    setSessionNotes]   = useState([])
  const [isFullScreen,    setIsFullScreen]   = useState(false)

  // Load campaign on mount
  useEffect(() => {
    if (!campaignId) return
    window.electronAPI.db.campaigns.getById(campaignId).then(setCampaign)
  }, [campaignId])

  // Subscribe to broadcast messages from DM window
  useEffect(() => {
    const handler = (_event, msg) => {
      setBroadcastMsg(msg)
      setConnected(true)
    }
    window.electronAPI.player.onReceive(handler)
    return () => window.electronAPI.player.offReceive(handler)
  }, [])

  // Ping heartbeat — send ping every 10s; if no response in 15s mark disconnected
  useEffect(() => {
    let pingTimer
    let timeoutTimer

    function schedulePing() {
      pingTimer = setTimeout(() => {
        // Treat receiving any broadcast as a pong — connection alive
        // If 15s passes without a broadcast, consider disconnected
        timeoutTimer = setTimeout(() => setConnected(false), 15_000)
        schedulePing()
      }, 10_000)
    }

    // Reset timeout whenever a message arrives
    const resetHandler = () => {
      clearTimeout(timeoutTimer)
      setConnected(true)
    }
    window.electronAPI.player.onReceive(resetHandler)
    schedulePing()

    return () => {
      clearTimeout(pingTimer)
      clearTimeout(timeoutTimer)
      window.electronAPI.player.offReceive(resetHandler)
    }
  }, [])

  // Full screen toggle — button + F11/Escape keyboard shortcuts
  function toggleFullScreen(enterFull) {
    const next = enterFull !== undefined ? enterFull : !isFullScreen
    window.electronAPI.player.setFullScreen(next)
    setIsFullScreen(next)
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F11')    { e.preventDefault(); toggleFullScreen(!isFullScreen) }
      if (e.key === 'Escape' && isFullScreen) { toggleFullScreen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullScreen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-navigate to map view when DM pushes a map; collect session notes
  useEffect(() => {
    if (!broadcastMsg) return
    if (broadcastMsg.type === 'map:set' || broadcastMsg.type === 'map:update') {
      setActiveView('map')
    }
    if (broadcastMsg.type === 'session:note') {
      setSessionNotes(prev => [{
        text:      broadcastMsg.payload.text,
        timestamp: broadcastMsg.payload.timestamp,
        id:        crypto.randomUUID(),
      }, ...prev].slice(0, 20))
    }
  }, [broadcastMsg])

  if (!campaignId) {
    return (
      <div style={s.errorScreen}>
        <p style={s.errorText}>No campaign specified. This window was opened without a campaign ID.</p>
      </div>
    )
  }

  return (
    <div style={s.root}>
      <PlayerTopBar
        campaign={campaign}
        activeView={activeView}
        onViewChange={setActiveView}
        connected={connected}
        isFullScreen={isFullScreen}
        onToggleFullScreen={() => toggleFullScreen()}
      />

      <div style={s.body}>
        {activeView === 'character' && (
          selectedCharId
            ? <PlayerCharacterSheet
                characterId={selectedCharId}
                broadcastMsg={broadcastMsg}
                onBack={() => setSelectedCharId(null)}
              />
            : <PlayerCharacterSelect
                campaignId={campaignId}
                broadcastMsg={broadcastMsg}
                onSelect={setSelectedCharId}
              />
        )}

        {activeView === 'map' && (
          <PlayerMapView
            campaignId={campaignId}
            broadcastMsg={broadcastMsg}
          />
        )}
      </div>

      {/* Floating session notes overlay — visible on both views */}
      <PlayerSessionNotes notes={sessionNotes} />
    </div>
  )
}

export default function PlayerApp() {
  return (
    <PlayerErrorBoundary>
      <PlayerAppInner />
    </PlayerErrorBoundary>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  root:        { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0a05', color: '#e8e0d0', overflow: 'hidden' },
  body:        { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  errorScreen: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0a05' },
  errorText:   { color: '#e05050', fontSize: '1rem', textAlign: 'center', maxWidth: 400 },
}
