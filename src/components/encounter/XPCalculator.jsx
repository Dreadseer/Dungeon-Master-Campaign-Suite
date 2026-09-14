import { useState, useEffect, useMemo } from 'react'
import {
  partyThresholds,
  monsterMultiplier,
  adjustedXP,
  rawXP,
  difficultyRating,
} from '../../utils/encounterUtils'
import useCampaignStore from '../../stores/campaignStore'
import {
  buildAdvicePrompt, parseAdvice, checkAdvice, applyAdvice,
  describeAdvice, rosterXpTotal,
} from '../../utils/encounterAdvice'
import { createMonsterEntry } from '../../utils/encounterUtils'
import { notifyError, notifySuccess } from '../../stores/toastStore'

export default function XPCalculator({ encounter, monsters, onDifficultyChange, onRosterChange }) {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  // ── Party config ─────────────────────────────────────────────────────────
  const [useChars, setUseChars]           = useState(true)
  const [campaignChars, setCampaignChars] = useState([])
  const [selectedIds, setSelectedIds]     = useState(new Set())
  const [manualCount, setManualCount]     = useState(4)
  const [manualLevel, setManualLevel]     = useState(5)

  // ── AI advisor ───────────────────────────────────────────────────────────
  //
  // The advisor used to return prose: the DM read "drop one goblin and add an
  // archer" and then went and did it by hand. It now returns operations on the
  // roster, each with an Apply button.
  const [aiLoading, setAiLoading]         = useState(false)
  const [aiSummary, setAiSummary]         = useState('')
  const [aiAdvice,  setAiAdvice]          = useState(null)   // [{ suggestion, applied, note }]
  const [aiError,   setAiError]           = useState('')
  const [aiMode,    setAiMode]            = useState(null)
  const [applying,  setApplying]          = useState(false)

  useEffect(() => {
    // getMode resolves to an OBJECT — destructure it.
    window.electronAPI.ai.getMode()
      .then(({ mode }) => setAiMode(mode))
      .catch(() => setAiMode('no-ai'))
  }, [])

  // Load campaign characters when toggled on
  useEffect(() => {
    if (!useChars || !activeCampaign) return
    window.electronAPI.db.characters.getAll(activeCampaign.id)
      .then(chars => {
        setCampaignChars(chars)
        setSelectedIds(new Set(chars.map(c => c.id)))
      })
      .catch(() => {})
  }, [useChars, activeCampaign])

  // ── Derived party ─────────────────────────────────────────────────────────
  const party = useMemo(() => {
    if (useChars) {
      return campaignChars
        .filter(c => selectedIds.has(c.id))
        .map(c => ({ level: c.level ?? 1, name: c.character_name }))
    }
    return Array.from({ length: manualCount }, () => ({ level: manualLevel }))
  }, [useChars, campaignChars, selectedIds, manualCount, manualLevel])

  // ── XP math ───────────────────────────────────────────────────────────────
  // partySize feeds monsterMultiplier: the DMG shifts the encounter multiplier
  // one rung up for a party under 3 and one rung down for a party of 6+.
  const partySize    = party.length || 1
  const thresholds   = useMemo(() => partyThresholds(party), [party])
  const raw          = useMemo(() => rawXP(monsters), [monsters])
  const adjusted     = useMemo(() => adjustedXP(monsters, partySize), [monsters, partySize])
  const totalCount   = useMemo(() => monsters.reduce((s, m) => s + m.count, 0), [monsters])
  const multiplier   = useMemo(() => monsterMultiplier(totalCount, partySize), [totalCount, partySize])
  const difficulty   = useMemo(() => difficultyRating(adjusted, thresholds), [adjusted, thresholds])
  const xpPerPlayer  = partySize > 0 ? Math.floor(raw / partySize) : 0
  const avgLevel     = party.length > 0
    ? Math.round(party.reduce((s, c) => s + c.level, 0) / party.length)
    : manualLevel

  // Threshold bar: position adjusted XP within the deadly range (cap display at 2× deadly)
  const [easy, medium, hard, deadly] = thresholds
  const barMax  = Math.max(deadly * 1.5, adjusted * 1.1, 100)
  const pct = (v) => Math.min(100, Math.round((v / barMax) * 100))

  // ── AI Advisor ────────────────────────────────────────────────────────────
  const handleAskAI = async () => {
    if (!monsters.length) return
    setAiLoading(true)
    setAiAdvice(null)
    setAiSummary('')
    setAiError('')

    try {
      const { system, user } = buildAdvicePrompt({
        encounter, monsters, partySize, avgLevel,
        difficulty: difficulty.label, adjustedXp: adjusted, thresholds,
      })

      const raw = await window.electronAPI.ai.complete(system, user, {
        maxTokens: 1500, campaignId: activeCampaign?.id ?? null, type: 'encounter-advice',
      })

      const { summary, suggestions } = parseAdvice(raw)
      setAiSummary(summary)
      setAiAdvice(suggestions.map(sg => ({ suggestion: sg, applied: false, note: '' })))
    } catch (err) {
      setAiError(err?.message ?? 'AI request failed')
      notifyError(err, 'Ask the encounter advisor')
    } finally {
      setAiLoading(false)
    }
  }

  /**
   * Apply one suggestion to the roster and persist it.
   *
   * Saving goes through db:encounters:updateMonsters — the same channel the
   * roster itself uses. db:encounters:update would work too, but it rewrites
   * every column, so a stale name or status held in this component would
   * silently overwrite what the DM had just typed elsewhere.
   */
  const handleApply = async (index) => {
    if (applying || !encounter?.id) return
    const entry = aiAdvice?.[index]
    if (!entry || entry.applied) return

    setApplying(true)
    try {
      const sg = entry.suggestion
      const check = checkAdvice(sg, monsters)
      if (!check.ok) {
        notifyError(new Error(check.reason ?? 'Cannot apply'), 'Apply suggestion')
        return
      }

      // A monster not already in the roster needs its stat block before it can
      // be added; without it applyAdvice is a no-op rather than a broken entry.
      let newEntry = null
      if (check.needsLookup) {
        const wantedIndex = sg.action === 'replace' ? sg.replaceWithIndex : sg.monsterIndex
        const wantedName  = sg.action === 'replace' ? sg.replaceWithName  : sg.monsterName
        const block = await window.electronAPI.srd.getMonsterByIndex(wantedIndex)
        if (!block) {
          notifyError(
            new Error(`"${wantedName}" is not in the SRD cache — add it from the Monsters panel instead.`),
            'Apply suggestion',
          )
          return
        }
        newEntry = createMonsterEntry(block, 'srd')
      }

      const result = applyAdvice(sg, monsters, newEntry)
      if (!result.changed) {
        notifyError(new Error(result.note), 'Apply suggestion')
        return
      }

      await window.electronAPI.db.encounters.updateMonsters(
        encounter.id, result.monsters, rosterXpTotal(result.monsters))

      onRosterChange?.(result.monsters)
      setAiAdvice(prev => prev.map((a, i) => i === index ? { ...a, applied: true, note: result.note } : a))
      notifySuccess(result.note)
    } catch (err) {
      notifyError(err, 'Apply suggestion')
    } finally {
      setApplying(false)
    }
  }

  const toggleChar = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const isDeadly = difficulty.label === 'Deadly'

  // Notify parent of difficulty changes
  useEffect(() => {
    onDifficultyChange?.(difficulty.label)
  }, [difficulty.label, onDifficultyChange])

  return (
    <div style={{ ...s.panel, ...(isDeadly ? s.panelDeadly : {}) }}>
      <div style={s.panelHeader}>
        <span style={s.panelTitle}>⚔ XP Calculator</span>
        {monsters.length > 0 && (
          <span style={{ ...s.diffBadge, background: difficulty.color }}>
            {difficulty.label.toUpperCase()}
          </span>
        )}
      </div>

      {/* Party Configuration */}
      <div style={s.section}>
        <div style={s.sectionLabel}>Party</div>
        <div style={s.modeRow}>
          <label style={s.radioLabel}>
            <input
              type="radio" checked={useChars}
              onChange={() => setUseChars(true)}
              style={{ accentColor: '#c9a84c' }}
            />
            Campaign Characters
          </label>
          <label style={s.radioLabel}>
            <input
              type="radio" checked={!useChars}
              onChange={() => setUseChars(false)}
              style={{ accentColor: '#c9a84c' }}
            />
            Manual Entry
          </label>
        </div>

        {useChars ? (
          campaignChars.length === 0 ? (
            <p style={s.hint}>No characters in this campaign yet.</p>
          ) : (
            <div style={s.charList}>
              {campaignChars.map(c => (
                <label key={c.id} style={s.charRow}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleChar(c.id)}
                    style={{ accentColor: '#c9a84c' }}
                  />
                  <span style={s.charName}>{c.character_name}</span>
                  <span style={s.charLevel}>Lv {c.level}</span>
                </label>
              ))}
            </div>
          )
        ) : (
          <div style={s.manualRow}>
            <label style={s.manualLabel}>
              Players
              <input
                type="number" min={1} max={8}
                value={manualCount}
                onChange={e => setManualCount(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
                style={s.numInput}
              />
            </label>
            <label style={s.manualLabel}>
              Level
              <input
                type="number" min={1} max={20}
                value={manualLevel}
                onChange={e => setManualLevel(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                style={s.numInput}
              />
            </label>
          </div>
        )}
      </div>

      {/* XP Breakdown */}
      <div style={s.section}>
        <div style={s.sectionLabel}>XP Breakdown</div>
        <table style={s.table}>
          <tbody>
            <tr>
              <td style={s.tdLabel}>Raw Monster XP</td>
              <td style={s.tdVal}>{raw.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={s.tdLabel}>
                Monster Count Multiplier
                <span style={s.hint2}>({totalCount} monster{totalCount !== 1 ? 's' : ''})</span>
              </td>
              <td style={s.tdVal}>×{multiplier}</td>
            </tr>
            <tr style={{ borderTop: '1px solid #333' }}>
              <td style={{ ...s.tdLabel, fontWeight: 600, color: '#e0d5c0' }}>Adjusted XP</td>
              <td style={{ ...s.tdVal, fontWeight: 600, color: '#c9a84c' }}>{adjusted.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={s.tdLabel}>XP Reward / Player ({partySize} players)</td>
              <td style={s.tdVal}>{xpPerPlayer.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Party Thresholds */}
      <div style={s.section}>
        <div style={s.sectionLabel}>Party Thresholds</div>
        <div style={s.thresholdRow}>
          {['Easy', 'Medium', 'Hard', 'Deadly'].map((label, i) => (
            <div key={label} style={s.thresholdCell}>
              <div style={{ ...s.thresholdLabel, color: ['#2D7A2D','#B8750A','#C0392B','#8B0000'][i] }}>
                {label}
              </div>
              <div style={s.thresholdVal}>{(thresholds[i] ?? 0).toLocaleString()}</div>
            </div>
          ))}
        </div>

        {/* Threshold bar */}
        <div style={s.barTrack}>
          {/* Tier zone markers */}
          {[easy, medium, hard, deadly].map((v, i) => (
            <div
              key={i}
              style={{
                ...s.barMarker,
                left: `${pct(v)}%`,
                background: ['#2D7A2D','#B8750A','#C0392B','#8B0000'][i],
              }}
              title={['Easy','Medium','Hard','Deadly'][i] + ': ' + v.toLocaleString()}
            />
          ))}
          {/* Adjusted XP indicator */}
          {adjusted > 0 && (
            <div
              style={{
                ...s.barIndicator,
                left: `${Math.min(97, pct(adjusted))}%`,
                background: difficulty.color,
              }}
              title={`Adjusted XP: ${adjusted.toLocaleString()}`}
            />
          )}
          {/* Coloured fill */}
          <div style={{ ...s.barFill, width: `${pct(adjusted)}%`, background: difficulty.color }} />
        </div>
        <div style={s.barLabels}>
          <span>0</span>
          <span>{(barMax / 2).toLocaleString()}</span>
          <span>{barMax.toLocaleString()}</span>
        </div>
      </div>

      {/* AI Difficulty Advisor */}
      <div style={s.section}>
        <div style={s.aiHeader}>
          <div style={s.sectionLabel}>AI Difficulty Advisor</div>
          <button
            style={{ ...s.aiBtn, ...((aiLoading || aiMode === 'no-ai') ? s.aiBtnDisabled : {}) }}
            onClick={handleAskAI}
            disabled={aiLoading || monsters.length === 0 || aiMode === 'no-ai'}
          >
            {aiLoading ? '…Thinking' : '✨ Ask AI'}
          </button>
        </div>

        {aiMode === 'no-ai' && (
          <p style={s.hint}>
            AI not configured — add an API key in Settings, or install Ollama, to get
            balance suggestions you can apply.
          </p>
        )}
        {monsters.length === 0 && aiMode !== 'no-ai' && (
          <p style={s.hint}>Add monsters to the roster first.</p>
        )}
        {aiError && <p style={{ ...s.hint, color: '#e05050' }}>⚠ {aiError}</p>}
        {aiSummary && <p style={s.aiLine}>{aiSummary}</p>}

        {aiAdvice && aiAdvice.length === 0 && !aiSummary && (
          <p style={s.hint}>The advisor had no changes to suggest.</p>
        )}

        {aiAdvice && aiAdvice.length > 0 && (
          <div style={s.aiResult}>
            {aiAdvice.map((entry, i) => {
              const check = checkAdvice(entry.suggestion, monsters)
              return (
                <div key={i} style={s.adviceRow}>
                  <div style={s.adviceText}>
                    <span style={s.adviceLabel}>{describeAdvice(entry.suggestion)}</span>
                    {entry.suggestion.reason && (
                      <span style={s.adviceReason}>{entry.suggestion.reason}</span>
                    )}
                    {entry.applied && <span style={s.adviceApplied}>✓ {entry.note}</span>}
                    {!entry.applied && !check.ok && (
                      <span style={s.adviceBlocked}>⚠ {check.reason}</span>
                    )}
                  </div>
                  {!entry.applied && (
                    <button
                      style={(!check.ok || applying) ? s.applyBtnDisabled : s.applyBtn}
                      onClick={() => handleApply(i)}
                      disabled={!check.ok || applying}
                      title={check.ok ? 'Apply to the roster' : check.reason}
                    >
                      Apply
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  panel: {
    display: 'flex', flexDirection: 'column', gap: 0,
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    overflow: 'hidden', marginTop: 12,
  },
  panelDeadly: { border: '1px solid #8B0000' },
  panelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', background: '#222', borderBottom: '1px solid #333',
  },
  panelTitle: { color: '#c9a84c', fontWeight: 600, fontSize: 14 },
  diffBadge: {
    color: '#fff', fontWeight: 700, fontSize: 13,
    padding: '3px 12px', borderRadius: 12, letterSpacing: 1,
  },
  section: {
    padding: '10px 14px',
    borderBottom: '1px solid #222',
  },
  sectionLabel: {
    color: '#666', fontSize: 11, textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8,
  },
  modeRow: { display: 'flex', gap: 20, marginBottom: 8 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 6, color: '#aaa', fontSize: 13, cursor: 'pointer' },
  charList: { display: 'flex', flexDirection: 'column', gap: 4 },
  charRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    color: '#aaa', fontSize: 13, cursor: 'pointer',
  },
  charName: { flex: 1, color: '#e0d5c0' },
  charLevel: { color: '#c9a84c', fontSize: 12 },
  manualRow: { display: 'flex', gap: 16 },
  manualLabel: { display: 'flex', flexDirection: 'column', gap: 4, color: '#aaa', fontSize: 12 },
  numInput: {
    width: 60, background: '#111', border: '1px solid #444',
    borderRadius: 4, color: '#e0d5c0', padding: '4px 8px', fontSize: 14, outline: 'none',
  },
  hint:  { color: '#555', fontSize: 12, margin: '4px 0 0', fontStyle: 'italic' },
  hint2: { color: '#555', fontSize: 11, marginLeft: 4 },
  table: { width: '100%', borderCollapse: 'collapse' },
  tdLabel: { color: '#888', fontSize: 13, padding: '4px 0', verticalAlign: 'middle' },
  tdVal:   { color: '#c9a84c', fontSize: 13, textAlign: 'right', padding: '4px 0', fontVariantNumeric: 'tabular-nums' },
  thresholdRow: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 },
  thresholdCell: { textAlign: 'center' },
  thresholdLabel: { fontSize: 11, fontWeight: 600, marginBottom: 2 },
  thresholdVal:   { color: '#e0d5c0', fontSize: 13, fontVariantNumeric: 'tabular-nums' },
  barTrack: {
    position: 'relative', height: 14, background: '#111',
    borderRadius: 7, overflow: 'visible', border: '1px solid #333',
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
    color: '#444', fontSize: 10, marginTop: 4,
  },
  aiHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  aiBtn: {
    padding: '4px 12px', background: '#2a1a3a', color: '#b07cf7',
    border: '1px solid #4a2a6a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  aiBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  aiResult: { display: 'flex', flexDirection: 'column', gap: 6 },
  adviceRow: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    background: '#141008', border: '1px solid #2a2010', borderRadius: 4, padding: '6px 8px',
  },
  adviceText:   { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  adviceLabel:  { color: '#e0d5c0', fontSize: 12, fontWeight: 600 },
  adviceReason: { color: '#8a7a5a', fontSize: 11, lineHeight: 1.45 },
  adviceApplied:{ color: '#7fc272', fontSize: 11 },
  adviceBlocked:{ color: '#c08050', fontSize: 11 },
  applyBtn: {
    padding: '3px 12px', background: '#2d6a2d', border: 'none', borderRadius: 4,
    color: '#e8f0e0', fontSize: 11, fontWeight: 'bold', cursor: 'pointer', flexShrink: 0,
  },
  applyBtnDisabled: {
    padding: '3px 12px', background: '#232018', border: 'none', borderRadius: 4,
    color: '#5a5040', fontSize: 11, fontWeight: 'bold', cursor: 'not-allowed', flexShrink: 0,
  },
  aiLine: { color: '#c9d5a0', fontSize: 13, margin: 0, lineHeight: 1.5 },
}
