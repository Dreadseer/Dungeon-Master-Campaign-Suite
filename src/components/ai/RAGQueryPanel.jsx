import { useState, useEffect, useCallback, useRef } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import { notifyError } from '../../stores/toastStore'
import AnswerRenderer from './AnswerRenderer'

const MAX_HISTORY = 10

export default function RAGQueryPanel() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [result,      setResult]      = useState(null)   // { answer, sources, noSourcesFound }
  const [error,       setError]       = useState(null)
  const [history,     setHistory]     = useState([])     // last N query strings
  const [hasEmbedded, setHasEmbedded] = useState(false)  // any indexed sources for this campaign?
  const [srdIndexed,  setSrdIndexed]  = useState(false)  // the shared SRD index
  const [aiMode,      setAiMode]      = useState(null)   // 'online' | 'offline-ollama' | 'no-ai'
  const [situation,   setSituation]   = useState(false)  // situation mode toggle

  const textareaRef = useRef(null)

  // ── What can we answer from, and with what? ───────────────────────────────
  //
  // The Ask button is gated on having SOMETHING to retrieve from — this
  // campaign's own books or the shared SRD index — not on AI being configured.
  // In no-ai mode the retrieved passages are the answer.
  const checkSources = useCallback(async () => {
    if (!activeCampaign?.id) return
    try {
      const sources = await window.electronAPI.db.pdf.getAll(activeCampaign.id)
      setHasEmbedded(sources.some(s => s.status === 'embedded' || s.chunk_count > 0))
    } catch { setHasEmbedded(false) }

    try {
      const srd = await window.electronAPI.srd.getIndexStatus()
      setSrdIndexed(srd.chunks > 0)
    } catch { setSrdIndexed(false) }

    try {
      // getMode resolves to an OBJECT — destructure it. Comparing the whole
      // result to a string is silently always false (aiHandlers.js:9).
      const { mode } = await window.electronAPI.ai.getMode()
      setAiMode(mode)
    } catch { setAiMode('no-ai') }
  }, [activeCampaign?.id])

  useEffect(() => { checkSources() }, [checkSources])

  const canAsk     = hasEmbedded || srdIndexed
  const noAi       = aiMode === 'no-ai'
  // Situation mode needs a model to decompose the question, so it cannot degrade
  // the way single-rule lookup does. Hidden rather than shown-and-broken.
  const canSituate = canAsk && aiMode !== null && !noAi

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
      const res = situation
        ? await window.electronAPI.ai.ragSituation(q, activeCampaign.id, { topK: 3 })
        : await window.electronAPI.ai.ragQuery(q, activeCampaign.id, { topK: 5 })
      setResult(res)
    } catch (err) {
      setError(err.message ?? 'Query failed')
      notifyError(err, situation ? 'Situation lookup' : 'Rules lookup')
    } finally {
      setLoading(false)
    }
  }, [input, loading, activeCampaign?.id, situation])

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
          style={(!canAsk || loading || !input.trim()) ? s.btnDisabled : s.btnAsk}
          onClick={() => handleAsk()}
          disabled={!canAsk || loading || !input.trim()}
          title={!canAsk
            ? 'Index the SRD in Settings, or upload a source book, to enable rules Q&A'
            : 'Ask question (Enter)'}
        >
          {loading ? '⏳' : situation ? 'Rule on it' : 'Ask'}
        </button>
      </div>

      {/* ── Mode row ─── */}
      <div style={s.modeRow}>
        {canSituate && (
          <label style={s.situationToggle} title="Break a multi-rule situation into its parts, look each one up, then rule on the whole">
            <input
              type="checkbox"
              checked={situation}
              onChange={e => setSituation(e.target.checked)}
              disabled={loading}
            />
            <span>Situation mode</span>
          </label>
        )}
        {canAsk && (
          <span style={s.sourceNote}>
            {srdIndexed && 'SRD 5.1'}
            {srdIndexed && hasEmbedded && ' + '}
            {hasEmbedded && 'your source books'}
            {noAi && ' · passages only (no AI configured)'}
          </span>
        )}
      </div>

      {/* ── No-sources nudge ─── */}
      {!canAsk && (
        <p style={s.noSources}>
          Nothing to search yet. Open <strong>Settings → Rules Q&amp;A Index</strong> and
          index the bundled SRD, or upload a source book. Neither needs an API key.
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

          {/* Keyword-only search: say so rather than quietly returning worse hits */}
          {result.degraded && (
            <div style={s.degradedNote}>
              🔍 Keyword search — {result.degradedReason === 'embedding-model-missing'
                ? 'the nomic-embed-text model is not installed'
                : result.degradedReason === 'ollama-unavailable'
                  ? 'Ollama is not running'
                  : 'nothing has been embedded yet'}.
              Results are less precise than semantic search.
            </div>
          )}

          {/* No sources at all */}
          {result.noSourcesFound && (
            <div style={s.noSourceWarning}>
              {result.extractedPassages
                ? '⚠ No relevant passages found. Try different wording, or index the SRD in Settings.'
                : '⚠ No relevant passages found in your sources. Answer generated from general AI knowledge.'}
            </div>
          )}

          {/* Situation mode: what the model decided to look up */}
          {result.concepts?.length > 0 && (
            <div style={s.conceptsBox}>
              <span style={s.conceptsLabel}>Rules consulted:</span>
              {result.concepts.map((c, i) => (
                <span key={i} style={s.conceptChip}>{c}</span>
              ))}
            </div>
          )}

          {/* no-ai: the passages ARE the result, so they lead */}
          {result.extractedPassages ? (
            result.sources?.length > 0 && (
              <PassagesPanel sources={result.sources} />
            )
          ) : (
            <>
              <div style={s.answerBox}>
                <AnswerRenderer text={result.answer} />
              </div>
              {result.sources?.length > 0 && <SourcesPanel sources={result.sources} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── no-ai result: the retrieved passages, rendered as the primary answer ──────
//
// Without a model there is nothing to summarise, but the SRD text for a single
// rule usually answers the question on its own. This used to throw "No AI
// service available" instead.
function PassagesPanel({ sources }) {
  return (
    <div style={pp.container}>
      <h3 style={pp.heading}>Relevant passages</h3>
      <p style={pp.subhead}>
        No AI model is configured, so these are the rules text itself rather than a summary.
      </p>
      {sources.map((src, i) => (
        <article key={i} style={pp.passage}>
          <header style={pp.header}>
            <span style={pp.source}>{src.source}</span>
            <span style={pp.page}>{src.isSrd ? src.page : `p.${src.page}`}</span>
          </header>
          <pre style={pp.text}>{src.text ?? src.preview}</pre>
        </article>
      ))}
    </div>
  )
}

const pp = {
  container: { marginTop: 12 },
  heading:   { color: '#c9a84c', fontSize: '1rem', margin: '0 0 2px' },
  subhead:   { color: '#6b5a3a', fontSize: '0.78rem', margin: '0 0 10px' },
  passage:   { background: '#15100a', border: '1px solid #3a2a10', borderRadius: 4, padding: '0.7rem 0.8rem', marginBottom: 8 },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  source:    { color: '#c9a84c', fontSize: '0.82rem', fontWeight: 'bold' },
  page:      { color: '#6b5a3a', fontSize: '0.75rem' },
  text:      { color: '#e8e0d0', fontSize: '0.84rem', lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' },
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
  modeRow:         { display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 2px', flexWrap: 'wrap' },
  situationToggle: { display: 'flex', alignItems: 'center', gap: 6, color: '#a89060', fontSize: '0.8rem', cursor: 'pointer' },
  sourceNote:      { color: '#6b5a3a', fontSize: '0.75rem' },
  degradedNote:    { background: '#241a08', border: '1px solid #6b5a3a', borderRadius: 4, color: '#c9a84c', fontSize: '0.8rem', padding: '0.5rem 0.7rem', marginBottom: 8 },
  conceptsBox:     { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  conceptsLabel:   { color: '#6b5a3a', fontSize: '0.75rem' },
  conceptChip:     { background: '#1a1408', border: '1px solid #3a2a10', borderRadius: 10, color: '#a89060', fontSize: '0.72rem', padding: '2px 8px' },
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
