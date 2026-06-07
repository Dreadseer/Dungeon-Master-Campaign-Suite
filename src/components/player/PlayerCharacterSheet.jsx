import { useState, useEffect, useCallback, useRef } from 'react'
import {
  abilityMod, modStr, profBonus, savingThrow, skillBonus,
  passivePerception, SKILLS, getCasterType, spellcastingAbility,
  spellSaveDC, spellAttackBonus, SPELL_SLOTS,
} from '../../utils/dnd5e'

// ── Constants ─────────────────────────────────────────────────────────────────

const ABILITY_KEYS   = ['str','dex','con','int','wis','cha']
const ABILITY_LABELS = { str:'Strength', dex:'Dexterity', con:'Constitution', int:'Intelligence', wis:'Wisdom', cha:'Charisma' }
const ABILITY_SHORT  = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' }
const TABS           = ['Stats','Inventory','Spells','Notes']

const LEVEL_LABELS = ['Cantrip','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']
const LEVEL_COLORS = {
  0: '#5a5a5a', 1: '#1a4a8a', 2: '#1a4a8a',
  3: '#5a2a8a', 4: '#5a2a8a', 5: '#5a2a8a',
  6: '#8a6a1a', 7: '#8a6a1a', 8: '#8a6a1a', 9: '#8a6a1a',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJson(str, fallback) {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

function hpColor(pct) {
  if (pct > 50) return '#2D7A2D'
  if (pct > 25) return '#B8750A'
  return '#8B0000'
}

function baseAC(dex) { return 10 + Math.floor(((dex ?? 10) - 10) / 2) }

function fmtWeight(w) {
  const n = parseFloat(w)
  return isNaN(n) ? '—' : Number.isInteger(n) ? `${n}` : n.toFixed(1)
}

function totalWeight(inventory) {
  return inventory.reduce((sum, item) => sum + ((item.weight ?? 0) * (item.quantity ?? 1)), 0)
}

// ── Root component ────────────────────────────────────────────────────────────

export default function PlayerCharacterSheet({ characterId, broadcastMsg, onBack }) {
  const [character, setCharacter] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('Stats')

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const char = await window.electronAPI.db.characters.getById(characterId)
      if (char) {
        char._stats     = safeJson(char.stats,       { str:10,dex:10,con:10,int:10,wis:10,cha:10 })
        char._inventory = safeJson(char.inventory,    [])
        char._slots     = safeJson(char.spell_slots,  {})
      }
      setCharacter(char)
    } catch { setCharacter(null) }
    setLoading(false)
  }, [characterId])

  useEffect(() => { load() }, [load])

  // ── HP sync via broadcast ──────────────────────────────────────────────────
  useEffect(() => {
    if (!broadcastMsg) return
    if (
      broadcastMsg.type === 'character:sync' &&
      broadcastMsg.payload.characterId === character?.id
    ) {
      window.electronAPI.db.characters.getById(character.id).then(char => {
        if (char) {
          char._stats     = safeJson(char.stats,      { str:10,dex:10,con:10,int:10,wis:10,cha:10 })
          char._inventory = safeJson(char.inventory,   [])
          char._slots     = safeJson(char.spell_slots, {})
          setCharacter(char)
        }
      })
    }
  }, [broadcastMsg, character?.id])

  // ── Guards ─────────────────────────────────────────────────────────────────
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

  // ── Derived values ─────────────────────────────────────────────────────────
  const stats      = character._stats
  const level      = character.level      ?? 1
  const prof       = profBonus(level)
  const saves      = stats.save_proficiencies  ?? []
  const skillProfs = stats.skill_proficiencies ?? []

  const hpCurrent = character.hp_current ?? 0
  const hpMax     = character.hp_max     ?? 0
  const hpPct     = hpMax ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100)) : 0
  const hpFill    = hpColor(hpPct)
  const isUnconscious = hpCurrent === 0

  const passPerc  = passivePerception(stats.wis ?? 10, level, skillProfs.includes('perception'))
  const ac        = baseAC(stats.dex)

  const deathSaves = stats.death_saves ?? { successes: 0, failures: 0 }

  return (
    <div style={s.page}>

      {/* ── Sheet header ──────────────────────────────────────────────────── */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={onBack}>← Characters</button>

        <div style={s.headerCenter}>
          <h1 style={s.charName}>{character.character_name}</h1>
          <p style={s.charSub}>
            {[character.race, character.class].filter(Boolean).join(' · ')}
            {' · '}
            <span style={{ color: '#c9a84c', fontWeight: 700 }}>Level {level}</span>
          </p>
          {character.player_name && (
            <p style={s.playerLabel}>Player: {character.player_name}</p>
          )}
        </div>

        <div style={s.headerRight}>
          <div style={s.acBadge}>
            <span style={s.acValue}>{ac}</span>
            <span style={s.acLabel}>AC</span>
          </div>
          <div style={s.statChip}>
            <span style={s.chipLabel}>Prof</span>
            <span style={s.chipValue}>+{prof}</span>
          </div>
          <div style={s.statChip}>
            <span style={s.chipLabel}>Perc.</span>
            <span style={s.chipValue}>{passPerc}</span>
          </div>
        </div>
      </div>

      {/* ── HP display ────────────────────────────────────────────────────── */}
      <div style={s.hpBox}>
        {isUnconscious ? (
          <div style={s.unconsciousRow}>
            <span style={s.unconsciousText}>UNCONSCIOUS</span>
            <DeathSavesPips deathSaves={deathSaves} />
          </div>
        ) : (
          <div style={s.hpRow}>
            <span style={{ ...s.hpNumbers, color: hpFill }}>
              {hpCurrent}
              <span style={s.hpSep}> / </span>
              <span style={s.hpMax}>{hpMax}</span>
            </span>
            <span style={s.hpLabel}>HP</span>
          </div>
        )}
        <div style={s.hpTrack}>
          <div style={{ ...s.hpFill, width: `${hpPct}%`, background: hpFill }} />
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div style={s.tabBar}>
        {TABS.map(t => (
          <button key={t}
            style={activeTab === t ? { ...s.tab, ...s.tabActive } : s.tab}
            onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      <div style={s.tabBody}>
        {activeTab === 'Stats'     && <StatsTab     stats={stats} level={level} saves={saves} skillProfs={skillProfs} />}
        {activeTab === 'Inventory' && <InventoryTab inventory={character._inventory} stats={stats} />}
        {activeTab === 'Spells'    && <SpellsTab    character={character} />}
        {activeTab === 'Notes'     && <NotesTab     notes={character.notes ?? ''} />}
      </div>
    </div>
  )
}

// ── Death saves pips (read-only) ──────────────────────────────────────────────

function DeathSavesPips({ deathSaves }) {
  const { successes = 0, failures = 0 } = deathSaves
  const stable = successes >= 3
  const dead   = failures  >= 3

  if (stable) return <span style={{ color: '#8ada8a', fontSize: '0.9rem' }}>❤️ Stable</span>
  if (dead)   return <span style={{ color: '#da7a7a', fontSize: '0.9rem' }}>💀 Dead</span>

  return (
    <div style={s.deathPipsRow}>
      <span style={s.deathPipLabel}>Saves</span>
      {[0,1,2].map(i => (
        <span key={`s${i}`} style={{ ...s.deathPip, background: i < successes ? '#2D7A2D' : '#1a1208', borderColor: i < successes ? '#4a9a4a' : '#2a1c08' }} />
      ))}
      <span style={s.deathPipLabel}>Fails</span>
      {[0,1,2].map(i => (
        <span key={`f${i}`} style={{ ...s.deathPip, background: i < failures  ? '#8B0000' : '#1a1208', borderColor: i < failures  ? '#8B2020' : '#2a1c08' }} />
      ))}
    </div>
  )
}

// ── Dice Roll Hook ────────────────────────────────────────────────────────────

function useDiceRoll() {
  const [rollResult, setRollResult] = useState(null)   // { label, final, display }
  const [rolling,    setRolling]    = useState(false)
  const timerRef = useRef(null)

  function roll(label, modifier) {
    const d20    = Math.floor(Math.random() * 20) + 1
    const final  = d20 + modifier
    setRolling(true)
    setRollResult({ label, final, display: '?' })

    // Count-up animation: ~15 rapid steps over 500ms, then land on result
    let step = 0
    const STEPS = 12
    const INTERVAL = 40
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      step++
      if (step >= STEPS) {
        clearInterval(timerRef.current)
        setRolling(false)
        setRollResult({ label, final, display: String(final) })
      } else {
        const rand = Math.floor(Math.random() * 20) + 1 + modifier
        setRollResult(prev => ({ ...prev, display: String(rand) }))
      }
    }, INTERVAL)
  }

  useEffect(() => () => clearInterval(timerRef.current), [])

  return { rollResult, rolling, roll, clearRoll: () => setRollResult(null) }
}

// ── Stats Tab ─────────────────────────────────────────────────────────────────

function StatsTab({ stats, level, saves, skillProfs }) {
  const prof = profBonus(level)
  const { rollResult, rolling, roll, clearRoll } = useDiceRoll()

  const dexMod  = abilityMod(stats.dex ?? 10)
  const initMod = dexMod   // initiative = DEX modifier

  // Sort skills: proficient first, then alphabetical within each group
  const sortedSkills = [...SKILLS].sort((a, b) => {
    const aProf = skillProfs.includes(a.key) ? 0 : 1
    const bProf = skillProfs.includes(b.key) ? 0 : 1
    if (aProf !== bProf) return aProf - bProf
    return a.label.localeCompare(b.label)
  })

  return (
    <div style={s.statsLayout}>
      {/* Left: ability scores */}
      <div style={s.statsLeft}>
        {/* Dice roll result display */}
        {rollResult && (
          <div style={{ ...s.rollDisplay, opacity: rolling ? 0.75 : 1 }}>
            <span style={s.rollLabel}>{rollResult.label}</span>
            <span style={{ ...s.rollNumber, animation: rolling ? 'none' : undefined }}>
              {rollResult.display}
            </span>
            {!rolling && (
              <button style={s.rollDismiss} onClick={clearRoll}>✕</button>
            )}
          </div>
        )}

        {/* Roll Initiative button */}
        <button
          style={{ ...s.rollInitBtn, opacity: rolling ? 0.6 : 1 }}
          onClick={() => roll(`Initiative (d20 ${initMod >= 0 ? '+' : ''}${initMod} DEX)`, initMod)}
          disabled={rolling}
          title={`Roll d20 + DEX modifier (${initMod >= 0 ? '+' : ''}${initMod})`}
        >
          🎲 Roll Initiative
        </button>

        <p style={s.panelTitle}>Ability Scores</p>
        <div style={s.abilityGrid}>
          {ABILITY_KEYS.map(key => {
            const score  = stats[key] ?? 10
            const mod    = abilityMod(score)
            const modVal = mod >= 0 ? `+${mod}` : String(mod)
            return (
              <div
                key={key}
                style={{ ...s.abilityCard, cursor: 'pointer' }}
                title={`Roll ${ABILITY_SHORT[key]} check: d20 ${modVal}`}
                onClick={() => roll(`${ABILITY_LABELS[key]} Check (d20 ${modVal})`, mod)}
              >
                <span style={s.abilityShort}>{ABILITY_SHORT[key]}</span>
                <span style={s.abilityMod}>{modStr(score)}</span>
                <span style={s.abilityScore}>{score}</span>
                <span style={s.abilityName}>{ABILITY_LABELS[key]}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: saving throws + skills */}
      <div style={s.statsRight}>
        {/* Saving Throws */}
        <div style={s.panel}>
          <p style={s.panelTitle}>Saving Throws</p>
          {ABILITY_KEYS.map(key => {
            const isProficient = saves.includes(key)
            const bonus    = savingThrow(stats[key] ?? 10, level, isProficient)
            const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`
            return (
              <div key={key} style={s.checkRow}>
                <span style={{ ...s.profDot, background: isProficient ? '#c9a84c' : 'transparent', borderColor: isProficient ? '#c9a84c' : '#4a3a1a' }} />
                <span style={{ ...s.checkBonus, color: isProficient ? '#c9a84c' : '#a89060' }}>{bonusStr}</span>
                <span style={s.checkLabel}>{ABILITY_LABELS[key]}</span>
              </div>
            )
          })}
        </div>

        {/* Skills */}
        <div style={s.panel}>
          <p style={s.panelTitle}>Skills</p>
          <div style={s.skillsGrid}>
            {sortedSkills.map(skill => {
              const isProficient = skillProfs.includes(skill.key)
              const score    = stats[skill.ability] ?? 10
              const bonus    = skillBonus(score, level, isProficient)
              const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`
              return (
                <div key={skill.key} style={s.checkRow}>
                  <span style={{ ...s.profDot, background: isProficient ? '#c9a84c' : 'transparent', borderColor: isProficient ? '#c9a84c' : '#4a3a1a' }} />
                  <span style={{ ...s.checkBonus, color: isProficient ? '#c9a84c' : '#a89060' }}>{bonusStr}</span>
                  <span style={s.checkLabel}>
                    {skill.label}
                    <span style={s.abilityTag}> ({skill.ability.toUpperCase()})</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Inventory Tab ─────────────────────────────────────────────────────────────

function InventoryTab({ inventory, stats }) {
  const strScore  = stats?.str ?? 10
  const capacity  = strScore * 15
  const carried   = totalWeight(inventory)
  const overWeight = carried > capacity

  if (inventory.length === 0) {
    return (
      <div style={s.emptyState}>
        <p style={s.emptyText}>No items in inventory</p>
      </div>
    )
  }

  return (
    <div style={s.inventoryRoot}>
      {/* Weight summary */}
      <div style={s.weightRow}>
        <span style={{ color: overWeight ? '#da7a7a' : '#a89060', fontSize: '0.88rem' }}>
          ⚖ Carrying <strong style={{ color: overWeight ? '#da7a7a' : '#e8e0d0' }}>{fmtWeight(carried)}</strong>
          {' / '}{capacity} lbs capacity
          {overWeight && <span style={{ color: '#da7a7a', marginLeft: '0.5rem' }}>⚠ Over encumbered</span>}
        </span>
      </div>

      {/* Table */}
      <div style={s.tableWrapper}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: 32 }}>Eq</th>
              <th style={s.th}>Item</th>
              <th style={{ ...s.th, width: 50, textAlign: 'right' }}>Qty</th>
              <th style={{ ...s.th, width: 70, textAlign: 'right' }}>Weight</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item, i) => (
              <tr key={item.id ?? i} style={{ background: i % 2 === 0 ? '#0a0805' : 'transparent' }}>
                <td style={{ ...s.td, textAlign: 'center' }}>
                  {item.equipped ? '🛡️' : ''}
                </td>
                <td style={s.td}>
                  <span style={s.itemName}>{item.name}</span>
                  {item.description && (
                    <span style={s.itemDesc}> — {item.description}</span>
                  )}
                </td>
                <td style={{ ...s.td, textAlign: 'right', color: '#c9a84c' }}>
                  {item.quantity ?? 1}
                </td>
                <td style={{ ...s.td, textAlign: 'right', color: '#a89060' }}>
                  {item.weight ? `${fmtWeight(item.weight * (item.quantity ?? 1))} lbs` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Spells Tab ────────────────────────────────────────────────────────────────

function SpellsTab({ character }) {
  const stats      = character._stats  ?? {}
  const slots      = character._slots  ?? {}
  const level      = character.level   ?? 1
  const cls        = character.class   ?? ''

  const casterType   = getCasterType(cls)
  const castingAbil  = spellcastingAbility(cls)
  const castingScore = castingAbil ? (stats[castingAbil] ?? 10) : null
  const slotTable    = casterType ? (SPELL_SLOTS[casterType]?.[level] ?? []) : []
  const knownSpells  = slots.known_spells ?? []

  if (!casterType) {
    return (
      <div style={s.emptyState}>
        <p style={{ fontSize: '2rem', margin: 0 }}>🔮</p>
        <p style={s.emptyText}>No Spell Slots</p>
        <p style={{ color: '#6b5a3a', fontSize: '0.88rem', fontStyle: 'italic' }}>
          {cls ? `${cls} does not have spell slots.` : 'No spellcasting class assigned.'}
        </p>
      </div>
    )
  }

  return (
    <div style={s.spellsRoot}>
      {/* Left: slot tracker */}
      <div style={s.spellsLeft}>
        {/* Spellcasting stats */}
        {castingAbil && (
          <div style={s.castingBar}>
            <CastStat label="Ability"   value={castingAbil.toUpperCase()} />
            <CastStat label="Save DC"   value={spellSaveDC(castingScore, level)} />
            <CastStat label="Atk Bonus" value={`+${spellAttackBonus(castingScore, level)}`} />
          </div>
        )}

        {/* Slot pips — read-only */}
        <div style={s.slotPanel}>
          <p style={s.panelTitle}>Spell Slots</p>
          {slotTable.map((maxFromTable, idx) => {
            const lvl   = String(idx + 1)
            const slot  = slots[lvl] ?? { max: maxFromTable, used: 0 }
            const used  = slot.used ?? 0
            const max   = slot.max  ?? maxFromTable
            const avail = Math.max(0, max - used)
            return (
              <div key={lvl} style={s.slotRow}>
                <span style={s.slotLabel}>{LEVEL_LABELS[idx + 1]}</span>
                <div style={s.slotPips}>
                  {Array.from({ length: max }, (_, i) => (
                    <span key={i} style={{ ...s.slotPip, background: i < avail ? '#c9a84c' : '#1a1208', borderColor: i < avail ? '#a89060' : '#2a1c08' }} />
                  ))}
                </div>
                <span style={{ ...s.slotCount, color: avail > 0 ? '#c9a84c' : '#6b5a3a' }}>
                  {avail}/{max}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: known spells */}
      <div style={s.spellsRight}>
        <div style={s.spellPanel}>
          <p style={s.panelTitle}>Known Spells ({knownSpells.length})</p>
          {knownSpells.length === 0 ? (
            <p style={{ color: '#6b5a3a', fontSize: '0.88rem', fontStyle: 'italic' }}>No spells added yet.</p>
          ) : (
            knownSpells.map(spell => (
              <div key={spell.index ?? spell.name} style={s.spellRow}>
                <span style={{ ...s.levelDot, background: LEVEL_COLORS[spell.level ?? 0] }}>
                  {spell.level === 0 ? 'C' : spell.level}
                </span>
                <span style={s.spellName}>{spell.name}</span>
                {spell.school && <span style={s.spellSchool}>{spell.school}</span>}
              </div>
            ))
          )}
        </div>
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

// ── Notes Tab ─────────────────────────────────────────────────────────────────

function NotesTab({ notes }) {
  if (!notes?.trim()) {
    return (
      <div style={s.emptyState}>
        <p style={s.emptyText}>No notes for this character.</p>
      </div>
    )
  }

  return (
    <div style={s.notesRoot}>
      <div style={s.notesContent}>
        {notes.split('\n').map((line, i) => (
          line.trim()
            ? <p key={i} style={s.notesLine}>{line}</p>
            : <div key={i} style={{ height: '0.6rem' }} />
        ))}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
// All font sizes 10% larger than DM sheet, minimum 13px everywhere.

const BASE = 14.3   // px — DM sheet base ~13px → +10% = 14.3px
const px   = (n) => `${Math.max(13, n)}px`

const s = {
  // Layout
  page:    { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0d0a05' },
  msg:     { color: '#6b5a3a', padding: '3rem', textAlign: 'center', fontSize: px(BASE) },

  // Header
  header:       { display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1.5rem', background: '#0d0a05', borderBottom: '1px solid #2a1c08', flexShrink: 0, flexWrap: 'wrap' },
  backBtn:      { background: 'none', border: 'none', color: '#a89060', cursor: 'pointer', fontSize: px(BASE), padding: '0.25rem 0.5rem', flexShrink: 0 },
  headerCenter: { flex: 1, minWidth: 0 },
  charName:     { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: px(BASE * 1.4), fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  charSub:      { color: '#a89060', fontSize: px(BASE * 0.85), margin: '0.1rem 0 0' },
  playerLabel:  { color: '#6b5a3a', fontSize: px(BASE * 0.8), margin: '0.1rem 0 0' },
  headerRight:  { display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 },
  acBadge:      { display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0a0805', border: '2px solid #c9a84c', borderRadius: '50%', width: 54, height: 54, justifyContent: 'center', gap: 1 },
  acValue:      { color: '#c9a84c', fontSize: px(BASE * 1.35), fontWeight: 700, fontFamily: 'Georgia, serif', lineHeight: 1 },
  acLabel:      { color: '#6b5a3a', fontSize: px(BASE * 0.7), textTransform: 'uppercase', letterSpacing: '0.05em' },
  statChip:     { display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#1a1208', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.25rem 0.6rem', minWidth: 50 },
  chipLabel:    { color: '#6b5a3a', fontSize: px(BASE * 0.65), textTransform: 'uppercase', letterSpacing: '0.04em' },
  chipValue:    { color: '#c9a84c', fontSize: px(BASE * 1.05), fontWeight: 700 },

  // HP
  hpBox:          { flexShrink: 0, padding: '0.75rem 1.5rem', background: '#0a0805', borderBottom: '1px solid #2a1c08', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  hpRow:          { display: 'flex', alignItems: 'baseline', gap: '0.5rem' },
  hpNumbers:      { fontSize: px(BASE * 1.8), fontWeight: 700, fontFamily: 'Georgia, serif', lineHeight: 1 },
  hpSep:          { color: '#4a3a1a', fontSize: px(BASE * 1.2) },
  hpMax:          { color: '#6b5a3a', fontSize: px(BASE * 1.2) },
  hpLabel:        { color: '#6b5a3a', fontSize: px(BASE * 0.8), textTransform: 'uppercase' },
  hpTrack:        { height: 24, background: '#1a1208', borderRadius: 4, overflow: 'hidden', border: '1px solid #2a1c08' },
  hpFill:         { height: '100%', borderRadius: 4, transition: 'width 0.4s ease, background 0.4s ease' },
  unconsciousRow: { display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' },
  unconsciousText:{ color: '#e05050', fontSize: px(BASE * 1.5), fontWeight: 700, fontFamily: 'Georgia, serif', letterSpacing: '0.05em' },

  // Death save pips
  deathPipsRow: { display: 'flex', alignItems: 'center', gap: '0.35rem' },
  deathPipLabel:{ color: '#a89060', fontSize: px(BASE * 0.75), marginRight: 2 },
  deathPip:     { width: 13, height: 13, borderRadius: 3, display: 'inline-block', border: '1px solid' },

  // Tabs
  tabBar:    { display: 'flex', gap: '0.25rem', padding: '0.4rem 1.5rem 0', background: '#0d0a05', borderBottom: '1px solid #2a1c08', flexShrink: 0 },
  tab:       { background: 'transparent', border: '1px solid transparent', borderRadius: '3px 3px 0 0', color: '#6b5a3a', padding: '0 1rem', cursor: 'pointer', fontSize: px(BASE), fontFamily: 'Georgia, serif', minHeight: 44, display: 'flex', alignItems: 'center' },
  tabActive: { background: '#0a0805', border: '1px solid #2a1c08', borderBottom: '1px solid #0a0805', color: '#c9a84c' },
  tabBody:   { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },

  // Stats tab
  statsLayout: { display: 'flex', flex: 1, gap: '1rem', overflow: 'hidden', padding: '1rem 1.5rem' },
  statsLeft:   { width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' },
  statsRight:  { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', minWidth: 0 },

  // Ability cards (min 80×90px)
  abilityGrid:  { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' },
  abilityCard:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem', background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 6, padding: '0.6rem 0.3rem', minWidth: 80, minHeight: 90 },
  abilityShort: { color: '#c9a84c', fontSize: px(BASE * 0.75), fontWeight: 700, textTransform: 'uppercase' },
  abilityMod:   { color: '#e8e0d0', fontSize: px(BASE * 1.4), fontWeight: 700, lineHeight: 1, fontFamily: 'Georgia, serif' },
  abilityScore: { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 3, color: '#a89060', padding: '0.1rem 0.5rem', fontSize: px(BASE * 0.95), lineHeight: 1 },
  abilityName:  { color: '#6b5a3a', fontSize: px(BASE * 0.65), textAlign: 'center', lineHeight: 1.2 },
  abilityTag:   { color: '#6b5a3a', fontSize: px(BASE * 0.75) },

  // Panel
  panel:      { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.65rem 0.8rem' },
  panelTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: px(BASE * 0.9), fontWeight: 700, borderBottom: '1px solid #2a1c08', paddingBottom: '0.3rem', margin: '0 0 0.5rem' },

  // Check rows (saves + skills)
  checkRow:   { display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.2rem 0' },
  profDot:    { width: 11, height: 11, borderRadius: '50%', border: '1.5px solid', flexShrink: 0 },
  checkBonus: { fontSize: px(BASE * 0.9), fontWeight: 700, width: 28, textAlign: 'right', flexShrink: 0, fontFamily: 'Georgia, serif' },
  checkLabel: { color: '#e8e0d0', fontSize: px(BASE * 0.9) },
  skillsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.05rem 0.75rem' },

  // Inventory
  inventoryRoot: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0.85rem 1.5rem', gap: '0.5rem' },
  weightRow:     { flexShrink: 0 },
  tableWrapper:  { flex: 1, overflowY: 'auto' },
  table:         { width: '100%', borderCollapse: 'collapse', fontSize: px(BASE) },
  th:            { color: '#6b5a3a', fontSize: px(BASE * 0.8), textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.3rem 0.5rem', textAlign: 'left', borderBottom: '1px solid #2a1c08', background: '#0a0805', position: 'sticky', top: 0 },
  td:            { color: '#e8e0d0', padding: '0.35rem 0.5rem', borderBottom: '1px solid #0f0c06', verticalAlign: 'middle', fontSize: px(BASE) },
  itemName:      { color: '#e8e0d0', fontWeight: 500 },
  itemDesc:      { color: '#6b5a3a', fontSize: px(BASE * 0.85) },

  // Spells
  spellsRoot:  { display: 'flex', flex: 1, gap: '0.75rem', overflow: 'hidden', padding: '0.85rem 1.5rem' },
  spellsLeft:  { width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' },
  spellsRight: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden', minWidth: 0 },
  castingBar:  { display: 'flex', gap: '0.5rem' },
  castStat:    { flex: 1, background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.35rem 0.4rem', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  castStatLabel:{ color: '#6b5a3a', fontSize: px(BASE * 0.68), textTransform: 'uppercase', letterSpacing: '0.04em' },
  castStatValue:{ color: '#c9a84c', fontSize: px(BASE * 1.0), fontWeight: 700 },
  slotPanel:   { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.6rem 0.75rem' },
  slotRow:     { display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.28rem 0' },
  slotLabel:   { color: '#a89060', fontSize: px(BASE * 0.88), width: 30, flexShrink: 0 },
  slotPips:    { display: 'flex', gap: 3, flex: 1 },
  slotPip:     { width: 12, height: 12, borderRadius: 2, display: 'inline-block', border: '1px solid' },
  slotCount:   { fontSize: px(BASE * 0.82), fontFamily: 'Georgia, serif', width: 30, textAlign: 'right', flexShrink: 0 },
  spellPanel:  { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.6rem 0.75rem', flex: 1, overflowY: 'auto' },
  spellRow:    { display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.25rem 0', borderBottom: '1px solid #0f0c06' },
  levelDot:    { width: 20, height: 20, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: px(BASE * 0.73), fontWeight: 700, flexShrink: 0 },
  spellName:   { color: '#e8e0d0', fontSize: px(BASE), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  spellSchool: { color: '#6b5a3a', fontSize: px(BASE * 0.77), flexShrink: 0 },

  // Notes
  notesRoot:    { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '1rem 1.5rem' },
  notesContent: { flex: 1, overflowY: 'auto', background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.85rem 1rem' },
  notesLine:    { color: '#c8c0b0', fontSize: px(BASE), lineHeight: 1.65, margin: '0 0 0.1rem' },

  // Empty state
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.5rem', padding: '2rem' },
  emptyText:  { color: '#6b5a3a', fontSize: px(BASE), fontStyle: 'italic' },

  // Dice roll
  rollDisplay: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    background:     'rgba(201,168,76,0.12)',
    border:         '1px solid #c9a84c',
    borderRadius:   6,
    padding:        '0.4rem 0.75rem',
    marginBottom:   '0.4rem',
    gap:            '0.5rem',
  },
  rollLabel:   { color: '#a89060', fontSize: px(BASE * 0.82), flex: 1 },
  rollNumber:  { color: '#c9a84c', fontSize: px(BASE * 1.8), fontWeight: 700, fontFamily: 'Georgia, serif', minWidth: 40, textAlign: 'center', lineHeight: 1 },
  rollDismiss: { background: 'none', border: 'none', color: '#4a3a1a', cursor: 'pointer', fontSize: px(BASE * 0.9), padding: '0 0.2rem', lineHeight: 1 },
  rollInitBtn: {
    background:   '#1a2a1a',
    border:       '1px solid #3a5a3a',
    color:        '#8ada8a',
    borderRadius: 4,
    padding:      '0.4rem 0.8rem',
    cursor:       'pointer',
    fontSize:     px(BASE * 0.9),
    fontWeight:   700,
    marginBottom: '0.5rem',
    width:        '100%',
    transition:   'opacity 0.15s',
  },
}
