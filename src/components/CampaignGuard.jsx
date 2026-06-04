import { useNavigate } from 'react-router-dom'
import useCampaignStore from '../stores/campaignStore'

export default function CampaignGuard({ children }) {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)
  const navigate = useNavigate()

  if (!activeCampaign?.name) {
    return (
      <div style={s.wrap}>
        <p style={s.msg}>Select a campaign from the Campaign Manager to use this module.</p>
        <button style={s.btn} onClick={() => navigate('/')}>Go to Campaign Manager</button>
      </div>
    )
  }

  return children
}

const s = {
  wrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' },
  msg:  { color: '#6b5a3a', fontSize: '1rem' },
  btn:  { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.4rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' },
}
