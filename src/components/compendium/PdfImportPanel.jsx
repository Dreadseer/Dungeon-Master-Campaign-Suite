import { useState, useEffect, useRef } from 'react'
import useCampaignStore from '../../stores/campaignStore'

// ── Client-side type detection — mirrors PdfExtractionService.detectType ──────
function detectType(text) {
  const t = text.toLowerCase()
  const hasLevelOrCantrip = /\b(\d+)(?:st|nd|rd|th)[- ]level\b/.test(t) || /\bcantrip\b/.test(t)
  const hasSchool   = /\b(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)\b/.test(t)
  const hasCasting  = /casting time/i.test(t)
  const hasDuration = /\bduration\b/i.test(t)
  const hasComps    = /\bcomponents?\b/i.test(t)
  if ((hasLevelOrCantrip && hasSchool && hasCasting) || (hasCasting && hasDuration && hasComps)) return 'spell'
  if (/\b(common|uncommon|rare|very rare|legendary|artifact)\b/i.test(t)) return 'item'
  if (/\b(potion|ring|rod|wand|staff|wondrous item|attunement)\b/i.test(t)) return 'item'
  if (/\bmagic\b/.test(t) && /\b(weapon|armor|armour|shield)\b/.test(t)) return 'item'
  if ((/\b\d+d\d+\b/.test(t) || /\bhit dice\b|\bhit points\b/i.test(t)) &&
      (/\b\d+\s*(gp|sp|cp|pp|gold)\b/i.test(t) || /\b\d+\.?\d*\s*(lb|lbs|pound|pounds)\b/i.test(t))) return 'equipment'
  return 'unknown'
}

