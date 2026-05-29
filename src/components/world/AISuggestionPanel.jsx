import { useState } from 'react'

export default function AISuggestionPanel({ activeCampaign, factions, locations, npcs }) {
  const [open, setOpen]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [aiMode, setAiMode]     = useState(null)

  async function handleExpand() {
    if (!open) {
      setOpen(true)
      if (aiMode === null) {
        const mode = await window.electronAPI.ai.getMode()
        setAiMode(mode)
      }
    } else {
      setOpen(false)
    }
  }

  async function generate() {
    setLoading(true)
    setSuggestions(null)
    const systemPrompt = `You are an expert Dungeon Master assistant.
The DM will give you a summary of their campaign world.
Suggest 3 specific, actionable world-building ideas.
Each suggestion should be one or two sentences.
Format your response as a numbered list: 1. ... 2. ... 3. ...`

    const userMessage = `My campaign "${activeCampaign.name}" is set in ${activeCampaign.world_setting || 'an unnamed world'}.
It has ${factions.length} factions, ${locations.length} locations, and ${npcs.length} NPCs.
Recent additions: ${npcs.slice(0, 3).map(n => n.name).join(', ') || 'none yet'}.
Give me 3 world-building suggestions to develop this world further.`

    try {
      const result = await window.electronAPI.ai.complete(systemPrompt, userMessage)
      setSuggestions(result)
    } catch (err) {
      setSuggestions(`Error: ${err.message}`)
    }
    setLoading(false)
  }

  const parsedSuggestions = suggestions
    ? suggestions.split(/\n/).filter(l => l.trim())
    : []

  return (
    <div style={s.panel}>
      <button style={s.toggle} onClick={handleExpand}>
        {open ? '▾' : '▸'} ✨ AI World Suggestions
      </button>

      {open && (
        <div style={s.body}>
          {aiMode === 'no-ai' ? (
            <p style={s.noAi}>Configure your API key in Settings to enable AI suggestions.</p>
          ) : (
            <>
              {!suggestions && !loading && (
                <button style={s.btnGenerate} onClick={generate}>Generate Suggestions</button>
              )}
              {loading && (
                <div style={s.spinner}>
                  <span style={s.spinnerDot}>◆</span> Consulting the oracle…
                </div>
              )}
              {suggestions && !loading && (
                <>
                  <div style={s.results}>
                    {parsedSuggestions.map((line, i) => (
                      <p key={i} style={s.suggestion}>{line}</p>
                    ))}
                  </div>
                  <button style={s.btnRegen} onClick={generate}>↺ Regenerate</button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const s = {
  panel:      { border: '1px solid #3a2a10', borderRadius: 6, overflow: 'hidden', marginTop: '2rem' },
  toggle:     { display: 'block', width: '100%', background: '#1a1208', border: 'none', color: '#c9a84c', padding: '0.75rem 1rem', textAlign: 'left', cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'Georgia, serif' },
  body:       { background: '#100d08', padding: '1rem' },
  noAi:       { color: '#6b5a3a', fontSize: '0.88rem' },
  btnGenerate:{ background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.25rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnRegen:   { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.4rem 1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem', marginTop: '0.75rem' },
  spinner:    { color: '#a89060', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.5rem' },
  spinnerDot: { animation: 'pulse 1.2s ease-in-out infinite', color: '#c9a84c' },
  results:    { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  suggestion: { color: '#e8e0d0', fontSize: '0.9rem', lineHeight: 1.6, margin: 0, padding: '0.6rem 0.8rem', background: '#1a1208', borderRadius: 4, borderLeft: '3px solid #c9a84c' },
}
