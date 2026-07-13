import { useState } from 'react'

export default function JoinScreen({ onJoin }) {
  const [campaignId, setCampaignId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')

  const handleJoin = async () => {
    if (!campaignId || !playerName.trim()) {
      setError('Campaign ID and your name are both required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/join', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ campaignId: parseInt(campaignId), playerName: playerName.trim() }),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch {
        throw new Error(`Server error (${res.status}): ${text.slice(0, 200) || 'empty response'}`)
      }
      if (!res.ok) throw new Error(data.error ?? 'Join failed')
      onJoin({
        token:        data.token,
        campaignId:   parseInt(campaignId),
        campaignName: data.campaignName,
        playerName:   playerName.trim(),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: '2rem' }}>
      <div style={{ background: '#1a1208', border: '2px solid #C9A84C', borderRadius: '12px',
        padding: '2rem', width: '100%', maxWidth: '400px' }}>

        <h1 style={{ fontFamily: 'Georgia', color: '#C9A84C', fontSize: '1.6rem',
          textAlign: 'center', marginBottom: '0.5rem' }}>⚔ DMCS Player View</h1>
        <p style={{ color: '#6b6b6b', textAlign: 'center', fontSize: '0.875rem', marginBottom: '2rem' }}>
          Enter the session details your DM shared with you
        </p>

        <label style={{ display: 'block', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#6b6b6b', textTransform: 'uppercase',
            letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Campaign ID</span>
          <input
            type="number"
            value={campaignId}
            onChange={e => setCampaignId(e.target.value)}
            placeholder="1"
            style={{ width: '100%', background: '#0d0a05', border: '1px solid #3d2f1a',
              color: '#e8e0d0', padding: '8px 12px', borderRadius: '6px', fontSize: '1rem' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#6b6b6b', textTransform: 'uppercase',
            letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Your Name</span>
          <input
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            placeholder="Thorin Ironforge"
            style={{ width: '100%', background: '#0d0a05', border: '1px solid #3d2f1a',
              color: '#e8e0d0', padding: '8px 12px', borderRadius: '6px', fontSize: '1rem' }}
          />
        </label>

        {error && (
          <div style={{ background: '#2a0a00', border: '1px solid #8B0000', borderRadius: '6px',
            padding: '8px 12px', color: '#f08080', fontSize: '0.875rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <button
          onClick={handleJoin}
          disabled={loading}
          style={{ width: '100%', background: loading ? '#3d2f1a' : '#C9A84C', border: 'none',
            color: '#0d0a05', fontWeight: 'bold', padding: '12px', borderRadius: '6px',
            fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Joining...' : 'Join Session'}
        </button>
      </div>
    </div>
  )
}
