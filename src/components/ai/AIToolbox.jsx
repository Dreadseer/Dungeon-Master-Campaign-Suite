import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// ── Quick prompt categories ──────────────────────────────────────────────────
const QUICK_PROMPTS = [
  {
    category: '🌍 World Building',
    prompts: [
      'Describe this location for my players: [location name]',
      'Generate a rumor table for [location]',
      'What might an NPC in [faction] know about [topic]?',
    ],
  },
  {
    category: '⚔️ Combat',
    prompts: [
      'Create a dramatic encounter intro for this fight: [enemy name]',
      'Describe the aftermath of defeating [monster]',
      'Generate loot appropriate for CR [X]',
    ],
  },
  {
    category: '📜 Story',
    prompts: [
      'What secrets might [NPC] be hiding?',
      'Create a plot twist involving [faction]',
      'How might [NPC] react to the party\'s actions?',
    ],
  },
  {
    category: '📖 Rules',
    prompts: [
      'Explain how [rule] works',
      'What happens when [edge case]?',
      'Compare [ability A] vs [ability B]',
    ],
  },
]

export default function AIToolbox({ onInsertPrompt, ragMode, onToggleRag, hasEmbeddedSources, activeCampaign }) {
  const navigate   = useNavigate()
  const [sources, setSources] = useState([])
  const [openCat,  setOpenCat] = useState(null)   // which category is expanded

  // Load PDF sources for this campaign
  useEffect(() => {
    if (!activeCampaign?.id) return
    window.electronAPI.db.pdf.getAll(activeCampaign.id)
      .then(rows => setSources(rows))
      .catch(() => setSources([]))
  }, [activeCampaign?.id])

  return (
    <div style={s.container}>

      {/* ── Rules Q&A Mode toggle ─── */}
      <div style={s.ragSection}>
        <div style={s.ragHeader}>
          <span style={s.ragLabel}>📚 Rules Q&A Mode</span>
          <button
            style={ragMode ? s.toggleOn : s.toggleOff}
            onClick={onToggleRag}
            disabled={!hasEmbeddedSources}
            title={!hasEmbeddedSources ? 'Upload and embed a PDF source to enable Rules Q&A' : 'Toggle RAG pipeline'}
          >
            {ragMode ? 'ON' : 'OFF'}
          </button>
        </div>
        <p style={s.ragDesc}>
          {ragMode
            ? 'Questions search your source books for grounded answers.'
            : 'Answers generated from general AI knowledge.'}
        </p>
      </div>

      <div style={s.divider} />

      {/* ── PDF Sources status ─── */}
      <div style={s.sourcesSection}>
        <div style={s.sourcesHeader}>
          <span style={s.sectionTitle}>📄 Source Books</span>
          <button style={s.btnUpload} onClick={() => navigate('/ai/sources')} title="Manage PDF sources">
            + Upload PDF
          </button>
        </div>
        {sources.length === 0 ? (
          <p style={s.noSources}>No sources indexed yet.</p>
        ) : (
          <div style={s.sourceList}>
            {sources.map(src => (
              <div key={src.id} style={s.sourceRow}>
                <span style={s.sourceIcon}>
                  {src.status === 'embedded' ? '◈' : src.status === 'indexed' ? '✓' : '⏳'}
                </span>
                <span style={s.sourceName} title={src.filename}>
                  {src.filename.length > 22 ? src.filename.slice(0, 22) + '…' : src.filename}
                </span>
                <span style={{ ...s.sourceStatus, color: src.status === 'embedded' ? '#6a9ae0' : src.status === 'indexed' ? '#5aaa5a' : '#888' }}>
                  {src.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={s.divider} />

      {/* ── Quick Prompts ─── */}
      <div style={s.promptsSection}>
        <span style={s.sectionTitle}>⚡ Quick Prompts</span>
        <p style={s.promptsDesc}>Click to insert editable prompt into chat.</p>
        <div style={s.catList}>
          {QUICK_PROMPTS.map(cat => (
            <div key={cat.category} style={s.catBlock}>
              <button
                style={s.catHeader}
                onClick={() => setOpenCat(openCat === cat.category ? null : cat.category)}
              >
                <span>{cat.category}</span>
                <span style={s.catChevron}>{openCat === cat.category ? '▲' : '▼'}</span>
              </button>
              {openCat === cat.category && (
                <div style={s.catPrompts}>
                  {cat.prompts.map((prompt, i) => (
                    <button
                      key={i}
                      style={s.promptBtn}
                      onClick={() => onInsertPrompt(prompt)}
                      title="Click to insert into chat input"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  container: {
    display:       'flex',
    flexDirection: 'column',
    gap:           0,
    height:        '100%',
    overflowY:     'auto',
    padding:       '12px',
  },
  divider: {
    height:     1,
    background: '#2a1a08',
    margin:     '10px 0',
    flexShrink: 0,
  },

  // RAG section
  ragSection: {
    display:       'flex',
    flexDirection: 'column',
    gap:           4,
  },
  ragHeader: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  ragLabel: {
    color:      '#c9c0a8',
    fontSize:   13,
    fontWeight: 600,
  },
  toggleOn: {
    padding:      '3px 12px',
    background:   '#0d1a30',
    border:       '1px solid #3a5a9a',
    borderRadius: 10,
    color:        '#6a9ae0',
    cursor:       'pointer',
    fontSize:     11,
    fontWeight:   700,
  },
  toggleOff: {
    padding:      '3px 12px',
    background:   'none',
    border:       '1px solid #333',
    borderRadius: 10,
    color:        '#555',
    cursor:       'pointer',
    fontSize:     11,
    fontWeight:   700,
  },
  ragDesc: {
    color:    '#666',
    fontSize: 11,
    margin:   0,
    fontStyle:'italic',
  },

  // Sources section
  sourcesSection: {
    display:       'flex',
    flexDirection: 'column',
    gap:           6,
  },
  sourcesHeader: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color:      '#C9A84C',
    fontSize:   12,
    fontWeight: 600,
  },
  btnUpload: {
    padding:      '2px 8px',
    background:   '#2a1f06',
    border:       '1px solid #C9A84C',
    borderRadius: 4,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     11,
  },
  noSources: {
    color:    '#555',
    fontSize: 11,
    margin:   0,
    fontStyle:'italic',
  },
  sourceList: {
    display:       'flex',
    flexDirection: 'column',
    gap:           3,
  },
  sourceRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  sourceIcon: {
    fontSize:   11,
    flexShrink: 0,
    color:      '#888',
  },
  sourceName: {
    color:        '#998a6a',
    fontSize:     11,
    flex:         1,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  },
  sourceStatus: {
    fontSize:   10,
    flexShrink: 0,
    fontStyle:  'italic',
  },

  // Quick prompts section
  promptsSection: {
    display:       'flex',
    flexDirection: 'column',
    gap:           6,
    flex:          1,
  },
  promptsDesc: {
    color:    '#555',
    fontSize: 11,
    margin:   '0 0 4px',
    fontStyle:'italic',
  },
  catList: {
    display:       'flex',
    flexDirection: 'column',
    gap:           4,
  },
  catBlock: {
    border:       '1px solid #2a1a08',
    borderRadius: 4,
    overflow:     'hidden',
  },
  catHeader: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    width:          '100%',
    padding:        '6px 10px',
    background:     '#140f05',
    border:         'none',
    color:          '#c9c0a8',
    cursor:         'pointer',
    fontSize:       12,
    fontWeight:     600,
    textAlign:      'left',
  },
  catChevron: {
    fontSize: 9,
    color:    '#555',
  },
  catPrompts: {
    display:       'flex',
    flexDirection: 'column',
    gap:           1,
    padding:       '4px',
    background:    '#0d0a05',
  },
  promptBtn: {
    padding:     '5px 8px',
    background:  'none',
    border:      '1px solid transparent',
    borderRadius: 3,
    color:       '#776855',
    cursor:      'pointer',
    fontSize:    11,
    textAlign:   'left',
    lineHeight:  1.4,
    transition:  'all 0.15s',
  },
}
