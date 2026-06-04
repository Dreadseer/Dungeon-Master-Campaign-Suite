export default function LoreConnections() {
  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Lore & Connections</h1>
      <p style={descStyle}>Track narrative threads, secrets, and faction allegiances</p>
    </div>
  )
}

const pageStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }
const titleStyle = { color: '#c9a84c', fontSize: '2rem' }
const descStyle  = { color: '#8a7a5a', fontSize: '1rem' }
