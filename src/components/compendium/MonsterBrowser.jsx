import { useState, useEffect, useRef } from 'react'
import MonsterStatBlock from './MonsterStatBlock'
import HomebrewCard     from './HomebrewCard'
import { crColor }      from '../../utils/crColor'
import useCampaignStore from '../../stores/campaignStore'

const CR_OPTIONS = [
  '0','1/8','1/4','1/2',
  '1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15','16','17','18','19','20',
  '21','22','23','24','25','26','27','28','29','30',
]
const TYPE_OPTIONS = [
  'Aberration','Beast','Celestial','Construct','Dragon',
  'Elemental','Fey','Fiend','Giant','Humanoid',
  'Monstrosity','Ooze','Plant','Undead',
]
const SIZE_OPTIONS = ['Tiny','Small','Medium','Large','Huge','Gargantuan']
const PAGE_SIZE    = 50

export default function MonsterBrowser() {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const [allMonsters, setAllMonsters]     = useState([])
  const [loadError, setLoadError]         = useState('')
  const [loading, setLoading]             = useState(true)
  const [nameInput, setNameInput]         = useState('')
  const [nameFilter, setNameFilter]       = useState('')
  const [crFilter, setCrFilter]           = useState('')
  const [typeFilter, setTypeFilter]       = useState('')
  const [sizeFilter, setSizeFilter]       = useState('')
  const [visibleCount, setVisibleCount]   = useState(PAGE_SIZE)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const debounceRef = useRef(null)

  // Load SRD monsters + any homebrew monsters for the active campaign
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [srd, brew] = await Promise.all([
          window.electronAPI.srd.getMonsters({}),
          activeCampaign
            ? window.electronAPI.db.compendium.getAll(activeCampaign.id, 'monster')
            : Promise.resolve([]),
        ])
        if (cancelled) return
        const brewMapped = brew.map(e => {
          let d = {}
          try { d = JSON.parse(e.data ?? '{}') } catch { /* empty */ }
          return {
            name:             e.name,
            index:            `custom-${e.id}`,
            challenge_rating: d.cr ?? '?',
            type:             d.type ?? 'Custom',
            size:             d.size ?? '—',
            hit_points:       d.hit_points ?? '—',
            isHomebrew:       e.source !== 'source_book',
            isSourceBook:     e.source === 'source_book',
            homebrew_entry:   { ...e, data_raw: e.data },
          }
        })
        setAllMonsters([...srd, ...brewMapped])
      } catch (err) {
      if (!cancelled) setLoadError(err?.message ?? 'Failed to load monsters')
    }
    if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [activeCampaign])

  // Debounce name input → nameFilter (resets pagination)
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setNameFilter(nameInput)
      setVisibleCount(PAGE_SIZE)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [nameInput])

  // Client-side filter — all fields are in the projection
  const filtered = allMonsters.filter(m => {
    if (nameFilter && !m.name.toLowerCase().includes(nameFilter.toLowerCase())) return false
    if (crFilter   && String(m.challenge_rating) !== crFilter)                  return false
    if (typeFilter && !m.type?.toLowerCase().includes(typeFilter.toLowerCase())) return false
    if (sizeFilter && m.size?.toLowerCase() !== sizeFilter.toLowerCase())        return false
    return true
  }).sort((a, b) => a.name.localeCompare(b.name))

  const visible    = filtered.slice(0, visibleCount)
  const isFiltered = !!(nameFilter || crFilter || typeFilter || sizeFilter)

  function handleSelectChange(setter) {
    return (e) => { setter(e.target.value); setVisibleCount(PAGE_SIZE) }
  }

  return (
    <div style={s.wrapper}>
      {/* ── Filter bar ── */}
      <div style={s.filterBar}>
        <input
          style={s.search}
          placeholder="Search monsters…"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
        />
        <select style={s.select} value={crFilter}   onChange={handleSelectChange(setCrFilter)}>
          <option value="">All CRs</option>
          {CR_OPTIONS.map(c => <option key={c} value={c}>CR {c}</option>)}
        </select>
        <select style={s.select} value={typeFilter} onChange={handleSelectChange(setTypeFilter)}>
          <option value="">All Types</option>
          {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={s.select} value={sizeFilter} onChange={handleSelectChange(setSizeFilter)}>
          <option value="">All Sizes</option>
          {SIZE_OPTIONS.map(sz => <option key={sz} value={sz}>{sz}</option>)}
        </select>
        <span style={s.count}>
          {loading
            ? 'Loading…'
            : isFiltered
              ? `${filtered.length} of ${allMonsters.length} monsters`
              : `${allMonsters.length} monsters`
          }
        </span>
      </div>

      {/* ── List + stat block panel ── */}
      <div style={s.body}>
        <div style={s.list}>
          {loading ? (
            <p style={s.msg}>Loading monsters…</p>
          ) : loadError ? (
            <p style={{ ...s.msg, color: '#e05050' }}>⚠ {loadError}</p>
          ) : filtered.length === 0 ? (
            <p style={s.msg}>No monsters match these filters.</p>
          ) : (
            <>
              {/* Column header */}
              <div style={s.colHeader}>
                <span style={{ flex: 1 }}>Name</span>
                <span style={s.colCr}>CR</span>
                <span style={s.colType}>Type</span>
                <span style={s.colSize}>Size</span>
                <span style={s.colHp}>HP</span>
              </div>

              {visible.map(m => (
                <div
                  key={m.index}
                  style={selectedIndex === m.index ? { ...s.row, ...s.rowSelected } : s.row}
                  onClick={() => setSelectedIndex(m.index)}
                >
                  <span style={s.mName}>
                    {m.name}
                    {m.isHomebrew   && <span style={s.brewDot}   title="Homebrew"> ✦</span>}
                    {m.isSourceBook && <span style={s.sourceDot} title="Source Book"> +</span>}
                  </span>
                  <span style={{ ...s.crBadge, background: crColor(m.challenge_rating) }}>
                    {m.challenge_rating}
                  </span>
                  <span style={s.mType}>{m.type}</span>
                  <span style={s.mSize}>{m.size}</span>
                  <span style={s.mHp}>{m.hit_points}</span>
                </div>
              ))}

              {visibleCount < filtered.length && (
                <button
                  style={s.loadMore}
                  onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                >
                  Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                  <span style={s.loadMoreCount}> ({filtered.length - visibleCount} remaining)</span>
                </button>
              )}
            </>
          )}
        </div>

        {/* Detail panel — homebrew shows HomebrewCard, SRD shows MonsterStatBlock */}
        {selectedIndex && (() => {
          const m = allMonsters.find(x => x.index === selectedIndex)
          if (m?.isHomebrew || m?.isSourceBook) {
            return (
              <HomebrewCard
                entry={m.homebrew_entry}
                onClose={() => setSelectedIndex(null)}
              />
            )
          }
          return (
            <MonsterStatBlock
              index={selectedIndex}
              onClose={() => setSelectedIndex(null)}
            />
          )
        })()}
      </div>
    </div>
  )
}

