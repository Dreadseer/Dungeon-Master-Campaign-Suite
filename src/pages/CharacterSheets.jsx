export default function CharacterSheets() {
  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>Character Sheets</h1>
      <p style={descStyle}>Create and manage player character sheets</p>
    </div>
  )
}

const pageStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }
const titleStyle = { color: '#c9a84c', fontSize: '2rem' }
const descStyle  = { color: '#8a7a5a', fontSize: '1rem' }
