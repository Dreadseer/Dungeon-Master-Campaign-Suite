import { useState, useCallback, useEffect, useRef } from 'react'
import useCampaignStore from '../../stores/campaignStore'
import {
  CONTENT_TYPES,
  buildExtractionPrompt,
  parseExtraction,
  extractionMaxTokens,
} from '../../utils/compendiumExtractor'

const TYPE_ANCHORS = {
  monster:   'armor',
  spell:     'casting',
  equipment: 'cost',
  subclass:  'level',
}

// Subclasses and monsters can span several pages (multiple features/actions),
// so pull more chunks for them to avoid missing later sections.
const SEARCH_CHUNK_K_BY_TYPE = { subclass: 14, monster: 12 }

export default function BulkImportModal({ initialType = 'monster', onClose, onImported }) {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [contentType,   setContentType]   = useState(initialType)
  const [sources,       setSources]       = useState([])
  const [sourceId,      setSourceId]      = useState('')
  const [phase,         setPhase]         = useState('idle')   // idle|scanning|review|importing|results
  const [scanError,     setScanError]     = useState('')
  const [discovered,    setDiscovered]    = useState([])       // string[]
  const [checked,       setChecked]       = useState(new Set())
  const [existingNames, setExistingNames] = useState(new Set()) // lowercased names already saved
  const [progress,      setProgress]      = useState({ current: 0, total: 0, name: '' })
  const [results,       setResults]       = useState({ succeeded: [], failed: [] })
  const [copied,        setCopied]        = useState(false)

  const abortRef = useRef(false)

  // Load indexed source books
  useEffect(() => {
    if (!activeCampaign?.id) return
    window.electronAPI.db.pdf.getAll(activeCampaign.id)
      .then(rows => {
        const indexed = rows.filter(r => r.status === 'indexed' || r.status === 'embedded')
        setSources(indexed)
        if (indexed.length === 1) setSourceId(String(indexed[0].id))
      })
      .catch(() => {})
  }, [activeCampaign?.id])

  // Load existing compendium names for the active type so we can mark duplicates
  useEffect(() => {
    if (!activeCampaign?.id) return
    window.electronAPI.db.compendium.getAll(activeCampaign.id, contentType)
      .then(rows => setExistingNames(new Set(rows.map(r => r.name.toLowerCase()))))
      .catch(() => {})
  }, [activeCampaign?.id, contentType])

  // ── Scan ─────────────────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    if (!sourceId) return
    setScanError('')
    setPhase('scanning')
    try {
      const names = await window.electronAPI.embed.scanSource(Number(sourceId), contentType)
      if (!names || names.length === 0) {
        setScanError(
          `No ${CONTENT_TYPES[contentType].label} entries found. ` +
          `Make sure the correct book is selected and fully indexed.`
        )
        setPhase('idle')
        return
      }
      setDiscovered(names)
      // Auto-check everything that isn't already in the compendium
      setChecked(new Set(names.filter(n => !existingNames.has(n.toLowerCase()))))
      setPhase('review')
    } catch (err) {
      setScanError(err.message ?? 'Scan failed')
      setPhase('idle')
    }
  }, [sourceId, contentType, existingNames])

  // ── Import loop ───────────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    const selected = discovered.filter(n => checked.has(n))
    if (!selected.length || !activeCampaign?.id) return

    abortRef.current = false
    setPhase('importing')
    setProgress({ current: 0, total: selected.length, name: '' })

    const succeeded = []
    const failed    = []

    for (let i = 0; i < selected.length; i++) {
      if (abortRef.current) break
      const name = selected[i]
      setProgress({ current: i + 1, total: selected.length, name })

      try {
        const anchor      = TYPE_ANCHORS[contentType] ?? ''
        const itemKeys    = anchor ? `${name} ${anchor}` : name
        const searchQuery = `${name} ${CONTENT_TYPES[contentType].searchHint}`

        const chunkK = SEARCH_CHUNK_K_BY_TYPE[contentType] ?? 8
        const chunks = await window.electronAPI.embed.search(
          searchQuery, chunkK, itemKeys, Number(sourceId)
        )
        if (!chunks?.length) throw new Error('No passages found')

        const relevant = chunks.filter(c => c.score > 0)
        if (!relevant.length) throw new Error('No relevant passages')

        const { system, user } = buildExtractionPrompt(contentType, name, relevant)
        const rawResult        = await window.electronAPI.ai.complete(system, user, { maxTokens: extractionMaxTokens(contentType) })
        const data             = parseExtraction(contentType, rawResult)

        await window.electronAPI.db.compendium.create({
          campaign_id: activeCampaign.id,
          type:        contentType,
          name:        data.name || name,
          data,
          source:      'source_book',
        })

        succeeded.push(name)
      } catch {
        failed.push(name)
      }
    }

    setResults({ succeeded, failed })
    setPhase('results')
    if (succeeded.length > 0) onImported?.()
  }, [discovered, checked, contentType, sourceId, activeCampaign?.id, onImported])

  // ── Checklist helpers ─────────────────────────────────────────────────────────

  const toggleCheck  = name => setChecked(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s })
  const selectAll    = ()   => setChecked(new Set(discovered))
  const selectNew    = ()   => setChecked(new Set(discovered.filter(n => !existingNames.has(n.toLowerCase()))))
  const deselectAll  = ()   => setChecked(new Set())
  const selectedCount = discovered.filter(n => checked.has(n)).length

  const handleCopyFailed = () => {
    navigator.clipboard.writeText(results.failed.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const changeType = key => {
    setContentType(key)
    setDiscovered([])
    setChecked(new Set())
    setPhase('idle')
    setScanError('')
    setResults({ succeeded: [], failed: [] })
  }

  const changeSource = id => {
    setSourceId(id)
    setDiscovered([])
    setChecked(new Set())
    setPhase('idle')
    setScanError('')
    setResults({ succeeded: [], failed: [] })
  }

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.headerTitle}>📦 Bulk Import from Source Book</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Type tabs */}
        <div style={s.typeTabs}>
          {Object.entries(CONTENT_TYPES).map(([key, { label, icon }]) => (
            <button
              key={key}
              style={contentType === key ? { ...s.typeTab, ...s.typeTabActive } : s.typeTab}
              onClick={() => changeType(key)}
              disabled={phase === 'scanning' || phase === 'importing'}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        <div style={s.body}>

          {/* Source selector + scan button */}
          <div style={s.topRow}>
            <select
              style={s.sourceSelect}
              value={sourceId}
              onChange={e => changeSource(e.target.value)}
              disabled={phase === 'scanning' || phase === 'importing'}
            >
              <option value=''>— Select a source book —</option>
              {sources.map(src => (
                <option key={src.id} value={src.id}>
                  {src.filename.replace(/\.pdf$/i, '')}
                </option>
              ))}
            </select>
            <button
              style={!sourceId || phase === 'scanning' || phase === 'importing' ? s.btnDisabled : s.btnScan}
              onClick={handleScan}
              disabled={!sourceId || phase === 'scanning' || phase === 'importing'}
            >
              {phase === 'scanning' ? 'Scanning…' : '🔍 Scan for Items'}
            </button>
          </div>

          {/* Scan error */}
          {scanError && (
            <div style={s.errorBox}>
              <span style={s.errorTitle}>⚠</span>
              <span style={s.errorMsg}>{scanError}</span>
            </div>
          )}

          {/* ── Phases ── */}

          {/* Idle */}
          {phase === 'idle' && !scanError && (
            <div style={s.centerBox}>
              <span style={s.bigIcon}>📚</span>
              <div style={s.centerTitle}>Select a book and click Scan</div>
              <div style={s.centerSub}>
                DMCS scans the indexed text for {CONTENT_TYPES[contentType].label.toLowerCase()} entries
                and presents a checklist — you choose what to import.
              </div>
            </div>
          )}

          {/* Scanning */}
          {phase === 'scanning' && (
            <div style={s.centerBox}>
              <span style={s.bigIcon}>🔍</span>
              <div style={s.centerTitle}>Scanning source book…</div>
              <div style={s.centerSub}>
                Looking for {CONTENT_TYPES[contentType].label.toLowerCase()} entries in the indexed text
              </div>
            </div>
          )}

          {/* Review checklist */}
          {phase === 'review' && (
            <>
              <div style={s.reviewBar}>
                <span style={s.reviewCount}>
                  {discovered.length} found · {selectedCount} selected
                </span>
                <div style={s.reviewBtns}>
                  <button style={s.btnTiny} onClick={selectAll}>All</button>
                  <button style={s.btnTiny} onClick={selectNew}>New only</button>
                  <button style={s.btnTiny} onClick={deselectAll}>None</button>
                </div>
              </div>

              <div style={s.checklist}>
                {discovered.map(name => {
                  const isExisting = existingNames.has(name.toLowerCase())
                  return (
                    <label key={name} style={isExisting ? { ...s.checkRow, ...s.checkRowExisting } : s.checkRow}>
                      <input
                        type='checkbox'
                        checked={checked.has(name)}
                        onChange={() => toggleCheck(name)}
                        style={s.checkbox}
                      />
                      <span style={isExisting ? { ...s.checkName, ...s.checkNameExisting } : s.checkName}>
                        {name}
                      </span>
                      {isExisting && <span style={s.existingTag}>already imported</span>}
                    </label>
                  )
                })}
              </div>

              <button
                style={selectedCount === 0 ? s.btnDisabled : s.btnImport}
                disabled={selectedCount === 0}
                onClick={handleImport}
              >
                Import {selectedCount} Selected {CONTENT_TYPES[contentType].label}
                {selectedCount !== 1 ? 's' : ''}
              </button>
            </>
          )}

          {/* Importing */}
          {phase === 'importing' && (
            <div style={s.centerBox}>
              <div style={s.barWrap}>
                <div style={{ ...s.barFill, width: `${pct}%` }} />
              </div>
              <div style={s.centerTitle}>
                {progress.current} / {progress.total} — {pct}%
              </div>
              <div style={s.currentName}>{progress.name}</div>
              <div style={s.centerSub}>
                Extracting with AI — this may take several minutes for large lists
              </div>
              <button style={s.btnCancel} onClick={() => { abortRef.current = true }}>
                Stop After Current
              </button>
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <div style={s.resultsWrap}>
              <div style={s.successLine}>
                ✅ {results.succeeded.length}{' '}
                {CONTENT_TYPES[contentType].label}{results.succeeded.length !== 1 ? 's' : ''}{' '}
                imported successfully
              </div>

              {results.failed.length > 0 && (
                <div style={s.failedBlock}>
                  <div style={s.failedBar}>
                    <span style={s.failedTitle}>
                      ❌ {results.failed.length} failed — add these via single import:
                    </span>
                    <button style={copied ? s.btnCopied : s.btnCopy} onClick={handleCopyFailed}>
                      {copied ? '✓ Copied!' : 'Copy List'}
                    </button>
                  </div>
                  <pre style={s.failedList}>{results.failed.join('\n')}</pre>
                </div>
              )}

              <div style={s.resultBtns}>
                {results.failed.length > 0 && (
                  <button
                    style={s.btnScan}
                    onClick={() => {
                      // Re-enter review with only failed items pre-checked
                      const failedSet = new Set(results.failed)
                      setChecked(failedSet)
                      setResults({ succeeded: [], failed: [] })
                      setPhase('review')
                    }}
                  >
                    Retry Failed
                  </button>
                )}
                <button style={s.btnScan} onClick={() => {
                  setPhase('review')
                  setResults({ succeeded: [], failed: [] })
                }}>
                  Back to List
                </button>
                <button style={s.btnImport} onClick={onClose}>Done</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.78)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 300,
  },
  modal: {
    background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 8,
    width: 700, maxWidth: '95vw', maxHeight: '90vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.75rem 1.25rem', borderBottom: '1px solid #2a1c08', flexShrink: 0,
  },
  headerTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '1rem' },
  closeBtn:    { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '1rem', padding: 0 },

  typeTabs:    { display: 'flex', borderBottom: '1px solid #2a1c08', flexShrink: 0 },
  typeTab: {
    flex: 1, padding: '0.5rem 0.25rem', background: 'transparent',
    border: 'none', borderBottom: '2px solid transparent',
    color: '#6b5a3a', cursor: 'pointer', fontSize: '0.8rem', transition: 'all 0.15s',
  },
  typeTabActive: { color: '#c9a84c', borderBottomColor: '#c9a84c', background: '#1a1208' },

  body: {
    flex: 1, overflowY: 'auto', padding: '1rem 1.25rem',
    display: 'flex', flexDirection: 'column', gap: 12,
  },

  topRow: { display: 'flex', gap: 8 },
  sourceSelect: {
    flex: 1, background: '#1a1208', border: '1px solid #3a2a10',
    borderRadius: 4, color: '#a89060', padding: '0.4rem 0.6rem',
    fontSize: '0.82rem', outline: 'none',
  },

  btnScan: {
    padding: '0.4rem 1rem', background: 'transparent',
    border: '1px solid #3a2a10', borderRadius: 4,
    color: '#a89060', cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap',
  },
  btnImport: {
    padding: '0.5rem 1.2rem', background: '#c9a84c', border: 'none',
    borderRadius: 4, color: '#0d0a05', fontWeight: 700, cursor: 'pointer',
    fontSize: '0.88rem', whiteSpace: 'nowrap',
  },
  btnDisabled: {
    padding: '0.4rem 1rem', background: '#1a1208',
    border: '1px solid #222', borderRadius: 4,
    color: '#444', cursor: 'not-allowed', fontSize: '0.82rem', whiteSpace: 'nowrap',
  },
  btnTiny: {
    padding: '0.15rem 0.55rem', background: 'transparent',
    border: '1px solid #3a2a10', borderRadius: 3,
    color: '#a89060', cursor: 'pointer', fontSize: '0.72rem',
  },
  btnCancel: {
    padding: '0.35rem 0.9rem', background: 'transparent',
    border: '1px solid #5a2a2a', borderRadius: 4,
    color: '#a06060', cursor: 'pointer', fontSize: '0.8rem', marginTop: 8,
  },
  btnCopy: {
    padding: '0.2rem 0.65rem', background: 'transparent',
    border: '1px solid #3a2a10', borderRadius: 3,
    color: '#a89060', cursor: 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap',
  },
  btnCopied: {
    padding: '0.2rem 0.65rem', background: '#1a3a1a',
    border: '1px solid #3a6a3a', borderRadius: 3,
    color: '#7aba7a', cursor: 'default', fontSize: '0.75rem', whiteSpace: 'nowrap',
  },

  errorBox: {
    display: 'flex', gap: 8, alignItems: 'flex-start',
    background: '#2a0d0d', border: '1px solid #7a2a2a',
    borderRadius: 6, padding: '0.7rem 1rem',
  },
  errorTitle: { color: '#c05050', fontWeight: 700, fontSize: '0.88rem', flexShrink: 0 },
  errorMsg:   { color: '#a06060', fontSize: '0.83rem', lineHeight: 1.5 },

  centerBox: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: '2rem 1rem', textAlign: 'center',
  },
  bigIcon:   { fontSize: '2.5rem' },
  centerTitle: { color: '#c9a84c', fontSize: '0.95rem', fontWeight: 600 },
  centerSub:   { color: '#6b5a3a', fontSize: '0.82rem', lineHeight: 1.65, maxWidth: 420 },
  currentName: { color: '#e8e0d0', fontSize: '0.9rem', fontStyle: 'italic' },

  barWrap: {
    width: '100%', maxWidth: 460, height: 8,
    background: '#1a1208', borderRadius: 4, overflow: 'hidden',
  },
  barFill: {
    height: '100%', background: '#c9a84c', borderRadius: 4,
    transition: 'width 0.3s ease',
  },

  reviewBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.3rem 0',
  },
  reviewCount: { color: '#a89060', fontSize: '0.8rem' },
  reviewBtns:  { display: 'flex', gap: 4 },

  checklist: {
    flex: 1, overflowY: 'auto', maxHeight: 360,
    border: '1px solid #2a1c08', borderRadius: 6,
    background: '#0a0805',
  },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '0.35rem 0.75rem', cursor: 'pointer',
    borderBottom: '1px solid #1a1208',
    transition: 'background 0.1s',
  },
  checkRowExisting: { opacity: 0.55 },
  checkbox:  { accentColor: '#c9a84c', cursor: 'pointer', flexShrink: 0 },
  checkName: { color: '#c9c0a8', fontSize: '0.83rem', flex: 1 },
  checkNameExisting: { color: '#6b5a3a' },
  existingTag: {
    color: '#6b5a3a', fontSize: '0.68rem',
    background: '#1a1208', border: '1px solid #2a1c08',
    borderRadius: 3, padding: '0.05rem 0.35rem', whiteSpace: 'nowrap',
  },

  resultsWrap: { display: 'flex', flexDirection: 'column', gap: 14 },
  successLine: { color: '#7aba7a', fontSize: '0.92rem', fontWeight: 600 },

  failedBlock: {
    background: '#1a0d0d', border: '1px solid #4a2a2a',
    borderRadius: 6, overflow: 'hidden',
  },
  failedBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.5rem 0.75rem', borderBottom: '1px solid #2a1208',
    background: '#220d0d',
  },
  failedTitle: { color: '#c05050', fontSize: '0.82rem', fontWeight: 600 },
  failedList: {
    margin: 0, padding: '0.6rem 0.75rem',
    color: '#a89060', fontSize: '0.8rem', lineHeight: 1.8,
    fontFamily: 'monospace', whiteSpace: 'pre-wrap',
    maxHeight: 180, overflowY: 'auto',
    userSelect: 'all',
  },

  resultBtns: { display: 'flex', gap: 8, flexWrap: 'wrap' },
}
