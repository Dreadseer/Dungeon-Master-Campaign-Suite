import { useState, useEffect, useCallback, useRef } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import Skeleton from '../../components/ui/Skeleton'
import {
  buildRecapInput, buildRecapPrompt, parseRecap, hasRecapMaterial,
} from '../../utils/sessionRecap'
import { notifyError, notifySuccess } from '../../stores/toastStore'
import { formatSessionDate, sessionLabel } from '../../utils/sessionUtils'

// The campaign's memory: one row per session played, newest first.
//
// Notes autosave on blur rather than behind a Save button. A DM typing during a
// game will not remember to press anything, and the old single-textarea design
// lost last week's notes the moment this week's were typed over them.

export default function Sessions() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail]     = useState(null)
  const [plots, setPlots]       = useState([])
  const [recapMaterial, setRecapMaterial] = useState(null)
  const [reveals, setReveals]   = useState([])
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!activeCampaign?.id) return
    setLoading(true)
    try {
      const rows = await window.electronAPI.db.sessions.getAll(activeCampaign.id)
      setSessions(rows)
      setSelectedId(prev => (prev && rows.some(r => r.id === prev)) ? prev : rows[0]?.id ?? null)
    } catch (err) {
      notifyError(err, 'Load sessions')
    } finally {
      setLoading(false)
    }
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  // Detail, plus everything linked to this session.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null); setPlots([]); setReveals([]); setRecapMaterial(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        // A recap needs the entities the reveals point AT, not just the reveal
        // rows, plus every reveal in the campaign so an earlier session's
        // disclosure still counts as known.
        const [session, allPlots, sessionReveals, allReveals, lore, npcs] = await Promise.all([
          window.electronAPI.db.sessions.getById(selectedId),
          window.electronAPI.db.plots.getAll(activeCampaign.id),
          window.electronAPI.db.reveals.getForSession(selectedId),
          window.electronAPI.db.reveals.getForCampaign(activeCampaign.id),
          window.electronAPI.db.lore.getAll(activeCampaign.id),
          window.electronAPI.db.npcs.getAll(activeCampaign.id),
        ])
        if (cancelled) return
        setDetail(session)
        setPlots(allPlots.filter(p =>
          p.opened_session_id === selectedId || p.resolved_session_id === selectedId))
        setReveals(sessionReveals)
        setRecapMaterial({ allPlots, allReveals, lore, npcs })
      } catch (err) {
        if (!cancelled) notifyError(err, 'Load session')
      }
    })()
    return () => { cancelled = true }
  }, [selectedId, activeCampaign?.id])

  async function handleNewSession() {
    if (!activeCampaign?.id) return
    setCreating(true)
    try {
      const { session_number } = await window.electronAPI.db.sessions.create({
        campaign_id: activeCampaign.id,
        played_on: new Date().toISOString().slice(0, 10),
      })
      notifySuccess(`Session ${session_number} started.`)
      await load()
    } catch (err) {
      notifyError(err, 'Start session')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(session) {
    if (!window.confirm(
      `Delete ${sessionLabel(session)}? Its notes are lost.\n\n` +
      `Plot threads and reveals linked to it survive, with the link cleared.`
    )) return
    try {
      await window.electronAPI.db.sessions.delete(session.id)
      notifySuccess(`${sessionLabel(session)} deleted.`)
      setSelectedId(null)
      await load()
    } catch (err) {
      notifyError(err, 'Delete session')
    }
  }

  if (!activeCampaign) return null

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Sessions</h1>
          <p style={s.count}>
            {sessions.length} session{sessions.length !== 1 ? 's' : ''} played
          </p>
        </div>
        <button style={creating ? s.btnDisabled : s.btnPrimary} onClick={handleNewSession} disabled={creating}>
          {creating ? 'Starting…' : '+ New session'}
        </button>
      </div>

      {loading ? (
        <Skeleton count={4} />
      ) : sessions.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No sessions yet.</p>
          <p style={s.emptyHint}>
            Start one at the top of your next game. Notes save themselves as you go.
          </p>
        </div>
      ) : (
        <div style={s.split}>
          <div style={s.list}>
            {sessions.map(session => (
              <button
                key={session.id}
                style={{ ...s.listItem, ...(session.id === selectedId ? s.listItemActive : {}) }}
                onClick={() => setSelectedId(session.id)}
              >
                <div style={s.listNumber}>#{session.session_number}</div>
                <div style={s.listBody}>
                  <div style={s.listTitle}>{session.title || `Session ${session.session_number}`}</div>
                  <div style={s.listMeta}>
                    {formatSessionDate(session.played_on) ?? 'no date'}
                    {session.reveal_count > 0 && ` · ${session.reveal_count} revealed`}
                    {session.opened_count > 0 && ` · ${session.opened_count} opened`}
                    {session.resolved_count > 0 && ` · ${session.resolved_count} resolved`}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {detail && (
            <SessionDetail
              key={detail.id}
              session={detail}
              plots={plots}
              reveals={reveals}
              recapMaterial={recapMaterial}
              campaign={activeCampaign}
              onSaved={load}
              onDelete={() => handleDelete(detail)}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Detail pane ───────────────────────────────────────────────────────────────
function SessionDetail({ session, plots, reveals, recapMaterial, campaign, onSaved, onDelete }) {
  const [title, setTitle] = useState(session.title ?? '')
  const [playedOn, setPlayedOn] = useState(session.played_on ?? '')
  const [notes, setNotes] = useState(session.notes ?? '')
  const [saveState, setSaveState] = useState('idle')   // idle | saving | saved | error

  // ── AI recap (Phase 6 task 8) ────────────────────────────────────────────
  const [recap, setRecap]             = useState(session.recap ?? '')
  const [recapBusy, setRecapBusy]     = useState(false)
  const [recapAudience, setRecapAudience] = useState(null)   // which variant produced it
  const [aiMode, setAiMode]           = useState(null)

  useEffect(() => {
    // getMode resolves to an OBJECT — destructure it.
    window.electronAPI.ai.getMode()
      .then(({ mode }) => setAiMode(mode))
      .catch(() => setAiMode('no-ai'))
  }, [])

  // The last value written, so a blur that changed nothing does not fire a
  // pointless write and flash "Saved" at someone who only clicked away.
  const savedRef = useRef({ title: session.title ?? '', playedOn: session.played_on ?? '', notes: session.notes ?? '' })
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const flashSaved = useCallback(() => {
    setSaveState('saved')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaveState('idle'), 2000)
  }, [])

  const saveNotes = useCallback(async () => {
    if (notes === savedRef.current.notes) return
    setSaveState('saving')
    try {
      await window.electronAPI.db.sessions.updateNotes(session.id, notes)
      savedRef.current.notes = notes
      flashSaved()
    } catch (err) {
      setSaveState('error')
      notifyError(err, 'Save session notes')
    }
  }, [notes, session.id, flashSaved])

  const saveMeta = useCallback(async () => {
    if (title === savedRef.current.title && playedOn === savedRef.current.playedOn) return
    setSaveState('saving')
    try {
      await window.electronAPI.db.sessions.update(session.id, {
        title, played_on: playedOn || null, notes, recap: session.recap ?? null,
      })
      savedRef.current = { ...savedRef.current, title, playedOn }
      flashSaved()
      onSaved?.()
    } catch (err) {
      setSaveState('error')
      notifyError(err, 'Save session')
    }
  }, [title, playedOn, notes, session.id, session.recap, flashSaved, onSaved])

  /**
   * Generate a recap for one audience.
   *
   * The player variant is built by FILTERING THE INPUT rather than asking the
   * model to withhold: unrevealed secrets never reach the request, so there is
   * nothing for it to leak. See src/utils/sessionRecap.js.
   */
  const generateRecap = async (audience) => {
    if (recapBusy || !recapMaterial) return
    setRecapBusy(true)
    try {
      const input = buildRecapInput({
        session: { ...session, notes },
        plots: recapMaterial.allPlots,
        sessionReveals: reveals,
        campaignReveals: recapMaterial.allReveals,
        lore: recapMaterial.lore,
        npcs: recapMaterial.npcs,
      }, { audience })

      if (!hasRecapMaterial(input)) {
        notifyError(
          new Error('This session has no notes, threads or reveals to summarise yet.'),
          'Generate recap')
        return
      }

      const { system, user } = buildRecapPrompt(input, { audience, session, campaign })
      const raw = await window.electronAPI.ai.complete(system, user, {
        maxTokens: 1200, campaignId: campaign?.id ?? null, type: `recap-${audience}`,
      })

      const text = parseRecap(raw)
      if (!text) {
        notifyError(new Error('The AI returned an empty recap.'), 'Generate recap')
        return
      }

      setRecap(text)
      setRecapAudience(audience)
      await window.electronAPI.db.sessions.update(session.id, {
        title, played_on: playedOn || null, notes, recap: text,
      })
      onSaved?.()
    } catch (err) {
      notifyError(err, 'Generate recap')
    } finally {
      setRecapBusy(false)
    }
  }

  const saveRecap = async () => {
    if (recap === (session.recap ?? '')) return
    try {
      await window.electronAPI.db.sessions.update(session.id, {
        title, played_on: playedOn || null, notes, recap,
      })
      flashSaved()
      onSaved?.()
    } catch (err) {
      notifyError(err, 'Save recap')
    }
  }

  return (
    <div style={d.pane}>
      <div style={d.headRow}>
        <input
          style={d.titleInput}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={saveMeta}
          placeholder={`Session ${session.session_number}`}
        />
        <SaveIndicator state={saveState} />
      </div>

      <div style={d.metaRow}>
        <label style={d.label}>
          Played on
          <input
            style={d.dateInput}
            type="date"
            value={playedOn ?? ''}
            onChange={e => setPlayedOn(e.target.value)}
            onBlur={saveMeta}
          />
        </label>
        <span style={d.sessionNo}>Session {session.session_number}</span>
        <button style={d.btnDelete} onClick={onDelete}>Delete session</button>
      </div>

      <label style={d.notesLabel}>Notes</label>
      <textarea
        style={d.notes}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        onBlur={saveNotes}
        placeholder="What happened. Saves automatically when you click away."
        rows={18}
      />

      {/* ── Recap ─────────────────────────────────────────────────────── */}
      <div style={d.recapBlock}>
        <div style={d.recapHead}>
          <label style={d.notesLabel}>Recap</label>
          {aiMode === 'no-ai' ? (
            <span style={d.recapNoAi}>AI not configured — write one yourself, or add a key in Settings.</span>
          ) : (
            <div style={d.recapBtns}>
              <button
                style={recapBusy ? d.btnRecapDisabled : d.btnRecap}
                onClick={() => generateRecap('dm')}
                disabled={recapBusy || !recapMaterial}
              >
                {recapBusy ? 'Writing…' : '✨ Generate recap'}
              </button>
              <button
                style={recapBusy ? d.btnRecapDisabled : d.btnRecapAlt}
                onClick={() => generateRecap('players')}
                disabled={recapBusy || !recapMaterial}
                title="Only what the party has actually been shown"
              >
                👥 Recap for players
              </button>
            </div>
          )}
        </div>

        {recapAudience === 'players' && (
          <p style={d.recapWarn}>
            Written for players: unrevealed secrets, NPC secrets and plot descriptions were
            withheld from the request. Your session notes are free text and were passed
            through, so read it before sharing.
          </p>
        )}

        <textarea
          style={d.recapText}
          value={recap}
          onChange={e => setRecap(e.target.value)}
          onBlur={saveRecap}
          placeholder="A short summary of the session. Generate one, or write your own."
          rows={6}
        />
      </div>

      <div style={d.panels}>
        <section style={d.panel}>
          <h3 style={d.panelTitle}>Plot threads</h3>
          {plots.length === 0 ? (
            <p style={d.panelEmpty}>No threads opened or resolved in this session.</p>
          ) : plots.map(p => (
            <div key={p.id} style={d.plotRow}>
              <span style={{ ...d.plotStatus, ...statusStyle(p.status) }}>{p.status}</span>
              <span style={d.plotTitle}>{p.title}</span>
              <span style={d.plotRole}>
                {p.opened_session_id === session.id && 'opened here'}
                {p.opened_session_id === session.id && p.resolved_session_id === session.id && ' · '}
                {p.resolved_session_id === session.id && 'closed here'}
              </span>
            </div>
          ))}
        </section>

        <section style={d.panel}>
          <h3 style={d.panelTitle}>Revealed this session</h3>
          {reveals.length === 0 ? (
            <p style={d.panelEmpty}>
              Nothing recorded. Use the 👁 button on a lore entry, NPC, location or
              faction to log what the party learned.
            </p>
          ) : reveals.map(r => (
            <div key={r.id} style={d.revealRow}>
              <span style={d.revealType}>{r.entity_type}</span>
              <span style={d.revealId}>#{r.entity_id}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function SaveIndicator({ state }) {
  if (state === 'idle') return <span style={d.saveIdle}>&nbsp;</span>
  if (state === 'saving') return <span style={d.saveSaving}>Saving…</span>
  if (state === 'error') return <span style={d.saveError}>Not saved</span>
  return <span style={d.saveSaved}>✓ Saved</span>
}

const STATUS_STYLES = {
  open:      { color: '#c9a84c', borderColor: '#6b5a3a' },
  active:    { color: '#5aa8bf', borderColor: '#2d5a6b' },
  resolved:  { color: '#5ba85b', borderColor: '#2d5a2d' },
  abandoned: { color: '#6b5a3a', borderColor: '#3a2a10' },
}
const statusStyle = (status) => STATUS_STYLES[status] ?? STATUS_STYLES.open

const s = {
  page:      { padding: '2rem', maxWidth: 1200 },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' },
  title:     { color: '#c9a84c', fontSize: '1.6rem', margin: 0 },
  count:     { color: '#6b5a3a', fontSize: '0.8rem', margin: '0.2rem 0 0' },
  btnPrimary:{ background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnDisabled:{ background: '#3a2a10', color: '#6b5a3a', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'not-allowed', fontWeight: 'bold', fontSize: '0.88rem' },
  empty:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 240, gap: '0.5rem' },
  emptyText: { color: '#6b5a3a', fontSize: '1rem', margin: 0 },
  emptyHint: { color: '#4a3f28', fontSize: '0.82rem', margin: 0 },
  split:     { display: 'grid', gridTemplateColumns: '260px 1fr', gap: '1.25rem', alignItems: 'start' },
  list:      { display: 'flex', flexDirection: 'column', gap: 4 },
  listItem:  { display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', background: '#0d0a05', border: '1px solid #1e1608', borderLeft: '3px solid #1e1608', borderRadius: 4, padding: '0.55rem 0.7rem', cursor: 'pointer', color: 'inherit' },
  listItemActive: { background: '#15100a', borderLeftColor: '#c9a84c' },
  listNumber:{ color: '#6b5a3a', fontSize: '0.75rem', fontWeight: 'bold', minWidth: 22 },
  listBody:  { minWidth: 0 },
  listTitle: { color: '#e8e0d0', fontSize: '0.86rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  listMeta:  { color: '#6b5a3a', fontSize: '0.72rem', marginTop: 2 },
}

const d = {
  pane:       { background: '#0d0a05', border: '1px solid #1e1608', borderRadius: 4, padding: '1rem 1.1rem' },
  headRow:    { display: 'flex', alignItems: 'center', gap: 10 },
  titleInput: { flex: 1, background: 'none', border: 'none', borderBottom: '1px solid #1e1608', color: '#c9a84c', fontSize: '1.25rem', padding: '2px 0', outline: 'none' },
  metaRow:    { display: 'flex', alignItems: 'center', gap: 14, margin: '10px 0 14px', flexWrap: 'wrap' },
  label:      { display: 'flex', alignItems: 'center', gap: 6, color: '#6b5a3a', fontSize: '0.78rem' },
  dateInput:  { background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 3, color: '#e8e0d0', padding: '3px 6px', fontSize: '0.78rem' },
  sessionNo:  { color: '#6b5a3a', fontSize: '0.78rem' },
  btnDelete:  { marginLeft: 'auto', background: 'none', border: '1px solid #5a2020', color: '#c06060', borderRadius: 4, padding: '3px 10px', fontSize: '0.75rem', cursor: 'pointer' },
  recapBlock: { marginTop: '1rem' },
  recapHead:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  recapBtns:  { display: 'flex', gap: 6, marginLeft: 'auto' },
  btnRecap: {
    padding: '3px 10px', background: '#2a2010', border: '1px solid #8a6a2a',
    borderRadius: 4, color: '#c9a84c', fontSize: '0.75rem', cursor: 'pointer',
  },
  btnRecapAlt: {
    padding: '3px 10px', background: '#101c2a', border: '1px solid #2a5a8a',
    borderRadius: 4, color: '#7fb3d5', fontSize: '0.75rem', cursor: 'pointer',
  },
  btnRecapDisabled: {
    padding: '3px 10px', background: '#1a1810', border: '1px solid #2a2418',
    borderRadius: 4, color: '#5a5040', fontSize: '0.75rem', cursor: 'not-allowed',
  },
  recapNoAi:  { color: '#6b5a3a', fontSize: '0.75rem', marginLeft: 'auto' },
  recapWarn:  {
    color: '#7fb3d5', fontSize: '0.72rem', lineHeight: 1.5, margin: '0 0 4px',
    background: '#0d1520', border: '1px solid #1e3a52', borderRadius: 4, padding: '5px 8px',
  },
  recapText: {
    width: '100%', boxSizing: 'border-box', background: '#0a0704',
    border: '1px solid #1e1608', borderRadius: 4, color: '#e8e0d0',
    fontSize: '0.85rem', lineHeight: 1.6, padding: '0.6rem', resize: 'vertical',
    outline: 'none', fontFamily: 'inherit',
  },
  notesLabel: { display: 'block', color: '#a89060', fontSize: '0.78rem', marginBottom: 4 },
  notes:      { width: '100%', boxSizing: 'border-box', background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, color: '#e8e0d0', fontSize: '0.88rem', lineHeight: 1.6, padding: '0.7rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit' },
  panels:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' },
  panel:      { background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, padding: '0.7rem 0.8rem' },
  panelTitle: { color: '#a89060', fontSize: '0.82rem', margin: '0 0 8px' },
  panelEmpty: { color: '#4a3f28', fontSize: '0.76rem', margin: 0, lineHeight: 1.5 },
  plotRow:    { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  plotStatus: { fontSize: '0.66rem', border: '1px solid', borderRadius: 8, padding: '0 6px', textTransform: 'uppercase' },
  plotTitle:  { color: '#e8e0d0', fontSize: '0.8rem' },
  plotRole:   { color: '#4a3f28', fontSize: '0.7rem', marginLeft: 'auto' },
  revealRow:  { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 },
  revealType: { color: '#5ba85b', fontSize: '0.72rem', textTransform: 'uppercase' },
  revealId:   { color: '#4a3f28', fontSize: '0.72rem' },
  saveIdle:   { fontSize: '0.74rem', minWidth: 64 },
  saveSaving: { color: '#6b5a3a', fontSize: '0.74rem', minWidth: 64 },
  saveSaved:  { color: '#5ba85b', fontSize: '0.74rem', minWidth: 64 },
  saveError:  { color: '#e05050', fontSize: '0.74rem', minWidth: 64 },
}
