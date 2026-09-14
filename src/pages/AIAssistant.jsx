import { useState, useEffect, useCallback, useRef } from 'react'
import useCampaignStore from '../stores/campaignStore'
import useAiStore       from '../stores/aiStore'
import AIToolbox     from '../components/ai/AIToolbox'
import AnswerRenderer from '../components/ai/AnswerRenderer'
import SuggestionCards from '../components/ai/SuggestionCards'
import { buildCampaignContext, clampBudget, DEFAULT_CONTEXT_BUDGET } from '../utils/aiContext'
import { notifyError } from '../stores/toastStore'

const MAX_HISTORY = 20   // max messages sent to AI per request
const CURSOR      = '▋'  // blinking cursor appended during streaming

// The system prompt moved to src/utils/aiContext.js in Phase 6.
//
// The version that lived here interpolated EVERY character and EVERY faction
// with no cap — a campaign with 60 factions put 60 names in every message — and
// showed the model no lore, no locations and no descriptions at all. It knew a
// world had "12 locations" and not what any of them were. aiContext applies a
// character budget section by section and is unit-tested against it.

// ── Mode indicator label + colour ─────────────────────────────────────────────
function getModeDisplay(mode) {
  if (!mode) return { label: 'Checking…', color: '#555' }
  const m = typeof mode === 'object' ? mode.mode : mode
  if (m === 'online')         return { label: '● Claude API',        color: '#5aaa5a' }
  if (m === 'offline-ollama') return { label: '● Local AI — Ollama', color: '#C9A84C' }
  return                             { label: '● No AI configured',  color: '#c05050' }
}

