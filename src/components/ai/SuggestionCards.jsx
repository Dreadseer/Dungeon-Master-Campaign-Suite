import { useState, useEffect, useCallback } from 'react'
import {
  buildSuggestionPrompt,
  parseSuggestions,
  toCreatePayload,
  buildEntityIndex,
  buildConnectionRows,
  findNameClashes,
  buildContradictionPrompt,
  parseContradictions,
  LOCATION_TYPES,
} from '../../utils/worldSuggestions'
import { buildWorldSummary, existingNames } from '../../utils/aiContext'
import { notifyError, notifySuccess } from '../../stores/toastStore'

// Editable suggestion cards with Save / Save all (Phase 6 tasks 2 and 4).
//
// Shared by the World Builder panel and the AI Assistant's "Save as…", because
// the two do the same job: take model output, let the DM correct it, and write
// it through the create channels that already exist. `sourceText` switches the
// component from "ask for suggestions" to "extract from this message".

const KIND_META = {
  npc:      { icon: '👤', label: 'NPC',      colour: '#7fb3d5' },
  location: { icon: '📍', label: 'Location', colour: '#7fc272' },
  faction:  { icon: '⚔',  label: 'Faction',  colour: '#c9a84c' },
  lore:     { icon: '📜', label: 'Lore',     colour: '#b090d0' },
}

/** Which fields are shown, in which order, and how they are edited. */
const FIELD_FORMS = {
  npc: [
    ['race', 'Race', 'input'], ['class', 'Class', 'input'], ['role', 'Role', 'input'],
    ['motivation', 'Motivation', 'textarea'], ['secrets', 'Secrets', 'textarea'], ['notes', 'Notes', 'textarea'],
  ],
  location: [
    ['type', 'Type', 'select'], ['description', 'Description', 'textarea'], ['lore', 'Lore', 'textarea'],
  ],
  faction: [
    ['alignment', 'Alignment', 'input'], ['description', 'Description', 'textarea'], ['notes', 'Notes', 'textarea'],
  ],
  lore: [
    ['category', 'Category', 'input'], ['content', 'Content', 'textarea'], ['is_secret', 'Secret from players', 'checkbox'],
  ],
}

/** The create channel per kind — all four already existed before Phase 6. */
const CREATE = {
  npc:      (p) => window.electronAPI.db.npcs.create(p),
  location: (p) => window.electronAPI.db.locations.create(p),
  faction:  (p) => window.electronAPI.db.factions.create(p),
  lore:     (p) => window.electronAPI.db.lore.create(p),
}

const ROUTE = {
  npc: '#/world/npcs', location: '#/world/locations',
  faction: '#/world/factions', lore: '#/world/lore',
}

