import { useState, useEffect, useCallback } from 'react'
import useCampaignStore from '../stores/campaignStore'
import EntityModal      from '../components/world/EntityModal'
import CharacterSheet   from '../components/character/CharacterSheet'
import { modStr } from '../utils/dnd5e'

const CLASSES = [
  'Barbarian','Bard','Cleric','Druid','Fighter',
  'Monk','Paladin','Ranger','Rogue','Sorcerer','Warlock','Wizard',
]

const RACES = [
  'Human','Elf','High Elf','Wood Elf','Dwarf','Hill Dwarf','Mountain Dwarf',
  'Halfling','Lightfoot Halfling','Stout Halfling','Gnome','Rock Gnome',
  'Half-Elf','Half-Orc','Tiefling','Dragonborn','Aasimar','Tabaxi',
  'Firbolg','Goliath','Kenku','Lizardfolk','Triton','Yuan-Ti Pureblood',
]

const ABILITY_KEYS   = ['str','dex','con','int','wis','cha']
const ABILITY_LABELS = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' }

function defaultStats() {
  return { str:10, dex:10, con:10, int:10, wis:10, cha:10, save_proficiencies:[], skill_proficiencies:[] }
}

function hpBarColor(current, max) {
  if (!max) return '#2D7A2D'
  const pct = current / max
  if (pct > 0.5)  return '#2D7A2D'
  if (pct > 0.25) return '#B8750A'
  return '#8B0000'
}

