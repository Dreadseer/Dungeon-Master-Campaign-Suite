import { useState, useEffect, useRef } from 'react'
import { buildCombatants, rollInitiative, sortByInitiative, nextTurn } from '../../utils/combatUtils'
import { createToken } from '../../utils/tokenUtils'

// HP bar colour based on percentage remaining
const hpColor = (cur, max) => {
  if (max <= 0 || cur <= 0) return '#444'
  const pct = cur / max
  if (pct > 0.5)  return '#2D7A2D'
  if (pct > 0.25) return '#B8750A'
  return '#C0392B'
}

export default function InitiativeTracker({ encounter, characters, campaignId, onEndCombat }) {
  // ── Phase: 'setup' | 'active' ─────────────────────────────────────────────
  const [phase, setPhase]           = useState('setup')
  const [combatants, setCombatants] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [roundCount, setRoundCount]   = useState(1)

  // Setup: per-combatant initiative inputs { [id]: string }
  const [initInputs, setInitInputs] = useState({})

  // HP management: which combatant's panel is open
  const [hpPanel, setHpPanel]   = useState(null)   // combatant id
  const [hpAmount, setHpAmount] = useState('')
  const [hpMode, setHpMode]     = useState('damage')  // 'damage' | 'heal'

  // End combat confirmation
  const [endConfirm, setEndConfirm] = useState(false)

  // Map token population
  const [mapList, setMapList]           = useState([])
  const [selectedMapId, setSelectedMapId] = useState('')
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [tokenToast, setTokenToast]       = useState('')
  const toastRef = useRef(null)

  // ── Build combatants on mount ─────────────────────────────────────────────
  useEffect(() => {
    const built = buildCombatants(encounter, characters)
    setCombatants(built)
    // Pre-fill initiative inputs with empty string
    const inputs = {}
    built.forEach(c => { inputs[c.id] = '' })
    setInitInputs(inputs)
  }, [encounter, characters])

  // Load campaign maps for token population
  useEffect(() => {
    if (!campaignId) return
    window.electronAPI.db.maps.getAll(campaignId)
      .then(maps => {
        setMapList(maps)
        if (maps.length > 0) setSelectedMapId(String(maps[0].id))
      })
      .catch(() => {})
  }, [campaignId])

  // ── Setup phase helpers ───────────────────────────────────────────────────
  const rollAllMonsters = () => {
    const next = { ...initInputs }
    combatants.forEach(c => {
      if (c.type === 'monster') next[c.id] = String(rollInitiative(c.initiative_mod))
    })
    setInitInputs(next)
  }

  const beginCombat = () => {
    // Apply initiative values to combatants
    const withInit = combatants.map(c => ({
      ...c,
      initiative: parseInt(initInputs[c.id], 10) || 0,
    }))
    const sorted = sortByInitiative(withInit).map((c, i) => ({ ...c, is_active: i === 0 }))
    setCombatants(sorted)
    setActiveIndex(0)
    setRoundCount(1)
    setPhase('active')
  }

  // ── Active phase helpers ──────────────────────────────────────────────────

  // Display order: active/alive first (their initiative order), defeated last
  const orderedCombatants = () => {
    const alive    = combatants.filter(c => c.hp_current > 0)
    const defeated = combatants.filter(c => c.hp_current <= 0)
    return [...alive, ...defeated]
  }

  const handleNextTurn = () => {
    // Find current active index in alive list
    const alive = combatants.filter(c => c.hp_current > 0)
    if (alive.length === 0) return

    const curAliveIdx = alive.findIndex(c => c.is_active)
    const nextAliveIdx = (curAliveIdx + 1) % alive.length
    const wraps = nextAliveIdx < curAliveIdx || (curAliveIdx === -1 && nextAliveIdx === 0) || alive.length === 1

    // Update is_active across full list
    const nextId = alive[nextAliveIdx].id
    setCombatants(prev => prev.map(c => ({ ...c, is_active: c.id === nextId })))

    if (wraps && alive.length > 1) {
      setRoundCount(r => r + 1)
    } else if (alive.length === 1) {
      setRoundCount(r => r + 1)
    }

    setHpPanel(null)
    setHpAmount('')
  }

  const applyHP = (id) => {
    const amount = parseInt(hpAmount, 10)
    if (isNaN(amount) || amount <= 0) { setHpPanel(null); return }
    setCombatants(prev => prev.map(c => {
      if (c.id !== id) return c
      if (hpMode === 'damage') return { ...c, hp_current: Math.max(0, c.hp_current - amount) }
      return { ...c, hp_current: Math.min(c.hp_max, c.hp_current + amount) }
    }))
    setHpAmount('')
    setHpPanel(null)
  }

  // ── Map token population ──────────────────────────────────────────────────
  const populateTokens = async () => {
    if (!selectedMapId) return
    try {
      const mapId = parseInt(selectedMapId, 10)
      const map   = await window.electronAPI.db.maps.getById(mapId)
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

  // ── SETUP PHASE RENDER ────────────────────────────────────────────────────
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
        </div>

        {combatants.length === 0 && (
          <p style={s.emptyMsg}>No combatants — add monsters to the roster first.</p>
        )}

        <div style={s.setupFooter}>
          <button style={s.rollBtn} onClick={rollAllMonsters} disabled={combatants.length === 0}>
            🎲 Roll All Monsters
          </button>
          <button
            style={s.beginBtn}
            onClick={beginCombat}
            disabled={combatants.length === 0}
          >
            ▶ Begin Combat
          </button>
        </div>
      </div>
    )
  }

  // ── ACTIVE PHASE RENDER ───────────────────────────────────────────────────
  const displayed = orderedCombatants()

  return (
    <div style={s.panel}>
      {/* Combat header */}
      <div style={s.header}>
        <span style={s.roundBadge}>Round {roundCount}</span>
        <span style={s.headerTitle}>{encounter.name}</span>
        <button style={s.nextBtn} onClick={handleNextTurn}>Next Turn ▶</button>
      </div>

      <p style={s.saveNote}>⚠ Combat state is not saved. Closing the app will reset initiative.</p>

      {/* Combatant list */}
      <div style={s.trackerList}>
        {displayed.map(c => {
          const isActive   = c.is_active
          const isDefeated = c.hp_current <= 0
          const hpPct      = c.hp_max > 0 ? c.hp_current / c.hp_max : 0
          const hpBarColor = hpColor(c.hp_current, c.hp_max)
          const isOpen     = hpPanel === c.id

          return (
            <div key={c.id} style={{
              ...s.combatantRow,
              ...(isActive ? s.combatantActive : {}),
              ...(isDefeated ? s.combatantDefeated : {}),
            }}>
              <div style={s.combatantMain}>
                {/* Turn indicator */}
                <span style={s.turnArrow}>{isActive ? '▶' : ' '}</span>

                {/* Type icon */}
                <span style={s.typeIcon}>{c.is_player ? '🧙' : '💀'}</span>

                {/* Initiative */}
                <span style={s.initVal}>{c.initiative}</span>

                {/* Name */}
                <span
                  style={{ ...s.combatName, ...(isDefeated ? s.fadedText : {}) }}
                  onClick={() => !isDefeated && setHpPanel(isOpen ? null : c.id)}
                >
                  {c.name}
                </span>

                {/* HP bar */}
                <div style={s.hpBarWrap} onClick={() => !isDefeated && setHpPanel(isOpen ? null : c.id)}>
                  <div style={{ ...s.hpBarFill, width: `${Math.round(hpPct * 100)}%`, background: hpBarColor }} />
                  <span style={s.hpBarText}>{c.hp_current}/{c.hp_max}</span>
                </div>

                {/* AC */}
                <span style={s.acBadge}>🛡 {c.ac}</span>

                {/* Status badges */}
                {isDefeated && (
                  <span style={c.is_player ? s.unconsciousBadge : s.defeatedBadge}>
                    {c.is_player ? '💤 Unconscious' : '💀 Defeated'}
                  </span>
                )}

                {/* Conditions placeholder (populated in Prompt 04) */}
                {c.conditions?.length > 0 && (
                  <div style={s.conditionPills}>
                    {c.conditions.map(cond => (
                      <span key={cond} style={s.condPill}>{cond}</span>
                    ))}
                  </div>
                )}

                {/* Concentration indicator (Prompt 04) */}
                {c.concentration && <span style={s.concentrationIcon} title="Concentrating">🎯</span>}
              </div>

              {/* Inline HP panel */}
              {isOpen && !isDefeated && (
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
                    type="number"
                    min={1}
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
      </div>

      {/* Bottom controls */}
      <div style={s.footer}>
        {/* Populate Map Tokens */}
        <div style={s.mapSection}>
          {mapList.length > 0 && (
            <>
              <button
                style={s.mapBtn}
                onClick={() => setShowMapPicker(p => !p)}
              >
                🗺 Populate Map Tokens
              </button>
              {showMapPicker && (
                <div style={s.mapPicker}>
                  <select
                    style={s.mapSelect}
                    value={selectedMapId}
                    onChange={e => setSelectedMapId(e.target.value)}
                  >
                    {mapList.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <button style={s.mapConfirmBtn} onClick={populateTokens}>Add Tokens</button>
                </div>
              )}
            </>
          )}
          {tokenToast && <span style={s.toast}>{tokenToast}</span>}
        </div>

        {/* End combat */}
        {endConfirm ? (
          <div style={s.endConfirmRow}>
            <span style={s.endConfirmText}>End combat and return to encounter list?</span>
            <button style={s.endYesBtn} onClick={() => { setEndConfirm(false); onEndCombat() }}>End Combat</button>
            <button style={s.endNoBtn}  onClick={() => setEndConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button style={s.endBtn} onClick={() => setEndConfirm(true)}>
            🏁 End Combat
          </button>
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
    fontSize: 13, padding: '3px 10px', borderRadius: 12,
    flexShrink: 0,
  },
  nextBtn: {
    padding: '5px 14px', background: '#2a3a5a', color: '#7ab0ff',
    border: '1px solid #3a5a8a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
    flexShrink: 0,
  },

  // Setup
  setupList: { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', padding: '4px 0' },
  setupRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 14px', borderBottom: '1px solid #222',
  },
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
    border: '1px solid #3d7a37', borderRadius: 5, cursor: 'pointer', fontSize: 13,
    marginLeft: 'auto',
  },

  // Tracker list
  trackerList: { flex: 1, overflowY: 'auto' },
  combatantRow: {
    borderBottom: '1px solid #222', transition: 'background 0.15s',
  },
  combatantMain: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 12px',
  },
  combatantActive: { background: '#1e2a14', borderLeft: '3px solid #c9a84c' },
  combatantDefeated: { opacity: 0.45 },
  turnArrow:  { color: '#c9a84c', fontSize: 14, width: 14, flexShrink: 0, userSelect: 'none' },
  typeIcon:   { fontSize: 14, flexShrink: 0 },
  initVal:    { color: '#c9a84c', fontSize: 13, fontWeight: 700, minWidth: 24, textAlign: 'center' },
  combatName: {
    color: '#e0d5c0', fontSize: 14, flex: 1, cursor: 'pointer',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  fadedText: { color: '#555' },
  hpBarWrap: {
    position: 'relative', height: 18, minWidth: 80, maxWidth: 120,
    background: '#111', borderRadius: 3, overflow: 'hidden',
    cursor: 'pointer', border: '1px solid #333', flexShrink: 0,
  },
  hpBarFill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    transition: 'width 0.2s, background 0.2s',
  },
  hpBarText: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 600,
    userSelect: 'none',
  },
  acBadge:    { color: '#888', fontSize: 12, flexShrink: 0, minWidth: 42 },
  defeatedBadge: {
    fontSize: 11, color: '#e05050', background: '#2a1010',
    border: '1px solid #5a2020', borderRadius: 8, padding: '1px 7px', flexShrink: 0,
  },
  unconsciousBadge: {
    fontSize: 11, color: '#c9a84c', background: '#2a2010',
    border: '1px solid #5a4010', borderRadius: 8, padding: '1px 7px', flexShrink: 0,
  },
  conditionPills: { display: 'flex', gap: 3, flexWrap: 'wrap' },
  condPill: {
    fontSize: 10, background: '#2a2a3a', color: '#aaa',
    border: '1px solid #444', borderRadius: 8, padding: '1px 6px',
  },
  concentrationIcon: { fontSize: 13 },

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
  hpModeBtnActive:     { background: '#3a1010', borderColor: '#8B0000', color: '#e05050' },
  hpModeBtnHealActive: { background: '#1a3a1a', borderColor: '#2D7A2D', color: '#7fc272' },
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
    background: 'none', border: 'none', color: '#555',
    cursor: 'pointer', fontSize: 14, padding: '2px 6px',
  },

  // Footer
  footer: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    padding: '8px 14px', borderTop: '1px solid #333',
    background: '#1e1e1e', flexShrink: 0,
  },
  mapSection:   { display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' },
  mapBtn: {
    padding: '5px 12px', background: '#1a2a3a', color: '#6a9abf',
    border: '1px solid #2a4a6a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  mapPicker:    { display: 'flex', gap: 6, alignItems: 'center' },
  mapSelect: {
    background: '#111', border: '1px solid #444', borderRadius: 4,
    color: '#e0d5c0', padding: '4px 8px', fontSize: 12, outline: 'none',
  },
  mapConfirmBtn: {
    padding: '4px 12px', background: '#2d5a27', color: '#7fc272',
    border: '1px solid #3d7a37', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  toast: {
    color: '#7fc272', fontSize: 12, fontStyle: 'italic',
  },
  endConfirmRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  endConfirmText: { color: '#aaa', fontSize: 12 },
  endYesBtn: {
    padding: '5px 14px', background: '#5a1a1a', color: '#e05050',
    border: '1px solid #8a2a2a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  endNoBtn: {
    padding: '5px 10px', background: '#2a2a2a', color: '#888',
    border: '1px solid #444', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  endBtn: {
    padding: '5px 14px', background: '#2a2a2a', color: '#c9a84c',
    border: '1px solid #5a4010', borderRadius: 4, cursor: 'pointer', fontSize: 12,
    marginLeft: 'auto',
  },
}
