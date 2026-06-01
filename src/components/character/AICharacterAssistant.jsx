import { useState, useEffect } from 'react'
import useCampaignStore from '../../stores/campaignStore'

const ABILITY_KEYS  = ['str','dex','con','int','wis','cha']
const ABILITY_NAMES = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' }

const SYSTEM_PROMPT = `You are an expert D&D 5e Dungeon Master assistant.
Keep responses concise and immediately usable at the game table.
Format output as a numbered list unless instructed otherwise.`

function highestAbility(stats) {
  const key = ABILITY_KEYS.reduce((best, k) => (stats[k] ?? 10) > (stats[best] ?? 10) ? k : best, 'str')
  return { name: ABILITY_NAMES[key], score: stats[key] ?? 10 }
}

const ACTIONS = [
  { key: 'background',  label: 'Character Background', icon: '📖' },
  { key: 'traits',      label: 'Personality Traits',   icon: '🎭' },
  { key: 'items',       label: 'Magic Item Suggestions', icon: '💎' },
  { key: 'npcs',        label: 'NPC Connections',       icon: '🤝' },
]

function buildPrompt(actionKey, character, worldSetting) {
  const stats     = character._stats ?? {}
  const { name: abilName, score: abilScore } = highestAbility(stats)
  const charName  = character.character_name
  const cls       = character.class   ?? 'Adventurer'
  const race      = character.race    ?? 'Human'
  const level     = character.level   ?? 1
  const world     = worldSetting      ?? 'a generic fantasy world'

  switch (actionKey) {
    case 'background':
      return `Generate a 2-paragraph backstory for a level ${level} ${race} ${cls} named ${charName}. Their highest ability score is ${abilName} (${abilScore}). The campaign is set in ${world}.`
    case 'traits':
      return `Generate exactly 3 personality traits as a numbered list for a level ${level} ${race} ${cls} named ${charName}. Their highest ability is ${abilName} (${abilScore}).`
    case 'items':
      return `Suggest exactly 3 magic items as a numbered list appropriate for a level ${level} ${cls} named ${charName}. Include a brief description of each item's powers and why it fits this character.`
    case 'npcs':
      return `Create exactly 2 NPC connection ideas as a numbered list for ${charName}, a level ${level} ${race} ${cls}. The campaign is set in ${world}. Include each NPC's name, their relationship to the character, and a potential plot hook.`
    default:
      return ''
  }
}

