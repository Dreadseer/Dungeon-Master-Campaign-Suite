import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import useCampaignStore from '../stores/campaignStore'
import usePlayerStore   from '../stores/playerStore'
import WorldSearch from './world/WorldSearch'

const MODE_CONFIG = {
  'online':         { label: 'Claude API',          color: '#2d6a2d', text: '#8fbc5a', border: '#4a8a4a' },
  'offline-ollama': { label: 'Local AI (Ollama)',   color: '#6a4e1a', text: '#c9a84c', border: '#8a6a2a' },
  'no-ai':          { label: 'No AI — Check Settings', color: '#6a1a1a', text: '#e05050', border: '#8a2a2a' },
}

export default function TopBar() {
  const [aiMode, setAiMode] = useState(null)
  const navigate = useNavigate()
  const activeCampaign    = useCampaignStore(s => s.activeCampaign)
  const showPlayerPanel   = usePlayerStore(s => s.showPlayerPanel)
  const setShowPlayerPanel = usePlayerStore(s => s.setShowPlayerPanel)
  const playerWindowOpen  = usePlayerStore(s => s.playerWindowOpen)

  useEffect(() => {
    window.electronAPI.ai.getMode().then(({ mode }) => setAiMode(mode))
  }, [])

  const modeConf = aiMode ? (MODE_CONFIG[aiMode] || MODE_CONFIG['no-ai']) : null

  return (
    <header style={styles.bar}>
      <span style={styles.title}>⚔ DM Campaign Suite</span>
      <div style={styles.right}>
        {activeCampaign && <WorldSearch />}

        {/* Player View toggle */}
        {activeCampaign && (
          <button
            style={{
              ...styles.playerBtn,
              background:   showPlayerPanel ? '#1a2a1a' : 'transparent',
              borderColor:  showPlayerPanel ? '#4a7a4a' : '#3a2a10',
              color:        showPlayerPanel ? '#8ada8a' : '#a89060',
            }}
            onClick={() => setShowPlayerPanel(!showPlayerPanel)}
            title="Toggle Player View controls"
          >
            👥 Player View
            {playerWindowOpen && <span style={styles.playerDot} />}
          </button>
        )}

        {modeConf && (
          <button
            onClick={() => navigate('/settings')}
            style={{ ...styles.badge, background: modeConf.color, color: modeConf.text, borderColor: modeConf.border }}
            title="Click to open Settings"
          >
            {modeConf.label}
          </button>
        )}
        <span style={{ ...styles.campaign, color: activeCampaign?.name ? '#c9a84c' : '#6b5a3a' }}>
          {activeCampaign?.name ?? 'No Campaign Loaded'}
        </span>
      </div>
    </header>
  )
}

const styles = {
  bar: {
    height: '56px', minHeight: '56px', background: '#0d0a05',
    borderBottom: '1px solid #3a2a10',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 1.5rem', zIndex: 10,
  },
  title: {
    color: '#c9a84c', fontSize: '1.1rem', fontWeight: 'bold', letterSpacing: '0.05em',
  },
  right: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
  },
  badge: {
    fontSize: '0.75rem', fontWeight: 'bold', padding: '0.25rem 0.75rem',
    borderRadius: 4, border: '1px solid', cursor: 'pointer',
    letterSpacing: '0.03em',
  },
  playerBtn: {
    fontSize: '0.8rem', padding: '0.25rem 0.75rem', borderRadius: 4,
    border: '1px solid', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem',
    fontWeight: 600, transition: 'all 0.15s',
  },
  playerDot: {
    width: 7, height: 7, borderRadius: '50%', background: '#4caf50',
    boxShadow: '0 0 4px rgba(76,175,80,0.8)', flexShrink: 0,
  },
  campaign: {
    color: '#6b5a3a', fontSize: '0.8rem', background: '#1a1208',
    border: '1px solid #3a2a10', borderRadius: 4, padding: '0.25rem 0.75rem',
  },
}
