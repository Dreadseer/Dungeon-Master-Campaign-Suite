import { useState, useEffect } from 'react'

export default function Settings() {
  const [keyInput, setKeyInput]     = useState('')
  const [hasKey, setHasKey]         = useState(false)
  const [aiMode, setAiMode]         = useState('')
  const [statusMsg, setStatusMsg]   = useState('')
  const [testing, setTesting]       = useState(false)
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    window.electronAPI.ai.hasKey().then(({ hasKey: h }) => setHasKey(h))
    window.electronAPI.ai.getMode().then(({ mode }) => setAiMode(mode))
  }, [])

  async function handleSave() {
    if (!keyInput.trim()) return
    setSaving(true)
    setStatusMsg('')
    try {
      const { mode } = await window.electronAPI.ai.saveKey(keyInput.trim())
      setAiMode(mode)
      setHasKey(true)
      setKeyInput('')
      setStatusMsg(mode === 'online' ? '✅ Key saved — Claude API connected.' : '⚠ Key saved but connection failed. Check your key.')
    } catch (err) {
      setStatusMsg('❌ Error: ' + err.message)
    }
    setSaving(false)
  }

  async function handleRemove() {
    await window.electronAPI.ai.deleteKey()
    setHasKey(false)
    setKeyInput('')
    const { mode } = await window.electronAPI.ai.getMode()
    setAiMode(mode)
    setStatusMsg('Key removed.')
  }

  async function handleTest() {
    setTesting(true)
    setStatusMsg('')
    try {
      const reply = await window.electronAPI.ai.complete(
        'You are a helpful assistant.',
        'Reply with only the word CONNECTED.'
      )
      setStatusMsg('✅ Connection test: ' + reply.trim())
    } catch (err) {
      setStatusMsg('❌ Test failed: ' + err.message)
    }
    setTesting(false)
  }

  async function handleOllamaCheck() {
    setStatusMsg('')
    const { mode } = await window.electronAPI.ai.initialize()
    setAiMode(mode)
    setStatusMsg('Ollama check complete. Mode: ' + mode)
  }

  return (
    <div style={s.page}>
      <h1 style={s.pageTitle}>Settings</h1>

      {/* AI Configuration */}
      <section style={s.section}>
        <h2 style={s.sectionTitle}>AI Configuration</h2>
        <p style={s.modeLabel}>
          Current mode: <strong style={s.modeValue}>{aiMode || '…'}</strong>
        </p>

        <label style={s.label}>Anthropic API Key</label>
        {hasKey ? (
          <div style={s.row}>
            <input style={s.input} type="password" value="••••••••••••••••" readOnly />
            <button style={s.btnDanger} onClick={handleRemove}>Remove Key</button>
          </div>
        ) : (
          <div style={s.row}>
            <input
              style={s.input}
              type="password"
              placeholder="sk-ant-..."
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
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

      {/* Ollama Configuration */}
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
    </div>
  )
}

const s = {
  page:         { padding: '2rem', maxWidth: 640 },
  pageTitle:    { color: '#c9a84c', fontSize: '1.8rem', marginBottom: '2rem' },
  section:      { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 8, padding: '1.5rem', marginBottom: '1.5rem' },
  sectionTitle: { color: '#c9a84c', fontSize: '1.1rem', marginBottom: '1rem' },
  modeLabel:    { color: '#a89060', fontSize: '0.9rem', marginBottom: '1rem' },
  modeValue:    { color: '#e8e0d0' },
  label:        { display: 'block', color: '#a89060', fontSize: '0.85rem', marginBottom: '0.4rem' },
  row:          { display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', alignItems: 'center' },
  input:        { flex: 1, background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.5rem 0.75rem', fontSize: '0.9rem', outline: 'none' },
  btnPrimary:   { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', whiteSpace: 'nowrap' },
  btnSecondary: { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnDanger:    { background: 'transparent', color: '#e05050', border: '1px solid #e05050', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem', whiteSpace: 'nowrap' },
  status:       { color: '#a89060', fontSize: '0.85rem', marginTop: '0.5rem' },
  body:         { color: '#a89060', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1rem' },
  code:         { background: '#0d0a05', color: '#c9a84c', padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.85rem' },
}
