import { useState } from 'react'
import { buildAttacksList } from '../../utils/attackUtils'

const SOURCE_COLORS = {
  weapon:  '#C9A84C',
  feature: '#4A90D9',
  spell:   '#9B59B6',
}

const SOURCE_LABELS = {
  weapon:  '⚔ Weapons',
  feature: '✨ Features & Abilities',
  spell:   '🔮 Damage Spells',
}

const SECTION_ORDER = ['weapon', 'feature', 'spell']

export default function AttacksTab({ characterId, character, onRefresh, onGoToInventory }) {
  const attacks = buildAttacksList(character)

  return (
    <div style={s.root}>
      {attacks.length === 0 ? (
        <EmptyAttacks onGoToInventory={onGoToInventory} />
      ) : (
        <AttacksTable attacks={attacks} />
      )}
      <AddExtraAttack characterId={characterId} character={character} onRefresh={onRefresh} />
    </div>
  )
}

// ── Attacks Table ─────────────────────────────────────────────────────────────

function AttacksTable({ attacks }) {
  const [openPopover, setOpenPopover] = useState(null)  // attack id

  // Group by source
  const grouped = {}
  SECTION_ORDER.forEach(src => { grouped[src] = [] })
  attacks.forEach(atk => {
    const key = grouped[atk.source] ? atk.source : 'feature'
    grouped[key].push(atk)
  })

  return (
    <div style={s.tableWrap}>
      {/* Column headers */}
      <div style={s.colHeader}>
        <span style={{ flex: 1 }}>Name</span>
        <span style={s.colAtk}>Attack</span>
        <span style={s.colDmg}>Damage</span>
        <span style={s.colRng}>Range</span>
        <span style={s.colSrc}>Source</span>
      </div>

      {SECTION_ORDER.map(src => {
        const group = grouped[src]
        if (group.length === 0) return null
        return (
          <div key={src}>
            {/* Section header */}
            <div style={{ ...s.sectionHeader, borderLeftColor: SOURCE_COLORS[src] }}>
              {SOURCE_LABELS[src]}
            </div>

            {group.map(atk => {
              const isOpen = openPopover === atk.id
              return (
                <div key={atk.id} style={{ position: 'relative' }}>
                  <div
                    style={{ ...s.row, ...(isOpen ? s.rowActive : {}) }}
                    onClick={() => setOpenPopover(isOpen ? null : atk.id)}
                  >
                    <span style={{ flex: 1, color: '#e8e0d0', fontSize: '0.85rem', fontWeight: 600,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {atk.name}
                      {atk.source === 'spell' && atk.properties?.includes('Cantrip') && (
                        <span style={s.cantripBadge}>Cantrip</span>
                      )}
                    </span>
                    <span style={{ ...s.colAtk, color: '#8ada6a', fontFamily: 'Georgia, serif', fontWeight: 700 }}>
                      {atk.attack_bonus}
                    </span>
                    <span style={{ ...s.colDmg, color: '#da9a6a', fontFamily: 'Georgia, serif' }}>
                      {atk.damage}
                    </span>
                    <span style={{ ...s.colRng, color: '#a89060', fontSize: '0.75rem' }}>
                      {atk.range}
                    </span>
                    <span style={{ ...s.colSrc, color: SOURCE_COLORS[atk.source], fontSize: '0.68rem',
                      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {atk.source}
                    </span>
                  </div>

                  {/* Detail popover */}
                  {isOpen && (
                    <div style={s.popover} onClick={e => e.stopPropagation()}>
                      <div style={s.popoverHeader}>
                        <span style={{ color: SOURCE_COLORS[atk.source], fontWeight: 700, fontFamily: 'Georgia, serif' }}>
                          {atk.name}
                        </span>
                        <button style={s.popoverClose} onClick={() => setOpenPopover(null)}>✕</button>
                      </div>
                      {atk.properties && (
                        <p style={s.popoverMeta}>
                          <strong style={{ color: '#6b5a3a' }}>Properties:</strong>{' '}
                          <span style={{ color: '#c0b8a8' }}>{atk.properties}</span>
                        </p>
                      )}
                      {atk.notes && (
                        <p style={s.popoverMeta}>
                          <span style={{ color: '#a89060', fontStyle: 'italic' }}>{atk.notes}</span>
                        </p>
                      )}
                      <div style={s.popoverStats}>
                        <div style={s.popoverStat}>
                          <span style={s.popoverStatLabel}>Attack</span>
                          <span style={{ ...s.popoverStatValue, color: '#8ada6a' }}>{atk.attack_bonus}</span>
                        </div>
                        <div style={s.popoverStat}>
                          <span style={s.popoverStatLabel}>Damage</span>
                          <span style={{ ...s.popoverStatValue, color: '#da9a6a' }}>{atk.damage}</span>
                        </div>
                        <div style={s.popoverStat}>
                          <span style={s.popoverStatLabel}>Range</span>
                          <span style={{ ...s.popoverStatValue, color: '#a89060' }}>{atk.range}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyAttacks({ onGoToInventory }) {
  return (
    <div style={s.empty}>
      <p style={{ fontSize: '2.5rem', margin: 0, lineHeight: 1 }}>⚔</p>
      <p style={s.emptyTitle}>No attacks yet.</p>
      <p style={s.emptySub}>
        Equip a weapon from your Inventory, or add racial and class attacks below.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        {onGoToInventory && (
          <button style={s.emptyBtn} onClick={onGoToInventory}>Go to Inventory</button>
        )}
      </div>
    </div>
  )
}

// ── Add Extra Attack Form ─────────────────────────────────────────────────────

const SOURCE_OPTIONS = ['Class Feature', 'Racial Trait', 'Feat', 'Other']

function AddExtraAttack({ characterId, character, onRefresh }) {
  const [open,    setOpen]    = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [toast,   setToast]   = useState('')

  // Form fields
  const [fName,    setFName]    = useState('')
  const [fSrc,     setFSrc]     = useState('Class Feature')
  const [fBonus,   setFBonus]   = useState('')
  const [fDamage,  setFDamage]  = useState('')
  const [fRange,   setFRange]   = useState('')
  const [fNotes,   setFNotes]   = useState('')
  const [fError,   setFError]   = useState('')

  const stats        = JSON.parse(character.stats ?? '{}')
  const extraAttacks = stats.extra_attacks ?? []

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2000)
  }

  function resetForm() {
    setFName(''); setFSrc('Class Feature'); setFBonus(''); setFDamage('')
    setFRange(''); setFNotes(''); setFError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!fName.trim()) { setFError('Attack name is required.'); return }
    setSaving(true); setFError('')
    try {
      const newAttack = {
        id:           crypto.randomUUID(),
        name:         fName.trim(),
        source:       'feature',
        source_label: fSrc,
        attack_bonus: fBonus.trim() || '—',
        damage:       fDamage.trim() || '—',
        range:        fRange.trim() || '—',
        notes:        fNotes.trim(),
      }
      const newStats = { ...stats, extra_attacks: [...extraAttacks, newAttack] }
      await window.electronAPI.db.characters.updateStats(characterId, newStats)
      resetForm()
      setOpen(false)
      showToast(`✓ ${newAttack.name} added.`)
      onRefresh()
    } catch {
      setFError('Failed to save.')
    }
    setSaving(false)
  }

  async function handleDelete(attackId) {
    const newStats = { ...stats, extra_attacks: extraAttacks.filter(a => a.id !== attackId) }
    await window.electronAPI.db.characters.updateStats(characterId, newStats)
    onRefresh()
  }

  return (
    <div style={s.addSection}>
      {toast && <div style={s.toast}>{toast}</div>}

      {/* Toggle button */}
      <button style={s.toggleBtn} onClick={() => { setOpen(o => !o); resetForm() }}>
        {open ? '▲ Cancel' : '＋ Add Attack'}
      </button>

      {/* Collapsible form */}
      {open && (
        <form onSubmit={handleSubmit} style={s.addForm}>
          {fError && <p style={s.formError}>{fError}</p>}

          <div style={s.formRow2}>
            <FormField label="Attack Name *">
              <input style={s.input} value={fName} onChange={e => setFName(e.target.value)}
                placeholder="Breath Weapon" autoFocus />
            </FormField>
            <FormField label="Source">
              <select style={s.input} value={fSrc} onChange={e => setFSrc(e.target.value)}>
                {SOURCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </FormField>
          </div>

          <div style={s.formRow3}>
            <FormField label="Attack Bonus">
              <input style={s.input} value={fBonus} onChange={e => setFBonus(e.target.value)}
                placeholder="+5" />
            </FormField>
            <FormField label="Damage">
              <input style={s.input} value={fDamage} onChange={e => setFDamage(e.target.value)}
                placeholder="2d6 fire" />
            </FormField>
            <FormField label="Range">
              <input style={s.input} value={fRange} onChange={e => setFRange(e.target.value)}
                placeholder="15 ft cone" />
            </FormField>
          </div>

          <FormField label="Notes">
            <input style={s.input} value={fNotes} onChange={e => setFNotes(e.target.value)}
              placeholder="Recharge 5–6, Con save DC 13…" />
          </FormField>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem', marginTop: '0.25rem' }}>
            <button type="button" style={s.cancelBtn} onClick={() => { setOpen(false); resetForm() }}>
              Cancel
            </button>
            <button type="submit" style={s.saveBtn} disabled={saving}>
              {saving ? 'Saving…' : 'Add Attack'}
            </button>
          </div>
        </form>
      )}

      {/* Existing extra attacks list */}
      {extraAttacks.length > 0 && (
        <div style={s.extraList}>
          <p style={s.extraListTitle}>Custom Attacks</p>
          {extraAttacks.map(atk => (
            <div key={atk.id} style={s.extraRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: '#e8e0d0', fontSize: '0.83rem', fontWeight: 600 }}>{atk.name}</span>
                <span style={{ color: '#6b5a3a', fontSize: '0.72rem', marginLeft: '0.5rem' }}>
                  {atk.source_label ?? atk.source}
                </span>
                <span style={{ color: '#a89060', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                  {[atk.attack_bonus, atk.damage, atk.range].filter(v => v && v !== '—').join(' · ')}
                </span>
              </div>
              <button style={s.deleteBtn} onClick={() => handleDelete(atk.id)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helper component ──────────────────────────────────────────────────────────

function FormField({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <label style={{ color: '#a89060', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  root: {
    display:       'flex',
    flexDirection: 'column',
    flex:          1,
    overflow:      'hidden',
    padding:       '0.85rem 1.5rem',
    gap:           '0.75rem',
  },

  // Table
  tableWrap: { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', minHeight: 0 },
  colHeader: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.2rem 0.5rem',
    color: '#6b5a3a', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid #2a1c08', flexShrink: 0,
  },
  colAtk:  { width: 65,  flexShrink: 0, textAlign: 'center' },
  colDmg:  { width: 110, flexShrink: 0, textAlign: 'center' },
  colRng:  { width: 75,  flexShrink: 0, textAlign: 'center' },
  colSrc:  { width: 70,  flexShrink: 0, textAlign: 'right' },

  sectionHeader: {
    padding:     '0.3rem 0.5rem 0.2rem 0.75rem',
    borderLeft:  '3px solid',
    color:       '#a89060',
    fontSize:    '0.72rem',
    fontWeight:  700,
    fontFamily:  'Georgia, serif',
    background:  '#0a0805',
    marginTop:   '0.35rem',
    letterSpacing: '0.03em',
  },

  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        '0.5rem',
    padding:    '0.38rem 0.5rem',
    borderBottom: '1px solid #1a1208',
    cursor:     'pointer',
    transition: 'background 0.1s',
    flexShrink: 0,
  },
  rowActive: { background: '#1a1208' },

  cantripBadge: {
    display:      'inline-block',
    marginLeft:   '0.4rem',
    background:   '#2a1a3a',
    border:       '1px solid #5a3a7a',
    color:        '#aa7aca',
    fontSize:     '0.6rem',
    padding:      '0 0.25rem',
    borderRadius: 2,
    verticalAlign: 'middle',
  },

  // Popover
  popover: {
    position:     'absolute',
    left:         0,
    right:        0,
    zIndex:       50,
    background:   '#12100a',
    border:       '1px solid #3a2a10',
    borderRadius: 5,
    padding:      '0.6rem 0.75rem',
    boxShadow:    '0 4px 16px rgba(0,0,0,0.5)',
  },
  popoverHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' },
  popoverClose:  { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.85rem', padding: 0 },
  popoverMeta:   { color: '#a89060', fontSize: '0.78rem', margin: '0 0 0.25rem', lineHeight: 1.5 },
  popoverStats:  { display: 'flex', gap: '0.75rem', marginTop: '0.3rem' },
  popoverStat:   { display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.3rem 0.5rem', minWidth: 55 },
  popoverStatLabel: { color: '#6b5a3a', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.04em' },
  popoverStatValue: { fontSize: '0.88rem', fontWeight: 700, fontFamily: 'Georgia, serif', marginTop: 2 },

  // Empty state
  empty:      { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.5rem', padding: '2rem', textAlign: 'center' },
  emptyTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1rem', margin: 0 },
  emptySub:   { color: '#6b5a3a', fontSize: '0.83rem', margin: 0, maxWidth: 360, lineHeight: 1.5 },
  emptyBtn:   { background: '#1a1208', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem' },

  // Add section
  addSection: { flexShrink: 0, borderTop: '1px solid #2a1c08', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  toggleBtn:  { alignSelf: 'flex-start', background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8aba6a', borderRadius: 3, padding: '0.3rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem' },
  addForm:    { display: 'flex', flexDirection: 'column', gap: '0.45rem', background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.75rem' },
  formRow2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' },
  formRow3:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' },
  formError:  { color: '#c04040', background: '#2a0a0a', border: '1px solid #5a1010', borderRadius: 3, padding: '0.3rem 0.5rem', fontSize: '0.75rem', margin: 0 },
  input:      { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.28rem 0.5rem', fontSize: '0.82rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  cancelBtn:  { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.28rem 0.65rem', cursor: 'pointer', fontSize: '0.8rem' },
  saveBtn:    { background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.28rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 },

  // Existing extra attacks
  extraList:      { background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.4rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  extraListTitle: { color: '#6b5a3a', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.3rem' },
  extraRow:       { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0', borderBottom: '1px solid #151208' },
  deleteBtn:      { background: 'none', border: 'none', color: '#8B0000', cursor: 'pointer', fontSize: '1rem', padding: '0 0.15rem', lineHeight: 1, flexShrink: 0 },

  // Toast
  toast: {
    position: 'fixed', top: '3.5rem', left: '50%', transform: 'translateX(-50%)',
    background: '#1a3a1a', border: '1px solid #3a6a3a', color: '#8ada8a',
    fontSize: '0.82rem', padding: '0.3rem 0.9rem', borderRadius: 4, zIndex: 2000,
    pointerEvents: 'none',
  },
}
