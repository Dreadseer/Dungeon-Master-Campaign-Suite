import { useState, useEffect, useCallback } from 'react'
import useCampaignStore from '../stores/campaignStore'

export default function Settings() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  // ── API Key state ──────────────────────────────────────────────────────────
  const [keyInput,   setKeyInput]   = useState('')
  const [hasKey,     setHasKey]     = useState(false)
  const [aiMode,     setAiMode]     = useState('')
  const [statusMsg,  setStatusMsg]  = useState('')
  const [testing,    setTesting]    = useState(false)
  const [saving,     setSaving]     = useState(false)

  // ── RAG settings state ─────────────────────────────────────────────────────
  const [topK,            setTopK]            = useState(5)
  const [scoreThreshold,  setScoreThreshold]  = useState(0.5)
  const [ollamaModel,     setOllamaModel]     = useState('llama3')
  const [embedModel,      setEmbedModel]      = useState('nomic-embed-text')
  const [ragSaving,       setRagSaving]       = useState(false)
  const [ragMsg,          setRagMsg]          = useState('')

  // ── Usage stats state ──────────────────────────────────────────────────────
  const [usageStats,  setUsageStats]  = useState(null)
  const [clearingLog, setClearingLog] = useState(false)

  // ── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.ai.hasKey().then(({ hasKey: h }) => setHasKey(h))
    window.electronAPI.ai.getMode().then(r => setAiMode(r?.mode ?? r))

    window.electronAPI.rag.getSettings().then(settings => {
      if (settings) {
        if (settings.topK           != null) setTopK(settings.topK)
        if (settings.scoreThreshold != null) setScoreThreshold(settings.scoreThreshold)
        if (settings.ollamaModel)            setOllamaModel(settings.ollamaModel)
        if (settings.embedModel)             setEmbedModel(settings.embedModel)
      }
    }).catch(() => {})

    loadUsageStats()
  }, [])

  const loadUsageStats = useCallback(() => {
    window.electronAPI.ai.getUsageStats(activeCampaign?.id ?? null)
      .then(setUsageStats)
      .catch(() => setUsageStats(null))
  }, [activeCampaign?.id])

  useEffect(() => { loadUsageStats() }, [loadUsageStats])

  // ── API Key handlers ───────────────────────────────────────────────────────
  async function handleSave() {
    if (!keyInput.trim()) return
    setSaving(true); setStatusMsg('')
    try {
      const result = await window.electronAPI.ai.saveKey(keyInput.trim())
      const mode   = result?.mode ?? result
      setAiMode(mode)
      setHasKey(true)
      setKeyInput('')
      setStatusMsg(mode === 'online'
        ? '✅ Key saved — Claude API connected.'
        : '⚠ Key saved but connection failed. Check your key.')
    } catch (err) {
      setStatusMsg('❌ Error: ' + err.message)
    }
    setSaving(false)
  }

  async function handleRemove() {
    await window.electronAPI.ai.deleteKey()
    setHasKey(false); setKeyInput('')
    const result = await window.electronAPI.ai.getMode()
    setAiMode(result?.mode ?? result)
    setStatusMsg('Key removed.')
  }

  async function handleTest() {
    setTesting(true); setStatusMsg('')
    try {
      const reply = await window.electronAPI.ai.complete('You are a helpful assistant.', 'Reply with only the word CONNECTED.')
      setStatusMsg('✅ Connection test: ' + reply.trim())
    } catch (err) {
      setStatusMsg('❌ Test failed: ' + err.message)
    }
    setTesting(false)
  }

  async function handleOllamaCheck() {
    setStatusMsg('')
    const result = await window.electronAPI.ai.initialize()
    setAiMode(result?.mode ?? result)
    setStatusMsg('Ollama check complete. Mode: ' + (result?.mode ?? result))
  }

  // ── RAG settings handlers ──────────────────────────────────────────────────
  async function handleSaveRagSettings() {
    setRagSaving(true); setRagMsg('')
    try {
      await window.electronAPI.rag.saveSettings({ topK, scoreThreshold, ollamaModel, embedModel })
      setRagMsg('✅ Settings saved.')
    } catch (err) {
      setRagMsg('❌ ' + err.message)
    }
    setRagSaving(false)
  }

  // ── Usage log handlers ─────────────────────────────────────────────────────
  async function handleClearLog() {
    setClearingLog(true)
    await window.electronAPI.ai.clearUsageLog(activeCampaign?.id ?? null)
    await loadUsageStats()
    setClearingLog(false)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function usageRow(label, type) {
    if (!usageStats) return null
    const row = usageStats.rows?.find(r => r.type === type)
    return row ? { label, count: row.count, avgMs: Math.round(row.avg_ms) } : null
  }

  const chatRow = usageRow('Chat queries',    'chat')
  const ragRow  = usageRow('Rules Q&A (RAG)', 'rag')
  const ragFbRow = usageRow('RAG fallback',   'rag_fallback')

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <h1 style={s.pageTitle}>Settings</h1>

      {/* ── AI Configuration ─── */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>AI Configuration</h2>
        <p style={s.modeLabel}>Current mode: <strong style={s.modeValue}>{aiMode || '…'}</strong></p>

        <label style={s.label}>Anthropic API Key</label>
        {hasKey ? (
          <div style={s.row}>
            <input style={s.input} type="password" value="••••••••••••••••" readOnly />
            <button style={s.btnDanger} onClick={handleRemove}>Remove Key</button>
          </div>
        ) : (
          <div style={s.row}>
            <input
              style={s.input} type="password" placeholder="sk-ant-..."
              value={keyInput} onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <button style={s.btnPrimary} onClick={handleSave} disabled={saving || !keyInput.trim()}>
              {saving ? 'Saving…' : 'Save Key'}
            </button>
          </div>
        )}

        <div style={s.row}>
          <button style={s.btnSecondary} onClick={handleTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
        {statusMsg && <p style={s.status}>{statusMsg}</p>}
      </section>

      {/* ── Ollama ─── */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>Ollama (Offline AI)</h2>
        <p style={s.body}>
          Ollama runs locally and requires no API key. Install from{' '}
          <strong style={{ color: '#c9a84c' }}>ollama.com</strong> and run:{' '}
          <code style={s.code}>ollama pull llama3</code>
        </p>
        <button style={s.btnSecondary} onClick={handleOllamaCheck}>
          Check Ollama Status
        </button>
      </section>

      {/* ── Model Configuration ─── */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>Model Configuration</h2>

        <div style={s.fieldGroup}>
          <label style={s.label}>Online Model (Claude)</label>
          <input style={{ ...s.input, color: '#666', cursor: 'not-allowed' }}
            value="claude-sonnet-4-20250514" readOnly
            title="Locked per project spec — change requires code update" />
          <span style={s.hint}>Locked — defined in AIService.js</span>
        </div>

        <div style={s.fieldGroup}>
          <label style={s.label}>Offline Model (Ollama)</label>
          <input style={s.input} value={ollamaModel}
            onChange={e => setOllamaModel(e.target.value)}
            placeholder="llama3" />
          <span style={s.hint}>Model name passed to Ollama. Run <code style={s.code}>ollama pull {ollamaModel}</code> first.</span>
        </div>

        <div style={s.fieldGroup}>
          <label style={s.label}>Embedding Model</label>
          <input style={s.input} value={embedModel}
            onChange={e => setEmbedModel(e.target.value)}
            placeholder="nomic-embed-text" />
          <span style={s.hint}>
            ⚠ Changing this requires re-embedding all PDF sources.
            Run <code style={s.code}>ollama pull {embedModel}</code> first.
          </span>
        </div>
      </section>

      {/* ── RAG Settings ─── */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>RAG Settings</h2>

        {/* topK slider */}
        <div style={s.fieldGroup}>
          <div style={s.sliderHeader}>
            <label style={s.label}>Source chunks per question</label>
            <span style={s.sliderValue}>{topK}</span>
          </div>
          <input type="range" min={1} max={10} step={1}
            value={topK} onChange={e => setTopK(Number(e.target.value))}
            style={s.slider} />
          <span style={s.hint}>Higher values retrieve more context but increase response time (1–10, default 5).</span>
        </div>

        {/* Score threshold slider */}
        <div style={s.fieldGroup}>
          <div style={s.sliderHeader}>
            <label style={s.label}>Minimum relevance score (hybrid fallback)</label>
            <span style={s.sliderValue}>{scoreThreshold.toFixed(2)}</span>
          </div>
          <input type="range" min={0} max={1} step={0.05}
            value={scoreThreshold} onChange={e => setScoreThreshold(Number(e.target.value))}
            style={s.slider} />
          <span style={s.hint}>
            Chunks scoring below this threshold trigger keyword search as a fallback (0.0–1.0, default 0.5).
          </span>
        </div>

        {/* Read-only chunk info */}
        <div style={s.fieldGroup}>
          <label style={s.label}>Chunk size</label>
          <p style={{ ...s.body, margin: 0 }}>
            ~400 tokens per chunk · 80-token overlap between chunks.
            Fixed at ingestion time — re-index sources to change.
          </p>
        </div>

        <div style={s.row}>
          <button style={s.btnPrimary} onClick={handleSaveRagSettings} disabled={ragSaving}>
            {ragSaving ? 'Saving…' : 'Save RAG Settings'}
          </button>
        </div>
        {ragMsg && <p style={s.status}>{ragMsg}</p>}
      </section>

      {/* ── AI Usage Stats ─── */}
      <section style={s.section}>
        <div style={s.statsHeader}>
          <h2 style={{ ...s.sectionTitle, margin: 0 }}>AI Usage Stats</h2>
          {activeCampaign && (
            <span style={s.campaignTag}>Campaign: {activeCampaign.name}</span>
          )}
        </div>

        {!usageStats || usageStats.total === 0 ? (
          <p style={{ ...s.body, fontStyle: 'italic' }}>No AI calls logged yet for this campaign.</p>
        ) : (
          <div style={s.statsGrid}>
            <StatCard label="Total queries"       value={usageStats.total}     />
            <StatCard label="Avg response time"   value={`${usageStats.avgMs} ms`} />
            {chatRow  && <StatCard label={chatRow.label}  value={chatRow.count}  sub={`avg ${chatRow.avgMs} ms`}  />}
            {ragRow   && <StatCard label={ragRow.label}   value={ragRow.count}   sub={`avg ${ragRow.avgMs} ms`}   />}
            {ragFbRow && <StatCard label={ragFbRow.label} value={ragFbRow.count} sub={`avg ${ragFbRow.avgMs} ms`} />}
          </div>
        )}

        <div style={{ ...s.row, marginTop: 12 }}>
          <button style={s.btnDanger} onClick={handleClearLog} disabled={clearingLog}>
            {clearingLog ? 'Clearing…' : 'Clear Usage Log'}
          </button>
          <button style={s.btnSecondary} onClick={loadUsageStats}>↺ Refresh</button>
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div style={sc.card}>
      <span style={sc.value}>{value}</span>
      <span style={sc.label}>{label}</span>
      {sub && <span style={sc.sub}>{sub}</span>}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page:         { padding: '2rem', maxWidth: 640, overflowY: 'auto' },
  pageTitle:    { color: '#c9a84c', fontSize: '1.8rem', marginBottom: '2rem' },
  section:      { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 8, padding: '1.5rem', marginBottom: '1.5rem' },
  sectionTitle: { color: '#c9a84c', fontSize: '1.1rem', marginBottom: '1rem' },
  modeLabel:    { color: '#a89060', fontSize: '0.9rem', marginBottom: '1rem' },
  modeValue:    { color: '#e8e0d0' },
  label:        { display: 'block', color: '#a89060', fontSize: '0.85rem', marginBottom: '0.3rem' },
  row:          { display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', alignItems: 'center', flexWrap: 'wrap' },
  fieldGroup:   { marginBottom: '1.2rem' },
  input:        { flex: 1, background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.5rem 0.75rem', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  hint:         { display: 'block', color: '#666', fontSize: '0.78rem', marginTop: '0.3rem', lineHeight: 1.5 },
  slider:       { width: '100%', accentColor: '#c9a84c', cursor: 'pointer' },
  sliderHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' },
  sliderValue:  { color: '#c9a84c', fontWeight: 700, fontSize: '0.9rem' },
  btnPrimary:   { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', whiteSpace: 'nowrap' },
  btnSecondary: { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnDanger:    { background: 'transparent', color: '#e05050', border: '1px solid #e05050', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', whiteSpace: 'nowrap' },
  status:       { color: '#a89060', fontSize: '0.85rem', marginTop: '0.5rem' },
  body:         { color: '#a89060', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1rem' },
  code:         { background: '#0d0a05', color: '#c9a84c', padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.85rem', fontFamily: 'monospace' },
  statsHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 },
  campaignTag:  { color: '#666', fontSize: '0.8rem', fontStyle: 'italic' },
  statsGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 8 },
}

const sc = {
  card:  { background: '#0d0a05', border: '1px solid #2a1a08', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 },
  value: { color: '#C9A84C', fontSize: '1.4rem', fontWeight: 700 },
  label: { color: '#888', fontSize: '0.75rem' },
  sub:   { color: '#555', fontSize: '0.7rem', marginTop: 2 },
}
