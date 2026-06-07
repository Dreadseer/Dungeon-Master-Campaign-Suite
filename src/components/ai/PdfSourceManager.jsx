import { useState, useEffect, useCallback, useRef } from 'react'
import useCampaignStore from '../../stores/campaignStore'

// ── Status badge colours ─────────────────────────────────────────────────────
const STATUS_COLORS = {
  pending:  { bg: '#2a2a2a', border: '#555',    text: '#888'    },
  indexed:  { bg: '#122212', border: '#3a7a3a', text: '#5aaa5a' },
  embedded: { bg: '#0d1a30', border: '#3a5a9a', text: '#6a9ae0' },
  failed:   { bg: '#2a0d0d', border: '#7a2a2a', text: '#c05050' },
}

const STATUS_LABELS = {
  pending:  '⏳ Pending',
  indexed:  '✓ Indexed',
  embedded: '◈ Embedded',
  failed:   '✗ Failed',
}

// ── Per-source progress shape ────────────────────────────────────────────────
// { phase: 'pdf'|'embed', percent: number, message: string }

function formatDate(dt) {
  if (!dt) return '—'
  try {
    return new Date(dt + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dt }
}

export default function PdfSourceManager() {
  const activeCampaign = useCampaignStore(s => s.activeCampaign)

  const [sources,   setSources]   = useState([])
  const [progress,  setProgress]  = useState({})   // { [sourceId]: { phase, percent, message } }
  const [ingesting, setIngesting] = useState(false)
  const [error,     setError]     = useState(null)
  const [ollamaOk,  setOllamaOk]  = useState(null) // null=checking, true=ok, false=unavailable

  // Chunk preview state: { [sourceId]: { open, chunks, loading, showAll } }
  const [previews, setPreviews] = useState({})

  // Stable refs for progress callbacks so they can be removed on unmount
  const pdfCbRef   = useRef(null)
  const embedCbRef = useRef(null)

  // ── Load sources ───────────────────────────────────────────────────────────
  const loadSources = useCallback(async () => {
    if (!activeCampaign?.id) return
    try {
      const rows = await window.electronAPI.db.pdf.getAll(activeCampaign.id)
      setSources(rows)
    } catch (err) {
      setError(err.message ?? 'Failed to load PDF sources')
    }
  }, [activeCampaign?.id])

  useEffect(() => { loadSources() }, [loadSources])

  // ── Check Ollama on mount ──────────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.embed.getStatus().then(status => {
      setOllamaOk(status.available && status.hasModel)
    }).catch(() => setOllamaOk(false))
  }, [])

  // ── Register PDF + embed progress listeners ────────────────────────────────
  useEffect(() => {
    const pdfCb = ({ sourceId, percent, message }) => {
      setProgress(prev => ({ ...prev, [sourceId]: { phase: 'pdf', percent, message } }))
    }
    const embedCb = ({ sourceId, percent, message }) => {
      setProgress(prev => ({ ...prev, [sourceId]: { phase: 'embed', percent, message } }))
    }
    pdfCbRef.current   = pdfCb
    embedCbRef.current = embedCb
    window.electronAPI.pdf.onProgress(pdfCb)
    window.electronAPI.embed.onProgress(embedCb)
    return () => {
      window.electronAPI.pdf.offProgress(pdfCbRef.current)
      window.electronAPI.embed.offProgress(embedCbRef.current)
    }
  }, [])

  // ── Upload PDF(s) — ingest then embed sequentially ─────────────────────────
  const handleUpload = useCallback(async () => {
    if (!activeCampaign?.id || ingesting) return
    setError(null)
    try {
      const filePaths = await window.electronAPI.pdf.openDialog()
      if (!filePaths.length) return

      setIngesting(true)
      for (const filePath of filePaths) {
        try {
          // Phase 1: PDF extraction + chunking
          const result = await window.electronAPI.pdf.ingest(activeCampaign.id, filePath)
          const sourceId = result?.sourceId ?? null

          // Phase 2: Embedding (only if Ollama is available and we have a sourceId)
          if (ollamaOk && sourceId) {
            try {
              await window.electronAPI.embed.source(sourceId)
            } catch (embedErr) {
              setError(`Chunking complete but embedding failed: ${embedErr.message}`)
            }
          }
        } catch (err) {
          setError(`Failed to ingest "${filePath}": ${err.message}`)
        }
      }
      await loadSources()
    } finally {
      setIngesting(false)
    }
  }, [activeCampaign?.id, ingesting, ollamaOk, loadSources])

  // ── Embed an already-indexed source manually ───────────────────────────────
  const handleEmbed = useCallback(async (source) => {
    setError(null)
    setIngesting(true)
    try {
      await window.electronAPI.embed.source(source.id)
      await loadSources()
    } catch (err) {
      setError(err.message ?? 'Embedding failed')
    } finally {
      setIngesting(false)
    }
  }, [loadSources])

  // ── Re-ingest source ───────────────────────────────────────────────────────
  const handleReIngest = useCallback(async (source) => {
    setError(null)
    setIngesting(true)
    try {
      await window.electronAPI.pdf.reIngest(source.id)
      if (ollamaOk) {
        try {
          await window.electronAPI.embed.source(source.id)
        } catch (embedErr) {
          setError(`Re-index complete but embedding failed: ${embedErr.message}`)
        }
      }
      await loadSources()
    } catch (err) {
      setError(err.message ?? 'Re-ingestion failed')
    } finally {
      setIngesting(false)
    }
  }, [ollamaOk, loadSources])

  // ── Delete source ──────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (source) => {
    if (!window.confirm(`Delete "${source.filename}" and all its chunks?`)) return
    try {
      // Remove vectra vectors first
      await window.electronAPI.embed.deleteSource(source.id).catch(() => {})
      await window.electronAPI.pdf.delete(source.id, source.file_path)
      setSources(prev => prev.filter(s => s.id !== source.id))
      setProgress(prev => { const next = { ...prev }; delete next[source.id]; return next })
      setPreviews(prev => { const next = { ...prev }; delete next[source.id]; return next })
    } catch (err) {
      setError(err.message ?? 'Delete failed')
    }
  }, [])

  // ── Chunk preview ──────────────────────────────────────────────────────────
  const togglePreview = useCallback(async (sourceId) => {
    const current = previews[sourceId] ?? { open: false, chunks: [], loading: false, showAll: false }

    if (current.open) {
      setPreviews(prev => ({ ...prev, [sourceId]: { ...current, open: false } }))
      return
    }

    // Open — load chunks if not already loaded
    if (!current.chunks.length) {
      setPreviews(prev => ({ ...prev, [sourceId]: { ...current, open: true, loading: true } }))
      try {
        const chunks = await window.electronAPI.db.pdf.getChunks(sourceId)
        setPreviews(prev => ({ ...prev, [sourceId]: { open: true, chunks, loading: false, showAll: false } }))
      } catch {
        setPreviews(prev => ({ ...prev, [sourceId]: { ...prev[sourceId], loading: false } }))
      }
    } else {
      setPreviews(prev => ({ ...prev, [sourceId]: { ...current, open: true } }))
    }
  }, [previews])

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!activeCampaign) {
    return <div style={s.empty}>Select a campaign to manage PDF sources.</div>
  }

  return (
    <div style={s.container}>

      {/* ── Header ─── */}
      <div style={s.header}>
        <span style={s.title}>📄 PDF Sources</span>
        <button
          style={ingesting ? s.btnDisabled : s.btnPrimary}
          onClick={handleUpload}
          disabled={ingesting}
          title="Upload one or more PDF source books"
        >
          {ingesting ? '⏳ Processing…' : '+ Upload PDF'}
        </button>
      </div>

      {/* ── Ollama warning ─── */}
      {ollamaOk === false && (
        <div style={s.warnBanner}>
          ⚠ Ollama is required for semantic search. Start Ollama and ensure{' '}
          <code style={s.code}>nomic-embed-text</code> is pulled:{' '}
          <code style={s.code}>ollama pull nomic-embed-text</code>
          <button
            style={s.warnRetry}
            onClick={() => {
              setOllamaOk(null)
              window.electronAPI.embed.getStatus().then(st => setOllamaOk(st.available && st.hasModel)).catch(() => setOllamaOk(false))
            }}
          >↺ Recheck</button>
        </div>
      )}

      {/* ── Error banner ─── */}
      {error && (
        <div style={s.errorBanner}>
          ⚠ {error}
          <button style={s.errorClose} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ── Source list ─── */}
      {sources.length === 0 ? (
        <div style={s.emptyList}>
          No PDF sources yet. Upload a source book to enable rules Q&amp;A.
        </div>
      ) : (
        <div style={s.list}>
          {sources.map(source => {
            const prog    = progress[source.id]
            const colours = STATUS_COLORS[source.status] ?? STATUS_COLORS.pending
            const preview = previews[source.id]
            const isActive = prog && prog.percent < 100

            return (
              <div key={source.id} style={s.card}>

                {/* Card header */}
                <div style={s.cardHeader}>
                  <span style={s.filename} title={source.file_path}>
                    {source.filename}
                  </span>
                  <span style={{ ...s.badge, background: colours.bg, border: `1px solid ${colours.border}`, color: colours.text }}>
                    {STATUS_LABELS[source.status] ?? source.status}
                  </span>
                </div>

                {/* Meta */}
                <div style={s.meta}>
                  <span>{source.chunk_count > 0 ? `${source.chunk_count} chunks` : 'No chunks'}</span>
                  <span style={s.dot}>·</span>
                  <span>Indexed {formatDate(source.indexed_at)}</span>
                </div>

                {/* Two-phase progress */}
                {isActive && (
                  <div style={s.progressWrap}>
                    <div style={s.phaseLabel}>
                      {prog.phase === 'pdf' ? '① Extracting & chunking' : '② Generating embeddings'}
                    </div>
                    <div style={s.progressTrack}>
                      <div style={{ ...s.progressBar, width: `${prog.percent}%` }} />
                    </div>
                    <span style={s.progressMsg}>{prog.message}</span>
                  </div>
                )}

                {/* Done indicator */}
                {prog && prog.percent >= 100 && !isActive && (
                  <div style={s.progressDone}>
                    ✓ {prog.phase === 'embed' ? `Embedded ${source.chunk_count} chunks` : `Indexed ${source.chunk_count} chunks`}
                  </div>
                )}

                {/* Actions */}
                <div style={s.actions}>
                  {source.chunk_count > 0 && (
                    <button style={s.btnGhost} onClick={() => togglePreview(source.id)}>
                      {preview?.open ? '▲ Hide' : '▼ Preview Chunks'}
                    </button>
                  )}
                  {/* Offer manual embed if indexed but not yet embedded and Ollama is ready */}
                  {source.status === 'indexed' && ollamaOk && (
                    <button
                      style={s.btnGhost}
                      onClick={() => handleEmbed(source)}
                      disabled={ingesting}
                      title="Generate semantic embeddings for this source"
                    >
                      ◈ Embed
                    </button>
                  )}
                  {source.status === 'failed' && (
                    <button style={s.btnWarning} onClick={() => handleReIngest(source)} disabled={ingesting}>
                      ↺ Retry
                    </button>
                  )}
                  <button style={s.btnDanger} onClick={() => handleDelete(source)} disabled={ingesting}>
                    🗑 Delete
                  </button>
                </div>

                {/* Chunk preview panel */}
                {preview?.open && (
                  <div style={s.previewPanel}>
                    {preview.loading ? (
                      <span style={s.previewNote}>Loading chunks…</span>
                    ) : preview.chunks.length === 0 ? (
                      <span style={s.previewNote}>No chunks found.</span>
                    ) : (
                      <>
                        {(preview.showAll ? preview.chunks : preview.chunks.slice(0, 5)).map(chunk => (
                          <div key={chunk.id} style={s.chunkCard}>
                            <div style={s.chunkMeta}>Chunk #{chunk.chunk_index + 1} — p.{chunk.page_number}</div>
                            <div style={s.chunkText}>
                              {chunk.text.length > 200 ? chunk.text.slice(0, 200) + '…' : chunk.text}
                            </div>
                          </div>
                        ))}
                        {!preview.showAll && preview.chunks.length > 5 && (
                          <button
                            style={s.btnGhost}
                            onClick={() => setPreviews(prev => ({
                              ...prev, [source.id]: { ...prev[source.id], showAll: true }
                            }))}
                          >
                            Show all {preview.chunks.length} chunks
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  container: {
    display:       'flex',
    flexDirection: 'column',
    gap:           12,
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  title: {
    color:      '#C9A84C',
    fontWeight: 600,
    fontSize:   14,
  },
  empty: {
    color:    '#555',
    fontSize: 13,
    padding:  '8px 0',
  },
  emptyList: {
    color:     '#555',
    fontSize:  12,
    padding:   '16px 0',
    textAlign: 'center',
    fontStyle: 'italic',
  },

  warnBanner: {
    background:  '#1f1500',
    border:      '1px solid #5a4010',
    borderRadius: 4,
    color:       '#C9A84C',
    fontSize:    12,
    padding:     '8px 10px',
    lineHeight:  1.6,
    display:     'flex',
    flexWrap:    'wrap',
    alignItems:  'center',
    gap:         6,
  },
  warnRetry: {
    padding:      '2px 8px',
    background:   'none',
    border:       '1px solid #5a4010',
    borderRadius: 4,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     11,
    marginLeft:   4,
  },
  code: {
    fontFamily:  'monospace',
    background:  '#0d0a05',
    padding:     '1px 4px',
    borderRadius: 3,
    fontSize:    11,
  },

  errorBanner: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    background:     '#2a0d0d',
    border:         '1px solid #7a2a2a',
    borderRadius:   4,
    color:          '#c05050',
    fontSize:       12,
    padding:        '6px 10px',
  },
  errorClose: {
    background: 'none', border: 'none',
    color: '#c05050', cursor: 'pointer', fontSize: 12, padding: 0,
  },

  list: {
    display:       'flex',
    flexDirection: 'column',
    gap:           8,
  },
  card: {
    background:    'rgba(20, 15, 5, 0.8)',
    border:        '1px solid #2a1a08',
    borderRadius:  6,
    padding:       '10px 12px',
    display:       'flex',
    flexDirection: 'column',
    gap:           6,
  },
  cardHeader: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  filename: {
    color:        '#c9c0a8',
    fontSize:     13,
    fontWeight:   600,
    flex:         1,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  },
  badge: {
    padding:      '2px 8px',
    borderRadius: 10,
    fontSize:     11,
    fontWeight:   600,
    whiteSpace:   'nowrap',
    flexShrink:   0,
  },
  meta: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    color:      '#666',
    fontSize:   11,
  },
  dot: { color: '#444' },

  progressWrap: {
    display:       'flex',
    flexDirection: 'column',
    gap:           3,
    marginTop:     2,
  },
  phaseLabel: {
    color:    '#888',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.5px',
  },
  progressTrack: {
    position:    'relative',
    background:  '#1a1208',
    borderRadius: 3,
    height:      5,
    overflow:    'hidden',
  },
  progressBar: {
    position:    'absolute',
    top:         0, left: 0,
    height:      '100%',
    background:  '#C9A84C',
    transition:  'width 0.3s ease',
    borderRadius: 3,
  },
  progressMsg: {
    color:    '#666',
    fontSize: 10,
  },
  progressDone: {
    color:    '#5aaa5a',
    fontSize: 11,
  },

  actions: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    marginTop:  2,
    flexWrap:   'wrap',
  },

  btnPrimary: {
    padding:      '5px 14px',
    background:   '#2a1f06',
    border:       '1px solid #C9A84C',
    borderRadius: 4,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     12,
    fontWeight:   600,
    whiteSpace:   'nowrap',
  },
  btnDisabled: {
    padding:      '5px 14px',
    background:   '#1a1208',
    border:       '1px solid #333',
    borderRadius: 4,
    color:        '#555',
    cursor:       'not-allowed',
    fontSize:     12,
    fontWeight:   600,
    whiteSpace:   'nowrap',
  },
  btnGhost: {
    padding:      '3px 10px',
    background:   'none',
    border:       '1px solid #3a2a10',
    borderRadius: 4,
    color:        '#888',
    cursor:       'pointer',
    fontSize:     11,
    whiteSpace:   'nowrap',
  },
  btnWarning: {
    padding:      '3px 10px',
    background:   'none',
    border:       '1px solid #7a5a1a',
    borderRadius: 4,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     11,
    whiteSpace:   'nowrap',
  },
  btnDanger: {
    padding:      '3px 10px',
    background:   'none',
    border:       '1px solid #3a1a1a',
    borderRadius: 4,
    color:        '#c05050',
    cursor:       'pointer',
    fontSize:     11,
    whiteSpace:   'nowrap',
  },

  previewPanel: {
    marginTop:     4,
    borderTop:     '1px solid #2a1a08',
    paddingTop:    8,
    display:       'flex',
    flexDirection: 'column',
    gap:           6,
  },
  previewNote: {
    color: '#555', fontSize: 11, fontStyle: 'italic',
  },
  chunkCard: {
    background:   '#0d0a05',
    border:       '1px solid #1e1608',
    borderRadius: 4,
    padding:      '6px 8px',
  },
  chunkMeta: {
    color:        '#666',
    fontSize:     10,
    marginBottom: 3,
    fontFamily:   'monospace',
  },
  chunkText: {
    color:      '#998a6a',
    fontSize:   11,
    lineHeight: 1.5,
    wordBreak:  'break-word',
  },
}