const s = {
  wrapper:   { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0.85rem 1.5rem' },
  filterBar: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', flexShrink: 0 },
  search:    { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.38rem 0.65rem', fontSize: '0.85rem', outline: 'none', width: 200 },
  select:    { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#a89060', padding: '0.38rem 0.5rem', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' },
  count:     { color: '#6b5a3a', fontSize: '0.78rem', marginLeft: 'auto' },

  body:    { display: 'flex', flex: 1, gap: '1rem', overflow: 'hidden', minHeight: 0 },
  list:    { flex: 1, overflowY: 'auto', minWidth: 0 },

  colHeader: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.25rem 0.6rem', color: '#6b5a3a', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2a1c08', marginBottom: '0.1rem' },
  colCr:   { width: 40, textAlign: 'center', flexShrink: 0 },
  colType: { width: 100, flexShrink: 0 },
  colSize: { width: 80, flexShrink: 0 },
  colHp:   { width: 40, textAlign: 'right', flexShrink: 0 },

  row: {
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.42rem 0.6rem', borderBottom: '1px solid #1a1208',
    cursor: 'pointer', borderRadius: 3,
    transition: 'background 0.1s',
  },
  rowSelected: { background: '#1a1208', outline: '1px solid #3a2a10' },

  mName:   { color: '#e8e0d0', fontWeight: 600, fontSize: '0.88rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.2rem' },
  brewDot:   { color: '#aa7aca', fontSize: '0.65rem', flexShrink: 0 },
  sourceDot: { color: '#c9a84c', fontSize: '0.65rem', flexShrink: 0 },
  crBadge: { color: '#fff', fontSize: '0.7rem', fontWeight: 'bold', padding: '0.1rem 0.35rem', borderRadius: 3, width: 40, textAlign: 'center', flexShrink: 0 },
  mType:   { color: '#a89060', fontSize: '0.78rem', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mSize:   { color: '#a89060', fontSize: '0.78rem', width: 80, flexShrink: 0 },
  mHp:     { color: '#6b5a3a', fontSize: '0.75rem', width: 40, textAlign: 'right', flexShrink: 0 },

  msg:      { color: '#6b5a3a', padding: '2rem', textAlign: 'center', fontSize: '0.88rem' },
  loadMore: { display: 'block', width: '100%', background: 'transparent', border: '1px solid #2a1c08', color: '#a89060', padding: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', borderRadius: 3, marginTop: '0.5rem' },
  loadMoreCount: { color: '#6b5a3a' },
}
