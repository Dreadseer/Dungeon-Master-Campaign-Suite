import { useState } from 'react'

const CATEGORIES = [
  'Adventuring Gear','Armor','Weapon','Tool',
  'Mount','Vehicle','Trade Good','Treasure','Other',
]

export default function CustomEquipmentForm({ entry, onSave, onClose }) {
  const d = entry
    ? (() => { try { return JSON.parse(entry.data ?? '{}') } catch { return {} } })()
    : {}

  const [name,               setName]               = useState(entry?.name ?? '')
  const [category,           setCategory]           = useState(d.category ?? '')
  const [cost,               setCost]               = useState(d.cost ?? '')
  const [weight,             setWeight]             = useState(d.weight ?? '')
  const [description,        setDescription]        = useState(d.description ?? '')
  // Weapon-specific
  const [weaponDamage,       setWeaponDamage]       = useState(d.weapon_damage ?? '')
  const [weaponType,         setWeaponType]         = useState(d.weapon_type ?? '')
  const [weaponProperties,   setWeaponProperties]   = useState(d.weapon_properties ?? '')
  // Armor-specific
  const [armorBaseAc,        setArmorBaseAc]        = useState(d.armor_base_ac ?? '')
  const [armorDexCap,        setArmorDexCap]        = useState(d.armor_dex_cap ?? '')
  const [armorMinStr,        setArmorMinStr]        = useState(d.armor_min_str ?? '')
  const [armorStealthDisadv, setArmorStealthDisadv] = useState(d.armor_stealth_disadvantage ?? false)

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const isWeapon = category === 'Weapon'
  const isArmor  = category === 'Armor'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      await onSave({
        name: name.trim(),
        data: {
          category,
          cost,
          weight:                    weight !== '' ? Number(weight) : null,
          description,
          weapon_damage:             weaponDamage,
          weapon_type:               weaponType,
          weapon_properties:         weaponProperties,
          armor_base_ac:             armorBaseAc !== '' ? Number(armorBaseAc) : null,
          armor_dex_cap:             armorDexCap !== '' ? Number(armorDexCap) : null,
          armor_min_str:             armorMinStr !== '' ? Number(armorMinStr) : null,
          armor_stealth_disadvantage: armorStealthDisadv,
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

      <Field label="Name *">
        <input style={s.input} value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Runeblade" autoFocus />
      </Field>

      <div style={s.row2}>
        <Field label="Category">
          <select style={s.input} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">— Select —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Weight (lb)">
          <input style={s.input} type="number" min="0" step="0.1" value={weight}
            onChange={e => setWeight(e.target.value)} placeholder="0" />
        </Field>
      </div>

      <Field label="Cost (e.g. 25 gp)">
        <input style={s.input} value={cost} onChange={e => setCost(e.target.value)}
          placeholder="25 gp" />
      </Field>

      {/* Weapon-specific fields */}
      {isWeapon && (
        <>
          <p style={s.sectionTitle}>Weapon Properties</p>
          <div style={s.row2}>
            <Field label="Damage (e.g. 1d8 slashing)">
              <input style={s.input} value={weaponDamage} onChange={e => setWeaponDamage(e.target.value)}
                placeholder="1d8 slashing" />
            </Field>
            <Field label="Weapon Type">
              <input style={s.input} value={weaponType} onChange={e => setWeaponType(e.target.value)}
                placeholder="Martial Melee" />
            </Field>
          </div>
          <Field label="Properties (comma-separated)">
            <input style={s.input} value={weaponProperties} onChange={e => setWeaponProperties(e.target.value)}
              placeholder="Finesse, Light, Thrown (20/60)" />
          </Field>
        </>
      )}

      {/* Armor-specific fields */}
      {isArmor && (
        <>
          <p style={s.sectionTitle}>Armor Properties</p>
          <div style={s.row3}>
            <Field label="Base AC">
              <input style={s.input} type="number" min="0" value={armorBaseAc}
                onChange={e => setArmorBaseAc(e.target.value)} placeholder="14" />
            </Field>
            <Field label="Max Dex Bonus">
              <input style={s.input} type="number" min="0" value={armorDexCap}
                onChange={e => setArmorDexCap(e.target.value)} placeholder="2" />
            </Field>
            <Field label="Min Strength">
              <input style={s.input} type="number" min="0" value={armorMinStr}
                onChange={e => setArmorMinStr(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <label style={s.checkRow}>
            <input type="checkbox" checked={armorStealthDisadv}
              onChange={e => setArmorStealthDisadv(e.target.checked)} />
            <span style={s.checkLabel}>Stealth Disadvantage</span>
          </label>
        </>
      )}

      <Field label="Description">
        <textarea style={{ ...s.input, ...s.textarea }} value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the item…" />
      </Field>

      <div style={s.btnRow}>
        <button type="button" style={s.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" style={s.saveBtn} disabled={saving}>
          {saving ? 'Saving…' : entry ? 'Save Changes' : 'Create Equipment'}
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
  form:         { display: 'flex', flexDirection: 'column', gap: '0.55rem' },
  error:        { color: '#c04040', background: '#2a0a0a', border: '1px solid #5a1010', borderRadius: 3, padding: '0.35rem 0.6rem', fontSize: '0.78rem', margin: '0 0 0.2rem' },
  field:        { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  label:        { color: '#a89060', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input:        { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.3rem 0.5rem', fontSize: '0.83rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea:     { resize: 'vertical', minHeight: 80 },
  row2:         { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  row3:         { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem' },
  sectionTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.82rem', fontWeight: 700, borderBottom: '1px solid #2a1c08', paddingBottom: '0.2rem', margin: '0.15rem 0 0' },
  checkRow:     { display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', margin: '0.1rem 0' },
  checkLabel:   { color: '#a89060', fontSize: '0.83rem' },
  btnRow:       { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #2a1c08' },
  cancelBtn:    { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem' },
  saveBtn:      { background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
}
