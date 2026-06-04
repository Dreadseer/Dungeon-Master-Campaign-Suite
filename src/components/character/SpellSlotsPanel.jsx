import { useState, useEffect } from 'react'
import {
  getCasterType, spellcastingAbility, spellSaveDC,
  spellAttackBonus, SPELL_SLOTS, modStr,
} from '../../utils/dnd5e'

const LEVEL_LABELS = ['Cantrip','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']

const LEVEL_COLORS = {
  0: '#5a5a5a',
  1: '#1a4a8a', 2: '#1a4a8a',
  3: '#5a2a8a', 4: '#5a2a8a', 5: '#5a2a8a',
  6: '#8a6a1a', 7: '#8a6a1a', 8: '#8a6a1a', 9: '#8a6a1a',
}

export default function SpellSlotsPanel({ characterId, character, onRefresh }) {
  const slots    = character._slots ?? {}
  const level    = character.level ?? 1
  const stats    = character._stats ?? {}
  const cls      = character.class ?? ''

  const casterType   = getCasterType(cls)
  const castingAbil  = spellcastingAbility(cls)
  const castingScore = castingAbil ? (stats[castingAbil] ?? 10) : null
  const slotTable    = casterType ? (SPELL_SLOTS[casterType][level] ?? []) : []

  const [initializing, setInitializing] = useState(false)
  const [acting,       setActing]       = useState(null)   // slotLevel being used/restored
  const [resting,      setResting]      = useState(false)

  // Spell picker
  const [showPicker,   setShowPicker]   = useState(false)
  const [spellQuery,   setSpellQuery]   = useState('')
  const [allSpells,    setAllSpells]    = useState([])
  const [spellsLoaded, setSpellsLoaded] = useState(false)
  const [adding,       setAdding]       = useState(false)

  // Known spells
  const knownSpells = slots.known_spells ?? []

  // ── Check if slots need initialization ────────────────────────────────────
  const slotsInitialized = casterType && slotTable.length > 0
    ? slotTable.every((_, idx) => slots[String(idx + 1)] !== undefined)
    : true

  async function initializeSlots() {
    if (!casterType || slotTable.length === 0) return
    setInitializing(true)
    const newSlots = { ...slots, known_spells: slots.known_spells ?? [] }
    slotTable.forEach((max, idx) => {
      const lvl = String(idx + 1)
      if (!newSlots[lvl]) newSlots[lvl] = { max, used: 0 }
    })
    await window.electronAPI.db.characters.update(characterId, {
      player_name:    character.player_name ?? '',
      character_name: character.character_name,
      class:          character.class,
      race:           character.race,
      level:          character.level,
      stats:          character._stats,
      hp_current:     character.hp_current,
      hp_max:         character.hp_max,
      inventory:      character._inventory,
      spell_slots:    newSlots,
      notes:          character.notes ?? '',
    })
    setInitializing(false)
    onRefresh()
  }

  // Auto-initialize on mount for casters that haven't set up slots yet
  useEffect(() => {
    if (casterType && !slotsInitialized && !initializing) {
      initializeSlots()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, casterType])

  // ── Slot use / restore ────────────────────────────────────────────────────
  async function useSlot(lvl) {
    setActing(lvl)
    await window.electronAPI.db.characters.useSlot(characterId, lvl)
    setActing(null)
    onRefresh()
  }

  async function restoreSlot(lvl) {
    setActing(lvl)
    await window.electronAPI.db.characters.restoreSlot(characterId, lvl)
    setActing(null)
    onRefresh()
  }

  async function longRest() {
    setResting(true)
    await window.electronAPI.db.characters.longRest(characterId)
    setResting(false)
    onRefresh()
  }

  // ── Spell picker ──────────────────────────────────────────────────────────
  async function openPicker() {
    setShowPicker(true)
    if (!spellsLoaded) {
      const data = await window.electronAPI.srd.getSpells({}).catch(() => [])
      setAllSpells(data)
      setSpellsLoaded(true)
    }
  }

  async function addSpell(spell) {
    setAdding(true)
    await window.electronAPI.db.characters.addKnownSpell(characterId, {
      name:   spell.name,
      index:  spell.index,
      level:  spell.level,
      school: spell.school,
      source: 'srd',
    })
    setAdding(false)
    onRefresh()
  }

  async function removeSpell(spellIndex) {
    await window.electronAPI.db.characters.removeKnownSpell(characterId, spellIndex)
    onRefresh()
  }

  const knownSet = new Set(knownSpells.map(s => s.index))
  const filteredSpells = spellQuery.trim()
    ? allSpells.filter(s => s.name.toLowerCase().includes(spellQuery.toLowerCase()))
    : allSpells.slice(0, 60)

  // ── Non-caster ────────────────────────────────────────────────────────────
  if (!casterType) {
    return (
      <div style={s.root}>
        <div style={s.noCaster}>
          <p style={{ fontSize: '2rem', margin: 0 }}>🔮</p>
          <p style={{ color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1rem', margin: 0 }}>No Spell Slots</p>
          <p style={{ color: '#6b5a3a', fontSize: '0.85rem', fontStyle: 'italic', margin: 0 }}>
            {cls ? `${cls} does not have spell slots.` : 'Assign a spellcasting class to enable spell tracking.'}
          </p>
        </div>
      </div>
    )
  }

  if (initializing) {
    return (
      <div style={s.root}>
        <p style={{ color: '#6b5a3a', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' }}>
          Initializing spell slots…
        </p>
      </div>
    )
  }

  return (
    <div style={s.root}>
      {/* Left column */}
      <div style={s.leftCol}>
        {/* Spellcasting stats */}
        {castingAbil && (
          <div style={s.castingBar}>
            <CastStat label="Ability"    value={castingAbil.toUpperCase()} />
            <CastStat label="Save DC"    value={spellSaveDC(castingScore, level)} />
            <CastStat label="Atk Bonus"  value={`+${spellAttackBonus(castingScore, level)}`} />
          </div>
        )}

        {/* Long rest button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
          <button style={s.restBtn} onClick={longRest} disabled={resting}>
            {resting ? 'Resting…' : '🌙 Long Rest'}
          </button>
        </div>

        {/* Slot tracker rows */}
        <div style={s.slotPanel}>
          <p style={s.panelTitle}>Spell Slots</p>
          {slotTable.map((maxFromTable, idx) => {
            const lvl  = String(idx + 1)
            const slot = slots[lvl] ?? { max: maxFromTable, used: 0 }
            const used = slot.used ?? 0
            const max  = slot.max  ?? maxFromTable
            const avail= Math.max(0, max - used)
            const busy = acting === lvl
            return (
              <div key={lvl} style={s.slotRow}>
                <span style={s.slotLabel}>{LEVEL_LABELS[idx + 1]}</span>
                <div style={s.pips}>
                  {Array.from({ length: max }, (_, i) => (
                    <span key={i} style={{ ...s.pip, background: i < avail ? '#c9a84c' : '#1a1208', border: `1px solid ${i < avail ? '#a89060' : '#2a1c08'}` }} />
                  ))}
                </div>
                <span style={{ ...s.slotCount, color: avail > 0 ? '#c9a84c' : '#6b5a3a' }}>
                  {avail}/{max}
                </span>
                <button style={s.slotBtn} onClick={() => useSlot(lvl)} disabled={busy || avail === 0}
                  title="Use slot">−</button>
                <button style={s.slotBtn} onClick={() => restoreSlot(lvl)} disabled={busy || used === 0}
                  title="Restore slot">＋</button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right column: known spells */}
      <div style={s.rightCol}>
        <div style={s.spellPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <p style={s.panelTitle}>Known Spells ({knownSpells.length})</p>
            <button style={s.addSpellBtn} onClick={openPicker}>＋ Add Spell</button>
          </div>

          {knownSpells.length === 0 ? (
            <p style={s.emptySpells}>No spells added yet. Click "+ Add Spell" to add from the SRD.</p>
          ) : (
            knownSpells.map(spell => (
              <div key={spell.index} style={s.spellRow}>
                <span style={{ ...s.levelDot, background: LEVEL_COLORS[spell.level ?? 0] }}>
                  {spell.level === 0 ? 'C' : spell.level}
                </span>
                <span style={s.spellName}>{spell.name}</span>
                {spell.school && <span style={s.spellSchool}>{spell.school}</span>}
                <button style={s.removeSpellBtn} onClick={() => removeSpell(spell.index)} title="Remove">✕</button>
              </div>
            ))
          )}
        </div>

        {/* Spell picker dropdown */}
        {showPicker && (
          <div style={s.spellPicker}>
            <div style={{ display: 'flex', gap: '0.4rem', padding: '0.4rem 0.5rem', borderBottom: '1px solid #2a1c08', flexShrink: 0 }}>
              <input style={s.spellSearch} placeholder="Search spells…" value={spellQuery}
                onChange={e => setSpellQuery(e.target.value)} autoFocus />
              <button style={s.pickerClose} onClick={() => { setShowPicker(false); setSpellQuery('') }}>✕</button>
            </div>
            <div style={s.spellPickerList}>
              {!spellsLoaded ? (
                <p style={s.spellPickerMsg}>Loading…</p>
              ) : filteredSpells.length === 0 ? (
                <p style={s.spellPickerMsg}>No spells found.</p>
              ) : (
                filteredSpells.map(spell => {
                  const already = knownSet.has(spell.index)
                  return (
                    <div key={spell.index} style={s.spellPickRow}>
                      <span style={{ ...s.levelDot, background: LEVEL_COLORS[spell.level ?? 0] }}>
                        {spell.level === 0 ? 'C' : spell.level}
                      </span>
                      <span style={{ ...s.spellName, flex: 1 }}>{spell.name}</span>
                      <button
                        style={{ ...s.addSpellRowBtn, opacity: already ? 0.4 : 1, cursor: already ? 'default' : 'pointer' }}
                        disabled={already || adding}
                        onClick={() => !already && addSpell(spell)}
                      >
                        {already ? '✓' : '＋'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CastStat({ label, value }) {
  return (
    <div style={s.castStat}>
      <span style={s.castStatLabel}>{label}</span>
      <span style={s.castStatValue}>{value}</span>
    </div>
  )
}

const s = {
  root:    { display: 'flex', flex: 1, gap: '0.75rem', overflow: 'hidden', padding: '0.85rem 1.5rem' },
  noCaster:{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.5rem', padding: '2rem' },

  leftCol:  { width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' },
  rightCol: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden', minWidth: 0 },

  castingBar: { display: 'flex', gap: '0.5rem', marginBottom: '0.15rem' },
  castStat:   { flex: 1, background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.3rem 0.4rem', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  castStatLabel:{ color: '#6b5a3a', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  castStatValue:{ color: '#c9a84c', fontSize: '0.88rem', fontWeight: 700 },

  restBtn: { background: '#0a1a2a', border: '1px solid #1a3a5a', color: '#6aaada', borderRadius: 3, padding: '0.25rem 0.65rem', cursor: 'pointer', fontSize: '0.78rem' },

  slotPanel: { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.55rem 0.7rem' },
  panelTitle:{ color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.82rem', fontWeight: 700, borderBottom: '1px solid #2a1c08', paddingBottom: '0.25rem', margin: '0 0 0.4rem' },

  slotRow:   { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0' },
  slotLabel: { color: '#a89060', fontSize: '0.78rem', width: 30, flexShrink: 0 },
  pips:      { display: 'flex', gap: 3, flex: 1 },
  pip:       { width: 10, height: 10, borderRadius: 2, display: 'inline-block' },
  slotCount: { fontSize: '0.72rem', fontFamily: 'Georgia, serif', width: 28, textAlign: 'right', flexShrink: 0 },
  slotBtn:   { background: '#1a1208', border: '1px solid #2a1c08', color: '#a89060', borderRadius: 2, width: 22, height: 22, cursor: 'pointer', fontSize: '0.82rem', padding: 0, lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },

  spellPanel:     { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.55rem 0.7rem', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 },
  addSpellBtn:    { background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8aba6a', borderRadius: 3, padding: '0.2rem 0.55rem', cursor: 'pointer', fontSize: '0.72rem', flexShrink: 0 },
  emptySpells:    { color: '#6b5a3a', fontSize: '0.8rem', fontStyle: 'italic', margin: '0.5rem 0' },
  spellRow:       { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.22rem 0', borderBottom: '1px solid #0f0c06' },
  levelDot:       { width: 18, height: 18, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 },
  spellName:      { color: '#e8e0d0', fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  spellSchool:    { color: '#6b5a3a', fontSize: '0.68rem', flexShrink: 0, marginLeft: 'auto', paddingRight: '0.3rem' },
  removeSpellBtn: { background: 'none', border: 'none', color: '#5a2a2a', cursor: 'pointer', fontSize: '0.72rem', padding: 0, lineHeight: 1, flexShrink: 0, marginLeft: 'auto' },

  spellPicker:     { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, display: 'flex', flexDirection: 'column', maxHeight: 320, flexShrink: 0 },
  spellSearch:     { flex: 1, background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 3, color: '#e8e0d0', padding: '0.28rem 0.5rem', fontSize: '0.8rem', outline: 'none' },
  pickerClose:     { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.85rem', padding: 0, flexShrink: 0 },
  spellPickerList: { overflowY: 'auto', flex: 1 },
  spellPickerMsg:  { color: '#6b5a3a', padding: '0.75rem', textAlign: 'center', fontSize: '0.8rem' },
  spellPickRow:    { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.25rem 0.5rem', borderBottom: '1px solid #0f0c06' },
  addSpellRowBtn:  { background: '#1a2a10', border: '1px solid #2a4a18', color: '#8aba6a', borderRadius: 2, width: 22, height: 22, cursor: 'pointer', fontSize: '0.82rem', padding: 0, lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
}
