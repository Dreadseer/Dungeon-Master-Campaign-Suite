import { useState, useEffect, useCallback } from 'react'
import {
  abilityMod, modStr, profBonus, savingThrow,
  passivePerception, SKILLS,
} from '../../utils/dnd5e'
import InventoryPanel        from './InventoryPanel'
import SpellSlotsPanel       from './SpellSlotsPanel'
import LevelUpModal          from './LevelUpModal'
import AICharacterAssistant  from './AICharacterAssistant'
import AttacksTab            from './AttacksTab'
import FeaturesTab           from './FeaturesTab'
import ACBreakdownPanel      from './ACBreakdownPanel'
import { calculateAC }       from '../../utils/acUtils'

const ABILITY_KEYS   = ['str','dex','con','int','wis','cha']
const ABILITY_LABELS = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' }
const ABILITY_SHORT  = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' }

const TABS = ['Stats','Attacks','Inventory','Spells','Features','Notes']

export default function CharacterSheet({ characterId, onBack }) {
  const [character, setCharacter] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('Stats')

  // HP control
  const [hpDelta,    setHpDelta]    = useState('')      // amount input
  const [hpMode,     setHpMode]     = useState(null)    // 'damage' | 'heal' | null
  const [hpSaving,   setHpSaving]   = useState(false)

  // Ability score inline editing
  const [editingAbility, setEditingAbility] = useState(null)  // key being edited
  const [editingValue,   setEditingValue]   = useState('')

  // Level up
  const [showLevelUp, setShowLevelUp] = useState(false)

  // Toast
  const [toast, setToast] = useState('')

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const char = await window.electronAPI.db.characters.getById(characterId)
      if (char) {
        // Parse JSON fields
        char._stats    = safeJson(char.stats,      { str:10,dex:10,con:10,int:10,wis:10,cha:10 })
        char._inventory= safeJson(char.inventory,   [])
        char._slots    = safeJson(char.spell_slots, {})
      }
      setCharacter(char)
    } catch { setCharacter(null) }
    setLoading(false)
  }, [characterId])

  useEffect(() => { load() }, [load])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  // ── HP Actions ──────────────────────────────────────────────────────────────
  async function applyHp() {
    const amt = parseInt(hpDelta, 10)
    if (!amt || isNaN(amt)) return
    const current = character.hp_current ?? 0
    const max     = character.hp_max     ?? 0
    let next = hpMode === 'damage' ? current - amt : current + amt
    next = Math.max(0, Math.min(max, next))
    setHpSaving(true)
    try {
      await window.electronAPI.db.characters.updateHP(characterId, next)
      setCharacter(prev => ({ ...prev, hp_current: next }))
    } catch { /* empty */ }
    setHpSaving(false)
    setHpMode(null)
    setHpDelta('')
  }

  async function fullRest() {
    await window.electronAPI.db.characters.longRest(characterId)
    await load()
    showToast('Long rest — HP and all spell slots restored.')
  }

  // ── Ability score editing ───────────────────────────────────────────────────
  function startEditAbility(key) {
    setEditingAbility(key)
    setEditingValue(String(character._stats[key] ?? 10))
  }

  async function commitAbility(key) {
    const val = parseInt(editingValue, 10)
    if (isNaN(val) || val < 1 || val > 30) { setEditingAbility(null); return }
    const newStats = { ...character._stats, [key]: val }
    setEditingAbility(null)
    try {
      await window.electronAPI.db.characters.updateStats(characterId, newStats)
      setCharacter(prev => ({ ...prev, _stats: newStats, stats: JSON.stringify(newStats) }))
    } catch { /* empty */ }
  }

  // ── Proficiency toggles ─────────────────────────────────────────────────────
  async function toggleSaveProficiency(key) {
    const prev = character._stats.save_proficiencies ?? []
    const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    const newStats = { ...character._stats, save_proficiencies: next }
    try {
      await window.electronAPI.db.characters.updateStats(characterId, newStats)
      setCharacter(ch => ({ ...ch, _stats: newStats, stats: JSON.stringify(newStats) }))
    } catch { /* empty */ }
  }

  async function toggleSkillProficiency(key) {
    const prev = character._stats.skill_proficiencies ?? []
    const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    const newStats = { ...character._stats, skill_proficiencies: next }
    try {
      await window.electronAPI.db.characters.updateStats(characterId, newStats)
      setCharacter(ch => ({ ...ch, _stats: newStats, stats: JSON.stringify(newStats) }))
    } catch { /* empty */ }
  }

  // ── Death saving throws ─────────────────────────────────────────────────────
  async function rollDeathSave() {
    const roll = Math.ceil(Math.random() * 20)
    const ds   = character._stats.death_saves ?? { successes: 0, failures: 0 }
    let { successes, failures } = ds
    if      (roll === 20) successes = Math.min(3, successes + 2)
    else if (roll === 1)  failures  = Math.min(3, failures  + 2)
    else if (roll >= 11)  successes = Math.min(3, successes + 1)
    else                  failures  = Math.min(3, failures  + 1)
    const newStats = { ...character._stats, death_saves: { successes, failures } }
    await window.electronAPI.db.characters.updateStats(characterId, newStats)
    setCharacter(c => ({ ...c, _stats: newStats, stats: JSON.stringify(newStats) }))
    showToast(`Death save — rolled ${roll}: ${roll >= 11 || roll === 20 ? '✓ Success' : '✗ Failure'}`)
  }

  async function clearDeathSaves() {
    const newStats = { ...character._stats, death_saves: { successes: 0, failures: 0 } }
    await window.electronAPI.db.characters.updateStats(characterId, newStats)
    setCharacter(c => ({ ...c, _stats: newStats, stats: JSON.stringify(newStats) }))
  }

  // ── Notes full update ────────────────────────────────────────────────────────
  async function saveNotes(notesText) {
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
        notes:          notesText,
      })
      setCharacter(c => ({ ...c, notes: notesText }))
    } catch { /* empty */ }
  }

  // ── Render guards ───────────────────────────────────────────────────────────
  if (loading) return (
    <div style={s.page}>
      <button style={s.backBtn} onClick={onBack}>← Characters</button>
      <p style={s.msg}>Loading…</p>
    </div>
  )

  if (!character) return (
    <div style={s.page}>
      <button style={s.backBtn} onClick={onBack}>← Characters</button>
      <p style={s.msg}>Character not found.</p>
    </div>
  )

  const stats  = character._stats
  const level  = character.level ?? 1
  const prof   = profBonus(level)
  const saves  = stats.save_proficiencies  ?? []
  const skills = stats.skill_proficiencies ?? []

  const hpCurrent = character.hp_current ?? 0
  const hpMax     = character.hp_max     ?? 0
  const hpPct     = hpMax ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100)) : 0
  const hpColor   = hpPct > 50 ? '#2D7A2D' : hpPct > 25 ? '#B8750A' : '#8B0000'

  const passPerc = passivePerception(stats.wis ?? 10, level, skills.includes('perception'))

  return (
    <div style={s.page}>
      {toast && <div style={s.toast}>{toast}</div>}

      {/* ── Back + header ── */}
      <div style={s.headerRow}>
        <button style={s.backBtn} onClick={onBack}>← Characters</button>
        <div style={s.headerInfo}>
          <h1 style={s.charName}>{character.character_name}</h1>
          <p style={s.charSub}>
            {[character.race, character.class, character.subclass_name].filter(Boolean).join(' · ')}
            {' — Level '}<strong style={{ color: '#c9a84c' }}>{level}</strong>
          </p>
        </div>
        <div style={s.headerStats}>
          <Stat label="Proficiency" value={`+${prof}`} />
          <Stat label="Passive Perc." value={passPerc} />
          {character.player_name && <Stat label="Player" value={character.player_name} />}
          {level < 20 && (
            <button style={s.levelUpBtn} onClick={() => setShowLevelUp(true)}>⬆ Level Up</button>
          )}
        </div>
      </div>

      {/* ── HP tracker ── */}
      <div style={s.hpBox}>
        <div style={s.hpMain}>
          <span style={{ ...s.hpDisplay, color: hpColor }}>
            {hpCurrent} <span style={{ color: '#6b5a3a', fontSize: '0.9rem' }}>/ {hpMax}</span>
          </span>
          <span style={s.hpLabel}>HP</span>
        </div>
        <div style={s.hpBar}>
          <div style={{ ...s.hpFill, width: `${hpPct}%`, background: hpColor }} />
        </div>
        <div style={s.hpControls}>
          {hpMode ? (
            <>
              <input
                style={s.hpInput}
                type="number" min="1" value={hpDelta}
                onChange={e => setHpDelta(e.target.value)}
                placeholder={hpMode === 'damage' ? 'Damage…' : 'Heal…'}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') applyHp(); if (e.key === 'Escape') setHpMode(null) }}
              />
              <button style={s.hpApplyBtn} onClick={applyHp} disabled={hpSaving}>
                Apply
              </button>
              <button style={s.hpCancelBtn} onClick={() => { setHpMode(null); setHpDelta('') }}>
                ✕
              </button>
            </>
          ) : (
            <>
              <button style={s.hpDmgBtn}  onClick={() => setHpMode('damage')}>Damage</button>
              <button style={s.hpHealBtn} onClick={() => setHpMode('heal')}>Heal</button>
              <button style={s.hpRestBtn} onClick={fullRest}>Full Rest</button>
            </>
          )}
        </div>
      </div>

      {/* ── Death saves (shown at 0 HP) ── */}
      {hpCurrent === 0 && (
        <DeathSavesPanel
          deathSaves={stats.death_saves ?? { successes: 0, failures: 0 }}
          onRoll={rollDeathSave}
          onClear={clearDeathSaves}
        />
      )}

      {/* ── Tab bar ── */}
      <div style={s.tabBar}>
        {TABS.map(t => (
          <button key={t}
            style={activeTab === t ? { ...s.tab, ...s.tabActive } : s.tab}
            onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={s.tabContent}>
        {activeTab === 'Stats'     && <StatsTab     stats={stats} level={level} saves={saves} skills={skills} onToggleSave={toggleSaveProficiency} onToggleSkill={toggleSkillProficiency} editingAbility={editingAbility} editingValue={editingValue} onStartEdit={startEditAbility} onEditChange={setEditingValue} onCommitEdit={commitAbility} character={character} onRefresh={load} />}
        {activeTab === 'Attacks'   && <AttacksTab   characterId={characterId} character={character} onRefresh={load} onGoToInventory={() => setActiveTab('Inventory')} />}
        {activeTab === 'Inventory' && <InventoryPanel  characterId={characterId} character={character} onRefresh={load} />}
        {activeTab === 'Spells'    && <SpellSlotsPanel characterId={characterId} character={character} onRefresh={load} />}
        {activeTab === 'Features'  && <FeaturesTab  characterId={characterId} character={character} onRefresh={load} />}
        {activeTab === 'Notes' && (
          <NotesTab notes={character.notes ?? ''} onSave={saveNotes} />
        )}
      </div>

      {/* ── AI Assistant (always visible, collapsible) ── */}
      <AICharacterAssistant
        character={character}
        characterId={characterId}
        onRefresh={load}
      />

      {/* ── Level Up Modal ── */}
      {showLevelUp && (
        <LevelUpModal
          character={character}
          onClose={() => setShowLevelUp(false)}
          onApply={() => { setShowLevelUp(false); load() }}
        />
      )}
    </div>
  )
}

// ── Stats Tab ─────────────────────────────────────────────────────────────────

function StatChip({ label, value, color, tooltip, badge }) {
  return (
    <div title={tooltip} style={{
      background: '#1a1208', border: `2px solid ${color}`,
      borderRadius: '8px', padding: '10px 16px',
      textAlign: 'center', minWidth: '120px',
      cursor: tooltip ? 'help' : 'default',
      flex: 1,
    }}>
      <div style={{ fontSize: '22px', fontWeight: 'bold', color, fontFamily: 'Georgia, serif', lineHeight: 1 }}>
        {value}
        {badge && <span style={{ fontSize: '14px', marginLeft: '4px' }}>{badge}</span>}
      </div>
      <div style={{ fontSize: '11px', color: '#6b6b6b', marginTop: '4px',
        textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    </div>
  )
}

function StatsTab({ stats, level, saves, skills, onToggleSave, onToggleSkill, editingAbility, editingValue, onStartEdit, onEditChange, onCommitEdit, character, onRefresh }) {
  const prof     = profBonus(level)
  const acResult = calculateAC(character)
  const [profLocked, setProfLocked] = useState(false)

  const guardedToggleSave  = (key) => { if (!profLocked) onToggleSave(key) }
  const guardedToggleSkill = (key) => { if (!profLocked) onToggleSkill(key) }

  return (
    <div style={s.statsLayout}>
      {/* Left column: ability scores */}
      <div style={s.statsLeft}>
        <p style={s.panelTitle}>Ability Scores</p>
        <div style={s.abilityGrid}>
          {ABILITY_KEYS.map(key => {
            const score = stats[key] ?? 10
            const isEditing = editingAbility === key
            return (
              <div key={key} style={s.abilityCard}>
                <span style={s.abilityCardLabel}>{ABILITY_SHORT[key]}</span>
                <span style={s.abilityCardMod}>{modStr(score)}</span>
                {isEditing ? (
                  <input
                    style={s.abilityInput}
                    type="number" min="1" max="30"
                    value={editingValue}
                    onChange={e => onEditChange(e.target.value)}
                    onBlur={() => onCommitEdit(key)}
                    onKeyDown={e => { if (e.key === 'Enter') onCommitEdit(key) }}
                    autoFocus
                  />
                ) : (
                  <button style={s.abilityScore} onClick={() => onStartEdit(key)} title="Click to edit">
                    {score}
                  </button>
                )}
                <span style={s.abilityName}>{ABILITY_LABELS[key]}</span>
              </div>
            )
          })}
        </div>

        {/* Stat chips — AC, Proficiency Bonus, Movement Speed, Passive Perception */}
        <div style={{ display: 'flex', gap: '1rem', margin: '1rem 0', flexWrap: 'wrap' }}>
          <StatChip
            label="Armor Class"
            value={acResult.ac}
            color="#C0392B"
            tooltip={acResult.breakdown}
            badge={acResult.has_shield ? '🛡' : undefined}
          />
          <StatChip label="Proficiency Bonus"  value={`+${prof}`}                                                                        color="#C9A84C" />
          <StatChip label="Movement Speed"     value={`${stats.speed ?? 30} ft`}                                                         color="#4A90D9" />
          <StatChip label="Passive Perception" value={String(passivePerception(stats.wis ?? 10, level, skills.includes('perception')))}  color="#9B59B6" />
        </div>

        {/* STR / stealth warnings from AC engine */}
        {acResult.warnings.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            {acResult.warnings.map((w, i) => (
              <div key={i} style={{
                background: '#2a0a00', border: '1px solid #BA7517', borderRadius: '4px',
                padding: '6px 12px', color: '#F5A623', fontSize: '13px', marginBottom: '4px',
              }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        )}
        {acResult.stealth_dis && (
          <div style={{ fontSize: '12px', color: '#8a8a8a', marginTop: '4px' }}>
            🔇 Stealth disadvantage from {acResult.wearing}
          </div>
        )}

        <ACBreakdownPanel character={character} onRefresh={onRefresh} />
      </div>

      {/* Right column: saving throws + skills */}
      <div style={s.statsRight}>
        {/* Saving Throws */}
        <div style={s.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ ...s.panelTitle, margin: 0 }}>Saving Throws</p>
            <button
              title={profLocked ? 'Proficiencies locked — click to unlock' : 'Lock proficiencies to prevent accidental changes'}
              style={{ ...s.lockBtn, color: profLocked ? '#c9a84c' : '#4a3a1a', border: `1px solid ${profLocked ? '#c9a84c' : '#3a2a10'}` }}
              onClick={() => setProfLocked(l => !l)}
            >
              {profLocked ? '🔒' : '🔓'}
            </button>
          </div>
          {ABILITY_KEYS.map(key => {
            const isProficient = saves.includes(key)
            const bonus = savingThrow(stats[key] ?? 10, level, isProficient)
            const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`
            return (
              <label key={key} style={{ ...s.checkRow, cursor: profLocked ? 'not-allowed' : 'pointer', opacity: profLocked ? 0.8 : 1 }}>
                <input type="checkbox" checked={isProficient}
                  onChange={() => guardedToggleSave(key)} style={s.checkbox} disabled={profLocked} />
                <span style={{ ...s.checkBonus, color: isProficient ? '#c9a84c' : '#a89060' }}>
                  {bonusStr}
                </span>
                <span style={s.checkLabel}>{ABILITY_LABELS[key]}</span>
              </label>
            )
          })}
        </div>

        {/* Skills */}
        <div style={s.panel}>
          <p style={s.panelTitle}>Skills {profLocked && <span style={{ fontSize: '0.7rem', color: '#c9a84c', marginLeft: 4 }}>🔒 Locked</span>}</p>
          <div style={s.skillsGrid}>
            {SKILLS.map(skill => {
              const isProficient = skills.includes(skill.key)
              const score = stats[skill.ability] ?? 10
              const bonus = savingThrow(score, level, isProficient)
              const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`
              return (
                <label key={skill.key} style={{ ...s.checkRow, cursor: profLocked ? 'not-allowed' : 'pointer', opacity: profLocked ? 0.8 : 1 }}>
                  <input type="checkbox" checked={isProficient}
                    onChange={() => guardedToggleSkill(skill.key)} style={s.checkbox} disabled={profLocked} />
                  <span style={{ ...s.checkBonus, color: isProficient ? '#c9a84c' : '#a89060' }}>
                    {bonusStr}
                  </span>
                  <span style={s.checkLabel}>
                    {skill.label}
                    <span style={s.abilityTag}> ({skill.ability.toUpperCase()})</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Placeholder tab ───────────────────────────────────────────────────────────

// ── Death Saves Panel ─────────────────────────────────────────────────────────

function DeathSavesPanel({ deathSaves, onRoll, onClear }) {
  const { successes = 0, failures = 0 } = deathSaves
  const stable = successes >= 3
  const dead   = failures  >= 3

  return (
    <div style={s.deathPanel}>
      {stable && <p style={s.stableBanner}>❤️ Stable — death saves cleared on next rest</p>}
      {dead   && <p style={s.deadBanner}>💀 Dead — 3 failures</p>}

      {!stable && !dead && (
        <div style={s.deathControls}>
          <div style={s.savePips}>
            <span style={{ color: '#8ada6a', fontSize: '0.72rem', marginRight: '0.3rem' }}>Success</span>
            {[0,1,2].map(i => (
              <span key={i} style={{ ...s.pip, background: i < successes ? '#2D7A2D' : '#0d0a05', border: `1px solid ${i < successes ? '#4a9a4a' : '#2a1c08'}` }} />
            ))}
          </div>
          <div style={s.savePips}>
            <span style={{ color: '#da7a7a', fontSize: '0.72rem', marginRight: '0.3rem' }}>Failure</span>
            {[0,1,2].map(i => (
              <span key={i} style={{ ...s.pip, background: i < failures ? '#8B0000' : '#0d0a05', border: `1px solid ${i < failures ? '#8B2020' : '#2a1c08'}` }} />
            ))}
          </div>
          <button style={s.rollSaveBtn} onClick={onRoll}>🎲 Roll Death Save</button>
        </div>
      )}

      <button style={s.clearSaveBtn} onClick={onClear}>Clear Death Saves</button>
    </div>
  )
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────

function NotesTab({ notes, onSave }) {
  const [value,    setValue]    = useState(notes)
  const [clearing, setClearing] = useState(false)

  // Sync from parent when character reloads
  useState(() => { setValue(notes) })

  return (
    <div style={s.notesTab}>
      <textarea
        style={s.notesArea}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={e => onSave(e.target.value)}
        placeholder="Character notes, backstory, session logs…"
        rows={12}
        spellCheck
      />
      <div style={s.notesFooter}>
        <span style={s.charCount}>{value.length} characters</span>
        {clearing ? (
          <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <span style={{ color: '#a89060', fontSize: '0.78rem' }}>Clear all notes?</span>
            <button style={s.notesYesBtn} onClick={() => { setValue(''); onSave(''); setClearing(false) }}>Yes</button>
            <button style={s.notesCancelBtn} onClick={() => setClearing(false)}>No</button>
          </span>
        ) : (
          <button style={s.notesClearBtn} onClick={() => setClearing(true)} disabled={!value}>
            Clear Notes
          </button>
        )}
      </div>
    </div>
  )
}

// ── Header stat chip ──────────────────────────────────────────────────────────

function Stat({ label, value }) {
  return (
    <div style={s.statChip}>
      <span style={s.statChipLabel}>{label}</span>
      <span style={s.statChipValue}>{value}</span>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJson(str, fallback) {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page: {
    display: 'flex', flexDirection: 'column',
    height: '100%', overflow: 'hidden', boxSizing: 'border-box',
  },

  toast: {
    position: 'fixed', top: '3.5rem', left: '50%', transform: 'translateX(-50%)',
    background: '#1a3a1a', border: '1px solid #3a6a3a', color: '#8ada8a',
    fontSize: '0.82rem', padding: '0.35rem 1rem', borderRadius: 4, zIndex: 2000,
  },

  // Header row
  headerRow: {
    display: 'flex', alignItems: 'center', gap: '1rem',
    padding: '0.6rem 1.5rem', background: '#0d0a05',
    borderBottom: '1px solid #2a1c08', flexShrink: 0,
  },
  backBtn:   { background: 'none', border: 'none', color: '#a89060', cursor: 'pointer', fontSize: '0.85rem', padding: '0.2rem 0.4rem', flexShrink: 0 },
  headerInfo:{ flex: 1, minWidth: 0 },
  charName:  { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.15rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  charSub:   { color: '#a89060', fontSize: '0.78rem', margin: '0.1rem 0 0' },
  headerStats:{ display: 'flex', gap: '0.75rem', flexShrink: 0 },
  statChip:  { display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#1a1208', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.2rem 0.55rem', minWidth: 55 },
  statChipLabel:{ color: '#6b5a3a', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  statChipValue:{ color: '#c9a84c', fontSize: '0.9rem', fontWeight: 700 },

  // HP tracker
  hpBox:     { flexShrink: 0, padding: '0.7rem 1.5rem', background: '#0a0805', borderBottom: '1px solid #2a1c08', display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  hpMain:    { display: 'flex', alignItems: 'baseline', gap: '0.4rem' },
  hpDisplay: { fontSize: '1.6rem', fontWeight: 700, fontFamily: 'Georgia, serif', lineHeight: 1 },
  hpLabel:   { color: '#6b5a3a', fontSize: '0.78rem', textTransform: 'uppercase' },
  hpBar:     { height: 8, background: '#1a1208', borderRadius: 4, overflow: 'hidden' },
  hpFill:    { height: '100%', borderRadius: 4, transition: 'width 0.3s ease, background 0.3s ease' },
  hpControls:{ display: 'flex', gap: '0.4rem', alignItems: 'center' },
  hpDmgBtn:  { background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#da7a7a', borderRadius: 3, padding: '0.28rem 0.65rem', cursor: 'pointer', fontSize: '0.8rem' },
  hpHealBtn: { background: '#0a2a0a', border: '1px solid #1a5a1a', color: '#7ada7a', borderRadius: 3, padding: '0.28rem 0.65rem', cursor: 'pointer', fontSize: '0.8rem' },
  hpRestBtn: { background: 'transparent', border: '1px solid #2a3a2a', color: '#6b8a6b', borderRadius: 3, padding: '0.28rem 0.65rem', cursor: 'pointer', fontSize: '0.8rem' },
  hpInput:   { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.28rem 0.5rem', fontSize: '0.83rem', outline: 'none', width: 100 },
  hpApplyBtn:{ background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.28rem 0.65rem', cursor: 'pointer', fontSize: '0.8rem' },
  hpCancelBtn:{ background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.9rem', padding: '0.1rem 0.3rem' },

  // Tabs
  tabBar:    { display: 'flex', gap: '0.25rem', padding: '0.4rem 1.5rem 0', background: '#0d0a05', borderBottom: '1px solid #2a1c08', flexShrink: 0 },
  tab:       { background: 'transparent', border: '1px solid transparent', borderRadius: '3px 3px 0 0', color: '#6b5a3a', padding: '0.3rem 0.9rem', cursor: 'pointer', fontSize: '0.83rem', fontFamily: 'Georgia, serif' },
  tabActive: { background: '#0a0805', border: '1px solid #2a1c08', borderBottom: '1px solid #0a0805', color: '#c9a84c' },
  tabContent:{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },

  // Stats tab layout
  statsLayout:{ display: 'flex', flex: 1, gap: '1rem', overflow: 'hidden', padding: '1rem 1.5rem' },
  statsLeft:  { width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' },
  statsRight: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', minWidth: 0 },

  // Ability cards
  abilityGrid:{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' },
  abilityCard:{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 6, padding: '0.5rem 0.3rem' },
  abilityCardLabel:{ color: '#c9a84c', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' },
  abilityCardMod:  { color: '#e8e0d0', fontSize: '1.1rem', fontWeight: 700, lineHeight: 1 },
  abilityScore:    { background: '#1a1208', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.15rem 0.5rem', cursor: 'pointer', fontSize: '0.83rem', lineHeight: 1 },
  abilityInput:    { background: '#0d0a05', border: '1px solid #c9a84c', borderRadius: 3, color: '#e8e0d0', padding: '0.15rem 0.3rem', fontSize: '0.83rem', outline: 'none', width: 50, textAlign: 'center' },
  abilityName:     { color: '#6b5a3a', fontSize: '0.6rem', textAlign: 'center', lineHeight: 1.2 },

  // Panel
  panel:     { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.6rem 0.75rem' },
  panelTitle:{ color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.82rem', fontWeight: 700, borderBottom: '1px solid #2a1c08', paddingBottom: '0.3rem', margin: '0 0 0.45rem' },

  // Checkboxes
  checkRow:  { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.18rem 0', cursor: 'pointer' },
  checkbox:  { accentColor: '#c9a84c', cursor: 'pointer', flexShrink: 0 },
  lockBtn:   { background: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', padding: '0.1rem 0.35rem', flexShrink: 0, lineHeight: 1.4 },
  checkBonus:{ fontSize: '0.78rem', fontWeight: 700, width: 28, textAlign: 'right', flexShrink: 0, fontFamily: 'Georgia, serif' },
  checkLabel:{ color: '#e8e0d0', fontSize: '0.8rem' },
  abilityTag:{ color: '#6b5a3a', fontSize: '0.68rem' },
  skillsGrid:{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.05rem 0.5rem' },

  // Placeholder
  msg: { color: '#6b5a3a', padding: '3rem', textAlign: 'center', fontSize: '0.9rem' },

  // Level Up button
  levelUpBtn: { background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8aba6a', borderRadius: 3, padding: '0.2rem 0.55rem', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, alignSelf: 'flex-end' },

  // Death saves panel
  deathPanel:    { flexShrink: 0, padding: '0.5rem 1.5rem', background: '#150808', borderBottom: '1px solid #3a1010', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  deathControls: { display: 'flex', alignItems: 'center', gap: '0.85rem', flex: 1 },
  savePips:      { display: 'flex', alignItems: 'center', gap: '0.3rem' },
  pip:           { width: 14, height: 14, borderRadius: 3, display: 'inline-block' },
  rollSaveBtn:   { background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#da9a9a', borderRadius: 3, padding: '0.25rem 0.65rem', cursor: 'pointer', fontSize: '0.78rem' },
  clearSaveBtn:  { background: 'transparent', border: 'none', color: '#5a3a3a', cursor: 'pointer', fontSize: '0.72rem', textDecoration: 'underline' },
  stableBanner:  { color: '#8ada8a', fontSize: '0.82rem', margin: 0, background: '#0a2a0a', border: '1px solid #1a5a1a', borderRadius: 3, padding: '0.2rem 0.6rem' },
  deadBanner:    { color: '#da7a7a', fontSize: '0.82rem', margin: 0, background: '#2a0a0a', border: '1px solid #5a1a1a', borderRadius: 3, padding: '0.2rem 0.6rem' },

  // Notes tab
  notesTab:     { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0.85rem 1.5rem', gap: '0.4rem' },
  notesArea:    { flex: 1, background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 4, color: '#c8c0b0', padding: '0.75rem', fontSize: '0.85rem', lineHeight: 1.6, resize: 'none', outline: 'none', fontFamily: 'inherit' },
  notesFooter:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  charCount:    { color: '#6b5a3a', fontSize: '0.72rem' },
  notesClearBtn:{ background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.2rem 0.55rem', cursor: 'pointer', fontSize: '0.75rem' },
  notesYesBtn:  { background: '#2a0a0a', border: '1px solid #5a1a1a', color: '#da7a7a', borderRadius: 3, padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' },
  notesCancelBtn:{ background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' },
}
