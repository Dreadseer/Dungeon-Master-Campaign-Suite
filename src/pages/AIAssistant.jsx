import { useState, useEffect, useCallback, useRef } from 'react'
import useCampaignStore from '../stores/campaignStore'
import useAiStore       from '../stores/aiStore'
import AIToolbox     from '../components/ai/AIToolbox'
import AnswerRenderer from '../components/ai/AnswerRenderer'

const MAX_HISTORY = 20   // max messages sent to AI per request
const CURSOR      = '▋'  // blinking cursor appended during streaming

// ── Build system prompt with live campaign context ────────────────────────────
function buildSystemPrompt(activeCampaign, characters, npcs, factions) {
  return [
    'You are an AI assistant for a Dungeon Master running a D&D 5e campaign.',
    'Be helpful, creative, and specific. Keep responses concise and immediately usable at the game table.',
    '',
    activeCampaign
      ? `Campaign: "${activeCampaign.name}"${activeCampaign.world_setting ? ` set in ${activeCampaign.world_setting}` : ''}`
      : '',
    characters.length
      ? `Player Characters: ${characters.map(c => `${c.character_name} (${c.race ?? '?'} ${c.class ?? '?'} Lv.${c.level ?? 1})`).join(', ')}`
      : '',
    npcs.length
      ? `Notable NPCs: ${npcs.slice(0, 5).map(n => n.name).join(', ')}${npcs.length > 5 ? ` and ${npcs.length - 5} more` : ''}`
      : '',
    factions.length
      ? `Active factions: ${factions.map(f => f.name).join(', ')}`
      : '',
  ].filter(Boolean).join('\n')
}

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

  // Campaign context for system prompt
  const [characters, setCharacters] = useState([])
  const [npcs,       setNpcs]       = useState([])
  const [factions,   setFactions]   = useState([])

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

  const [aiMode,      setAiMode]      = useState(null)
  const [hasEmbedded, setHasEmbedded] = useState(false)

  const chatEndRef  = useRef(null)
  const textareaRef = useRef(null)

  // ── Load campaign context ──────────────────────────────────────────────────
  useEffect(() => {
    if (!activeCampaign?.id) return
    Promise.all([
      window.electronAPI.db.characters.getAll(activeCampaign.id),
      window.electronAPI.db.npcs.getAll(activeCampaign.id),
      window.electronAPI.db.factions.getAll(activeCampaign.id),
    ]).then(([chars, n, f]) => {
      setCharacters(chars)
      setNpcs(n)
      setFactions(f)
    }).catch(() => {})

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
      const systemPrompt = buildSystemPrompt(activeCampaign, characters, npcs, factions)
      window.electronAPI.ai.streamStart(systemPrompt, messages, requestId)
      return prev
    })
  }, [input, isStreaming, ragMode, hasEmbedded, activeCampaign, characters, npcs, factions])

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
            <ChatMessage key={i} message={msg} />
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
            <div style={s.spacer} />
            <button style={s.clearBtn} onClick={handleClear} disabled={isStreaming || history.length === 0}>
              Clear Conversation
            </button>
          </div>

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
function ChatMessage({ message }) {
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
