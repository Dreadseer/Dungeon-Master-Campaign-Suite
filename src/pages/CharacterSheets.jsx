import { useState, useEffect, useCallback } from 'react'
import useCampaignStore from '../stores/campaignStore'
import EntityModal      from '../components/world/EntityModal'
import CharacterSheet   from '../components/character/CharacterSheet'
import { modStr } from '../utils/dnd5e'

const CLASSES = [
  'Barbarian','Bard','Cleric','Druid','Fighter',
  'Monk','Paladin','Ranger','Rogue','Sorcerer','Warlock','Wizard',
]

// ── Pre-population tables ─────────────────────────────────────────────────────

const RACIAL_TRAITS = {
  Elf: [
    { name: 'Darkvision',   description: 'You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
    { name: 'Fey Ancestry', description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep." },
    { name: 'Trance',       description: "Elves don't need to sleep. Instead, they meditate deeply for 4 hours a day." },
  ],
  Dwarf: [
    { name: 'Darkvision',         description: 'You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
    { name: 'Dwarven Resilience', description: 'You have advantage on saving throws against poison, and resistance against poison damage.' },
    { name: 'Stonecunning',       description: 'Whenever you make an Intelligence (History) check related to stonework, you are considered proficient in the History skill.' },
  ],
  Halfling: [
    { name: 'Lucky',      description: 'When you roll a 1 on the d20 for an attack roll, ability check, or saving throw, you can reroll and must use the new roll.' },
    { name: 'Brave',      description: 'You have advantage on saving throws against being frightened.' },
    { name: 'Nimbleness', description: 'You can move through the space of any creature that is of a size larger than yours.' },
  ],
  Tiefling: [
    { name: 'Darkvision',        description: 'You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
    { name: 'Hellish Resistance', description: 'You have resistance to fire damage.' },
    { name: 'Infernal Legacy',   description: 'You know the Thaumaturgy cantrip. At 3rd level, you can cast Hellish Rebuke once per day.' },
  ],
  Human:      [{ name: 'Extra Language', description: 'You can speak, read, and write one extra language of your choice.' }],
  Dragonborn: [
    { name: 'Breath Weapon',     description: 'You can use your action to exhale destructive energy. Your draconic ancestry determines size, shape, and damage type.' },
    { name: 'Damage Resistance', description: 'You have resistance to the damage type associated with your draconic ancestry.' },
  ],
  Gnome: [
    { name: 'Darkvision',    description: 'Accustomed to life underground, you can see in dim light within 60 feet as if it were bright light.' },
    { name: 'Gnome Cunning', description: 'You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic.' },
  ],
  'Half-Elf': [
    { name: 'Darkvision',        description: 'You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
    { name: 'Fey Ancestry',      description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep." },
    { name: 'Skill Versatility', description: 'You gain proficiency in two skills of your choice.' },
  ],
  'Half-Orc': [
    { name: 'Darkvision',         description: 'You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
    { name: 'Relentless Endurance', description: 'When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead. Once per long rest.' },
    { name: 'Savage Attacks',     description: 'When you score a critical hit with a melee weapon attack, you can roll one of the weapon\'s damage dice one additional time.' },
  ],
}

const CLASS_FEATURES_L1 = {
  Fighter: [
    { name: 'Fighting Style', level_gained: 1, description: 'You adopt a particular style of fighting as your specialty.' },
    { name: 'Second Wind',    level_gained: 1, description: 'As a bonus action, regain 1d10 + fighter level HP. Once per short or long rest.' },
  ],
  Rogue: [
    { name: 'Expertise',     level_gained: 1, description: 'Choose two skill proficiencies. Your proficiency bonus is doubled for those skills.' },
    { name: 'Sneak Attack',  level_gained: 1, description: 'Once per turn, deal extra 1d6 damage when you have advantage on the attack roll.' },
    { name: "Thieves' Cant", level_gained: 1, description: 'You know a secret mix of dialect and code used by thieves to hide messages in normal conversation.' },
  ],
  Wizard: [
    { name: 'Arcane Recovery', level_gained: 1, description: 'Once per day on a short rest, recover expended spell slots up to half your wizard level (rounded up).' },
    { name: 'Spellcasting',    level_gained: 1, description: 'As a student of arcane magic, you have a spellbook containing spells.' },
  ],
  Barbarian: [
    { name: 'Rage',              level_gained: 1, description: 'As a bonus action, enter a rage: advantage on STR checks/saves, +2 damage, resistance to bludgeoning/piercing/slashing.' },
    { name: 'Unarmored Defense', level_gained: 1, description: 'Without armor, AC = 10 + DEX modifier + CON modifier.' },
  ],
  Paladin: [
    { name: 'Divine Sense', level_gained: 1, description: 'Detect celestials, fiends, and undead within 60 feet as an action.' },
    { name: 'Lay on Hands', level_gained: 1, description: 'Pool of healing power equal to 5 × your paladin level, replenished on long rest.' },
  ],
  Ranger: [
    { name: 'Favored Enemy',    level_gained: 1, description: 'You have significant experience tracking a certain type of enemy.' },
    { name: 'Natural Explorer', level_gained: 1, description: 'You are adept at traveling and surviving in a particular natural environment.' },
  ],
  Cleric: [
    { name: 'Divine Domain', level_gained: 1, description: 'Choose a domain related to your deity, granting domain spells and features.' },
    { name: 'Spellcasting',  level_gained: 1, description: 'As a conduit for divine power, you can cast cleric spells.' },
  ],
  Druid: [
    { name: 'Druidic',    level_gained: 1, description: 'You know Druidic, the secret language of druids.' },
    { name: 'Spellcasting', level_gained: 1, description: 'Drawing on the divine essence of nature, you can cast spells.' },
  ],
  Bard: [
    { name: 'Bardic Inspiration', level_gained: 1, description: 'Bonus action: give one creature within 60 ft a Bardic Inspiration die (d6) to add to one ability check, attack, or save.' },
    { name: 'Spellcasting',       level_gained: 1, description: 'You have learned to reshape reality in harmony with your music.' },
  ],
  Monk: [
    { name: 'Unarmored Defense', level_gained: 1, description: 'Without armor or shield, AC = 10 + DEX modifier + WIS modifier.' },
    { name: 'Martial Arts',      level_gained: 1, description: 'You have mastery of combat styles using unarmed strikes and monk weapons.' },
  ],
  Sorcerer: [
    { name: 'Spellcasting',     level_gained: 1, description: 'An event in your past infused you with arcane magic.' },
    { name: 'Sorcerous Origin', level_gained: 1, description: 'Choose an origin describing the source of your innate magical power.' },
  ],
  Warlock: [
    { name: 'Otherworldly Patron', level_gained: 1, description: 'You have struck a bargain with an otherworldly being of your choice.' },
    { name: 'Pact Magic',          level_gained: 1, description: 'Your arcane research and patron have given you spells.' },
  ],
}

function findRaceTraits(raceName) {
  if (!raceName) return []
  // Exact match first
  if (RACIAL_TRAITS[raceName]) return RACIAL_TRAITS[raceName]
  // Partial match (e.g. "High Elf" → "Elf", "Hill Dwarf" → "Dwarf")
  const key = Object.keys(RACIAL_TRAITS).find(k =>
    raceName.toLowerCase().includes(k.toLowerCase())
  )
  return key ? RACIAL_TRAITS[key] : []
}

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
  const [fSpeed,       setFSpeed]       = useState(30)
  const [fStats,       setFStats]       = useState(defaultStats())
  const [fSubclass,    setFSubclass]    = useState('')
  const [fSaving,      setFSaving]      = useState(false)
  const [fError,       setFError]       = useState('')

  // ── Subclass picker (populated when class changes) ────────────────────────
  const [availableSubclasses, setAvailableSubclasses] = useState([])

  useEffect(() => {
    if (!fClass) { setAvailableSubclasses([]); setFSubclass(''); return }
    window.electronAPI.db.subclasses.getByClass(fClass)
      .then(subs => { setAvailableSubclasses(subs); setFSubclass('') })
      .catch(() => setAvailableSubclasses([]))
  }, [fClass])

  // Only show the subclass picker when the character level meets the unlock requirement
  const subMinUnlock = availableSubclasses.length > 0
    ? Math.min(...availableSubclasses.map(s => s.unlock_level))
    : 99
  const showSubclassPicker = availableSubclasses.length > 0 && parseInt(fLevel) >= subMinUnlock

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
    setFLevel(1); setFHpMax(''); setFSpeed(30); setFStats(defaultStats())
    setFSubclass(''); setAvailableSubclasses([]); setFError('')
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
      // Pre-populate features, extra_attacks, currency from known tables
      const initStats = {
        ...fStats,
        save_proficiencies:  [],
        skill_proficiencies: [],
        extra_attacks:       [],
        currency:            { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
        speed:               Number(fSpeed) || 30,
        features: {
          racial_traits:  findRaceTraits(fRace.trim()).map(t => ({ ...t, id: crypto.randomUUID() })),
          class_features: (CLASS_FEATURES_L1[fClass] ?? []).map(f => ({ ...f, id: crypto.randomUUID() })),
          background:     { personality_traits: '', ideals: '', bonds: '', flaws: '' },
          feats:          [],
        },
      }

      // Merge subclass features into class_features before saving
      if (fSubclass) {
        const sub = availableSubclasses.find(s => s.name === fSubclass)
        if (sub) {
          const subFeatures = JSON.parse(sub.features ?? '[]')
          const merged = [
            ...initStats.features.class_features,
            ...subFeatures.filter(f => f.level_gained <= Number(fLevel)),
          ].sort((a, b) => (a.level_gained ?? 0) - (b.level_gained ?? 0))
          initStats.features.class_features = merged
        }
      }

      const result = await window.electronAPI.db.characters.create({
        campaign_id:    activeCampaign.id,
        player_name:    fPlayer.trim(),
        character_name: fName.trim(),
        class:          fClass,
        race:           fRace.trim(),
        level:          Number(fLevel),
        stats:          initStats,
        hp_current:     maxHp,
        hp_max:         maxHp,
      })

      // Persist selected subclass name
      if (fSubclass && result?.lastInsertRowid) {
        await window.electronAPI.db.characters.setSubclass(result.lastInsertRowid, fSubclass)
      }

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
                      {[char.race, char.class, char.subclass_name].filter(Boolean).join(' · ') || '—'}
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

            {/* Subclass picker — only shown when class + level meet unlock requirement */}
            {showSubclassPicker && (
              <Field label={`Subclass (unlocks at Level ${subMinUnlock} for ${fClass})`}>
                <select style={s.input} value={fSubclass}
                  onChange={e => setFSubclass(e.target.value)}>
                  <option value="">— Choose a subclass (optional) —</option>
                  {availableSubclasses.map(sub => (
                    <option key={sub.id} value={sub.name}>{sub.name}</option>
                  ))}
                </select>
                <span style={{ color: '#6b5a3a', fontSize: '0.65rem', marginTop: 2 }}>
                  You can also choose your subclass later from the Features tab.
                </span>
              </Field>
            )}

            <div style={s.formRow2}>
              <Field label="Maximum HP">
                <input style={s.input} type="number" min="0" value={fHpMax}
                  onChange={e => setFHpMax(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Movement Speed (ft)">
                <>
                  <input style={s.input} type="number" min="5" max="120" step="5" value={fSpeed}
                    onChange={e => setFSpeed(e.target.value)} />
                  <span style={{ color: '#6b5a3a', fontSize: '0.65rem', marginTop: 2 }}>
                    Standard 30 ft — check your race.
                  </span>
                </>
              </Field>
            </div>

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
