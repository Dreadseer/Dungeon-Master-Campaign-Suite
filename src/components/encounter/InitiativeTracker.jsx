import { useState, useEffect, useRef } from 'react'
import { buildCombatants, rollInitiative, sortByInitiative } from '../../utils/combatUtils'
import { createToken }    from '../../utils/tokenUtils'
import ConditionManager  from './ConditionManager'
import CombatLog         from './CombatLog'
import CombatStatBlock   from './CombatStatBlock'
import SpellCardPanel    from './SpellCardPanel'

// HP bar colour based on percentage remaining
const hpColor = (cur, max) => {
  if (max <= 0 || cur <= 0) return '#444'
  const pct = cur / max
  if (pct > 0.5)  return '#2D7A2D'
  if (pct > 0.25) return '#B8750A'
  return '#C0392B'
}

let _logId = 0
const mkEntry = (type, text, round) => ({ id: ++_logId, type, text, round })

export default function InitiativeTracker({ encounter, characters, campaignId, onEndCombat }) {
  // ── Phase ─────────────────────────────────────────────────────────────────
  const [phase, setPhase]             = useState('setup')
  const [combatants, setCombatants]   = useState([])
  const [roundCount, setRoundCount]   = useState(1)

  // Setup: per-combatant initiative inputs
  const [initInputs, setInitInputs]   = useState({})

  // HP management
  const [hpPanel, setHpPanel]   = useState(null)
  const [hpAmount, setHpAmount] = useState('')
  const [hpMode, setHpMode]     = useState('damage')

  // Condition manager
  const [conditionTarget, setConditionTarget] = useState(null)  // combatant id
  const conditionRefs = useRef({})  // { [id]: DOMNode } for positioning

  // Combat log
  const [logEntries, setLogEntries] = useState([])
  const [showLog, setShowLog]       = useState(false)

  // Stat block + spell card panels
  const [statBlockId, setStatBlockId]   = useState(null)
  const [spellCardId, setSpellCardId]   = useState(null)

  // Concentration alert toast
  const [concAlert, setConcAlert] = useState(null)  // { name, dc }
  const concAlertRef = useRef(null)

  // End combat confirmation
  const [endConfirm, setEndConfirm] = useState(false)

  // Map token population
  const [mapList, setMapList]               = useState([])
  const [selectedMapId, setSelectedMapId]   = useState('')
  const [showMapPicker, setShowMapPicker]   = useState(false)
  const [tokenToast, setTokenToast]         = useState('')
  const toastRef = useRef(null)

  // ── Build combatants on mount ─────────────────────────────────────────────
  useEffect(() => {
    const built = buildCombatants(encounter, characters)
    setCombatants(built)
    const inputs = {}
    built.forEach(c => { inputs[c.id] = '' })
    setInitInputs(inputs)
  }, [encounter, characters])

  // Load maps
  useEffect(() => {
    if (!campaignId) return
    window.electronAPI.db.maps.getAll(campaignId)
      .then(maps => {
        setMapList(maps)
        if (maps.length > 0) setSelectedMapId(String(maps[0].id))
      }).catch(() => {})
  }, [campaignId])

  // ── Log helpers ───────────────────────────────────────────────────────────
  const addLog = (type, text, round = roundCount) => {
    setLogEntries(prev => [...prev, mkEntry(type, text, round)])
  }

  // ── Setup helpers ─────────────────────────────────────────────────────────
  const rollAllMonsters = () => {
    const next = { ...initInputs }
    combatants.forEach(c => {
      if (c.type === 'monster') next[c.id] = String(rollInitiative(c.initiative_mod))
    })
    setInitInputs(next)
  }

  const beginCombat = () => {
    const withInit = combatants.map(c => ({
      ...c,
      initiative: parseInt(initInputs[c.id], 10) || 0,
    }))
    const sorted = sortByInitiative(withInit).map((c, i) => ({ ...c, is_active: i === 0 }))
    setCombatants(sorted)
    setRoundCount(1)
    setPhase('active')
    addLog('start', '⚔️ Combat started — Round 1 begins', 1)
    if (sorted.length > 0) addLog('turn', `▶ ${sorted[0].name}'s turn (Initiative ${sorted[0].initiative})`, 1)
    setShowLog(true)
  }

  // ── Active phase helpers ──────────────────────────────────────────────────
  const orderedCombatants = () => {
    const alive    = combatants.filter(c => c.hp_current > 0)
    const defeated = combatants.filter(c => c.hp_current <= 0)
    return [...alive, ...defeated]
  }

  const handleNextTurn = () => {
    const alive = combatants.filter(c => c.hp_current > 0)
    if (alive.length === 0) return

    const curAliveIdx  = alive.findIndex(c => c.is_active)
    const nextAliveIdx = (curAliveIdx + 1) % alive.length
    const wraps = nextAliveIdx <= curAliveIdx && alive.length > 1

    const nextId = alive[nextAliveIdx].id
    setCombatants(prev => prev.map(c => ({ ...c, is_active: c.id === nextId })))

    const newRound = wraps ? roundCount + 1 : roundCount
    if (wraps) {
      setRoundCount(newRound)
      addLog('round', `═══ Round ${newRound} begins ═══`, newRound)
    }
    addLog('turn', `▶ ${alive[nextAliveIdx].name}'s turn (Initiative ${alive[nextAliveIdx].initiative})`, newRound)

    setHpPanel(null)
    setHpAmount('')
    setConditionTarget(null)
  }

  const applyHP = (id) => {
    const amount = parseInt(hpAmount, 10)
    if (isNaN(amount) || amount <= 0) { setHpPanel(null); return }

    const target = combatants.find(c => c.id === id)
    if (!target) { setHpPanel(null); return }

    const oldHP = target.hp_current
    let newHP

    if (hpMode === 'damage') {
      newHP = Math.max(0, oldHP - amount)
      addLog('damage', `${target.name} takes ${amount} damage — ${oldHP} → ${newHP} HP`)

      // Concentration check alert
      if (target.concentration) {
        const dc = Math.max(10, Math.floor(amount / 2))
        setConcAlert({ name: target.name, dc })
        addLog('concentration', `⚠️ Concentration check required for ${target.name} — DC ${dc}`)
        if (concAlertRef.current) clearTimeout(concAlertRef.current)
        concAlertRef.current = setTimeout(() => setConcAlert(null), 5000)
      }

      if (oldHP > 0 && newHP === 0) {
        if (target.is_player) {
          addLog('unconscious', `💤 ${target.name} is unconscious (0 HP)`)
        } else {
          addLog('defeat', `💀 ${target.name} has been defeated`)
        }
        // Close panels for the defeated combatant
        if (statBlockId === id) setStatBlockId(null)
        if (spellCardId  === id) setSpellCardId(null)
      }
    } else {
      newHP = Math.min(target.hp_max, oldHP + amount)
      addLog('heal', `${target.name} healed ${amount} — ${oldHP} → ${newHP} HP`)
    }

    setCombatants(prev => prev.map(c => c.id === id ? { ...c, hp_current: newHP } : c))
    setHpAmount('')
    setHpPanel(null)
  }

  // ── Condition management ──────────────────────────────────────────────────
  const toggleCondition = (id, condName) => {
    setCombatants(prev => prev.map(c => {
      if (c.id !== id) return c
      const has = c.conditions.includes(condName)
      const next = has
        ? c.conditions.filter(x => x !== condName)
        : [...c.conditions, condName]
      addLog('condition', `${has ? '−' : '+'} ${condName} ${has ? 'removed from' : 'applied to'} ${c.name}`)
      return { ...c, conditions: next }
    }))
  }

  const toggleConcentration = (id) => {
    setCombatants(prev => prev.map(c => {
      if (c.id !== id) return c
      const next = !c.concentration
      addLog('concentration', next ? `🎯 ${c.name} is now concentrating` : `🎯 ${c.name} dropped concentration`)
      return { ...c, concentration: next }
    }))
  }

  const dropConcentration = (id) => {
    setCombatants(prev => prev.map(c =>
      c.id === id ? { ...c, concentration: false } : c
    ))
    addLog('concentration', `🎯 Concentration dropped — ${combatants.find(c => c.id === id)?.name ?? ''}`)
  }

  // ── End combat: sync player HP back to characters table ──────────────────
  const handleEndCombat = async () => {
    addLog('end', `🏁 Combat ended — ${roundCount} round${roundCount !== 1 ? 's' : ''}`)
    setEndConfirm(false)

    // Write final HP for every player combatant back to characters DB
    const playerUpdates = combatants
      .filter(c => c.is_player && c.entity_id)
      .map(c => ({ id: c.entity_id, hp_current: c.hp_current }))
    if (playerUpdates.length > 0) {
      try {
        await window.electronAPI.db.characters.bulkUpdateHP(playerUpdates)
      } catch { /* non-critical — combat still ends */ }
    }

    onEndCombat()
  }

  // ── Map token population ──────────────────────────────────────────────────
  const populateTokens = async () => {
    if (!selectedMapId) return
    try {
      const mapId   = parseInt(selectedMapId, 10)
      const map     = await window.electronAPI.db.maps.getById(mapId)
      const existing = JSON.parse(map.tokens ?? '[]')

      const players  = combatants.filter(c => c.is_player)
      const monsters = combatants.filter(c => !c.is_player)

      const newTokens = [
        ...players.map((c, i)  => createToken(c.name, 'player',  i,     0, 'character', c.entity_id)),
        ...monsters.map((c, i) => createToken(c.name, 'monster', i % 8, 1 + Math.floor(i / 8), null, null)),
      ]

      await window.electronAPI.db.maps.updateTokens(mapId, [...existing, ...newTokens])

      const mapName = mapList.find(m => m.id === mapId)?.name ?? 'map'
      showToast(`${newTokens.length} token${newTokens.length !== 1 ? 's' : ''} added to ${mapName}`)
      setShowMapPicker(false)
    } catch (err) {
      showToast(`Failed: ${err?.message ?? 'unknown error'}`)
    }
  }

  const showToast = (msg) => {
    setTokenToast(msg)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setTokenToast(''), 3000)
  }

  // ── SETUP PHASE ───────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div style={s.panel}>
        <div style={s.header}>
          <span style={s.headerTitle}>⚔ Combat Setup — {encounter.name}</span>
          <span style={s.note}>Enter initiative values below</span>
        </div>

        <div style={s.setupList}>
          {combatants.map(c => (
            <div key={c.id} style={s.setupRow}>
              <span style={s.typeIcon}>{c.is_player ? '🧙' : '💀'}</span>
              <span style={s.setupName}>{c.name}</span>
              <span style={s.setupMod}>
                {c.initiative_mod >= 0 ? '+' : ''}{c.initiative_mod} DEX
              </span>
              <input
                type="number"
                style={s.initInput}
                placeholder="Init"
                value={initInputs[c.id] ?? ''}
                onChange={e => setInitInputs(prev => ({ ...prev, [c.id]: e.target.value }))}
              />
            </div>
          ))}
          {combatants.length === 0 && (
            <p style={s.emptyMsg}>No combatants — add monsters to the roster first.</p>
          )}
        </div>

        <div style={s.setupFooter}>
          <button style={s.rollBtn} onClick={rollAllMonsters} disabled={combatants.length === 0}>
            🎲 Roll All Monsters
          </button>
          <button style={s.beginBtn} onClick={beginCombat} disabled={combatants.length === 0}>
            ▶ Begin Combat
          </button>
        </div>
      </div>
    )
  }

  // ── ACTIVE PHASE ──────────────────────────────────────────────────────────
  const displayed = orderedCombatants()
  const statBlockCombatant = combatants.find(c => c.id === statBlockId) ?? null
  const spellCardCombatant = combatants.find(c => c.id === spellCardId) ?? null
  const condTargetCombatant = conditionTarget ? combatants.find(c => c.id === conditionTarget) : null

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.roundBadge}>Round {roundCount}</span>
        <span style={s.headerTitle}>{encounter.name}</span>
        <button style={s.nextBtn} onClick={handleNextTurn}>Next Turn ▶</button>
        <button
          style={{ ...s.logToggle, ...(showLog ? s.logToggleActive : {}) }}
          onClick={() => setShowLog(p => !p)}
          title="Toggle combat log"
        >
          📜 Log
        </button>
      </div>

      <p style={s.saveNote}>⚠ Combat state is not saved. Closing the app will reset initiative.</p>

      {/* Concentration alert */}
      {concAlert && (
        <div style={s.concAlert}>
          ⚠️ <strong>Concentration check required!</strong> {concAlert.name} — DC {concAlert.dc} CON save
          <button style={s.concAlertClose} onClick={() => setConcAlert(null)}>✕</button>
        </div>
      )}

      {/* Main area: tracker list + optional log */}
      <div style={s.mainArea}>
        {/* Combatant list */}
        <div style={{ ...s.trackerList, position: 'relative' }}>
          {displayed.map(c => {
            const isActive   = c.is_active
            const isDefeated = c.hp_current <= 0
            const hpPct      = c.hp_max > 0 ? c.hp_current / c.hp_max : 0
            const hpBarColor = hpColor(c.hp_current, c.hp_max)
            const isHpOpen   = hpPanel === c.id

            return (
              <div key={c.id} style={{
                ...s.combatantRow,
                ...(isActive   ? s.combatantActive   : {}),
                ...(isDefeated ? s.combatantDefeated  : {}),
              }}>
                <div style={s.combatantMain}>
                  <span style={s.turnArrow}>{isActive ? '▶' : ' '}</span>
                  <span style={s.typeIcon}>{c.is_player ? '🧙' : '💀'}</span>
                  <span style={s.initVal}>{c.initiative}</span>

                  {/* Name — click opens stat block */}
                  <span
                    style={{ ...s.combatName, ...(isDefeated ? s.fadedText : {}) }}
                    onClick={() => setStatBlockId(prev => prev === c.id ? null : c.id)}
                    title="Click for stat block"
                  >
                    {c.name}
                  </span>

                  {/* HP bar — click opens HP panel */}
                  <div
                    style={s.hpBarWrap}
                    onClick={() => !isDefeated && setHpPanel(isHpOpen ? null : c.id)}
                  >
                    <div style={{ ...s.hpBarFill, width: `${Math.round(hpPct * 100)}%`, background: hpBarColor }} />
                    <span style={s.hpBarText}>{c.hp_current}/{c.hp_max}</span>
                  </div>

                  {/* AC */}
                  <span style={s.acBadge}>🛡 {c.ac}</span>

                  {/* Condition pills — click opens condition manager */}
                  <div
                    ref={el => { conditionRefs.current[c.id] = el }}
                    style={s.condArea}
                    onClick={() => !isDefeated && setConditionTarget(prev => prev === c.id ? null : c.id)}
                    title="Click to manage conditions"
                  >
                    {c.conditions?.length > 0
                      ? c.conditions.map(cond => (
                        <span key={cond} style={s.condPill}>{cond}</span>
                      ))
                      : <span style={s.condHint}>+ Cond</span>
                    }
                  </div>

                  {/* Concentration — click opens spell card */}
                  {c.concentration && (
                    <span
                      style={s.concentrationIcon}
                      title="Concentrating — click for details"
                      onClick={() => setSpellCardId(prev => prev === c.id ? null : c.id)}
                    >
                      🎯
                    </span>
                  )}

                  {/* Status badges */}
                  {isDefeated && (
                    <span style={c.is_player ? s.unconsciousBadge : s.defeatedBadge}>
                      {c.is_player ? '💤 Unconscious' : '💀 Defeated'}
                    </span>
                  )}
                </div>

                {/* Inline HP panel */}
                {isHpOpen && !isDefeated && (
                  <div style={s.hpPanelRow}>
                    <div style={s.hpModeGroup}>
                      <button
                        style={{ ...s.hpModeBtn, ...(hpMode === 'damage' ? s.hpModeBtnActive : {}) }}
                        onClick={() => setHpMode('damage')}
                      >
                        − Damage
                      </button>
                      <button
                        style={{ ...s.hpModeBtn, ...(hpMode === 'heal' ? s.hpModeBtnHealActive : {}) }}
                        onClick={() => setHpMode('heal')}
                      >
                        + Heal
                      </button>
                    </div>
                    <input
                      autoFocus
                      type="number" min={1}
                      style={s.hpInput}
                      placeholder="Amount"
                      value={hpAmount}
                      onChange={e => setHpAmount(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') applyHP(c.id); if (e.key === 'Escape') setHpPanel(null) }}
                    />
                    <button style={s.hpApplyBtn} onClick={() => applyHP(c.id)}>Apply</button>
                    <button style={s.hpCancelBtn} onClick={() => setHpPanel(null)}>✕</button>
                  </div>
                )}
              </div>
            )
          })}

          {/* Condition Manager popover */}
          {condTargetCombatant && (
            <div style={s.condPopoverWrap}>
              <ConditionManager
                combatant={condTargetCombatant}
                onToggleCondition={toggleCondition}
                onToggleConcentration={toggleConcentration}
                onClose={() => setConditionTarget(null)}
              />
            </div>
          )}

          {/* Stat block slide-in */}
          {statBlockCombatant && (
            <CombatStatBlock
              combatant={statBlockCombatant}
              onClose={() => setStatBlockId(null)}
            />
          )}

          {/* Spell card slide-in */}
          {spellCardCombatant && (
            <SpellCardPanel
              combatant={spellCardCombatant}
              onDropConcentration={dropConcentration}
              onClose={() => setSpellCardId(null)}
            />
          )}
        </div>

        {/* Combat log panel */}
        {showLog && (
          <CombatLog
            entries={logEntries}
            onClear={() => setLogEntries([])}
          />
        )}
      </div>

      {/* Footer */}
      <div style={s.footer}>
        <div style={s.mapSection}>
          {mapList.length > 0 && (
            <>
              <button style={s.mapBtn} onClick={() => setShowMapPicker(p => !p)}>
                🗺 Map Tokens
              </button>
              {showMapPicker && (
                <div style={s.mapPicker}>
                  <select
                    style={s.mapSelect}
                    value={selectedMapId}
                    onChange={e => setSelectedMapId(e.target.value)}
                  >
                    {mapList.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <button style={s.mapConfirmBtn} onClick={populateTokens}>Add Tokens</button>
                </div>
              )}
            </>
          )}
          {tokenToast && <span style={s.toast}>{tokenToast}</span>}
        </div>

        {endConfirm ? (
          <div style={s.endConfirmRow}>
            <span style={s.endConfirmText}>End combat?</span>
            <button style={s.endYesBtn} onClick={handleEndCombat}>
              End Combat
            </button>
            <button style={s.endNoBtn} onClick={() => setEndConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button style={s.endBtn} onClick={() => setEndConfirm(true)}>🏁 End Combat</button>
        )}
      </div>
    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = {
  panel: {
    display: 'flex', flexDirection: 'column',
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    overflow: 'hidden', height: '100%',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', background: '#222', borderBottom: '1px solid #333', flexShrink: 0,
  },
  headerTitle: { color: '#e0d5c0', fontSize: 14, fontWeight: 600, flex: 1 },
  note:        { color: '#666', fontSize: 12 },
  saveNote: {
    color: '#555', fontSize: 11, fontStyle: 'italic',
    margin: 0, padding: '4px 14px', background: '#111',
    borderBottom: '1px solid #222', flexShrink: 0,
  },
  roundBadge: {
    background: '#3a2a10', color: '#c9a84c', fontWeight: 700,
    fontSize: 13, padding: '3px 10px', borderRadius: 12, flexShrink: 0,
  },
  nextBtn: {
    padding: '5px 14px', background: '#2a3a5a', color: '#7ab0ff',
    border: '1px solid #3a5a8a', borderRadius: 4, cursor: 'pointer', fontSize: 12, flexShrink: 0,
  },
  logToggle: {
    padding: '4px 10px', background: '#222', border: '1px solid #444',
    color: '#666', cursor: 'pointer', fontSize: 11, borderRadius: 4, flexShrink: 0,
  },
  logToggleActive: { background: '#1a2a1a', border: '1px solid #2D7A2D', color: '#7fc272' },

  // Concentration alert
  concAlert: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 14px', background: '#3a1a00', borderBottom: '1px solid #6a3a00',
    color: '#e08030', fontSize: 12, flexShrink: 0,
  },
  concAlertClose: {
    background: 'none', border: 'none', color: '#8a4a00',
    cursor: 'pointer', fontSize: 14, marginLeft: 'auto', padding: '0 4px',
  },

  // Layout
  mainArea: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
  trackerList: { flex: 1, overflowY: 'auto' },

  // Setup
  setupList: { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', padding: '4px 0' },
  setupRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid #222' },
  setupName: { color: '#e0d5c0', fontSize: 14, flex: 1 },
  setupMod:  { color: '#888', fontSize: 12, minWidth: 52, textAlign: 'right' },
  initInput: {
    width: 60, background: '#111', border: '1px solid #555',
    borderRadius: 4, color: '#e0d5c0', padding: '4px 8px',
    fontSize: 14, outline: 'none', textAlign: 'center',
  },
  emptyMsg: { color: '#555', fontSize: 13, textAlign: 'center', padding: '24px', margin: 0 },
  setupFooter: {
    display: 'flex', gap: 8, padding: '10px 14px',
    borderTop: '1px solid #333', background: '#1e1e1e', flexShrink: 0,
  },
  rollBtn: {
    padding: '7px 16px', background: '#2a2a2a', color: '#aaa',
    border: '1px solid #444', borderRadius: 5, cursor: 'pointer', fontSize: 13,
  },
  beginBtn: {
    padding: '7px 20px', background: '#2d5a27', color: '#7fc272',
    border: '1px solid #3d7a37', borderRadius: 5, cursor: 'pointer', fontSize: 13, marginLeft: 'auto',
  },

  // Combatant rows
  combatantRow:     { borderBottom: '1px solid #222' },
  combatantMain:    { display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', flexWrap: 'nowrap' },
  combatantActive:  { background: '#1e2a14', borderLeft: '3px solid #c9a84c' },
  combatantDefeated:{ opacity: 0.45 },
  turnArrow:   { color: '#c9a84c', fontSize: 14, width: 14, flexShrink: 0, userSelect: 'none' },
  typeIcon:    { fontSize: 14, flexShrink: 0 },
  initVal:     { color: '#c9a84c', fontSize: 13, fontWeight: 700, minWidth: 22, textAlign: 'center' },
  combatName:  {
    color: '#e0d5c0', fontSize: 13, flex: '0 0 auto', maxWidth: 120,
    cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  fadedText: { color: '#555' },
  hpBarWrap: {
    position: 'relative', height: 18, minWidth: 70, maxWidth: 100,
    background: '#111', borderRadius: 3, overflow: 'hidden',
    cursor: 'pointer', border: '1px solid #333', flexShrink: 0,
  },
  hpBarFill: { position: 'absolute', left: 0, top: 0, bottom: 0, transition: 'width 0.2s, background 0.2s' },
  hpBarText: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 600, userSelect: 'none',
  },
  acBadge: { color: '#888', fontSize: 11, flexShrink: 0, minWidth: 38 },

  // Conditions area
  condArea: {
    display: 'flex', gap: 3, flexWrap: 'wrap', flex: 1,
    cursor: 'pointer', minHeight: 20, alignItems: 'center',
  },
  condPill: {
    fontSize: 10, background: '#2a2a3a', color: '#aaa',
    border: '1px solid #444', borderRadius: 8, padding: '1px 5px',
  },
  condHint: { color: '#333', fontSize: 10, fontStyle: 'italic' },
  condPopoverWrap: {
    position: 'absolute', left: 10, bottom: 0, zIndex: 50,
  },
  concentrationIcon: { fontSize: 13, cursor: 'pointer', flexShrink: 0 },
  defeatedBadge: {
    fontSize: 10, color: '#e05050', background: '#2a1010',
    border: '1px solid #5a2020', borderRadius: 8, padding: '1px 6px', flexShrink: 0,
  },
  unconsciousBadge: {
    fontSize: 10, color: '#c9a84c', background: '#2a2010',
    border: '1px solid #5a4010', borderRadius: 8, padding: '1px 6px', flexShrink: 0,
  },

  // HP panel
  hpPanelRow: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 14px 8px 50px', background: '#111', borderTop: '1px solid #222',
  },
  hpModeGroup: { display: 'flex' },
  hpModeBtn: {
    padding: '4px 10px', background: '#222', border: '1px solid #444',
    color: '#666', cursor: 'pointer', fontSize: 12,
  },
  hpModeBtnActive:     { background: '#3a1010', border: '1px solid #8B0000', color: '#e05050' },
  hpModeBtnHealActive: { background: '#1a3a1a', border: '1px solid #2D7A2D', color: '#7fc272' },
  hpInput: {
    width: 70, background: '#111', border: '1px solid #555',
    borderRadius: 4, color: '#e0d5c0', padding: '4px 8px',
    fontSize: 13, outline: 'none', textAlign: 'center',
  },
  hpApplyBtn: {
    padding: '4px 14px', background: '#2a3a5a', color: '#7ab0ff',
    border: '1px solid #3a5a8a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  hpCancelBtn: {
    background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 6px',
  },

  // Footer
  footer: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    padding: '8px 14px', borderTop: '1px solid #333', background: '#1e1e1e', flexShrink: 0,
  },
  mapSection: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' },
  mapBtn: {
    padding: '5px 10px', background: '#1a2a3a', color: '#6a9abf',
    border: '1px solid #2a4a6a', borderRadius: 4, cursor: 'pointer', fontSize: 11,
  },
  mapPicker:    { display: 'flex', gap: 6, alignItems: 'center' },
  mapSelect: {
    background: '#111', border: '1px solid #444', borderRadius: 4,
    color: '#e0d5c0', padding: '4px 8px', fontSize: 12, outline: 'none',
  },
  mapConfirmBtn: {
    padding: '4px 10px', background: '#2d5a27', color: '#7fc272',
    border: '1px solid #3d7a37', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  toast: { color: '#7fc272', fontSize: 11, fontStyle: 'italic' },
  endConfirmRow:  { display: 'flex', alignItems: 'center', gap: 8 },
  endConfirmText: { color: '#aaa', fontSize: 12 },
  endYesBtn: {
    padding: '5px 12px', background: '#5a1a1a', color: '#e05050',
    border: '1px solid #8a2a2a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  endNoBtn: {
    padding: '5px 10px', background: '#2a2a2a', color: '#888',
    border: '1px solid #444', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  endBtn: {
    padding: '5px 12px', background: '#2a2a2a', color: '#c9a84c',
    border: '1px solid #5a4010', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginLeft: 'auto',
  },
}