export default function SuggestionCards({
  campaign,
  world = {},
  mode = 'inline',        // 'inline' in the World Builder, 'modal' from chat
  sourceText = null,      // when set, extract from this instead of asking for ideas
  autoRun = false,
  onClose,
  onSaved,
}) {
  const [aiMode,   setAiMode]   = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [request,  setRequest]  = useState('')
  const [cards,    setCards]    = useState(null)   // [{ suggestion, saved, savedId, checking, conflicts }]
  const [note,     setNote]     = useState('')
  const [savingAll, setSavingAll] = useState(false)

  useEffect(() => {
    // ai:getMode resolves to an OBJECT — { mode }. Comparing the object to a
    // string is the bug the capability review found in this very panel.
    window.electronAPI.ai.getMode()
      .then(({ mode: m }) => setAiMode(m))
      .catch(err => { notifyError(err, 'Check AI status'); setAiMode('no-ai') })
  }, [])

  const generate = useCallback(async () => {
    if (!campaign?.id) return
    setLoading(true)
    setError('')
    setCards(null)
    setNote('')

    try {
      let system, user
      if (sourceText) {
        // Same contract, different input: pull records out of prose the model
        // already wrote rather than asking for new ideas.
        const built = buildSuggestionPrompt({
          campaign,
          request: 'Extract every concrete NPC, location, faction and piece of lore described in the text below, exactly as described. Do not invent anything that is not there.',
          context: buildWorldSummary(world, { budget: 1500 }),
          existingNames: existingNames(world),
        })
        system = built.system
        user = `${built.user}\n\n--- The text to extract from ---\n${sourceText}`
      } else {
        const built = buildSuggestionPrompt({
          campaign,
          request,
          context: buildWorldSummary(world, { budget: 2000 }),
          existingNames: existingNames(world),
        })
        system = built.system
        user = built.user
      }

      const raw = await window.electronAPI.ai.complete(system, user,
        { maxTokens: 3000, campaignId: campaign.id, type: sourceText ? 'extract' : 'suggest' })
      const { suggestions, dropped } = parseSuggestions(raw)

      if (suggestions.length === 0) {
        setError('The AI did not return anything saveable. Try rephrasing, or run it again.')
        setLoading(false)
        return
      }

      const clashes = findNameClashes(suggestions, world)
      setNote([
        dropped > 0 ? `${dropped} malformed suggestion${dropped === 1 ? '' : 's'} skipped.` : '',
        clashes.length > 0 ? `${clashes.map(c => `"${c.name}"`).join(', ')} already exist${clashes.length === 1 ? 's' : ''} in this campaign — saving will create a second record.` : '',
      ].filter(Boolean).join(' '))

      setCards(suggestions.map(sg => ({
        suggestion: sg, saved: false, savedId: null, checking: false, conflicts: null,
      })))
    } catch (err) {
      // Parse failures and AI failures both land here; the message distinguishes.
      setError(err?.message ?? 'The request failed.')
      notifyError(err, sourceText ? 'Extract records' : 'Generate suggestions')
    } finally {
      setLoading(false)
    }
  }, [campaign, request, sourceText, world])

  // The chat modal has nothing to ask for — it already has its text.
  useEffect(() => {
    if ((sourceText || autoRun) && aiMode && aiMode !== 'no-ai' && cards === null && !loading) {
      generate()
    }
  }, [sourceText, autoRun, aiMode]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Edit a field in place before saving. */
  const editField = (i, key, value) => setCards(prev => prev.map((c, idx) => idx !== i ? c : {
    ...c, suggestion: { ...c.suggestion, fields: { ...c.suggestion.fields, [key]: value } },
  }))

  const editName = (i, value) => setCards(prev => prev.map((c, idx) => idx !== i ? c : {
    ...c, suggestion: { ...c.suggestion, name: value },
  }))

  /** Save one card. Returns { kind, id, name } so Save all can link them up. */
  const saveOne = useCallback(async (index) => {
    const card = cards[index]
    if (!card || card.saved) return null

    const sg = card.suggestion
    if (!sg.name.trim()) {
      notifyError(new Error('This suggestion has no name.'), 'Save suggestion')
      return null
    }

    try {
      const result = await CREATE[sg.kind](toCreatePayload(sg, campaign.id))
      const id = Number(result?.lastInsertRowid ?? result?.id)
      setCards(prev => prev.map((c, i) => i === index ? { ...c, saved: true, savedId: id } : c))
      return { kind: sg.kind, id, name: sg.name }
    } catch (err) {
      notifyError(err, `Save ${sg.kind} "${sg.name}"`)
      return null
    }
  }, [cards, campaign])

  const handleSaveOne = async (index) => {
    const saved = await saveOne(index)
    if (saved) {
      notifySuccess(`${KIND_META[saved.kind].label} "${saved.name}" saved`)
      onSaved?.()
    }
  }

  /**
   * Save every unsaved card, then write the connections between them.
   *
   * Connections come last on purpose: a link can only be resolved once both
   * ends have ids, and a half-written connection row is worse than none.
   */
  const handleSaveAll = async () => {
    if (!cards || savingAll) return
    setSavingAll(true)

    const saved = []
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].saved) {
        saved.push({ kind: cards[i].suggestion.kind, id: cards[i].savedId, name: cards[i].suggestion.name })
        continue
      }
      const one = await saveOne(i)
      if (one) saved.push(one)
    }

    if (saved.length === 0) { setSavingAll(false); return }

    const index = buildEntityIndex({ saved, existing: world })
    const { rows, unresolved } = buildConnectionRows(cards.map(c => c.suggestion), index, campaign.id)

    let written = 0
    for (const row of rows) {
      try {
        await window.electronAPI.db.connections.create(row)
        written++
      } catch (err) {
        notifyError(err, 'Save connection')
      }
    }

    notifySuccess(
      `Saved ${saved.length} record${saved.length === 1 ? '' : 's'}` +
      (written ? ` and ${written} connection${written === 1 ? '' : 's'}` : '') +
      // Never silently write fewer links than the cards promised.
      (unresolved.length ? ` — ${unresolved.length} link${unresolved.length === 1 ? '' : 's'} could not be matched` : ''),
    )

    setSavingAll(false)
    onSaved?.()
  }

  /** Ask the model whether this clashes with lore already on record (task 7). */
  const checkContradictions = async (index) => {
    const card = cards[index]
    if (!card) return
    setCards(prev => prev.map((c, i) => i === index ? { ...c, checking: true } : c))

    try {
      const query = `${card.suggestion.name} ${Object.values(card.suggestion.fields).filter(v => typeof v === 'string').join(' ')}`
      let chunks = []
      try {
        const hits = await window.electronAPI.embed.search(query.slice(0, 500), 3)
        chunks = (hits ?? []).map(h => ({ text: h.text ?? h.chunk_text ?? '', source: h.source ?? h.item_name ?? '' }))
      } catch {
        // No index yet, or Ollama absent. Fall back to the lore titles/bodies we
        // already hold rather than refusing to check at all.
        chunks = (world.lore ?? []).slice(0, 3).map(l => ({ text: `${l.name}: ${l.content ?? ''}`, source: l.name }))
      }

      const { system, user } = buildContradictionPrompt(card.suggestion, chunks)
      const raw = await window.electronAPI.ai.complete(system, user,
        { maxTokens: 800, campaignId: campaign.id, type: 'contradiction-check' })
      const verdict = parseContradictions(raw)
      setCards(prev => prev.map((c, i) => i === index ? { ...c, checking: false, conflicts: verdict } : c))
    } catch (err) {
      notifyError(err, 'Check for contradictions')
      setCards(prev => prev.map((c, i) => i === index ? { ...c, checking: false } : c))
    }
  }

  // ── no-ai ──────────────────────────────────────────────────────────────────
  if (aiMode === 'no-ai') {
    const body = (
      <div style={s.noAiPanel}>
        <p style={s.noAiTitle}>AI not configured</p>
        <p style={s.noAiText}>
          Add an Anthropic API key in Settings, or install Ollama for local AI, to
          generate saveable world entries.
        </p>
        {mode === 'modal' && <button style={s.btnGhost} onClick={onClose}>Close</button>}
      </div>
    )
    return mode === 'modal' ? <Modal onClose={onClose}>{body}</Modal> : body
  }

  const unsaved = cards?.filter(c => !c.saved).length ?? 0

  const body = (
    <div style={s.body}>
      {/* The free-text ask. Absent when extracting from a chat message. */}
      {!sourceText && (
        <div style={s.askRow}>
          <input
            style={s.askInput}
            placeholder='What should I add? e.g. "a rival thieves guild in Waterdeep"'
            value={request}
            onChange={e => setRequest(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !loading) generate() }}
            disabled={loading}
          />
          <button style={loading ? s.btnDisabled : s.btnPrimary} onClick={generate} disabled={loading || !campaign}>
            {loading ? 'Thinking…' : request.trim() ? 'Ask' : 'Suggest 3 things'}
          </button>
        </div>
      )}

      {loading && (
        <div style={s.spinner}>
          <span style={s.spinnerDot}>◆</span>
          {sourceText ? ' Reading the message for saveable records…' : ' Consulting the oracle…'}
        </div>
      )}

      {error && !loading && (
        <div style={s.errorBox}>
          <p style={s.errorText}>{error}</p>
          <button style={s.btnGhost} onClick={generate}>↺ Try again</button>
        </div>
      )}

      {note && !loading && <p style={s.note}>{note}</p>}

      {cards && !loading && (
        <>
          <div style={s.cardList}>
            {cards.map((card, i) => (
              <Card
                key={i}
                card={card}
                onEditField={(k, v) => editField(i, k, v)}
                onEditName={(v) => editName(i, v)}
                onSave={() => handleSaveOne(i)}
                onCheck={() => checkContradictions(i)}
              />
            ))}
          </div>

          <div style={s.footer}>
            <button
              style={(unsaved === 0 || savingAll) ? s.btnDisabled : s.btnPrimary}
              onClick={handleSaveAll}
              disabled={unsaved === 0 || savingAll}
            >
              {savingAll ? 'Saving…' : `Save all (${unsaved}) + links`}
            </button>
            <button style={s.btnGhost} onClick={generate} disabled={loading}>↺ Regenerate</button>
            {mode === 'modal' && <button style={s.btnGhost} onClick={onClose}>Close</button>}
          </div>
        </>
      )}
    </div>
  )

  return mode === 'modal' ? <Modal onClose={onClose}>{body}</Modal> : body
}

