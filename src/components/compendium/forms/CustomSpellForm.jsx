import { useState } from 'react'

const SCHOOLS = [
  'Abjuration','Conjuration','Divination','Enchantment',
  'Evocation','Illusion','Necromancy','Transmutation',
]
const LEVEL_LABELS = [
  'Cantrip (0)','1st','2nd','3rd','4th','5th','6th','7th','8th','9th',
]

export default function CustomSpellForm({ entry, onSave, onClose }) {
  const d = entry
    ? (() => { try { return JSON.parse(entry.data ?? '{}') } catch { return {} } })()
    : {}

  const [name,          setName]          = useState(entry?.name ?? '')
  const [level,         setLevel]         = useState(d.level ?? 0)
  const [school,        setSchool]        = useState(d.school ?? '')
  const [castingTime,   setCastingTime]   = useState(d.casting_time ?? '')
  const [range,         setRange]         = useState(d.range ?? '')
  const [compV,         setCompV]         = useState(d.components_v ?? false)
  const [compS,         setCompS]         = useState(d.components_s ?? false)
  const [compM,         setCompM]         = useState(d.components_m ?? false)
  const [material,      setMaterial]      = useState(d.material ?? '')
  const [duration,      setDuration]      = useState(d.duration ?? '')
  const [concentration, setConcentration] = useState(d.concentration ?? false)
  const [ritual,        setRitual]        = useState(d.ritual ?? false)
  const [classes,       setClasses]       = useState(d.classes ?? '')
  const [description,   setDescription]   = useState(d.description ?? '')
  const [higherLevels,  setHigherLevels]  = useState(d.higher_levels ?? '')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError('')
    try {
      await onSave({
        name: name.trim(),
        data: {
          level:         Number(level),
          school,
          casting_time:  castingTime,
          range,
          components_v:  compV,
          components_s:  compS,
          components_m:  compM,
          material,
          duration,
          concentration,
          ritual,
          classes,
          description,
          higher_levels: higherLevels,
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
          placeholder="e.g. Chromatic Orb" autoFocus />
      </Field>

      <div style={s.row2}>
        <Field label="Level">
          <select style={s.input} value={level} onChange={e => setLevel(e.target.value)}>
            {LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </Field>
        <Field label="School">
          <select style={s.input} value={school} onChange={e => setSchool(e.target.value)}>
            <option value="">— Select —</option>
            {SCHOOLS.map(sc => <option key={sc} value={sc}>{sc}</option>)}
          </select>
        </Field>
      </div>

      <div style={s.row2}>
        <Field label="Casting Time">
          <input style={s.input} value={castingTime} onChange={e => setCastingTime(e.target.value)}
            placeholder="1 action" />
        </Field>
        <Field label="Range">
          <input style={s.input} value={range} onChange={e => setRange(e.target.value)}
            placeholder="60 feet" />
        </Field>
      </div>

      <div style={s.row2}>
        <Field label="Duration">
          <input style={s.input} value={duration} onChange={e => setDuration(e.target.value)}
            placeholder="Instantaneous" />
        </Field>
        <Field label="Classes (comma-separated)">
          <input style={s.input} value={classes} onChange={e => setClasses(e.target.value)}
            placeholder="Wizard, Sorcerer" />
        </Field>
      </div>

      {/* Components row */}
      <div style={s.compRow}>
        <span style={s.compLabel}>Components:</span>
        {[['V', compV, setCompV], ['S', compS, setCompS], ['M', compM, setCompM]].map(([lbl, val, set]) => (
          <label key={lbl} style={s.checkInline}>
            <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} />
            <span style={s.checkLabel}>{lbl}</span>
          </label>
        ))}
        <label style={s.checkInline}>
          <input type="checkbox" checked={concentration} onChange={e => setConcentration(e.target.checked)} />
          <span style={s.checkLabel}>Concentration</span>
        </label>
        <label style={s.checkInline}>
          <input type="checkbox" checked={ritual} onChange={e => setRitual(e.target.checked)} />
          <span style={s.checkLabel}>Ritual</span>
        </label>
      </div>

      {compM && (
        <Field label="Material Component">
          <input style={s.input} value={material} onChange={e => setMaterial(e.target.value)}
            placeholder="A tiny ball of bat guano and sulfur" />
        </Field>
      )}

      <Field label="Description">
        <textarea style={{ ...s.input, ...s.textarea }} value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the spell effect…" />
      </Field>

      <Field label="At Higher Levels">
        <textarea style={{ ...s.input, ...s.taSmall }} value={higherLevels}
          onChange={e => setHigherLevels(e.target.value)}
          placeholder="When cast using a spell slot of 2nd level or higher…" />
      </Field>

      <div style={s.btnRow}>
        <button type="button" style={s.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" style={s.saveBtn} disabled={saving}>
          {saving ? 'Saving…' : entry ? 'Save Changes' : 'Create Spell'}
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
  field:       { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  label:       { color: '#a89060', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input:       { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.3rem 0.5rem', fontSize: '0.83rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea:    { resize: 'vertical', minHeight: 80 },
  taSmall:     { resize: 'vertical', minHeight: 50 },
  row2:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  compRow:     { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' },
  compLabel:   { color: '#a89060', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  checkInline: { display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' },
  checkLabel:  { color: '#a89060', fontSize: '0.82rem' },
  btnRow:      { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #2a1c08' },
  cancelBtn:   { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem' },
  saveBtn:     { background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
}
