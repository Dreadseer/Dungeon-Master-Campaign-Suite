import { useState, useCallback, useRef, useEffect } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import {
  CONTENT_TYPES,
  buildExtractionPrompt,
  parseExtraction,
  extractionMaxTokens,
  CR_TO_XP,
} from '../../utils/compendiumExtractor'

const SPELL_LEVELS   = ['Cantrip','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']
const SEARCH_CHUNK_K = 8   // how many embedding chunks to retrieve per search
// Subclasses and monsters can span several pages (multiple features/actions),
// so pull more chunks for them to avoid missing later sections.
const SEARCH_CHUNK_K_BY_TYPE = { subclass: 14, monster: 12 }

// ── Main modal component ──────────────────────────────────────────────────────

export default function SourceBookImportModal({ initialType = 'spell', onClose, onImported }) {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [contentType, setContentType] = useState(initialType)
  const [nameInput,   setNameInput]   = useState('')
  const [phase,       setPhase]       = useState('idle')  // idle | searching | extracting | preview | saving | done | error
  const [error,       setError]       = useState('')
  const [extracted,   setExtracted]   = useState(null)    // { name, data }
  const [editName,    setEditName]    = useState('')
  const [savedCount,  setSavedCount]  = useState(0)
  const [sources,     setSources]     = useState([])       // indexed PDF sources
  const [sourceId,    setSourceId]    = useState('')       // '' = all sources

  const inputRef = useRef(null)

  // Load indexed source books for the filter dropdown
  useEffect(() => {
    if (!activeCampaign?.id) return
    window.electronAPI.db.pdf.getAll(activeCampaign.id)
      .then(rows => setSources(rows.filter(r => r.status === 'indexed' || r.status === 'embedded')))
      .catch(() => {})
  }, [activeCampaign?.id])

  // ── Search + extract pipeline ─────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const name = nameInput.trim()
    if (!name || !activeCampaign?.id) return

    setError('')
    setExtracted(null)
    setPhase('searching')

    try {
      // 1. Semantic search in embedded source books.
      // Pass a type-specific anchor word alongside the name so the AND-keyword
      // search only matches actual stat blocks (e.g. "Babau armor" requires
      // "Armor Class" to be present, filtering out encounter tables / indexes).
      const TYPE_ANCHORS = {
        monster:   'armor',    // "Armor Class" is in every monster stat block
        spell:     'casting',  // "Casting Time" is in every spell entry
        equipment: 'cost',     // "Cost" or "cost" appears in equipment blocks
        subclass:  'level',    // "level" appears in subclass feature tables
      }
      const anchor   = TYPE_ANCHORS[contentType] ?? ''
      const itemKeys = anchor ? `${name} ${anchor}` : name

      const searchQuery = `${name} ${CONTENT_TYPES[contentType].searchHint}`
      const chunkK = SEARCH_CHUNK_K_BY_TYPE[contentType] ?? SEARCH_CHUNK_K
      const chunks = await window.electronAPI.embed.search(searchQuery, chunkK, itemKeys, sourceId ? Number(sourceId) : null)

      if (!chunks || chunks.length === 0) {
        setError('No matching passages found in your source books. Make sure the relevant book is indexed.')
        setPhase('error')
        return
      }

      // Drop only true zero-score results; vectra cosine and SQLite fallback
      // scores are on different scales so we don't apply a fixed threshold.
      const relevant = chunks.filter(c => c.score > 0)
      if (relevant.length === 0) {
        setError('Found passages but none were relevant enough. Try a different name or check that the book is indexed.')
        setPhase('error')
        return
      }

      // 2. Build extraction prompt and call AI
      setPhase('extracting')
      const { system, user } = buildExtractionPrompt(contentType, name, relevant)
      const rawResult = await window.electronAPI.ai.complete(system, user, { maxTokens: extractionMaxTokens(contentType) })

      // 3. Parse and normalise
      const data = parseExtraction(contentType, rawResult)

      setExtracted({ name: data.name || name, data })
      setEditName(data.name || name)
      setPhase('preview')

    } catch (err) {
      console.error('[SourceBookImport]', err)
      setError(
        err.message?.includes('JSON')
          ? 'AI returned unexpected format. Try again or try a more specific name.'
          : err.message ?? 'Extraction failed'
      )
      setPhase('error')
    }
  }, [nameInput, contentType, activeCampaign?.id])

  // ── Save to Compendium ────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!extracted || !activeCampaign?.id) return
    setPhase('saving')

    try {
      const finalName = editName.trim() || extracted.name
      const data = { ...extracted.data }

      if (contentType === 'subclass') {
        // Subclasses go into their own table
        await window.electronAPI.db.subclasses.create({
          class_name:   data.class_name,
          name:         data.name || finalName,
          description:  data.description,
          unlock_level: data.unlock_level,
          features:     data.features,
        })
      } else {
        // Spell / Monster / Equipment go into compendium_custom.
        // Pass data as a plain object — the DB handler does its own JSON.stringify.
        await window.electronAPI.db.compendium.create({
          campaign_id: activeCampaign.id,
          type:        contentType,
          name:        finalName,
          data:        data,
          source:      'source_book',
        })
      }

      setSavedCount(n => n + 1)
      setPhase('done')
      onImported?.()

    } catch (err) {
      setError(err.message ?? 'Save failed')
      setPhase('error')
    }
  }, [extracted, editName, contentType, activeCampaign?.id, onImported])

  const handleSearchAnother = () => {
    setNameInput('')
    setExtracted(null)
    setError('')
    setPhase('idle')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.headerTitle}>📥 Import from Source Book</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Content type tabs */}
        <div style={s.typeTabs}>
          {Object.entries(CONTENT_TYPES).map(([key, { label, icon }]) => (
            <button
              key={key}
              style={contentType === key ? { ...s.typeTab, ...s.typeTabActive } : s.typeTab}
              onClick={() => { setContentType(key); setExtracted(null); setPhase('idle'); setError('') }}
              disabled={phase === 'searching' || phase === 'extracting' || phase === 'saving'}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        <div style={s.body}>

          {/* Source book filter */}
          {sources.length > 1 && (
            <div style={s.sourceRow}>
              <span style={s.sourceLabel}>Search in:</span>
              <select
                style={s.sourceSelect}
                value={sourceId}
                onChange={e => setSourceId(e.target.value)}
                disabled={phase === 'searching' || phase === 'extracting' || phase === 'saving'}
              >
                <option value=''>All indexed books</option>
                {sources.map(src => (
                  <option key={src.id} value={src.id}>
                    {src.filename.replace(/\.pdf$/i, '')}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Search row */}
          <div style={s.searchRow}>
            <input
              ref={inputRef}
              style={s.searchInput}
              placeholder={`Enter ${CONTENT_TYPES[contentType].label} name…`}
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && phase === 'idle' && handleSearch()}
              disabled={phase === 'searching' || phase === 'extracting' || phase === 'saving'}
              autoFocus
            />
            <button
              style={(!nameInput.trim() || phase === 'searching' || phase === 'extracting') ? s.btnDisabled : s.btnSearch}
              onClick={handleSearch}
              disabled={!nameInput.trim() || phase === 'searching' || phase === 'extracting' || phase === 'saving'}
            >
              {phase === 'searching' ? 'Searching…' : phase === 'extracting' ? 'Extracting…' : 'Search & Extract'}
            </button>
          </div>

          {/* Progress indicator */}
          {(phase === 'searching' || phase === 'extracting') && (
            <div style={s.progressBox}>
              <span style={s.spinner}>⏳</span>
              <div style={s.progressText}>
                {phase === 'searching'
                  ? 'Searching your source books…'
                  : 'AI is extracting structured data…'}
              </div>
              <div style={s.progressSub}>
                {phase === 'searching'
                  ? 'Finding relevant passages via semantic search'
                  : 'This may take 10–30 seconds with local AI'}
              </div>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div style={s.errorBox}>
              <div style={s.errorTitle}>⚠ Extraction failed</div>
              <div style={s.errorMsg}>{error}</div>
              <button style={s.btnRetry} onClick={() => { setPhase('idle'); setError('') }}>
                Try Again
              </button>
            </div>
          )}

          {/* Preview */}
          {phase === 'preview' && extracted && (
            <div style={s.previewWrap}>
              <div style={s.previewHeader}>
                <span style={s.previewLabel}>Extracted — review before saving</span>
                <div style={s.nameEditRow}>
                  <label style={s.fieldLabel}>Name</label>
                  <input
                    style={s.nameInput}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="Name"
                  />
                </div>
              </div>

              <div style={s.previewBody}>
                {contentType === 'spell'     && <SpellPreview     data={extracted.data} />}
                {contentType === 'monster'   && <MonsterPreview   data={extracted.data} />}
                {contentType === 'equipment' && <EquipmentPreview data={extracted.data} />}
                {contentType === 'subclass'  && <SubclassPreview  data={extracted.data} />}
              </div>

              <div style={s.previewActions}>
                <button style={s.btnSave} onClick={handleSave}>
                  ✓ Add to Compendium
                </button>
                <button style={s.btnSecondary} onClick={handleSearchAnother}>
                  Search Another
                </button>
              </div>
            </div>
          )}

          {/* Saving */}
          {phase === 'saving' && (
            <div style={s.progressBox}>
              <span style={s.spinner}>💾</span>
              <div style={s.progressText}>Saving…</div>
            </div>
          )}

          {/* Done */}
          {phase === 'done' && (
            <div style={s.doneBox}>
              <div style={s.doneIcon}>✅</div>
              <div style={s.doneTitle}>
                "{editName || extracted?.name}" added to Compendium
              </div>
              {savedCount > 1 && (
                <div style={s.doneSub}>{savedCount} entries imported this session</div>
              )}
              <div style={s.doneActions}>
                <button style={s.btnSave} onClick={handleSearchAnother}>
                  Import Another
                </button>
                <button style={s.btnSecondary} onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Idle hint */}
          {phase === 'idle' && (
            <div style={s.hint}>
              <div style={s.hintIcon}>📚</div>
              <div style={s.hintText}>
                Type the name of a {CONTENT_TYPES[contentType].label.toLowerCase()} from one of your
                indexed source books. The AI will find the relevant passages and extract a
                structured entry ready to add to your Compendium.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Preview sub-components ────────────────────────────────────────────────────

function Field({ label, value, mono }) {
  if (!value && value !== 0 && value !== false) return null
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  return (
    <div style={pv.field}>
      <span style={pv.fieldLabel}>{label}</span>
      <span style={mono ? { ...pv.fieldValue, fontFamily: 'monospace' } : pv.fieldValue}>{display}</span>
    </div>
  )
}

function SpellPreview({ data }) {
  const components = [
    data.components_v && 'V',
    data.components_s && 'S',
    data.components_m && 'M',
  ].filter(Boolean).join(', ')

  return (
    <div style={pv.grid}>
      <Field label="Level"        value={SPELL_LEVELS[data.level] ?? data.level} />
      <Field label="School"       value={data.school} />
      <Field label="Casting Time" value={data.casting_time} />
      <Field label="Range"        value={data.range} />
      <Field label="Components"   value={components + (data.material ? ` (${data.material})` : '')} />
      <Field label="Duration"     value={data.duration} />
      <Field label="Concentration" value={data.concentration} />
      <Field label="Ritual"       value={data.ritual} />
      <Field label="Classes"      value={data.classes} />
      {data.description && (
        <div style={pv.fullField}>
          <div style={pv.fieldLabel}>Description</div>
          <div style={pv.longText}>{data.description}</div>
        </div>
      )}
      {data.higher_levels && (
        <div style={pv.fullField}>
          <div style={pv.fieldLabel}>At Higher Levels</div>
          <div style={pv.longText}>{data.higher_levels}</div>
        </div>
      )}
    </div>
  )
}

function MonsterPreview({ data }) {
  const mod = n => { const m = Math.floor((n - 10) / 2); return (m >= 0 ? '+' : '') + m }
  return (
    <div style={pv.grid}>
      <Field label="Size / Type"  value={`${data.size} ${data.type}`} />
      <Field label="Alignment"    value={data.alignment} />
      <Field label="CR"           value={`${data.cr} (${data.xp ?? CR_TO_XP[data.cr] ?? '?'} XP)`} />
      <Field label="AC"           value={data.armor_class} />
      <Field label="HP"           value={`${data.hit_points} (${data.hit_dice})`} />
      <Field label="Speed"        value={data.speed_walk} />
      <div style={pv.abilityRow}>
        {['str','dex','con','int','wis','cha'].map(a => (
          <div key={a} style={pv.abilityCell}>
            <div style={pv.abilityLabel}>{a.toUpperCase()}</div>
            <div style={pv.abilityScore}>{data[a]}</div>
            <div style={pv.abilityMod}>{mod(data[a])}</div>
          </div>
        ))}
      </div>
      <Field label="Senses"    value={data.senses} />
      <Field label="Languages" value={data.languages} />
      {data.damage_resistances  && <Field label="Resistances"  value={data.damage_resistances} />}
      {data.damage_immunities   && <Field label="Immunities"   value={data.damage_immunities} />}
      {data.condition_immunities && <Field label="Cond. Immune" value={data.condition_immunities} />}
      {data.special_abilities?.length > 0 && (
        <div style={pv.fullField}>
          <div style={pv.fieldLabel}>Special Abilities ({data.special_abilities.length})</div>
          {data.special_abilities.map((a, i) => (
            <div key={i} style={pv.actionItem}><strong>{a.name}.</strong> {a.description}</div>
          ))}
        </div>
      )}
      {data.actions?.length > 0 && (
        <div style={pv.fullField}>
          <div style={pv.fieldLabel}>Actions ({data.actions.length})</div>
          {data.actions.map((a, i) => (
            <div key={i} style={pv.actionItem}><strong>{a.name}.</strong> {a.description}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function EquipmentPreview({ data }) {
  return (
    <div style={pv.grid}>
      <Field label="Category"    value={data.category} />
      <Field label="Cost"        value={data.cost} />
      <Field label="Weight"      value={data.weight ? `${data.weight} lb.` : null} />
      {data.weapon_damage && <>
        <Field label="Damage"    value={data.weapon_damage} />
        <Field label="Type"      value={data.weapon_type} />
        <Field label="Properties" value={data.weapon_properties} />
      </>}
      {data.armor_base_ac > 0 && <>
        <Field label="Base AC"   value={data.armor_base_ac} />
        {data.armor_dex_cap != null && <Field label="DEX Cap" value={data.armor_dex_cap} />}
        {data.armor_min_str != null && <Field label="Min STR" value={data.armor_min_str} />}
        <Field label="Stealth Disadv." value={data.armor_stealth_disadvantage} />
      </>}
      {data.description && (
        <div style={pv.fullField}>
          <div style={pv.fieldLabel}>Description</div>
          <div style={pv.longText}>{data.description}</div>
        </div>
      )}
    </div>
  )
}

function SubclassPreview({ data }) {
  return (
    <div style={pv.grid}>
      <Field label="Base Class"    value={data.class_name} />
      <Field label="Unlocks at"    value={`Level ${data.unlock_level}`} />
      {data.description && (
        <div style={pv.fullField}>
          <div style={pv.fieldLabel}>Description</div>
          <div style={pv.longText}>{data.description}</div>
        </div>
      )}
      {data.features?.length > 0 && (
        <div style={pv.fullField}>
          <div style={pv.fieldLabel}>Features ({data.features.length})</div>
          {data.features.map((f, i) => (
            <div key={i} style={pv.featureItem}>
              <div style={pv.featureHeader}>
                <strong>{f.name}</strong>
                <span style={pv.featureLevel}>Level {f.level_gained}</span>
              </div>
              <div style={pv.featureDesc}>{f.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 300,
  },
  modal: {
    background: '#0d0a05',
    border: '1px solid #3a2a10',
    borderRadius: 8,
    width: 680,
    maxWidth: '95vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.75rem 1.25rem',
    borderBottom: '1px solid #2a1c08',
    flexShrink: 0,
  },
  headerTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '1rem' },
  closeBtn: { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '1rem', padding: 0 },

  typeTabs: { display: 'flex', borderBottom: '1px solid #2a1c08', flexShrink: 0 },
  typeTab: {
    flex: 1, padding: '0.5rem 0.25rem', background: 'transparent',
    border: 'none', borderBottom: '2px solid transparent',
    color: '#6b5a3a', cursor: 'pointer', fontSize: '0.8rem',
    transition: 'all 0.15s',
  },
  typeTabActive: { color: '#c9a84c', borderBottomColor: '#c9a84c', background: '#1a1208' },

  body: { flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 12 },

  sourceRow:    { display: 'flex', alignItems: 'center', gap: 8 },
  sourceLabel:  { color: '#6b5a3a', fontSize: '0.78rem', whiteSpace: 'nowrap' },
  sourceSelect: { flex: 1, background: '#1a1208', border: '1px solid #3a2a10', borderRadius: 4, color: '#a89060', padding: '0.3rem 0.5rem', fontSize: '0.8rem', outline: 'none' },
  searchRow: { display: 'flex', gap: 8 },
  searchInput: {
    flex: 1, padding: '0.45rem 0.75rem',
    background: '#1a1208', border: '1px solid #3a2a10',
    borderRadius: 4, color: '#e8e0d0', fontSize: '0.9rem', outline: 'none',
  },
  btnSearch: {
    padding: '0.45rem 1.1rem', background: '#c9a84c', border: 'none',
    borderRadius: 4, color: '#0d0a05', fontWeight: 700, cursor: 'pointer',
    fontSize: '0.85rem', whiteSpace: 'nowrap',
  },
  btnDisabled: {
    padding: '0.45rem 1.1rem', background: '#1a1208', border: '1px solid #333',
    borderRadius: 4, color: '#555', cursor: 'not-allowed', fontSize: '0.85rem', whiteSpace: 'nowrap',
  },

  progressBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 6, padding: '2rem 1rem', textAlign: 'center',
  },
  spinner: { fontSize: '2rem' },
  progressText: { color: '#c9a84c', fontSize: '0.95rem', fontWeight: 600 },
  progressSub:  { color: '#555', fontSize: '0.8rem' },

  errorBox: {
    background: '#2a0d0d', border: '1px solid #7a2a2a',
    borderRadius: 6, padding: '1rem', display: 'flex', flexDirection: 'column', gap: 8,
  },
  errorTitle: { color: '#c05050', fontWeight: 700, fontSize: '0.9rem' },
  errorMsg:   { color: '#a06060', fontSize: '0.85rem', lineHeight: 1.5 },
  btnRetry: {
    alignSelf: 'flex-start', padding: '0.35rem 0.9rem',
    background: 'transparent', border: '1px solid #7a2a2a',
    borderRadius: 4, color: '#c05050', cursor: 'pointer', fontSize: '0.82rem',
  },

  previewWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  previewHeader: {
    background: '#1a1208', border: '1px solid #3a2a10',
    borderRadius: 6, padding: '0.75rem 1rem', display: 'flex',
    flexDirection: 'column', gap: 8,
  },
  previewLabel: { color: '#a89060', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em' },
  nameEditRow: { display: 'flex', alignItems: 'center', gap: 8 },
  fieldLabel: { color: '#a89060', fontSize: '0.8rem', minWidth: 60, flexShrink: 0 },
  nameInput: {
    flex: 1, padding: '0.35rem 0.6rem',
    background: '#0d0a05', border: '1px solid #3a2a10',
    borderRadius: 4, color: '#e8e0d0', fontSize: '0.95rem', fontWeight: 700, outline: 'none',
  },
  previewBody: {
    background: '#0d0a05', border: '1px solid #2a1c08',
    borderRadius: 6, padding: '0.75rem 1rem',
    maxHeight: 320, overflowY: 'auto',
  },
  previewActions: { display: 'flex', gap: 8 },
  btnSave: {
    flex: 1, padding: '0.5rem', background: '#c9a84c', border: 'none',
    borderRadius: 4, color: '#0d0a05', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem',
  },
  btnSecondary: {
    padding: '0.5rem 1rem', background: 'transparent',
    border: '1px solid #3a2a10', borderRadius: 4,
    color: '#a89060', cursor: 'pointer', fontSize: '0.85rem',
  },

  doneBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 10, padding: '2rem 1rem', textAlign: 'center',
  },
  doneIcon:    { fontSize: '2.5rem' },
  doneTitle:   { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 600 },
  doneSub:     { color: '#6b5a3a', fontSize: '0.8rem' },
  doneActions: { display: 'flex', gap: 8, marginTop: 4 },

  hint: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 10, padding: '2rem 1.5rem', textAlign: 'center',
  },
  hintIcon: { fontSize: '2rem' },
  hintText: { color: '#6b5a3a', fontSize: '0.85rem', lineHeight: 1.7, maxWidth: 420 },
}

const pv = {
  grid:     { display: 'flex', flexDirection: 'column', gap: 6 },
  field:    { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.82rem' },
  fieldLabel: { color: '#a89060', minWidth: 120, flexShrink: 0, fontSize: '0.78rem', paddingTop: 1 },
  fieldValue: { color: '#c9c0a8', lineHeight: 1.4 },
  fullField:  { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 },
  longText:   { color: '#c9c0a8', fontSize: '0.8rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  actionItem: { color: '#c9c0a8', fontSize: '0.8rem', lineHeight: 1.5, padding: '4px 0', borderTop: '1px solid #1a1208', whiteSpace: 'pre-wrap' },
  abilityRow: { display: 'flex', gap: 6, margin: '4px 0' },
  abilityCell:  { flex: 1, background: '#1a1208', borderRadius: 4, padding: '4px 2px', textAlign: 'center' },
  abilityLabel: { color: '#a89060', fontSize: '0.65rem', fontWeight: 700 },
  abilityScore: { color: '#c9c0a8', fontSize: '0.85rem', fontWeight: 700 },
  abilityMod:   { color: '#c9a84c', fontSize: '0.7rem' },
  featureItem:  { padding: '6px 0', borderTop: '1px solid #1a1208' },
  featureHeader:{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  featureLevel: { color: '#a89060', fontSize: '0.75rem', background: '#1a1208', padding: '1px 6px', borderRadius: 3 },
  featureDesc:  { color: '#c9c0a8', fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
}
