import { useState, useEffect, useRef } from 'react'
import EquipmentDetail from './EquipmentDetail'

const CATEGORY_OPTIONS = [
  'Weapon','Armor','Adventuring Gear','Tools',
  'Mounts and Vehicles','Trade Goods',
]
const PAGE_SIZE = 50

export default function EquipmentBrowser() {
  const [allEquipment, setAllEquipment]   = useState([])
  const [loading, setLoading]             = useState(true)
  const [nameInput, setNameInput]         = useState('')
  const [nameFilter, setNameFilter]       = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [visibleCount, setVisibleCount]   = useState(PAGE_SIZE)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const debounceRef = useRef(null)

  // Load all equipment once — filter client-side
  useEffect(() => {
    window.electronAPI.srd.getEquipment({})
      .then(e => { setAllEquipment(e); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Debounce name input
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setNameFilter(nameInput); setVisibleCount(PAGE_SIZE)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [nameInput])

  // Client-side filter — name and category are in the projection
  const filtered = allEquipment.filter(e => {
    if (nameFilter     && !e.name.toLowerCase().includes(nameFilter.toLowerCase())) return false
    if (categoryFilter && e.equipment_category?.toLowerCase() !== categoryFilter.toLowerCase()) return false
    return true
  })

  const visible    = filtered.slice(0, visibleCount)
  const isFiltered = !!(nameFilter || categoryFilter)

  function formatCost(cost) {
    if (!cost) return '—'
    return `${cost.quantity ?? '?'} ${cost.unit ?? ''}`
  }

  function formatWeight(weight) {
    if (!weight) return '—'
    if (typeof weight === 'object') return `${weight.value ?? '?'} ${weight.unit ?? 'lb'}`
    return `${weight} lb`
  }

  return (
    <div style={s.wrapper}>
      {/* ── Filter bar ── */}
      <div style={s.filterBar}>
        <input
          style={s.search}
          placeholder="Search equipment…"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
        />
        <select style={s.select} value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); setVisibleCount(PAGE_SIZE) }}>
          <option value="">All Categories</option>
          {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={s.count}>
          {loading
            ? 'Loading…'
            : isFiltered
              ? `${filtered.length} of ${allEquipment.length} items`
              : `${allEquipment.length} items`
          }
        </span>
      </div>

      {/* ── List + detail panel ── */}
      <div style={s.body}>
        <div style={s.list}>
          {loading ? (
            <p style={s.msg}>Loading equipment…</p>
          ) : filtered.length === 0 ? (
            <p style={s.msg}>No equipment matches these filters.</p>
          ) : (
            <>
              {/* Column header */}
              <div style={s.colHeader}>
                <span style={{ flex: 1 }}>Name</span>
                <span style={s.colCat}>Category</span>
                <span style={s.colCost}>Cost</span>
                <span style={s.colWeight}>Weight</span>
              </div>

              {visible.map(e => (
                <div
                  key={e.index}
                  style={selectedIndex === e.index ? { ...s.row, ...s.rowSelected } : s.row}
                  onClick={() => setSelectedIndex(e.index)}
                >
                  <span style={s.eName}>{e.name}</span>
                  <span style={s.eCat}>{e.equipment_category ?? '—'}</span>
                  <span style={s.eCost}>{formatCost(e.cost)}</span>
                  <span style={s.eWeight}>{formatWeight(e.weight)}</span>
                </div>
              ))}

              {visibleCount < filtered.length && (
                <button style={s.loadMore} onClick={() => setVisibleCount(v => v + PAGE_SIZE)}>
                  Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                  <span style={s.loadMoreCount}> ({filtered.length - visibleCount} remaining)</span>
                </button>
              )}
            </>
          )}
        </div>

        {selectedIndex && (
          <EquipmentDetail index={selectedIndex} onClose={() => setSelectedIndex(null)} />
        )}
      </div>
    </div>
  )
}

const s = {
  wrapper:   { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0.85rem 1.5rem' },
  filterBar: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', flexShrink: 0 },
  search:    { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.38rem 0.65rem', fontSize: '0.85rem', outline: 'none', width: 220 },
  select:    { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#a89060', padding: '0.38rem 0.5rem', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' },
  count:     { color: '#6b5a3a', fontSize: '0.78rem', marginLeft: 'auto' },

  body:    { display: 'flex', flex: 1, gap: '1rem', overflow: 'hidden', minHeight: 0 },
  list:    { flex: 1, overflowY: 'auto', minWidth: 0 },

  colHeader: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.25rem 0.6rem', color: '#6b5a3a', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2a1c08', marginBottom: '0.1rem' },
  colCat:    { width: 140, flexShrink: 0 },
  colCost:   { width: 70,  flexShrink: 0 },
  colWeight: { width: 65,  textAlign: 'right', flexShrink: 0 },

  row:         { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.42rem 0.6rem', borderBottom: '1px solid #1a1208', cursor: 'pointer', borderRadius: 3 },
  rowSelected: { background: '#1a1208', outline: '1px solid #3a2a10' },

  eName:   { color: '#e8e0d0', fontWeight: 600, fontSize: '0.88rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  eCat:    { color: '#a89060', fontSize: '0.78rem', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  eCost:   { color: '#c9a84c', fontSize: '0.78rem', width: 70,  flexShrink: 0 },
  eWeight: { color: '#6b5a3a', fontSize: '0.75rem', width: 65,  textAlign: 'right', flexShrink: 0 },

  msg:           { color: '#6b5a3a', padding: '2rem', textAlign: 'center', fontSize: '0.88rem' },
  loadMore:      { display: 'block', width: '100%', background: 'transparent', border: '1px solid #2a1c08', color: '#a89060', padding: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', borderRadius: 3, marginTop: '0.5rem' },
  loadMoreCount: { color: '#6b5a3a' },
}
