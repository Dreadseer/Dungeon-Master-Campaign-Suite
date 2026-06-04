import { useState, useEffect, useRef } from 'react'
import SpellDetail      from './SpellDetail'
import HomebrewCard     from './HomebrewCard'
import useCampaignStore from '../../stores/campaignStore'

const LEVEL_OPTIONS = [
  { value: '',  label: 'All Levels' },
  { value: '0', label: 'Cantrip'    },
  { value: '1', label: '1st level'  },
  { value: '2', label: '2nd level'  },
  { value: '3', label: '3rd level'  },
  { value: '4', label: '4th level'  },
  { value: '5', label: '5th level'  },
  { value: '6', label: '6th level'  },
  { value: '7', label: '7th level'  },
  { value: '8', label: '8th level'  },
  { value: '9', label: '9th level'  },
]
const SCHOOL_OPTIONS = [
  'Abjuration','Conjuration','Divination','Enchantment',
  'Evocation','Illusion','Necromancy','Transmutation',
]
const LEVEL_LABELS = ['Cantrip','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']
// Cantrip=gray, 1–2=blue, 3–5=purple, 6–9=gold
const LEVEL_COLORS = [
  '#5a5a5a',
  '#1a4a8a','#1a4a8a',
  '#5a2a8a','#5a2a8a','#5a2a8a',
  '#8a6a1a','#8a6a1a','#8a6a1a','#8a6a1a',
]

const PAGE_SIZE = 50

