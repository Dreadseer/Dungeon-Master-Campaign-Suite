export default function WorldBuilder() {
  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>World Builder</h1>
      <p style={descStyle}>Create towns, NPCs, shops, factions, and regions</p>
    </div>
  )
}

const pageStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }
const titleStyle = { color: '#c9a84c', fontSize: '2rem' }
const descStyle  = { color: '#8a7a5a', fontSize: '1rem' }
