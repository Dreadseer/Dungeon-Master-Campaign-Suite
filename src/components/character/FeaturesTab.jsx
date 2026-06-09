import { useState, useEffect } from 'react'
import FeatureCard   from './FeatureCard'
import SubclassCard  from './SubclassCard'

// ── Main tab component ────────────────────────────────────────────────────────

export default function FeaturesTab({ characterId, character, onRefresh }) {
  const stats    = character._stats ?? {}
  const features = {
    racial_traits:  [],
    class_features: [],
    background:     { personality_traits: '', ideals: '', bonds: '', flaws: '' },
    feats:          [],
    ...(stats.features ?? {}),
  }

  // ── Subclass data ──────────────────────────────────────────────────────────
  const [subclassData,  setSubclassData]  = useState(null)
  const [availableSubs, setAvailableSubs] = useState([])

  useEffect(() => {
    if (!character.class) { setAvailableSubs([]); return }
    window.electronAPI.db.subclasses.getByClass(character.class)
      .then(setAvailableSubs)
      .catch(() => setAvailableSubs([]))
  }, [character.class])

  useEffect(() => {
    if (!character.subclass_name || !character.class) { setSubclassData(null); return }
    window.electronAPI.db.subclasses.getByName(character.class, character.subclass_name)
      .then(setSubclassData)
      .catch(() => setSubclassData(null))
  }, [character.subclass_name, character.class])

  async function saveFeatures(newFeatures) {
    const newStats = { ...stats, features: newFeatures }
    await window.electronAPI.db.characters.updateStats(characterId, newStats)
    onRefresh()
  }

  async function handleAssignSubclass(sub) {
    const subFeatures = JSON.parse(sub.features ?? '[]')
    const charLevel   = character.level ?? 1
    const existing    = features.class_features ?? []
    const merged      = [
      ...existing,
      ...subFeatures.filter(f => f.level_gained <= charLevel),
    ].sort((a, b) => (a.level_gained ?? 0) - (b.level_gained ?? 0))
    await window.electronAPI.db.characters.setSubclass(characterId, sub.name)
    await saveFeatures({ ...features, class_features: merged })
  }

  return (
    <div style={s.root}>
      <SubclassSection
        character={character}
        subclassData={subclassData}
        availableSubs={availableSubs}
        onAssign={handleAssignSubclass}
      />
      <RacialTraitsSection
        features={features}
        character={character}
        onSave={saveFeatures}
      />
      <ClassFeaturesSection
        features={features}
        character={character}
        onSave={saveFeatures}
      />
      <BackgroundSection
        features={features}
        characterId={characterId}
        stats={stats}
        onRefresh={onRefresh}
      />
      <FeatsSection
        features={features}
        onSave={saveFeatures}
      />
    </div>
  )
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={s.section}>
      <button style={s.sectionHeader} onClick={() => setOpen(o => !o)}>
        <span style={s.sectionTitle}>{title}</span>
        <span style={s.sectionChevron}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={s.sectionBody}>{children}</div>}
    </div>
  )
}

// ── Section 0 — Subclass ─────────────────────────────────────────────────────

function SubclassSection({ character, subclassData, availableSubs, onAssign }) {
  const charLevel = character.level ?? 1
  const className = character.class ?? ''

  // Minimum unlock level across all available subclasses for this class
  const minUnlock = availableSubs.length > 0
    ? Math.min(...availableSubs.map(s => s.unlock_level))
    : 99
  const isEligible = charLevel >= minUnlock

  // ── Has a subclass assigned ────────────────────────────────────────────────
  if (character.subclass_name && subclassData) {
    const features = JSON.parse(subclassData.features ?? '[]')
    return (
      <Section title={`🌟 Subclass — ${character.subclass_name} (${className})`} defaultOpen>
        <p style={{ fontSize: '13px', color: '#c0b8a8', lineHeight: '1.5', margin: '0 0 8px' }}>
          {subclassData.description}
        </p>
        {features.map((f, i) => (
          <div key={i} style={{ opacity: f.level_gained <= charLevel ? 1 : 0.45 }}>
            <FeatureCard
              name={f.name}
              badge={`Level ${f.level_gained}`}
              description={f.description}
            />
          </div>
        ))}
      </Section>
    )
  }

  // ── Eligible but no subclass yet — show call-to-action ────────────────────
  if (!character.subclass_name && isEligible) {
    const eligible = availableSubs.filter(s => s.unlock_level <= charLevel)
    return (
      <Section title="⚔ Choose Your Subclass" defaultOpen>
        <p style={{ color: '#c0b8a8', fontSize: '13px', marginBottom: '12px', lineHeight: '1.5' }}>
          As a level {charLevel} {className}, you can now choose your specialization.
        </p>
        {eligible.map(sub => (
          <SubclassCard
            key={sub.id}
            subclass={sub}
            selected={false}
            onSelect={() => onAssign(sub)}
          />
        ))}
      </Section>
    )
  }

  return null  // Not yet eligible, or data still loading
}

