import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import JoinScreen          from './components/JoinScreen'
import CharacterSheet      from './components/CharacterSheet'
import MapView             from './components/MapView'
import TopBar              from './components/TopBar'
import SessionNotesOverlay from './components/SessionNotesOverlay'

export default function PlayerWebApp() {
  const [session,      setSession]   = useState(null)
  const [character,    setCharacter] = useState(null)
  const [activeMap,    setActiveMap] = useState(null)
  const [sessionNotes, setNotes]     = useState([])
  const [activeView,   setView]      = useState('character')
  const [socket,       setSocket]    = useState(null)
  const [connected,    setConnected] = useState(false)

  // Persist session across page refreshes
  useEffect(() => {
    const saved = sessionStorage.getItem('dmcs-session')
    if (saved) { try { setSession(JSON.parse(saved)) } catch {} }
  }, [])

  // WebSocket connection
  useEffect(() => {
    if (!session) return

    const sock = io(window.location.origin, { transports: ['websocket', 'polling'] })
    setSocket(sock)

    sock.on('connect', () => {
      setConnected(true)
      sock.emit('player:identify', { token: session.token, characterId: character?.id ?? null })
    })
    sock.on('disconnect', () => setConnected(false))

    // Map pushed by DM
    sock.on('map:set', ({ mapId }) => {
      fetch(`/api/map/${mapId}`).then(r => r.json()).then(setActiveMap)
      setView('map')
    })

    // Map fog/token update
    sock.on('map:update', ({ mapId, fogData, tokens }) => {
      setActiveMap(prev => prev?.id === mapId
        ? { ...prev, fog_data: JSON.stringify(fogData), tokens: JSON.stringify(tokens) }
        : prev
      )
    })

    // HP/stats sync
    sock.on('character:sync', ({ characterId }) => {
      if (character?.id === characterId) {
        fetch(`/api/character/${characterId}`).then(r => r.json()).then(setCharacter)
      }
    })

    // DM session note
    sock.on('session:note', ({ text, timestamp }) => {
      setNotes(prev => [{ text, timestamp, id: crypto.randomUUID() }, ...prev].slice(0, 20))
    })

    return () => sock.disconnect()
  }, [session, character?.id]) // eslint-disable-line

  const handleJoin = (sessionData) => {
    sessionStorage.setItem('dmcs-session', JSON.stringify(sessionData))
    setSession(sessionData)
  }

  const handleSelectCharacter = (char) => {
    setCharacter(char)
    if (socket?.connected) {
      socket.emit('player:identify', { token: session.token, characterId: char.id })
    }
  }

  if (!session) return <JoinScreen onJoin={handleJoin} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBar
        campaignName={session.campaignName}
        playerName={session.playerName}
        connected={connected}
        activeView={activeView}
        onViewChange={setView}
      />
      <div style={{ flex: 1 }}>
        {activeView === 'character' && (
          <CharacterSheet
            campaignId={session.campaignId}
            character={character}
            onSelectCharacter={handleSelectCharacter}
          />
        )}
        {activeView === 'map' && <MapView map={activeMap} />}
      </div>
      <SessionNotesOverlay notes={sessionNotes} />
    </div>
  )
}
