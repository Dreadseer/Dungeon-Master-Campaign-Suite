import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import useCampaignStore from '../../stores/campaignStore'
import EntityCard from '../../components/world/EntityCard'
import EntityModal from '../../components/world/EntityModal'
import Skeleton from '../../components/ui/Skeleton'

const TYPES = ['town', 'dungeon', 'shop', 'region', 'landmark']
const TABS  = ['All', ...TYPES]
const EMPTY_FORM = { name: '', type: 'town', description: '', lore: '', parent_location_id: null, has_own_map: false, floor_number: '' }

export default function Locations() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)
  const [locations, setLocations]   = useState([])
  const [tab, setTab]               = useState('All')
  const [modalOpen, setModalOpen]   = useState(false)
  const [editing, setEditing]       = useState(null)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [locSearch, setLocSearch]   = useState('')
  const [hasSubs, setHasSubs]       = useState(false)
  const [sortBy, setSortBy]         = useState('name-asc')
  const [locConnections, setLocConnections] = useState([])
  const [locConnOpen, setLocConnOpen]       = useState(false)
  const [locEntityMap, setLocEntityMap]     = useState({})

  const load = useCallback(() => {
    if (!activeCampaign?.id) return
    setLoading(true)
    window.electronAPI.db.locations.getAll(activeCampaign.id).then(l => { setLocations(l); setLoading(false) })
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      openCreate()
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line

  const filtered = useMemo(() => {
    let list = tab === 'All' ? locations : locations.filter(l => l.type === tab)
    if (locSearch) {
      const q = locSearch.toLowerCase()
      list = list.filter(l => l.name.toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q))
    }
    if (hasSubs) list = list.filter(l => locations.some(c => c.parent_location_id === l.id))
    switch (sortBy) {
      case 'type':   list = [...list].sort((a, b) => a.type.localeCompare(b.type)); break
      case 'recent': list = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); break
      default:       list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [locations, tab, locSearch, hasSubs, sortBy])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setModalOpen(true)
  }

  function openEdit(loc) {
    setEditing(loc)
    setForm({
      name: loc.name, type: loc.type || 'town',
      description: loc.description || '', lore: loc.lore || '',
      parent_location_id: loc.parent_location_id ?? null,
      has_own_map: !!loc.has_own_map,
      floor_number: loc.floor_number != null ? String(loc.floor_number) : '',
    })
    setError('')
    setModalOpen(true)
  }

  function closeModal() { setModalOpen(false); setEditing(null); setLocConnOpen(false); setLocConnections([]) }

  // Load connections when editing a location and panel is opened
  useEffect(() => {
    if (!locConnOpen || !editing?.id) return
    Promise.all([
      window.electronAPI.db.connections.getForEntity('location', editing.id),
      window.electronAPI.db.npcs.getAll(activeCampaign.id),
      window.electronAPI.db.locations.getAll(activeCampaign.id),
      window.electronAPI.db.factions.getAll(activeCampaign.id),
    ]).then(([conns, npcs, locs, facs]) => {
      setLocConnections(conns)
      const map = {}
      npcs.forEach(e  => { map[`npc:${e.id}`]      = e.name })
      locs.forEach(e  => { map[`location:${e.id}`] = e.name })
      facs.forEach(e  => { map[`faction:${e.id}`]  = e.name })
      setLocEntityMap(map)
    })
  }, [locConnOpen, editing?.id]) // eslint-disable-line
  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Location name is required.'); return }
    if (editing && form.parent_location_id === editing.id) {
      setError('A location cannot be its own parent.'); return
    }
    setSaving(true)
    const payload = {
      ...form,
      campaign_id: activeCampaign.id,
      parent_location_id: form.parent_location_id || null,
      has_own_map: !!form.has_own_map,
      floor_number: form.floor_number !== '' ? parseInt(form.floor_number, 10) : null,
    }
    if (editing) {
      await window.electronAPI.db.locations.update(editing.id, payload)
    } else {
      await window.electronAPI.db.locations.create(payload)
    }
    setSaving(false)
    load()
    closeModal()
  }

  async function handleDelete(loc) {
    await window.electronAPI.db.locations.delete(loc.id)
    load()
  }

  // Parent picker opens edit modal for that parent
  function openParent(parentId, e) {
    e.stopPropagation()
    const parent = locations.find(l => l.id === parentId)
    if (parent) openEdit(parent)
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Locations</h1>
          <p style={s.count}>{filtered.length} of {locations.length}</p>
        </div>
        <button style={s.btnPrimary} onClick={openCreate}>+ New Location</button>
      </div>

      {/* Type filter tabs */}
      <div style={s.tabs}>
        {TABS.map(t => (
          <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
            onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Extra filters */}
      <div style={s.filterBar}>
        <input style={s.searchInput} value={locSearch} onChange={e => setLocSearch(e.target.value)}
          placeholder="Search locations…" />
        <label style={s.checkLabel}>
          <input type="checkbox" checked={hasSubs} onChange={e => setHasSubs(e.target.checked)} />
          {' '}Has Sub-locations
        </label>
        <select style={s.filterSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="name-asc">Name A–Z</option>
          <option value="type">Type</option>
          <option value="recent">Recently Added</option>
        </select>
      </div>

      {loading ? (
        <Skeleton count={4} height="4rem" />
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>
            {tab === 'All' ? 'No locations yet. Build your world.' : `No ${tab}s yet. Add your first one.`}
          </p>
          <button style={s.btnPrimary} onClick={openCreate}>+ New Location</button>
        </div>
      ) : (
        <div style={s.list}>
          {filtered.map(loc => {
            const tags = []
            if (loc.lore) tags.push({ label: 'Has Lore', color: '#1a2a1a', text: '#6abf6a' })
            if (loc.parent_location_id) tags.push({ label: 'Sub-location', color: '#1a1a2a', text: '#6a8abf' })
            if (loc.has_own_map) tags.push({ label: '🗺 Has Map', color: '#1a2a2a', text: '#5abfbf' })
            if (loc.floor_number != null) tags.push({ label: `Floor ${loc.floor_number}`, color: '#2a1a2a', text: '#9a6abf' })

            const subtitle = loc.parent_name
              ? `${loc.type} in ${loc.parent_name}`
              : loc.type

            return (
              <EntityCard
                key={loc.id}
                title={loc.name}
                subtitle={subtitle}
                tags={tags}
                meta={new Date(loc.created_at).toLocaleDateString()}
                onClick={() => openEdit(loc)}
                onDelete={() => handleDelete(loc)}
                accentColor="#6a8abf"
              >
                {loc.parent_location_id && loc.parent_name && (
                  <div style={s.breadcrumb}>
                    <button style={s.breadcrumbBtn} onClick={(e) => openParent(loc.parent_location_id, e)}>
                      {loc.parent_name}
                    </button>
                    <span style={s.breadcrumbSep}> › </span>
                    <span style={s.breadcrumbCurrent}>{loc.name}</span>
                  </div>
                )}
              </EntityCard>
            )
          })}
        </div>
      )}

      <EntityModal
        title={editing ? `Edit: ${editing.name}` : 'New Location'}
        isOpen={modalOpen}
        onClose={closeModal}
      >
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Location Name *</label>
          <input style={s.input} value={form.name} onChange={e => setField('name', e.target.value)}
            placeholder="Riverdale" autoFocus required />
          {error && <p style={s.err}>{error}</p>}

          <label style={s.label}>Type</label>
          <select style={s.input} value={form.type} onChange={e => setField('type', e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>

          <label style={s.label}>Located within… (optional)</label>
          <select
            style={s.input}
            value={form.parent_location_id ?? ''}
            onChange={e => setField('parent_location_id', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">None (top-level location)</option>
            {locations
              .filter(l => !editing || l.id !== editing.id)
              .map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>

          <label style={s.label}>Description (player-facing)</label>
          <textarea style={{ ...s.input, height: 68, resize: 'vertical' }}
            value={form.description} onChange={e => setField('description', e.target.value)}
            placeholder="What the players see and experience here..." />

          <label style={s.label}>Lore (DM only)</label>
          <textarea style={{ ...s.input, height: 96, resize: 'vertical' }}
            value={form.lore} onChange={e => setField('lore', e.target.value)}
            placeholder="History, secrets, hidden details..." />

          {/* Map & floor flags */}
          <div style={s.flagRow}>
            <label style={s.flagLabel}>
              <input
                type="checkbox"
                checked={!!form.has_own_map}
                onChange={e => setField('has_own_map', e.target.checked)}
                style={{ accentColor: '#c9a84c', marginRight: 6 }}
              />
              Large enough for its own map
            </label>
          </div>

          <div style={s.floorRow}>
            <label style={{ ...s.label, marginBottom: 0, flexShrink: 0 }}>Floor / Level #</label>
            <input
              style={{ ...s.input, marginBottom: 0, width: 80, textAlign: 'center' }}
              type="number"
              min="0"
              placeholder="—"
              value={form.floor_number}
              onChange={e => setField('floor_number', e.target.value)}
            />
            <span style={s.floorHint}>Leave blank if not a numbered floor/level</span>
          </div>

          <div style={s.row}>
            <button style={s.btnPrimary} type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Location'}
            </button>
            <button style={s.btnSecondary} type="button" onClick={closeModal}>Cancel</button>
          </div>
        </form>

        {editing && (
          <div style={s.connSection}>
            <button style={s.connToggle} type="button" onClick={() => setLocConnOpen(o => !o)}>
              {locConnOpen ? '▾' : '▸'} Connections
            </button>
            {locConnOpen && (
              <div style={s.connBody}>
                {locConnections.length === 0 ? (
                  <p style={s.connEmpty}>No connections for this location.</p>
                ) : (
                  locConnections.map(conn => {
                    const isA  = conn.entity_a_type === 'location' && conn.entity_a_id === editing.id
                    const otherType = isA ? conn.entity_b_type : conn.entity_a_type
                    const otherId   = isA ? conn.entity_b_id   : conn.entity_a_id
                    const otherName = locEntityMap[`${otherType}:${otherId}`] || `Unknown ${otherType}`
                    return (
                      <div key={conn.id} style={s.connRow}>
                        <span style={s.connRel}>{conn.relationship}</span>
                        {' with '}
                        <span style={s.connName}>{otherName}</span>
                        <span style={s.connType}>{otherType}</span>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        )}
      </EntityModal>
    </div>
  )
}

const s = {
  page:           { padding: '2rem', maxWidth: 800 },
  header:         { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  title:          { color: '#c9a84c', fontSize: '1.6rem', margin: 0 },
  count:          { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.2rem 0 0' },
  tabs:           { display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
  tab:            { background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', padding: '0.35rem 0.85rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' },
  tabActive:      { background: '#2d1f0a', border: '1px solid #c9a84c', color: '#c9a84c' },
  list:           { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty:          { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, gap: '1rem' },
  emptyText:      { color: '#6b5a3a', fontSize: '1rem' },
  breadcrumb:     { display: 'flex', alignItems: 'center', marginTop: '0.3rem', gap: '0.15rem' },
  breadcrumbBtn:  { background: 'none', border: 'none', color: '#6a8abf', fontSize: '0.75rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' },
  breadcrumbSep:  { color: '#5a4a2a', fontSize: '0.75rem' },
  breadcrumbCurrent: { color: '#a89060', fontSize: '0.75rem' },
  label:          { display: 'block', color: '#a89060', fontSize: '0.82rem', marginBottom: '0.35rem' },
  input:          { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.9rem', marginBottom: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  row:            { display: 'flex', gap: '0.75rem', marginTop: '0.5rem' },
  err:            { color: '#e05050', fontSize: '0.82rem', marginTop: '-0.6rem', marginBottom: '0.75rem' },
  filterBar:      { display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  searchInput:    { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.4rem 0.7rem', fontSize: '0.85rem', outline: 'none', minWidth: 150 },
  checkLabel:     { color: '#a89060', fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' },
  filterSelect:   { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#a89060', padding: '0.4rem 0.5rem', fontSize: '0.82rem', outline: 'none' },
  btnPrimary:     { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary:   { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },
  flagRow:        { display: 'flex', alignItems: 'center', marginBottom: '0.7rem' },
  flagLabel:      { display: 'flex', alignItems: 'center', color: '#a89060', fontSize: '0.85rem', cursor: 'pointer' },
  floorRow:       { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.9rem', flexWrap: 'wrap' },
  floorHint:      { color: '#6b5a3a', fontSize: '0.75rem', fontStyle: 'italic' },
  connSection:    { borderTop: '1px solid #2a1c08', marginTop: '0.75rem', paddingTop: '0.75rem' },
  connToggle:     { background: 'none', border: 'none', color: '#a89060', fontSize: '0.85rem', cursor: 'pointer', padding: 0 },
  connBody:       { marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  connEmpty:      { color: '#6b5a3a', fontSize: '0.82rem' },
  connRow:        { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.5rem 0.7rem', fontSize: '0.82rem', color: '#e8e0d0' },
  connRel:        { color: '#c9a84c', fontStyle: 'italic' },
  connName:       { fontWeight: 500, marginLeft: '0.2rem' },
  connType:       { color: '#6b5a3a', fontSize: '0.72rem', marginLeft: '0.35rem' },
}