// ── Section 1 — Racial Traits ─────────────────────────────────────────────────

function RacialTraitsSection({ features, character, onSave }) {
  const [adding,  setAdding]  = useState(false)
  const [fName,   setFName]   = useState('')
  const [fDesc,   setFDesc]   = useState('')
  const [saving,  setSaving]  = useState(false)

  const raceName = character.race ?? ''

  async function handleAdd(e) {
    e.preventDefault()
    if (!fName.trim()) return
    setSaving(true)
    const newTrait = { id: crypto.randomUUID(), name: fName.trim(), description: fDesc.trim() }
    await onSave({ ...features, racial_traits: [...features.racial_traits, newTrait] })
    setFName(''); setFDesc(''); setAdding(false)
    setSaving(false)
  }

  async function handleDelete(id) {
    await onSave({ ...features, racial_traits: features.racial_traits.filter(t => t.id !== id) })
  }

  return (
    <Section title={`🧬 Racial Traits${raceName ? ` — ${raceName}` : ''}`} defaultOpen>
      {features.racial_traits.length === 0 && !adding && (
        <p style={s.empty}>No racial traits added yet.</p>
      )}

      {features.racial_traits.map(trait => (
        <FeatureCard
          key={trait.id}
          name={trait.name}
          description={trait.description}
          onDelete={() => handleDelete(trait.id)}
        />
      ))}

      {adding ? (
        <form onSubmit={handleAdd} style={s.addForm}>
          <input style={s.input} value={fName} onChange={e => setFName(e.target.value)}
            placeholder="Trait name *" autoFocus />
          <textarea style={s.textarea} value={fDesc} onChange={e => setFDesc(e.target.value)}
            placeholder="Description…" rows={3} />
          <FormBtns onCancel={() => { setAdding(false); setFName(''); setFDesc('') }} saving={saving} />
        </form>
      ) : (
        <button style={s.addBtn} onClick={() => setAdding(true)}>＋ Add Racial Trait</button>
      )}
    </Section>
  )
}

// ── Section 2 — Class Features ────────────────────────────────────────────────

