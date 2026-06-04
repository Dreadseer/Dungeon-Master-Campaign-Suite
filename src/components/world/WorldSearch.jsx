import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useCampaignStore from '../../stores/campaignStore'

const TYPE_COLORS = {
  location: { bg: '#1a2a1a', text: '#5a9a5a' },
  faction:  { bg: '#1e1228', text: '#9a6abf' },
  npc:      { bg: '#1a1a2a', text: '#6a8abf' },
  lore:     { bg: '#2a1a0a', text: '#c9a84c' },
}

const ENTITY_PATH = {
  location: '/world/locations',
  faction:  '/world/factions',
  npc:      '/world/npcs',
  lore:     '/world/lore',
}

export default function WorldSearch() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)
  const navigate = useNavigate()
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [open, setOpen]         = useState(false)
  const debounceRef             = useRef(null)
  const inputRef                = useRef(null)
  const containerRef            = useRef(null)

  const search = useCallback(async (q) => {
    if (!activeCampaign?.id || q.length < 2) { setResults(null); setLoading(false); return }
    setLoading(true)
    try {
      const res = await window.electronAPI.db.world.search(activeCampaign.id, q)
      setResults(res)
    } catch {
      setResults(null)
    }
    setLoading(false)
  }, [activeCampaign?.id])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults(null); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(() => search(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, search])

  // Close on outside click
  useEffect(() => {
    function onDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function handleKey(e) {
    if (e.key === 'Escape') { setQuery(''); setResults(null); setOpen(false) }
  }

  function handleSelect(entity_type) {
    navigate(ENTITY_PATH[entity_type] || '/world')
    setQuery('')
    setResults(null)
    setOpen(false)
  }

  const hasResults = results && results.total > 0
  const typeCount  = results
    ? ['location','faction','npc','lore'].filter(t => results[t + 's']?.length > 0 || results[t]?.length > 0).length
    : 0

  const groups = results ? [
    { key: 'locations', label: 'Locations', type: 'location', items: results.locations },
    { key: 'factions',  label: 'Factions',  type: 'faction',  items: results.factions  },
    { key: 'npcs',      label: 'NPCs',       type: 'npc',      items: results.npcs      },
    { key: 'lore',      label: 'Lore',       type: 'lore',     items: results.lore      },
  ].filter(g => g.items?.length > 0) : []

  return (
    <div ref={containerRef} style={s.wrap}>
      <div style={s.inputWrap}>
        <span style={s.icon}>🔍</span>
        <input
          ref={inputRef}
          style={s.input}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search world…"
        />
        {query && (
          <button style={s.clear} onClick={() => { setQuery(''); setResults(null); setOpen(false) }}>✕</button>
        )}
      </div>

      {open && query.length >= 2 && (
        <div style={s.dropdown}>
          {loading && <div style={s.loading}>Searching…</div>}

          {!loading && results && results.total === 0 && (
            <div style={s.noResults}>No world entities match "{query}"</div>
          )}

          {!loading && hasResults && (
            <>
              <div style={s.summary}>
                {results.total} result{results.total !== 1 ? 's' : ''} across {typeCount} entity type{typeCount !== 1 ? 's' : ''}
              </div>
              {groups.map(({ key, label, type, items }) => (
                <div key={key}>
                  <div style={s.groupLabel}>{label}</div>
                  {items.map(item => (
                    <button key={item.id} style={s.resultRow} onClick={() => handleSelect(type)}>
                      <span style={{ ...s.typeBadge, background: TYPE_COLORS[type].bg, color: TYPE_COLORS[type].text }}>
                        {type}
                      </span>
                      <span style={s.resultName}>{item.name}</span>
                      {item.subtitle && <span style={s.resultSub}>{item.subtitle}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const s = {
  wrap:       { position: 'relative', width: 220 },
  inputWrap:  { display: 'flex', alignItems: 'center', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, padding: '0.3rem 0.6rem', gap: '0.4rem' },
  icon:       { fontSize: '0.75rem', color: '#6b5a3a' },
  input:      { background: 'transparent', border: 'none', outline: 'none', color: '#e8e0d0', fontSize: '0.82rem', flex: 1, minWidth: 0 },
  clear:      { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.75rem', padding: 0, lineHeight: 1 },
  dropdown:   { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 4, zIndex: 500, maxHeight: 360, overflowY: 'auto', minWidth: 280, boxShadow: '0 4px 16px rgba(0,0,0,0.6)' },
  loading:    { padding: '0.75rem 1rem', color: '#6b5a3a', fontSize: '0.82rem' },
  noResults:  { padding: '0.75rem 1rem', color: '#6b5a3a', fontSize: '0.82rem' },
  summary:    { padding: '0.5rem 1rem', color: '#6b5a3a', fontSize: '0.72rem', borderBottom: '1px solid #2a1c08' },
  groupLabel: { padding: '0.4rem 1rem 0.2rem', color: '#7a6035', fontSize: '0.68rem', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase' },
  resultRow:  { display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.45rem 1rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' },
  typeBadge:  { fontSize: '0.68rem', padding: '0.1rem 0.35rem', borderRadius: 3, flexShrink: 0 },
  resultName: { color: '#e8e0d0', fontSize: '0.85rem', flex: 1 },
  resultSub:  { color: '#6b5a3a', fontSize: '0.75rem', flexShrink: 0 },
}