// ── Build structured data payload ─────────────────────────────────────────────
function buildCompendiumData(fields, type) {
  if (type === 'spell') return {
    level:        Number(fields.level ?? 0),
    school:       fields.school       ?? '',
    casting_time: fields.casting_time ?? '',
    range:        fields.range        ?? '',
    components:   fields.components   ?? '',
    duration:     fields.duration     ?? '',
    description:  fields.description  ?? '',
    source_book:  fields.source       ?? '',
    page:         fields.page         ?? null,
  }
  if (type === 'item') return {
    item_type:           fields.item_type          ?? '',
    rarity:              fields.rarity             ?? '',
    requires_attunement: fields.requires_attunement ?? false,
    cost:                fields.cost               ?? '',
    weight:              fields.weight             ?? '',
    description:         fields.description        ?? '',
    properties:          fields.properties         ?? '',
    source_book:         fields.source             ?? '',
    page:                fields.page               ?? null,
  }
  // equipment
  return {
    category:    fields.category ?? fields.item_type ?? '',
    cost:        fields.cost        ?? '',
    weight:      fields.weight      ?? '',
    damage:      fields.damage      ?? '',
    damage_type: fields.damage_type ?? '',
    properties:  fields.properties  ?? '',
    description: fields.description ?? '',
    source_book: fields.source      ?? '',
    page:        fields.page        ?? null,
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_ICONS  = { spell: '🔮', item: '💎', equipment: '🗡️', unknown: '❓' }
const TYPE_COLORS = {
  spell:     { bg: '#1a1a3a', border: '#3a3a7a', text: '#7a7ada' },
  item:      { bg: '#1a3a1a', border: '#3a6a3a', text: '#7aba7a' },
  equipment: { bg: '#2a1a08', border: '#5a3a10', text: '#ba8a4a' },
  unknown:   { bg: '#2a2a2a', border: '#4a4a4a', text: '#8a8a8a' },
}
const SCHOOLS    = ['Abjuration','Conjuration','Divination','Enchantment','Evocation','Illusion','Necromancy','Transmutation','Other']
const ITEM_TYPES = ['Weapon','Armor','Potion','Ring','Rod','Scroll','Staff','Wand','Wondrous Item','Gear','Other']
const RARITIES   = ['Common','Uncommon','Rare','Very Rare','Legendary','Artifact']
const CATEGORIES = ['Weapon','Armor','Adventuring Gear','Tool','Mount','Vehicle','Trade Good','Other']
const TYPE_PLURAL = { spell: 'Spells', item: 'Items', equipment: 'Equipment' }

// ── Component ─────────────────────────────────────────────────────────────────
export default function PdfImportPanel({ campaignId: campaignIdProp, onImportComplete, onClose, initialQuery = '' }) {
  const activeCampaign = useCampaignStore(st => st.activeCampaign)
  const campaignId = campaignIdProp ?? activeCampaign?.id

  const [view, setView] = useState(1)  // 1 | 2 | 3 | 'success'

  // Sources
  const [sources,        setSources]        = useState([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [sourceFilter,   setSourceFilter]   = useState('all')

  // View 1 — Search
  const [searchQuery,  setSearchQuery]  = useState(initialQuery)
  const [searchMode,   setSearchMode]   = useState('keyword')
  const [results,      setResults]      = useState([])
  const [searching,    setSearching]    = useState(false)
  const [loadingChunk, setLoadingChunk] = useState(false)
  const debounceRef = useRef(null)

  // View 2 — Preview & Edit
  const [selectedChunk, setSelectedChunk] = useState(null)
  const [rawText,        setRawText]       = useState('')
  const [entryType,      setEntryType]     = useState('spell')
  const [fields,         setFields]        = useState({})
  const [loadingAI,      setLoadingAI]     = useState(false)

  // View 3 / success
  const [importing,     setImporting]     = useState(false)
  const [importedName,  setImportedName]  = useState('')
  const [importedType,  setImportedType]  = useState('')

  // ── Load sources ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!campaignId) { setLoadingSources(false); return }
    window.electronAPI.db.pdf.getAll(campaignId)
      .then(all => {
        setSources(all.filter(s => ['indexed','embedded'].includes(s.status)))
      })
      .catch(() => {})
      .finally(() => setLoadingSources(false))
  }, [campaignId])

  // Auto-search if initialQuery is provided
  useEffect(() => {
    if (initialQuery) runSearch(initialQuery)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim()) { setResults([]); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(searchQuery), 400)
    return () => clearTimeout(debounceRef.current)
  }, [searchQuery, searchMode, sourceFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runSearch(query) {
    if (!query?.trim() || !campaignId) return
    setSearching(true)
    try {
      let raw = []
      if (searchMode === 'keyword') {
        raw = await window.electronAPI.db.pdf.searchChunks(campaignId, query, 20)
      } else {
        raw = await window.electronAPI.pdf.semanticSearch(campaignId, query, 10)
      }
      // Optional source filter
      if (sourceFilter !== 'all') {
        const sid = parseInt(sourceFilter, 10)
        raw = raw.filter(r => r.source_id === sid)
      }
      setResults((raw ?? []).map(r => ({ ...r, _type: detectType(r.text) })))
    } catch (err) {
      console.error('[PdfImportPanel] Search error:', err)
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  // ── Extract chunk and go to view ───────────────────────────────────────────
  async function loadChunkAndGo(chunk, targetView) {
    setLoadingChunk(true)
    setSelectedChunk(chunk)
    setRawText(chunk.text)
    try {
      const extracted = await window.electronAPI.pdf.extractChunk(chunk.id, false)
      if (extracted && !extracted.error) {
        const t = extracted._type && extracted._type !== 'unknown' ? extracted._type : (chunk._type !== 'unknown' ? chunk._type : 'spell')
        setEntryType(t)
        setFields({ ...extracted })
      } else {
        setEntryType(chunk._type !== 'unknown' ? chunk._type : 'spell')
        setFields({ name: '', source: chunk.filename ?? '', page: chunk.page_number ?? null })
      }
    } catch {
      setEntryType(chunk._type !== 'unknown' ? chunk._type : 'spell')
      setFields({ name: '', source: chunk.filename ?? '', page: chunk.page_number ?? null })
    } finally {
      setLoadingChunk(false)
    }
    setView(targetView)
  }

  // ── AI re-extraction ───────────────────────────────────────────────────────
  async function handleExtractWithAI() {
    if (!selectedChunk) return
    setLoadingAI(true)
    try {
      const extracted = await window.electronAPI.pdf.extractChunk(selectedChunk.id, true)
      if (extracted && !extracted.error) {
        const t = extracted._type && extracted._type !== 'unknown' ? extracted._type : entryType
        setEntryType(t)
        setFields(prev => ({ ...prev, ...extracted }))
      }
    } catch { /* no-op */ } finally {
      setLoadingAI(false)
    }
  }

  // ── Get adjacent context ───────────────────────────────────────────────────
  async function handleGetContext() {
    if (!selectedChunk || selectedChunk.chunk_index == null) return
    try {
      const ctx = await window.electronAPI.db.pdf.getChunkContext(
        selectedChunk.source_id, selectedChunk.chunk_index, 1
      )
      if (ctx?.length) {
        setRawText(ctx.map(c => c.text).join('\n\n--- (adjacent chunk) ---\n\n'))
      }
    } catch { /* no-op */ }
  }

  // ── Field helpers ──────────────────────────────────────────────────────────
  function setField(key, value) {
    setFields(prev => ({ ...prev, [key]: value }))
  }

  // ── Import ─────────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!campaignId) return
    setImporting(true)
    try {
      const data = buildCompendiumData(fields, entryType)
      await window.electronAPI.db.compendium.create({
        campaign_id: campaignId,
        type:        entryType,
        name:        fields.name || 'Unnamed',
        data,
        source:      'pdf_upload',
      })
      setImportedName(fields.name || 'Unnamed')
      setImportedType(entryType)
      setView('success')
    } catch (err) {
      console.error('[PdfImportPanel] Import failed:', err)
    } finally {
      setImporting(false)
    }
  }

  // ── Reset for another import ───────────────────────────────────────────────
  function resetPanel() {
    setView(1)
    setSelectedChunk(null)
    setRawText('')
    setFields({})
    if (searchQuery.trim()) {
      setTimeout(() => runSearch(searchQuery), 50)
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function TypeBadge({ type, small }) {
    const tc = TYPE_COLORS[type] ?? TYPE_COLORS.unknown
    return (
      <span style={{
        background: tc.bg, border: `1px solid ${tc.border}`, color: tc.text,
        fontSize: small ? '0.62rem' : '0.72rem', padding: small ? '0.05rem 0.3rem' : '0.1rem 0.4rem',
        borderRadius: 10, fontWeight: 600, flexShrink: 0,
      }}>
        {TYPE_ICONS[type] ?? '?'} {type === 'unknown' ? 'Unknown' : (type?.charAt(0).toUpperCase() + type?.slice(1))}
      </span>
    )
  }

  // ── View 1: Search & Browse ────────────────────────────────────────────────
  function renderView1() {
    const noSources = !loadingSources && sources.length === 0
    return (
      <div style={s.viewBody}>
        {/* Source filter */}
        {sources.length > 1 && (
          <div style={s.sourceRow}>
            <label style={s.label}>PDF Source</label>
            <select style={s.select} value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
              <option value="all">All PDFs</option>
              {sources.map(src => (
                <option key={src.id} value={src.id}>{src.filename}</option>
              ))}
            </select>
          </div>
        )}

        {noSources ? (
          <div style={s.warn}>
            ⚠ No indexed PDF sources found. Upload and embed a PDF from the AI Assistant page first.
          </div>
        ) : (
          <>
            {/* Mode toggle */}
            <div style={s.modeRow}>
              {['keyword','semantic'].map(mode => (
                <button key={mode}
                  style={searchMode === mode ? { ...s.modeBtn, ...s.modeBtnActive } : s.modeBtn}
                  onClick={() => setSearchMode(mode)}>
                  {mode === 'keyword' ? '🔤 Keyword' : '🧠 Semantic'}
                </button>
              ))}
            </div>

            {/* Search input */}
            <input
              style={s.searchInput}
              placeholder={searchMode === 'keyword' ? 'Search for a spell or item…' : 'Describe what you are looking for…'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />

            {searchMode === 'semantic' && (
              <p style={s.hint}>Semantic search uses your embedded chunks. Switch to Keyword if you get no results.</p>
            )}

            {/* Results */}
            <div style={s.resultsList}>
              {searching || loadingChunk ? (
                <p style={s.msg}>{loadingChunk ? 'Extracting…' : 'Searching…'}</p>
              ) : results.length === 0 && searchQuery.trim() ? (
                <p style={s.msg}>No results found.</p>
              ) : results.length === 0 ? (
                <p style={s.msg}>Type to search your PDFs.</p>
              ) : results.map((chunk, i) => {
                const isUnknown = chunk._type === 'unknown'
                return (
                  <div key={chunk.id ?? i} style={s.resultRow}>
                    <div style={s.resultMeta}>
                      <span style={s.sourcePill}>{chunk.filename ?? 'Unknown PDF'}</span>
                      {chunk.page_number && <span style={s.pagePill}>p.{chunk.page_number}</span>}
                      <TypeBadge type={chunk._type} small />
                      {chunk._score != null && (
                        <div style={s.scoreBar} title={`Relevance: ${Math.round(chunk._score * 100)}%`}>
                          <div style={{ ...s.scoreBarFill, width: `${Math.round(chunk._score * 100)}%` }} />
                        </div>
                      )}
                    </div>
                    <p style={s.resultText}>{chunk.text?.slice(0, 120)}{chunk.text?.length > 120 ? '…' : ''}</p>
                    <div style={s.resultActions}>
                      <button style={s.previewBtn} onClick={() => loadChunkAndGo(chunk, 2)} disabled={loadingChunk}>
                        🔍 Preview
                      </button>
                      {!isUnknown && (
                        <button style={s.quickAddBtn} onClick={() => loadChunkAndGo(chunk, 3)} disabled={loadingChunk}>
                          ⚡ Quick Add
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  // ── View 2: Chunk Preview & Edit ───────────────────────────────────────────
  function renderView2() {
    const canGetContext = selectedChunk?.chunk_index != null
    const sourceLabel   = `${selectedChunk?.filename ?? 'Unknown'}${selectedChunk?.page_number ? ', p.' + selectedChunk.page_number : ''}`
    return (
      <div style={{ ...s.viewBody, flexDirection: 'column', gap: '0.75rem' }}>
        <div style={s.twoCol}>
          {/* Left: raw text */}
          <div style={s.rawCol}>
            <div style={s.colHeader}>
              <span style={s.colTitle}>Raw Text</span>
              <span style={s.colSub}>{sourceLabel}</span>
            </div>
            <pre style={s.rawPre}>{rawText || '(no text)'}</pre>
            <div style={s.rawActions}>
              <button style={s.ctxBtn}
                onClick={handleGetContext}
                disabled={!canGetContext}
                title={canGetContext ? 'Load adjacent chunks' : 'Context not available for semantic results'}>
                ↕ Adjacent Context
              </button>
              <button style={loadingAI ? { ...s.aiBtn, opacity: 0.6 } : s.aiBtn}
                onClick={handleExtractWithAI}
                disabled={loadingAI}>
                {loadingAI ? 'Extracting…' : '✨ Extract with AI'}
              </button>
            </div>
          </div>

          {/* Right: extracted fields */}
          <div style={s.editCol}>
            <div style={s.colHeader}>
              <span style={s.colTitle}>Extracted Data</span>
              <TypeBadge type={entryType} />
            </div>

            {/* Type override */}
            <div style={s.fieldRow}>
              <label style={s.label}>Type Override</label>
              <select style={s.select} value={entryType} onChange={e => setEntryType(e.target.value)}>
                <option value="spell">Spell</option>
                <option value="item">Item</option>
                <option value="equipment">Equipment</option>
              </select>
            </div>

            {entryType === 'spell'     && renderSpellFields()}
            {entryType === 'item'      && renderItemFields()}
            {entryType === 'equipment' && renderEquipmentFields()}
          </div>
        </div>

        <div style={s.navRow}>
          <button style={s.backBtn} onClick={() => setView(1)}>← Back to Search</button>
          <button style={s.nextBtn} onClick={() => setView(3)}>Import to Compendium →</button>
        </div>
      </div>
    )
  }

  // ── Field sets ─────────────────────────────────────────────────────────────
  function renderSpellFields() {
    return (
      <>
        <Field label="Name"><input style={s.input} value={fields.name ?? ''} onChange={e => setField('name', e.target.value)} /></Field>
        <Field label="Level (0 = Cantrip)"><input style={s.input} type="number" min="0" max="9" value={fields.level ?? 0} onChange={e => setField('level', Number(e.target.value))} /></Field>
        <Field label="School">
          <select style={s.select} value={fields.school ?? ''} onChange={e => setField('school', e.target.value)}>
            <option value="">— Select —</option>
            {SCHOOLS.map(sc => <option key={sc} value={sc}>{sc}</option>)}
          </select>
        </Field>
        <Field label="Casting Time"><input style={s.input} value={fields.casting_time ?? ''} onChange={e => setField('casting_time', e.target.value)} /></Field>
        <Field label="Range"><input style={s.input} value={fields.range ?? ''} onChange={e => setField('range', e.target.value)} /></Field>
        <Field label="Components"><input style={s.input} value={fields.components ?? ''} onChange={e => setField('components', e.target.value)} /></Field>
        <Field label="Duration"><input style={s.input} value={fields.duration ?? ''} onChange={e => setField('duration', e.target.value)} /></Field>
        <Field label="Description"><textarea style={{ ...s.input, ...s.textarea, height: 90 }} value={fields.description ?? ''} onChange={e => setField('description', e.target.value)} /></Field>
        <Field label="Source Book"><input style={s.input} value={fields.source ?? ''} onChange={e => setField('source', e.target.value)} /></Field>
        <Field label="Page"><input style={s.input} type="number" value={fields.page ?? ''} onChange={e => setField('page', e.target.value ? Number(e.target.value) : null)} /></Field>
      </>
    )
  }

  function renderItemFields() {
    return (
      <>
        <Field label="Name"><input style={s.input} value={fields.name ?? ''} onChange={e => setField('name', e.target.value)} /></Field>
        <Field label="Item Type">
          <select style={s.select} value={fields.item_type ?? ''} onChange={e => setField('item_type', e.target.value)}>
            <option value="">— Select —</option>
            {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Rarity">
          <select style={s.select} value={fields.rarity ?? ''} onChange={e => setField('rarity', e.target.value)}>
            <option value="">— Select —</option>
            {RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Requires Attunement">
          <input type="checkbox" checked={!!fields.requires_attunement} onChange={e => setField('requires_attunement', e.target.checked)}
            style={{ accentColor: '#c9a84c', width: 16, height: 16, cursor: 'pointer' }} />
        </Field>
        <Field label="Cost"><input style={s.input} value={fields.cost ?? ''} onChange={e => setField('cost', e.target.value)} /></Field>
        <Field label="Weight"><input style={s.input} value={fields.weight ?? ''} onChange={e => setField('weight', e.target.value)} /></Field>
        <Field label="Description"><textarea style={{ ...s.input, ...s.textarea, height: 90 }} value={fields.description ?? ''} onChange={e => setField('description', e.target.value)} /></Field>
        <Field label="Properties"><textarea style={{ ...s.input, ...s.textarea, height: 55 }} value={fields.properties ?? ''} onChange={e => setField('properties', e.target.value)} /></Field>
        <Field label="Source Book"><input style={s.input} value={fields.source ?? ''} onChange={e => setField('source', e.target.value)} /></Field>
        <Field label="Page"><input style={s.input} type="number" value={fields.page ?? ''} onChange={e => setField('page', e.target.value ? Number(e.target.value) : null)} /></Field>
      </>
    )
  }

  function renderEquipmentFields() {
    return (
      <>
        <Field label="Name"><input style={s.input} value={fields.name ?? ''} onChange={e => setField('name', e.target.value)} /></Field>
        <Field label="Category">
          <select style={s.select} value={fields.category ?? ''} onChange={e => setField('category', e.target.value)}>
            <option value="">— Select —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Cost"><input style={s.input} value={fields.cost ?? ''} onChange={e => setField('cost', e.target.value)} /></Field>
        <Field label="Weight"><input style={s.input} value={fields.weight ?? ''} onChange={e => setField('weight', e.target.value)} /></Field>
        <Field label="Damage"><input style={s.input} placeholder="e.g. 1d8" value={fields.damage ?? ''} onChange={e => setField('damage', e.target.value)} /></Field>
        <Field label="Damage Type"><input style={s.input} placeholder="e.g. slashing" value={fields.damage_type ?? ''} onChange={e => setField('damage_type', e.target.value)} /></Field>
        <Field label="Properties"><input style={s.input} value={fields.properties ?? ''} onChange={e => setField('properties', e.target.value)} /></Field>
        <Field label="Description"><textarea style={{ ...s.input, ...s.textarea, height: 70 }} value={fields.description ?? ''} onChange={e => setField('description', e.target.value)} /></Field>
        <Field label="Source Book"><input style={s.input} value={fields.source ?? ''} onChange={e => setField('source', e.target.value)} /></Field>
        <Field label="Page"><input style={s.input} type="number" value={fields.page ?? ''} onChange={e => setField('page', e.target.value ? Number(e.target.value) : null)} /></Field>
      </>
    )
  }

  // ── View 3: Confirm & Import ───────────────────────────────────────────────
  function renderView3() {
    const tc        = TYPE_COLORS[entryType] ?? TYPE_COLORS.spell
    const data      = buildCompendiumData(fields, entryType)
    const populated = Object.entries(data).filter(([, v]) => v !== null && v !== '' && v !== false)

    return (
      <div style={{ ...s.viewBody }}>
        {/* Entry heading */}
        <div style={{ ...s.confirmHeader, borderColor: tc.border }}>
          <TypeBadge type={entryType} />
          <h2 style={{ ...s.confirmName, color: tc.text }}>{fields.name || 'Unnamed'}</h2>
        </div>

        {/* Campaign */}
        <div style={s.confirmMeta}>
          <span style={s.confirmLabel}>Campaign</span>
          <span style={s.confirmValue}>{activeCampaign?.name ?? 'Unknown'}</span>
        </div>

        {/* All populated fields */}
        <div style={s.confirmFields}>
          {populated.map(([key, value]) => (
            key !== 'description' ? (
              <div key={key} style={s.confirmRow}>
                <span style={s.confirmLabel}>{humanLabel(key)}</span>
                <span style={s.confirmValue}>{String(value)}</span>
              </div>
            ) : (
              <div key="description" style={s.confirmDescBlock}>
                <span style={s.confirmLabel}>Description</span>
                <p style={s.confirmDesc}>{value}</p>
              </div>
            )
          ))}
        </div>

        {/* Source attribution */}
        {(fields.source || fields.page) && (
          <div style={s.sourceAttribution}>
            📄 Source: <strong style={{ color: '#c9a84c' }}>{fields.source ?? 'Unknown'}</strong>
            {fields.page && <>, page {fields.page}</>}
          </div>
        )}

        <div style={s.navRow}>
          <button style={s.backBtn} onClick={() => setView(2)}>← Edit</button>
          <button style={s.cancelBtn} onClick={() => setView(1)}>Cancel</button>
          <button style={importing ? { ...s.importBtn, opacity: 0.7 } : s.importBtn}
            onClick={handleImport} disabled={importing}>
            {importing ? 'Importing…' : '✓ Import'}
          </button>
        </div>
      </div>
    )
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  function renderSuccess() {
    return (
      <div style={s.successView}>
        <div style={s.successCheck}>✓</div>
        <p style={s.successMsg}>
          <strong style={{ color: '#c9a84c' }}>{importedName}</strong>{' '}
          added to your <strong style={{ color: '#c9a84c' }}>{TYPE_PLURAL[importedType] ?? importedType}</strong> compendium.
        </p>
        <div style={s.successBtns}>
          <button style={s.successViewBtn} onClick={() => { onImportComplete?.() }}>
            View in Compendium
          </button>
          <button style={s.successAnotherBtn} onClick={resetPanel}>
            Import Another
          </button>
          <button style={s.cancelBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  // ── Panel render ───────────────────────────────────────────────────────────
  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.panel}>

        {/* Header */}
        <div style={s.panelHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={s.panelTitle}>📄 Import from PDF</span>
            {view === 2 && <span style={s.viewPill}>Preview &amp; Edit</span>}
            {view === 3 && <span style={s.viewPill}>Confirm</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {view > 1 && view !== 'success' && (
              <div style={s.stepIndicator}>
                {[1,2,3].map(n => (
                  <span key={n} style={n === view ? { ...s.step, ...s.stepActive } : n < view ? { ...s.step, ...s.stepDone } : s.step}>
                    {n}
                  </span>
                ))}
              </div>
            )}
            <button style={s.closeBtn} onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={s.panelBody}>
          {loadingSources && view === 1 ? (
            <p style={s.msg}>Loading sources…</p>
          ) : (
            <>
              {view === 1        && renderView1()}
              {view === 2        && renderView2()}
              {view === 3        && renderView3()}
              {view === 'success' && renderSuccess()}
            </>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '0.4rem' }}>
      <label style={{ display: 'block', color: '#6b5a3a', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function humanLabel(key) {
  const map = {
    source_book: 'Source', item_type: 'Item Type', casting_time: 'Casting Time',
    damage_type: 'Damage Type', requires_attunement: 'Attunement', source: 'Source Book',
  }
  return map[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' },
  panel:    { position: 'relative', width: 560, height: '100%', background: '#0d0a05', borderLeft: '1px solid #2a1c08', display: 'flex', flexDirection: 'column', overflow: 'hidden' },

  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid #2a1c08', flexShrink: 0, background: '#0a0805' },
  panelTitle:  { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 600 },
  viewPill:    { background: '#1a2a10', border: '1px solid #3a5a1a', color: '#8aba6a', fontSize: '0.68rem', padding: '0.1rem 0.45rem', borderRadius: 10 },
  closeBtn:    { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '1rem', padding: '0.1rem 0.3rem', lineHeight: 1 },

  stepIndicator: { display: 'flex', gap: '0.3rem', alignItems: 'center' },
  step:     { width: 22, height: 22, borderRadius: '50%', background: '#1a1208', border: '1px solid #3a2a10', color: '#6b5a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700 },
  stepActive: { background: '#2a1a08', border: '1px solid #c9a84c', color: '#c9a84c' },
  stepDone:   { background: '#1a3a1a', border: '1px solid #3a6a3a', color: '#7aba7a' },

  panelBody: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  viewBody:  { flex: 1, display: 'flex', flexDirection: 'column', padding: '0.85rem 1rem', gap: '0.6rem' },

  msg:  { color: '#6b5a3a', fontSize: '0.85rem', textAlign: 'center', padding: '2.5rem', flex: 1 },
  hint: { color: '#6b5a3a', fontSize: '0.72rem', fontStyle: 'italic', margin: 0 },
  warn: { background: '#1a0e00', border: '1px solid #5a3a10', color: '#c9a84c', borderRadius: 4, padding: '0.65rem 0.85rem', fontSize: '0.83rem', lineHeight: 1.5 },

  sourceRow:  { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  modeRow:    { display: 'flex', gap: '0.35rem' },
  modeBtn:    { background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 4, padding: '0.28rem 0.7rem', cursor: 'pointer', fontSize: '0.8rem' },
  modeBtnActive: { background: '#1a1208', border: '1px solid #3a2a10', color: '#c9a84c' },

  searchInput: { background: '#0a0805', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.87rem', outline: 'none', width: '100%', boxSizing: 'border-box' },

  resultsList: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  resultRow:   { background: '#0d0a05', border: '1px solid #2a1c08', borderRadius: 5, padding: '0.55rem 0.7rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  resultMeta:  { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' },
  sourcePill:  { background: '#0d1a2a', border: '1px solid #1a3a5a', color: '#4a90d9', fontSize: '0.65rem', padding: '0.06rem 0.35rem', borderRadius: 10 },
  pagePill:    { color: '#6b5a3a', fontSize: '0.68rem' },
  scoreBar:    { flex: 1, maxWidth: 60, height: 4, background: '#2a1c08', borderRadius: 2, overflow: 'hidden', alignSelf: 'center' },
  scoreBarFill:{ height: '100%', background: '#4A90D9', borderRadius: 2 },
  resultText:  { color: '#a89060', fontSize: '0.77rem', lineHeight: 1.45, margin: 0, fontFamily: 'monospace' },
  resultActions: { display: 'flex', gap: '0.4rem', marginTop: '0.15rem' },
  previewBtn:  { background: '#0d1a3a', border: '1px solid #1a3a7a', color: '#4a90d9', borderRadius: 3, padding: '0.22rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' },
  quickAddBtn: { background: '#1a2a0d', border: '1px solid #3a5a1a', color: '#7aba5a', borderRadius: 3, padding: '0.22rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' },

  // View 2
  twoCol: { display: 'flex', gap: '0.75rem', flex: 1, minHeight: 0, overflow: 'hidden' },
  rawCol:  { flex: '0 0 48%', display: 'flex', flexDirection: 'column', gap: '0.35rem', overflow: 'hidden' },
  editCol: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem', overflowY: 'auto' },
  colHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexShrink: 0 },
  colTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.82rem', fontWeight: 600 },
  colSub:   { color: '#6b5a3a', fontSize: '0.67rem', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rawPre:   { flex: 1, background: '#050403', border: '1px solid #1a1208', borderRadius: 4, padding: '0.5rem', color: '#a89060', fontSize: '0.72rem', lineHeight: 1.5, fontFamily: 'monospace', overflowY: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  rawActions:{ display: 'flex', gap: '0.35rem', flexShrink: 0 },
  ctxBtn:   { background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.22rem 0.5rem', cursor: 'pointer', fontSize: '0.72rem', flex: 1 },
  aiBtn:    { background: '#1a1a2a', border: '1px solid #3a3a7a', color: '#7a7ada', borderRadius: 3, padding: '0.22rem 0.5rem', cursor: 'pointer', fontSize: '0.72rem', flex: 1 },
  fieldRow: { display: 'flex', flexDirection: 'column', marginBottom: '0.4rem' },

  label:    { color: '#6b5a3a', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' },
  input:    { background: '#050403', border: '1px solid #2a1c08', borderRadius: 3, color: '#e8e0d0', padding: '0.28rem 0.45rem', fontSize: '0.8rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  select:   { background: '#050403', border: '1px solid #2a1c08', borderRadius: 3, color: '#e8e0d0', padding: '0.28rem 0.45rem', fontSize: '0.8rem', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea: { resize: 'vertical', lineHeight: 1.45 },

  navRow:   { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexShrink: 0, paddingTop: '0.5rem', borderTop: '1px solid #1a1208' },
  backBtn:  { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem' },
  nextBtn:  { background: '#2a1a08', border: '1px solid #c9a84c', color: '#c9a84c', borderRadius: 3, padding: '0.35rem 0.9rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 },
  cancelBtn:{ background: 'transparent', border: '1px solid #2a1c08', color: '#6b5a3a', borderRadius: 3, padding: '0.35rem 0.75rem', cursor: 'pointer', fontSize: '0.82rem' },
  importBtn:{ background: '#1a3a1a', border: '1px solid #4a8a4a', color: '#8ada7a', borderRadius: 3, padding: '0.35rem 1.1rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700 },

  // View 3
  confirmHeader: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0', borderBottom: '1px solid', marginBottom: '0.5rem' },
  confirmName:   { fontFamily: 'Georgia, serif', fontSize: '1.3rem', fontWeight: 600, margin: 0 },
  confirmMeta:   { display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.3rem' },
  confirmFields: { background: '#050403', border: '1px solid #1a1208', borderRadius: 4, padding: '0.5rem 0.7rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem' },
  confirmRow:    { display: 'flex', gap: '0.5rem', fontSize: '0.8rem' },
  confirmLabel:  { color: '#6b5a3a', fontSize: '0.72rem', minWidth: 100, flexShrink: 0 },
  confirmValue:  { color: '#e8e0d0', fontSize: '0.8rem' },
  confirmDescBlock: { marginTop: '0.25rem' },
  confirmDesc:   { color: '#a89060', fontSize: '0.77rem', lineHeight: 1.5, margin: '0.2rem 0 0', whiteSpace: 'pre-wrap' },
  sourceAttribution: { color: '#6b5a3a', fontSize: '0.77rem', padding: '0.4rem 0.6rem', background: '#0a0d1a', border: '1px solid #1a2a4a', borderRadius: 4, marginBottom: '0.5rem' },

  // Success
  successView:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.5rem', gap: '1rem' },
  successCheck:   { fontSize: '2.5rem', color: '#7aba7a', lineHeight: 1 },
  successMsg:     { color: '#e8e0d0', fontSize: '0.95rem', textAlign: 'center', lineHeight: 1.6, margin: 0 },
  successBtns:    { display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', maxWidth: 280 },
  successViewBtn: { background: '#1a1208', border: '1px solid #c9a84c', color: '#c9a84c', borderRadius: 4, padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.87rem', fontWeight: 600, textAlign: 'center' },
  successAnotherBtn: { background: '#0d1a3a', border: '1px solid #1a3a7a', color: '#4a90d9', borderRadius: 4, padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.87rem', textAlign: 'center' },
}
