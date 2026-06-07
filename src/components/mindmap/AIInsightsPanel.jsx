import { useState, useCallback } from 'react'

const SYSTEM_PROMPT = `You are an expert D&D Dungeon Master narrative analyst.
Analyze the relationship web described and provide 3 specific, insightful observations.
Focus on drama, conflict, and story potential. Be concise — one sentence per point.
Format your response as a numbered list: 1. ... 2. ... 3. ...`

const ANALYSIS_MODES = [
  {
    key:    'relationships',
    label:  'Analyze Relationships',
    icon:   '🔗',
    prompt: (summary) =>
      `${summary}\n\nAnalyze these relationships and identify the 3 most interesting narrative dynamics. Focus on drama, conflict, and story potential.`,
  },
  {
    key:    'isolated',
    label:  'Isolated Entities',
    icon:   '🏝️',
    prompt: (summary) =>
      `${summary}\n\nIdentify any entities with no connections and suggest 1-2 compelling story reasons why each might connect to others in this web.`,
  },
  {
    key:    'conflicts',
    label:  'Faction Conflicts',
    icon:   '⚔️',
    prompt: (summary) =>
      `${summary}\n\nIdentify faction conflicts in this relationship web. Which entities from opposing factions are directly or indirectly connected? What tensions does this create?`,
  },
  {
    key:    'threads',
    label:  'Story Threads',
    icon:   '📜',
    prompt: (summary) =>
      `${summary}\n\nBased on this relationship web, suggest 2-3 specific, creative plot hooks a DM could explore. Be concrete and tie each hook to named entities.`,
  },
]

function buildGraphSummary(nodes, edges, campaignName) {
  const npcNodes = nodes.filter(n => n.type === 'npc')
  const locNodes = nodes.filter(n => n.type === 'location')
  const facNodes = nodes.filter(n => n.type === 'faction')

  const edgeSummary = edges
    .map(e => {
      const src = nodes.find(n => n.id === e.source)
      const tgt = nodes.find(n => n.id === e.target)
      if (!src || !tgt) return null
      const rel = e.label ?? e.data?.label ?? 'connected to'
      return `${src.data.label} ${rel} ${tgt.data.label}`
    })
    .filter(Boolean)
    .join('; ')

  return [
    `Campaign: ${campaignName}`,
    `Entities visible: ${npcNodes.length} NPCs, ${locNodes.length} locations, ${facNodes.length} factions`,
    `Relationships: ${edgeSummary || 'none'}`,
  ].join('\n')
}

// Parse numbered list items from AI response text
function parseInsights(text) {
  if (!text) return []
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const items = []
  for (const line of lines) {
    const match = line.match(/^(\d+)[.)]\s*(.+)/)
    if (match) {
      items.push(match[2].trim())
    } else if (items.length > 0 && !line.match(/^\d+[.)]/)) {
      items[items.length - 1] += ' ' + line
    }
  }
  return items.length > 0 ? items : [text.trim()]
}

