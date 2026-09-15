import { useState, useCallback } from 'react'
import useAiMode from '../../hooks/useAiMode'
import {
  DIFFICULTIES, candidateMonsters, buildGenerationPrompt,
  parseGeneratedEncounter, resolveSelection, validateAgainstBudget, retryHint,
} from '../../utils/encounterGeneration'
import { xpBudget, createMonsterEntry, crToXP } from '../../utils/encounterUtils'
import { notifyError, notifySuccess } from '../../stores/toastStore'
import { parseIpcError } from '../../utils/ipcError'

// AI encounter generation (Phase 7 task 2).
//
// The model never invents a monster: it is handed a pre-filtered list of real
// ones and asked to SELECT from it. That is what makes this work on llama3 and
// what makes every CR accurate — see src/utils/encounterGeneration.js.
//
// The result is validated locally against the XP budget before anything is
// saved, and a miss of more than one tier is retried ONCE with the miss quoted
// back to the model. A second miss is offered to the DM anyway, labelled, since
// a Deadly encounter they asked to be Hard is still something they may want.

export default function EncounterGenerator({ campaignId, characters, locations = [], onCreated, onClose }) {
  const { noAi } = useAiMode()

  const [difficulty, setDifficulty] = useState('medium')
  const [locationId, setLocationId] = useState('')
  const [theme, setTheme]           = useState('')
  const [busy, setBusy]             = useState(false)
  const [status, setStatus]         = useState('')
  const [error, setError]           = useState('')
  const [preview, setPreview]       = useState(null)   // { name, monsters, tactics, notes, validation, invented }

  const party = characters ?? []
  const partySize = Math.max(1, party.length)
  const avgLevel = party.length
    ? Math.round(party.reduce((n, c) => n + (c.level ?? 1), 0) / party.length)
    : 1
  const budget = xpBudget(party.length ? party : [{ level: 1 }], difficulty)

  /** One round trip: prompt, call, parse, resolve, validate. */
  const attempt = useCallback(async (candidates, hint) => {
    const { system, user } = buildGenerationPrompt({
      candidates, budget, difficulty, partySize, avgLevel,
      location: locations.find(l => String(l.id) === String(locationId))?.name ?? '',
      theme,
    })

    const raw = await window.electronAPI.ai.complete(
      system, hint ? `${user}\n\n${hint}` : user,
      { maxTokens: 1200, campaignId, type: 'encounter-generate' },
    )

    const selection = parseGeneratedEncounter(raw)
    const { monsters, invented } = resolveSelection(selection, candidates)
    const validation = validateAgainstBudget(monsters, { characters: party, difficulty })
    return { selection, monsters, invented, validation }
  }, [budget, difficulty, partySize, avgLevel, locationId, theme, locations, campaignId, party])

  async function handleGenerate() {
    if (busy) return
    setBusy(true); setError(''); setPreview(null); setStatus('Gathering candidates…')

    try {
      // SRD plus the campaign's own homebrew, so a DM's monsters are eligible.
      const [srdRes, homebrewRes] = await Promise.allSettled([
        window.electronAPI.srd.getMonsters({}),
        window.electronAPI.db.compendium.getAll(campaignId, 'monster'),
      ])
      const srd = srdRes.status === 'fulfilled' ? (srdRes.value ?? []) : []
      const homebrew = (homebrewRes.status === 'fulfilled' ? (homebrewRes.value ?? []) : [])
        .map(row => {
          let data = {}
          try { data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {}) } catch { /* unusable */ }
          return { ...data, name: row.name, index: String(row.id), id: row.id, source: 'homebrew' }
        })

      const candidates = candidateMonsters([...homebrew, ...srd], {
        budget, partySize, environment: theme,
      })

      if (candidates.length === 0) {
        setError('No monsters in range for that budget. Seed the SRD in Settings, or pick a different difficulty.')
        return
      }

      setStatus(`Asking for a ${difficulty} encounter from ${candidates.length} candidates…`)
      let out = await attempt(candidates, '')

      // Retry ONCE, quoting the miss back — the brief's rule.
      if (!out.validation.ok) {
        setStatus(`First attempt rated ${out.validation.label}. Trying once more…`)
        const second = await attempt(candidates, retryHint(out.validation, budget))
        // Keep whichever landed closer, so a retry cannot make things worse.
        if (Math.abs(second.validation.tiersOff) <= Math.abs(out.validation.tiersOff)) out = second
      }

      if (out.monsters.length === 0) {
        setError('The AI did not pick any monster from the list. Try again, or rephrase the theme.')
        return
      }

      setPreview({ ...out.selection, ...out })
      setStatus('')
    } catch (err) {
      setError(parseIpcError(err).message)
      notifyError(err, 'Generate encounter')
    } finally {
      setBusy(false)
    }
  }

  /** Persist the previewed encounter through the existing create channel. */
  async function handleSave() {
    if (!preview || busy) return
    setBusy(true)
    try {
      // Full stat blocks, so the saved entries carry HP and AC rather than just
      // a name — createMonsterEntry is the same path the manual roster uses.
      const entries = []
      for (const m of preview.monsters) {
        let block = null
        if (m.source === 'homebrew') {
          const row = await window.electronAPI.db.compendium.getById(Number(m.index))
          if (row) {
            let data = {}
            try { data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {}) } catch { /* unusable */ }
            block = { ...data, name: row.name, index: String(row.id), challenge_rating: data.cr ?? m.cr }
          }
        } else {
          block = await window.electronAPI.srd.getMonsterByIndex(m.index)
        }

        const entry = block
          ? createMonsterEntry(block, m.source)
          // The stat block vanished between listing and saving. Keep the pick
          // rather than dropping it silently; HP is editable in the roster.
          : { id: crypto.randomUUID(), name: m.name, source: m.source, source_index: m.index,
            cr: m.cr, xp: crToXP(m.cr), hp_max: 10, hp_current: 10, ac: null,
            legendary_max: 0, lair_action_text: null, custom_name: null, notes: '' }

        entries.push({ ...entry, count: m.count })
      }

      const notes = [
        preview.tactics ? `Tactics: ${preview.tactics}` : '',
        preview.notes,
      ].filter(Boolean).join('\n\n')

      await window.electronAPI.db.encounters.create({
        campaign_id: campaignId,
        name: preview.name,
        location_id: locationId ? Number(locationId) : null,
        notes,
        monsters: entries,
        xp_total: entries.reduce((n, e) => n + (e.xp ?? 0) * e.count, 0),
      })

      notifySuccess(`"${preview.name}" created — rated ${preview.validation.label}.`)
      setPreview(null)
      onCreated?.()
      onClose?.()
    } catch (err) {
      setError(parseIpcError(err).message)
      notifyError(err, 'Save generated encounter')
    } finally {
      setBusy(false)
    }
  }

  if (noAi) {
    return (
      <div style={s.noAi}>
        <p style={s.noAiTitle}>AI not configured</p>
        <p style={s.noAiText}>
          Generation needs a model. Add an Anthropic API key in Settings, or install
          Ollama, to use it. Building an encounter by hand works either way.
        </p>
      </div>
    )
  }

  return (
    <div style={s.panel}>
      <div style={s.row2}>
        <div style={{ flex: 1 }}>
          <label style={s.label}>Target difficulty</label>
          <select style={s.input} value={difficulty} onChange={e => setDifficulty(e.target.value)}>
            {DIFFICULTIES.map(d => (
              <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={s.label}>Location</label>
          <select style={s.input} value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">— none —</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      <label style={s.label}>Environment or theme</label>
      <input
        style={s.input}
        value={theme}
        onChange={e => setTheme(e.target.value)}
        placeholder="e.g. a swamp ambush at dusk"
      />

      <p style={s.budget}>
        {party.length > 0
          ? `${partySize} character${partySize === 1 ? '' : 's'} at about level ${avgLevel} — budget ${budget.toLocaleString()} XP`
          : 'No characters in this campaign yet — using a level 1 budget.'}
      </p>

      <div style={s.row}>
        <button style={busy ? s.btnDisabled : s.btnPrimary} onClick={handleGenerate} disabled={busy}>
          {busy ? (status || 'Working…') : '✨ Generate encounter'}
        </button>
        {onClose && (
          <button style={s.btnSecondary} onClick={onClose} disabled={busy}>Close</button>
        )}
      </div>

      {busy && status && <p style={s.status}>{status}</p>}
      {error && <p style={s.err}>{error}</p>}

      {preview && (
        <div style={s.preview}>
          <div style={s.previewHead}>
            <span style={s.previewName}>{preview.name}</span>
            <span style={{
              ...s.rating,
              borderColor: preview.validation.ok ? '#5ba85b' : '#c9a84c',
              color: preview.validation.ok ? '#5ba85b' : '#c9a84c',
            }}>
              {preview.validation.label} · {preview.validation.adjusted.toLocaleString()} adj. XP
            </span>
          </div>

          {!preview.validation.ok && (
            // Offered anyway, labelled: a Deadly encounter asked to be Hard is
            // still something a DM may want.
            <p style={s.warn}>
              This came back {preview.validation.reason}. Save it if you want it, or
              generate again.
            </p>
          )}

          {preview.invented?.length > 0 && (
            <p style={s.warn}>
              Ignored {preview.invented.length} monster{preview.invented.length === 1 ? '' : 's'} the
              AI invented: {preview.invented.join(', ')}.
            </p>
          )}

          <ul style={s.monsterList}>
            {preview.monsters.map(m => (
              <li key={m.index} style={s.monsterRow}>
                <span style={s.monsterCount}>{m.count}×</span>
                <span style={s.monsterName}>{m.name}</span>
                <span style={s.monsterMeta}>
                  CR {m.cr} · {(m.xp * m.count).toLocaleString()} XP
                  {m.source === 'homebrew' ? ' · homebrew' : ''}
                </span>
              </li>
            ))}
          </ul>

          {preview.tactics && <p style={s.tactics}><strong>Tactics.</strong> {preview.tactics}</p>}
          {preview.notes && <p style={s.tactics}>{preview.notes}</p>}

          <div style={s.row}>
            <button style={busy ? s.btnDisabled : s.btnPrimary} onClick={handleSave} disabled={busy}>
              Save encounter
            </button>
            <button style={s.btnSecondary} onClick={handleGenerate} disabled={busy}>↺ Generate again</button>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  panel:  { background: '#100d08', border: '1px solid #2a2010', borderRadius: 6, padding: '1rem' },
  row:    { display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' },
  row2:   { display: 'flex', gap: '0.7rem' },
  label:  { display: 'block', color: '#a89060', fontSize: '0.78rem', marginBottom: 4, marginTop: '0.7rem' },
  input:  { width: '100%', boxSizing: 'border-box', background: '#0a0704', border: '1px solid #1e1608', borderRadius: 4, color: '#e8e0d0', fontSize: '0.88rem', padding: '0.5rem', outline: 'none' },
  budget: { color: '#7a6035', fontSize: '0.8rem', margin: '0.8rem 0 0' },
  status: { color: '#a89060', fontSize: '0.8rem', margin: '0.5rem 0 0', fontStyle: 'italic' },
  err:    { color: '#e08080', fontSize: '0.82rem', margin: '0.6rem 0 0' },

  btnPrimary:  { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.1rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' },
  btnDisabled: { background: '#2a2418', color: '#6b5a3a', border: 'none', padding: '0.5rem 1.1rem', borderRadius: 4, cursor: 'not-allowed', fontWeight: 'bold', fontSize: '0.85rem' },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.45rem 0.9rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },

  preview:     { marginTop: '1rem', background: '#14100a', border: '1px solid #3a2a10', borderRadius: 4, padding: '0.8rem' },
  previewHead: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem', flexWrap: 'wrap' },
  previewName: { color: '#e8e0d0', fontSize: '1rem', fontWeight: 'bold', flex: 1 },
  rating:      { fontSize: '0.75rem', border: '1px solid', borderRadius: 10, padding: '1px 8px' },
  warn:        { color: '#c9a84c', fontSize: '0.78rem', margin: '0 0 0.5rem', lineHeight: 1.5 },

  monsterList: { listStyle: 'none', padding: 0, margin: '0 0 0.6rem' },
  monsterRow:  { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', borderTop: '1px solid #1e1608' },
  monsterCount:{ color: '#c9a84c', fontSize: '0.82rem', minWidth: 28 },
  monsterName: { color: '#e8e0d0', fontSize: '0.85rem', flex: 1 },
  monsterMeta: { color: '#6b5a3a', fontSize: '0.75rem' },
  tactics:     { color: '#a89060', fontSize: '0.8rem', lineHeight: 1.55, margin: '0 0 0.4rem' },

  noAi:      { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 4, padding: '1rem' },
  noAiTitle: { color: '#c9a84c', fontSize: '0.9rem', fontWeight: 'bold', margin: '0 0 0.4rem' },
  noAiText:  { color: '#6b5a3a', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 },
}
