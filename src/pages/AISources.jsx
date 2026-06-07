import { useNavigate } from 'react-router-dom'
import PdfSourceManager from '../components/ai/PdfSourceManager'

export default function AISources() {
  const navigate = useNavigate()

  return (
    <div style={s.page}>
      <div style={s.header}>
        <button style={s.back} onClick={() => navigate('/ai')}>← Back to AI Assistant</button>
        <h2 style={s.title}>PDF Source Books</h2>
      </div>
      <div style={s.body}>
        <PdfSourceManager />
      </div>
    </div>
  )
}

const s = {
  page: {
    display:       'flex',
    flexDirection: 'column',
    height:        '100%',
    background:    '#0d0a05',
    overflow:      'hidden',
  },
  header: {
    display:    'flex',
    alignItems: 'center',
    gap:        16,
    padding:    '14px 20px',
    borderBottom: '1px solid #2a1a08',
    flexShrink: 0,
  },
  back: {
    padding:      '4px 12px',
    background:   'none',
    border:       '1px solid #3a2a10',
    borderRadius: 4,
    color:        '#888',
    cursor:       'pointer',
    fontSize:     12,
  },
  title: {
    color:      '#C9A84C',
    fontSize:   18,
    fontWeight: 600,
    margin:     0,
  },
  body: {
    flex:     1,
    overflowY:'auto',
    padding:  '20px',
    maxWidth: 680,
  },
}
