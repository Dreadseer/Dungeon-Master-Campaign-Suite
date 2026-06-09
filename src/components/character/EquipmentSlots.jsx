import { useState } from 'react'
import { getEquippedBySlot } from '../../utils/attackUtils'

const SLOT_ORDER = [
  'Main Hand', 'Off Hand',
  'Armor',     'Helmet',
  'Ring 1',    'Ring 2',
  'Boots',     'Cloak',
]

const SLOT_ICONS = {
  'Main Hand': '⚔',
  'Off Hand':  '🛡',
  'Armor':     '🧥',
  'Helmet':    '🪖',
  'Ring 1':    '💍',
  'Ring 2':    '💍',
  'Boots':     '👢',
  'Cloak':     '🧣',
}

export default function EquipmentSlots({ inventory, characterId, onRefresh }) {
  const slotMap   = getEquippedBySlot(inventory)
  const [activeSlot, setActiveSlot] = useState(null)  // slot name with open tooltip

  async function handleUnequip(item) {
    await window.electronAPI.db.characters.updateItem(characterId, item.id, { equipped: false })
    setActiveSlot(null)
    onRefresh()
  }

  return (
    <div style={s.root}>
      <p style={s.title}>Equipment</p>
      <div style={s.grid}>
        {SLOT_ORDER.map(slot => {
          const item    = slotMap[slot]
          const isOpen  = activeSlot === slot
          const isEmpty = !item

          return (
            <div key={slot} style={{ position: 'relative' }}>
              <div
                style={{
                  ...s.slot,
                  ...(isEmpty ? {} : s.slotFilled),
                  ...(isOpen  ? s.slotActive : {}),
                }}
                onClick={() => !isEmpty && setActiveSlot(isOpen ? null : slot)}
                title={isEmpty ? `${slot} — empty` : `${slot}: ${item.name}`}
              >
                <span style={s.slotIcon}>{SLOT_ICONS[slot]}</span>
                <div style={s.slotText}>
                  <span style={s.slotName}>{slot}</span>
                  <span style={{ ...s.slotItem, color: isEmpty ? '#3a2a10' : '#c9a84c' }}>
                    {isEmpty ? '— empty —' : item.name}
                  </span>
                </div>
              </div>

              {/* Tooltip */}
              {isOpen && item && (
                <div style={s.tooltip} onClick={e => e.stopPropagation()}>
                  <p style={s.tooltipName}>{item.name}</p>
                  {item.notes && <p style={s.tooltipNotes}>{item.notes}</p>}
                  <button style={s.unequipBtn} onClick={() => handleUnequip(item)}>
                    Unequip
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Click-outside to close */}
      {activeSlot && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9 }}
          onClick={() => setActiveSlot(null)}
        />
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  root: {
    flexShrink:  0,
    background:  '#0a0805',
    border:      '1px solid #2a1c08',
    borderRadius: 5,
    padding:     '0.5rem 0.75rem',
  },
  title: {
    color:         '#c9a84c',
    fontFamily:    'Georgia, serif',
    fontSize:      '0.78rem',
    fontWeight:    700,
    margin:        '0 0 0.4rem',
    borderBottom:  '1px solid #2a1c08',
    paddingBottom: '0.25rem',
  },
  grid: {
    display:             'grid',
    gridTemplateColumns: '1fr 1fr',
    gap:                 '0.3rem',
  },

  slot: {
    display:      'flex',
    alignItems:   'center',
    gap:          '0.35rem',
    background:   '#0d0a05',
    border:       '1px solid #1a1208',
    borderRadius: 4,
    padding:      '0.3rem 0.45rem',
    cursor:       'default',
    transition:   'border-color 0.1s',
    userSelect:   'none',
  },
  slotFilled: {
    border:  '1px solid #3a2a10',
    cursor:  'pointer',
  },
  slotActive: {
    borderColor: '#c9a84c',
    background:  '#1a1208',
    zIndex:      10,
    position:    'relative',
  },
  slotIcon: { fontSize: '0.85rem', flexShrink: 0, lineHeight: 1 },
  slotText: { display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden', flex: 1 },
  slotName: { color: '#6b5a3a', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1 },
  slotItem: {
    fontSize:    '0.75rem',
    fontWeight:  600,
    overflow:    'hidden',
    textOverflow:'ellipsis',
    whiteSpace:  'nowrap',
    lineHeight:  1.2,
  },

  // Tooltip
  tooltip: {
    position:     'absolute',
    top:          '100%',
    left:         0,
    zIndex:       20,
    background:   '#12100a',
    border:       '1px solid #3a2a10',
    borderRadius: 5,
    padding:      '0.5rem 0.65rem',
    minWidth:     160,
    boxShadow:    '0 4px 16px rgba(0,0,0,0.5)',
    marginTop:    2,
  },
  tooltipName:  { color: '#e8e0d0', fontSize: '0.83rem', fontWeight: 700, margin: '0 0 0.2rem', fontFamily: 'Georgia, serif' },
  tooltipNotes: { color: '#a89060', fontSize: '0.73rem', fontStyle: 'italic', margin: '0 0 0.35rem' },
  unequipBtn: {
    background:   '#2a0a0a',
    border:       '1px solid #5a1a1a',
    color:        '#da9a9a',
    borderRadius: 3,
    padding:      '0.22rem 0.6rem',
    cursor:       'pointer',
    fontSize:     '0.75rem',
    width:        '100%',
  },
}
