import { clampBudget, DEFAULT_CONTEXT_BUDGET } from '../utils/aiContext'
import useAiMode from '../hooks/useAiMode'
import { parseIpcError } from '../utils/ipcError'
import { useState, useEffect, useCallback } from 'react'
import useCampaignStore from '../stores/campaignStore'
import { notifyError, notifySuccess, notifyInfo } from '../stores/toastStore'

export default function Settings() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  // ── ngrok token state ─────────────────────────────────────────────────────
  const [hasNgrokToken,  setHasNgrokToken]  = useState(false)
  const [ngrokInput,     setNgrokInput]     = useState('')
  const [ngrokSaved,     setNgrokSaved]     = useState(false)
  const [ngrokTestMsg,   setNgrokTestMsg]   = useState('')
  const [ngrokTesting,   setNgrokTesting]   = useState(false)

  // ── API Key state ──────────────────────────────────────────────────────────
  const [keyInput,   setKeyInput]   = useState('')
  const [hasKey,     setHasKey]     = useState(false)
  const [statusMsg,  setStatusMsg]  = useState('')
  const [testing,    setTesting]    = useState(false)
  const [saving,     setSaving]     = useState(false)

  // ── RAG settings state ─────────────────────────────────────────────────────
  const [topK,            setTopK]            = useState(5)
  const [contextBudget,   setContextBudget]   = useState(DEFAULT_CONTEXT_BUDGET)

  // ── AI provider, model and detection (Phase 6.1) ─────────────────────────
  const { mode: liveMode, detection } = useAiMode()
  const [provider,      setProvider]      = useState('auto')
  const [claudeModel,   setClaudeModel]   = useState('')
  const [modelList,     setModelList]     = useState(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [redetecting,   setRedetecting]   = useState(false)
  const [switching,     setSwitching]     = useState(false)
  const [claudeTest,    setClaudeTest]    = useState(null)
  const [ollamaTest,    setOllamaTest]    = useState(null)
  const [keyReadable,   setKeyReadable]   = useState(true)
  const [scoreThreshold,  setScoreThreshold]  = useState(0.5)
  const [ollamaModel,     setOllamaModel]     = useState('llama3:latest')
  const [embedModel,      setEmbedModel]      = useState('nomic-embed-text')
  const [ragSaving,       setRagSaving]       = useState(false)
  const [ragMsg,          setRagMsg]          = useState('')

  // ── SRD rules index state (Phase 3) ────────────────────────────────────────
  const [srdIndex,      setSrdIndex]      = useState(null)   // { status, chunks, embedded, srdCached }
  const [indexBusy,     setIndexBusy]     = useState(false)
  const [indexProgress, setIndexProgress] = useState('')

  // ── Usage stats state ──────────────────────────────────────────────────────
  const [usageStats,  setUsageStats]  = useState(null)
  const [clearingLog, setClearingLog] = useState(false)

  // ── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    // hasKey and the mode are both refreshed by the detection effect below,
    // which re-runs on every ai:modeChanged broadcast.
    window.electronAPI.server.ngrok.hasToken().then(r => setHasNgrokToken(r.hasToken)).catch(() => {})

    window.electronAPI.rag.getSettings().then(settings => {
      if (settings) {
        if (settings.topK           != null) setTopK(settings.topK)
        if (settings.scoreThreshold != null) setScoreThreshold(settings.scoreThreshold)
        if (settings.ollamaModel)            setOllamaModel(settings.ollamaModel)
        if (settings.embedModel)             setEmbedModel(settings.embedModel)
        if (settings.contextBudget  != null) setContextBudget(clampBudget(settings.contextBudget))
        if (settings.anthropicModel)         setClaudeModel(settings.anthropicModel)
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
      // saveKey re-detects in the main process and broadcasts ai:modeChanged,
      // so the badge and every gated component update without a restart — the
      // gap that made a freshly saved key look like it had done nothing.
      const result = await window.electronAPI.ai.saveKey(keyInput.trim())
      const mode   = result?.mode ?? result
      setHasKey(true)
      setKeyInput('')
      setStatusMsg(mode === 'online'
        ? `✅ Key saved — Claude API connected (${result?.detection?.claude?.model ?? 'model unknown'}).`
        : `⚠ Key saved, but Claude is not usable: ${result?.detection?.claude?.message ?? 'reason unknown'}`)
    } catch (err) {
      setStatusMsg('❌ ' + parseIpcError(err).message)
    }
    setSaving(false)
  }

  async function handleRemove() {
    try {
      const result = await window.electronAPI.ai.deleteKey()
      setHasKey(false); setKeyInput('')
      // deleteKey re-detects too, so removing a key falls back to Ollama
      // immediately rather than sitting on a stale 'online'.
      setStatusMsg(`Key removed. Mode: ${result?.mode ?? 'unknown'}`)
    } catch (err) {
      // Was silent: a failed delete left the key in place while the UI cleared
      // the field, so the next launch looked like the key had come back.
      notifyError(err, 'Remove API key')
    }
  }

  // ── Provider tests (task 10) ─────────────────────────────────────────────
  //
  // Neither goes through ai:complete. That reports the MODE, so a DM whose key
  // was fine but whose mode had landed on no-ai got "No AI service available"
  // and learned nothing about their key.
  async function handleTestClaude() {
    setTesting(true); setClaudeTest(null)
    try {
      setClaudeTest(await window.electronAPI.ai.testClaude())
    } catch (err) {
      // parseIpcError strips Electron's "Error invoking remote method '…':"
      // prefix, the redundant "Error: ", and registerHandler's channel tag.
      // Settings used raw err.message, which is why the prefix leaked (task 11).
      setClaudeTest({ ok: false, message: parseIpcError(err).message })
    }
    setTesting(false)
  }

  async function handleTestOllama() {
    setOllamaTest(null)
    try {
      setOllamaTest(await window.electronAPI.ai.testOllama())
    } catch (err) {
      setOllamaTest({ ok: false, message: parseIpcError(err).message })
    }
  }

  async function handleRedetect() {
    setRedetecting(true); setStatusMsg('')
    try {
      const result = await window.electronAPI.ai.redetect()
      setStatusMsg(`Re-detected. Mode: ${result?.mode ?? 'unknown'}`)
    } catch (err) {
      notifyError(err, 'Re-detect AI')
    }
    setRedetecting(false)
  }

  async function handleOllamaCheck() {
    // Checking Ollama also re-runs detection, so a DM who just started it does
    // not have to restart the app (task 9).
    await handleTestOllama()
    await handleRedetect()
  }

  /** Switch provider (task 9b). A failure keeps the selection and says why. */
  async function handleProvider(next) {
    if (switching || next === provider) return
    setSwitching(true); setStatusMsg('')
    const previous = provider
    setProvider(next)
    try {
      const result = await window.electronAPI.ai.setProvider(next)
      const mode = result?.mode
      if (mode === 'online') {
        notifySuccess(`Switched to Claude API — ${result?.detection?.claude?.model ?? 'model unknown'}`)
      } else if (mode === 'offline-ollama') {
        notifySuccess(`Switched to Ollama — ${result?.detection?.ollama?.chatModel ?? 'llama3'}`)
      } else {
        // Deliberately NOT falling back to the other provider: the choice
        // stands and the reason is shown, so the DM can fix it.
        notifyError(new Error(describeFailure(result?.detection, next)), 'Switch provider')
      }
    } catch (err) {
      setProvider(previous)
      notifyError(err, 'Switch provider')
    }
    setSwitching(false)
  }

  function describeFailure(det, which) {
    const side = which === 'ollama' ? det?.ollama : det?.claude
    return side?.message
      ? `${which === 'ollama' ? 'Ollama' : 'Claude API'} selected but unavailable: ${side.message}`
      : `${which === 'ollama' ? 'Ollama' : 'Claude API'} selected but unavailable.`
  }

  async function handleFetchModels() {
    setFetchingModels(true)
    try {
      const { models } = await window.electronAPI.ai.listModels()
      setModelList(models ?? [])
      if ((models ?? []).length === 0) notifyInfo('The API returned no models for this key.')
    } catch (err) {
      notifyError(err, 'Fetch available models')
      setModelList(null)
    }
    setFetchingModels(false)
  }

  async function handleSaveModel(id) {
    setClaudeModel(id)
    try {
      await window.electronAPI.ai.setModel(id)
      notifySuccess(`Model set to ${id}`)
    } catch (err) {
      notifyError(err, 'Set model')
    }
  }

  // ── RAG settings handlers ──────────────────────────────────────────────────
  async function handleSaveRagSettings() {
    setRagSaving(true); setRagMsg('')
    try {
      await window.electronAPI.rag.saveSettings({
        topK, scoreThreshold, ollamaModel, embedModel,
        contextBudget: clampBudget(contextBudget),
      })
      setRagMsg('✅ Settings saved.')
    } catch (err) {
      setRagMsg('❌ ' + err.message)
    }
    setRagSaving(false)
  }

  // ── SRD rules index handlers ───────────────────────────────────────────────
  const loadSrdIndex = useCallback(async () => {
    try {
      setSrdIndex(await window.electronAPI.srd.getIndexStatus())
    } catch (err) {
      notifyError(err, 'Read SRD index status')
    }
  }, [])

  useEffect(() => { loadSrdIndex() }, [loadSrdIndex])

  // Progress arrives on a main-process channel during both build and embed.
  useEffect(() => {
    const onProgress = ({ percent, message }) => setIndexProgress(`${message} (${percent}%)`)
    window.electronAPI.srd.onIndexProgress(onProgress)
    return () => window.electronAPI.srd.offIndexProgress?.(onProgress)
  }, [])

  async function handleBuildSrdIndex() {
    setIndexBusy(true)
    setIndexProgress('Building index…')
    try {
      const { chunks } = await window.electronAPI.srd.buildIndex()
      notifySuccess(`Indexed ${chunks} SRD entries. Rules Q&A is ready.`)

      // Embedding is a bonus, not a requirement: keyword search over these same
      // chunks already answers single-rule questions. Attempt it, and treat a
      // missing Ollama as information rather than failure.
      setIndexProgress('Embedding for semantic search…')
      try {
        const { embedded } = await window.electronAPI.srd.embedIndex()
        notifySuccess(`Embedded ${embedded} entries for semantic search.`)
      } catch (err) {
        notifyInfo(`Indexed for keyword search. Semantic search unavailable: ${err.message}`)
      }
    } catch (err) {
      notifyError(err, 'Index SRD')
    } finally {
      setIndexBusy(false)
      setIndexProgress('')
      loadSrdIndex()
    }
  }

  async function handleClearSrdIndex() {
    if (!window.confirm('Remove the SRD rules index? Rules Q&A will stop working until you rebuild it.')) return
    setIndexBusy(true)
    try {
      const { cleared } = await window.electronAPI.srd.clearIndex()
      notifySuccess(`Removed ${cleared} indexed SRD entries.`)
    } catch (err) {
      notifyError(err, 'Clear SRD index')
    } finally {
      setIndexBusy(false)
      loadSrdIndex()
    }
  }

  // ── Usage log handlers ─────────────────────────────────────────────────────
  async function handleClearLog() {
    setClearingLog(true)
    await window.electronAPI.ai.clearUsageLog(activeCampaign?.id ?? null)
    await loadUsageStats()
    setClearingLog(false)
  }

  // ── ngrok handlers ────────────────────────────────────────────────────────
  async function handleSaveNgrokToken() {
    if (!ngrokInput.trim()) return
    await window.electronAPI.server.ngrok.saveToken(ngrokInput.trim())
    setHasNgrokToken(true)
    setNgrokInput('')
    setNgrokSaved(true)
    setTimeout(() => setNgrokSaved(false), 3000)
  }

  async function handleRemoveNgrokToken() {
    try {
      await window.electronAPI.server.ngrok.deleteToken()
      setHasNgrokToken(false)
    } catch (err) {
      notifyError(err, 'Remove ngrok token')
    }
  }

  async function handleTestTunnel() {
    setNgrokTesting(true); setNgrokTestMsg('Testing…')
    try {
      await window.electronAPI.server.start()
      const { url } = await window.electronAPI.server.tunnel.open()
      setNgrokTestMsg(`✅ Tunnel works: ${url}`)
      setTimeout(async () => {
        await window.electronAPI.server.tunnel.close()
        setNgrokTestMsg('')
      }, 5000)
    } catch (err) {
      setNgrokTestMsg(`❌ ${err.message}`)
    }
    setNgrokTesting(false)
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

  // Detection is the source of truth for what the UI says; it arrives with
  // every ai:modeChanged broadcast, so no part of this page can go stale.
  useEffect(() => {
    if (detection?.provider) setProvider(detection.provider)
    if (detection?.claude?.model && !claudeModel) setClaudeModel(detection.claude.model)
  }, [detection]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.electronAPI.ai.hasKey()
      .then(r => { setHasKey(r.hasKey); setKeyReadable(r.readable !== false) })
      .catch(() => {})
  }, [liveMode, detection])

  const detectionLines = describeDetectionLines(detection)
  const pullCommand = (detection?.ollama?.missing ?? []).length
    ? detection.ollama.missing.map(m => `ollama pull ${m}`).join(' && ')
    : ''

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <h1 style={s.pageTitle}>Settings</h1>

      {/* ── AI Configuration ─── */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>AI Configuration</h2>

        <p style={s.modeLabel}>
          Current mode: <strong style={s.modeValue}>{liveMode || '…'}</strong>
        </p>

        {/* The app never says no-ai without saying why (task 6). */}
        <div style={s.detectionBox}>
          {detectionLines.map((line, i) => (
            <p key={i} style={line.startsWith('Claude') ? s.detectLine : { ...s.detectLine, marginBottom: 0 }}>
              {line}
            </p>
          ))}
          {pullCommand && (
            <p style={s.detectFix}>Run: <code style={s.code}>{pullCommand}</code></p>
          )}
        </div>

        {/* Provider choice (task 9b) */}
        <label style={s.label}>Provider</label>
        <div style={s.segmented}>
          {[['auto', 'Auto'], ['claude', 'Claude API'], ['ollama', 'Ollama']].map(([value, label]) => (
            <button
              key={value}
              style={provider === value ? { ...s.segment, ...s.segmentActive } : s.segment}
              onClick={() => handleProvider(value)}
              disabled={switching}
            >
              {label}
            </button>
          ))}
          {provider !== 'auto' && liveMode === 'no-ai' && (
            <button style={s.btnSecondary} onClick={() => handleProvider('auto')} disabled={switching}>
              ↺ Switch back to Auto
            </button>
          )}
        </div>
        <span style={s.hint}>
          Auto tries Claude first, then Ollama. Choosing a provider uses only that one and
          will not silently fall back. Embeddings for PDF and lore retrieval always use
          Ollama whichever you pick — the Claude path has no embedding model — so with
          Claude selected and Ollama stopped, chat works and retrieval falls back to
          keyword search.
        </span>

        <label style={{ ...s.label, marginTop: '1rem' }}>Anthropic API Key</label>
        {hasKey ? (
          <>
            <div style={s.row}>
              <input style={s.input} type="password" value="••••••••••••••••" readOnly />
              <button style={s.btnDanger} onClick={handleRemove}>Remove Key</button>
            </div>
            {!keyReadable && (
              // The Phase 6.1 root cause, stated where the DM will see it.
              <p style={s.warn}>
                ⚠ A key is saved but cannot be decrypted on this machine or user account —
                so the app has been running as though no key were set. Remove it and enter
                it again.
              </p>
            )}
          </>
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

        {/* Model id, no longer hard-locked (task 8) */}
        <label style={{ ...s.label, marginTop: '1rem' }}>Claude model</label>
        <div style={s.row}>
          {modelList?.length ? (
            <select
              style={s.input}
              value={claudeModel}
              onChange={e => handleSaveModel(e.target.value)}
            >
              {!modelList.some(m => m.id === claudeModel) && claudeModel && (
                <option value={claudeModel}>{claudeModel} (not in list)</option>
              )}
              {modelList.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          ) : (
            <input
              style={s.input}
              value={claudeModel}
              placeholder={detection?.claude?.model ?? 'claude-sonnet-5'}
              onChange={e => setClaudeModel(e.target.value)}
              onBlur={e => e.target.value.trim() && handleSaveModel(e.target.value.trim())}
            />
          )}
          <button style={s.btnSecondary} onClick={handleFetchModels} disabled={fetchingModels || !hasKey}>
            {fetchingModels ? 'Fetching…' : 'Fetch available models'}
          </button>
        </div>
        <span style={s.hint}>
          Fetched live from your account with GET /v1/models. Until you fetch it, the app
          uses a built-in default that has not been checked against your key.
        </span>

        {/* Provider tests (task 10) */}
        <div style={{ ...s.row, marginTop: '1rem' }}>
          <button style={s.btnSecondary} onClick={handleTestClaude} disabled={testing}>
            {testing ? 'Testing…' : 'Test Claude'}
          </button>
          <button style={s.btnSecondary} onClick={handleTestOllama}>Test Ollama</button>
          <button style={s.btnSecondary} onClick={handleRedetect} disabled={redetecting}>
            {redetecting ? 'Detecting…' : '↻ Re-detect AI'}
          </button>
        </div>

        {claudeTest && (
          <p style={claudeTest.ok ? s.status : s.statusBad}>
            {claudeTest.ok ? '✅' : '❌'} Claude
            {claudeTest.status ? ` — HTTP ${claudeTest.status}` : ''}: {claudeTest.message}
          </p>
        )}
        {ollamaTest && (
          <p style={ollamaTest.ok ? s.status : s.statusBad}>
            {ollamaTest.ok ? '✅' : '❌'} Ollama — {ollamaTest.message}
            {ollamaTest.models?.length ? ` (${ollamaTest.models.join(', ')})` : ''}
          </p>
        )}
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
            value="claude-sonnet-5" readOnly
            title="Locked per project spec — change requires code update" />
          <span style={s.hint}>Locked — defined in AIService.js</span>
        </div>

        <div style={s.fieldGroup}>
          <label style={s.label}>Offline Model (Ollama)</label>
          <input style={s.input} value={ollamaModel}
            onChange={e => setOllamaModel(e.target.value)}
            placeholder="llama3:latest" />
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

        {/* Campaign context budget — Phase 6 task 6.
            The system prompt used to interpolate every character and every
            faction with no cap, so a 60-faction campaign sent 60 names on every
            message. aiContext now fills sections in priority order under this
            many characters. */}
        <div style={s.fieldGroup}>
          <div style={s.sliderHeader}>
            <label style={s.label}>Campaign context budget</label>
            <span style={s.sliderValue}>{contextBudget.toLocaleString()} chars</span>
          </div>
          <input type="range" min={500} max={20000} step={250}
            value={contextBudget} onChange={e => setContextBudget(Number(e.target.value))}
            style={s.slider} />
          <span style={s.hint}>
            How much of your world the AI Assistant is told about on every message
            (roughly {Math.round(contextBudget / 4).toLocaleString()} tokens). Sections are
            filled in priority order — party and current session first, the long tail of
            NPC names last. Default 6,000.
          </span>
        </div>

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

      {/* ── Network Play ─── */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>Network Play</h2>
        <p style={s.body}>
          ngrok lets remote players connect from anywhere over the internet.
          Get a free auth token — no credit card required.
        </p>
        <button
          style={{ ...s.btnSecondary, marginBottom: '1rem' }}
          onClick={() => window.electronAPI.shell.openExternal('https://dashboard.ngrok.com/get-started/your-authtoken')}
        >
          Get your free ngrok token →
        </button>

        <div style={s.fieldGroup}>
          <label style={s.label}>ngrok Auth Token</label>
          {hasNgrokToken ? (
            <div style={s.row}>
              <input style={{ ...s.input, color: '#555', cursor: 'default' }}
                type="password" value="••••••••••••••••" readOnly />
              <button style={s.btnDanger} onClick={handleRemoveNgrokToken}>Remove</button>
            </div>
          ) : (
            <div style={s.row}>
              <input
                style={s.input}
                type="password"
                placeholder="Paste your ngrok auth token…"
                value={ngrokInput}
                onChange={e => setNgrokInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveNgrokToken()}
              />
              <button style={s.btnPrimary} onClick={handleSaveNgrokToken}
                disabled={!ngrokInput.trim()}>
                Save Token
              </button>
            </div>
          )}
          {ngrokSaved && <p style={{ ...s.status, color: '#5dc45d' }}>Token saved securely.</p>}
        </div>

        <div style={s.row}>
          <button style={s.btnSecondary} onClick={handleTestTunnel}
            disabled={!hasNgrokToken || ngrokTesting}>
            {ngrokTesting ? 'Testing…' : 'Test Tunnel'}
          </button>
        </div>
        {ngrokTestMsg && (
          <p style={{ ...s.status, color: ngrokTestMsg.startsWith('✅') ? '#5dc45d' : '#e74c3c' }}>
            {ngrokTestMsg}
          </p>
        )}

        <div style={{ ...s.fieldGroup, marginTop: '1rem' }}>
          <label style={s.label}>Preferred server port</label>
          <input
            style={{ ...s.input, width: 100 }}
            type="number"
            defaultValue={localStorage.getItem('dmcs-preferred-port') ?? '3001'}
            onChange={e => localStorage.setItem('dmcs-preferred-port', e.target.value)}
          />
          <span style={s.hint}>Default 3001 — auto-increments if the port is busy.</span>
        </div>
      </section>

      {/* ── Rules Q&A index (Phase 3) ─── */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>Rules Q&amp;A Index</h2>
        <p style={s.body}>
          Indexes the bundled SRD 5.1 so rules questions work without uploading a
          source book. Keyword search works on its own; Ollama adds semantic search.
        </p>

        {srdIndex && (
          <div style={s.srdStatusRow}>
            <SrdStatusPill status={srdIndex.status} />
            <span style={s.srdCounts}>
              {srdIndex.srdCached} SRD entries cached
              {srdIndex.chunks > 0 && ` · ${srdIndex.chunks} indexed`}
              {srdIndex.embedded > 0 && ` · ${srdIndex.embedded} embedded`}
            </span>
          </div>
        )}

        {srdIndex?.srdCached === 0 && (
          <p style={s.srdWarn}>
            No SRD data cached yet — run <strong>Re-seed SRD</strong> first.
          </p>
        )}

        {indexProgress && <p style={s.srdProgress}>{indexProgress}</p>}

        <div style={s.row}>
          <button
            style={(indexBusy || srdIndex?.srdCached === 0) ? s.btnDisabled : s.btnPrimary}
            onClick={handleBuildSrdIndex}
            disabled={indexBusy || srdIndex?.srdCached === 0}
          >
            {indexBusy
              ? 'Indexing…'
              : srdIndex?.status === 'not-indexed'
                ? 'Index SRD for rules Q&A'
                : 'Rebuild SRD index'}
          </button>
          {srdIndex?.status !== 'not-indexed' && (
            <button style={s.btnDanger} onClick={handleClearSrdIndex} disabled={indexBusy}>
              Remove index
            </button>
          )}
        </div>
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
            <StatCard label="Avg response time"   value={`${usageStats.avgMs} ms`} sub="successful calls only" />
            {/* Failures used to be invisible: a DM with an expired key saw stats
                claiming every call was fine. */}
            <StatCard
              label="Failed calls"
              value={usageStats.failures ?? 0}
              sub={usageStats.failures > 0 ? 'check key / Ollama' : 'none'}
            />
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

// ── SRD index status pill ─────────────────────────────────────────────────────
function SrdStatusPill({ status }) {
  const config = {
    'not-indexed': { label: 'Not indexed', color: '#6b5a3a', bg: '#1a1408' },
    // Chunked-but-not-embedded is a working state, not a warning: keyword search
    // over these chunks is what makes rules Q&A work without Ollama.
    'chunked':     { label: 'Keyword search ready', color: '#c9a84c', bg: '#241a08' },
    'embedded':    { label: 'Semantic search ready', color: '#5ba85b', bg: '#0d1f0d' },
  }[status] ?? { label: status, color: '#6b5a3a', bg: '#1a1408' }

  return (
    <span style={{
      ...s.srdPill, color: config.color, background: config.bg, borderColor: config.color,
    }}>
      {config.label}
    </span>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
/** The two explanatory lines, mirroring electron/services/aiDetection.cjs. */
function describeDetectionLines(detection) {
  const c = detection?.claude
  const o = detection?.ollama

  const claudeLine = !c ? 'Claude: not checked yet'
    : !c.attempted ? `Claude: not checked — ${c.message || 'no key saved'}`
      : c.ok ? `Claude: ready — ${c.model || 'model unknown'}`
        : c.kind === 'key' ? `Claude: rejected — ${c.message}. Re-enter your API key.`
          : c.kind === 'model' ? `Claude: model '${c.model}' not found (HTTP ${c.status ?? 404}) — the key may be fine; pick another model below.`
            : c.kind === 'unreadable-key' ? `Claude: a key is saved but could not be decrypted — ${c.message}`
              : `Claude: ${c.message}`

  const ollamaLine = !o ? 'Ollama: not checked yet'
    : !o.attempted ? `Ollama: not checked — ${o.message || 'not selected'}`
      : o.ok
        ? (o.missing?.length
          ? `Ollama: reachable at ${o.url}, but ${o.missing.join(' and ')} ${o.missing.length === 1 ? 'is' : 'are'} not pulled`
          : `Ollama: ready at ${o.url}`)
        : `Ollama: unreachable — ${o.message} (${o.url})`

  return [claudeLine, ollamaLine]
}

const s = {
  detectionBox: {
    background: '#14100a', border: '1px solid #2a2010', borderRadius: 4,
    padding: '0.6rem 0.8rem', margin: '0 0 1rem',
  },
  detectLine: { color: '#a89060', fontSize: '0.8rem', margin: '0 0 0.3rem', lineHeight: 1.5 },
  detectFix:  { color: '#c9a84c', fontSize: '0.8rem', margin: '0.4rem 0 0' },
  warn: {
    color: '#e0a050', fontSize: '0.82rem', lineHeight: 1.55,
    background: '#2a2010', border: '1px solid #5a4010', borderRadius: 4,
    padding: '0.5rem 0.7rem', margin: '0.5rem 0 0',
  },
  statusBad: { color: '#e08080', fontSize: '0.85rem', margin: '0.5rem 0 0' },
  segmented: { display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' },
  segment: {
    padding: '0.4rem 0.9rem', background: '#1a1408', border: '1px solid #3a2a10',
    borderRadius: 4, color: '#a89060', cursor: 'pointer', fontSize: '0.82rem',
  },
  segmentActive: { background: '#2a2010', borderColor: '#c9a84c', color: '#c9a84c', fontWeight: 'bold' },
  srdStatusRow: { display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' },
  srdPill:      { fontSize: '0.75rem', padding: '3px 10px', borderRadius: 12, border: '1px solid' },
  srdCounts:    { color: '#6b5a3a', fontSize: '0.8rem' },
  srdWarn:      { color: '#c9a84c', fontSize: '0.82rem', margin: '6px 0' },
  srdProgress:  { color: '#a89060', fontSize: '0.82rem', margin: '6px 0', fontStyle: 'italic' },
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
