export default function Compendium() {
  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Compendium</h1>
      <p style={descStyle}>Browse and edit items, spells, and equipment</p>
    </div>
  )
}

const pageStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }
const titleStyle = { color: '#c9a84c', fontSize: '2rem' }
const descStyle  = { color: '#8a7a5a', fontSize: '1rem' }
