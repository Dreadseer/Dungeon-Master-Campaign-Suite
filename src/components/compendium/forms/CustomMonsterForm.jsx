import { useState } from 'react'

const SIZES      = ['Tiny','Small','Medium','Large','Huge','Gargantuan']
const ALIGNMENTS = [
  'Lawful Good','Neutral Good','Chaotic Good',
  'Lawful Neutral','True Neutral','Chaotic Neutral',
  'Lawful Evil','Neutral Evil','Chaotic Evil','Unaligned',
]
const CR_OPTIONS = [
  '0','1/8','1/4','1/2',
  '1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15','16','17','18','19','20',
  '21','22','23','24','25','26','27','28','29','30',
]
const CR_XP = {
  '0':10,'1/8':25,'1/4':50,'1/2':100,
  '1':200,'2':450,'3':700,'4':1100,'5':1800,
  '6':2300,'7':2900,'8':3900,'9':5000,'10':5900,
  '11':7200,'12':8400,'13':10000,'14':11500,'15':13000,
  '16':15000,'17':18000,'18':20000,'19':22000,'20':25000,
  '21':33000,'22':41000,'23':50000,'24':62000,'25':75000,
  '26':90000,'27':105000,'28':120000,'29':135000,'30':155000,
}
const ABILITY_KEYS   = ['str','dex','con','int','wis','cha']
const ABILITY_LABELS = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' }

function parse(entry) {
  if (!entry) return {}
  try { return JSON.parse(entry.data ?? '{}') } catch { return {} }
}

