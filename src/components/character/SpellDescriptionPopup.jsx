import { useState, useEffect } from 'react'

const LEVEL_ORDINALS = ['Cantrip','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']

// Returns slots available at spell.level or higher (empty array for cantrips)
function getAvailableSlots(spell, spellSlots) {
  if (!spell.level || spell.level === 0) return []
  const available = []
  for (let lvl = spell.level; lvl <= 9; lvl++) {
    const slot = spellSlots[String(lvl)]
    if (slot && slot.max > 0) {
      available.push({ level: lvl, remaining: slot.max - slot.used, max: slot.max })
    }
  }
  return available
}

export default function SpellDescriptionPopup({ spell, characterId, spellSlots, onClose, onSlotUsed }) {
  const [fullSpell, setFullSpell] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [casting,   setCasting]   = useState(false)
  const [castMsg,   setCastMsg]   = useState('')

  // Fetch full SRD data whenever the selected spell changes
  useEffect(() => {
    setLoading(true)
    setFullSpell(null)
    setCastMsg('')
    setCasting(false)
    window.electronAPI.srd.getSpellByIndex(spell.index)
      .then(data => { if (data) setFullSpell(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [spell.index]) // eslint-disable-line react-hooks/exhaustive-deps

  const availableSlots = getAvailableSlots(spell, spellSlots)
  const isCantrip      = !spell.level || spell.level === 0

  // Resolved display fields — prefer full SRD, fall back to stored spell fields
  const castingTime = fullSpell?.casting_time ?? '—'
  const range       = fullSpell?.range        ?? spell.range ?? '—'
  const duration    = fullSpell?.duration     ?? '—'
  const components  = fullSpell?.components?.join(', ') ?? '—'
  const desc        = fullSpell?.desc         ?? []
  const higherLvl   = fullSpell?.higher_level ?? []
  const classes     = fullSpell?.classes?.map(c => c.name).join(', ') ?? ''
  const isConc      = fullSpell?.concentration ?? false
  const isRitual    = fullSpell?.ritual        ?? false
  const school      = fullSpell?.school?.name  ?? spell.school ?? ''
  const levelStr    = isCantrip ? 'Cantrip' : `Level ${spell.level}`

  async function handleCast(slotLevel) {
    if (casting) return
    setCasting(true)
    try {
      if (slotLevel > 0) {
        await window.electronAPI.db.characters.useSlot(characterId, String(slotLevel))
      }
      const slotEntry   = spellSlots[String(slotLevel)]
      const remaining   = slotEntry ? Math.max(0, slotEntry.max - slotEntry.used - 1) : 0
      const slotLabel   = LEVEL_ORDINALS[slotLevel] ?? `${slotLevel}th`
      const msg = slotLevel === 0
        ? `⚡ ${spell.name} cast!`
        : `⚡ ${spell.name} — ${slotLabel}-level slot used! (${remaining} remaining)`
      setCastMsg(msg)
      // Brief pause so the player sees the confirmation, then close + refresh
      setTimeout(() => onSlotUsed(), 1400)
    } catch {
      setCastMsg('❌ Failed to cast.')
      setCasting(false)
    }
  }

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={s.spellName}>{spell.name}</h3>
          <div style={s.badgeRow}>
            <span style={s.levelBadge}>{levelStr}</span>
            {school   && <span style={{ ...s.levelBadge, textTransform: 'capitalize' }}>{school}</span>}
            {isConc   && <span style={{ ...s.tagBadge, borderColor: '#4A90D9', color: '#4A90D9' }}>Concentration</span>}
            {isRitual && <span style={{ ...s.tagBadge, borderColor: '#9B59B6', color: '#9B59B6' }}>Ritual</span>}
          </div>
        </div>
        <button style={s.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      {/* 4-column stat row */}
      <div style={s.statRow}>
        <StatCell label="Casting Time" value={castingTime} />
        <StatCell label="Range"        value={range}       />
        <StatCell label="Components"   value={components}  />
        <StatCell label="Duration"     value={duration}    />
      </div>

      {/* Scrollable description body */}
      <div style={s.scrollBody}>
        {loading && !fullSpell && <p style={s.hint}>Loading spell details…</p>}

        {/* Description paragraphs */}
        {desc.length > 0 && (
          <div style={s.section}>
            {desc.map((para, i) => <p key={i} style={s.descPara}>{para}</p>)}
          </div>
        )}

        {/* At Higher Levels */}
        {higherLvl.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionLabel}>At Higher Levels</p>
            {higherLvl.map((para, i) => <p key={i} style={s.descPara}>{para}</p>)}
          </div>
        )}

        {/* Classes */}
        {classes && (
          <p style={s.classesLine}>
            <span style={{ color: '#6b5a3a' }}>Classes: </span>{classes}
          </p>
        )}

        {/* Fallback when SRD has no desc */}
        {!loading && desc.length === 0 && (
          <p style={s.hint}>
            {spell.description_short || 'No description available.'}
          </p>
        )}
      </div>

      {/* Cast section */}
      <div style={s.castSection}>
        {castMsg ? (
          /* Success feedback — auto-closes after 1.4 s */
          <div style={s.castMsg}>{castMsg}</div>
        ) : isCantrip ? (
          <button style={s.castBtnCantrip} onClick={() => handleCast(0)} disabled={casting}>
            ⚡ Cast Cantrip
          </button>
        ) : availableSlots.length > 0 ? (
          <div style={s.castBtnGroup}>
            {availableSlots.map(({ level: slotLvl, remaining, max }) => {
              const disabled = remaining === 0 || casting
              return (
                <button
                  key={slotLvl}
                  style={{ ...s.castBtn, ...(disabled ? s.castBtnDisabled : {}) }}
                  disabled={disabled}
                  onClick={() => !disabled && handleCast(slotLvl)}
                  title={disabled ? 'No slots remaining' : `Cast using a ${LEVEL_ORDINALS[slotLvl] ?? slotLvl + 'th'}-level slot`}
                >
                  Cast at {LEVEL_ORDINALS[slotLvl] ?? `${slotLvl}th`} Level
                  <span style={{ marginLeft: 'auto', opacity: 0.7 }}> ({remaining}/{max})</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p style={s.noSlots}>No spell slots available at this level or higher.</p>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCell({ label, value }) {
  return (
    <div style={{
      flex: 1, background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4,
      padding: '0.22rem 0.3rem', display: 'flex', flexDirection: 'column',
      alignItems: 'center', minWidth: 0,
    }}>
      <span style={{ color: '#6b5a3a', fontSize: '0.53rem', textTransform: 'uppercase',
        letterSpacing: '0.04em', lineHeight: 1.2, textAlign: 'center' }}>{label}</span>
      <span style={{ color: '#e8e0d0', fontSize: '0.7rem', fontWeight: 600,
        marginTop: 2, textAlign: 'center', lineHeight: 1.2 }}>{value}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  panel: {
    width:         320,
    flexShrink:    0,
    display:       'flex',
    flexDirection: 'column',
    background:    '#0a0805',
    border:        '1px solid #2a1c08',
    borderRadius:  6,
    overflow:      'hidden',
  },

  header: {
    display:      'flex',
    alignItems:   'flex-start',
    padding:      '0.6rem 0.8rem 0.4rem',
    borderBottom: '1px solid #2a1c08',
    flexShrink:   0,
    gap:          '0.4rem',
  },
  spellName: {
    color:      '#c9a84c',
    fontFamily: 'Georgia, serif',
    fontSize:   '0.98rem',
    margin:     '0 0 0.22rem',
    lineHeight: 1.2,
  },
  badgeRow:  { display: 'flex', gap: '0.25rem', flexWrap: 'wrap' },
  levelBadge:{ fontSize: '0.63rem', background: '#1a1208', border: '1px solid #3a2a10',
    color: '#a89060', borderRadius: 3, padding: '0.05rem 0.38rem' },
  tagBadge:  { fontSize: '0.63rem', background: '#0a0805', border: '1px solid',
    borderRadius: 3, padding: '0.05rem 0.38rem' },
  closeBtn:  { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer',
    fontSize: '0.9rem', padding: 0, flexShrink: 0, lineHeight: 1, marginTop: 2 },

  statRow: {
    display:      'flex',
    gap:          '0.22rem',
    padding:      '0.38rem 0.65rem',
    borderBottom: '1px solid #1a1208',
    flexShrink:   0,
  },

  scrollBody: { flex: 1, overflowY: 'auto', padding: '0.5rem 0.8rem', minHeight: 0 },

  section:      { marginBottom: '0.4rem' },
  sectionLabel: { color: '#c9a84c', fontSize: '0.63rem', textTransform: 'uppercase',
    letterSpacing: '0.05em', margin: '0 0 0.18rem', fontWeight: 700 },
  descPara:     { color: '#c0b8a8', fontSize: '0.79rem', lineHeight: 1.55, margin: '0 0 0.32rem' },
  classesLine:  { color: '#c0b8a8', fontSize: '0.73rem', margin: '0.3rem 0 0', fontStyle: 'italic' },
  hint:         { color: '#6b5a3a', fontSize: '0.79rem', fontStyle: 'italic', margin: 0 },

  castSection: {
    borderTop:  '1px solid #2a1c08',
    padding:    '0.5rem 0.7rem',
    flexShrink: 0,
  },
  castBtnGroup: { display: 'flex', flexDirection: 'column', gap: '0.28rem' },
  castBtn: {
    display:      'flex',
    alignItems:   'center',
    background:   '#1a1208',
    border:       '1px solid #c9a84c',
    color:        '#c9a84c',
    borderRadius: 4,
    padding:      '0.32rem 0.6rem',
    cursor:       'pointer',
    fontSize:     '0.77rem',
    fontWeight:   600,
    width:        '100%',
    textAlign:    'left',
    transition:   'background 0.1s',
  },
  castBtnDisabled: {
    opacity:     0.33,
    cursor:      'not-allowed',
    borderColor: '#3a2a10',
    color:       '#6b5a3a',
  },
  castBtnCantrip: {
    background:   '#140a20',
    border:       '1px solid #9B59B6',
    color:        '#b07ada',
    borderRadius: 4,
    padding:      '0.32rem 0.6rem',
    cursor:       'pointer',
    fontSize:     '0.77rem',
    fontWeight:   600,
    width:        '100%',
  },
  castMsg: {
    color:        '#8ada6a',
    fontSize:     '0.8rem',
    fontWeight:   600,
    textAlign:    'center',
    padding:      '0.3rem 0.5rem',
    background:   '#0a180a',
    border:       '1px solid #2a4a1a',
    borderRadius: 4,
  },
  noSlots: {
    color:        '#6b5a3a',
    fontSize:     '0.77rem',
    fontStyle:    'italic',
    margin:       0,
    textAlign:    'center',
  },
}
