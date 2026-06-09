import { useState, useEffect } from 'react'
import { calculateAC } from '../../utils/acUtils'

/**
 * Expandable AC breakdown panel.
 * Shows the full formula string and lets the DM set a manual override
 * (e.g. Wild Shape, Mage Armor) or a magic AC bonus (Ring of Protection, etc.)
 *
 * Props:
 *   character  — raw character record (needs .stats, .inventory, .class, ._stats)
 *   onRefresh  — callback to re-load character after saving changes
 */
export default function ACBreakdownPanel({ character, onRefresh }) {
  const [expanded,    setExpanded]    = useState(false)
  const [overrideVal, setOverrideVal] = useState('')   // '' = cleared (use auto)
  const [magicBonus,  setMagicBonus]  = useState('0')

  // Sync local inputs when character switches (not on every refresh,
  // to avoid resetting values while the user is typing)
  useEffect(() => {
    const s = character._stats ?? {}
    setOverrideVal(s.ac_override != null ? String(s.ac_override) : '')
    setMagicBonus(String(s.ac_magic_bonus ?? 0))
  }, [character.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute the live breakdown string (uses same engine as the chip)
  const acResult = calculateAC(character)

  // ── Save helpers ──────────────────────────────────────────────────────────
  async function saveOverride(val) {
    const trimmed = val.trim()
    const parsed  = trimmed === '' ? null : parseInt(trimmed, 10)
    if (trimmed !== '' && isNaN(parsed)) return  // ignore invalid input
    await window.electronAPI.db.characters.updateAC(character.id, { ac_override: parsed })
    onRefresh()
  }

  async function saveMagicBonus(val) {
    const parsed = Math.max(0, parseInt(val, 10) || 0)
    setMagicBonus(String(parsed))
    await window.electronAPI.db.characters.updateAC(character.id, { ac_magic_bonus: parsed })
    onRefresh()
  }

  return (
    <div style={s.root}>
      {/* Toggle button */}
      <button style={s.toggleBtn} onClick={() => setExpanded(e => !e)}>
        {expanded ? '▲' : '▼'} AC Breakdown
      </button>

      {expanded && (
        <div style={s.body}>
          {/* Formula string */}
          <div style={s.formulaRow}>
            <span style={s.formulaText}>{acResult.breakdown}</span>
          </div>

          {/* Two override inputs side-by-side */}
          <div style={s.fieldsRow}>

            {/* Manual AC Override */}
            <div style={s.fieldBlock}>
              <label style={s.fieldLabel}>Manual AC Override</label>
              <input
                style={s.fieldInput}
                type="number"
                min="1"
                max="30"
                value={overrideVal}
                placeholder="— auto —"
                onChange={e => setOverrideVal(e.target.value)}
                onBlur={e  => saveOverride(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveOverride(overrideVal) }}
              />
              <span style={s.fieldHint}>Use for Wild Shape, Mage Armor, or homebrew AC.</span>
              {overrideVal !== '' && (
                <button
                  style={s.clearBtn}
                  onClick={() => { setOverrideVal(''); saveOverride('') }}
                >
                  ✕ Clear override
                </button>
              )}
            </div>

            {/* Magic AC Bonus */}
            <div style={s.fieldBlock}>
              <label style={s.fieldLabel}>Magic AC Bonus</label>
              <input
                style={s.fieldInput}
                type="number"
                min="0"
                max="10"
                value={magicBonus}
                onChange={e => setMagicBonus(e.target.value)}
                onBlur={e  => saveMagicBonus(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveMagicBonus(magicBonus) }}
              />
              <span style={s.fieldHint}>Ring of Protection, Cloak of Protection, etc.</span>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  root: {
    marginTop:    '0.5rem',
    border:       '1px solid #2a1c08',
    borderRadius: 5,
    overflow:     'hidden',
  },

  toggleBtn: {
    width:      '100%',
    background: '#0d0a05',
    border:     'none',
    color:      '#a89060',
    fontSize:   '0.75rem',
    padding:    '0.35rem 0.65rem',
    cursor:     'pointer',
    textAlign:  'left',
    letterSpacing: '0.03em',
  },

  body: {
    background: '#0a0805',
    padding:    '0.6rem 0.8rem 0.75rem',
    borderTop:  '1px solid #1a1208',
  },

  formulaRow: {
    background:   '#0d0a05',
    border:       '1px solid #1a1208',
    borderRadius: 4,
    padding:      '0.4rem 0.65rem',
    marginBottom: '0.65rem',
  },
  formulaText: {
    color:      '#c9a84c',
    fontFamily: 'Georgia, serif',
    fontSize:   '0.82rem',
    lineHeight: 1.4,
  },

  fieldsRow: {
    display: 'flex',
    gap:     '0.75rem',
    flexWrap:'wrap',
  },

  fieldBlock: {
    display:       'flex',
    flexDirection: 'column',
    gap:           '0.2rem',
    flex:          1,
    minWidth:      140,
  },
  fieldLabel: {
    color:         '#c9a84c',
    fontSize:      '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight:    700,
  },
  fieldInput: {
    background:   '#0d0a05',
    border:       '1px solid #3a2a10',
    borderRadius: 3,
    color:        '#e8e0d0',
    fontSize:     '0.88rem',
    padding:      '0.28rem 0.5rem',
    outline:      'none',
    width:        '100%',
    boxSizing:    'border-box',
  },
  fieldHint: {
    color:     '#6b5a3a',
    fontSize:  '0.62rem',
    fontStyle: 'italic',
    lineHeight: 1.3,
  },
  clearBtn: {
    background:  'none',
    border:      '1px solid #5a2a2a',
    color:       '#a06060',
    borderRadius: 3,
    padding:     '0.15rem 0.4rem',
    cursor:      'pointer',
    fontSize:    '0.65rem',
    marginTop:   '0.1rem',
    alignSelf:   'flex-start',
  },
}
