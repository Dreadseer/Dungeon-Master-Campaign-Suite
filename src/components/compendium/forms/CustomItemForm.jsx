import { useState } from 'react'

const ITEM_TYPES = [
  'Wondrous Item','Weapon','Armor','Ring','Rod',
  'Scroll','Staff','Wand','Potion','Gem','Trinket','Other',
]
const RARITIES = ['Common','Uncommon','Rare','Very Rare','Legendary','Artifact']

export default function CustomItemForm({ entry, onSave, onClose }) {
  const d = entry
    ? (() => { try { return JSON.parse(entry.data ?? '{}') } catch { return {} } })()
    : {}

  const [name,               setName]               = useState(entry?.name ?? '')
  const [itemType,           setItemType]           = useState(d.item_type ?? '')
  const [rarity,             setRarity]             = useState(d.rarity ?? 'Common')
  const [cost,               setCost]               = useState(d.cost ?? '')
  const [weight,             setWeight]             = useState(d.weight ?? '')
  const [requiresAttunement, setRequiresAttunement] = useState(d.requires_attunement ?? false)
  const [description,        setDescription]        = useState(d.description ?? '')
  const [properties,         setProperties]         = useState(d.properties ?? '')
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
          item_type: itemType,
          rarity,
          cost,
          weight:              weight !== '' ? Number(weight) : null,
          requires_attunement: requiresAttunement,
          description,
          properties,
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
          placeholder="e.g. Cloak of Billowing" autoFocus />
      </Field>

      <div style={s.row2}>
        <Field label="Item Type">
          <select style={s.input} value={itemType} onChange={e => setItemType(e.target.value)}>
            <option value="">— Select —</option>
            {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Rarity">
          <select style={s.input} value={rarity} onChange={e => setRarity(e.target.value)}>
            {RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>

      <div style={s.row2}>
        <Field label="Cost (e.g. 150 gp)">
          <input style={s.input} value={cost} onChange={e => setCost(e.target.value)}
            placeholder="150 gp" />
        </Field>
        <Field label="Weight (lb)">
          <input style={s.input} type="number" min="0" step="0.1" value={weight}
            onChange={e => setWeight(e.target.value)} placeholder="0" />
        </Field>
      </div>

      <label style={s.checkRow}>
        <input type="checkbox" checked={requiresAttunement}
          onChange={e => setRequiresAttunement(e.target.checked)} />
        <span style={s.checkLabel}>Requires Attunement</span>
      </label>

      <Field label="Properties (comma-separated)">
        <input style={s.input} value={properties} onChange={e => setProperties(e.target.value)}
          placeholder="e.g. Finesse, Thrown (20/60)" />
      </Field>

      <Field label="Description">
        <textarea style={{ ...s.input, ...s.textarea }} value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the item's appearance and magical properties…" />
      </Field>

      <div style={s.btnRow}>
        <button type="button" style={s.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" style={s.saveBtn} disabled={saving}>
          {saving ? 'Saving…' : entry ? 'Save Changes' : 'Create Item'}
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
  form:       { display: 'flex', flexDirection: 'column', gap: '0.55rem' },
  error:      { color: '#c04040', background: '#2a0a0a', border: '1px solid #5a1010', borderRadius: 3, padding: '0.35rem 0.6rem', fontSize: '0.78rem', margin: '0 0 0.2rem' },
  field:      { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  label:      { color: '#a89060', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input:      { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.3rem 0.5rem', fontSize: '0.83rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea:   { resize: 'vertical', minHeight: 80 },
  row2:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  checkRow:   { display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', margin: '0.1rem 0' },
  checkLabel: { color: '#a89060', fontSize: '0.83rem' },
  btnRow:     { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #2a1c08' },
  cancelBtn:  { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem' },
  saveBtn:    { background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
}
