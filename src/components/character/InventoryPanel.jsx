import { useState, useRef } from 'react'
import useCampaignStore      from '../../stores/campaignStore'
import CurrencyWallet        from './CurrencyWallet'
import EquipmentSlots        from './EquipmentSlots'
import ItemDescriptionPopup  from './ItemDescriptionPopup'

// Carrying capacity: STR score × 15 lbs
const carryCapacity = (strScore) => (strScore ?? 10) * 15

function totalWeight(inventory) {
  return inventory.reduce((sum, item) => sum + ((item.weight ?? 0) * (item.quantity ?? 1)), 0)
}

function fmtWeight(w) {
  const n = parseFloat(w)
  return isNaN(n) ? '—' : Number.isInteger(n) ? `${n}` : n.toFixed(1)
}

export default function InventoryPanel({ characterId, character, onRefresh }) {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const inventory   = character._inventory ?? []
  const stats       = character._stats     ?? {}
  const strScore    = stats.str ?? 10
  const capacity    = carryCapacity(strScore)
  const carried     = totalWeight(inventory)
  const overWeight  = carried > capacity
  const currency    = stats.currency ?? { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 }

  const [showPicker,   setShowPicker]   = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)

  // ── Edit quantity inline ─────────────────────────────────────────────────
  const [editQty, setEditQty] = useState(null)   // itemId
  const [editVal, setEditVal] = useState('')

  async function commitQty(itemId) {
    const qty = parseInt(editVal, 10)
    if (!isNaN(qty) && qty > 0) {
      await window.electronAPI.db.characters.updateItem(characterId, itemId, { quantity: qty })
      onRefresh()
    }
    setEditQty(null)
  }

  async function toggleEquipped(item) {
    await window.electronAPI.db.characters.updateItem(characterId, item.id, { equipped: !item.equipped })
    onRefresh()
  }

  async function removeItem(itemId) {
    await window.electronAPI.db.characters.removeItem(characterId, itemId)
    // close popup if the removed item was open
    if (selectedItem?.id === itemId) setSelectedItem(null)
    onRefresh()
  }

  function openItemDetail(item) {
    setSelectedItem(item)
    setShowPicker(false)
  }

  function openPicker() {
    setShowPicker(true)
    setSelectedItem(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      {/* ── Left pane: currency + equipment + inventory list ── */}
      <div style={s.leftPane}>
        {/* Currency wallet */}
        <CurrencyWallet
          currency={currency}
          characterId={characterId}
          onRefresh={onRefresh}
        />

        {/* Equipment slots */}
        <EquipmentSlots
          inventory={inventory}
          characterId={characterId}
          onRefresh={onRefresh}
        />

        {/* Inventory list */}
        <div style={s.listCol}>
          {/* Weight bar */}
          <div style={s.weightBar}>
            <span style={{ color: overWeight ? '#da7a7a' : '#a89060', fontSize: '0.78rem' }}>
              ⚖ Carrying <strong>{fmtWeight(carried)}</strong> / {capacity} lbs
            </span>
            <div style={s.weightTrack}>
              <div style={{
                ...s.weightFill,
                width:      `${Math.min(100, (carried / capacity) * 100)}%`,
                background: overWeight ? '#8B0000' : '#2D7A2D',
              }} />
            </div>
          </div>

          {/* Column headers */}
          {inventory.length > 0 && (
            <div style={s.colHeader}>
              <span style={{ width: 22, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>Item</span>
              <span style={s.colQty}>Qty</span>
              <span style={s.colWt}>Wt (ea)</span>
              <span style={s.colTotal}>Total</span>
              <span style={{ width: 24, flexShrink: 0 }} />
            </div>
          )}

          {/* Rows */}
          {inventory.length === 0 ? (
            <p style={s.empty}>No items yet. Add from the Compendium or manually.</p>
          ) : (
            inventory.map(item => (
              <div key={item.id} style={s.row}>
                {/* Equipped toggle */}
                <button
                  style={{ ...s.equipBtn, color: item.equipped ? '#c9a84c' : '#3a2a10' }}
                  title={item.equipped ? 'Unequip' : 'Equip'}
                  onClick={() => toggleEquipped(item)}
                >🛡</button>

                {/* Name (clickable to open popup) + notes */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={s.itemName}
                    onClick={() => openItemDetail(item)}
                    title="View details"
                  >
                    {item.name}
                  </span>
                  {item.notes && <span style={s.itemNotes}> · {item.notes}</span>}
                </div>

                {/* Quantity */}
                <div style={{ ...s.colQty, display: 'flex', alignItems: 'center', gap: 2 }}>
                  {editQty === item.id ? (
                    <input
                      style={s.qtyInput}
                      type="number" min="1" value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => commitQty(item.id)}
                      onKeyDown={e => { if (e.key === 'Enter') commitQty(item.id) }}
                      autoFocus
                    />
                  ) : (
                    <>
                      <button style={s.qtyBtn}
                        onClick={async () => { await window.electronAPI.db.characters.updateItem(characterId, item.id, { quantity: Math.max(1, (item.quantity ?? 1) - 1) }); onRefresh() }}>−</button>
                      <span style={s.qtyVal}
                        onClick={() => { setEditQty(item.id); setEditVal(String(item.quantity ?? 1)) }}>
                        {item.quantity ?? 1}
                      </span>
                      <button style={s.qtyBtn}
                        onClick={async () => { await window.electronAPI.db.characters.updateItem(characterId, item.id, { quantity: (item.quantity ?? 1) + 1 }); onRefresh() }}>＋</button>
                    </>
                  )}
                </div>

                {/* Weight per unit */}
                <span style={s.colWt}>{fmtWeight(item.weight ?? 0)} lb</span>

                {/* Total weight */}
                <span style={s.colTotal}>{fmtWeight((item.weight ?? 0) * (item.quantity ?? 1))} lb</span>

                {/* Remove */}
                <button style={s.removeBtn} onClick={() => removeItem(item.id)} title="Remove">🗑</button>
              </div>
            ))
          )}

          <button style={s.addBtn} onClick={openPicker}>＋ Add Item</button>
        </div>
      </div>

      {/* ── Right panel: item picker OR item description ── */}
      {showPicker && (
        <ItemPicker
          characterId={characterId}
          campaignId={activeCampaign?.id}
          onAdd={() => { setShowPicker(false); onRefresh() }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {selectedItem && !showPicker && (
        <ItemDescriptionPopup
          item={selectedItem}
          characterId={characterId}
          onClose={() => setSelectedItem(null)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

// ── Item Picker ───────────────────────────────────────────────────────────────
// (unchanged from original implementation)

function ItemPicker({ characterId, campaignId, onAdd, onClose }) {
  const [query,      setQuery]      = useState('')
  const [allItems,   setAllItems]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState(null)
  const [quantity,   setQuantity]   = useState(1)
  const [adding,     setAdding]     = useState(false)
  const [showManual, setShowManual] = useState(false)

  // Manual form
  const [mName,   setMName]   = useState('')
  const [mQty,    setMQty]    = useState(1)
  const [mWeight, setMWeight] = useState('')
  const [mNotes,  setMNotes]  = useState('')

  const debounceRef = useRef(null)

  // Load SRD equipment + custom compendium on mount
  useState(() => {
    async function fetchAll() {
      setLoading(true)
      const [srd, custom] = await Promise.all([
        window.electronAPI.srd.getEquipment({}).catch(() => []),
        campaignId
          ? window.electronAPI.db.compendium.getAll(campaignId, 'equipment').catch(() => [])
          : Promise.resolve([]),
      ])
      const srdItems = srd.map(e => ({
        name: e.name, index: e.index,
        weight: typeof e.weight === 'object' ? (e.weight?.value ?? 0) : (e.weight ?? 0),
        category: e.equipment_category ?? '—',
        source: 'srd',
      }))
      const customItems = custom.map(e => {
        let d = {}; try { d = JSON.parse(e.data ?? '{}') } catch { /* empty */ }
        return {
          name: e.name, id: e.id,
          weight: parseFloat(d.weight ?? 0) || 0,
          category: d.category ?? 'Equipment',
          source: 'custom',
        }
      })
      setAllItems([...srdItems, ...customItems])
      setLoading(false)
    }
    fetchAll()
  })

  const filtered = query.trim()
    ? allItems.filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
    : allItems

  async function addItem() {
    if (!selected) return
    setAdding(true)
    await window.electronAPI.db.characters.addItem(characterId, {
      name:         selected.name,
      quantity:     quantity,
      weight:       selected.weight,
      equipped:     false,
      source:       selected.source,
      source_index: selected.index ?? null,
      notes:        '',
    })
    setAdding(false)
    onAdd()
  }

  async function addManual(e) {
    e.preventDefault()
    if (!mName.trim()) return
    setAdding(true)
    await window.electronAPI.db.characters.addItem(characterId, {
      name:     mName.trim(),
      quantity: Number(mQty) || 1,
      weight:   parseFloat(mWeight) || 0,
      equipped: false,
      source:   'manual',
      source_index: null,
      notes:    mNotes.trim(),
    })
    setAdding(false)
    onAdd()
  }

  return (
    <div style={s.picker}>
      <div style={s.pickerHeader}>
        <span style={s.pickerTitle}>{showManual ? 'Add Manually' : 'Item Picker'}</span>
        <button style={s.pickerClose} onClick={onClose}>✕</button>
      </div>

      {showManual ? (
        <form onSubmit={addManual} style={s.manualForm}>
          <input style={s.pickerSearch} placeholder="Item name *" value={mName}
            onChange={e => setMName(e.target.value)} autoFocus />
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <label style={s.mLabel}>Qty
              <input style={{ ...s.pickerSearch, width: 60 }} type="number" min="1"
                value={mQty} onChange={e => setMQty(e.target.value)} />
            </label>
            <label style={s.mLabel}>Weight (lb)
              <input style={{ ...s.pickerSearch, flex: 1 }} type="number" min="0" step="0.5"
                value={mWeight} onChange={e => setMWeight(e.target.value)} placeholder="0" />
            </label>
          </div>
          <input style={s.pickerSearch} placeholder="Notes (optional)" value={mNotes}
            onChange={e => setMNotes(e.target.value)} />
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: 4 }}>
            <button type="button" style={s.pickerCancelBtn} onClick={() => setShowManual(false)}>Back</button>
            <button type="submit" style={s.pickerAddBtn} disabled={adding || !mName.trim()}>
              {adding ? 'Adding…' : 'Add Item'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <input style={s.pickerSearch} placeholder="Search items…" value={query}
            onChange={e => setQuery(e.target.value)} autoFocus />

          <div style={s.pickerList}>
            {loading ? (
              <p style={s.pickerMsg}>Loading…</p>
            ) : filtered.length === 0 ? (
              <p style={s.pickerMsg}>No items found.</p>
            ) : (
              filtered.map((item, idx) => (
                <div key={item.index ?? item.id ?? idx}
                  style={selected === item ? { ...s.pickerRow, ...s.pickerRowSel } : s.pickerRow}
                  onClick={() => { setSelected(item); setQuantity(1) }}>
                  <span style={s.pickerName}>{item.name}</span>
                  <span style={s.pickerCat}>{item.category}</span>
                  {item.source === 'custom' && <span style={s.brewTag}>HB</span>}
                </div>
              ))
            )}
          </div>

          {selected && (
            <div style={s.pickerAdd}>
              <span style={s.pickerSelName}>{selected.name}</span>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <label style={s.mLabel}>Qty
                  <input style={{ ...s.pickerSearch, width: 55 }} type="number" min="1"
                    value={quantity} onChange={e => setQuantity(Number(e.target.value))} />
                </label>
                <button style={s.pickerAddBtn} onClick={addItem} disabled={adding}>
                  {adding ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          )}

          <button style={s.manualBtn} onClick={() => setShowManual(true)}>＋ Add Manually</button>
        </>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  root:     { display: 'flex', flex: 1, gap: '0.75rem', overflow: 'hidden', padding: '0.85rem 1.5rem' },
  leftPane: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', gap: '0.4rem', minWidth: 0 },
  listCol:  { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', gap: '0.3rem', minHeight: 0 },

  weightBar:   { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.15rem', flexShrink: 0 },
  weightTrack: { height: 6, background: '#1a1208', borderRadius: 3, overflow: 'hidden' },
  weightFill:  { height: '100%', borderRadius: 3, transition: 'width 0.3s ease' },

  colHeader: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.2rem 0.5rem', color: '#6b5a3a', fontSize: '0.68rem',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid #2a1c08', flexShrink: 0,
  },
  colQty:   { width: 80,  flexShrink: 0, textAlign: 'center' },
  colWt:    { width: 65,  flexShrink: 0, textAlign: 'right', fontSize: '0.75rem', color: '#6b5a3a' },
  colTotal: { width: 60,  flexShrink: 0, textAlign: 'right', fontSize: '0.75rem', color: '#6b5a3a' },

  row:       { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', borderBottom: '1px solid #1a1208', flexShrink: 0 },
  equipBtn:  { background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: 0, lineHeight: 1, width: 22, flexShrink: 0 },
  itemName: {
    color:         '#c9a84c',
    fontSize:      '0.85rem',
    fontWeight:    600,
    cursor:        'pointer',
    textDecoration:'none',
    transition:    'text-decoration 0.1s',
  },
  itemNotes: { color: '#6b5a3a', fontSize: '0.75rem' },

  qtyBtn:    { background: '#1a1208', border: '1px solid #2a1c08', color: '#a89060', borderRadius: 2, width: 18, height: 18, cursor: 'pointer', fontSize: '0.75rem', padding: 0, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  qtyVal:    { color: '#e8e0d0', fontSize: '0.82rem', minWidth: 20, textAlign: 'center', cursor: 'pointer' },
  qtyInput:  { background: '#0d0a05', border: '1px solid #c9a84c', borderRadius: 2, color: '#e8e0d0', width: 40, textAlign: 'center', padding: '0.1rem 0.2rem', fontSize: '0.82rem', outline: 'none' },

  removeBtn: { background: 'none', border: 'none', color: '#5a2a2a', cursor: 'pointer', fontSize: '0.78rem', padding: 0, lineHeight: 1, width: 24, flexShrink: 0 },

  empty:  { color: '#6b5a3a', padding: '1.5rem 0', textAlign: 'center', fontSize: '0.85rem', fontStyle: 'italic' },
  addBtn: { background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8aba6a', borderRadius: 3, padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.8rem', marginTop: '0.35rem', alignSelf: 'flex-start', flexShrink: 0 },

  // Picker
  picker:       { width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 5, overflow: 'hidden' },
  pickerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', borderBottom: '1px solid #2a1c08', flexShrink: 0 },
  pickerTitle:  { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.85rem' },
  pickerClose:  { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.85rem', padding: 0 },
  pickerSearch: { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 3, color: '#e8e0d0', padding: '0.3rem 0.5rem', fontSize: '0.8rem', outline: 'none', margin: '0.4rem 0.5rem 0', width: 'calc(100% - 1rem)', boxSizing: 'border-box' },
  pickerList:   { flex: 1, overflowY: 'auto', padding: '0.3rem 0' },
  pickerMsg:    { color: '#6b5a3a', padding: '1rem', textAlign: 'center', fontSize: '0.8rem' },
  pickerRow:    { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem', cursor: 'pointer', borderBottom: '1px solid #0f0c06' },
  pickerRowSel: { background: '#1a1208', outline: '1px solid #3a2a10' },
  pickerName:   { flex: 1, color: '#e8e0d0', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pickerCat:    { color: '#6b5a3a', fontSize: '0.68rem', flexShrink: 0 },
  brewTag:      { background: '#2a1a3a', border: '1px solid #5a3a7a', color: '#aa7aca', fontSize: '0.6rem', padding: '0 0.25rem', borderRadius: 2, flexShrink: 0 },
  pickerAdd:    { padding: '0.5rem 0.6rem', borderTop: '1px solid #2a1c08', display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 },
  pickerSelName:{ color: '#c9a84c', fontSize: '0.8rem', fontWeight: 600 },
  pickerAddBtn: { background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.28rem 0.6rem', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, flexShrink: 0 },
  pickerCancelBtn:{ background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.28rem 0.6rem', cursor: 'pointer', fontSize: '0.78rem' },
  manualBtn:    { background: 'none', border: 'none', color: '#a89060', cursor: 'pointer', fontSize: '0.75rem', padding: '0.4rem 0.6rem', textAlign: 'left', borderTop: '1px solid #2a1c08', flexShrink: 0 },
  manualForm:   { display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.5rem 0.6rem', flex: 1 },
  mLabel:       { color: '#6b5a3a', fontSize: '0.68rem', display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1 },
}
