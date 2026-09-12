import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import JoinScreen          from './components/JoinScreen'
import CharacterSheet      from './components/CharacterSheet'
import MapView             from './components/MapView'
import TopBar              from './components/TopBar'
import SessionNotesOverlay from './components/SessionNotesOverlay'
import { apiFetch, setToken } from './api'
import KnownLore           from './components/KnownLore'

export default function PlayerWebApp() {
  const [session,      setSession]   = useState(null)
  const [character,    setCharacter] = useState(null)
  const [activeMap,    setActiveMap] = useState(null)
  const [sessionNotes, setNotes]     = useState([])
  const [activeView,   setView]      = useState('character')
  const [socket,       setSocket]    = useState(null)
  const [connected,    setConnected] = useState(false)
  const [authError,    setAuthError] = useState('')

  // Persist session across page refreshes
  useEffect(() => {
    const saved = sessionStorage.getItem('dmcs-session')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Restore the token into the api module BEFORE any child mounts and
        // starts fetching, or the first request of a reloaded page 401s.
        setToken(parsed.token)
        setSession(parsed)
      } catch { /* corrupt storage — fall through to the join screen */ }
    }
  }, [])

  // WebSocket connection
  useEffect(() => {
    if (!session) return

    // The token now gates the handshake itself — an unauthenticated socket is
    // refused before it connects, rather than connecting and being ignored.
    const sock = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      auth: { token: session.token },
    })
    setSocket(sock)

    sock.on('connect', () => {
      setConnected(true)
      setAuthError('')
      sock.emit('player:identify', { characterId: character?.id ?? null })
    })
    sock.on('disconnect', () => setConnected(false))
    sock.on('connect_error', (err) => {
      setConnected(false)
      // The server rejects the handshake when the token is unknown, which after
      // a DM restart is every token.
      setAuthError(
        /token/i.test(err?.message ?? '')
          ? 'Your session has ended. Reload the page and join again.'
          : `Connection failed: ${err?.message ?? 'unknown error'}`
      )
    })

    // Map pushed by DM
    sock.on('map:set', ({ mapId }) => {
      apiFetch(`/api/map/${mapId}`)
        .then(setActiveMap)
        .catch(err => setAuthError(err.message))
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
        apiFetch(`/api/character/${characterId}`)
          .then(setCharacter)
          .catch(err => setAuthError(err.message))
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
    setToken(sessionData.token)
    setSession(sessionData)
  }

  const handleSelectCharacter = (char) => {
    setCharacter(char)
    if (socket?.connected) {
      socket.emit('player:identify', { characterId: char.id })
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
      {authError && (
        <div style={{ background: '#3a1010', color: '#ffb0b0', padding: '0.6rem 1rem',
          fontSize: '0.85rem', textAlign: 'center' }}>
          {authError}
        </div>
      )}
      <div style={{ flex: 1 }}>
        {activeView === 'character' && (
          <CharacterSheet
            campaignId={session.campaignId}
            character={character}
            onSelectCharacter={handleSelectCharacter}
          />
        )}
        {activeView === 'map' && <MapView map={activeMap} />}
        {activeView === 'known' && <KnownLore campaignId={session.campaignId} />}
      </div>
      <SessionNotesOverlay notes={sessionNotes} />
    </div>
  )
}
