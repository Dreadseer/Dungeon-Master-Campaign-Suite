import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import useCampaignStore    from '../stores/campaignStore'
import useAiMode           from '../hooks/useAiMode'
import { describeSavedCombat } from '../utils/combatPersistence'
import usePlayerStore      from '../stores/playerStore'
import WorldSearch         from './world/WorldSearch'
import NetworkSessionPanel from './network/NetworkSessionPanel'

const MODE_CONFIG = {
  'online':         { label: 'Claude API',          color: '#2d6a2d', text: '#8fbc5a', border: '#4a8a4a' },
  'offline-ollama': { label: 'Local AI (Ollama)',   color: '#6a4e1a', text: '#c9a84c', border: '#8a6a2a' },
  'no-ai':          { label: 'No AI — Check Settings', color: '#6a1a1a', text: '#e05050', border: '#8a2a2a' },
}

/**
 * The badge names the PROVIDER, with the model where one is known (task 9b).
 *
 * "online" told a DM nothing about which provider was actually answering, which
 * matters once the choice is theirs to make.
 */
function badgeLabel(mode, detection) {
  if (mode === 'online') {
    const model = detection?.claude?.model
    return model ? `Claude API — ${model}` : 'Claude API'
  }
  if (mode === 'offline-ollama') {
    const model = detection?.ollama?.chatModel
    return model ? `Ollama — ${model}` : 'Local AI (Ollama)'
  }
  return MODE_CONFIG['no-ai'].label
}

/** The same two lines Settings shows, as a tooltip (task 6). */
function badgeTooltip(mode, detection) {
  const c = detection?.claude
  const o = detection?.ollama
  const lines = []

  if (c?.attempted === false) lines.push(`Claude: not checked — ${c.message || 'no key saved'}`)
  else if (c?.ok) lines.push(`Claude: ready — ${c.model ?? 'model unknown'}`)
  else if (c) lines.push(`Claude: ${c.message ?? 'unavailable'}`)

  if (o?.attempted === false) lines.push(`Ollama: not checked — ${o.message || 'not selected'}`)
  else if (o?.ok) {
    lines.push(o.missing?.length
      ? `Ollama: reachable, but ${o.missing.join(' and ')} not pulled`
      : `Ollama: ready at ${o.url}`)
  } else if (o) lines.push(`Ollama: ${o.message ?? 'unreachable'}`)

  if (detection?.provider && detection.provider !== 'auto') {
    lines.push(`Provider locked to ${detection.provider === 'claude' ? 'Claude API' : 'Ollama'}.`)
  }
  lines.push('Click to open Settings.')
  return lines.join('\n')
}

export default function TopBar() {
  // Subscribed, so saving a key or switching provider updates the badge
  // without a restart — the gap that made a saved key look inert.
  const { mode: aiMode, detection } = useAiMode()
  const [serverRunning, setServerRunning] = useState(false)
  const [showNetwork,   setShowNetwork]   = useState(false)
  const [liveCombat,    setLiveCombat]    = useState(null)
  const navigate = useNavigate()
  const activeCampaign     = useCampaignStore(s => s.activeCampaign)
  const showPlayerPanel    = usePlayerStore(s => s.showPlayerPanel)
  const setShowPlayerPanel = usePlayerStore(s => s.setShowPlayerPanel)
  const playerWindowOpen   = usePlayerStore(s => s.playerWindowOpen)

  useEffect(() => {
    const check = () =>
      window.electronAPI.server.status()
        .then(s => setServerRunning(s.isRunning))
        .catch(() => setServerRunning(false))
    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [])

  // A fight left running is easy to forget about once the DM navigates away, so
  // the bar carries it on every screen. Polled on the same cadence as the server
  // status rather than pushed, because combat is saved from the renderer and a
  // broadcast would not reach this component in the pop-out window case.
  useEffect(() => {
    if (!activeCampaign) { setLiveCombat(null); return }
    let cancelled = false
    const check = async () => {
      try {
        const row = await window.electronAPI.db.combat.getActiveForCampaign(activeCampaign.id)
        if (!cancelled) setLiveCombat(describeSavedCombat(row))
      } catch {
        // Silent: a toast every five seconds would be worse than no indicator.
        if (!cancelled) setLiveCombat(null)
      }
    }
    check()
    const id = setInterval(check, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeCampaign])

  const modeConf = aiMode ? (MODE_CONFIG[aiMode] || MODE_CONFIG['no-ai']) : null

  return (
    <>
    <header style={styles.bar}>
      <span style={styles.title}>⚔ DM Campaign Suite</span>
      <div style={styles.right}>
        {liveCombat && (
          <button
            style={styles.combatBtn}
            onClick={() => navigate('/encounters')}
            title={`${liveCombat.encounterName ?? 'Combat'} — ${liveCombat.living} of ${liveCombat.combatants} still standing`}
          >
            ⚔ Combat in progress — round {liveCombat.round}
          </button>
        )}

        {activeCampaign && <WorldSearch />}

        {/* Network session toggle */}
        {activeCampaign && (
          <button
            style={{
              ...styles.playerBtn,
              background:  showNetwork ? '#0d1a0d' : 'transparent',
              borderColor: showNetwork ? '#2d5a2d' : '#3a2a10',
              color:       showNetwork ? '#5dc45d' : '#a89060',
              position: 'relative',
            }}
            onClick={() => setShowNetwork(n => !n)}
            title="Toggle Network Session panel"
          >
            🌐 Network
            {serverRunning && (
              <span style={{ ...styles.playerDot, background: '#27ae60',
                boxShadow: '0 0 4px rgba(39,174,96,0.8)' }} />
            )}
          </button>
        )}

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
            title={badgeTooltip(aiMode, detection)}
          >
            {badgeLabel(aiMode, detection)}
          </button>
        )}
        <span style={{ ...styles.campaign, color: activeCampaign?.name ? '#c9a84c' : '#6b5a3a' }}>
          {activeCampaign?.name ?? 'No Campaign Loaded'}
        </span>
      </div>
    </header>

    {showNetwork && activeCampaign && (
      <NetworkSessionPanel onClose={() => setShowNetwork(false)} />
    )}
  </>
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
  combatBtn: {
    fontSize: '0.8rem', padding: '0.25rem 0.75rem', borderRadius: 4,
    border: '1px solid #8a6a2a', background: '#2a2010', color: '#c9a84c',
    cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
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
