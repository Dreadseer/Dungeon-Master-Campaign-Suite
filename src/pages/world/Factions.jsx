import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import useCampaignStore from '../../stores/campaignStore'
import EntityCard from '../../components/world/EntityCard'
import EntityModal from '../../components/world/EntityModal'
import Skeleton from '../../components/ui/Skeleton'

const ALIGNMENTS = [
  'Lawful Good', 'Neutral Good', 'Chaotic Good',
  'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
  'Lawful Evil', 'Neutral Evil', 'Chaotic Evil', 'Unknown',
]

const EMPTY_FORM = { name: '', alignment: 'Unknown', description: '', notes: '' }

export default function Factions() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)
  const [factions, setFactions]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [modalOpen, setModalOpen]     = useState(false)
  const [editing, setEditing]         = useState(null)
  const [form, setForm]               = useState(EMPTY_FORM)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [searchParams, setSearchParams] = useSearchParams()

  const load = useCallback(() => {
    if (!activeCampaign?.id) return
    setLoading(true)
    window.electronAPI.db.factions.getAll(activeCampaign.id).then(f => { setFactions(f); setLoading(false) })
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  // ?create=true auto-opens the modal
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      openCreate()
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setModalOpen(true)
  }

  function openEdit(faction) {
    setEditing(faction)
    setForm({ name: faction.name, alignment: faction.alignment || 'Unknown', description: faction.description || '', notes: faction.notes || '' })
    setError('')
    setModalOpen(true)
  }

  function closeModal() { setModalOpen(false); setEditing(null) }

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Faction name is required.'); return }
    setSaving(true)
    if (editing) {
      await window.electronAPI.db.factions.update(editing.id, form)
    } else {
      await window.electronAPI.db.factions.create({ ...form, campaign_id: activeCampaign.id })
    }
    setSaving(false)
    load()
    closeModal()
  }

  async function handleDelete(faction) {
    await window.electronAPI.db.factions.delete(faction.id)
    load()
  }

  const createdDate = (f) => new Date(f.created_at).toLocaleDateString()

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Factions</h1>
          <p style={s.count}>{factions.length} faction{factions.length !== 1 ? 's' : ''}</p>
        </div>
        <button style={s.btnPrimary} onClick={openCreate}>+ New Faction</button>
      </div>

      {loading ? (
        <Skeleton count={3} height="4rem" />
      ) : factions.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No factions yet. Great stories need sides to take.</p>
          <button style={s.btnPrimary} onClick={openCreate}>+ New Faction</button>
        </div>
      ) : (
        <div style={s.list}>
          {factions.map(f => (
            <EntityCard
              key={f.id}
              title={f.name}
              subtitle={f.alignment || 'Unknown alignment'}
              tags={f.description ? [{ label: f.description.slice(0, 60) + (f.description.length > 60 ? '…' : ''), color: '#1a1208', text: '#a89060' }] : []}
              meta={createdDate(f)}
              onClick={() => openEdit(f)}
              onDelete={() => handleDelete(f)}
              accentColor="#8a5a9a"
            />
          ))}
        </div>
      )}

      <EntityModal
        title={editing ? `Edit: ${editing.name}` : 'New Faction'}
        isOpen={modalOpen}
        onClose={closeModal}
      >
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Faction Name *</label>
          <input style={s.input} value={form.name} onChange={e => setField('name', e.target.value)}
            placeholder="The Iron Wolves" autoFocus required />
          {error && <p style={s.err}>{error}</p>}

          <label style={s.label}>Alignment</label>
          <select style={s.input} value={form.alignment} onChange={e => setField('alignment', e.target.value)}>
            {ALIGNMENTS.map(a => <option key={a}>{a}</option>)}
          </select>

          <label style={s.label}>Description</label>
          <textarea style={{ ...s.input, height: 64, resize: 'vertical' }}
            value={form.description} onChange={e => setField('description', e.target.value)}
            placeholder="A brief summary of this faction..." />

          <label style={s.label}>Notes (DM Only)</label>
          <textarea style={{ ...s.input, height: 96, resize: 'vertical' }}
            value={form.notes} onChange={e => setField('notes', e.target.value)}
            placeholder="Private DM notes — secrets, plans, true allegiances..." />

          <div style={s.row}>
            <button style={s.btnPrimary} type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Faction'}
            </button>
            <button style={s.btnSecondary} type="button" onClick={closeModal}>Cancel</button>
          </div>
        </form>
      </EntityModal>
    </div>
  )
}

const s = {
  page:        { padding: '2rem', maxWidth: 800 },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  title:       { color: '#c9a84c', fontSize: '1.6rem', margin: 0 },
  count:       { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.2rem 0 0' },
  list:        { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 240, gap: '1rem' },
  emptyText:   { color: '#6b5a3a', fontSize: '1rem' },
  label:       { display: 'block', color: '#a89060', fontSize: '0.82rem', marginBottom: '0.35rem' },
  input:       { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.9rem', marginBottom: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  row:         { display: 'flex', gap: '0.75rem', marginTop: '0.5rem' },
  err:         { color: '#e05050', fontSize: '0.82rem', marginTop: '-0.6rem', marginBottom: '0.75rem' },
  btnPrimary:  { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },
}
