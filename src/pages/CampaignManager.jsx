import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useCampaignStore from '../stores/campaignStore'
import { notifyError, notifySuccess } from '../stores/toastStore'

export default function CampaignManager() {
  const { activeCampaign, setActiveCampaign, clearActiveCampaign } = useCampaignStore()
  const [campaigns, setCampaigns]   = useState([])
  const [showModal, setShowModal]   = useState(false)
  const [stats, setStats]           = useState({ npcsAlive: 0, npcsDead: 0, locations: 0, encounters: 0, characters: 0 })
  const [notes, setNotes]           = useState('')
  const navigate = useNavigate()

  const loadCampaigns = useCallback(() => {
    window.electronAPI.db.campaigns.getAll().then(setCampaigns)
  }, [])

  // Restore persisted campaign on mount
  useEffect(() => {
    loadCampaigns()
    if (activeCampaign?.id && !activeCampaign.name) {
      window.electronAPI.db.campaigns.getById(activeCampaign.id).then(c => {
        if (c) setActiveCampaign(c)
        else clearActiveCampaign()
      })
    }
  }, []) // eslint-disable-line

  // Load stats and the session in progress when the active campaign changes.
  //
  // The notes textarea used to write to campaigns.description, which meant every
  // session overwrote the last one's notes. It now edits the CURRENT SESSION's
  // notes (Phase 4). campaigns.description goes back to being a description of
  // the campaign, which is what the column was named for; migration 011 copied
  // any existing notes into a first session rather than moving them, so nothing
  // written before this change is lost.
  const loadSession = useCallback(async () => {
    if (!activeCampaign?.id) return
    try {
      const session = await window.electronAPI.db.sessions.getCurrent(activeCampaign.id)
      setCurrentSession(session ?? null)
      setNotes(session?.notes ?? '')
    } catch (err) {
      notifyError(err, 'Load current session')
    }
  }, [activeCampaign?.id])

  useEffect(() => {
    if (!activeCampaign?.id) return
    loadSession()
    Promise.all([
      window.electronAPI.db.npcs.getAll(activeCampaign.id),
      window.electronAPI.db.locations.getAll(activeCampaign.id),
      window.electronAPI.db.encounters.getAll(activeCampaign.id),
      window.electronAPI.db.characters.getAll(activeCampaign.id),
    ]).then(([npcs, locations, encounters, characters]) => {
      const alive = npcs.filter(n => n.is_alive).length
      setStats({
        npcsAlive: alive, npcsDead: npcs.length - alive,
        locations: locations.length, encounters: encounters.length, characters: characters.length,
      })
    }).catch(err => notifyError(err, 'Load campaign stats'))
  }, [activeCampaign?.id, loadSession]) // eslint-disable-line

  const [currentSession, setCurrentSession] = useState(null)
  const [notesSaveState, setNotesSaveState] = useState('idle')
  const [startingSession, setStartingSession] = useState(false)

  async function handleStartSession() {
    if (!activeCampaign?.id) return
    setStartingSession(true)
    try {
      const { session_number } = await window.electronAPI.db.sessions.create({
        campaign_id: activeCampaign.id,
        played_on: new Date().toISOString().slice(0, 10),
      })
      notifySuccess(`Session ${session_number} started. Notes below are now its own.`)
      await loadSession()
      await loadCampaigns()
    } catch (err) {
      notifyError(err, 'Start session')
    } finally {
      setStartingSession(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this campaign? This cannot be undone.')) return
    try {
      await window.electronAPI.db.campaigns.delete(id)
      if (activeCampaign?.id === id) clearActiveCampaign()
      notifySuccess('Campaign deleted.')
      loadCampaigns()
    } catch (err) {
      // The active campaign is deliberately left selected on failure — it still
      // exists, and clearing it would strand the user on an empty screen.
      notifyError(err, 'Delete campaign')
    }
  }

  async function handleNotesBlur() {
    if (!activeCampaign) return

    // No session yet: start one rather than dropping what was just typed. A DM
    // who opens a fresh campaign and writes into the notes box means those
    // words to be kept.
    if (!currentSession) {
      if (!notes.trim()) return
      setNotesSaveState('saving')
      try {
        const { lastInsertRowid } = await window.electronAPI.db.sessions.create({
          campaign_id: activeCampaign.id,
          played_on: new Date().toISOString().slice(0, 10),
          notes,
        })
        setNotesSaveState('saved')
        setTimeout(() => setNotesSaveState('idle'), 2000)
        await loadSession()
        await loadCampaigns()
        return lastInsertRowid
      } catch (err) {
        setNotesSaveState('error')
        notifyError(err, 'Save session notes')
      }
      return
    }

    if (notes === (currentSession.notes ?? '')) return
    setNotesSaveState('saving')
    try {
      await window.electronAPI.db.sessions.updateNotes(currentSession.id, notes)
      setCurrentSession(prev => (prev ? { ...prev, notes } : prev))
      setNotesSaveState('saved')
      setTimeout(() => setNotesSaveState('idle'), 2000)
    } catch (err) {
      setNotesSaveState('error')
      notifyError(err, 'Save session notes')
    }
  }

  if (activeCampaign?.name) {
    return <ViewB
      campaign={activeCampaign}
      stats={stats}
      currentSession={currentSession}
      notesSaveState={notesSaveState}
      startingSession={startingSession}
      onStartSession={handleStartSession}
      notes={notes}
      onNotesChange={setNotes}
      onNotesBlur={handleNotesBlur}
      onSwitch={clearActiveCampaign}
      navigate={navigate}
    />
  }

  return (
    <ViewA
      campaigns={campaigns}
      showModal={showModal}
      onOpenModal={() => setShowModal(true)}
      onCloseModal={() => setShowModal(false)}
      onLoad={setActiveCampaign}
      onDelete={handleDelete}
      onCreated={loadCampaigns}
    />
  )
}

// ─── View A: Campaign List ────────────────────────────────────────────────

function ViewA({ campaigns, showModal, onOpenModal, onCloseModal, onLoad, onDelete, onCreated }) {
  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Your Campaigns</h1>
        <button style={s.btnPrimary} onClick={onOpenModal}>+ New Campaign</button>
      </div>

      {campaigns.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No campaigns yet. Create your first world.</p>
          <button style={s.btnPrimary} onClick={onOpenModal}>+ New Campaign</button>
        </div>
      ) : (
        <div style={s.grid}>
          {campaigns.map(c => (
            <CampaignCard key={c.id} campaign={c} onLoad={onLoad} onDelete={onDelete} />
          ))}
        </div>
      )}

      {showModal && <NewCampaignModal onClose={onCloseModal} onCreated={onCreated} onLoad={onLoad} />}
    </div>
  )
}

