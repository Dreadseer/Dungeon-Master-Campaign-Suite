import { useState, useMemo, useRef } from 'react'
import { useNavigate }  from 'react-router-dom'
import {
  parseCR, crToXP,
  partyThresholds, monsterMultiplier,
  adjustedXP, rawXP, difficultyRating,
} from '../utils/encounterUtils'
import { crColor } from '../utils/crColor'

const EMPTY_ROW = () => ({ id: crypto.randomUUID(), nameInput: '', cr: '', count: 1, resolvedCR: null, resolvedName: '' })

export default function CombatCalculator() {
  const navigate = useNavigate()

  // ── Party inputs ────────────────────────────────────────────────────────
  const [playerCount, setPlayerCount] = useState(4)
  const [useAvgLevel, setUseAvgLevel] = useState(true)
  const [avgLevel, setAvgLevel]       = useState(5)
  const [indivLevels, setIndivLevels] = useState([5, 5, 5, 5])

  // ── Monster rows ────────────────────────────────────────────────────────
  const [rows, setRows] = useState([EMPTY_ROW()])

  // SRD lookup debounce refs per row
  const debounceRefs = useRef({})

  const updatePlayerCount = (n) => {
    const count = Math.max(1, Math.min(8, n))
    setPlayerCount(count)
    setIndivLevels(prev => {
      const next = [...prev]
      while (next.length < count) next.push(5)
      return next.slice(0, count)
    })
  }

  // ── Derived party ────────────────────────────────────────────────────────
  const party = useMemo(() => {
    if (useAvgLevel) return Array.from({ length: playerCount }, () => ({ level: avgLevel }))
    return indivLevels.map(l => ({ level: l }))
  }, [useAvgLevel, playerCount, avgLevel, indivLevels])

  // ── Derived monster list from rows ───────────────────────────────────────
  const monsters = useMemo(() =>
    rows
      .filter(r => r.resolvedCR !== null || r.cr !== '')
      .map(r => {
        const crVal = r.resolvedCR !== null ? r.resolvedCR : parseCR(r.cr)
        return {
          id:    r.id,
          name:  r.resolvedName || r.nameInput || 'Monster',
          cr:    crVal,
          xp:    crToXP(crVal),
          count: r.count,
        }
      }),
  [rows])

  // ── XP math ─────────────────────────────────────────────────────────────
  const thresholds  = useMemo(() => partyThresholds(party),  [party])
  const raw         = useMemo(() => rawXP(monsters),         [monsters])
  const adjusted    = useMemo(() => adjustedXP(monsters),    [monsters])
  const totalCount  = useMemo(() => monsters.reduce((s, m) => s + m.count, 0), [monsters])
  const multiplier  = useMemo(() => monsterMultiplier(totalCount), [totalCount])
  const difficulty  = useMemo(() => difficultyRating(adjusted, thresholds), [adjusted, thresholds])
  const xpPerPlayer = party.length > 0 ? Math.floor(raw / party.length) : 0

  const [easy, medium, hard, deadly] = thresholds
  const barMax = Math.max(deadly * 1.5, adjusted * 1.1, 100)
  const pct = (v) => Math.min(100, Math.round((v / barMax) * 100))

  // ── Monster row helpers ───────────────────────────────────────────────────
  const srdLookup = (rowId, nameVal) => {
    if (debounceRefs.current[rowId]) clearTimeout(debounceRefs.current[rowId])
    debounceRefs.current[rowId] = setTimeout(async () => {
      if (!nameVal || nameVal.length < 2) return
      try {
        const results = await window.electronAPI.srd.getMonsters({ name: nameVal })
        if (!results?.length) return
        const exact = results.find(m => m.name.toLowerCase() === nameVal.toLowerCase()) ?? results[0]
        setRows(prev => prev.map(r =>
          r.id === rowId
            ? { ...r, resolvedCR: exact.challenge_rating, resolvedName: exact.name, cr: String(exact.challenge_rating) }
            : r
        ))
      } catch { /* ignore */ }
    }, 400)
  }

  const updateRow = (id, changes) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...changes } : r))
  }

  const addRow    = () => setRows(prev => [...prev, EMPTY_ROW()])
  const removeRow = (id) => setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)

  // ── Save as Encounter ─────────────────────────────────────────────────────
  const handleSaveAsEncounter = () => {
    // Store in sessionStorage for EncounterBuilder to pick up on mount
    sessionStorage.setItem('dmcs_prefill_encounter', JSON.stringify({ monsters }))
    navigate('/encounters')
  }

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <h1 style={s.pageTitle}>Combat Calculator</h1>
        <p style={s.pageDesc}>Calculate encounter difficulty without building a full encounter</p>
      </div>

      <div style={s.body}>
        {/* Left column — inputs */}
        <div style={s.leftCol}>
          {/* Party Panel */}
          <div style={s.panel}>
            <div style={s.panelHeader}>Party</div>

            <div style={s.row}>
              <label style={s.inlineLabel}>
                Players
                <input
                  type="number" min={1} max={8} value={playerCount}
                  onChange={e => updatePlayerCount(parseInt(e.target.value) || 1)}
                  style={s.numInput}
                />
              </label>
              <div style={s.modeToggle}>
                <button
                  style={{ ...s.modeBtn, ...(useAvgLevel ? s.modeBtnActive : {}) }}
                  onClick={() => setUseAvgLevel(true)}
                >
                  Avg Level
                </button>
                <button
                  style={{ ...s.modeBtn, ...(!useAvgLevel ? s.modeBtnActive : {}) }}
                  onClick={() => setUseAvgLevel(false)}
                >
                  Individual
                </button>
              </div>
            </div>

            {useAvgLevel ? (
              <label style={s.blockLabel}>
                Average Level
                <input
                  type="number" min={1} max={20} value={avgLevel}
                  onChange={e => setAvgLevel(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  style={{ ...s.numInput, width: 70 }}
                />
              </label>
            ) : (
              <div style={s.indivGrid}>
                {indivLevels.map((lv, i) => (
                  <label key={i} style={s.indivLabel}>
                    P{i + 1}
                    <input
                      type="number" min={1} max={20} value={lv}
                      onChange={e => setIndivLevels(prev => {
                        const next = [...prev]
                        next[i] = Math.max(1, Math.min(20, parseInt(e.target.value) || 1))
                        return next
                      })}
                      style={s.numInput}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Monster Panel */}
          <div style={s.panel}>
            <div style={s.panelHeader}>Monsters</div>

            {rows.map((row, idx) => (
              <div key={row.id} style={s.monsterRow}>
                <input
                  style={{ ...s.textInput, flex: 2 }}
                  placeholder="Monster name…"
                  value={row.nameInput}
                  onChange={e => {
                    const val = e.target.value
                    updateRow(row.id, { nameInput: val, resolvedCR: null, resolvedName: '' })
                    srdLookup(row.id, val)
                  }}
                />
                <input
                  style={{ ...s.textInput, flex: 1 }}
                  placeholder="CR"
                  value={row.cr}
                  onChange={e => updateRow(row.id, { cr: e.target.value, resolvedCR: null })}
                  title="Challenge Rating — auto-filled by name lookup"
                />
                <input
                  type="number" min={1} value={row.count}
                  onChange={e => updateRow(row.id, { count: Math.max(1, parseInt(e.target.value) || 1) })}
                  style={{ ...s.numInput, width: 50 }}
                  title="Count"
                />
                {rows.length > 1 && (
                  <button style={s.removeBtn} onClick={() => removeRow(row.id)}>✕</button>
                )}
                {row.resolvedName && row.resolvedName !== row.nameInput && (
                  <span style={s.resolvedHint}>{row.resolvedName}</span>
                )}
                {row.resolvedCR !== null && (
                  <span style={{ ...s.crChip, background: crColor(row.resolvedCR) }}>
                    CR {row.resolvedCR}
                  </span>
                )}
              </div>
            ))}

            <button style={s.addRowBtn} onClick={addRow}>+ Add Monster Row</button>
          </div>
        </div>

        {/* Right column — results */}
        <div style={s.rightCol}>
          <div style={s.panel}>
            <div style={s.panelHeader}>
              Difficulty
              {monsters.length > 0 && (
                <span style={{ ...s.diffBadge, background: difficulty.color }}>
                  {difficulty.label.toUpperCase()}
                </span>
              )}
            </div>

            {monsters.length === 0 ? (
              <p style={s.hint}>Add monsters on the left to calculate difficulty.</p>
            ) : (
              <>
                {/* XP breakdown */}
                <table style={s.table}>
                  <tbody>
                    <tr>
                      <td style={s.tdL}>Raw Monster XP</td>
                      <td style={s.tdR}>{raw.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={s.tdL}>Multiplier ({totalCount} monsters)</td>
                      <td style={s.tdR}>×{multiplier}</td>
                    </tr>
                    <tr style={{ borderTop: '1px solid #333' }}>
                      <td style={{ ...s.tdL, fontWeight: 600, color: '#e0d5c0' }}>Adjusted XP</td>
                      <td style={{ ...s.tdR, fontWeight: 600, color: '#c9a84c' }}>{adjusted.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={s.tdL}>XP / Player ({party.length})</td>
                      <td style={s.tdR}>{xpPerPlayer.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Threshold table */}
                <div style={s.thresholdGrid}>
                  {['Easy', 'Medium', 'Hard', 'Deadly'].map((lbl, i) => (
                    <div key={lbl} style={s.thresholdCell}>
                      <div style={{ ...s.thresholdLabel, color: ['#2D7A2D','#B8750A','#C0392B','#8B0000'][i] }}>
                        {lbl}
                      </div>
                      <div style={s.thresholdVal}>{(thresholds[i] ?? 0).toLocaleString()}</div>
                    </div>
                  ))}
                </div>

                {/* Bar */}
                <div style={s.barTrack}>
                  {[easy, medium, hard, deadly].map((v, i) => (
                    <div
                      key={i}
                      style={{ ...s.barMarker, left: `${pct(v)}%`, background: ['#2D7A2D','#B8750A','#C0392B','#8B0000'][i] }}
                    />
                  ))}
                  {adjusted > 0 && (
                    <div style={{ ...s.barIndicator, left: `${Math.min(97, pct(adjusted))}%`, background: difficulty.color }} />
                  )}
                  <div style={{ ...s.barFill, width: `${pct(adjusted)}%`, background: difficulty.color }} />
                </div>
                <div style={s.barLabels}>
                  <span>0</span><span>{(barMax / 2).toLocaleString()}</span><span>{barMax.toLocaleString()}</span>
                </div>

                <button style={s.saveBtn} onClick={handleSaveAsEncounter}>
                  Save as Encounter →
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const s = {
  page: {
    display: 'flex', flexDirection: 'column',
    height: '100%', padding: '20px 24px', gap: 16,
    boxSizing: 'border-box', overflow: 'auto',
  },
  pageHeader: { flexShrink: 0 },
  pageTitle:  { color: '#c9a84c', fontSize: '1.6rem', margin: '0 0 4px' },
  pageDesc:   { color: '#666', fontSize: 13, margin: 0 },
  body: { display: 'flex', gap: 16, flex: 1, minHeight: 0, alignItems: 'flex-start' },
  leftCol:  { display: 'flex', flexDirection: 'column', gap: 16, flex: 1 },
  rightCol: { display: 'flex', flexDirection: 'column', gap: 16, flex: 1 },
  panel: {
    background: '#1a1a1a', border: '1px solid #333',
    borderRadius: 8, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  },
  panelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#222', borderBottom: '1px solid #333',
    color: '#c9a84c', fontWeight: 600, fontSize: 14,
  },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' },
  inlineLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#aaa', fontSize: 13 },
  blockLabel:  { display: 'flex', flexDirection: 'column', gap: 4, color: '#aaa', fontSize: 13, padding: '0 14px 10px' },
  modeToggle:  { display: 'flex', marginLeft: 'auto' },
  modeBtn: {
    padding: '4px 10px', background: '#222', border: '1px solid #444',
    color: '#666', cursor: 'pointer', fontSize: 12,
  },
  modeBtnActive: { background: '#2a2010', borderColor: '#c9a84c', color: '#c9a84c' },
  indivGrid: {
    display: 'flex', flexWrap: 'wrap', gap: 8,
    padding: '0 14px 10px',
  },
  indivLabel: { display: 'flex', alignItems: 'center', gap: 4, color: '#888', fontSize: 12 },
  numInput: {
    width: 55, background: '#111', border: '1px solid #444',
    borderRadius: 4, color: '#e0d5c0', padding: '4px 8px',
    fontSize: 14, outline: 'none', textAlign: 'center',
  },
  monsterRow: {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    padding: '6px 14px', borderBottom: '1px solid #222', position: 'relative',
  },
  textInput: {
    background: '#111', border: '1px solid #444', borderRadius: 4,
    color: '#e0d5c0', padding: '5px 8px', fontSize: 13, outline: 'none',
    minWidth: 0,
  },
  removeBtn: {
    background: 'none', border: 'none', color: '#555', cursor: 'pointer',
    fontSize: 14, padding: '2px 4px',
  },
  resolvedHint: { color: '#888', fontSize: 11, fontStyle: 'italic' },
  crChip: {
    fontSize: 11, fontWeight: 600, color: '#fff',
    padding: '1px 6px', borderRadius: 3, flexShrink: 0,
  },
  addRowBtn: {
    margin: '8px 14px', padding: '6px 0', background: 'none',
    border: '1px dashed #444', borderRadius: 4, color: '#666',
    cursor: 'pointer', fontSize: 12, textAlign: 'center',
  },
  diffBadge: {
    color: '#fff', fontWeight: 700, fontSize: 12,
    padding: '2px 10px', borderRadius: 10, letterSpacing: 1,
  },
  hint: { color: '#555', fontSize: 13, padding: '16px 14px', textAlign: 'center', fontStyle: 'italic' },
  table: { width: '100%', borderCollapse: 'collapse', padding: '0 14px', margin: '8px 0' },
  tdL: { color: '#888', fontSize: 13, padding: '4px 14px', verticalAlign: 'middle' },
  tdR: { color: '#c9a84c', fontSize: 13, textAlign: 'right', padding: '4px 14px', fontVariantNumeric: 'tabular-nums' },
  thresholdGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
    gap: 6, padding: '8px 14px',
  },
  thresholdCell: { textAlign: 'center' },
  thresholdLabel: { fontSize: 11, fontWeight: 600, marginBottom: 2 },
  thresholdVal:   { color: '#e0d5c0', fontSize: 13, fontVariantNumeric: 'tabular-nums' },
  barTrack: {
    position: 'relative', height: 14, background: '#111',
    borderRadius: 7, border: '1px solid #333',
    margin: '4px 14px 0', overflow: 'visible',
  },
  barFill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    borderRadius: 7, opacity: 0.35, transition: 'width 0.3s, background 0.3s',
  },
  barMarker: {
    position: 'absolute', top: -3, bottom: -3, width: 2,
    borderRadius: 1, opacity: 0.8,
  },
  barIndicator: {
    position: 'absolute', top: -5, bottom: -5, width: 3,
    borderRadius: 2, zIndex: 2,
  },
  barLabels: {
    display: 'flex', justifyContent: 'space-between',
    color: '#444', fontSize: 10, padding: '2px 14px 8px',
  },
  saveBtn: {
    margin: '12px 14px', padding: '8px 0', background: '#2d5a27',
    color: '#7fc272', border: '1px solid #3d7a37',
    borderRadius: 6, cursor: 'pointer', fontSize: 13,
    textAlign: 'center',
  },
}
