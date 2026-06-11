import { useState, useEffect, useCallback } from 'react'
import useCampaignStore    from '../stores/campaignStore'
import MonsterRoster       from '../components/encounter/MonsterRoster'
import MonsterSearchPanel  from '../components/encounter/MonsterSearchPanel'
import XPCalculator        from '../components/encounter/XPCalculator'
import InitiativeTracker   from '../components/encounter/InitiativeTracker'
import { partyThresholds, difficultyRating, adjustedXP } from '../utils/encounterUtils'

const STATUS_TABS  = ['All', 'Planned', 'Active', 'Completed']

const STATUS_COLORS = {
  planned:   { bg: '#2a2a2a', color: '#888',    label: 'Planned'   },
  active:    { bg: '#1a3a1a', color: '#5dc45d', label: 'Active'    },
  completed: { bg: '#2a2a1a', color: '#c9a84c', label: 'Completed' },
}

// Sort order: Active → Planned → Completed
const STATUS_ORDER = { active: 0, planned: 1, completed: 2 }

export default function EncounterBuilder() {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)

  // ── List view state ──────────────────────────────────────────────────────
  const [encounters, setEncounters]   = useState([])
  const [statusTab, setStatusTab]     = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [loadError, setLoadError]     = useState('')
  const [showCreate, setShowCreate]   = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)   // encounter id

  // ── Create-modal state ───────────────────────────────────────────────────
  const [locations, setLocations]     = useState([])
  const [form, setForm]               = useState({ name: '', location_id: '', notes: '' })
  const [formErr, setFormErr]         = useState('')
  const [creating, setCreating]       = useState(false)

  // ── Editor view state ────────────────────────────────────────────────────
  const [activeEncounter, setActiveEncounter] = useState(null)
  const [monsters, setMonsters]               = useState([])
  const [recentlyUsed, setRecentlyUsed]       = useState([])
  const [currentDifficulty, setCurrentDifficulty] = useState('')
  const [campaignChars, setCampaignChars]     = useState([])
  const [campaignMaps, setCampaignMaps]       = useState([])

  // ── Load encounters list ──────────────────────────────────────────────────
  const loadEncounters = useCallback(async () => {
    if (!activeCampaign) return
    try {
      const list = await window.electronAPI.db.encounters.getAll(activeCampaign.id)
      setEncounters(list)
    } catch (err) {
      setLoadError(err?.message ?? 'Failed to load encounters')
    }
  }, [activeCampaign])

  useEffect(() => { loadEncounters() }, [loadEncounters])

  // Load campaign characters on mount (needed for difficulty badges + tracker)
  useEffect(() => {
    if (!activeCampaign) return
    window.electronAPI.db.characters.getAll(activeCampaign.id)
      .then(setCampaignChars).catch(() => {})
  }, [activeCampaign])

  // Load locations for the create modal
  useEffect(() => {
    if (!activeCampaign || !showCreate) return
    window.electronAPI.db.locations.getAll(activeCampaign.id)
      .then(setLocations).catch(() => {})
  }, [activeCampaign, showCreate])

  // Load maps for the encounter editor (map picker)
  useEffect(() => {
    if (!activeCampaign || !activeEncounter) return
    window.electronAPI.db.maps.getAll(activeCampaign.id)
      .then(setCampaignMaps).catch(() => {})
  }, [activeCampaign, activeEncounter?.id])

  // Load recently used monsters across encounters in this campaign
  const loadRecentlyUsed = useCallback(async () => {
    if (!activeCampaign) return
    try {
      const list = await window.electronAPI.db.encounters.getAll(activeCampaign.id)
      const seen = new Set()
      const recent = []
      for (const enc of list) {
        let ms = []
        try { ms = JSON.parse(enc.monsters ?? '[]') } catch { /* empty */ }
        for (const m of ms) {
          if (!seen.has(m.source_index)) {
            seen.add(m.source_index)
            recent.push(m)
          }
          if (recent.length >= 5) break
        }
        if (recent.length >= 5) break
      }
      setRecentlyUsed(recent)
    } catch { /* non-critical */ }
  }, [activeCampaign])

  // ── Create encounter ──────────────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setFormErr('Encounter name is required.'); return }
    setCreating(true)
    setFormErr('')
    try {
      await window.electronAPI.db.encounters.create({
        campaign_id: activeCampaign.id,
        name:        form.name.trim(),
        location_id: form.location_id ? parseInt(form.location_id, 10) : null,
        notes:       form.notes,
        monsters:    [],
        xp_total:    0,
      })
      setForm({ name: '', location_id: '', notes: '' })
      setShowCreate(false)
      await loadEncounters()
    } catch (err) {
      setFormErr(err?.message ?? 'Failed to create encounter')
    } finally {
      setCreating(false)
    }
  }

  // ── Open encounter in editor ──────────────────────────────────────────────
  const openEncounter = async (enc) => {
    const full = await window.electronAPI.db.encounters.getById(enc.id)
    let ms = []
    try { ms = JSON.parse(full.monsters ?? '[]') } catch { /* empty */ }
    setActiveEncounter(full)
    setMonsters(ms)
    await loadRecentlyUsed()
  }

  // ── Delete encounter ──────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    try {
      await window.electronAPI.db.encounters.delete(id)
      setDeleteConfirm(null)
      if (activeEncounter?.id === id) setActiveEncounter(null)
      await loadEncounters()
    } catch (err) {
      setLoadError(err?.message ?? 'Delete failed')
    }
  }

  // ── Duplicate encounter ───────────────────────────────────────────────────
  const handleDuplicate = async (enc) => {
    let ms = []
    try { ms = JSON.parse(enc.monsters ?? '[]') } catch { /* empty */ }
    try {
      await window.electronAPI.db.encounters.create({
        campaign_id: activeCampaign.id,
        name:        enc.name + ' (Copy)',
        location_id: enc.location_id ?? null,
        notes:       enc.notes ?? '',
        monsters:    ms,
        xp_total:    enc.xp_total ?? 0,
      })
      await loadEncounters()
    } catch (err) {
      setLoadError(err?.message ?? 'Duplicate failed')
    }
  }

  // ── Monster roster callbacks ──────────────────────────────────────────────
  const handleRosterChange = (newMonsters) => {
    setMonsters(newMonsters)
    setActiveEncounter(prev => prev ? { ...prev, monsters: JSON.stringify(newMonsters) } : prev)
  }

  const handleAddMonster = (entry) => {
    setMonsters(prev => {
      const next = [...prev, entry]
      handleRosterChange(next)
      return next
    })
  }

  // ── Combat lifecycle ─────────────────────────────────────────────────────
  const handleStartCombat = async () => {
    if (!activeCampaign || !activeEncounter) return
    try {
      await window.electronAPI.db.encounters.updateStatus(activeEncounter.id, 'active')
      setActiveEncounter(prev => ({ ...prev, status: 'active' }))
      // Open the linked map in a secondary window if one is set
      if (activeEncounter.map_id) {
        window.electronAPI.encounter.openMapWindow(activeCampaign.id, activeEncounter.map_id)
          .catch(err => console.error('Map window failed:', err))
      }
    } catch (err) {
      console.error('Failed to start combat:', err)
    }
  }

  // ── Encounter map picker ──────────────────────────────────────────────────
  const handleMapChange = async (mapId) => {
    const id = mapId ? parseInt(mapId, 10) : null
    await window.electronAPI.db.encounters.setMapId(activeEncounter.id, id).catch(() => {})
    setActiveEncounter(prev => ({ ...prev, map_id: id }))
  }

  const handleEndCombat = async () => {
    if (!activeEncounter) return
    try {
      await window.electronAPI.db.encounters.updateStatus(activeEncounter.id, 'completed')
      // Re-fetch to get updated encounter (notes may have been saved during combat)
      const updated = await window.electronAPI.db.encounters.getById(activeEncounter.id)
      setActiveEncounter(updated)
      // Reload characters to get the HP values synced back by InitiativeTracker
      const chars = await window.electronAPI.db.characters.getAll(activeCampaign.id)
      setCampaignChars(chars)
    } catch { /* non-critical */ }
    await loadEncounters()
  }

  // ── Reuse completed encounter as new planned ──────────────────────────────
  const handleReuseAsNew = async () => {
    if (!activeEncounter) return
    let ms = []
    try { ms = JSON.parse(activeEncounter.monsters ?? '[]') } catch { /* empty */ }
    try {
      await window.electronAPI.db.encounters.create({
        campaign_id: activeCampaign.id,
        name:        activeEncounter.name + ' (Reuse)',
        location_id: activeEncounter.location_id ?? null,
        notes:       '',
        monsters:    ms,
        xp_total:    activeEncounter.xp_total ?? 0,
      })
      await loadEncounters()
      setActiveEncounter(null)
    } catch (err) {
      setLoadError(err?.message ?? 'Reuse failed')
    }
  }

  // ── Filtered + sorted encounter list ──────────────────────────────────────
  const filtered = encounters
    .filter(e => statusTab === 'All' || e.status === statusTab.toLowerCase())
    .filter(e => !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3))

  // ── Guard: no active campaign ─────────────────────────────────────────────
  if (!activeCampaign) {
    return (
      <div style={s.centerMsg}>
        <p style={s.msgText}>Select a campaign to use the Encounter Builder.</p>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  // VIEW B — Encounter Editor
  // ════════════════════════════════════════════════════════════════════════════
  if (activeEncounter) {
    const sc     = STATUS_COLORS[activeEncounter.status] ?? STATUS_COLORS.planned
    const status = activeEncounter.status

    // Shared editor header
    const editorHeader = (
      <div style={s.editorHeader}>
        <button style={s.backBtn} onClick={() => { setActiveEncounter(null); loadEncounters() }}>
          ← Encounters
        </button>
        <h2 style={s.editorTitle}>{activeEncounter.name}</h2>
        <span style={{ ...s.statusBadge, background: sc.bg, color: sc.color }}>
          {sc.label}
        </span>
        {activeEncounter.location_name && (
          <span style={s.locationBadge}>📍 {activeEncounter.location_name}</span>
        )}
      </div>
    )

    // ── VIEW B-1: PLANNED — roster editor + Start Combat ─────────────────
    if (status === 'planned') {
      return (
        <div style={s.page}>
          {editorHeader}
          <div style={s.editorBody}>
            <div style={s.rosterCol}>
              <div style={currentDifficulty === 'Deadly' ? s.deadlyBorder : {}}>
                <MonsterRoster
                  encounterId={activeEncounter.id}
                  monsters={monsters}
                  onChange={handleRosterChange}
                />
              </div>
              <XPCalculator
                encounter={activeEncounter}
                monsters={monsters}
                onDifficultyChange={setCurrentDifficulty}
              />
              {/* Map picker — optional linked map opened when combat starts */}
              {campaignMaps.length > 0 && (
                <div style={s.mapPickerRow}>
                  <span style={s.mapPickerLabel}>🗺 Combat Map</span>
                  <select
                    style={s.mapPickerSelect}
                    value={activeEncounter.map_id ?? ''}
                    onChange={e => handleMapChange(e.target.value || null)}
                  >
                    <option value="">None — don't open map</option>
                    {campaignMaps.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  {activeEncounter.map_id && (
                    <span style={s.mapPickerHint}>Opens in new window on combat start</span>
                  )}
                </div>
              )}

              <div style={s.startCombatRow}>
                <button style={s.startCombatBtn} onClick={handleStartCombat} disabled={monsters.length === 0}>
                  ⚔ Start Combat
                </button>
                {monsters.length === 0 && (
                  <span style={s.startCombatHint}>Add monsters to the roster to start combat</span>
                )}
              </div>
            </div>
            <div style={s.searchCol}>
              <MonsterSearchPanel
                rosterMonsters={monsters}
                onAdd={handleAddMonster}
                recentlyUsed={recentlyUsed}
              />
            </div>
          </div>
        </div>
      )
    }

    // ── VIEW B-2: ACTIVE — Initiative Tracker ─────────────────────────────
    if (status === 'active') {
      return (
        <div style={s.page}>
          {editorHeader}
          <div style={{ flex: 1, minHeight: 0 }}>
            <InitiativeTracker
              encounter={activeEncounter}
              characters={campaignChars}
              campaignId={activeCampaign.id}
              onEndCombat={handleEndCombat}
            />
          </div>
        </div>
      )
    }

    // ── VIEW B-3: COMPLETED — Read-only history ───────────────────────────
    let completedMonsters = []
    try { completedMonsters = JSON.parse(activeEncounter.monsters ?? '[]') } catch { /* empty */ }

    const rawTotalXP = completedMonsters.reduce((sum, m) => sum + (m.xp ?? 0) * m.count, 0)
    const adjXP      = adjustedXP(completedMonsters)
    const xpPerPlayer = campaignChars.length > 0
      ? Math.round(rawTotalXP / campaignChars.length)
      : null

    return (
      <div style={s.page}>
        {editorHeader}
        <div style={s.historyBody}>
          <div style={s.historyPanel}>

            {/* Monster outcomes */}
            <div style={s.historySection}>
              <div style={s.historySectionLabel}>Monster Outcomes</div>
              {completedMonsters.length === 0
                ? <p style={s.historyEmpty}>No monsters were recorded for this encounter.</p>
                : completedMonsters.map(m => (
                  <div key={m.id ?? m.name} style={s.historyMonsterRow}>
                    <span style={s.historyMonsterName}>{m.custom_name || m.name}</span>
                    <span style={s.historyMonsterCount}>×{m.count}</span>
                    <span style={s.historyMonsterXP}>{((m.xp ?? 0) * m.count).toLocaleString()} XP</span>
                  </div>
                ))
              }
            </div>

            {/* XP summary */}
            <div style={s.historySection}>
              <div style={s.historySectionLabel}>XP Earned</div>
              <div style={s.historyXPRow}>
                <span style={s.historyXPLabel}>Raw XP</span>
                <span style={s.historyXPVal}>{rawTotalXP.toLocaleString()}</span>
              </div>
              {adjXP !== rawTotalXP && (
                <div style={s.historyXPRow}>
                  <span style={s.historyXPLabel}>Adjusted XP (multiplier)</span>
                  <span style={s.historyXPVal}>{adjXP.toLocaleString()}</span>
                </div>
              )}
              {xpPerPlayer !== null && (
                <div style={{ ...s.historyXPRow, marginTop: 6 }}>
                  <span style={s.historyXPLabel}>
                    Per Player ({campaignChars.length} characters)
                  </span>
                  <span style={{ ...s.historyXPVal, color: '#7fc272' }}>
                    {xpPerPlayer.toLocaleString()} XP
                  </span>
                </div>
              )}
            </div>

            {/* Notes */}
            <div style={s.historySection}>
              <div style={s.historySectionLabel}>Notes</div>
              <p style={s.historyNotes}>{activeEncounter.notes || '—'}</p>
            </div>

            {/* Actions */}
            <div style={{ ...s.historySection, flexDirection: 'row', gap: 8, display: 'flex' }}>
              <button style={s.reuseBtn} onClick={handleReuseAsNew}>
                ♻ Reuse as New Encounter
              </button>
              <button
                style={s.historyDupBtn}
                onClick={() => { handleDuplicate(activeEncounter); setActiveEncounter(null) }}
              >
                Duplicate
              </button>
            </div>

          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  // VIEW A — Encounter List
  // ════════════════════════════════════════════════════════════════════════════

  // Pre-compute party thresholds for difficulty badges
  const thresholds = partyThresholds(campaignChars)
  const showDiffBadge = campaignChars.length > 0

  return (
    <div style={s.page}>
      {/* Page header */}
      <div style={s.pageHeader}>
        <h1 style={s.pageTitle}>Encounter Builder</h1>
        <button style={s.newBtn} onClick={() => setShowCreate(true)}>+ New Encounter</button>
      </div>

      {loadError && <p style={s.errorMsg}>⚠ {loadError}</p>}

      {/* Status filter tabs + search */}
      <div style={s.listControls}>
        <div style={s.tabs}>
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              style={{ ...s.tab, ...(statusTab === tab ? s.tabActive : {}) }}
              onClick={() => setStatusTab(tab)}
            >
              {tab}
              <span style={s.tabCount}>
                {tab === 'All'
                  ? encounters.length
                  : encounters.filter(e => e.status === tab.toLowerCase()).length}
              </span>
            </button>
          ))}
        </div>
        <input
          style={s.searchInput}
          placeholder="Search encounters…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Encounter cards */}
      {filtered.length === 0 ? (
        <div style={s.emptyState}>
          {searchQuery ? (
            <p style={s.emptyTitle}>No encounters match "{searchQuery}".</p>
          ) : (
            <>
              <p style={s.emptyTitle}>No encounters yet.</p>
              <p style={s.emptyDesc}>Build your first combat encounter.</p>
              <button style={s.newBtn} onClick={() => setShowCreate(true)}>+ New Encounter</button>
            </>
          )}
        </div>
      ) : (
        <div style={s.cardGrid}>
          {filtered.map(enc => {
            let monsterList = []
            try { monsterList = JSON.parse(enc.monsters ?? '[]') } catch { /* empty */ }
            const monsterCount = monsterList.length
            const sc = STATUS_COLORS[enc.status] ?? STATUS_COLORS.planned

            // Difficulty badge: compute adjusted XP from monsters JSON
            let diffBadge = null
            if (showDiffBadge && monsterList.length > 0) {
              const adj  = adjustedXP(monsterList)
              const diff = difficultyRating(adj, thresholds)
              diffBadge  = diff
            }

            return (
              <div key={enc.id} style={s.card}>
                <div style={s.cardTop}>
                  <div style={s.cardName}>{enc.name}</div>
                  <span style={{ ...s.statusBadge, background: sc.bg, color: sc.color }}>
                    {sc.label}
                  </span>
                </div>

                <div style={s.cardMeta}>
                  {enc.location_name && (
                    <span style={s.cardLocation}>📍 {enc.location_name}</span>
                  )}
                  <span style={s.cardStat}>{monsterCount} monster type{monsterCount !== 1 ? 's' : ''}</span>
                  {enc.xp_total > 0 && (
                    <span style={s.cardXP}>{enc.xp_total.toLocaleString()} XP</span>
                  )}
                  {diffBadge && (
                    <span style={{ ...s.diffBadge, color: diffBadge.color, borderColor: diffBadge.color }}>
                      {diffBadge.label}
                    </span>
                  )}
                </div>

                <div style={s.cardActions}>
                  <button style={s.openBtn} onClick={() => openEncounter(enc)}>Open</button>
                  <button style={s.dupBtn} onClick={() => handleDuplicate(enc)}>Duplicate</button>
                  {deleteConfirm === enc.id ? (
                    <>
                      <span style={s.confirmText}>Delete?</span>
                      <button style={s.confirmYes} onClick={() => handleDelete(enc.id)}>Yes</button>
                      <button style={s.confirmNo}  onClick={() => setDeleteConfirm(null)}>No</button>
                    </>
                  ) : (
                    <button style={s.deleteBtn} onClick={() => setDeleteConfirm(enc.id)}>Delete</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Encounter modal */}
      {showCreate && (
        <div style={s.overlay} onClick={() => setShowCreate(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <h2 style={s.modalTitle}>New Encounter</h2>
            <form onSubmit={handleCreate} style={s.form}>
              <label style={s.label}>
                Encounter Name *
                <input
                  autoFocus
                  style={s.input}
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Goblin Ambush at the Bridge"
                />
              </label>

              <label style={s.label}>
                Link to Location
                <select
                  style={s.select}
                  value={form.location_id}
                  onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}
                >
                  <option value="">— No location —</option>
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>

              <label style={s.label}>
                Notes
                <textarea
                  style={{ ...s.input, height: 72, resize: 'vertical' }}
                  rows={3}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes about this encounter"
                />
              </label>

              {formErr && <p style={s.formErr}>{formErr}</p>}

              <div style={s.modalBtns}>
                <button type="button" style={s.cancelBtn} onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" style={s.submitBtn} disabled={creating}>
                  {creating ? 'Creating…' : 'Create Encounter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = {
  page: {
    display: 'flex', flexDirection: 'column',
    height: '100%', padding: '20px 24px', gap: 16, overflow: 'hidden',
    boxSizing: 'border-box',
  },
  pageHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle:  { color: '#c9a84c', fontSize: '1.6rem', margin: 0 },
  newBtn: {
    padding: '8px 16px', background: '#2d5a27', color: '#7fc272',
    border: '1px solid #3d7a37', borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
  errorMsg: { color: '#e05050', fontSize: 13, margin: 0 },

  // List controls (tabs + search row)
  listControls: { display: 'flex', alignItems: 'center', gap: 10 },
  tabs: { display: 'flex', gap: 4 },
  tab: {
    padding: '6px 14px', background: '#1a1a1a', border: '1px solid #333',
    borderRadius: 6, color: '#888', cursor: 'pointer', fontSize: 13,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  tabActive: { background: '#2a2010', border: '1px solid #c9a84c', color: '#c9a84c' },
  tabCount: {
    fontSize: 11, background: '#333', color: '#666',
    borderRadius: 8, padding: '0 5px', minWidth: 16, textAlign: 'center',
  },
  searchInput: {
    marginLeft: 'auto', padding: '6px 12px', background: '#111',
    border: '1px solid #444', borderRadius: 6, color: '#e0d5c0',
    fontSize: 13, outline: 'none', width: 200,
  },

  // Cards
  cardGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 12, overflowY: 'auto', paddingBottom: 8,
  },
  card: {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8,
  },
  cardTop: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  cardName: { color: '#e0d5c0', fontSize: 15, fontWeight: 600, flex: 1 },
  cardMeta: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  cardLocation: { color: '#8a7a5a', fontSize: 12 },
  cardStat:     { color: '#666', fontSize: 12 },
  cardXP:       { color: '#c9a84c', fontSize: 12 },
  diffBadge: {
    fontSize: 11, fontWeight: 600, padding: '1px 6px',
    borderRadius: 8, border: '1px solid', background: 'transparent',
  },
  cardActions:  { display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 },
  openBtn: {
    padding: '5px 14px', background: '#2a3a5a', color: '#7ab0ff',
    border: '1px solid #3a5a8a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  dupBtn: {
    padding: '5px 10px', background: 'none', color: '#777',
    border: '1px solid #444', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  deleteBtn: {
    padding: '5px 10px', background: 'none', color: '#555',
    border: '1px solid #333', borderRadius: 4, cursor: 'pointer', fontSize: 12,
    marginLeft: 'auto',
  },
  confirmText: { color: '#e05050', fontSize: 12, marginLeft: 'auto' },
  confirmYes: {
    padding: '4px 10px', background: '#5a1a1a', color: '#e05050',
    border: '1px solid #8a2a2a', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  confirmNo: {
    padding: '4px 10px', background: '#2a2a2a', color: '#888',
    border: '1px solid #444', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  statusBadge: {
    fontSize: 11, fontWeight: 600, padding: '2px 8px',
    borderRadius: 10, flexShrink: 0,
  },
  locationBadge: { color: '#8a7a5a', fontSize: 13 },

  // Empty state
  centerMsg: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
  },
  msgText: { color: '#555', fontSize: 14 },
  emptyState: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', flex: 1, gap: 8,
  },
  emptyTitle: { color: '#888', fontSize: 16, margin: 0 },
  emptyDesc:  { color: '#555', fontSize: 13, margin: 0 },

  // Editor
  editorHeader: {
    display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
  },
  backBtn: {
    padding: '6px 12px', background: '#2a2a2a', color: '#aaa',
    border: '1px solid #444', borderRadius: 4, cursor: 'pointer', fontSize: 13,
  },
  editorTitle: { color: '#c9a84c', fontSize: '1.3rem', margin: 0, flex: 1 },
  editorBody: {
    display: 'flex', gap: 16, flex: 1, minHeight: 0,
    overflow: 'hidden',
  },
  rosterCol: { flex: 60, minWidth: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  deadlyBorder: { borderRadius: 8, outline: '2px solid rgba(139,0,0,0.6)', outlineOffset: 2 },
  searchCol: { flex: 40, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 },
  mapPickerRow:    { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '6px 8px', background: '#141008', border: '1px solid #2a1c08', borderRadius: 6 },
  mapPickerLabel:  { color: '#a89060', fontSize: 12, flexShrink: 0 },
  mapPickerSelect: { flex: 1, background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '4px 6px', fontSize: 12, outline: 'none' },
  mapPickerHint:   { color: '#4a8a4a', fontSize: 11, flexShrink: 0 },
  startCombatRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '0 2px' },
  startCombatBtn: {
    padding: '9px 22px', background: '#3a1a1a', color: '#e05050',
    border: '1px solid #8a2a2a', borderRadius: 6, cursor: 'pointer',
    fontSize: 14, fontWeight: 600,
  },
  startCombatHint: { color: '#555', fontSize: 12, fontStyle: 'italic' },

  // History view
  historyBody: { display: 'flex', flex: 1, minHeight: 0, overflowY: 'auto' },
  historyPanel: {
    display: 'flex', flexDirection: 'column', gap: 0,
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    overflow: 'hidden', maxWidth: 600, width: '100%',
  },
  historySection:      { padding: '12px 16px', borderBottom: '1px solid #222' },
  historySectionLabel: { color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  historyEmpty:        { color: '#555', fontSize: 13, margin: 0 },
  historyMonsterRow:   { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' },
  historyMonsterName:  { color: '#e0d5c0', fontSize: 13, flex: 1 },
  historyMonsterCount: { color: '#888', fontSize: 12 },
  historyMonsterXP:    { color: '#c9a84c', fontSize: 12 },
  historyXPRow:   { display: 'flex', justifyContent: 'space-between', padding: '2px 0' },
  historyXPLabel: { color: '#888', fontSize: 13 },
  historyXPVal:   { color: '#c9a84c', fontSize: 13, fontWeight: 600 },
  historyNotes:   { color: '#888', fontSize: 13, margin: 0, whiteSpace: 'pre-wrap' },
  reuseBtn: {
    padding: '7px 16px', background: '#1a2a3a', color: '#7ab0ff',
    border: '1px solid #2a4a6a', borderRadius: 5, cursor: 'pointer', fontSize: 13,
  },
  historyDupBtn: {
    padding: '7px 14px', background: '#2a2a2a', color: '#888',
    border: '1px solid #444', borderRadius: 5, cursor: 'pointer', fontSize: 13,
  },

  // Create modal
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#1e1e1e', border: '1px solid #444', borderRadius: 10,
    padding: 28, width: 440, maxWidth: '90vw',
  },
  modalTitle: { color: '#c9a84c', fontSize: '1.2rem', margin: '0 0 16px' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, color: '#aaa', fontSize: 13 },
  input: {
    background: '#111', border: '1px solid #444', borderRadius: 4,
    color: '#e0d5c0', padding: '8px 10px', fontSize: 13, outline: 'none',
  },
  select: {
    background: '#111', border: '1px solid #444', borderRadius: 4,
    color: '#e0d5c0', padding: '8px 10px', fontSize: 13, outline: 'none',
  },
  formErr: { color: '#e05050', fontSize: 13, margin: 0 },
  modalBtns: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
  cancelBtn: {
    padding: '8px 16px', background: '#2a2a2a', color: '#888',
    border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
  submitBtn: {
    padding: '8px 18px', background: '#2d5a27', color: '#7fc272',
    border: '1px solid #3d7a37', borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
}