export default function AICharacterAssistant({ character, characterId, onRefresh }) {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const [expanded,   setExpanded]   = useState(false)
  const [aiMode,     setAiMode]     = useState(null)   // null = checking, 'claude'/'ollama'/'offline'
  const [activeKey,  setActiveKey]  = useState(null)
  const [generating, setGenerating] = useState(false)
  const [result,     setResult]     = useState('')
  const [copying,    setCopying]    = useState(false)
  const [toast,      setToast]      = useState('')

  useEffect(() => {
    window.electronAPI.ai.getMode().then(setAiMode).catch(() => setAiMode('offline'))
  }, [])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function generate(actionKey) {
    setActiveKey(actionKey)
    setResult('')
    setGenerating(true)
    try {
      const userMsg = buildPrompt(actionKey, character, activeCampaign?.world_setting)
      const output  = await window.electronAPI.ai.complete(SYSTEM_PROMPT, userMsg)
      setResult(output ?? '')
    } catch (err) {
      setResult(`⚠ Generation failed: ${err?.message ?? 'Unknown error'}`)
    }
    setGenerating(false)
  }

  async function copyToNotes() {
    if (!result) return
    setCopying(true)
    const separator = character.notes ? '\n\n---\n\n' : ''
    const newNotes  = (character.notes ?? '') + separator + result
    try {
      await window.electronAPI.db.characters.update(characterId, {
        player_name:    character.player_name    ?? '',
        character_name: character.character_name,
        class:          character.class,
        race:           character.race,
        level:          character.level,
        stats:          character._stats,
        hp_current:     character.hp_current,
        hp_max:         character.hp_max,
        inventory:      character._inventory,
        spell_slots:    character._slots,
        notes:          newNotes,
      })
      onRefresh()
      showToast('✓ Copied to Notes tab.')
    } catch {
      showToast('Failed to copy to notes.')
    }
    setCopying(false)
  }

  const isAvailable = aiMode === 'claude' || aiMode === 'ollama'

  return (
    <div style={a.root}>
      {toast && <div style={a.toast}>{toast}</div>}

      {/* Toggle bar */}
      <button style={a.toggle} onClick={() => setExpanded(e => !e)}>
        <span style={a.toggleIcon}>🤖</span>
        <span style={a.toggleLabel}>AI Assistant</span>
        {aiMode === null && <span style={a.chip}>…</span>}
        {aiMode && !isAvailable && <span style={{ ...a.chip, background: '#2a1a0a', color: '#8a6a3a', borderColor: '#4a3a1a' }}>Offline</span>}
        {isAvailable && <span style={{ ...a.chip, background: '#0a2a0a', color: '#6ada6a', borderColor: '#1a5a1a' }}>{aiMode}</span>}
        <span style={{ marginLeft: 'auto', color: '#6b5a3a', fontSize: '0.7rem' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div style={a.body}>
          {!isAvailable ? (
            <p style={a.offlineMsg}>
              AI is not available. Configure your API key in Settings to enable generation.
            </p>
          ) : (
            <>
              {/* Action buttons */}
              <div style={a.actionRow}>
                {ACTIONS.map(action => (
                  <button
                    key={action.key}
                    style={{
                      ...a.actionBtn,
                      background: activeKey === action.key ? '#1a2a10' : undefined,
                      borderColor: activeKey === action.key ? '#3a5a1a' : undefined,
                      color:       activeKey === action.key ? '#8ada6a' : undefined,
                    }}
                    onClick={() => generate(action.key)}
                    disabled={generating}
                  >
                    {action.icon} {action.label}
                  </button>
                ))}
              </div>

              {/* Result area */}
              {(generating || result) && (
                <div style={a.resultBox}>
                  {generating ? (
                    <div style={a.spinner}>
                      <span style={a.spinnerDot}>●</span>
                      <span style={a.spinnerDot}>●</span>
                      <span style={a.spinnerDot}>●</span>
                      <span style={a.generatingLabel}>
                        Generating {ACTIONS.find(a => a.key === activeKey)?.label}…
                      </span>
                    </div>
                  ) : (
                    <>
                      <textarea
                        style={a.resultText}
                        value={result}
                        onChange={e => setResult(e.target.value)}
                        rows={6}
                        readOnly={false}
                      />
                      <div style={a.resultActions}>
                        <button style={a.regenBtn}
                          onClick={() => generate(activeKey)} disabled={generating}>
                          ↺ Regenerate
                        </button>
                        <button style={a.copyBtn}
                          onClick={copyToNotes} disabled={copying}>
                          {copying ? 'Copying…' : '📝 Copy to Notes'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const a = {
  root:    { borderTop: '1px solid #2a1c08', flexShrink: 0, position: 'relative' },

  toast:   { position: 'absolute', top: '0.5rem', right: '1rem', background: '#1a3a1a', border: '1px solid #3a6a3a', color: '#8ada8a', fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderRadius: 4, zIndex: 10 },

  toggle:  { width: '100%', background: 'none', border: 'none', borderBottom: '1px solid transparent', color: '#a89060', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 1.5rem', fontSize: '0.82rem', textAlign: 'left' },
  toggleIcon: { fontSize: '0.9rem' },
  toggleLabel:{ color: '#a89060', fontFamily: 'Georgia, serif' },
  chip:    { background: '#1a1208', border: '1px solid #2a1c08', color: '#6b5a3a', fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: 10 },

  body:    { padding: '0.6rem 1.5rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' },

  offlineMsg: { color: '#6b5a3a', fontSize: '0.82rem', fontStyle: 'italic', margin: 0 },

  actionRow:  { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  actionBtn:  { background: '#0d0a05', border: '1px solid #2a1c08', color: '#a89060', borderRadius: 4, padding: '0.3rem 0.65rem', cursor: 'pointer', fontSize: '0.78rem' },

  resultBox:   { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  resultText:  { background: 'transparent', border: 'none', color: '#c8c0b0', fontSize: '0.82rem', lineHeight: 1.55, resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  resultActions:{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' },
  regenBtn:    { background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.25rem 0.55rem', cursor: 'pointer', fontSize: '0.75rem' },
  copyBtn:     { background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8ada6a', borderRadius: 3, padding: '0.25rem 0.65rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 },

  spinner:       { display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0' },
  spinnerDot:    { color: '#c9a84c', fontSize: '0.5rem', animation: 'pulse 1s ease-in-out infinite' },
  generatingLabel:{ color: '#6b5a3a', fontSize: '0.78rem', fontStyle: 'italic', marginLeft: '0.25rem' },
}