// ── One card ─────────────────────────────────────────────────────────────────

function Card({ card, onEditField, onEditName, onSave, onCheck }) {
  const { suggestion: sg, saved, savedId, checking, conflicts } = card
  const meta = KIND_META[sg.kind]

  return (
    <div style={{ ...s.card, borderLeftColor: meta.colour, ...(saved ? s.cardSaved : {}) }}>
      <div style={s.cardHead}>
        <span style={{ ...s.kindPill, color: meta.colour, borderColor: meta.colour }}>
          {meta.icon} {meta.label}
        </span>
        <input
          style={s.nameInput}
          value={sg.name}
          onChange={e => onEditName(e.target.value)}
          disabled={saved}
          aria-label="Name"
        />
        {saved && (
          <a style={s.savedLink} href={ROUTE[sg.kind]} title={`Open in ${meta.label}s`}>
            ✓ Saved{savedId ? ` #${savedId}` : ''} →
          </a>
        )}
      </div>

      {!saved && (
        <div style={s.fields}>
          {FIELD_FORMS[sg.kind].map(([key, label, kind]) => (
            <label key={key} style={s.fieldRow}>
              <span style={s.fieldLabel}>{label}</span>
              {kind === 'textarea' ? (
                <textarea
                  style={s.fieldTextarea}
                  value={sg.fields[key] ?? ''}
                  onChange={e => onEditField(key, e.target.value)}
                  rows={2}
                />
              ) : kind === 'select' ? (
                <select
                  style={s.fieldInput}
                  value={sg.fields[key] ?? 'landmark'}
                  onChange={e => onEditField(key, e.target.value)}
                >
                  {LOCATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              ) : kind === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={Boolean(sg.fields[key])}
                  onChange={e => onEditField(key, e.target.checked)}
                />
              ) : (
                <input
                  style={s.fieldInput}
                  value={sg.fields[key] ?? ''}
                  onChange={e => onEditField(key, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      )}

      {sg.links?.length > 0 && (
        <div style={s.links}>
          {sg.links.map((l, i) => (
            <span key={i} style={s.linkPill}>{l.relationship || 'related to'} → {l.to}</span>
          ))}
        </div>
      )}

      {conflicts && (
        <div style={conflicts.verdict === 'clear' ? s.clearBox : s.conflictBox}>
          {conflicts.verdict === 'clear'
            ? '✓ No contradictions found in your existing lore.'
            : conflicts.conflicts.map((c, i) => (
              <p key={i} style={s.conflictLine}>
                ⚠ {c.with ? <strong>{c.with}: </strong> : null}{c.issue}
              </p>
            ))}
        </div>
      )}

      {!saved && (
        <div style={s.cardActions}>
          <button style={s.btnSave} onClick={onSave}>Save</button>
          <button style={s.btnGhostSmall} onClick={onCheck} disabled={checking}>
            {checking ? 'Checking…' : '🔍 Check for contradictions'}
          </button>
        </div>
      )}
    </div>
  )
}

function Modal({ children, onClose }) {
  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>✨ Save to your world</span>
          <button style={s.modalClose} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const s = {
  body:       { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  askRow:     { display: 'flex', gap: '0.5rem' },
  askInput:   { flex: 1, background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.5rem 0.7rem', fontSize: '0.85rem' },

  btnPrimary: { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.1rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' },
  btnDisabled:{ background: '#2a2418', color: '#6b5a3a', border: 'none', padding: '0.5rem 1.1rem', borderRadius: 4, cursor: 'not-allowed', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap' },
  btnGhost:   { background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.4rem 0.9rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' },
  btnGhostSmall: { background: 'transparent', color: '#7a6a4a', border: '1px solid #3a2a10', padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem' },
  btnSave:    { background: '#2d6a2d', color: '#e8f0e0', border: 'none', padding: '0.35rem 1rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' },

  spinner:    { color: '#a89060', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  spinnerDot: { color: '#c9a84c' },

  errorBox:   { background: '#2a1010', border: '1px solid #5a2020', borderRadius: 4, padding: '0.7rem' },
  errorText:  { color: '#e08080', fontSize: '0.85rem', margin: '0 0 0.5rem' },
  note:       { color: '#a89060', fontSize: '0.8rem', margin: 0, fontStyle: 'italic' },

  cardList:   { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  card:       { background: '#12100a', border: '1px solid #2a2010', borderLeft: '3px solid', borderRadius: 4, padding: '0.7rem' },
  cardSaved:  { opacity: 0.72, background: '#0f140f' },
  cardHead:   { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' },
  kindPill:   { fontSize: '0.7rem', border: '1px solid', borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap' },
  nameInput:  { flex: 1, background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.3rem 0.5rem', fontSize: '0.9rem', fontWeight: 'bold' },
  savedLink:  { color: '#7fc272', fontSize: '0.75rem', textDecoration: 'none', whiteSpace: 'nowrap' },

  fields:     { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  fieldRow:   { display: 'flex', alignItems: 'flex-start', gap: '0.5rem' },
  fieldLabel: { color: '#7a6a4a', fontSize: '0.72rem', width: 92, flexShrink: 0, paddingTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldInput: { flex: 1, background: '#0d0a05', border: '1px solid #2a2010', borderRadius: 3, color: '#e8e0d0', padding: '0.25rem 0.5rem', fontSize: '0.82rem' },
  fieldTextarea: { flex: 1, background: '#0d0a05', border: '1px solid #2a2010', borderRadius: 3, color: '#e8e0d0', padding: '0.25rem 0.5rem', fontSize: '0.82rem', resize: 'vertical', fontFamily: 'inherit' },

  links:      { display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.5rem' },
  linkPill:   { fontSize: '0.7rem', background: '#1a1a2a', color: '#8a9ac0', border: '1px solid #2a3050', borderRadius: 10, padding: '1px 7px' },

  conflictBox:{ marginTop: '0.5rem', background: '#2a2010', border: '1px solid #5a4010', borderRadius: 4, padding: '0.5rem' },
  clearBox:   { marginTop: '0.5rem', color: '#7fc272', fontSize: '0.78rem' },
  conflictLine:{ color: '#c9a84c', fontSize: '0.78rem', margin: '0 0 0.25rem' },

  cardActions:{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', alignItems: 'center' },
  footer:     { display: 'flex', gap: '0.5rem', alignItems: 'center', paddingTop: '0.3rem' },

  noAiPanel:  { background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 4, padding: '1rem' },
  noAiTitle:  { color: '#c9a84c', fontSize: '0.9rem', fontWeight: 'bold', margin: '0 0 0.4rem' },
  noAiText:   { color: '#6b5a3a', fontSize: '0.85rem', margin: '0 0 0.6rem', lineHeight: 1.5 },

  backdrop:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:      { background: '#100d08', border: '1px solid #3a2a10', borderRadius: 6, width: 'min(760px, 92vw)', maxHeight: '86vh', overflowY: 'auto', padding: '1rem' },
  modalHead:  { display: 'flex', alignItems: 'center', marginBottom: '0.8rem' },
  modalTitle: { color: '#c9a84c', fontSize: '1rem', fontFamily: 'Georgia, serif', flex: 1 },
  modalClose: { background: 'transparent', border: 'none', color: '#6b5a3a', fontSize: '1.1rem', cursor: 'pointer' },
}
