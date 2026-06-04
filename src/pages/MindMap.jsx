export default function MindMap() {
  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Mind Map</h1>
      <p style={descStyle}>Visualize connections between NPCs, places, and factions</p>
    </div>
  )
}

const pageStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }
const titleStyle = { color: '#c9a84c', fontSize: '2rem' }
const descStyle  = { color: '#8a7a5a', fontSize: '1rem' }