function ClassFeaturesSection({ features, character, onSave }) {
  const [adding,  setAdding]  = useState(false)
  const [fName,   setFName]   = useState('')
  const [fLevel,  setFLevel]  = useState(1)
  const [fDesc,   setFDesc]   = useState('')
  const [saving,  setSaving]  = useState(false)

  const className = character.class ?? ''

  const sorted = [...features.class_features].sort(
    (a, b) => (a.level_gained ?? 0) - (b.level_gained ?? 0)
  )

  async function handleAdd(e) {
    e.preventDefault()
    if (!fName.trim()) return
    setSaving(true)
    const newFeature = {
      id:          crypto.randomUUID(),
      name:        fName.trim(),
      level_gained:Number(fLevel),
      description: fDesc.trim(),
    }
    const updated = [...features.class_features, newFeature]
      .sort((a, b) => (a.level_gained ?? 0) - (b.level_gained ?? 0))
    await onSave({ ...features, class_features: updated })
    setFName(''); setFLevel(1); setFDesc(''); setAdding(false)
    setSaving(false)
  }

  async function handleDelete(id) {
    await onSave({ ...features, class_features: features.class_features.filter(f => f.id !== id) })
  }

  return (
    <Section title={`⚔ Class Features${className ? ` — ${className}` : ''}`} defaultOpen>
      {sorted.length === 0 && !adding && (
        <p style={s.empty}>No class features added yet.</p>
      )}

      {sorted.map(feat => (
        <FeatureCard
          key={feat.id}
          name={feat.name}
          badge={feat.level_gained != null ? `Level ${feat.level_gained}` : undefined}
          description={feat.description}
          onDelete={() => handleDelete(feat.id)}
        />
      ))}

      {adding ? (
        <form onSubmit={handleAdd} style={s.addForm}>
          <div style={s.formRow2}>
            <input style={s.input} value={fName} onChange={e => setFName(e.target.value)}
              placeholder="Feature name *" autoFocus />
            <label style={s.levelLabel}>
              <span style={{ color: '#6b5a3a', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Level Gained
              </span>
              <input style={{ ...s.input, width: 70, textAlign: 'center' }}
                type="number" min="1" max="20" value={fLevel}
                onChange={e => setFLevel(e.target.value)} />
            </label>
          </div>
          <textarea style={s.textarea} value={fDesc} onChange={e => setFDesc(e.target.value)}
            placeholder="Description…" rows={3} />
          <FormBtns onCancel={() => { setAdding(false); setFName(''); setFLevel(1); setFDesc('') }} saving={saving} />
        </form>
      ) : (
        <button style={s.addBtn} onClick={() => setAdding(true)}>＋ Add Class Feature</button>
      )}
    </Section>
  )
}

// ── Section 3 — Background & Personality ─────────────────────────────────────

const BG_FIELDS = [
  { key: 'personality_traits', label: 'Personality Traits',  hint: 'Quirks, habits, and speech patterns…' },
  { key: 'ideals',             label: 'Ideals',               hint: 'The core principles your character lives by…' },
  { key: 'bonds',              label: 'Bonds',                hint: 'People, places, or objectives your character is connected to…' },
  { key: 'flaws',              label: 'Flaws',                hint: 'Vices, fears, or limitations…' },
]

function BackgroundSection({ features, characterId, stats, onRefresh }) {
  // Local state for controlled textareas — reset only when character changes
  const bg = features.background ?? {}
  const [values, setValues] = useState({
    personality_traits: bg.personality_traits ?? '',
    ideals:             bg.ideals             ?? '',
    bonds:              bg.bonds              ?? '',
    flaws:              bg.flaws              ?? '',
  })

  // Sync from DB when switching characters
  useEffect(() => {
    const bg2 = features.background ?? {}
    setValues({
      personality_traits: bg2.personality_traits ?? '',
      ideals:             bg2.ideals             ?? '',
      bonds:              bg2.bonds              ?? '',
      flaws:              bg2.flaws              ?? '',
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId])

  async function handleBlur(field, value) {
    const newBackground = { ...bg, [field]: value }
    const newFeatures   = { ...features, background: newBackground }
    const newStats      = { ...stats, features: newFeatures }
    await window.electronAPI.db.characters.updateStats(characterId, newStats)
    // No full refresh needed — just persisting; local state already correct
  }

  return (
    <Section title="📖 Background & Personality" defaultOpen={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {BG_FIELDS.map(({ key, label, hint }) => {
          const val = values[key] ?? ''
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <label style={s.bgLabel}>{label}</label>
              <textarea
                style={s.bgTextarea}
                value={val}
                maxLength={500}
                rows={3}
                placeholder={hint}
                onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                onBlur={e => handleBlur(key, e.target.value)}
              />
              <span style={s.charCount}>{val.length} / 500</span>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ── Section 4 — Feats ─────────────────────────────────────────────────────────

function FeatsSection({ features, onSave }) {
  const [adding,  setAdding]  = useState(false)
  const [fName,   setFName]   = useState('')
  const [fDesc,   setFDesc]   = useState('')
  const [fSource, setFSource] = useState('')
  const [saving,  setSaving]  = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!fName.trim()) return
    setSaving(true)
    const newFeat = {
      id:          crypto.randomUUID(),
      name:        fName.trim(),
      description: fDesc.trim(),
      source:      fSource.trim(),
    }
    await onSave({ ...features, feats: [...features.feats, newFeat] })
    setFName(''); setFDesc(''); setFSource(''); setAdding(false)
    setSaving(false)
  }

  async function handleDelete(id) {
    await onSave({ ...features, feats: features.feats.filter(f => f.id !== id) })
  }

  return (
    <Section title="✨ Feats" defaultOpen>
      {features.feats.length === 0 && !adding && (
        <p style={s.empty}>
          No feats added yet.
          <span style={{ color: '#6b5a3a', display: 'block', marginTop: '0.25rem', fontSize: '0.78rem' }}>
            You gain feats by choosing them instead of an Ability Score Improvement.
          </span>
        </p>
      )}

      {features.feats.map(feat => (
        <FeatureCard
          key={feat.id}
          name={feat.name}
          badge={feat.source || undefined}
          description={feat.description}
          onDelete={() => handleDelete(feat.id)}
        />
      ))}

      {adding ? (
        <form onSubmit={handleAdd} style={s.addForm}>
          <div style={s.formRow2}>
            <input style={s.input} value={fName} onChange={e => setFName(e.target.value)}
              placeholder="Feat name *" autoFocus />
            <input style={s.input} value={fSource} onChange={e => setFSource(e.target.value)}
              placeholder="Source (e.g. Level 4 ASI)" />
          </div>
          <textarea style={s.textarea} value={fDesc} onChange={e => setFDesc(e.target.value)}
            placeholder="Description…" rows={3} />
          <FormBtns onCancel={() => { setAdding(false); setFName(''); setFDesc(''); setFSource('') }} saving={saving} />
        </form>
      ) : (
        <button style={s.addBtn} onClick={() => setAdding(true)}>＋ Add Feat</button>
      )}
    </Section>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function FormBtns({ onCancel, saving }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' }}>
      <button type="button" style={s.cancelBtn} onClick={onCancel}>Cancel</button>
      <button type="submit" style={s.saveBtn} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  root: {
    display:       'flex',
    flexDirection: 'column',
    flex:          1,
    overflowY:     'auto',
    padding:       '0.85rem 1.5rem',
    gap:           '0.5rem',
  },

  // Collapsible section
  section: {
    background:   '#0a0805',
    border:       '1px solid #2a1c08',
    borderRadius: 5,
    flexShrink:   0,
  },
  sectionHeader: {
    width:        '100%',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'space-between',
    background:   'transparent',
    border:       'none',
    cursor:       'pointer',
    padding:      '0.55rem 0.8rem',
    gap:          '0.5rem',
  },
  sectionTitle: {
    color:       '#c9a84c',
    fontFamily:  'Georgia, serif',
    fontSize:    '0.88rem',
    fontWeight:  700,
    textAlign:   'left',
  },
  sectionChevron: {
    color:      '#6b5a3a',
    fontSize:   '0.7rem',
    flexShrink: 0,
  },
  sectionBody: {
    padding:    '0 0.75rem 0.75rem',
    borderTop:  '1px solid #2a1c08',
    paddingTop: '0.5rem',
  },

  // Empty state
  empty: {
    color:       '#6b5a3a',
    fontSize:    '0.82rem',
    fontStyle:   'italic',
    margin:      '0.25rem 0 0.4rem',
    padding:     '0.25rem 0',
  },

  // Add form
  addForm: {
    display:       'flex',
    flexDirection: 'column',
    gap:           '0.4rem',
    background:    '#0d0a05',
    border:        '1px solid #2a1c08',
    borderRadius:  4,
    padding:       '0.6rem',
    marginTop:     '0.35rem',
  },
  formRow2: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', alignItems: 'end' },
  levelLabel: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },

  input: {
    background:  '#0d0a05',
    border:      '1px solid #3a2a10',
    borderRadius: 3,
    color:       '#e8e0d0',
    padding:     '0.28rem 0.5rem',
    fontSize:    '0.82rem',
    outline:     'none',
    width:       '100%',
    boxSizing:   'border-box',
  },
  textarea: {
    background:  '#0d0a05',
    border:      '1px solid #3a2a10',
    borderRadius: 3,
    color:       '#c8c0b0',
    padding:     '0.3rem 0.5rem',
    fontSize:    '0.8rem',
    lineHeight:  1.6,
    resize:      'vertical',
    outline:     'none',
    width:       '100%',
    boxSizing:   'border-box',
    fontFamily:  'inherit',
  },
  cancelBtn: {
    background:  'transparent',
    border:      '1px solid #3a2a10',
    color:       '#6b5a3a',
    borderRadius: 3,
    padding:     '0.25rem 0.6rem',
    cursor:      'pointer',
    fontSize:    '0.78rem',
  },
  saveBtn: {
    background:  '#2a3a1a',
    border:      '1px solid #4a7a2a',
    color:       '#8ada6a',
    borderRadius: 3,
    padding:     '0.25rem 0.65rem',
    cursor:      'pointer',
    fontSize:    '0.78rem',
    fontWeight:  600,
  },
  addBtn: {
    background:  'none',
    border:      '1px dashed #3a2a10',
    color:       '#a89060',
    borderRadius: 3,
    padding:     '0.28rem 0.65rem',
    cursor:      'pointer',
    fontSize:    '0.78rem',
    marginTop:   '0.3rem',
  },

  // Background textareas
  bgLabel: {
    color:          '#a89060',
    fontSize:       '0.72rem',
    textTransform:  'uppercase',
    letterSpacing:  '0.04em',
  },
  bgTextarea: {
    background:  '#0d0a05',
    border:      '1px solid #3a2a10',
    borderRadius: 3,
    color:       '#c8c0b0',
    padding:     '0.4rem 0.5rem',
    fontSize:    '0.82rem',
    lineHeight:  1.6,
    resize:      'vertical',
    outline:     'none',
    width:       '100%',
    boxSizing:   'border-box',
    fontFamily:  'inherit',
    minHeight:   60,
  },
  charCount: {
    color:     '#6b5a3a',
    fontSize:  '0.68rem',
    textAlign: 'right',
  },
}
