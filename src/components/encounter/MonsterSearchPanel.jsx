import { useState, useEffect, useRef, useCallback } from 'react'
import { crColor }            from '../../utils/crColor'
import { createMonsterEntry } from '../../utils/encounterUtils'
import useCampaignStore       from '../../stores/campaignStore'

const CR_OPTIONS = [
  '', '0', '1/8', '1/4', '1/2',
  '1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15','16','17','18','19','20',
  '21','22','23','24','25','26','27','28','29','30',
]
const TYPE_OPTIONS = [
  '', 'Aberration', 'Beast', 'Celestial', 'Construct', 'Dragon',
  'Elemental', 'Fey', 'Fiend', 'Giant', 'Humanoid',
  'Monstrosity', 'Ooze', 'Plant', 'Undead',
]

export default function MonsterSearchPanel({ rosterMonsters, onAdd, recentlyUsed = [] }) {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  const [query, setQuery]       = useState('')
  const [crMin, setCrMin]       = useState('')
  const [crMax, setCrMax]       = useState('')
  const [typeFilter, setType]   = useState('')
  const [sourceMode, setSrc]    = useState('both')   // 'srd' | 'homebrew' | 'both'
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(false)
  const debounceRef = useRef(null)

  // Roster id set for quick "already added" lookup
  const rosterNames = new Set(rosterMonsters.map(m => m.source_index))

  const doSearch = useCallback(async (q, minCR, maxCR, type, src) => {
    setLoading(true)
    try {
      const [srdRaw, brewRaw] = await Promise.all([
        src !== 'homebrew'
          ? window.electronAPI.srd.getMonsters({ name: q || undefined })
          : Promise.resolve([]),
        src !== 'srd' && activeCampaign
          ? window.electronAPI.db.compendium.getAll(activeCampaign.id, 'monster')
          : Promise.resolve([]),
      ])

      // Normalise SRD entries
      let combined = srdRaw.map(m => ({
        ...m,
        _source: 'srd',
        _displayType: m.type ?? '—',
      }))

      // Normalise homebrew entries
      const brewMapped = brewRaw.map(e => {
        let d = {}
        try { d = JSON.parse(e.data ?? '{}') } catch { /* empty */ }
        return {
          name:             e.name,
          index:            `custom-${e.id}`,
          challenge_rating: d.cr ?? 0,
          type:             d.type ?? 'Custom',
          hit_points:       d.hit_points ?? 10,
          _source:          'homebrew',
          _displayType:     d.type ?? 'Custom',
          _brewEntry:       e,
          _brewData:        d,
        }
      })
      combined = [...combined, ...brewMapped]

      // Client-side filters
      if (q) {
        const lq = q.toLowerCase()
        combined = combined.filter(m => m.name.toLowerCase().includes(lq))
      }
      if (type) {
        combined = combined.filter(m => (m.type ?? '').toLowerCase() === type.toLowerCase())
      }

      // CR range filter
      const parseFraction = (v) => {
        if (!v && v !== 0) return null
        const map = { '1/8': 0.125, '1/4': 0.25, '1/2': 0.5 }
        return map[String(v)] ?? parseFloat(v)
      }
      const minVal = parseFraction(minCR)
      const maxVal = parseFraction(maxCR)
      if (minVal !== null) {
        combined = combined.filter(m => {
          const cr = parseFraction(m.challenge_rating)
          return cr !== null && cr >= minVal
        })
      }
      if (maxVal !== null) {
        combined = combined.filter(m => {
          const cr = parseFraction(m.challenge_rating)
          return cr !== null && cr <= maxVal
        })
      }

      setResults(combined.slice(0, 80))
    } catch (err) {
      console.error('MonsterSearchPanel search error:', err)
    } finally {
      setLoading(false)
    }
  }, [activeCampaign])

  // Debounce search on any filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSearch(query, crMin, crMax, typeFilter, sourceMode)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, crMin, crMax, typeFilter, sourceMode, doSearch])

  const handleAdd = (monster) => {
    let entry
    if (monster._source === 'homebrew') {
      const d = monster._brewData ?? {}
      const statBlock = {
        name:             monster.name,
        index:            monster.index,
        challenge_rating: monster.challenge_rating,
        hit_points:       monster.hit_points,
      }
      entry = createMonsterEntry(statBlock, 'homebrew')
    } else {
      entry = createMonsterEntry(monster, 'srd')
    }
    onAdd(entry)
  }

  return (
    <div style={s.panel}>
      {/* Search input */}
      <div style={s.searchRow}>
        <input
          style={s.searchInput}
          placeholder="Search monsters…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* Filters */}
      <div style={s.filterRow}>
        <select style={s.sel} value={crMin} onChange={e => setCrMin(e.target.value)} title="Min CR">
          <option value="">CR min</option>
          {CR_OPTIONS.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={s.sel} value={crMax} onChange={e => setCrMax(e.target.value)} title="Max CR">
          <option value="">CR max</option>
          {CR_OPTIONS.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={s.sel} value={typeFilter} onChange={e => setType(e.target.value)}>
          <option value="">All types</option>
          {TYPE_OPTIONS.filter(Boolean).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div style={s.srcGroup}>
          {['both','srd','homebrew'].map(m => (
            <button
              key={m}
              style={{ ...s.srcBtn, ...(sourceMode === m ? s.srcBtnActive : {}) }}
              onClick={() => setSrc(m)}
            >
              {m === 'both' ? 'All' : m === 'srd' ? 'SRD' : 'Brew'}
            </button>
          ))}
        </div>
      </div>

      {/* Recently used */}
      {recentlyUsed.length > 0 && (
        <div style={s.recentSection}>
          <div style={s.sectionLabel}>Recently Used</div>
          {recentlyUsed.slice(0, 5).map((m, i) => (
            <div key={i} style={s.recentRow} onClick={() => handleAdd(m)}>
              <span style={s.recentName}>{m.name}</span>
              <span style={{ ...s.crBadge, background: crColor(m.challenge_rating ?? m.cr) }}>
                CR {m.challenge_rating ?? m.cr ?? '?'}
              </span>
            </div>
          ))}
          <div style={s.divider} />
        </div>
      )}

      {/* Results */}
      <div style={s.resultsList}>
        {loading && <p style={s.msg}>Searching…</p>}
        {!loading && results.length === 0 && (
          <p style={s.msg}>
            {query || crMin || crMax || typeFilter
              ? 'No monsters match your filters.'
              : 'Type to search, or use filters above.'}
          </p>
        )}
        {!loading && results.map(m => {
          const inRoster = rosterNames.has(m.index)
          return (
            <div key={m.index} style={s.resultRow}>
              <div style={s.resultInfo}>
                <span style={s.resultName}>{m.name}</span>
                <div style={s.resultMeta}>
                  <span style={{ ...s.crBadge, background: crColor(m.challenge_rating) }}>
                    CR {m.challenge_rating ?? '?'}
                  </span>
                  <span style={s.resultType}>{m._displayType}</span>
                  <span style={s.resultHP}>{m.hit_points} HP</span>
                  {m._source === 'homebrew' && <span style={s.brewBadge}>Homebrew</span>}
                </div>
              </div>
              <button
                style={{ ...s.addBtn, ...(inRoster ? s.addBtnAgain : {}) }}
                onClick={() => handleAdd(m)}
              >
                {inRoster ? '+ Add Another' : '+ Add'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const s = {
  panel: {
    display: 'flex', flexDirection: 'column',
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    overflow: 'hidden', height: '100%',
  },
  searchRow: { padding: '10px 12px 6px', borderBottom: '1px solid #2a2a2a' },
  searchInput: {
    width: '100%', background: '#111', border: '1px solid #444', borderRadius: 4,
    color: '#e0d5c0', padding: '7px 10px', fontSize: 13, outline: 'none',
    boxSizing: 'border-box',
  },
  filterRow: {
    display: 'flex', gap: 6, padding: '6px 12px',
    borderBottom: '1px solid #2a2a2a', flexWrap: 'wrap',
  },
  sel: {
    background: '#111', border: '1px solid #444', borderRadius: 4,
    color: '#aaa', padding: '4px 6px', fontSize: 12, cursor: 'pointer',
  },
  srcGroup:  { display: 'flex', gap: 2, marginLeft: 'auto' },
  srcBtn: {
    padding: '4px 8px', background: '#222', border: '1px solid #444',
    borderRadius: 3, color: '#888', cursor: 'pointer', fontSize: 11,
  },
  srcBtnActive: { background: '#3a3020', borderColor: '#c9a84c', color: '#c9a84c' },
  recentSection: { padding: '6px 12px 0' },
  sectionLabel:  { color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  recentRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 6px', borderRadius: 4, cursor: 'pointer',
  },
  recentName: { color: '#c9a84c', fontSize: 13, flex: 1 },
  divider: { borderTop: '1px solid #2a2a2a', margin: '6px 0' },
  resultsList: { flex: 1, overflowY: 'auto', padding: '6px 12px 12px' },
  msg: { color: '#555', fontSize: 13, textAlign: 'center', margin: '24px 0' },
  resultRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 0', borderBottom: '1px solid #222',
  },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: { color: '#e0d5c0', fontSize: 13, display: 'block' },
  resultMeta: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 },
  crBadge: {
    fontSize: 11, fontWeight: 600, color: '#fff',
    padding: '1px 6px', borderRadius: 3, flexShrink: 0,
  },
  resultType: { color: '#777', fontSize: 11 },
  resultHP:   { color: '#7abfff', fontSize: 11 },
  brewBadge: {
    fontSize: 10, color: '#b07cf7', background: '#2a1a3a',
    border: '1px solid #4a2a6a', borderRadius: 3, padding: '1px 5px',
  },
  addBtn: {
    padding: '4px 10px', background: '#2d5a27', color: '#7fc272',
    border: '1px solid #3d7a37', borderRadius: 4, cursor: 'pointer',
    fontSize: 12, flexShrink: 0,
  },
  addBtnAgain: {
    background: '#2a2a1a', color: '#c9a84c', borderColor: '#5a4a1a',
  },
}
