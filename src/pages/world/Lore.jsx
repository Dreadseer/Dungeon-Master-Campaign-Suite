import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import useCampaignStore from '../../stores/campaignStore'
import EntityCard from '../../components/world/EntityCard'
import EntityModal from '../../components/world/EntityModal'
import Skeleton from '../../components/ui/Skeleton'

const CATEGORIES = ['History', 'Faction', 'Location', 'Secret', 'Other']
const EMPTY_FORM  = { name: '', category: 'History', content: '', is_secret: false }

export default function Lore() {
  const activeCampaign  = useCampaignStore(s => s.activeCampaign)
  const [searchParams, setSearchParams] = useSearchParams()

  const [lore, setLore]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [viewEntry, setViewEntry] = useState(null) // full-view mode
  const [form, setForm]         = useState(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [filterCat, setFilterCat] = useState('All')

  const load = useCallback(() => {
    if (!activeCampaign?.id) return
    setLoading(true)
    window.electronAPI.db.lore.getAll(activeCampaign.id).then(l => { setLore(l); setLoading(false) })
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  // ?create=true auto-open
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      openCreate()
      setSearchParams({}, { replace: true })
    }
  }, []) // eslint-disable-line

  const filtered = useMemo(() => {
    if (filterCat === 'All') return lore
    return lore.filter(e => {
      try { return JSON.parse(e.data).category === filterCat } catch { return false }
    })
  }, [lore, filterCat])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setModalOpen(true)
  }

  function openEdit(entry) {
    let parsed = {}
    try { parsed = JSON.parse(entry.data) } catch {}
    setEditing(entry)
    setForm({ name: entry.name, category: parsed.category || 'History', content: parsed.content || '', is_secret: parsed.is_secret ?? false })
    setError('')
    setModalOpen(true)
  }

  function closeModal() { setModalOpen(false); setEditing(null) }

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Entry name is required.'); return }
    setSaving(true)
    const payload = { ...form, campaign_id: activeCampaign.id }
    if (editing) {
      await window.electronAPI.db.lore.update(editing.id, payload)
    } else {
      await window.electronAPI.db.lore.create(payload)
    }
    setSaving(false)
    load()
    closeModal()
  }

  async function handleDelete(entry) {
    await window.electronAPI.db.lore.delete(entry.id)
    load()
  }

  const countLabel = filtered.length === lore.length
    ? `${lore.length} entr${lore.length !== 1 ? 'ies' : 'y'}`
    : `${filtered.length} of ${lore.length}`

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Lore</h1>
          <p style={s.count}>{countLabel}</p>
        </div>
        <button style={s.btnPrimary} onClick={openCreate}>+ New Lore Entry</button>
      </div>

      {/* Category filter tabs */}
      <div style={s.tabs}>
        {['All', ...CATEGORIES].map(cat => (
          <button key={cat}
            style={{ ...s.tab, ...(filterCat === cat ? s.tabActive : {}) }}
            onClick={() => setFilterCat(cat)}>
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton count={3} height="4rem" />
      ) : lore.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No lore entries yet. Every world has a history waiting to be written.</p>
          <button style={s.btnPrimary} onClick={openCreate}>+ New Lore Entry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No lore entries in this category.</p>
        </div>
      ) : (
        <div style={s.list}>
          {filtered.map(entry => {
            let parsed = {}
            try { parsed = JSON.parse(entry.data) } catch {}
            const isSecret = parsed.is_secret
            const preview  = (parsed.content || '').slice(0, 150)

            return (
              <EntityCard
                key={entry.id}
                title={`${isSecret ? '🔒 ' : ''}${entry.name}`}
                subtitle={parsed.category || 'Other'}
                tags={[]}
                meta={new Date(entry.created_at).toLocaleDateString()}
                onClick={() => setViewEntry(entry)}
                onDelete={() => handleDelete(entry)}
                accentColor={isSecret ? '#6a2020' : '#c9a84c'}
              >
                <p style={{ ...s.preview, ...(isSecret ? s.secretPreview : {}) }}>
                  {preview}{(parsed.content || '').length > 150 ? '…' : ''}
                </p>
                <button style={s.editBtn} onClick={e => { e.stopPropagation(); openEdit(entry) }}>Edit</button>
              </EntityCard>
            )
          })}
        </div>
      )}

      {/* Full-view mode */}
      {viewEntry && (() => {
        let parsed = {}
        try { parsed = JSON.parse(viewEntry.data) } catch {}
        return (
          <div style={s.overlay} onClick={() => setViewEntry(null)}>
            <div style={{ ...s.fullView, ...(parsed.is_secret ? s.fullViewSecret : {}) }}
              onClick={e => e.stopPropagation()}>
              <div style={s.fvHeader}>
                <h2 style={s.fvTitle}>{parsed.is_secret ? '🔒 ' : ''}{viewEntry.name}</h2>
                <span style={s.fvCat}>{parsed.category}</span>
              </div>
              <div style={s.fvBody}>
                {(parsed.content || '').split('\n').map((line, i) => (
                  <p key={i} style={s.fvLine}>{line}</p>
                ))}
              </div>
              <div style={s.fvFooter}>
                <button style={s.btnPrimary} onClick={() => { setViewEntry(null); openEdit(viewEntry) }}>Edit</button>
                <button style={s.btnSecondary} onClick={() => setViewEntry(null)}>Close</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Create / Edit modal */}
      <EntityModal title={editing ? `Edit: ${editing.name}` : 'New Lore Entry'} isOpen={modalOpen} onClose={closeModal}>
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Entry Name *</label>
          <input style={s.input} value={form.name} onChange={e => setField('name', e.target.value)}
            placeholder="The Founding of Riverdale" autoFocus />
          {error && <p style={s.err}>{error}</p>}

          <label style={s.label}>Category</label>
          <select style={s.input} value={form.category} onChange={e => setField('category', e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <label style={s.checkLabel}>
            <input type="checkbox" checked={form.is_secret} onChange={e => setField('is_secret', e.target.checked)} />
            {' '}DM Only (Secret)
          </label>

          <label style={s.label}>Content</label>
          <textarea style={{ ...s.input, height: 180, resize: 'vertical' }}
            value={form.content} onChange={e => setField('content', e.target.value)}
            placeholder="Write the lore here…" />

          <div style={s.footer}>
            <button style={s.btnPrimary} type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Entry'}
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
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' },
  title:       { color: '#c9a84c', fontSize: '1.6rem', margin: 0 },
  count:       { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.2rem 0 0' },
  tabs:        { display: 'flex', gap: '0.3rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
  tab:         { background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', padding: '0.3rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' },
  tabActive:   { background: '#2d1f0a', border: '1px solid #c9a84c', color: '#c9a84c' },
  list:        { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, gap: '1rem' },
  emptyText:   { color: '#6b5a3a', fontSize: '1rem' },
  preview:     { color: '#a89060', fontSize: '0.82rem', margin: '0.3rem 0 0.5rem', lineHeight: 1.4 },
  secretPreview: { color: '#c07070' },
  editBtn:     { background: 'none', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.15rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' },
  // Full-view
  overlay:     { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  fullView:    { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 8, padding: '2rem', maxWidth: 640, width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: '1rem' },
  fullViewSecret: { border: '1px solid #6a2020', background: '#140a0a' },
  fvHeader:    { display: 'flex', alignItems: 'center', gap: '1rem' },
  fvTitle:     { color: '#c9a84c', fontSize: '1.4rem', margin: 0, fontFamily: 'Georgia, serif', flex: 1 },
  fvCat:       { background: '#2d1f0a', border: '1px solid #3a2a10', color: '#a89060', padding: '0.2rem 0.6rem', borderRadius: 4, fontSize: '0.78rem' },
  fvBody:      { overflowY: 'auto', flex: 1 },
  fvLine:      { color: '#e8e0d0', fontSize: '0.95rem', lineHeight: 1.7, margin: '0 0 0.5rem' },
  fvFooter:    { display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' },
  // Modal form
  label:       { display: 'block', color: '#a89060', fontSize: '0.82rem', marginBottom: '0.35rem' },
  input:       { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.9rem', marginBottom: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  checkLabel:  { color: '#a89060', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.9rem' },
  footer:      { display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', paddingTop: '0.75rem', borderTop: '1px solid #2a1c08' },
  err:         { color: '#e05050', fontSize: '0.82rem', marginTop: '-0.6rem', marginBottom: '0.75rem' },
  btnPrimary:  { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },
}
