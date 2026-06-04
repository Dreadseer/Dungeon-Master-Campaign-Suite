import { useState, useEffect, useCallback } from 'react'
import EntityModal from './EntityModal'
import useCampaignStore from '../../stores/campaignStore'

const RACES = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Elf', 'Half-Orc', 'Tiefling', 'Dragonborn', 'Other']
const EMPTY_FORM = { name: '', race: '', class: '', role: '', location_id: null, faction_id: null, is_alive: 1, motivation: '', notes: '', secrets: '' }

export default function NPCModal({ isOpen, npc, onClose, onSaved }) {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)
  const [tab, setTab]             = useState(0)
  const [connections, setConnections] = useState([])
  const [entityMap, setEntityMap]     = useState({})
  const [form, setForm]         = useState(EMPTY_FORM)
  const [locations, setLocations] = useState([])
  const [factions, setFactions]   = useState([])
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  // Load dropdowns and pre-fill form when modal opens
  useEffect(() => {
    if (!isOpen || !activeCampaign?.id) return
    setTab(0)
    setError('')
    setForm(npc ? {
      name:        npc.name        || '',
      race:        npc.race        || '',
      class:       npc.class       || '',
      role:        npc.role        || '',
      location_id: npc.location_id ?? null,
      faction_id:  npc.faction_id  ?? null,
      is_alive:    npc.is_alive    ?? 1,
      motivation:  npc.motivation  || '',
      notes:       npc.notes       || '',
      secrets:     npc.secrets     || '',
    } : EMPTY_FORM)
    Promise.all([
      window.electronAPI.db.locations.getAll(activeCampaign.id),
      window.electronAPI.db.factions.getAll(activeCampaign.id),
    ]).then(([locs, facs]) => { setLocations(locs); setFactions(facs) })
  }, [isOpen, npc?.id]) // eslint-disable-line

  // Load connections for Tab 3 when NPC exists and tab is open
  useEffect(() => {
    if (tab !== 2 || !npc?.id) return
    Promise.all([
      window.electronAPI.db.connections.getForEntity('npc', npc.id),
      window.electronAPI.db.npcs.getAll(activeCampaign.id),
      window.electronAPI.db.locations.getAll(activeCampaign.id),
      window.electronAPI.db.factions.getAll(activeCampaign.id),
    ]).then(([conns, npcs, locs, facs]) => {
      setConnections(conns)
      const map = {}
      npcs.forEach(e  => { map[`npc:${e.id}`]      = e.name })
      locs.forEach(e  => { map[`location:${e.id}`] = e.name })
      facs.forEach(e  => { map[`faction:${e.id}`]  = e.name })
      setEntityMap(map)
    })
  }, [tab, npc?.id]) // eslint-disable-line

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('NPC name is required.'); setTab(0); return }
    setSaving(true)
    const payload = { ...form, campaign_id: activeCampaign.id,
      location_id: form.location_id || null,
      faction_id:  form.faction_id  || null,
    }
    if (npc) {
      await window.electronAPI.db.npcs.update(npc.id, payload)
    } else {
      await window.electronAPI.db.npcs.create(payload)
    }
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <EntityModal
      title={npc ? `Edit: ${npc.name}` : 'New NPC'}
      isOpen={isOpen}
      onClose={onClose}
    >
      {/* Tab bar */}
      <div style={s.tabs}>
        {['Identity', 'Details', ...(npc ? ['Connections'] : [])].map((label, i) => (
          <button key={i} style={{ ...s.tab, ...(tab === i ? s.tabActive : {}) }}
            type="button" onClick={() => setTab(i)}>
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Tab 0 — Identity */}
        {tab === 0 && (
          <div>
            <label style={s.label}>Name *</label>
            <input style={s.input} value={form.name} onChange={e => setField('name', e.target.value)}
              placeholder="Mira Ashveil" autoFocus />
            {error && <p style={s.err}>{error}</p>}

            <label style={s.label}>Race</label>
            <input style={s.input} list="race-list" value={form.race}
              onChange={e => setField('race', e.target.value)} placeholder="Human" />
            <datalist id="race-list">{RACES.map(r => <option key={r} value={r} />)}</datalist>

            <label style={s.label}>Class / Role</label>
            <input style={s.input} value={form.class || form.role}
              onChange={e => { setField('class', e.target.value); setField('role', e.target.value) }}
              placeholder="Innkeeper, Spy, Noble, Fighter…" />

            <label style={s.label}>Currently located in…</label>
            <select style={s.input} value={form.location_id ?? ''}
              onChange={e => setField('location_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unknown location</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>

            <label style={s.label}>Faction affiliation</label>
            <select style={s.input} value={form.faction_id ?? ''}
              onChange={e => setField('faction_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">No faction affiliation</option>
              {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>

            <label style={s.label}>Status</label>
            <div style={s.radioRow}>
              {[{ val: 1, label: '🟢 Alive' }, { val: 0, label: '💀 Dead' }].map(opt => (
                <label key={opt.val} style={s.radioLabel}>
                  <input type="radio" name="is_alive" value={opt.val}
                    checked={form.is_alive === opt.val}
                    onChange={() => setField('is_alive', opt.val)} />
                  {' '}{opt.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Tab 1 — Details */}
        {tab === 1 && (
          <div>
            <label style={s.label}>What does this NPC want?</label>
            <textarea style={{ ...s.input, height: 72, resize: 'vertical' }}
              value={form.motivation} onChange={e => setField('motivation', e.target.value)}
              placeholder="Their core drive, goal, or need…" />

            <label style={s.label}>DM Notes</label>
            <textarea style={{ ...s.input, height: 100, resize: 'vertical' }}
              value={form.notes} onChange={e => setField('notes', e.target.value)}
              placeholder="Personality, appearance, voice, history…" />

            <label style={s.label}>Secrets (DM Only)</label>
            <textarea style={{ ...s.input, ...s.secretsInput, height: 72, resize: 'vertical' }}
              value={form.secrets} onChange={e => setField('secrets', e.target.value)}
              placeholder="What they're hiding from the party…" />
          </div>
        )}

        {/* Tab 2 — Connections (edit mode only) */}
        {tab === 2 && npc && (
          <div style={connS.panel}>
            {connections.length === 0 ? (
              <p style={connS.empty}>No connections for this NPC yet.</p>
            ) : (
              <div style={connS.list}>
                {connections.map(conn => {
                  const isA  = conn.entity_a_type === 'npc' && conn.entity_a_id === npc.id
                  const otherType = isA ? conn.entity_b_type : conn.entity_a_type
                  const otherId   = isA ? conn.entity_b_id   : conn.entity_a_id
                  const otherName = entityMap[`${otherType}:${otherId}`] || `Unknown ${otherType}`
                  return (
                    <div key={conn.id} style={connS.row}>
                      <span style={connS.rel}>{conn.relationship}</span>
                      {' with '}
                      <span style={connS.name}>{otherName}</span>
                      <span style={connS.type}>{otherType}</span>
                      {conn.notes && <p style={connS.notes}>{conn.notes}</p>}
                    </div>
                  )
                })}
              </div>
            )}
            <button style={s.btnSecondary} type="button"
              onClick={() => { onClose(); window.location.href = `/world/connections` }}>
              + Manage Connections
            </button>
          </div>
        )}

        <div style={s.footer}>
          <div style={s.tabNav}>
            {tab === 0 && <button style={s.btnSecondary} type="button" onClick={() => setTab(1)}>Details →</button>}
            {tab === 1 && (
              <>
                <button style={s.btnSecondary} type="button" onClick={() => setTab(0)}>← Identity</button>
                {npc && <button style={{ ...s.btnSecondary, marginLeft: '0.4rem' }} type="button" onClick={() => setTab(2)}>Connections →</button>}
              </>
            )}
            {tab === 2 && <button style={s.btnSecondary} type="button" onClick={() => setTab(1)}>← Details</button>}
          </div>
          <div style={s.actions}>
            {tab !== 2 && (
              <button style={s.btnPrimary} type="submit" disabled={saving}>
                {saving ? 'Saving…' : npc ? 'Save Changes' : 'Create NPC'}
              </button>
            )}
            <button style={s.btnSecondary} type="button" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </form>
    </EntityModal>
  )
}

const connS = {
  panel: { padding: '0.5rem 0 1rem' },
  empty: { color: '#6b5a3a', fontSize: '0.9rem', marginBottom: '1rem' },
  list:  { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' },
  row:   { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 4, padding: '0.6rem 0.8rem', fontSize: '0.85rem', color: '#e8e0d0' },
  rel:   { color: '#c9a84c', fontStyle: 'italic' },
  name:  { fontWeight: 500, marginLeft: '0.25rem' },
  type:  { color: '#6b5a3a', fontSize: '0.75rem', marginLeft: '0.4rem' },
  notes: { color: '#6b5a3a', fontSize: '0.78rem', margin: '0.3rem 0 0', fontStyle: 'italic' },
}

const s = {
  tabs:        { display: 'flex', gap: '0.25rem', marginBottom: '1.25rem' },
  tab:         { background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', padding: '0.35rem 1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' },
  tabActive:   { background: '#2d1f0a', border: '1px solid #c9a84c', color: '#c9a84c' },
  label:       { display: 'block', color: '#a89060', fontSize: '0.82rem', marginBottom: '0.35rem' },
  input:       { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.9rem', marginBottom: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  secretsInput:{ border: '1px solid #6a2020', background: '#120808' },
  radioRow:    { display: 'flex', gap: '1.5rem', marginBottom: '0.9rem' },
  radioLabel:  { color: '#e8e0d0', fontSize: '0.9rem', cursor: 'pointer' },
  footer:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #2a1c08' },
  tabNav:      { display: 'flex' },
  actions:     { display: 'flex', gap: '0.6rem' },
  err:         { color: '#e05050', fontSize: '0.82rem', marginTop: '-0.6rem', marginBottom: '0.75rem' },
  btnPrimary:  { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },
}
