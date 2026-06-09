import { useState, useEffect } from 'react'
import EntityModal  from '../world/EntityModal'
import SubclassCard from './SubclassCard'
import {
  abilityMod, modStr, profBonus, getCasterType,
  HIT_DICE, SPELL_SLOTS,
} from '../../utils/dnd5e'

const LEVEL_LABELS = ['','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']

export default function LevelUpModal({ character, onClose, onApply }) {
  const level    = character.level ?? 1
  const newLevel = level + 1
  const cls      = character.class ?? ''
  const conMod   = abilityMod(character._stats?.con ?? 10)
  const hitDie   = HIT_DICE[cls] ?? 8
  const avgHp    = Math.floor(hitDie / 2) + 1 + conMod
  const casterType = getCasterType(cls)
  const oldProf  = profBonus(level)
  const newProf  = profBonus(newLevel)

  const [step,     setStep]    = useState(1)
  const [hpGain,   setHpGain]  = useState(null)   // null = not yet chosen
  const [rollResult, setRollResult] = useState(null)
  const [applying, setApplying] = useState(false)

  // Subclass state
  const [subclassCandidates, setSubclassCandidates] = useState([])
  const [selectedSubclass,   setSelectedSubclass]   = useState(null)

  useEffect(() => {
    if (!character.class) return
    window.electronAPI.db.subclasses.getByClass(character.class)
      .then(setSubclassCandidates)
      .catch(() => setSubclassCandidates([]))
  }, [character.class])

  // Show subclass step when this level-up is the unlock level AND no subclass assigned yet
  const triggerSubclass = subclassCandidates.length > 0
    && !character.subclass_name
    && subclassCandidates.some(s => s.unlock_level === newLevel)

  // ── Step helpers ────────────────────────────────────────────────────────────
  // Step map: 1=Confirm  2=HP  3=Subclass(conditional)  4=SpellSlots(conditional)  5=Summary
  function nextStep() {
    if      (step === 2 && triggerSubclass) setStep(3)
    else if (step === 2 && casterType)      setStep(4)
    else if (step === 2)                    setStep(5)
    else if (step === 3 && casterType)      setStep(4)
    else if (step === 3)                    setStep(5)
    else                                    setStep(s => s + 1)
  }

  function prevStep() {
    if      (step === 5 && casterType)      setStep(4)
    else if (step === 5 && triggerSubclass) setStep(3)
    else if (step === 5)                    setStep(2)
    else if (step === 4 && triggerSubclass) setStep(3)
    else if (step === 4)                    setStep(2)
    else                                    setStep(s => s - 1)
  }

  function roll() {
    const raw = Math.ceil(Math.random() * hitDie)
    const gain = Math.max(1, raw + conMod)
    setRollResult(raw)
    setHpGain(gain)
  }

  function chooseAverage() {
    setHpGain(avgHp)
    setRollResult(null)
  }

  // ── New spell slot data ──────────────────────────────────────────────────────
  function buildNewSlots() {
    if (!casterType) return character._slots ?? {}
    const oldTable = SPELL_SLOTS[casterType][level]    ?? []
    const newTable = SPELL_SLOTS[casterType][newLevel]  ?? []
    const current  = character._slots ?? {}
    const result   = { ...current }
    newTable.forEach((max, idx) => {
      const lvl = String(idx + 1)
      if (result[lvl]) {
        // existing level: update max if it grew, keep used count
        result[lvl] = { ...result[lvl], max }
      } else {
        // brand new slot level
        result[lvl] = { max, used: 0 }
      }
    })
    return result
  }

  // ── Slot diff for step 3 display ────────────────────────────────────────────
  function slotDiff() {
    if (!casterType) return []
    const oldTable = SPELL_SLOTS[casterType][level]    ?? []
    const newTable = SPELL_SLOTS[casterType][newLevel]  ?? []
    return newTable.map((max, idx) => ({
      lvl:   idx + 1,
      label: LEVEL_LABELS[idx + 1],
      max,
      prev:  oldTable[idx] ?? 0,
      gained: max - (oldTable[idx] ?? 0),
    })).filter(r => r.max > 0)
  }

  // ── Apply ────────────────────────────────────────────────────────────────────
  async function applyLevelUp() {
    const gain     = hpGain ?? Math.max(1, conMod + 1)
    const newSlots = buildNewSlots()
    const newHpMax = (character.hp_max ?? 0) + gain
    const newHpCur = Math.min((character.hp_current ?? 0) + gain, newHpMax)

    // Build new stats — merge subclass features if a subclass was chosen this level-up
    const newStats = { ...(character._stats ?? {}) }
    if (selectedSubclass) {
      const subFeatures = JSON.parse(selectedSubclass.features ?? '[]')
      const existing    = newStats.features?.class_features ?? []
      const merged      = [
        ...existing,
        ...subFeatures.filter(f => f.level_gained <= newLevel),
      ].sort((a, b) => (a.level_gained ?? 0) - (b.level_gained ?? 0))
      newStats.features = { ...(newStats.features ?? {}), class_features: merged }
    }

    setApplying(true)
    try {
      await window.electronAPI.db.characters.update(character.id, {
        player_name:    character.player_name    ?? '',
        character_name: character.character_name,
        class:          character.class,
        race:           character.race,
        level:          newLevel,
        stats:          newStats,
        hp_current:     newHpCur,
        hp_max:         newHpMax,
        inventory:      character._inventory,
        spell_slots:    newSlots,
        notes:          character.notes ?? '',
      })
      if (selectedSubclass) {
        await window.electronAPI.db.characters.setSubclass(character.id, selectedSubclass.name)
      }
      onApply()
    } catch { /* empty */ }
    setApplying(false)
  }

  // ── Step titles ─────────────────────────────────────────────────────────────
  const titles = {
    1: 'Level Up — Confirm',
    2: 'Level Up — Hit Points',
    3: 'Level Up — Choose Subclass',
    4: 'Level Up — Spell Slots',
    5: 'Level Up — Summary',
  }

  return (
    <EntityModal title={titles[step]} isOpen onClose={onClose}>
      {/* ── Step 1: Confirm ── */}
      {step === 1 && (
        <div style={w.step}>
          <div style={w.levelDisplay}>
            <div style={w.levelBox}>
              <span style={w.levelNum}>{level}</span>
              <span style={w.levelSub}>Current</span>
            </div>
            <span style={w.arrow}>→</span>
            <div style={{ ...w.levelBox, border: '1px solid #c9a84c' }}>
              <span style={{ ...w.levelNum, color: '#c9a84c' }}>{newLevel}</span>
              <span style={w.levelSub}>New Level</span>
            </div>
          </div>

          <div style={w.infoGrid}>
            <InfoRow label="Class"  value={cls || '—'} />
            <InfoRow label="Race"   value={character.race || '—'} />
            <InfoRow label="Prof. Bonus"
              value={oldProf === newProf
                ? `+${newProf} (unchanged)`
                : <span style={{ color: '#8ada6a' }}>+{oldProf} → <strong>+{newProf}</strong></span>}
            />
            <InfoRow label="Hit Die"  value={`d${hitDie}`} />
            <InfoRow label="CON mod"  value={modStr(character._stats?.con ?? 10)} />
          </div>

          <div style={w.btnRow}>
            <button style={w.cancelBtn} onClick={onClose}>Cancel</button>
            <button style={w.nextBtn} onClick={nextStep}>Proceed →</button>
          </div>
        </div>
      )}

      {/* ── Step 2: Hit Points ── */}
      {step === 2 && (
        <div style={w.step}>
          <p style={w.stepDesc}>
            As a <strong style={{ color: '#c9a84c' }}>{cls}</strong>, your hit die is a{' '}
            <strong style={{ color: '#c9a84c' }}>d{hitDie}</strong>.
            CON modifier: <strong style={{ color: '#c9a84c' }}>{modStr(character._stats?.con ?? 10)}</strong>
          </p>

          <div style={w.hpOptions}>
            <div style={w.hpOption}>
              <p style={w.hpOptionTitle}>Roll Hit Die</p>
              <p style={w.hpOptionDesc}>Roll 1d{hitDie} + CON modifier (minimum 1)</p>
              {rollResult !== null && (
                <p style={w.rollDisplay}>
                  Rolled <strong style={{ color: '#c9a84c' }}>{rollResult}</strong> + CON{' '}
                  → <strong style={{ color: '#8ada6a' }}>+{hpGain} HP</strong>
                </p>
              )}
              <button style={w.rollBtn} onClick={roll}>
                🎲 Roll d{hitDie}
              </button>
            </div>

            <div style={w.hpDivider}>or</div>

            <div style={w.hpOption}>
              <p style={w.hpOptionTitle}>Take Average</p>
              <p style={w.hpOptionDesc}>
                {Math.floor(hitDie / 2) + 1} + CON = <strong style={{ color: '#8ada6a' }}>+{Math.max(1, avgHp)} HP</strong>
              </p>
              <button style={{
                ...w.rollBtn,
                background: hpGain === avgHp && rollResult === null ? '#2a3a1a' : undefined,
                borderColor: hpGain === avgHp && rollResult === null ? '#4a7a2a' : undefined,
              }} onClick={chooseAverage}>
                Take +{Math.max(1, avgHp)} HP
              </button>
            </div>
          </div>

          {hpGain !== null && (
            <p style={w.chosenHp}>
              ✓ HP gain: <strong style={{ color: '#c9a84c' }}>+{hpGain}</strong>{' '}
              <span style={{ color: '#6b5a3a', fontSize: '0.8rem' }}>
                ({character.hp_max ?? 0} → {(character.hp_max ?? 0) + hpGain})
              </span>
            </p>
          )}

          <div style={w.btnRow}>
            <button style={w.cancelBtn} onClick={() => setStep(1)}>← Back</button>
            <button style={w.nextBtn} onClick={nextStep} disabled={hpGain === null}>
              {(triggerSubclass || casterType) ? 'Next →' : 'Review →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Choose Subclass (conditional) ── */}
      {step === 3 && triggerSubclass && (
        <div style={w.step}>
          <p style={w.stepDesc}>
            As a level <strong style={{ color: '#c9a84c' }}>{newLevel}</strong>{' '}
            <strong style={{ color: '#c9a84c' }}>{cls}</strong>, you now choose your specialization.
            This decision is permanent.
          </p>

          <div style={{ maxHeight: '340px', overflowY: 'auto', paddingRight: '4px' }}>
            {subclassCandidates
              .filter(s => s.unlock_level <= newLevel)
              .map(sub => (
                <SubclassCard
                  key={sub.id}
                  subclass={sub}
                  selected={selectedSubclass?.id === sub.id}
                  onSelect={() => setSelectedSubclass(sub)}
                />
              ))}
          </div>

          <div style={w.btnRow}>
            <button style={w.cancelBtn} onClick={() => setStep(2)}>← Back</button>
            <button
              style={{ ...w.nextBtn, opacity: selectedSubclass ? 1 : 0.4 }}
              onClick={nextStep}
              disabled={!selectedSubclass}
            >
              {selectedSubclass ? `Choose ${selectedSubclass.name} →` : 'Select a subclass to continue'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Spell Slots (casters only) ── */}
      {step === 4 && casterType && (
        <div style={w.step}>
          <p style={w.stepDesc}>
            At level <strong style={{ color: '#c9a84c' }}>{newLevel}</strong>, your{' '}
            <strong style={{ color: '#c9a84c' }}>{cls}</strong> spell slot progression updates:
          </p>

          <table style={w.slotTable}>
            <thead>
              <tr>
                <th style={w.th}>Level</th>
                <th style={w.th}>Previous</th>
                <th style={w.th}>New</th>
                <th style={w.th}>Change</th>
              </tr>
            </thead>
            <tbody>
              {slotDiff().map(row => (
                <tr key={row.lvl}>
                  <td style={w.td}>{row.label}</td>
                  <td style={w.tdNum}>{row.prev || '—'}</td>
                  <td style={{ ...w.tdNum, color: '#c9a84c', fontWeight: 700 }}>{row.max}</td>
                  <td style={{ ...w.tdNum, color: row.gained > 0 ? '#8ada6a' : '#6b5a3a' }}>
                    {row.gained > 0 ? `+${row.gained}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={w.btnRow}>
            <button style={w.cancelBtn} onClick={prevStep}>← Back</button>
            <button style={w.nextBtn} onClick={nextStep}>Review →</button>
          </div>
        </div>
      )}

      {/* ── Step 5: Summary ── */}
      {step === 5 && (
        <div style={w.step}>
          <p style={w.summaryTitle}>Ready to level up to <strong style={{ color: '#c9a84c' }}>Level {newLevel}</strong></p>

          <div style={w.summaryBox}>
            <SummaryRow label="Level"         value={`${level} → ${newLevel}`} highlight />
            <SummaryRow label="Proficiency"   value={`+${oldProf} → +${newProf}`} highlight={oldProf !== newProf} />
            <SummaryRow label="Max HP"        value={`${character.hp_max ?? 0} → ${(character.hp_max ?? 0) + (hpGain ?? 1)}`} highlight />
            <SummaryRow label="HP Gain"       value={`+${hpGain ?? 1}`} highlight />
            {selectedSubclass && (
              <SummaryRow label="Subclass" value={selectedSubclass.name} highlight />
            )}
            {casterType && slotDiff().some(r => r.gained > 0) && (
              <SummaryRow label="New Slots"
                value={slotDiff().filter(r => r.gained > 0).map(r => `${r.label} (+${r.gained})`).join(', ')}
                highlight />
            )}
          </div>

          <div style={w.btnRow}>
            <button style={w.cancelBtn} onClick={prevStep}>← Back</button>
            <button style={w.applyBtn} onClick={applyLevelUp} disabled={applying}>
              {applying ? 'Applying…' : `⬆ Apply Level Up`}
            </button>
          </div>
        </div>
      )}
    </EntityModal>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }) {
  return (
    <div style={w.infoRow}>
      <span style={w.infoLabel}>{label}</span>
      <span style={w.infoValue}>{value}</span>
    </div>
  )
}

function SummaryRow({ label, value, highlight }) {
  return (
    <div style={w.summaryRow}>
      <span style={w.summaryLabel}>{label}</span>
      <span style={{ ...w.summaryValue, color: highlight ? '#8ada6a' : '#a89060' }}>{value}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const w = {
  step:        { display: 'flex', flexDirection: 'column', gap: '1rem' },

  levelDisplay:{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', padding: '0.75rem 0' },
  levelBox:    { display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 8, padding: '0.6rem 1.2rem', minWidth: 80 },
  levelNum:    { color: '#e8e0d0', fontFamily: 'Georgia, serif', fontSize: '2rem', fontWeight: 700, lineHeight: 1 },
  levelSub:    { color: '#6b5a3a', fontSize: '0.7rem', textTransform: 'uppercase', marginTop: '0.2rem' },
  arrow:       { color: '#c9a84c', fontSize: '1.5rem' },

  infoGrid:    { display: 'flex', flexDirection: 'column', gap: '0.35rem', background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.65rem 0.85rem' },
  infoRow:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel:   { color: '#6b5a3a', fontSize: '0.8rem' },
  infoValue:   { color: '#e8e0d0', fontSize: '0.82rem', fontWeight: 600 },

  stepDesc:    { color: '#a89060', fontSize: '0.88rem', lineHeight: 1.5, margin: 0 },

  hpOptions:   { display: 'flex', gap: '0.75rem', alignItems: 'stretch' },
  hpOption:    { flex: 1, background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  hpOptionTitle:{ color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.9rem', margin: 0 },
  hpOptionDesc: { color: '#a89060', fontSize: '0.78rem', margin: 0, flex: 1, lineHeight: 1.4 },
  hpDivider:   { display: 'flex', alignItems: 'center', color: '#6b5a3a', fontSize: '0.8rem' },
  rollBtn:     { background: '#1a1208', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 4, padding: '0.35rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', marginTop: 'auto' },
  rollDisplay: { color: '#a89060', fontSize: '0.78rem', margin: 0 },
  chosenHp:    { color: '#a89060', fontSize: '0.85rem', margin: 0 },

  slotTable:   { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
  th:          { color: '#6b5a3a', textAlign: 'left', padding: '0.3rem 0.5rem', borderBottom: '1px solid #2a1c08', fontSize: '0.72rem', textTransform: 'uppercase' },
  td:          { color: '#e8e0d0', padding: '0.3rem 0.5rem', borderBottom: '1px solid #1a1208' },
  tdNum:       { color: '#a89060', padding: '0.3rem 0.5rem', borderBottom: '1px solid #1a1208', textAlign: 'center' },

  summaryTitle:{ color: '#a89060', fontSize: '0.9rem', margin: 0 },
  summaryBox:  { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.65rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  summaryRow:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel:{ color: '#6b5a3a', fontSize: '0.82rem' },
  summaryValue:{ fontSize: '0.85rem', fontWeight: 600 },

  btnRow:      { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.25rem', borderTop: '1px solid #2a1c08' },
  cancelBtn:   { background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.82rem' },
  nextBtn:     { background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8ada6a', borderRadius: 3, padding: '0.35rem 0.85rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
  applyBtn:    { background: '#2a3a1a', border: '1px solid #5a9a2a', color: '#aaea7a', borderRadius: 3, padding: '0.35rem 0.95rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 700 },
}
