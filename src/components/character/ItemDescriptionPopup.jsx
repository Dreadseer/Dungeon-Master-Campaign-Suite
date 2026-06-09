import { useState, useEffect } from 'react'

export default function ItemDescriptionPopup({ item, characterId, onClose, onRefresh }) {
  const [srdItem,     setSrdItem]     = useState(null)
  const [srdLoading,  setSrdLoading]  = useState(false)
  const [equipped,    setEquipped]    = useState(item.equipped ?? false)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [removing,    setRemoving]    = useState(false)

  // Fetch SRD data for SRD-sourced items
  useEffect(() => {
    setSrdItem(null)
    setConfirmDel(false)
    if (item.source === 'srd' && item.source_index) {
      setSrdLoading(true)
      window.electronAPI.srd.getEquipmentByIndex(item.source_index)
        .then(data => { if (data) setSrdItem(data) })
        .catch(() => {})
        .finally(() => setSrdLoading(false))
    }
  }, [item.source_index]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync equipped state when item prop changes (e.g. parent refreshed)
  useEffect(() => { setEquipped(item.equipped ?? false) }, [item.equipped])

  async function handleEquipToggle() {
    const next = !equipped
    setEquipped(next)
    await window.electronAPI.db.characters.updateItem(characterId, item.id, { equipped: next })
    onRefresh()
  }

  async function handleRemove() {
    setRemoving(true)
    await window.electronAPI.db.characters.removeItem(characterId, item.id)
    onRefresh()
    onClose()
  }

  // Resolved display data
  const name        = srdItem?.name   ?? item.name
  const weight      = srdItem?.weight ?? item.weight
  const weightStr   = (() => {
    if (typeof weight === 'object') return weight?.value != null ? `${weight.value} lb` : '—'
    return weight != null ? `${weight} lb` : '—'
  })()
  const cost        = srdItem?.cost
  const costStr     = cost ? `${cost.quantity} ${cost.unit}` : null
  const category    = srdItem?.equipment_category?.name ?? item.category ?? item.item_type ?? null
  const rarity      = item.rarity ?? null
  const properties  = srdItem?.properties?.map(p => p.name).join(', ') ??
                      srdItem?.armor_category ??
                      item.properties ?? null
  const desc        = srdItem?.desc ?? (item.notes ? [item.notes] : null)
  const damageStr   = srdItem?.damage
    ? `${srdItem.damage.damage_dice} ${srdItem.damage.damage_type?.name ?? ''}`
    : null

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={s.itemName}>{name}</h3>
          <div style={s.badgeRow}>
            {category && <span style={s.badge}>{category}</span>}
            {rarity   && <span style={{ ...s.badge, borderColor: rarityColor(rarity), color: rarityColor(rarity) }}>{rarity}</span>}
          </div>
        </div>
        <button style={s.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      <div style={s.scrollBody}>
        {srdLoading && <p style={s.hint}>Loading details…</p>}

        {/* Stats row */}
        <div style={s.statsRow}>
          {costStr  && <StatCell label="Cost"   value={costStr} />}
          <StatCell   label="Weight"  value={weightStr} />
          {damageStr && <StatCell label="Damage" value={damageStr} />}
          <StatCell   label="Qty"     value={String(item.quantity ?? 1)} />
        </div>

        {/* Properties */}
        {properties && (
          <div style={s.section}>
            <p style={s.sectionLabel}>Properties</p>
            <p style={s.sectionText}>{properties}</p>
          </div>
        )}

        {/* Description */}
        {desc && desc.length > 0 && (
          <div style={s.section}>
            <p style={s.sectionLabel}>Description</p>
            {desc.map((para, i) => (
              <p key={i} style={s.descPara}>{para}</p>
            ))}
          </div>
        )}

        {/* No description fallback */}
        {!srdLoading && !desc && !properties && (
          <p style={{ ...s.hint, marginTop: '0.5rem' }}>No additional details available.</p>
        )}
      </div>

      {/* Footer actions */}
      <div style={s.footer}>
        <button
          style={{ ...s.equipBtn, ...(equipped ? s.equipBtnActive : {}) }}
          onClick={handleEquipToggle}
        >
          {equipped ? '🛡 Unequip' : '⚔ Equip'}
        </button>

        {confirmDel ? (
          <div style={s.confirmRow}>
            <span style={{ color: '#da7a6a', fontSize: '0.75rem' }}>Remove?</span>
            <button style={s.confirmYes} onClick={handleRemove} disabled={removing}>
              {removing ? '…' : 'Yes'}
            </button>
            <button style={s.confirmNo} onClick={() => setConfirmDel(false)}>No</button>
          </div>
        ) : (
          <button style={s.removeBtn} onClick={() => setConfirmDel(true)}>
            🗑 Remove
          </button>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatCell({ label, value }) {
  return (
    <div style={{
      background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4,
      padding: '0.28rem 0.5rem', display: 'flex', flexDirection: 'column',
      alignItems: 'center', flex: 1, minWidth: 50,
    }}>
      <span style={{ color: '#6b5a3a', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ color: '#e8e0d0', fontSize: '0.82rem', fontWeight: 600, marginTop: 1 }}>{value}</span>
    </div>
  )
}

function rarityColor(rarity) {
  const r = (rarity ?? '').toLowerCase()
  if (r.includes('legendary')) return '#ff8000'
  if (r.includes('very rare')) return '#9B59B6'
  if (r.includes('rare'))      return '#4A90D9'
  if (r.includes('uncommon'))  return '#2ecc71'
  return '#6b5a3a'
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  panel: {
    width:         280,
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
    padding:      '0.65rem 0.85rem 0.45rem',
    borderBottom: '1px solid #2a1c08',
    flexShrink:   0,
    gap:          '0.4rem',
  },
  itemName: {
    color:      '#c9a84c',
    fontFamily: 'Georgia, serif',
    fontSize:   '1rem',
    margin:     0,
    lineHeight: 1.2,
  },
  badgeRow:  { display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.2rem' },
  badge: {
    fontSize:     '0.65rem',
    border:       '1px solid #3a2a10',
    color:        '#a89060',
    borderRadius: 3,
    padding:      '0.05rem 0.4rem',
    whiteSpace:   'nowrap',
  },
  closeBtn:  { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.9rem', padding: 0, flexShrink: 0, lineHeight: 1, marginTop: 2 },

  scrollBody: { flex: 1, overflowY: 'auto', padding: '0.6rem 0.85rem' },

  statsRow: { display: 'flex', gap: '0.3rem', marginBottom: '0.5rem', flexWrap: 'wrap' },

  section:      { marginBottom: '0.45rem' },
  sectionLabel: { color: '#c9a84c', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.2rem', fontWeight: 700 },
  sectionText:  { color: '#c0b8a8', fontSize: '0.8rem', lineHeight: 1.5, margin: 0 },
  descPara:     { color: '#c0b8a8', fontSize: '0.8rem', lineHeight: 1.55, margin: '0 0 0.35rem' },
  hint:         { color: '#6b5a3a', fontSize: '0.8rem', fontStyle: 'italic', margin: 0 },

  footer: {
    borderTop:   '1px solid #2a1c08',
    padding:     '0.45rem 0.85rem',
    flexShrink:  0,
    display:     'flex',
    gap:         '0.4rem',
    alignItems:  'center',
  },
  equipBtn: {
    flex:        1,
    background:  '#1a1208',
    border:      '1px solid #3a2a10',
    color:       '#a89060',
    borderRadius: 3,
    padding:     '0.28rem 0.4rem',
    cursor:      'pointer',
    fontSize:    '0.78rem',
  },
  equipBtnActive: {
    background:  '#0a2a0a',
    border:      '1px solid #2a5a2a',
    color:       '#7ada7a',
  },
  removeBtn: {
    background:  'none',
    border:      '1px solid #3a1a1a',
    color:       '#8a3a3a',
    borderRadius: 3,
    padding:     '0.28rem 0.5rem',
    cursor:      'pointer',
    fontSize:    '0.78rem',
  },
  confirmRow: { display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: 'auto' },
  confirmYes: { background: '#3a0a0a', border: '1px solid #7a2a2a', color: '#da7a7a', borderRadius: 3, padding: '0.22rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 },
  confirmNo:  { background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.22rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' },
}
