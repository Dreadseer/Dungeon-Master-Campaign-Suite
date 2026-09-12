import { useState, useEffect, useCallback, useMemo } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import EntityModal from '../../components/world/EntityModal'
import Skeleton from '../../components/ui/Skeleton'
import { notifyError, notifySuccess } from '../../stores/toastStore'
import {
  PLOT_STATUSES, groupPlotsByStatus, plotSessionSummary,
  allowedTransitions, isClosingStatus, sessionLabel,
} from '../../utils/sessionUtils'

const STATUS_META = {
  open:      { label: 'Open',      hint: 'Seeded, not yet in play', color: '#c9a84c' },
  active:    { label: 'Active',    hint: 'The party is pulling on it', color: '#5aa8bf' },
  resolved:  { label: 'Resolved',  hint: 'Answered at the table', color: '#5ba85b' },
  abandoned: { label: 'Abandoned', hint: 'The party walked away', color: '#6b5a3a' },
}

const EMPTY_FORM = { title: '', description: '', status: 'open', opened_session_id: '' }

// A board of what is unresolved. Transitions are buttons rather than drag —
// drag would need a library, and the stack is locked.

export default function PlotThreads() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [plots, setPlots]       = useState([])
  const [sessions, setSessions] = useState([])
  const [current, setCurrent]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const load = useCallback(async () => {
    if (!activeCampaign?.id) return
    setLoading(true)
    try {
      const [threads, sessionRows, currentSession] = await Promise.all([
        window.electronAPI.db.plots.getAll(activeCampaign.id),
        window.electronAPI.db.sessions.getAll(activeCampaign.id),
        window.electronAPI.db.sessions.getCurrent(activeCampaign.id),
      ])
      setPlots(threads)
      setSessions(sessionRows)
      setCurrent(currentSession ?? null)
    } catch (err) {
      notifyError(err, 'Load plot threads')
    } finally {
      setLoading(false)
    }
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupPlotsByStatus(plots), [plots])

  function openCreate() {
    setEditing(null)
    // A new thread opens in the session being played, which is almost always
    // what the DM means when they add one mid-game.
    setForm({ ...EMPTY_FORM, opened_session_id: current?.id ?? '' })
    setError('')
    setModalOpen(true)
  }

  function openEdit(plot) {
    setEditing(plot)
    setForm({
      title: plot.title ?? '',
      description: plot.description ?? '',
      status: plot.status ?? 'open',
      opened_session_id: plot.opened_session_id ?? '',
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) { setError('A thread needs a title.'); return }
    setSaving(true)
    const payload = {
      campaign_id: activeCampaign.id,
      title: form.title.trim(),
      description: form.description,
      status: form.status,
      opened_session_id: form.opened_session_id || null,
      resolved_session_id: editing?.resolved_session_id ?? null,
    }
    try {
      if (editing) await window.electronAPI.db.plots.update(editing.id, payload)
      else         await window.electronAPI.db.plots.create(payload)
      notifySuccess(editing ? 'Thread updated.' : 'Thread added.')
      setModalOpen(false)
      await load()
    } catch (err) {
      notifyError(err, editing ? 'Save thread' : 'Create thread')
    } finally {
      setSaving(false)
    }
  }

  async function handleTransition(plot, status) {
    try {
      // Closing a thread stamps it with the session being played, so "which
      // session closed this" answers itself without the DM remembering to set it.
      await window.electronAPI.db.plots.updateStatus(
        plot.id, status, isClosingStatus(status) ? current?.id ?? null : null)
      notifySuccess(
        isClosingStatus(status) && current
          ? `"${plot.title}" ${status} in ${sessionLabel(current)}.`
          : `"${plot.title}" moved to ${status}.`)
      await load()
    } catch (err) {
      notifyError(err, 'Move thread')
    }
  }

  async function handleDelete(plot) {
    if (!window.confirm(`Delete "${plot.title}"? This cannot be undone.`)) return
    try {
      await window.electronAPI.db.plots.delete(plot.id)
      notifySuccess('Thread deleted.')
      await load()
    } catch (err) {
      notifyError(err, 'Delete thread')
    }
  }

  if (!activeCampaign) return null

  const openCount = groups.open.length + groups.active.length

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Plot Threads</h1>
          <p style={s.count}>
            {openCount} unresolved · {plots.length} total
            {!current && plots.length > 0 && ' · no session in progress'}
          </p>
        </div>
        <button style={s.btnPrimary} onClick={openCreate}>+ New thread</button>
      </div>

      {loading ? <Skeleton count={4} /> : (
        <div style={s.board}>
          {PLOT_STATUSES.map(status => (
            <div key={status} style={s.column}>
              <div style={{ ...s.columnHead, borderBottomColor: STATUS_META[status].color }}>
                <span style={{ ...s.columnTitle, color: STATUS_META[status].color }}>
                  {STATUS_META[status].label}
                </span>
                <span style={s.columnCount}>{groups[status].length}</span>
              </div>
              <p style={s.columnHint}>{STATUS_META[status].hint}</p>

              {groups[status].length === 0 ? (
                <p style={s.columnEmpty}>—</p>
              ) : groups[status].map(plot => (
                <PlotCard
                  key={plot.id}
                  plot={plot}
                  onEdit={() => openEdit(plot)}
                  onDelete={() => handleDelete(plot)}
                  onTransition={(next) => handleTransition(plot, next)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <EntityModal
          title={editing ? 'Edit thread' : 'New plot thread'}
          onClose={() => setModalOpen(false)}
        >
          <form onSubmit={handleSubmit}>
            <label style={s.label}>Title</label>
            <input
              style={s.input}
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Who is funding the Sea Ghosts?"
              autoFocus
            />

            <label style={s.label}>Description</label>
            <textarea
              style={{ ...s.input, minHeight: 90, resize: 'vertical' }}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What is unresolved, and what would resolve it."
            />

            <label style={s.label}>Status</label>
            <select
              style={s.input}
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            >
              {PLOT_STATUSES.map(st => (
                <option key={st} value={st}>{STATUS_META[st].label}</option>
              ))}
            </select>

            <label style={s.label}>Opened in</label>
            <select
              style={s.input}
              value={form.opened_session_id ?? ''}
              onChange={e => setForm(f => ({ ...f, opened_session_id: e.target.value }))}
            >
              <option value="">— not tied to a session —</option>
              {sessions.map(sess => (
                <option key={sess.id} value={sess.id}>
                  {sess.session_number}. {sessionLabel(sess)}
                </option>
              ))}
            </select>

            {error && <p style={s.err}>{error}</p>}

            <div style={s.row}>
              <button type="submit" style={s.btnPrimary} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save' : 'Add thread'}
              </button>
              <button type="button" style={s.btnSecondary} onClick={() => setModalOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </EntityModal>
      )}
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
function PlotCard({ plot, onEdit, onDelete, onTransition }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const summary = plotSessionSummary(plot)

  return (
    <div style={{ ...c.card, borderLeftColor: STATUS_META[plot.status]?.color ?? '#6b5a3a' }}>
      <div style={c.title} onClick={onEdit} title="Edit">{plot.title}</div>

      {plot.description && (
        <p style={c.desc}>
          {plot.description.length > 140 ? `${plot.description.slice(0, 140)}…` : plot.description}
        </p>
      )}

      {summary && <div style={c.summary}>{summary}</div>}

      <div style={c.actions}>
        <button style={c.btnMove} onClick={() => setMenuOpen(o => !o)}>
          Move ▾
        </button>
        <button style={c.btnDelete} onClick={onDelete}>Delete</button>
      </div>

      {menuOpen && (
        <div style={c.menu}>
          {allowedTransitions(plot.status).map(next => (
            <button
              key={next}
              style={{ ...c.menuItem, color: STATUS_META[next].color }}
              onClick={() => { setMenuOpen(false); onTransition(next) }}
            >
              {STATUS_META[next].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const s = {
  page:        { padding: '2rem', maxWidth: 1400 },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  title:       { color: '#c9a84c', fontSize: '1.6rem', margin: 0 },
  count:       { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.2rem 0 0' },
  board:       { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem', alignItems: 'start' },
  column:      { background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, padding: '0.7rem' },
  columnHead:  { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid', paddingBottom: 5 },
  columnTitle: { fontSize: '0.9rem', fontWeight: 'bold' },
  columnCount: { color: '#6b5a3a', fontSize: '0.78rem' },
  columnHint:  { color: '#4a3f28', fontSize: '0.7rem', margin: '5px 0 10px' },
  columnEmpty: { color: '#2a2214', textAlign: 'center', margin: '1rem 0' },
  label:       { display: 'block', color: '#a89060', fontSize: '0.82rem', marginBottom: '0.35rem' },
  input:       { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.9rem', marginBottom: '0.9rem', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  row:         { display: 'flex', gap: '0.75rem', marginTop: '0.5rem' },
  err:         { color: '#e05050', fontSize: '0.82rem', marginTop: '-0.6rem', marginBottom: '0.75rem' },
  btnPrimary:  { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary:{ background: 'none', color: '#a89060', border: '1px solid #3a2a10', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },
}

const c = {
  card:      { position: 'relative', background: '#0d0a05', border: '1px solid #1e1608', borderLeft: '3px solid', borderRadius: 4, padding: '0.6rem 0.7rem', marginBottom: 8 },
  title:     { color: '#e8e0d0', fontSize: '0.86rem', cursor: 'pointer', lineHeight: 1.35 },
  desc:      { color: '#6b5a3a', fontSize: '0.75rem', margin: '5px 0 0', lineHeight: 1.45 },
  summary:   { color: '#4a3f28', fontSize: '0.68rem', marginTop: 6 },
  actions:   { display: 'flex', gap: 6, marginTop: 8 },
  btnMove:   { background: 'none', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer' },
  btnDelete: { background: 'none', border: '1px solid #3a2020', color: '#8a5050', borderRadius: 3, fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer', marginLeft: 'auto' },
  menu:      { position: 'absolute', zIndex: 5, left: 8, bottom: 34, background: '#15100a', border: '1px solid #3a2a10', borderRadius: 4, padding: 4, display: 'flex', flexDirection: 'column', minWidth: 110, boxShadow: '0 4px 16px rgba(0,0,0,0.6)' },
  menuItem:  { background: 'none', border: 'none', textAlign: 'left', fontSize: '0.76rem', padding: '4px 8px', cursor: 'pointer' },
}
