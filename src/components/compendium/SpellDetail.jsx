import { useState, useEffect } from 'react'
import useCampaignStore from '../../stores/campaignStore'

const LEVEL_ORDINALS = ['Cantrip','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']

export default function SpellDetail({ index, onClose }) {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const [spell,      setSpell]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [toast,      setToast]      = useState('')

  // Add-to-character flow
  const [addMode,    setAddMode]    = useState(false)
  const [characters, setCharacters] = useState([])
  const [selCharId,  setSelCharId]  = useState('')
  const [adding,     setAdding]     = useState(false)

  useEffect(() => {
    setLoading(true)
    setSpell(null)
    window.electronAPI.srd.getSpellByIndex(index)
      .then(s => { setSpell(s); setLoading(false) })
      .catch(() => setLoading(false))
  }, [index])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function openAddMode() {
    setAddMode(true)
    if (!activeCampaign) return
    const chars = await window.electronAPI.db.characters.getAll(activeCampaign.id).catch(() => [])
    setCharacters(chars)
    if (chars.length > 0) setSelCharId(String(chars[0].id))
  }

  async function confirmAdd() {
    if (!selCharId || !spell) return
    setAdding(true)
    try {
      await window.electronAPI.db.characters.addKnownSpell(Number(selCharId), {
        name:   spell.name,
        index:  spell.index,
        level:  spell.level,
        school: spell.school?.name ?? spell.school ?? '',
        source: 'srd',
      })
      const char = characters.find(c => c.id === Number(selCharId))
      showToast(`✓ ${spell.name} added to ${char?.character_name ?? 'character'}'s spellbook.`)
    } catch {
      showToast('Failed to add spell.')
    }
    setAdding(false)
    setAddMode(false)
  }

  if (loading) return (
    <div style={s.panel}>
      <div style={s.panelHeader}>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>
      <p style={s.msg}>Loading…</p>
    </div>
  )

  if (!spell) return (
    <div style={s.panel}>
      <div style={s.panelHeader}>
        <span style={s.spName}>Not found</span>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>
      <p style={s.msg}>Spell data not available.</p>
    </div>
  )

  const levelLabel = spell.level === 0
    ? 'Cantrip'
    : `${LEVEL_ORDINALS[spell.level]}-level ${spell.school?.name ?? ''}`

  // Parse components
  const comps      = spell.components ?? []
  const compStr    = comps.join(', ')
  const hasMat     = comps.includes('M')
  const matDesc    = spell.material ?? ''

  // Paragraphs in description
  const descParagraphs = Array.isArray(spell.desc)
    ? spell.desc
    : [spell.desc].filter(Boolean)

  const atHigher = Array.isArray(spell.higher_level) ? spell.higher_level : []
  const classes  = spell.classes?.map(c => c.name).join(', ') ?? ''

  return (
    <div style={s.panel}>
      {toast && <div style={s.toast}>{toast}</div>}

      {/* Header */}
      <div style={s.panelHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={s.spName}>{spell.name}</h2>
          <p style={s.spSub}>{levelLabel}</p>
        </div>
        <button style={s.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      <div style={s.scrollBody}>
        {/* Casting info row */}
        <div style={s.infoGrid}>
          <InfoCell label="Casting Time"  value={spell.casting_time} />
          <InfoCell label="Range"         value={spell.range} />
          <InfoCell label="Components"    value={compStr} />
          <InfoCell label="Duration"      value={spell.duration} />
        </div>

        {/* Special badges */}
        <div style={s.badgeRow}>
          {spell.concentration && <span style={s.badge}>Concentration</span>}
          {spell.ritual        && <span style={s.badge}>Ritual</span>}
        </div>

        {/* Material component detail */}
        {hasMat && matDesc && (
          <p style={s.material}><em>Materials: </em>{matDesc}</p>
        )}

        <hr style={s.divider} />

        {/* Description */}
        <div style={s.descBlock}>
          {descParagraphs.map((para, i) => (
            <p key={i} style={s.descPara}>{para}</p>
          ))}
        </div>

        {/* At Higher Levels */}
        {atHigher.length > 0 && (
          <div style={s.higherBlock}>
            <span style={s.higherLabel}>At Higher Levels. </span>
            {atHigher.map((t, i) => <span key={i} style={s.higherText}>{t}</span>)}
          </div>
        )}

        <hr style={s.divider} />

        {/* Classes */}
        {classes && (
          <p style={s.classLine}>
            <span style={s.classLabel}>Classes: </span>
            <span style={s.classValue}>{classes}</span>
          </p>
        )}
      </div>

      {/* Footer */}
      <div style={s.footer}>
        {addMode ? (
          <div style={s.addFlow}>
            {!activeCampaign ? (
              <p style={s.addMsg}>Select a campaign first to add spells to a character.</p>
            ) : characters.length === 0 ? (
              <p style={s.addMsg}>No characters in this campaign yet.</p>
            ) : (
              <select style={s.charSelect} value={selCharId}
                onChange={e => setSelCharId(e.target.value)}>
                {characters.map(c => (
                  <option key={c.id} value={c.id}>{c.character_name}</option>
                ))}
              </select>
            )}
            <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.3rem' }}>
              <button style={s.cancelAddBtn} onClick={() => setAddMode(false)}>Cancel</button>
              {activeCampaign && characters.length > 0 && (
                <button style={s.confirmAddBtn} onClick={confirmAdd} disabled={adding}>
                  {adding ? 'Adding…' : 'Add to Spellbook'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <button style={s.actionBtn} onClick={openAddMode}>
            + Add to Character
          </button>
        )}
      </div>
    </div>
  )
}

function InfoCell({ label, value }) {
  return (
    <div style={s.infoCell}>
      <span style={s.infoLabel}>{label}</span>
      <span style={s.infoVal}>{value ?? '—'}</span>
    </div>
  )
}

const s = {
  panel: {
    width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
    background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 6, overflow: 'hidden',
  },
  toast: {
    background: '#1a3a1a', border: '1px solid #3a6a3a', color: '#8ada8a',
    fontSize: '0.78rem', padding: '0.3rem 0.75rem', margin: '0.4rem 0.6rem',
    borderRadius: 4, textAlign: 'center', flexShrink: 0,
  },
  panelHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '0.7rem 0.85rem 0.5rem', borderBottom: '1px solid #2a1c08', flexShrink: 0,
  },
  spName:   { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.05rem', margin: 0 },
  spSub:    { color: '#a89060', fontSize: '0.73rem', margin: '0.15rem 0 0', fontStyle: 'italic' },
  closeBtn: { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.9rem', padding: 0, lineHeight: 1, flexShrink: 0 },

  scrollBody: { flex: 1, overflowY: 'auto', padding: '0.65rem 0.85rem' },
  msg:        { color: '#6b5a3a', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' },

  infoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', marginBottom: '0.4rem' },
  infoCell: { background: '#0d0a05', borderRadius: 4, padding: '0.3rem 0.5rem' },
  infoLabel:{ display: 'block', color: '#6b5a3a', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em' },
  infoVal:  { display: 'block', color: '#e8e0d0', fontSize: '0.8rem', fontWeight: 600 },

  badgeRow: { display: 'flex', gap: '0.4rem', marginBottom: '0.35rem', flexWrap: 'wrap' },
  badge:    { background: '#1a2a3a', border: '1px solid #2a4a6a', color: '#6aaada', fontSize: '0.7rem', padding: '0.1rem 0.45rem', borderRadius: 10 },

  material: { color: '#a89060', fontSize: '0.75rem', fontStyle: 'italic', marginBottom: '0.3rem' },
  divider:  { border: 'none', borderTop: '1px solid #2a1c08', margin: '0.45rem 0' },

  descBlock: { marginBottom: '0.5rem' },
  descPara:  { color: '#c8c0b0', fontSize: '0.8rem', lineHeight: 1.55, margin: '0 0 0.4rem' },

  higherBlock: { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.4rem 0.5rem', marginBottom: '0.4rem', fontSize: '0.78rem', lineHeight: 1.45 },
  higherLabel: { color: '#c9a84c', fontWeight: 700 },
  higherText:  { color: '#a89060' },

  classLine:  { fontSize: '0.78rem' },
  classLabel: { color: '#6b5a3a' },
  classValue: { color: '#a89060' },

  footer:       { borderTop: '1px solid #2a1c08', padding: '0.45rem 0.85rem', flexShrink: 0 },
  actionBtn:    { width: '100%', background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.3rem 0.4rem', cursor: 'pointer', fontSize: '0.75rem' },
  addFlow:      { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  addMsg:       { color: '#6b5a3a', fontSize: '0.75rem', fontStyle: 'italic', margin: 0 },
  charSelect:   { width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.25rem 0.4rem', fontSize: '0.78rem', outline: 'none' },
  cancelAddBtn: { background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.72rem' },
  confirmAddBtn:{ background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.25rem 0.6rem', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 },
}