function CampaignCard({ campaign, onLoad, onDelete }) {
  const date = new Date(campaign.created_at).toLocaleDateString()
  return (
    <div style={s.card}>
      <h2 style={s.cardTitle}>{campaign.name}</h2>
      {campaign.world_setting && <p style={s.cardSetting}>{campaign.world_setting}</p>}
      {campaign.description   && <p style={s.cardDesc}>{campaign.description}</p>}
      {/* session_count is true as of Phase 4 — it was read and never written before. */}
      <p style={s.cardMeta}>
        {campaign.session_count ?? 0} session{(campaign.session_count ?? 0) !== 1 ? 's' : ''} · Created {date}
      </p>
      <div style={s.cardActions}>
        <button style={s.btnPrimary} onClick={() => onLoad(campaign)}>Load Campaign</button>
        <button style={s.btnDanger}  onClick={() => onDelete(campaign.id)}>Delete</button>
      </div>
    </div>
  )
}

function NewCampaignModal({ onClose, onCreated, onLoad }) {
  const [form, setForm] = useState({ name: '', description: '', world_setting: '' })
  const [saving, setSaving] = useState(false)

  function setField(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    const result  = await window.electronAPI.db.campaigns.create(form)
    const created = await window.electronAPI.db.campaigns.getById(result.lastInsertRowid)
    onCreated()
    onLoad(created)
    onClose()
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <h2 style={s.modalTitle}>New Campaign</h2>
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Campaign Name *</label>
          <input style={s.input} value={form.name}
            onChange={e => setField('name', e.target.value)}
            placeholder="The Shattered Realm" autoFocus required />

          <label style={s.label}>Description</label>
          <textarea style={{ ...s.input, height: 80, resize: 'vertical' }}
            value={form.description}
            onChange={e => setField('description', e.target.value)}
            placeholder="A brief description of your campaign…" />

          <label style={s.label}>World Setting</label>
          <input style={s.input} value={form.world_setting}
            onChange={e => setField('world_setting', e.target.value)}
            placeholder="Forgotten Realms, Homebrew, Eberron…" />

          <div style={{ ...s.cardActions, marginTop: '1.5rem' }}>
            <button style={s.btnPrimary} type="submit" disabled={saving || !form.name.trim()}>
              {saving ? 'Creating…' : 'Create Campaign'}
            </button>
            <button style={s.btnSecondary} type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── View B: Active Campaign Dashboard ───────────────────────────────────

function ViewB({ campaign, stats, notes, onNotesChange, onNotesBlur, onSwitch, navigate,
                 currentSession, notesSaveState, startingSession, onStartSession }) {
  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>{campaign.name}</h1>
          {campaign.world_setting && <p style={s.cardSetting}>{campaign.world_setting}</p>}
        </div>
        <button style={s.btnSecondary} onClick={onSwitch}>Switch Campaign</button>
      </div>

      <div style={s.statsGrid}>
        <StatCard label="NPCs"       value={stats.npcsAlive + stats.npcsDead} sub={`${stats.npcsAlive} alive · ${stats.npcsDead} dead`} />
        <StatCard label="Locations"  value={stats.locations} />
        <StatCard label="Encounters" value={stats.encounters} />
        <StatCard label="Characters" value={stats.characters} />
      </div>

      <div style={s.section}>
        <div style={s.notesHead}>
          <label style={s.label}>
            {currentSession
              ? `Session ${currentSession.session_number} notes`
              : 'Session notes'}
          </label>
          <span style={s.notesSaveState}>
            {notesSaveState === 'saving' && 'Saving…'}
            {notesSaveState === 'saved'  && <span style={{ color: '#5ba85b' }}>✓ Saved</span>}
            {notesSaveState === 'error'  && <span style={{ color: '#e05050' }}>Not saved</span>}
          </span>
          <button
            style={startingSession ? s.btnNewSessionDisabled : s.btnNewSession}
            onClick={onStartSession}
            disabled={startingSession}
            title="Start a new session. The current notes stay with the session they belong to."
          >
            {startingSession ? 'Starting…' : '+ New session'}
          </button>
        </div>
        {!currentSession && (
          <p style={s.notesHint}>
            No session started yet — typing here starts session 1.
          </p>
        )}
        <textarea
          style={{ ...s.input, height: 160, resize: 'vertical', width: '100%' }}
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          onBlur={onNotesBlur}
          placeholder="Notes about the current session…"
        />
      </div>

      <div style={s.section}>
        <p style={s.label}>Quick Actions</p>
        <div style={s.cardActions}>
          <button style={s.btnSecondary} onClick={() => navigate('/world')}>Add NPC</button>
          <button style={s.btnSecondary} onClick={() => navigate('/world')}>Add Location</button>
          <button style={s.btnSecondary} onClick={() => navigate('/encounters')}>New Encounter</button>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div style={s.statCard}>
      <span style={s.statValue}>{value}</span>
      <span style={s.statLabel}>{label}</span>
      {sub && <span style={s.statSub}>{sub}</span>}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────

const s = {
  notesHead:      { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
  notesSaveState: { color: '#6b5a3a', fontSize: '0.75rem', marginLeft: 'auto' },
  notesHint:      { color: '#4a3f28', fontSize: '0.75rem', margin: '0 0 6px' },
  btnNewSession:  { background: 'none', border: '1px solid #3a2a10', color: '#c9a84c', borderRadius: 4, padding: '3px 10px', fontSize: '0.75rem', cursor: 'pointer' },
  btnNewSessionDisabled: { background: 'none', border: '1px solid #241a08', color: '#4a3f28', borderRadius: 4, padding: '3px 10px', fontSize: '0.75rem', cursor: 'not-allowed' },
  page:         { padding: '2rem', maxWidth: 900 },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' },
  title:        { color: '#c9a84c', fontSize: '1.8rem', margin: 0 },
  grid:         { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' },
  card:         { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 8, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  cardTitle:    { color: '#e8e0d0', fontSize: '1.1rem', margin: 0 },
  cardSetting:  { color: '#c9a84c', fontSize: '0.8rem', margin: 0 },
  cardDesc:     { color: '#a89060', fontSize: '0.85rem', margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  cardMeta:     { color: '#6b5a3a', fontSize: '0.75rem', margin: 0 },
  cardActions:  { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  statsGrid:    { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' },
  statCard:     { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 8, padding: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' },
  statValue:    { color: '#c9a84c', fontSize: '2rem', fontWeight: 'bold' },
  statLabel:    { color: '#a89060', fontSize: '0.8rem' },
  statSub:      { color: '#6b5a3a', fontSize: '0.72rem' },
  section:      { marginBottom: '1.5rem' },
  empty:        { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: '1rem' },
  emptyText:    { color: '#6b5a3a', fontSize: '1rem' },
  overlay:      { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:        { background: '#1a1208', border: '1px solid #c9a84c', borderRadius: 8, padding: '2rem', width: 480, maxWidth: '90vw' },
  modalTitle:   { color: '#c9a84c', fontSize: '1.3rem', marginBottom: '1.25rem' },
  label:        { display: 'block', color: '#a89060', fontSize: '0.85rem', marginBottom: '0.4rem' },
  input:        { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.5rem 0.75rem', fontSize: '0.9rem', marginBottom: '1rem', outline: 'none', boxSizing: 'border-box' },
  btnPrimary:   { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' },
  btnSecondary: { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
  btnDanger:    { background: 'transparent', color: '#e05050', border: '1px solid #e05050', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' },
}