export default function AIInsightsPanel({ nodes, edges, campaignName }) {
  const [open,       setOpen]       = useState(false)
  const [activeMode, setActiveMode] = useState(null)
  const [insights,   setInsights]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [noAi,       setNoAi]       = useState(false)

  const runAnalysis = useCallback(async (mode) => {
    setActiveMode(mode.key)
    setInsights([])
    setError(null)
    setLoading(true)
    setNoAi(false)

    try {
      const aiMode = await window.electronAPI.ai.getMode()
      if (aiMode === 'no-ai') {
        setNoAi(true)
        return
      }

      const summary     = buildGraphSummary(nodes, edges, campaignName)
      const userMessage = mode.prompt(summary)
      const result      = await window.electronAPI.ai.complete(SYSTEM_PROMPT, userMessage)
      setInsights(parseInsights(result))
    } catch (err) {
      setError(err.message ?? 'AI request failed')
    } finally {
      setLoading(false)
    }
  }, [nodes, edges, campaignName])

  const handleRegenerate = useCallback(() => {
    const mode = ANALYSIS_MODES.find(m => m.key === activeMode)
    if (mode) runAnalysis(mode)
  }, [activeMode, runAnalysis])

  return (
    <div style={s.container}>
      {/* ── Toggle bar ──────────────────────────── */}
      <button style={s.toggleBar} onClick={() => setOpen(o => !o)}>
        <span>🤖 AI Insights</span>
        <span style={s.chevron}>{open ? '▲' : '▼'}</span>
      </button>

      {/* ── Expanded body ───────────────────────── */}
      {open && (
        <div style={s.body}>
          {/* Mode buttons */}
          <div style={s.modeRow}>
            {ANALYSIS_MODES.map(mode => (
              <button
                key={mode.key}
                style={activeMode === mode.key ? s.modeBtnActive : s.modeBtn}
                onClick={() => runAnalysis(mode)}
                disabled={loading}
                title={mode.label}
              >
                {mode.icon} {mode.label}
              </button>
            ))}
          </div>

          {/* Results */}
          <div style={s.results}>
            {/* No AI configured */}
            {noAi && (
              <p style={s.noAiMsg}>
                Configure your API key in <strong style={{ color: '#C9A84C' }}>Settings</strong> to enable AI insights.
              </p>
            )}

            {/* Loading */}
            {loading && (
              <div style={s.loadingRow}>
                <span style={s.spinner}>⏳</span>
                <span style={s.loadingText}>Analyzing relationships…</span>
              </div>
            )}

            {/* Error */}
            {!loading && error && (
              <p style={s.errorMsg}>⚠ {error}</p>
            )}

            {/* Insights */}
            {!loading && !noAi && !error && insights.length > 0 && (
              <>
                <ol style={s.insightList}>
                  {insights.map((insight, i) => (
                    <li key={i} style={s.insightItem}>
                      <span style={s.bullet}>◆</span>
                      <span style={s.insightText}>{insight}</span>
                    </li>
                  ))}
                </ol>
                <button style={s.regenBtn} onClick={handleRegenerate} disabled={loading}>
                  ↺ Regenerate
                </button>
              </>
            )}

            {/* Prompt to select a mode */}
            {!loading && !noAi && !error && insights.length === 0 && (
              <p style={s.promptMsg}>Select an analysis mode above.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  container: {
    width:          340,
    pointerEvents:  'all',
    background:     'rgba(18, 14, 8, 0.95)',
    border:         '1px solid #3a2a10',
    borderRadius:   6,
    backdropFilter: 'blur(6px)',
    boxShadow:      '0 4px 20px rgba(0,0,0,0.7)',
    overflow:       'hidden',
  },

  toggleBar: {
    width:          '100%',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '7px 12px',
    background:     '#1a1208',
    border:         'none',
    borderBottom:   '1px solid #3a2a10',
    color:          '#C9A84C',
    cursor:         'pointer',
    fontSize:       12,
    fontWeight:     600,
  },
  chevron: {
    fontSize: 10,
    color:    '#555',
  },

  body: {
    display:       'flex',
    flexDirection: 'column',
    gap:           0,
  },

  modeRow: {
    display:   'flex',
    flexWrap:  'wrap',
    gap:       4,
    padding:   '8px 10px',
    borderBottom: '1px solid #1e1608',
  },
  modeBtn: {
    padding:      '3px 8px',
    background:   'none',
    border:       '1px solid #333',
    borderRadius: 10,
    color:        '#666',
    cursor:       'pointer',
    fontSize:     10,
    whiteSpace:   'nowrap',
  },
  modeBtnActive: {
    padding:      '3px 8px',
    background:   '#2a1f06',
    border:       '1px solid #C9A84C',
    borderRadius: 10,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     10,
    whiteSpace:   'nowrap',
  },

  results: {
    padding:   '10px 12px',
    minHeight: 60,
  },

  noAiMsg: {
    color:      '#888',
    fontSize:   12,
    lineHeight: 1.5,
    margin:     0,
    textAlign:  'center',
    padding:    '8px 0',
  },
  loadingRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
    padding:    '4px 0',
  },
  spinner:     { fontSize: 16 },
  loadingText: { color: '#666', fontSize: 12 },

  errorMsg: {
    color:    '#8b0000',
    fontSize: 12,
    margin:   0,
  },

  insightList: {
    listStyle: 'none',
    padding:   0,
    margin:    '0 0 8px',
    display:   'flex',
    flexDirection: 'column',
    gap:       8,
  },
  insightItem: {
    display: 'flex',
    gap:     6,
    alignItems: 'flex-start',
  },
  bullet: {
    color:     '#C9A84C',
    fontSize:  10,
    flexShrink: 0,
    marginTop:  3,
  },
  insightText: {
    color:      '#c9c0a8',
    fontSize:   12,
    lineHeight: 1.5,
  },
  regenBtn: {
    padding:      '4px 12px',
    background:   'none',
    border:       '1px solid #3a2a10',
    borderRadius: 4,
    color:        '#666',
    cursor:       'pointer',
    fontSize:     11,
  },

  promptMsg: {
    color:    '#444',
    fontSize: 12,
    margin:   0,
    textAlign: 'center',
    padding:  '4px 0',
  },
}
