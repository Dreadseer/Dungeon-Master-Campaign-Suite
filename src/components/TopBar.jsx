const topBarStyle = {
  height: '56px',
  minHeight: '56px',
  background: '#0d0a05',
  borderBottom: '1px solid #3a2a10',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 1.5rem',
  zIndex: 10,
}

const titleStyle = {
  color: '#c9a84c',
  fontSize: '1.1rem',
  fontWeight: 'bold',
  letterSpacing: '0.05em',
}

const campaignBadgeStyle = {
  color: '#6b5a3a',
  fontSize: '0.8rem',
  background: '#1a1208',
  border: '1px solid #3a2a10',
  borderRadius: '4px',
  padding: '0.25rem 0.75rem',
}

export default function TopBar() {
  return (
    <header style={topBarStyle}>
      <span style={titleStyle}>⚔ DM Campaign Suite</span>
      <span style={campaignBadgeStyle}>No Campaign Loaded</span>
    </header>
  )
}
