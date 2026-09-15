import { useState, useEffect, useCallback, useMemo } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import EntityModal from '../../components/world/EntityModal'
import Skeleton from '../../components/ui/Skeleton'
import useAiMode from '../../hooks/useAiMode'
import { notifyError, notifySuccess } from '../../stores/toastStore'
import { parseIpcError } from '../../utils/ipcError'
import {
  TABLE_DICE, DEFAULT_DIE, dieFaces, parseEntries, rollTable,
  validateTable, rangeLabel, describeTable, evenRanges,
} from '../../utils/tableUtils'

// Random encounter tables (Phase 7 task 4).
//
// Rolling is client-side: it needs no database round trip, and the resolution
// logic is pure and tested in src/utils/tableUtils.js. The page's job is to let
// a DM build a table that actually covers its die, and to say plainly when one
// does not — a d20 table whose entries stop at 12 is the failure that only
// shows up as a blank result mid-session.

const EMPTY_FORM = { name: '', location_id: '', die: DEFAULT_DIE, entries: [] }

export default function RandomTables() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)
  const { noAi } = useAiMode()

  const [tables, setTables]       = useState([])
  const [locations, setLocations] = useState([])
  const [encounters, setEncounters] = useState([])
  const [loading, setLoading]     = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [result, setResult]       = useState(null)   // { tableId, roll, entry, die }
  const [populating, setPopulating] = useState(false)

  const load = useCallback(async () => {
    if (!activeCampaign?.id) return
    setLoading(true)
    try {
      const [t, l, e] = await Promise.all([
        window.electronAPI.db.encounterTables.getAll(activeCampaign.id),
        window.electronAPI.db.locations.getAll(activeCampaign.id),
        window.electronAPI.db.encounters.getAll(activeCampaign.id),
      ])
      setTables(t)
      setLocations(l)
      setEncounters(e)
    } catch (err) {
      notifyError(err, 'Load encounter tables')
    } finally {
      setLoading(false)
    }
  }, [activeCampaign?.id])

  useEffect(() => { load() }, [load])

  const encounterById = useMemo(
    () => new Map(encounters.map(e => [e.id, e])), [encounters])

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, entries: [] })
    setError('')
    setModalOpen(true)
  }

  function openEdit(table) {
    setEditing(table)
    setForm({
      name: table.name ?? '',
      location_id: table.location_id ?? '',
      die: table.die ?? DEFAULT_DIE,
      entries: parseEntries(table.entries),
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('A table needs a name.'); return }
    setSaving(true)
    const payload = {
      campaign_id: activeCampaign.id,
      name: form.name.trim(),
      location_id: form.location_id || null,
      die: form.die,
      entries: form.entries,
    }
    try {
      if (editing) await window.electronAPI.db.encounterTables.update(editing.id, payload)
      else         await window.electronAPI.db.encounterTables.create(payload)
      notifySuccess(editing ? 'Table saved.' : 'Table created.')
      setModalOpen(false)
      await load()
    } catch (err) {
      notifyError(err, editing ? 'Save table' : 'Create table')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(table) {
    if (!window.confirm(`Delete "${table.name}"? This cannot be undone.`)) return
    try {
      await window.electronAPI.db.encounterTables.delete(table.id)
      notifySuccess('Table deleted.')
      if (result?.tableId === table.id) setResult(null)
      await load()
    } catch (err) {
      notifyError(err, 'Delete table')
    }
  }

  /** Roll, and remember it so the result stays on screen to act on. */
  function handleRoll(table) {
    const out = rollTable(table)
    setResult({ tableId: table.id, ...out })
  }

  /** Open the encounter a rolled entry points at. */
  function openEncounter(encounterId) {
    // HashRouter: the Encounter Builder reads the id off the hash and opens it.
    window.location.hash = `#/encounters?open=${encounterId}`
  }

  // ── Entry editing ────────────────────────────────────────────────────────
  const setEntry = (i, patch) => setForm(f => ({
    ...f, entries: f.entries.map((e, idx) => idx === i ? { ...e, ...patch } : e),
  }))

  const addEntry = () => setForm(f => {
    const faces = dieFaces(f.die)
    const used = f.entries.reduce((max, e) => Math.max(max, e.roll_max), 0)
    const next = Math.min(faces, used + 1)
    return { ...f, entries: [...f.entries, { roll_min: next, roll_max: next, label: '', encounter_id: null }] }
  })

  const removeEntry = (i) => setForm(f => ({ ...f, entries: f.entries.filter((_, idx) => idx !== i) }))

  /** Re-space the existing entries evenly across the die. */
  const spreadEntries = () => setForm(f => {
    const ranges = evenRanges(dieFaces(f.die), f.entries.length)
    return { ...f, entries: f.entries.map((e, i) => ({ ...e, ...ranges[i] })) }
  })

  /**
   * Populate a table from the location's description (task 4, optional AI).
   *
   * Hidden entirely in no-ai mode rather than offered and then failing.
   */
  async function handlePopulate() {
    const location = locations.find(l => l.id === Number(form.location_id))
    if (!location) { setError('Pick a location first — the AI writes from its description.'); return }

    setPopulating(true)
    setError('')
    try {
      const faces = dieFaces(form.die)
      const count = Math.min(8, Math.max(4, Math.round(faces / 3)))
      const system = [
        'You write random encounter tables for a D&D 5e campaign.',
        'Return ONLY valid JSON — no markdown fences, no explanations.',
        `Schema: { "entries": [ { "label": string } ] } with exactly ${count} entries.`,
        'Each label is one short sentence describing what the party runs into. Order them from most mundane to most dangerous.',
        'Do not include dice numbers or ranges — the app assigns those.',
      ].join('\n')
      const user = [
        `Location: ${location.name}${location.type ? ` (${location.type})` : ''}`,
        location.description ? `Description: ${location.description}` : '',
        location.lore ? `Lore: ${location.lore}` : '',
        '',
        `Write ${count} encounters that fit this place.`,
      ].filter(Boolean).join('\n')

      const raw = await window.electronAPI.ai.complete(system, user, {
        maxTokens: 900, campaignId: activeCampaign.id, type: 'encounter-table',
      })

      const { extractJsonValue } = await import('../../utils/compendiumExtractor.js')
      const data = extractJsonValue(raw, { allowArray: false })
      const labels = (Array.isArray(data?.entries) ? data.entries : [])
        .map(e => String(e?.label ?? e ?? '').trim())
        .filter(Boolean)

      if (labels.length === 0) {
        setError('The AI did not return anything usable. Try again.')
        return
      }

      // The app assigns the ranges, so the table always covers its die — which
      // is exactly what a model asked to invent ranges gets wrong.
      const ranges = evenRanges(faces, labels.length)
      setForm(f => ({
        ...f,
        entries: labels.map((label, i) => ({ ...ranges[i], label, encounter_id: null })),
      }))
      notifySuccess(`${labels.length} entries written from ${location.name}.`)
    } catch (err) {
      setError(parseIpcError(err).message)
      notifyError(err, 'Populate table')
    } finally {
      setPopulating(false)
    }
  }

  if (!activeCampaign) return null

  const formValidation = validateTable(form)

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Random Tables</h1>
          <p style={s.count}>
            {tables.length} table{tables.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button style={s.btnPrimary} onClick={openCreate}>+ New table</button>
      </div>

      {loading ? <Skeleton count={3} /> : tables.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>No tables yet.</p>
          <p style={s.emptyHint}>
            Build one per region or dungeon, then roll it when the party wanders.
            Entries can link to an encounter you have already built.
          </p>
        </div>
      ) : (
        <div style={s.list}>
          {tables.map(table => {
            const check = validateTable(table)
            const rolled = result?.tableId === table.id ? result : null
            return (
              <div key={table.id} style={s.card}>
                <div style={s.cardHead}>
                  <span style={s.cardName}>{table.name}</span>
                  <span style={s.cardDie}>{table.die}</span>
                  {table.location_name && <span style={s.cardLoc}>📍 {table.location_name}</span>}
                  <span style={{ ...s.cardState, color: check.ok ? '#5ba85b' : '#c9a84c' }}>
                    {describeTable(table)}
                  </span>
                </div>

                {rolled && (
                  <div style={s.rollResult}>
                    <span style={s.rollNumber}>{rolled.roll}</span>
                    {rolled.entry ? (
                      <>
                        <span style={s.rollLabel}>
                          {rolled.entry.label || '(no label)'}
                        </span>
                        {rolled.entry.encounter_id != null && (
                          encounterById.has(rolled.entry.encounter_id) ? (
                            <button
                              style={s.btnOpen}
                              onClick={() => openEncounter(rolled.entry.encounter_id)}
                            >
                              Open {encounterById.get(rolled.entry.encounter_id).name} →
                            </button>
                          ) : (
                            <span style={s.rollMissing}>linked encounter was deleted</span>
                          )
                        )}
                      </>
                    ) : (
                      <span style={s.rollMissing}>
                        nothing covers {rolled.roll} on this table
                      </span>
                    )}
                  </div>
                )}

                <div style={s.cardActions}>
                  <button style={s.btnRoll} onClick={() => handleRoll(table)}>
                    🎲 Roll {table.die}
                  </button>
                  <button style={s.btnSecondary} onClick={() => openEdit(table)}>Edit</button>
                  <button style={s.btnDanger} onClick={() => handleDelete(table)}>Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <EntityModal
        title={editing ? `Edit: ${editing.name}` : 'New random table'}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Name</label>
          <input
            style={s.input}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Wandering the Mere"
            autoFocus
          />

          <div style={s.row2}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Location</label>
              <select
                style={s.input}
                value={form.location_id ?? ''}
                onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}
              >
                <option value="">— not tied to a location —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div style={{ width: 110 }}>
              <label style={s.label}>Die</label>
              <select
                style={s.input}
                value={form.die}
                onChange={e => setForm(f => ({ ...f, die: e.target.value }))}
              >
                {Object.keys(TABLE_DICE).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div style={s.entriesHead}>
            <label style={s.label}>Entries</label>
            <span style={{ ...s.validation, color: formValidation.ok ? '#5ba85b' : '#c9a84c' }}>
              {describeTable(form)}
            </span>
          </div>

          {form.entries.map((entry, i) => (
            <div key={i} style={s.entryRow}>
              <input
                style={s.rollInput} type="number" min={1} max={formValidation.faces}
                value={entry.roll_min}
                onChange={e => setEntry(i, { roll_min: Number(e.target.value) })}
                aria-label="From"
              />
              <span style={s.dash}>–</span>
              <input
                style={s.rollInput} type="number" min={1} max={formValidation.faces}
                value={entry.roll_max}
                onChange={e => setEntry(i, { roll_max: Number(e.target.value) })}
                aria-label="To"
              />
              <input
                style={s.entryLabel}
                value={entry.label}
                onChange={e => setEntry(i, { label: e.target.value })}
                placeholder="What they run into"
              />
              <select
                style={s.entryLink}
                value={entry.encounter_id ?? ''}
                onChange={e => setEntry(i, { encounter_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— free text —</option>
                {encounters.map(enc => <option key={enc.id} value={enc.id}>{enc.name}</option>)}
              </select>
              <button type="button" style={s.btnRemove} onClick={() => removeEntry(i)}>✕</button>
            </div>
          ))}

          <div style={s.row}>
            <button type="button" style={s.btnSecondary} onClick={addEntry}>+ Add entry</button>
            {form.entries.length > 0 && (
              <button type="button" style={s.btnSecondary} onClick={spreadEntries}>
                Spread evenly across {form.die}
              </button>
            )}
            {/* Hidden entirely without AI, rather than offered and then failing. */}
            {!noAi && (
              <button
                type="button"
                style={populating ? s.btnDisabled : s.btnSecondary}
                onClick={handlePopulate}
                disabled={populating}
                title="Write entries from the location's description"
              >
                {populating ? 'Writing…' : '✨ Populate from location'}
              </button>
            )}
          </div>

          {!formValidation.ok && form.entries.length > 0 && (
            <div style={s.warnBox}>
              {formValidation.gaps.length > 0 && (
                <p style={s.warnLine}>
                  Nothing covers {formValidation.gaps.map(rangeLabel).join(', ')} — a roll there
                  comes back empty.
                </p>
              )}
              {formValidation.overlaps.length > 0 && (
                <p style={s.warnLine}>
                  {formValidation.overlaps.length} result{formValidation.overlaps.length === 1 ? '' : 's'} covered
                  twice; the earliest entry wins.
                </p>
              )}
              {formValidation.outOfRange.length > 0 && (
                <p style={s.warnLine}>
                  {formValidation.outOfRange.map(o => `"${o.label || 'unnamed'}" is ${o.reason}`).join('; ')}.
                </p>
              )}
            </div>
          )}

          {error && <p style={s.err}>{error}</p>}

          <div style={s.row}>
            <button type="submit" style={s.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Create table'}
            </button>
            <button type="button" style={s.btnSecondary} onClick={() => setModalOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </EntityModal>
    </div>
  )
}

const s = {
  page:   { padding: '2rem', maxWidth: 1100, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' },
  title:  { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.8rem', margin: 0 },
  count:  { color: '#7a6035', fontSize: '0.85rem', margin: '0.25rem 0 0' },

  empty:     { textAlign: 'center', padding: '3rem 1rem', border: '1px dashed #3a2a10', borderRadius: 6 },
  emptyText: { color: '#a89060', fontSize: '1rem', margin: '0 0 0.5rem' },
  emptyHint: { color: '#6b5a3a', fontSize: '0.85rem', margin: 0, lineHeight: 1.6 },

  list: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  card: { background: '#14100a', border: '1px solid #2a2010', borderRadius: 6, padding: '0.9rem 1rem' },
  cardHead: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' },
  cardName: { color: '#e8e0d0', fontSize: '1rem', fontWeight: 'bold' },
  cardDie:  { color: '#7fb3d5', fontSize: '0.75rem', border: '1px solid #2a5a8a', borderRadius: 10, padding: '1px 8px' },
  cardLoc:  { color: '#7a6035', fontSize: '0.78rem' },
  cardState:{ fontSize: '0.75rem', marginLeft: 'auto' },

  rollResult: {
    display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap',
    background: '#1a1408', border: '1px solid #3a2a10', borderRadius: 4,
    padding: '0.6rem 0.8rem', marginBottom: '0.6rem',
  },
  rollNumber: { color: '#c9a84c', fontSize: '1.5rem', fontWeight: 'bold', minWidth: 34, textAlign: 'center' },
  rollLabel:  { color: '#e8e0d0', fontSize: '0.9rem', flex: 1 },
  rollMissing:{ color: '#c08050', fontSize: '0.82rem', fontStyle: 'italic' },

  cardActions: { display: 'flex', gap: '0.5rem' },
  btnRoll:   { background: '#2a2010', color: '#c9a84c', border: '1px solid #8a6a2a', padding: '0.4rem 1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' },
  btnOpen:   { background: '#10263a', color: '#7fb3d5', border: '1px solid #2a5a8a', padding: '0.3rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnPrimary:{ background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.1rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.4rem 0.9rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnDisabled:{ background: '#1a1810', color: '#5a5040', border: '1px solid #2a2418', padding: '0.4rem 0.9rem', borderRadius: 4, cursor: 'not-allowed', fontSize: '0.8rem' },
  btnDanger: { background: 'transparent', color: '#a05050', border: '1px solid #5a2020', padding: '0.4rem 0.9rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnRemove: { background: 'transparent', color: '#7a6035', border: 'none', cursor: 'pointer', fontSize: '0.9rem', padding: '0 0.3rem' },

  label:  { display: 'block', color: '#a89060', fontSize: '0.78rem', marginBottom: 4, marginTop: '0.7rem' },
  input:  { width: '100%', boxSizing: 'border-box', background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, color: '#e8e0d0', fontSize: '0.88rem', padding: '0.5rem', outline: 'none' },
  row:    { display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' },
  row2:   { display: 'flex', gap: '0.7rem' },

  entriesHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' },
  validation:  { fontSize: '0.75rem' },
  entryRow: { display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.35rem' },
  rollInput: { width: 54, background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, color: '#e8e0d0', fontSize: '0.82rem', padding: '0.35rem', textAlign: 'center' },
  dash:      { color: '#5a5040', fontSize: '0.8rem' },
  entryLabel:{ flex: 1, background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, color: '#e8e0d0', fontSize: '0.82rem', padding: '0.35rem 0.5rem' },
  entryLink: { width: 150, background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, color: '#a89060', fontSize: '0.78rem', padding: '0.35rem' },

  warnBox:  { background: '#1a1408', border: '1px solid #5a4010', borderRadius: 4, padding: '0.5rem 0.7rem', marginTop: '0.7rem' },
  warnLine: { color: '#c9a84c', fontSize: '0.78rem', margin: '0 0 0.25rem', lineHeight: 1.5 },
  err:      { color: '#e08080', fontSize: '0.82rem', marginTop: '0.7rem' },
}
