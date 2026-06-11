import { useState, useEffect, useCallback } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import EntityModal from '../../components/world/EntityModal'
import Skeleton from '../../components/ui/Skeleton'

const ENTITY_TYPES = ['npc', 'location', 'faction']
const RELATIONSHIP_SUGGESTIONS = [
  'ally', 'enemy', 'member of', 'rival', 'family', 'lover',
  'employer', 'employee', 'owns', 'worships', 'fears',
  'knows secret of', 'neutral', 'shop keeper', 'tradesman',
]

const EMPTY_FORM = {
  entity_a_type: 'npc', entity_a_id: '',
  entity_b_type: 'npc', entity_b_id: '',
  relationship: '', notes: '',
}

export default function Connections() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [connections, setConnections] = useState([])
  const [entityMap, setEntityMap]     = useState({})
  const [loading, setLoading]         = useState(true)  // { "npc:1": "Mira Ashveil", ... }
  const [allEntities, setAllEntities] = useState({ npc: [], location: [], faction: [] })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [filterType, setFilterType] = useState('all')

  const load = useCallback(async () => {
    if (!activeCampaign?.id) return
    const [conns, npcs, locations, factions] = await Promise.all([
      window.electronAPI.db.connections.getAll(activeCampaign.id),
      window.electronAPI.db.npcs.getAll(activeCampaign.id),
      window.electronAPI.db.locations.getAll(activeCampaign.id),
      window.electronAPI.db.factions.getAll(activeCampaign.id),
    ])
    setConnections(conns)
    setAllEntities({ npc: npcs, location: locations, faction: factions })
    setLoading(false)
    const map = {}
    npcs.forEach(e      => { map[`npc:${e.id}`]      = e.name })
    locations.forEach(e => { map[`location:${e.id}`] = e.name })
    factions.forEach(e  => { map[`faction:${e.id}`]  = e.name })
    setEntityMap(map)
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  function resolveEntityName(type, id) {
    return entityMap[`${type}:${id}`] || `Unknown ${type}`
  }

  const filtered = filterType === 'all'
    ? connections
    : connections.filter(c => c.entity_a_type === filterType || c.entity_b_type === filterType)

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setModalOpen(true)
  }

  function openEdit(conn) {
    setEditing(conn)
    setForm({
      entity_a_type: conn.entity_a_type,
      entity_a_id:   conn.entity_a_id,
      entity_b_type: conn.entity_b_type,
      entity_b_id:   conn.entity_b_id,
      relationship:  conn.relationship || '',
      notes:         conn.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  function closeModal() { setModalOpen(false); setEditing(null) }
  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.entity_a_id || !form.entity_b_id) { setError('Both entities are required.'); return }
    if (form.entity_a_type === form.entity_b_type && String(form.entity_a_id) === String(form.entity_b_id)) {
      setError('Entity A and Entity B cannot be the same entity.')
      return
    }
    if (!form.relationship.trim()) { setError('Relationship is required.'); return }
    setSaving(true)
    const payload = {
      campaign_id:   activeCampaign.id,
      entity_a_type: form.entity_a_type,
      entity_a_id:   Number(form.entity_a_id),
      entity_b_type: form.entity_b_type,
      entity_b_id:   Number(form.entity_b_id),
      relationship:  form.relationship,
      notes:         form.notes,
    }
    if (editing) {
      await window.electronAPI.db.connections.update(editing.id, payload)
    } else {
      await window.electronAPI.db.connections.create(payload)
    }
    setSaving(false)
    load()
    closeModal()
  }

  async function handleDelete(conn) {
    await window.electronAPI.db.connections.delete(conn.id)
    load()
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Connections</h1>
          <p style={s.count}>{filtered.length} connection{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button style={s.btnPrimary} onClick={openCreate}>+ New Connection</button>
      </div>

      {/* Filter */}
      <div style={s.filterBar}>
        <span style={s.filterLabel}>Show:</span>
        {['all', 'npc', 'location', 'faction'].map(t => (
          <button key={t}
            style={{ ...s.filterBtn, ...(filterType === t ? s.filterBtnActive : {}) }}
            onClick={() => setFilterType(t)}>
            {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1) + 's'}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton count={3} height="3rem" />
      ) : connections.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No connections yet. Every web of intrigue starts with a single thread.</p>
          <button style={s.btnPrimary} onClick={openCreate}>+ New Connection</button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No connections for this entity type.</p>
        </div>
      ) : (
        <div style={s.list}>
          {filtered.map(conn => {
            const nameA = resolveEntityName(conn.entity_a_type, conn.entity_a_id)
            const nameB = resolveEntityName(conn.entity_b_type, conn.entity_b_id)
            return (
              <div key={conn.id} style={s.row}>
                <div style={s.rowMain}>
                  <span style={{ ...s.typeTag, ...s.typeColors[conn.entity_a_type] }}>{conn.entity_a_type}</span>
                  <span style={s.entityName}>{nameA}</span>
                  <span style={s.rel}>— {conn.relationship} —</span>
                  <span style={s.entityName}>{nameB}</span>
                  <span style={{ ...s.typeTag, ...s.typeColors[conn.entity_b_type] }}>{conn.entity_b_type}</span>
                </div>
                {conn.notes && <p style={s.rowNotes}>{conn.notes}</p>}
                <div style={s.rowActions}>
                  <button style={s.actionBtn} onClick={() => openEdit(conn)}>Edit</button>
                  <DeleteBtn onConfirm={() => handleDelete(conn)} label={`${nameA} ↔ ${nameB}`} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <EntityModal title={editing ? 'Edit Connection' : 'New Connection'} isOpen={modalOpen} onClose={closeModal}>
        <form onSubmit={handleSubmit}>
          {error && <p style={s.err}>{error}</p>}

          <div style={s.entityRow}>
            <div style={s.entityHalf}>
              <label style={s.label}>Entity A — Type</label>
              <select style={s.input} value={form.entity_a_type}
                onChange={e => setField('entity_a_type', e.target.value)}>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
              <label style={s.label}>Entity A — Name</label>
              <select style={s.input} value={form.entity_a_id}
                onChange={e => setField('entity_a_id', e.target.value)}>
                <option value="">Select…</option>
                {(allEntities[form.entity_a_type] || []).map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div style={s.entityHalf}>
              <label style={s.label}>Entity B — Type</label>
              <select style={s.input} value={form.entity_b_type}
                onChange={e => setField('entity_b_type', e.target.value)}>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
              <label style={s.label}>Entity B — Name</label>
              <select style={s.input} value={form.entity_b_id}
                onChange={e => setField('entity_b_id', e.target.value)}>
                <option value="">Select…</option>
                {(allEntities[form.entity_b_type] || []).map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
          </div>

          <label style={s.label}>Relationship</label>
          <input style={s.input} list="rel-list" value={form.relationship}
            onChange={e => setField('relationship', e.target.value)}
            placeholder="ally, enemy, member of…" />
          <datalist id="rel-list">
            {RELATIONSHIP_SUGGESTIONS.map(r => <option key={r} value={r} />)}
          </datalist>

          <label style={s.label}>Notes (optional)</label>
          <textarea style={{ ...s.input, height: 72, resize: 'vertical' }}
            value={form.notes} onChange={e => setField('notes', e.target.value)}
            placeholder="Context about this relationship…" />

          <div style={s.footer}>
            <button style={s.btnPrimary} type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Connection'}
            </button>
            <button style={s.btnSecondary} type="button" onClick={closeModal}>Cancel</button>
          </div>
        </form>
      </EntityModal>
    </div>
  )
}

function DeleteBtn({ onConfirm, label }) {
  const [confirm, setConfirm] = useState(false)
  if (confirm) return (
    <span style={{ fontSize: '0.78rem' }}>
      <span style={{ color: '#a89060' }}>Delete {label}? </span>
      <button style={{ ...btnBase, color: '#e05050', marginRight: '0.3rem' }} onClick={onConfirm}>Yes</button>
      <button style={{ ...btnBase, color: '#a89060' }} onClick={() => setConfirm(false)}>No</button>
    </span>
  )
  return <button style={{ ...btnBase, color: '#c06060' }} onClick={() => setConfirm(true)}>Delete</button>
}
const btnBase = { background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', padding: '0 0.2rem' }

const s = {
  page:         { padding: '2rem', maxWidth: 900 },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  title:        { color: '#c9a84c', fontSize: '1.6rem', margin: 0 },
  count:        { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.2rem 0 0' },
  filterBar:    { display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '1.25rem' },
  filterLabel:  { color: '#6b5a3a', fontSize: '0.82rem' },
  filterBtn:    { background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', padding: '0.25rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' },
  filterBtnActive: { background: '#2d1f0a', border: '1px solid #c9a84c', color: '#c9a84c' },
  list:         { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty:        { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, gap: '1rem' },
  emptyText:    { color: '#6b5a3a', fontSize: '1rem' },
  row:          { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 6, padding: '0.75rem 1rem' },
  rowMain:      { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  entityName:   { color: '#e8e0d0', fontSize: '0.9rem', fontWeight: 500 },
  rel:          { color: '#a89060', fontSize: '0.85rem', fontStyle: 'italic' },
  typeTag:      { fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 3, fontWeight: 'bold' },
  typeColors:   {
    npc:      { background: '#1a1a2a', color: '#6a8abf', border: '1px solid #2a2a4a' },
    location: { background: '#1a2a1a', color: '#5a9a5a', border: '1px solid #2a4a2a' },
    faction:  { background: '#1e1228', color: '#9a6abf', border: '1px solid #3a1a5a' },
  },
  rowNotes:     { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.4rem 0 0', fontStyle: 'italic' },
  rowActions:   { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' },
  actionBtn:    { background: 'none', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.15rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' },
  // Modal
  entityRow:    { display: 'flex', gap: '1rem', marginBottom: '0.5rem' },
  entityHalf:   { flex: 1 },
  label:        { display: 'block', color: '#a89060', fontSize: '0.82rem', marginBottom: '0.35rem' },
  input:        { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.9rem', marginBottom: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  footer:       { display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', paddingTop: '0.75rem', borderTop: '1px solid #2a1c08' },
  err:          { color: '#e05050', fontSize: '0.82rem', marginBottom: '0.75rem' },
  btnPrimary:   { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary: { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },
}