export default function CustomMonsterForm({ entry, onSave, onClose }) {
  const d = parse(entry)

  const [tab, setTab] = useState('identity')

  // Identity
  const [name,       setName]       = useState(entry?.name ?? '')
  const [size,       setSize]       = useState(d.size ?? 'Medium')
  const [type,       setType]       = useState(d.type ?? '')
  const [alignment,  setAlignment]  = useState(d.alignment ?? 'True Neutral')
  const [cr,         setCr]         = useState(d.cr ?? '1')
  const [xp,         setXp]         = useState(d.xp ?? CR_XP['1'])
  const [armorClass, setArmorClass] = useState(d.armor_class ?? '')
  const [hitPoints,  setHitPoints]  = useState(d.hit_points ?? '')
  const [hitDice,    setHitDice]    = useState(d.hit_dice ?? '')
  const [speedWalk,  setSpeedWalk]  = useState(d.speed_walk ?? '')

  // Stats — ability scores as strings (avoid NaN in controlled inputs)
  const [str, setStr] = useState(String(d.str ?? 10))
  const [dex, setDex] = useState(String(d.dex ?? 10))
  const [con, setCon] = useState(String(d.con ?? 10))
  const [int, setInt] = useState(String(d.int ?? 10))
  const [wis, setWis] = useState(String(d.wis ?? 10))
  const [cha, setCha] = useState(String(d.cha ?? 10))
  const abilitySetters = { str: setStr, dex: setDex, con: setCon, int: setInt, wis: setWis, cha: setCha }
  const abilityValues  = { str, dex, con, int, wis, cha }

  const [saveProficiencies,    setSaveProficiencies]    = useState(d.save_proficiencies ?? [])
  const [damageImmunities,     setDamageImmunities]     = useState(d.damage_immunities ?? '')
  const [damageResistances,    setDamageResistances]    = useState(d.damage_resistances ?? '')
  const [damageVulnerabilities,setDamageVulnerabilities]= useState(d.damage_vulnerabilities ?? '')
  const [conditionImmunities,  setConditionImmunities]  = useState(d.condition_immunities ?? '')
  const [senses,               setSenses]               = useState(d.senses ?? '')
  const [languages,            setLanguages]            = useState(d.languages ?? '')

  // Actions
  const [specialAbilities,     setSpecialAbilities]     = useState(d.special_abilities ?? [])
  const [actions,              setActions]              = useState(d.actions ?? [])
  const [legendaryActionsText, setLegendaryActionsText] = useState(d.legendary_actions_text ?? '')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function handleCrChange(val) {
    setCr(val)
    setXp(CR_XP[val] ?? 0)
  }

  function toggleSave(key) {
    setSaveProficiencies(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  // Special abilities helpers
  function addAbility()          { setSpecialAbilities(p => [...p, { name: '', description: '' }]) }
  function removeAbility(i)      { setSpecialAbilities(p => p.filter((_,j) => j !== i)) }
  function updAbility(i, k, val) {
    setSpecialAbilities(p => p.map((a, j) => j === i ? { ...a, [k]: val } : a))
  }

  // Action helpers
  function addAction()          { setActions(p => [...p, { name: '', attack_bonus: '', damage: '', description: '' }]) }
  function removeAction(i)      { setActions(p => p.filter((_,j) => j !== i)) }
  function updAction(i, k, val) {
    setActions(p => p.map((a, j) => j === i ? { ...a, [k]: val } : a))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); setTab('identity'); return }
    setSaving(true); setError('')
    try {
      await onSave({
        name: name.trim(),
        data: {
          size, type, alignment,
          cr, xp,
          armor_class:              armorClass !== '' ? Number(armorClass) : null,
          hit_points:               hitPoints  !== '' ? Number(hitPoints)  : null,
          hit_dice:                 hitDice,
          speed_walk:               speedWalk  !== '' ? Number(speedWalk)  : null,
          str: Number(str), dex: Number(dex), con: Number(con),
          int: Number(int), wis: Number(wis), cha: Number(cha),
          save_proficiencies:       saveProficiencies,
          damage_immunities:        damageImmunities,
          damage_resistances:       damageResistances,
          damage_vulnerabilities:   damageVulnerabilities,
          condition_immunities:     conditionImmunities,
          senses, languages,
          special_abilities:        specialAbilities.filter(a => a.name || a.description),
          actions:                  actions.filter(a => a.name || a.description),
          legendary_actions_text:   legendaryActionsText,
        },
      })
    } catch (err) {
      setError(err?.message ?? 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      {error && <p style={s.error}>{error}</p>}

      {/* Tab bar */}
      <div style={s.tabs}>
        {[['identity','Identity'],['stats','Stats'],['actions','Actions']].map(([key, lbl]) => (
          <button key={key} type="button"
            style={tab === key ? { ...s.tab, ...s.tabActive } : s.tab}
            onClick={() => setTab(key)}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── Identity ── */}
      {tab === 'identity' && (
        <div style={s.tabBody}>
          <Field label="Name *">
            <input style={s.input} value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Shadow Drake" autoFocus />
          </Field>
          <div style={s.row2}>
            <Field label="Size">
              <select style={s.input} value={size} onChange={e => setSize(e.target.value)}>
                {SIZES.map(sz => <option key={sz} value={sz}>{sz}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <input style={s.input} value={type} onChange={e => setType(e.target.value)}
                placeholder="Dragon, Undead, Humanoid…" />
            </Field>
          </div>
          <Field label="Alignment">
            <select style={s.input} value={alignment} onChange={e => setAlignment(e.target.value)}>
              {ALIGNMENTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <div style={s.row2}>
            <Field label="Challenge Rating">
              <select style={s.input} value={cr} onChange={e => handleCrChange(e.target.value)}>
                {CR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="XP (auto-calculated)">
              <input style={{ ...s.input, color: '#c9a84c', cursor: 'default' }}
                readOnly value={(xp ?? 0).toLocaleString()} />
            </Field>
          </div>
          <div style={s.row3}>
            <Field label="Armor Class">
              <input style={s.input} type="number" min="0" value={armorClass}
                onChange={e => setArmorClass(e.target.value)} placeholder="13" />
            </Field>
            <Field label="Hit Points">
              <input style={s.input} type="number" min="0" value={hitPoints}
                onChange={e => setHitPoints(e.target.value)} placeholder="45" />
            </Field>
            <Field label="Hit Dice">
              <input style={s.input} value={hitDice} onChange={e => setHitDice(e.target.value)}
                placeholder="6d8+12" />
            </Field>
          </div>
          <Field label="Speed (ft.)">
            <input style={s.input} type="number" min="0" step="5" value={speedWalk}
              onChange={e => setSpeedWalk(e.target.value)} placeholder="30" />
          </Field>
        </div>
      )}

      {/* ── Stats ── */}
      {tab === 'stats' && (
        <div style={s.tabBody}>
          {/* 6-column ability score grid */}
          <div style={s.abilityGrid}>
            {ABILITY_KEYS.map(key => (
              <div key={key} style={s.abilityCell}>
                <span style={s.abilityLabel}>{ABILITY_LABELS[key]}</span>
                <input
                  style={{ ...s.input, textAlign: 'center', padding: '0.25rem 0.2rem' }}
                  type="number" min="1" max="30"
                  value={abilityValues[key]}
                  onChange={e => abilitySetters[key](e.target.value)}
                />
                <label style={s.saveCheck} title="Saving throw proficiency">
                  <input type="checkbox"
                    checked={saveProficiencies.includes(key)}
                    onChange={() => toggleSave(key)} />
                  <span style={{ fontSize: '0.62rem', color: '#6b5a3a' }}>Save</span>
                </label>
              </div>
            ))}
          </div>

          <div style={s.row2}>
            <Field label="Damage Immunities">
              <input style={s.input} value={damageImmunities}
                onChange={e => setDamageImmunities(e.target.value)}
                placeholder="fire, poison" />
            </Field>
            <Field label="Damage Resistances">
              <input style={s.input} value={damageResistances}
                onChange={e => setDamageResistances(e.target.value)}
                placeholder="bludgeoning, piercing" />
            </Field>
          </div>
          <div style={s.row2}>
            <Field label="Damage Vulnerabilities">
              <input style={s.input} value={damageVulnerabilities}
                onChange={e => setDamageVulnerabilities(e.target.value)}
                placeholder="cold" />
            </Field>
            <Field label="Condition Immunities">
              <input style={s.input} value={conditionImmunities}
                onChange={e => setConditionImmunities(e.target.value)}
                placeholder="charmed, frightened" />
            </Field>
          </div>
          <div style={s.row2}>
            <Field label="Senses">
              <input style={s.input} value={senses}
                onChange={e => setSenses(e.target.value)}
                placeholder="darkvision 60 ft., passive Perception 12" />
            </Field>
            <Field label="Languages">
              <input style={s.input} value={languages}
                onChange={e => setLanguages(e.target.value)}
                placeholder="Common, Draconic" />
            </Field>
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      {tab === 'actions' && (
        <div style={s.tabBody}>
          {/* Special Abilities */}
          <div style={s.listSection}>
            <div style={s.listHeader}>
              <span style={s.listTitle}>Special Abilities</span>
              <button type="button" style={s.addBtn} onClick={addAbility}>＋ Add</button>
            </div>
            {specialAbilities.length === 0 && (
              <p style={s.listEmpty}>No special abilities yet.</p>
            )}
            {specialAbilities.map((ab, i) => (
              <div key={i} style={s.listItem}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <Field label="Name">
                      <input style={s.input} value={ab.name}
                        onChange={e => updAbility(i, 'name', e.target.value)}
                        placeholder="Breath Weapon, Pack Tactics…" />
                    </Field>
                  </div>
                  <button type="button" style={{ ...s.removeBtn, marginBottom: 1 }}
                    onClick={() => removeAbility(i)}>✕</button>
                </div>
                <Field label="Description">
                  <textarea style={{ ...s.input, ...s.taSmall }} value={ab.description}
                    onChange={e => updAbility(i, 'description', e.target.value)} />
                </Field>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={s.listSection}>
            <div style={s.listHeader}>
              <span style={s.listTitle}>Actions</span>
              <button type="button" style={s.addBtn} onClick={addAction}>＋ Add</button>
            </div>
            {actions.length === 0 && (
              <p style={s.listEmpty}>No actions yet.</p>
            )}
            {actions.map((ac, i) => (
              <div key={i} style={s.listItem}>
                <div style={s.row3}>
                  <Field label="Name">
                    <input style={s.input} value={ac.name}
                      onChange={e => updAction(i, 'name', e.target.value)}
                      placeholder="Claw Attack" />
                  </Field>
                  <Field label="Attack Bonus">
                    <input style={s.input} value={ac.attack_bonus}
                      onChange={e => updAction(i, 'attack_bonus', e.target.value)}
                      placeholder="+5" />
                  </Field>
                  <Field label="Damage">
                    <input style={s.input} value={ac.damage}
                      onChange={e => updAction(i, 'damage', e.target.value)}
                      placeholder="2d6+3 slashing" />
                  </Field>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <Field label="Description">
                      <textarea style={{ ...s.input, ...s.taSmall }} value={ac.description}
                        onChange={e => updAction(i, 'description', e.target.value)} />
                    </Field>
                  </div>
                  <button type="button" style={{ ...s.removeBtn, marginTop: '1.35rem' }}
                    onClick={() => removeAction(i)}>✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Legendary actions */}
          <Field label="Legendary Actions (narrative description)">
            <textarea style={{ ...s.input, ...s.textarea }} value={legendaryActionsText}
              onChange={e => setLegendaryActionsText(e.target.value)}
              placeholder="Can take 3 legendary actions, choosing from the options below…" />
          </Field>
        </div>
      )}

      <div style={s.btnRow}>
        <button type="button" style={s.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" style={s.saveBtn} disabled={saving}>
          {saving ? 'Saving…' : entry ? 'Save Changes' : 'Create Monster'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }) {
  return (
    <div style={s.field}>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  )
}

const s = {
  form:        { display: 'flex', flexDirection: 'column', gap: '0.55rem' },
  error:       { color: '#c04040', background: '#2a0a0a', border: '1px solid #5a1010', borderRadius: 3, padding: '0.35rem 0.6rem', fontSize: '0.78rem', margin: '0 0 0.2rem' },
  tabs:        { display: 'flex', gap: '0.3rem', borderBottom: '1px solid #2a1c08', paddingBottom: '0.4rem' },
  tab:         { background: 'transparent', border: '1px solid transparent', borderRadius: 3, color: '#6b5a3a', padding: '0.28rem 0.75rem', cursor: 'pointer', fontSize: '0.82rem' },
  tabActive:   { background: '#1a1208', border: '1px solid #3a2a10', color: '#c9a84c' },
  tabBody:     { display: 'flex', flexDirection: 'column', gap: '0.55rem' },
  field:       { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  label:       { color: '#a89060', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input:       { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.3rem 0.5rem', fontSize: '0.83rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea:    { resize: 'vertical', minHeight: 70 },
  taSmall:     { resize: 'vertical', minHeight: 44 },
  row2:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  row3:        { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' },
  abilityGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.35rem', margin: '0.1rem 0 0.45rem' },
  abilityCell: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.3rem 0.15rem' },
  abilityLabel:{ color: '#c9a84c', fontSize: '0.65rem', fontWeight: 700 },
  saveCheck:   { display: 'flex', alignItems: 'center', gap: '0.15rem', cursor: 'pointer' },
  listSection: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  listHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  listTitle:   { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.82rem', fontWeight: 700 },
  listEmpty:   { color: '#6b5a3a', fontSize: '0.75rem', fontStyle: 'italic', margin: '0.15rem 0' },
  listItem:    { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.45rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  addBtn:      { background: 'transparent', border: '1px solid #3a5a2a', color: '#6a9a5a', borderRadius: 3, padding: '0.18rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' },
  removeBtn:   { background: 'transparent', border: '1px solid #5a2010', color: '#a05040', borderRadius: 3, padding: '0.18rem 0.45rem', cursor: 'pointer', fontSize: '0.72rem', flexShrink: 0 },
  btnRow:      { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #2a1c08' },
  cancelBtn:   { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem' },
  saveBtn:     { background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
}
