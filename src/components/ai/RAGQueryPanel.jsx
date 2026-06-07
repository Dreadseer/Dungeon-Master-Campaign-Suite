import { useState, useEffect, useCallback, useRef } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import AnswerRenderer from './AnswerRenderer'

const MAX_HISTORY = 10

export default function RAGQueryPanel() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [result,      setResult]      = useState(null)   // { answer, sources, noSourcesFound }
  const [error,       setError]       = useState(null)
  const [history,     setHistory]     = useState([])     // last N query strings
  const [hasEmbedded, setHasEmbedded] = useState(false)  // any embedded sources for this campaign?

  const textareaRef = useRef(null)

  // ── Check for embedded sources ─────────────────────────────────────────────
  const checkSources = useCallback(async () => {
    if (!activeCampaign?.id) return
    try {
      const sources = await window.electronAPI.db.pdf.getAll(activeCampaign.id)
      setHasEmbedded(sources.some(s => s.status === 'embedded' || s.chunk_count > 0))
    } catch { setHasEmbedded(false) }
  }, [activeCampaign?.id])

  useEffect(() => { checkSources() }, [checkSources])

  // ── Submit query ───────────────────────────────────────────────────────────
  const handleAsk = useCallback(async (question) => {
    const q = (question ?? input).trim()
    if (!q || loading || !activeCampaign?.id) return

    setLoading(true)
    setError(null)
    setResult(null)

    // Add to history (deduplicate, cap at MAX_HISTORY)
    setHistory(prev => {
      const deduped = [q, ...prev.filter(h => h !== q)]
      return deduped.slice(0, MAX_HISTORY)
    })

    try {
      const res = await window.electronAPI.ai.ragQuery(q, activeCampaign.id, { topK: 5 })
      setResult(res)
    } catch (err) {
      setError(err.message ?? 'Query failed')
    } finally {
      setLoading(false)
    }
  }, [input, loading, activeCampaign?.id])

  // ── Keyboard: Enter submits, Shift+Enter adds newline ─────────────────────
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }, [handleAsk])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.container}>

      {/* ── Query input ─── */}
      <div style={s.inputWrap}>
        <textarea
          ref={textareaRef}
          style={s.textarea}
          placeholder="Ask a rules question… (e.g. 'What is the attack bonus of a goblin?')"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={loading}
        />
        <button
          style={(!hasEmbedded || loading || !input.trim()) ? s.btnDisabled : s.btnAsk}
          onClick={() => handleAsk()}
          disabled={!hasEmbedded || loading || !input.trim()}
          title={!hasEmbedded ? 'Upload and index a PDF source book to enable rules Q&A' : 'Ask question (Enter)'}
        >
          {loading ? '⏳' : 'Ask'}
        </button>
      </div>

      {/* ── No-sources nudge ─── */}
      {!hasEmbedded && (
        <p style={s.noSources}>
          Upload and index a PDF source book to enable rules Q&A.
        </p>
      )}

      {/* ── Query history chips ─── */}
      {history.length > 0 && (
        <div style={s.historyWrap}>
          <div style={s.historyRow}>
            {history.map((h, i) => (
              <button
                key={i}
                style={s.historyChip}
                onClick={() => { setInput(h); handleAsk(h) }}
                title={h}
                disabled={loading}
              >
                {h.length > 40 ? h.slice(0, 40) + '…' : h}
              </button>
            ))}
          </div>
          <button style={s.clearHistory} onClick={() => setHistory([])}>
            Clear History
          </button>
        </div>
      )}

      {/* ── Loading ─── */}
      {loading && (
        <div style={s.loadingRow}>
          <span style={s.spinner}>⏳</span>
          <span style={s.loadingText}>Searching sources and generating answer…</span>
        </div>
      )}

      {/* ── Error ─── */}
      {error && !loading && (
        <div style={s.errorBox}>⚠ {error}</div>
      )}

      {/* ── Result ─── */}
      {result && !loading && (
        <div style={s.resultWrap}>

          {/* No-sources-found amber warning */}
          {result.noSourcesFound && (
            <div style={s.noSourceWarning}>
              ⚠ No relevant passages found in your source books. Answer generated from general AI knowledge.
            </div>
          )}

          {/* Answer */}
          <div style={s.answerBox}>
            <AnswerRenderer text={result.answer} />
          </div>

          {/* Source attribution */}
          {result.sources?.length > 0 && (
            <SourcesPanel sources={result.sources} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Source attribution sub-component ──────────────────────────────────────────
function SourcesPanel({ sources }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={sp.container}>
      <button style={sp.toggle} onClick={() => setOpen(o => !o)}>
        <span>📄 Sources consulted ({sources.length})</span>
        <span style={sp.chevron}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={sp.list}>
          {sources.map((src, i) => (
            <div key={i} style={sp.item}>
              <div style={sp.itemHeader}>
                <span style={sp.icon}>📄</span>
                <span style={sp.filename}>{src.source}</span>
                <span style={sp.page}>p.{src.page}</span>
              </div>
              <div style={sp.preview}>{src.preview}</div>
              <div style={sp.scoreWrap}>
                <div style={{ ...sp.scoreBar, width: `${Math.round(src.score * 100)}%` }} />
                <span style={sp.scoreLabel}>{Math.round(src.score * 100)}% match</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  container: {
    display:       'flex',
    flexDirection: 'column',
    gap:           10,
  },
  inputWrap: {
    display:   'flex',
    gap:       8,
    alignItems: 'flex-end',
  },
  textarea: {
    flex:        1,
    padding:     '8px 10px',
    background:  '#1a1208',
    border:      '1px solid #3a2a10',
    borderRadius: 4,
    color:       '#c9c0a8',
    fontSize:    13,
    resize:      'none',
    outline:     'none',
    fontFamily:  'inherit',
    lineHeight:  1.5,
  },
  btnAsk: {
    padding:      '8px 18px',
    background:   '#2a1f06',
    border:       '1px solid #C9A84C',
    borderRadius: 4,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     13,
    fontWeight:   600,
    whiteSpace:   'nowrap',
    alignSelf:    'stretch',
  },
  btnDisabled: {
    padding:      '8px 18px',
    background:   '#1a1208',
    border:       '1px solid #333',
    borderRadius: 4,
    color:        '#555',
    cursor:       'not-allowed',
    fontSize:     13,
    fontWeight:   600,
    whiteSpace:   'nowrap',
    alignSelf:    'stretch',
  },
  noSources: {
    color:     '#666',
    fontSize:  12,
    margin:    0,
    fontStyle: 'italic',
  },

  historyWrap: {
    display:       'flex',
    flexDirection: 'column',
    gap:           4,
  },
  historyRow: {
    display:  'flex',
    flexWrap: 'wrap',
    gap:      4,
  },
  historyChip: {
    padding:      '3px 10px',
    background:   '#0d0a05',
    border:       '1px solid #2a1a08',
    borderRadius: 10,
    color:        '#888',
    cursor:       'pointer',
    fontSize:     11,
    whiteSpace:   'nowrap',
    maxWidth:     220,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
  },
  clearHistory: {
    alignSelf:    'flex-start',
    padding:      '2px 8px',
    background:   'none',
    border:       'none',
    color:        '#444',
    cursor:       'pointer',
    fontSize:     10,
  },

  loadingRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
    padding:    '4px 0',
  },
  spinner:     { fontSize: 16 },
  loadingText: { color: '#666', fontSize: 12 },

  errorBox: {
    background:   '#2a0d0d',
    border:       '1px solid #7a2a2a',
    borderRadius: 4,
    color:        '#c05050',
    fontSize:     12,
    padding:      '8px 10px',
  },

  resultWrap: {
    display:       'flex',
    flexDirection: 'column',
    gap:           8,
  },
  noSourceWarning: {
    background:   '#1f1500',
    border:       '1px solid #5a4010',
    borderRadius: 4,
    color:        '#C9A84C',
    fontSize:     12,
    padding:      '7px 10px',
  },
  answerBox: {
    background:   'rgba(13, 10, 5, 0.6)',
    border:       '1px solid #2a1a08',
    borderRadius: 4,
    padding:      '10px 12px',
  },
}

const sp = {
  container: {
    borderTop: '1px solid #2a1a08',
    paddingTop: 6,
  },
  toggle: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    width:          '100%',
    background:     'none',
    border:         'none',
    color:          '#888',
    cursor:         'pointer',
    fontSize:       11,
    padding:        '4px 0',
    textAlign:      'left',
  },
  chevron: {
    fontSize: 9,
    color:    '#555',
  },
  list: {
    display:       'flex',
    flexDirection: 'column',
    gap:           6,
    paddingTop:    6,
  },
  item: {
    background:   '#0d0a05',
    border:       '1px solid #1e1608',
    borderRadius: 4,
    padding:      '7px 8px',
    display:      'flex',
    flexDirection:'column',
    gap:          4,
  },
  itemHeader: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  icon:     { fontSize: 12 },
  filename: {
    color:        '#c9c0a8',
    fontSize:     12,
    fontWeight:   600,
    flex:         1,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  },
  page: {
    color:     '#666',
    fontSize:  11,
    flexShrink: 0,
  },
  preview: {
    color:      '#776855',
    fontSize:   11,
    lineHeight: 1.4,
    fontStyle:  'italic',
  },
  scoreWrap: {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
  },
  scoreBar: {
    height:      3,
    background:  '#C9A84C',
    borderRadius: 2,
    minWidth:    2,
    maxWidth:    80,
  },
  scoreLabel: {
    color:    '#555',
    fontSize: 10,
  },
}