export default function CharacterSheets() {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const [characters,     setCharacters]     = useState([])
  const [loading,        setLoading]        = useState(true)
  const [selectedCharId, setSelectedCharId] = useState(null)
  const [showCreate,     setShowCreate]     = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(null)

  // ── Create form state ──────────────────────────────────────────────────────
  const [fName,        setFName]        = useState('')
  const [fPlayer,      setFPlayer]      = useState('')
  const [fRace,        setFRace]        = useState('')
  const [fClass,       setFClass]       = useState('')
  const [fLevel,       setFLevel]       = useState(1)
  const [fHpMax,       setFHpMax]       = useState('')
  const [fStats,       setFStats]       = useState(defaultStats())
  const [fSaving,      setFSaving]      = useState(false)
  const [fError,       setFError]       = useState('')

  // ── Load characters ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!activeCampaign) return
    setLoading(true)
    try {
      const data = await window.electronAPI.db.characters.getAll(activeCampaign.id)
      setCharacters(data)
    } catch { setCharacters([]) }
    setLoading(false)
  }, [activeCampaign])

  useEffect(() => { load() }, [load])

  // ── If a character is open, show the full sheet ────────────────────────────
  if (selectedCharId) {
    return (
      <CharacterSheet
        characterId={selectedCharId}
        onBack={() => { setSelectedCharId(null); load() }}
      />
    )
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function resetCreateForm() {
    setFName(''); setFPlayer(''); setFRace(''); setFClass('')
    setFLevel(1); setFHpMax(''); setFStats(defaultStats()); setFError('')
  }

  function openCreate() { resetCreateForm(); setShowCreate(true) }
  function closeCreate() { setShowCreate(false); resetCreateForm() }

  function updStat(key, val) {
    setFStats(prev => ({ ...prev, [key]: val === '' ? '' : Number(val) }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!fName.trim()) { setFError('Character name is required.'); return }
    const maxHp = fHpMax !== '' ? Number(fHpMax) : 0
    setFSaving(true); setFError('')
    try {
      await window.electronAPI.db.characters.create({
        campaign_id:    activeCampaign.id,
        player_name:    fPlayer.trim(),
        character_name: fName.trim(),
        class:          fClass,
        race:           fRace.trim(),
        level:          Number(fLevel),
        stats:          { ...fStats, save_proficiencies: [], skill_proficiencies: [] },
        hp_current:     maxHp,
        hp_max:         maxHp,
      })
      closeCreate()
      await load()
    } catch (err) {
      setFError(err?.message ?? 'Create failed.')
    }
    setFSaving(false)
  }

  async function handleDelete(char) {
    await window.electronAPI.db.characters.delete(char.id)
    setConfirmDelete(null)
    await load()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>Character Sheets</h1>
        <button style={s.newBtn} onClick={openCreate}>＋ New Character</button>
      </div>

      {/* Character cards */}
      {loading ? (
        <p style={s.msg}>Loading characters…</p>
      ) : characters.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyIcon}>⚔</p>
          <p style={s.emptyTitle}>No Characters Yet</p>
          <p style={s.emptyText}>Create your first character to track stats, inventory, and spells.</p>
          <button style={s.emptyBtn} onClick={openCreate}>＋ New Character</button>
        </div>
      ) : (
        <div style={s.grid}>
          {characters.map(char => {
            let stats = {}
            try { stats = JSON.parse(char.stats ?? '{}') } catch { /* empty */ }
            const hpColor = hpBarColor(char.hp_current ?? 0, char.hp_max ?? 0)
            const hpPct   = char.hp_max ? Math.max(0, Math.min(100, ((char.hp_current ?? 0) / char.hp_max) * 100)) : 0
            return (
              <div key={char.id} style={s.card}>
                {/* Card header */}
                <div style={s.cardTop}>
                  <div style={s.levelBadge}>Lv {char.level ?? 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={s.charName}>{char.character_name}</p>
                    {char.player_name && <p style={s.playerName}>Player: {char.player_name}</p>}
                    <p style={s.classBio}>
                      {[char.race, char.class].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                </div>

                {/* HP bar */}
                <div style={s.hpSection}>
                  <div style={s.hpLabel}>
                    <span style={{ color: hpColor }}>
                      {char.hp_current ?? 0} / {char.hp_max ?? 0} HP
                    </span>
                  </div>
                  <div style={s.hpTrack}>
                    <div style={{ ...s.hpFill, width: `${hpPct}%`, background: hpColor }} />
                  </div>
                </div>

                {/* Ability score strip */}
                <div style={s.abilityStrip}>
                  {ABILITY_KEYS.map(key => (
                    <div key={key} style={s.abilityMini}>
                      <span style={s.abilityMiniLabel}>{ABILITY_LABELS[key]}</span>
                      <span style={s.abilityMiniMod}>{modStr(stats[key] ?? 10)}</span>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div style={s.cardActions}>
                  <button style={s.openBtn} onClick={() => setSelectedCharId(char.id)}>
                    Open Sheet
                  </button>
                  <button style={s.deleteCardBtn} title="Delete"
                    onClick={() => setConfirmDelete(char)}>🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Create modal ── */}
      {showCreate && (
        <EntityModal title="New Character" isOpen onClose={closeCreate}>
          <form onSubmit={handleCreate} style={s.form}>
            {fError && <p style={s.formError}>{fError}</p>}

            <div style={s.formRow2}>
              <Field label="Character Name *">
                <input style={s.input} value={fName} onChange={e => setFName(e.target.value)}
                  placeholder="Kaelthas Sunblade" autoFocus />
              </Field>
              <Field label="Player Name">
                <input style={s.input} value={fPlayer} onChange={e => setFPlayer(e.target.value)}
                  placeholder="Chris" />
              </Field>
            </div>

            <div style={s.formRow3}>
              <Field label="Class">
                <select style={s.input} value={fClass} onChange={e => setFClass(e.target.value)}>
                  <option value="">— Select —</option>
                  {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Race">
                <>
                  <input style={s.input} list="races-list" value={fRace}
                    onChange={e => setFRace(e.target.value)} placeholder="Elf, Human…" />
                  <datalist id="races-list">
                    {RACES.map(r => <option key={r} value={r} />)}
                  </datalist>
                </>
              </Field>
              <Field label="Level">
                <input style={s.input} type="number" min="1" max="20" value={fLevel}
                  onChange={e => setFLevel(e.target.value)} />
              </Field>
            </div>

            <Field label="Maximum HP">
              <input style={s.input} type="number" min="0" value={fHpMax}
                onChange={e => setFHpMax(e.target.value)} placeholder="0" />
            </Field>

            {/* Ability scores */}
            <p style={s.sectionLabel}>Ability Scores</p>
            <div style={s.abilityGrid}>
              {ABILITY_KEYS.map(key => (
                <div key={key} style={s.abilityCell}>
                  <span style={s.abilityCellLabel}>{ABILITY_LABELS[key]}</span>
                  <input
                    style={{ ...s.input, textAlign: 'center', padding: '0.25rem 0.2rem' }}
                    type="number" min="1" max="30"
                    value={fStats[key] ?? 10}
                    onChange={e => updStat(key, e.target.value)}
                  />
                  <span style={s.abilityCellMod}>{modStr(fStats[key] ?? 10)}</span>
                </div>
              ))}
            </div>

            <div style={s.formBtnRow}>
              <button type="button" style={s.cancelBtn} onClick={closeCreate} disabled={fSaving}>
                Cancel
              </button>
              <button type="submit" style={s.saveBtn} disabled={fSaving}>
                {fSaving ? 'Creating…' : 'Create Character'}
              </button>
            </div>
          </form>
        </EntityModal>
      )}

      {/* ── Delete confirmation ── */}
      {confirmDelete && (
        <EntityModal title="Delete Character" isOpen onClose={() => setConfirmDelete(null)}>
          <p style={s.confirmText}>
            Permanently delete <strong style={{ color: '#c9a84c' }}>{confirmDelete.character_name}</strong>?
            All stats, inventory, and spells will be lost.
          </p>
          <div style={s.confirmBtns}>
            <button style={s.cancelBtn} onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button style={s.deleteFinalBtn} onClick={() => handleDelete(confirmDelete)}>Delete</button>
          </div>
        </EntityModal>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <label style={{ color: '#a89060', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page:   { padding: '1.5rem 2rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' },
  title:  { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.4rem', margin: 0 },
  newBtn: { background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8aba6a', borderRadius: 4, padding: '0.4rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem' },

  grid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' },
  card:  { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 6, padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' },

  cardTop:    { display: 'flex', gap: '0.6rem', alignItems: 'flex-start' },
  levelBadge: { background: '#1a1208', border: '1px solid #3a2a10', color: '#c9a84c', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.45rem', borderRadius: 3, flexShrink: 0, marginTop: 2 },
  charName:   { color: '#e8e0d0', fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  playerName: { color: '#6b5a3a', fontSize: '0.72rem', margin: '0.1rem 0 0' },
  classBio:   { color: '#a89060', fontSize: '0.78rem', margin: '0.1rem 0 0' },

  hpSection: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  hpLabel:   { fontSize: '0.78rem', fontWeight: 600 },
  hpTrack:   { height: 6, background: '#1a1208', borderRadius: 3, overflow: 'hidden' },
  hpFill:    { height: '100%', borderRadius: 3, transition: 'width 0.3s ease, background 0.3s ease' },

  abilityStrip:     { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.2rem' },
  abilityMini:      { display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0a0805', borderRadius: 3, padding: '0.2rem' },
  abilityMiniLabel: { color: '#6b5a3a', fontSize: '0.58rem', textTransform: 'uppercase' },
  abilityMiniMod:   { color: '#c9a84c', fontSize: '0.75rem', fontWeight: 700 },

  cardActions:   { display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.1rem' },
  openBtn:       { flex: 1, background: '#1a1208', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.35rem 0.5rem', cursor: 'pointer', fontSize: '0.82rem' },
  deleteCardBtn: { background: 'none', border: 'none', color: '#6b3a3a', cursor: 'pointer', fontSize: '0.85rem', padding: '0.1rem 0.3rem', lineHeight: 1 },

  msg:       { color: '#6b5a3a', padding: '3rem', textAlign: 'center', fontSize: '0.9rem' },
  empty:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', gap: '0.6rem' },
  emptyIcon: { fontSize: '3rem', margin: 0 },
  emptyTitle:{ color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.2rem', margin: 0 },
  emptyText: { color: '#6b5a3a', fontSize: '0.88rem', margin: 0, textAlign: 'center', maxWidth: 360 },
  emptyBtn:  { marginTop: '0.5rem', background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8aba6a', borderRadius: 4, padding: '0.4rem 1rem', cursor: 'pointer', fontSize: '0.85rem' },

  // Form
  form:        { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  formError:   { color: '#c04040', background: '#2a0a0a', border: '1px solid #5a1010', borderRadius: 3, padding: '0.35rem 0.6rem', fontSize: '0.78rem' },
  formRow2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  formRow3:    { display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: '0.6rem' },
  sectionLabel:{ color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.82rem', borderBottom: '1px solid #2a1c08', paddingBottom: '0.2rem', margin: '0.2rem 0 0' },
  abilityGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.4rem' },
  abilityCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem', background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.3rem 0.2rem' },
  abilityCellLabel:{ color: '#c9a84c', fontSize: '0.65rem', fontWeight: 700 },
  abilityCellMod:  { color: '#a89060', fontSize: '0.72rem' },
  input:       { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.3rem 0.5rem', fontSize: '0.83rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  formBtnRow:  { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.4rem', paddingTop: '0.5rem', borderTop: '1px solid #2a1c08' },
  cancelBtn:   { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem' },
  saveBtn:     { background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },

  confirmText:    { color: '#e8e0d0', fontSize: '0.88rem', lineHeight: 1.5, margin: '0 0 1.25rem' },
  confirmBtns:    { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' },
  deleteFinalBtn: { background: '#3a0a0a', border: '1px solid #7a2a2a', color: '#da7a7a', borderRadius: 3, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
}