export default function AIAssistant() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  // Campaign context for the system prompt. Locations, lore, the current
  // session and open plot threads are new in Phase 6 — the prompt previously
  // had none of them.
  const [characters, setCharacters] = useState([])
  const [npcs,       setNpcs]       = useState([])
  const [factions,   setFactions]   = useState([])
  const [locations,  setLocations]  = useState([])
  const [lore,       setLore]       = useState([])
  const [session,    setSession]    = useState(null)
  const [plots,      setPlots]      = useState([])
  const [budget,     setBudget]     = useState(DEFAULT_CONTEXT_BUDGET)
  const [showUsage,  setShowUsage]  = useState(false)

  // "Save as…" — structured extraction over one assistant message (task 4)
  const [extractFrom, setExtractFrom] = useState(null)

  // Chat state — stored in aiStore so it survives page navigation
  const history        = useAiStore(s => s.history)
  const setHistory     = useAiStore(s => s.setHistory)
  const input          = useAiStore(s => s.input)
  const setInput       = useAiStore(s => s.setInput)
  const isStreaming    = useAiStore(s => s.isStreaming)
  const setIsStreaming = useAiStore(s => s.setIsStreaming)
  const ragMode        = useAiStore(s => s.ragMode)
  const setRagMode     = useAiStore(s => s.setRagMode)
  const clearHistory   = useAiStore(s => s.clearHistory)
  const setStoreCampaign = useAiStore(s => s.setCampaign)

  const [aiMode,      setAiMode]      = useState(null)
  const [hasEmbedded, setHasEmbedded] = useState(false)

  const chatEndRef  = useRef(null)
  const textareaRef = useRef(null)

  // Chat history is stored per campaign, so switching campaigns swaps the log
  // rather than showing a DM notes from a different world.
  useEffect(() => {
    setStoreCampaign(activeCampaign?.id ?? null)
  }, [activeCampaign?.id, setStoreCampaign])

  // ── Load campaign context ──────────────────────────────────────────────────
  useEffect(() => {
    if (!activeCampaign?.id) return
    const api = window.electronAPI.db
    // allSettled: one failing table must not blank the whole context. A campaign
    // with no sessions yet is the normal case, not an error.
    Promise.allSettled([
      api.characters.getAll(activeCampaign.id),
      api.npcs.getAll(activeCampaign.id),
      api.factions.getAll(activeCampaign.id),
      api.locations.getAll(activeCampaign.id),
      api.lore.getAll(activeCampaign.id),
      api.sessions.getCurrent(activeCampaign.id),
      api.plots.getAll(activeCampaign.id),
    ]).then(([chars, n, f, l, lo, sess, pl]) => {
      const val = (r, fallback) => (r.status === 'fulfilled' && r.value != null ? r.value : fallback)
      setCharacters(val(chars, []))
      setNpcs(val(n, []))
      setFactions(val(f, []))
      setLocations(val(l, []))
      setLore(val(lo, []))
      setSession(val(sess, null))
      setPlots(val(pl, []))
    })

    // The context budget lives with the other RAG settings.
    window.electronAPI.rag.getSettings()
      .then(cfg => setBudget(clampBudget(cfg?.contextBudget)))
      .catch(() => setBudget(DEFAULT_CONTEXT_BUDGET))

    // Check for embedded sources
    window.electronAPI.db.pdf.getAll(activeCampaign.id)
      .then(sources => setHasEmbedded(sources.some(s => s.status === 'embedded' || s.chunk_count > 0)))
      .catch(() => setHasEmbedded(false))
  }, [activeCampaign?.id])

  // ── Check AI mode ──────────────────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.ai.getMode().then(setAiMode).catch(() => setAiMode({ mode: 'no-ai' }))
  }, [])

  // ── Auto-scroll to latest message ─────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  // ── Cleanup stream listeners on unmount ───────────────────────────────────
  useEffect(() => {
    return () => window.electronAPI.ai.offStream()
  }, [])

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const userMessage = input.trim()
    if (!userMessage || isStreaming) return

    setInput('')
    setIsStreaming(true)

    // Add user message to history
    const userEntry = { role: 'user', content: userMessage }
    setHistory(prev => [...prev, userEntry])

    // ── RAG mode path (non-streaming) ────────────────────────────────────────
    if (ragMode && hasEmbedded && activeCampaign?.id) {
      try {
        const result = await window.electronAPI.ai.ragQuery(userMessage, activeCampaign.id)
        setHistory(prev => [
          ...prev,
          { role: 'assistant', content: result.answer, sources: result.sources, noSourcesFound: result.noSourcesFound },
        ])
      } catch (err) {
        setHistory(prev => [
          ...prev,
          { role: 'assistant', content: `⚠ Error: ${err.message ?? 'Request failed'}`, isError: true },
        ])
      } finally {
        setIsStreaming(false)
      }
      return
    }

    // ── Streaming path ────────────────────────────────────────────────────────
    // Add empty assistant placeholder for streaming into
    setHistory(prev => [...prev, { role: 'assistant', content: CURSOR }])

    const requestId = crypto.randomUUID()

    // Build messages array for multi-turn (last MAX_HISTORY turns, strip cursor)
    const cleanHistory = (prev) => prev
      .filter(m => !m.isError)
      .map(m => ({ role: m.role, content: m.content === CURSOR ? '' : m.content.replace(CURSOR, '') }))

    window.electronAPI.ai.offStream()

    window.electronAPI.ai.onStreamChunk(({ requestId: rid, chunk }) => {
      if (rid !== requestId) return
      setHistory(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        // Replace cursor with chunk, keep cursor at end while streaming
        const base = last.content === CURSOR ? '' : last.content.replace(CURSOR, '')
        next[next.length - 1] = { ...last, content: base + chunk + CURSOR }
        return next
      })
    })

    window.electronAPI.ai.onStreamDone(({ requestId: rid }) => {
      if (rid !== requestId) return
      // Remove trailing cursor
      setHistory(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        next[next.length - 1] = { ...last, content: last.content.replace(CURSOR, '') }
        return next
      })
      setIsStreaming(false)
      window.electronAPI.ai.offStream()
    })

    window.electronAPI.ai.onStreamError(({ requestId: rid, error }) => {
      if (rid !== requestId) return
      setHistory(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: `⚠ ${error ?? 'Stream error'}`, isError: true }
        return next
      })
      setIsStreaming(false)
      window.electronAPI.ai.offStream()
    })

    // Build messages to send — include full conversation history (last MAX_HISTORY)
    setHistory(prev => {
      const messages = cleanHistory(prev).slice(-MAX_HISTORY)
      const { prompt: systemPrompt } = buildCampaignContext(
        { campaign: activeCampaign, characters, npcs, factions, locations, lore, session, plots },
        { budget },
      )
      window.electronAPI.ai.streamStart(systemPrompt, messages, requestId)
      return prev
    })
  }, [input, isStreaming, ragMode, hasEmbedded, activeCampaign,
      characters, npcs, factions, locations, lore, session, plots, budget])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleClear = useCallback(() => {
    clearHistory()
    window.electronAPI.ai.offStream()
  }, [clearHistory])

  const handleInsertPrompt = useCallback((prompt) => {
    setInput(prompt)
    textareaRef.current?.focus()
  }, [])

  const modeDisplay = getModeDisplay(aiMode)
  const noAi = getModeDisplay(aiMode).label.includes('No AI')

  // Recomputed for the readout only; handleSend builds its own at send time.
  const contextUsage = buildCampaignContext(
    { campaign: activeCampaign, characters, npcs, factions, locations, lore, session, plots },
    { budget },
  ).usage

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>

      {/* ── Left panel: Chat (60%) ─── */}
      <div style={s.chatPanel}>

        {/* Chat history */}
        <div style={s.chatHistory}>
          {history.length === 0 && (
            <div style={s.emptyChat}>
              <span style={s.emptyChatIcon}>🤖</span>
              <p style={s.emptyChatTitle}>AI Dungeon Master Assistant</p>
              <p style={s.emptyChatDesc}>
                Ask for encounter ideas, NPC descriptions, rules clarifications,
                lore generation, or anything else your campaign needs.
              </p>
            </div>
          )}

          {history.map((msg, i) => (
            <ChatMessage
              key={i}
              message={msg}
              canSave={!noAi && !isStreaming && msg.role === 'assistant' && !msg.isError}
              onSaveAs={() => setExtractFrom(msg.content)}
            />
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div style={s.inputArea}>

          {/* Mode + RAG indicators */}
          <div style={s.statusRow}>
            <span style={{ ...s.modeIndicator, color: modeDisplay.color }}>
              {modeDisplay.label}
            </span>
            {ragMode && hasEmbedded && (
              <span style={s.ragPill}>📚 Rules Q&amp;A</span>
            )}

            {/* Context budget. The old prompt had no budget and no warning when
                it grew; this makes the cost visible before it becomes a bill. */}
            {activeCampaign && (
              <button
                style={{
                  ...s.budgetPill,
                  ...(contextUsage.percent >= 90 ? s.budgetPillFull : {}),
                }}
                onClick={() => setShowUsage(v => !v)}
                title="What the AI is told about your campaign"
              >
                🧠 {contextUsage.total} / {contextUsage.budget} chars
              </button>
            )}

            <div style={s.spacer} />
            <button style={s.clearBtn} onClick={handleClear} disabled={isStreaming || history.length === 0}>
              Clear Conversation
            </button>
          </div>

          {showUsage && (
            <div style={s.usagePanel}>
              <p style={s.usageTitle}>
                Campaign context — {contextUsage.percent}% of the {contextUsage.budget}-character budget
              </p>
              <div style={s.usageGrid}>
                {contextUsage.sections.map(sec => (
                  <span
                    key={sec.name}
                    style={{ ...s.usageChip, ...(sec.included ? {} : s.usageChipOut) }}
                  >
                    {sec.name} {sec.included ? `${sec.chars}` : '—'}
                  </span>
                ))}
              </div>
              <p style={s.usageNote}>
                Sections are filled in priority order, so when a world is too large to
                describe it is the long tail of NPC names that is dropped, never the party
                or the session you are running. Change the budget in Settings.
              </p>
            </div>
          )}

          <div style={s.inputRow}>
            <textarea
              ref={textareaRef}
              style={s.textarea}
              placeholder={ragMode && hasEmbedded
                ? 'Ask a rules question… (searching your source books)'
                : 'Ask your AI assistant…'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              disabled={isStreaming}
            />
            <button
              style={(isStreaming || !input.trim()) ? s.btnDisabled : s.btnSend}
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
            >
              {isStreaming ? '⏳' : 'Ask'}
            </button>
          </div>
        </div>
      </div>

      {/* Structured extraction over one assistant message — the same card UI
          the World Builder panel uses, so an idea in chat is one click from
          being a saved faction rather than something to re-type by hand. */}
      {extractFrom && (
        <SuggestionCards
          mode="modal"
          campaign={activeCampaign}
          sourceText={extractFrom}
          world={{ npcs, locations, factions, lore }}
          onClose={() => setExtractFrom(null)}
          onSaved={() => {
            // Re-read the world so the next prompt knows what was just written.
            const api = window.electronAPI.db
            Promise.allSettled([
              api.npcs.getAll(activeCampaign.id),
              api.locations.getAll(activeCampaign.id),
              api.factions.getAll(activeCampaign.id),
              api.lore.getAll(activeCampaign.id),
            ]).then(([n, l, f, lo]) => {
              const val = (r) => (r.status === 'fulfilled' && r.value != null ? r.value : [])
              setNpcs(val(n)); setLocations(val(l)); setFactions(val(f)); setLore(val(lo))
            }).catch(err => notifyError(err, 'Reload world'))
          }}
        />
      )}

      {/* ── Right panel: Toolbox (40%) ─── */}
      <div style={s.toolboxPanel}>
        <AIToolbox
          onInsertPrompt={handleInsertPrompt}
          ragMode={ragMode}
          onToggleRag={() => setRagMode(r => !r)}
          hasEmbeddedSources={hasEmbedded}
          activeCampaign={activeCampaign}
        />
      </div>

    </div>
  )
}

// ── Individual chat message ───────────────────────────────────────────────────
function ChatMessage({ message, canSave = false, onSaveAs }) {
  const isUser = message.role === 'user'

  return (
    <div style={{ ...s.msgWrap, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        ...s.msgBubble,
        ...(isUser ? s.msgUser : s.msgAssistant),
        ...(message.isError ? s.msgError : {}),
      }}>
        {isUser
          ? <span style={s.msgText}>{message.content}</span>
          : <AnswerRenderer text={message.content} />
        }

        {/* Sources panel for RAG answers */}
        {!isUser && message.sources?.length > 0 && (
          <InlineSourcesPanel sources={message.sources} noSourcesFound={message.noSourcesFound} />
        )}

        {/* No-sources-found warning */}
        {!isUser && message.noSourcesFound && (
          <div style={s.noSourceNote}>
            ⚠ No relevant passages found — answered from general AI knowledge.
          </div>
        )}

        {canSave && (
          <button style={s.saveAsBtn} onClick={onSaveAs} title="Turn this into saved records">
            💾 Save as…
          </button>
        )}
      </div>
    </div>
  )
}

function InlineSourcesPanel({ sources }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={isp.container}>
      <button style={isp.toggle} onClick={() => setOpen(o => !o)}>
        📄 Sources ({sources.length}) {open ? '▲' : '▼'}
      </button>
      {open && (
        <div style={isp.list}>
          {sources.map((src, i) => (
            <span key={i} style={isp.chip}>
              {src.source} p.{src.page} · {Math.round(src.score * 100)}%
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page: {
    display:  'flex',
    height:   '100%',
    overflow: 'hidden',
    background: '#0d0a05',
  },

  // Chat panel — 60%
  chatPanel: {
    flex:          '0 0 60%',
    display:       'flex',
    flexDirection: 'column',
    borderRight:   '1px solid #2a1a08',
    overflow:      'hidden',
  },
  chatHistory: {
    flex:      1,
    overflowY: 'auto',
    padding:   '16px 20px',
    display:   'flex',
    flexDirection: 'column',
    gap:       12,
  },
  emptyChat: {
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    justifyContent:'center',
    flex:          1,
    padding:       '40px 20px',
    gap:           8,
    textAlign:     'center',
  },
  emptyChatIcon:  { fontSize: 40, marginBottom: 4 },
  emptyChatTitle: { color: '#C9A84C', fontSize: 16, fontWeight: 600, margin: 0 },
  emptyChatDesc:  { color: '#666', fontSize: 12, margin: 0, maxWidth: 360, lineHeight: 1.6 },

  // Messages
  msgWrap: {
    display: 'flex',
    width:   '100%',
  },
  msgBubble: {
    maxWidth:     '80%',
    padding:      '10px 14px',
    borderRadius: 8,
    fontSize:     13,
    lineHeight:   1.6,
  },
  msgUser: {
    background:   '#1e1608',
    border:       '1px solid #C9A84C44',
    color:        '#c9c0a8',
    borderBottomRightRadius: 2,
  },
  msgAssistant: {
    background:   'rgba(13, 10, 5, 0.7)',
    border:       '1px solid #2a1a08',
    color:        '#c9c0a8',
    borderBottomLeftRadius: 2,
  },
  msgError: {
    background:  '#2a0d0d',
    border:      '1px solid #7a2a2a',
    color:       '#c05050',
  },
  msgText: {
    whiteSpace: 'pre-wrap',
    wordBreak:  'break-word',
  },
  noSourceNote: {
    marginTop:  8,
    padding:    '5px 8px',
    background: '#1f1500',
    border:     '1px solid #5a4010',
    borderRadius: 4,
    color:      '#C9A84C',
    fontSize:   11,
  },

  // Input area
  inputArea: {
    borderTop:  '1px solid #2a1a08',
    padding:    '12px 16px',
    flexShrink: 0,
    display:    'flex',
    flexDirection: 'column',
    gap:        8,
  },
  statusRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        10,
  },
  modeIndicator: {
    fontSize:   11,
    fontWeight: 600,
  },
  // Context budget readout
  budgetPill: {
    padding: '1px 8px', background: '#141008', border: '1px solid #3a2a10',
    borderRadius: 10, color: '#a89060', fontSize: 11, cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  budgetPillFull: { borderColor: '#8a6a2a', color: '#c9a84c', background: '#2a2010' },
  usagePanel: {
    background: '#100d08', border: '1px solid #2a2010', borderRadius: 4,
    padding: '8px 10px', marginBottom: 8,
  },
  usageTitle: { color: '#c9a84c', fontSize: 12, margin: '0 0 6px' },
  usageGrid:  { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 },
  usageChip:  {
    fontSize: 10, background: '#1a1408', border: '1px solid #3a2a10',
    borderRadius: 8, padding: '1px 7px', color: '#a89060',
  },
  usageChipOut: { color: '#4a4238', borderColor: '#241c10', textDecoration: 'line-through' },
  usageNote:  { color: '#5a5040', fontSize: 10.5, margin: 0, lineHeight: 1.5 },

  // "Save as…" on an assistant message
  saveAsBtn: {
    marginTop: 8, padding: '3px 10px', background: 'none',
    border: '1px solid #3a2a10', borderRadius: 4, color: '#a89060',
    fontSize: 11, cursor: 'pointer',
  },

  ragPill: {
    padding:      '1px 8px',
    background:   '#0d1a30',
    border:       '1px solid #3a5a9a',
    borderRadius: 10,
    color:        '#6a9ae0',
    fontSize:     10,
    fontWeight:   600,
  },
  spacer: { flex: 1 },
  clearBtn: {
    padding:      '3px 10px',
    background:   'none',
    border:       '1px solid #2a1a08',
    borderRadius: 4,
    color:        '#555',
    cursor:       'pointer',
    fontSize:     11,
  },
  inputRow: {
    display:    'flex',
    gap:        8,
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
  btnSend: {
    padding:      '8px 20px',
    background:   '#2a1f06',
    border:       '1px solid #C9A84C',
    borderRadius: 4,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     13,
    fontWeight:   600,
    alignSelf:    'stretch',
  },
  btnDisabled: {
    padding:      '8px 20px',
    background:   '#1a1208',
    border:       '1px solid #333',
    borderRadius: 4,
    color:        '#555',
    cursor:       'not-allowed',
    fontSize:     13,
    fontWeight:   600,
    alignSelf:    'stretch',
  },

  // Toolbox panel — 40%
  toolboxPanel: {
    flex:     '0 0 40%',
    overflow: 'hidden',
    display:  'flex',
    flexDirection: 'column',
  },
}

const isp = {
  container: {
    marginTop: 8,
  },
  toggle: {
    background:  'none',
    border:      'none',
    color:       '#888',
    cursor:      'pointer',
    fontSize:    11,
    padding:     0,
  },
  list: {
    display:  'flex',
    flexWrap: 'wrap',
    gap:      4,
    marginTop: 4,
  },
  chip: {
    padding:      '2px 7px',
    background:   '#0d0a05',
    border:       '1px solid #2a1a08',
    borderRadius: 10,
    color:        '#776855',
    fontSize:     10,
  },
}
