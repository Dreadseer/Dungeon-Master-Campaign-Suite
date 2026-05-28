import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import useCampaignStore from '../stores/campaignStore'

const MODE_CONFIG = {
  'online':         { label: 'Claude API',          color: '#2d6a2d', text: '#8fbc5a', border: '#4a8a4a' },
  'offline-ollama': { label: 'Local AI (Ollama)',   color: '#6a4e1a', text: '#c9a84c', border: '#8a6a2a' },
  'no-ai':          { label: 'No AI — Check Settings', color: '#6a1a1a', text: '#e05050', border: '#8a2a2a' },
}

export default function TopBar() {
  const [aiMode, setAiMode] = useState(null)
  const navigate = useNavigate()
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  useEffect(() => {
    window.electronAPI.ai.getMode().then(({ mode }) => setAiMode(mode))
  }, [])

  const modeConf = aiMode ? (MODE_CONFIG[aiMode] || MODE_CONFIG['no-ai']) : null

  return (
    <header style={styles.bar}>
      <span style={styles.title}>⚔ DM Campaign Suite</span>
      <div style={styles.right}>
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
  campaign: {
    color: '#6b5a3a', fontSize: '0.8rem', background: '#1a1208',
    border: '1px solid #3a2a10', borderRadius: 4, padding: '0.25rem 0.75rem',
  },
}