export default function SpellBrowser() {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const [allSpells, setAllSpells]         = useState([])
  const [homebrewSpells, setHomebrewSpells] = useState([])
  const [loading, setLoading]             = useState(true)
  const [nameInput, setNameInput]         = useState('')
  const [nameFilter, setNameFilter]       = useState('')
  const [levelFilter, setLevelFilter]     = useState('')
  const [schoolFilter, setSchoolFilter]   = useState('')
  const [classInput, setClassInput]       = useState('')
  const [classFilter, setClassFilter]     = useState('')
  const [visibleCount, setVisibleCount]   = useState(PAGE_SIZE)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const nameDebounce  = useRef(null)
  const classDebounce = useRef(null)

  // Load homebrew spells whenever campaign changes
  useEffect(() => {
    if (!activeCampaign) { setHomebrewSpells([]); return }
    window.electronAPI.db.compendium.getAll(activeCampaign.id, 'spell')
      .then(brew => {
        setHomebrewSpells(brew.map(e => {
          let d = {}
          try { d = JSON.parse(e.data ?? '{}') } catch { /* empty */ }
          return {
            name:          e.name,
            index:         `custom-${e.id}`,
            level:         d.level ?? 0,
            school:        d.school ?? 'Custom',
            casting_time:  d.casting_time ?? '—',
            range:         d.range ?? '—',
            isHomebrew:    true,
            homebrew_entry:{ ...e, data_raw: e.data },
          }
        }))
      })
      .catch(() => setHomebrewSpells([]))
  }, [activeCampaign])

  // Initial load — all SRD spells, no filters
  useEffect(() => {
    window.electronAPI.srd.getSpells({})
      .then(s => { setAllSpells(s); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Debounce name
  useEffect(() => {
    clearTimeout(nameDebounce.current)
    nameDebounce.current = setTimeout(() => {
      setNameFilter(nameInput); setVisibleCount(PAGE_SIZE)
    }, 300)
    return () => clearTimeout(nameDebounce.current)
  }, [nameInput])

  // Debounce class — triggers server re-fetch since classes not in projection
  useEffect(() => {
    clearTimeout(classDebounce.current)
    classDebounce.current = setTimeout(() => {
      setClassFilter(classInput); setVisibleCount(PAGE_SIZE)
    }, 400)
    return () => clearTimeout(classDebounce.current)
  }, [classInput])

  // Re-fetch when class filter changes (needs full spell data server-side)
  useEffect(() => {
    if (!classFilter) return   // empty class filter → use local data (no re-fetch)
    setLoading(true)
    window.electronAPI.srd.getSpells({ classes: classFilter })
      .then(s => { setAllSpells(s); setLoading(false) })
      .catch(() => setLoading(false))
  }, [classFilter])

  // When class filter cleared, reload all
  useEffect(() => {
    if (classFilter === '' && allSpells.length === 0) {
      window.electronAPI.srd.getSpells({})
        .then(s => { setAllSpells(s); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [classFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shared filter function — applies to both SRD and homebrew rows
  function matchesFilters(sp) {
    if (nameFilter   && !sp.name.toLowerCase().includes(nameFilter.toLowerCase())) return false
    if (levelFilter !== '' && sp.level !== Number(levelFilter))                    return false
    const spSchoolName = typeof sp.school === 'object' ? sp.school?.name : sp.school
    if (schoolFilter && spSchoolName?.toLowerCase() !== schoolFilter.toLowerCase()) return false
    return true
  }

  // Merge SRD + homebrew, then filter
  const filtered = [
    ...allSpells.filter(matchesFilters),
    ...homebrewSpells.filter(matchesFilters),
  ]

  const visible      = filtered.slice(0, visibleCount)
  const totalSpells  = allSpells.length + homebrewSpells.length
  const isFiltered   = !!(nameFilter || levelFilter !== '' || schoolFilter || classFilter)

  return (
    <div style={s.wrapper}>
      {/* ── Filter bar ── */}
      <div style={s.filterBar}>
        <input
          style={s.search}
          placeholder="Search spells…"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
        />
        <select style={s.select} value={levelFilter}
          onChange={e => { setLevelFilter(e.target.value); setVisibleCount(PAGE_SIZE) }}>
          {LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select style={s.select} value={schoolFilter}
          onChange={e => { setSchoolFilter(e.target.value); setVisibleCount(PAGE_SIZE) }}>
          <option value="">All Schools</option>
          {SCHOOL_OPTIONS.map(sc => <option key={sc} value={sc}>{sc}</option>)}
        </select>
        <input
          style={{ ...s.search, width: 110 }}
          placeholder="Class…"
          value={classInput}
          onChange={e => setClassInput(e.target.value)}
        />
        <span style={s.count}>
          {loading
            ? 'Loading…'
            : isFiltered
              ? `${filtered.length} of ${totalSpells} spells`
              : `${totalSpells} spells`
          }
        </span>
      </div>

      {/* ── List + detail panel ── */}
      <div style={s.body}>
        <div style={s.list}>
          {loading ? (
            <p style={s.msg}>Loading spells…</p>
          ) : filtered.length === 0 ? (
            <p style={s.msg}>No spells match these filters.</p>
          ) : (
            <>
              {/* Column header */}
              <div style={s.colHeader}>
                <span style={{ flex: 1 }}>Name</span>
                <span style={s.colLvl}>Level</span>
                <span style={s.colSchool}>School</span>
                <span style={s.colCast}>Casting Time</span>
                <span style={s.colRange}>Range</span>
              </div>

              {visible.map(sp => (
                <div
                  key={sp.index}
                  style={selectedIndex === sp.index ? { ...s.row, ...s.rowSelected } : s.row}
                  onClick={() => setSelectedIndex(sp.index)}
                >
                  <span style={s.spName}>
                    {sp.name}
                    {sp.isHomebrew && <span style={s.brewDot} title="Homebrew"> ✦</span>}
                  </span>
                  <span style={{ ...s.lvlBadge, background: LEVEL_COLORS[sp.level] ?? '#5a5a5a' }}>
                    {LEVEL_LABELS[sp.level]}
                  </span>
                  <span style={s.spSchool}>{typeof sp.school === 'object' ? sp.school?.name : (sp.school ?? '—')}</span>
                  <span style={s.spCast}>{sp.casting_time}</span>
                  <span style={s.spRange}>{sp.range}</span>
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

        {selectedIndex && (() => {
          const sp = [...allSpells, ...homebrewSpells].find(x => x.index === selectedIndex)
          if (sp?.isHomebrew) {
            return (
              <HomebrewCard
                entry={sp.homebrew_entry}
                onClose={() => setSelectedIndex(null)}
              />
            )
          }
          return <SpellDetail index={selectedIndex} onClose={() => setSelectedIndex(null)} />
        })()}
      </div>
    </div>
  )
}

const s = {
  wrapper:   { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0.85rem 1.5rem' },
  filterBar: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', flexShrink: 0 },
  search:    { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.38rem 0.65rem', fontSize: '0.85rem', outline: 'none', width: 170 },
  select:    { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#a89060', padding: '0.38rem 0.5rem', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' },
  count:     { color: '#6b5a3a', fontSize: '0.78rem', marginLeft: 'auto' },

  body:    { display: 'flex', flex: 1, gap: '1rem', overflow: 'hidden', minHeight: 0 },
  list:    { flex: 1, overflowY: 'auto', minWidth: 0 },

  colHeader: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.25rem 0.6rem', color: '#6b5a3a', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #2a1c08', marginBottom: '0.1rem' },
  colLvl:    { width: 60, textAlign: 'center', flexShrink: 0 },
  colSchool: { width: 100, flexShrink: 0 },
  colCast:   { width: 90, flexShrink: 0 },
  colRange:  { width: 80, flexShrink: 0 },

  row:         { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.42rem 0.6rem', borderBottom: '1px solid #1a1208', cursor: 'pointer', borderRadius: 3 },
  rowSelected: { background: '#1a1208', outline: '1px solid #3a2a10' },

  spName:   { color: '#e8e0d0', fontWeight: 600, fontSize: '0.88rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.2rem' },
  brewDot:  { color: '#aa7aca', fontSize: '0.65rem', flexShrink: 0 },
  lvlBadge: { color: '#fff', fontSize: '0.68rem', fontWeight: 'bold', padding: '0.1rem 0.35rem', borderRadius: 3, width: 60, textAlign: 'center', flexShrink: 0 },
  spSchool: { color: '#a89060', fontSize: '0.78rem', width: 100, flexShrink: 0 },
  spCast:   { color: '#a89060', fontSize: '0.75rem', width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  spRange:  { color: '#6b5a3a', fontSize: '0.75rem', width: 80, flexShrink: 0 },

  msg:           { color: '#6b5a3a', padding: '2rem', textAlign: 'center', fontSize: '0.88rem' },
  loadMore:      { display: 'block', width: '100%', background: 'transparent', border: '1px solid #2a1c08', color: '#a89060', padding: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', borderRadius: 3, marginTop: '0.5rem' },
  loadMoreCount: { color: '#6b5a3a' },
}
