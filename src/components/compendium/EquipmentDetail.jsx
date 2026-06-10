import { useState, useEffect } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import PdfImportPanel   from './PdfImportPanel'

export default function EquipmentDetail({ index, onClose }) {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const [item,       setItem]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [toast,          setToast]          = useState('')
  const [showPdfImport,  setShowPdfImport]  = useState(false)
  const [pdfImportQuery, setPdfImportQuery] = useState('')

  // Add-to-inventory flow
  const [addMode,    setAddMode]    = useState(false)
  const [characters, setCharacters] = useState([])
  const [selCharId,  setSelCharId]  = useState('')
  const [quantity,   setQuantity]   = useState(1)
  const [adding,     setAdding]     = useState(false)

  useEffect(() => {
    setLoading(true)
    setItem(null)
    setAddMode(false)
    window.electronAPI.srd.getEquipmentByIndex(index)
      .then(e => { setItem(e); setLoading(false) })
      .catch(() => setLoading(false))
  }, [index])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function openAddMode() {
    setAddMode(true)
    setQuantity(1)
    if (!activeCampaign) return
    const chars = await window.electronAPI.db.characters.getAll(activeCampaign.id).catch(() => [])
    setCharacters(chars)
    if (chars.length > 0) setSelCharId(String(chars[0].id))
  }

  async function confirmAdd() {
    if (!selCharId || !item) return
    setAdding(true)
    try {
      const w = typeof item.weight === 'object' ? (item.weight?.value ?? 0) : (item.weight ?? 0)
      await window.electronAPI.db.characters.addItem(Number(selCharId), {
        name:         item.name,
        quantity:     quantity,
        weight:       w,
        equipped:     false,
        source:       'srd',
        source_index: item.index,
        notes:        '',
      })
      const char = characters.find(c => c.id === Number(selCharId))
      showToast(`✓ ${item.name} added to ${char?.character_name ?? 'character'}'s inventory.`)
    } catch {
      showToast('Failed to add item.')
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

  if (!item) return (
    <div style={s.panel}>
      <div style={s.panelHeader}>
        <span style={s.iName}>Not found</span>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>
      <p style={s.msg}>Item data not available.</p>
    </div>
  )

  const isWeapon = item.weapon_category || item.weapon_range
  const isArmor  = item.armor_category  || item.armor_class

  return (
    <div style={s.panel}>
      {toast && <div style={s.toast}>{toast}</div>}

      {/* Header */}
      <div style={s.panelHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={s.iName}>{item.name}</h2>
          <p style={s.iSub}>{item.equipment_category?.name ?? item.equipment_category ?? '—'}</p>
        </div>
        <button style={s.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      <div style={s.scrollBody}>
        {/* Core stats */}
        <div style={s.statGrid}>
          <StatCell label="Cost"   value={formatCost(item.cost)} />
          <StatCell label="Weight" value={formatWeight(item.weight)} />
        </div>

        <hr style={s.divider} />

        {/* Weapon section */}
        {isWeapon && (
          <Section title="Weapon">
            <PropRow label="Category"    value={item.weapon_category} />
            <PropRow label="Range"       value={item.weapon_range} />
            <PropRow label="Damage"      value={formatDamage(item.damage)} />
            <PropRow label="Two-Handed"  value={formatDamage(item.two_handed_damage)} />
            <PropRow label="Properties"  value={item.properties?.map(p => p.name).join(', ')} />
            <PropRow label="Throw Range" value={formatRange(item.throw_range)} />
            <PropRow label="Range"       value={formatRange(item.range)} />
          </Section>
        )}

        {/* Armor section */}
        {isArmor && (
          <Section title="Armor">
            <PropRow label="Category"         value={item.armor_category} />
            <PropRow label="Base AC"          value={item.armor_class ? formatAC(item.armor_class) : null} />
            <PropRow label="Min Strength"     value={item.str_minimum > 0 ? `${item.str_minimum}` : null} />
            <PropRow label="Stealth"          value={item.stealth_disadvantage ? 'Disadvantage' : null} />
          </Section>
        )}

        {/* Gear / tools — description */}
        {item.desc?.length > 0 && (
          <Section title="Description">
            {(Array.isArray(item.desc) ? item.desc : [item.desc]).map((d, i) => (
              <p key={i} style={s.descPara}>{d}</p>
            ))}
          </Section>
        )}

        {/* Contents (packs) */}
        {item.contents?.length > 0 && (
          <Section title="Contents">
            {item.contents.map((c, i) => (
              <p key={i} style={s.descPara}>
                {c.item?.name ?? c.item} × {c.quantity}
              </p>
            ))}
          </Section>
        )}
      </div>

      {/* Footer */}
      <div style={s.footer}>
        {addMode ? (
          <div style={s.addFlow}>
            {!activeCampaign ? (
              <p style={s.addMsg}>Select a campaign first.</p>
            ) : characters.length === 0 ? (
              <p style={s.addMsg}>No characters in this campaign yet.</p>
            ) : (
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <select style={s.charSelect} value={selCharId}
                  onChange={e => setSelCharId(e.target.value)}>
                  {characters.map(c => (
                    <option key={c.id} value={c.id}>{c.character_name}</option>
                  ))}
                </select>
                <label style={s.qtyLabel}>×
                  <input style={s.qtyInput} type="number" min="1" value={quantity}
                    onChange={e => setQuantity(Math.max(1, Number(e.target.value)))} />
                </label>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.3rem' }}>
              <button style={s.cancelAddBtn} onClick={() => setAddMode(false)}>Cancel</button>
              {activeCampaign && characters.length > 0 && (
                <button style={s.confirmAddBtn} onClick={confirmAdd} disabled={adding}>
                  {adding ? 'Adding…' : 'Add to Inventory'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <button style={s.actionBtn} onClick={openAddMode}>
              + Add to Inventory
            </button>
            <button style={s.findPdfBtn} onClick={() => {
              setPdfImportQuery(item.name)
              setShowPdfImport(true)
            }}>
              🔍 Find in my PDFs
            </button>
          </>
        )}
      </div>

      {showPdfImport && (
        <PdfImportPanel
          campaignId={activeCampaign?.id}
          initialQuery={pdfImportQuery}
          onImportComplete={() => setShowPdfImport(false)}
          onClose={() => setShowPdfImport(false)}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCell({ label, value }) {
  return (
    <div style={s.statCell}>
      <span style={s.statLabel}>{label}</span>
      <span style={s.statVal}>{value ?? '—'}</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={s.section}>
      <h3 style={s.sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

function PropRow({ label, value }) {
  if (!value) return null
  return (
    <p style={s.propRow}>
      <span style={s.propLabel}>{label}: </span>
      <span style={s.propValue}>{value}</span>
    </p>
  )
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCost(cost) {
  if (!cost) return '—'
  return `${cost.quantity ?? '?'} ${cost.unit ?? ''}`
}

function formatWeight(weight) {
  if (!weight && weight !== 0) return '—'
  if (typeof weight === 'object') return `${weight.value ?? '?'} ${weight.unit ?? 'lb'}`
  return `${weight} lb`
}

function formatDamage(dmg) {
  if (!dmg) return null
  return `${dmg.damage_dice ?? '—'} ${dmg.damage_type?.name ?? ''}`
}

function formatAC(ac) {
  if (!ac) return null
  const base  = ac.base ?? '—'
  const parts = [String(base)]
  if (ac.dex_bonus)    parts.push('+ Dex modifier')
  if (ac.max_bonus != null) parts.push(`(max +${ac.max_bonus})`)
  return parts.join(' ')
}

function formatRange(range) {
  if (!range) return null
  if (range.normal && range.long) return `${range.normal}/${range.long} ft.`
  if (range.normal) return `${range.normal} ft.`
  return null
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  panel: {
    width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
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
  iName:    { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.05rem', margin: 0 },
  iSub:     { color: '#a89060', fontSize: '0.73rem', margin: '0.15rem 0 0', fontStyle: 'italic' },
  closeBtn: { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.9rem', padding: 0, lineHeight: 1, flexShrink: 0 },

  scrollBody: { flex: 1, overflowY: 'auto', padding: '0.65rem 0.85rem' },
  msg:        { color: '#6b5a3a', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' },

  statGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginBottom: '0.45rem' },
  statCell:  { background: '#0d0a05', borderRadius: 4, padding: '0.3rem 0.5rem' },
  statLabel: { display: 'block', color: '#6b5a3a', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em' },
  statVal:   { display: 'block', color: '#c9a84c', fontSize: '0.88rem', fontWeight: 700 },

  divider: { border: 'none', borderTop: '1px solid #2a1c08', margin: '0.45rem 0' },

  section:      { marginBottom: '0.5rem' },
  sectionTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.82rem', fontWeight: 700, borderBottom: '1px solid #2a1c08', paddingBottom: '0.2rem', margin: '0.4rem 0 0.3rem' },

  propRow:   { margin: '0.18rem 0', fontSize: '0.8rem', lineHeight: 1.45 },
  propLabel: { color: '#6b5a3a' },
  propValue: { color: '#e8e0d0' },

  descPara: { color: '#a89060', fontSize: '0.78rem', lineHeight: 1.5, margin: '0 0 0.3rem' },

  footer:       { borderTop: '1px solid #2a1c08', padding: '0.45rem 0.85rem', flexShrink: 0 },
  actionBtn:    { width: '100%', background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.3rem 0.4rem', cursor: 'pointer', fontSize: '0.75rem', marginBottom: '0.3rem' },
  findPdfBtn:   { width: '100%', background: 'transparent', border: '1px solid #1a3a6a', color: '#4A90D9', borderRadius: 3, padding: '0.28rem 0.4rem', cursor: 'pointer', fontSize: '0.72rem' },
  addFlow:      { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  addMsg:       { color: '#6b5a3a', fontSize: '0.75rem', fontStyle: 'italic', margin: 0 },
  charSelect:   { flex: 1, background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '0.25rem 0.4rem', fontSize: '0.78rem', outline: 'none' },
  qtyLabel:     { display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#6b5a3a', fontSize: '0.75rem', flexShrink: 0 },
  qtyInput:     { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 3, color: '#e8e0d0', padding: '0.25rem 0.3rem', fontSize: '0.78rem', outline: 'none', width: 44, textAlign: 'center' },
  cancelAddBtn: { background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.72rem' },
  confirmAddBtn:{ background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.25rem 0.6rem', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 },
}
