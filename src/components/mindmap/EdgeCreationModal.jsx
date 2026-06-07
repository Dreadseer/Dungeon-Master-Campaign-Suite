import { useState } from 'react'

const RELATIONSHIP_PRESETS = [
  'ally', 'enemy', 'member of', 'rival', 'family', 'lover',
  'employer', 'employee', 'owns', 'worships', 'fears', 'knows secret of', 'neutral',
]

// Parse "npc-5" → { type: 'npc', id: 5 }
function parseNodeId(nodeId) {
  const lastDash = nodeId.lastIndexOf('-')
  return {
    type: nodeId.slice(0, lastDash),
    id:   parseInt(nodeId.slice(lastDash + 1), 10),
  }
}

export default function EdgeCreationModal({
  nodes,           // all RF nodes for name lookup
  connection,      // RF Connection { source, target } — null when editing
  editingEdge,     // existing RF edge — null when creating new
  activeCampaign,
  onSave,          // (savedEdge: RFEdge) => void
  onCancel,
}) {
  const isEdit = !!editingEdge

  const sourceId   = editingEdge?.source ?? connection?.source
  const targetId   = editingEdge?.target ?? connection?.target
  const sourceNode = nodes.find(n => n.id === sourceId)
  const targetNode = nodes.find(n => n.id === targetId)

  const [relationship, setRelationship] = useState(
    isEdit ? (editingEdge.label ?? '') : '',
  )
  const [notes,  setNotes]  = useState(
    isEdit ? (editingEdge.data?.notes ?? '') : '',
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!relationship.trim()) { setError('Relationship is required'); return }
    setSaving(true)
    setError(null)

    try {
      if (isEdit) {
        // ── Update existing connection ──────────────────────────────
        await window.electronAPI.db.connections.update(
          editingEdge.data.connectionId,
          {
            relationship: relationship.trim(),
            notes:        notes.trim() || null,
          },
        )
        onSave({
          ...editingEdge,
          label: relationship.trim(),
          data:  { ...editingEdge.data, notes: notes.trim() || null },
        })
      } else {
        // ── Create new connection ───────────────────────────────────
        const src = parseNodeId(connection.source)
        const tgt = parseNodeId(connection.target)

        const result = await window.electronAPI.db.connections.create({
          campaign_id:   activeCampaign.id,
          entity_a_type: src.type,
          entity_a_id:   src.id,
          entity_b_type: tgt.type,
          entity_b_id:   tgt.id,
          relationship:  relationship.trim(),
          notes:         notes.trim() || null,
        })

        const newEdge = {
          id:       `conn-${Number(result.lastInsertRowid)}`,
          source:   connection.source,
          target:   connection.target,
          label:    relationship.trim(),
          type:     'mindMapEdge',
          data:     {
            notes:        notes.trim() || null,
            connectionId: Number(result.lastInsertRowid),
          },
          animated: false,
          style:    { stroke: '#C9A84C', strokeWidth: 1.5 },
        }
        onSave(newEdge)
      }
    } catch (err) {
      setError(err.message ?? 'Failed to save connection')
      setSaving(false)
    }
  }

  return (
    /* ── Full-screen backdrop ───────────────────────────────────────── */
    <div style={s.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div style={s.modal} role="dialog" aria-modal="true">
        {/* Header */}
        <div style={s.header}>
          <span style={s.headerText}>
            {isEdit ? '✏ Edit Connection' : '+ New Connection'}
          </span>
          <button style={s.closeBtn} onClick={onCancel} title="Cancel">✕</button>
        </div>

        {/* Entity route */}
        <div style={s.route}>
          <span style={s.entityChip}>{sourceNode?.data.label ?? sourceId}</span>
          <span style={s.arrow}>→</span>
          <span style={s.entityChip}>{targetNode?.data.label ?? targetId}</span>
        </div>

        {/* Form */}
        <form style={s.form} onSubmit={handleSubmit}>
          <label style={s.label}>
            Relationship *
            <input
              list="rel-presets"
              style={s.input}
              value={relationship}
              onChange={e => setRelationship(e.target.value)}
              placeholder="e.g. ally, rival, member of…"
              autoFocus
              required
            />
            <datalist id="rel-presets">
              {RELATIONSHIP_PRESETS.map(r => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>

          <label style={s.label}>
            Notes (optional)
            <textarea
              style={s.textarea}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Additional context for this connection…"
            />
          </label>

          {error && <p style={s.error}>{error}</p>}

          <div style={s.btnRow}>
            <button type="button" style={s.cancelBtn} onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" style={s.submitBtn} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Connection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const s = {
  backdrop: {
    position:        'fixed',
    inset:           0,
    background:      'rgba(0,0,0,0.65)',
    zIndex:          100,
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
  },
  modal: {
    width:         400,
    background:    '#12100a',
    border:        '1px solid #3a2a10',
    borderRadius:  8,
    boxShadow:     '0 8px 40px rgba(0,0,0,0.8)',
    overflow:      'hidden',
  },

  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '12px 16px',
    background:     '#1a1208',
    borderBottom:   '1px solid #3a2a10',
  },
  headerText: {
    color:      '#C9A84C',
    fontSize:   14,
    fontWeight: 700,
    fontFamily: 'Georgia',
  },
  closeBtn: {
    background: 'none',
    border:     'none',
    color:      '#555',
    cursor:     'pointer',
    fontSize:   16,
    padding:    '0 2px',
  },

  route: {
    display:     'flex',
    alignItems:  'center',
    gap:         8,
    padding:     '10px 16px',
    background:  '#0d0a05',
    borderBottom:'1px solid #1e1608',
  },
  entityChip: {
    padding:      '3px 10px',
    background:   '#1a1208',
    border:       '1px solid #3a2a10',
    borderRadius: 10,
    color:        '#c9c0a8',
    fontSize:     12,
    fontFamily:   'Georgia',
  },
  arrow: {
    color:    '#C9A84C',
    fontSize: 16,
  },

  form: {
    padding:       '14px 16px',
    display:       'flex',
    flexDirection: 'column',
    gap:           12,
  },
  label: {
    display:       'flex',
    flexDirection: 'column',
    gap:           5,
    color:         '#666',
    fontSize:      11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    padding:      '7px 10px',
    background:   '#1a1208',
    border:       '1px solid #3a2a10',
    borderRadius: 4,
    color:        '#c9c0a8',
    fontSize:     13,
    outline:      'none',
    fontFamily:   'inherit',
  },
  textarea: {
    padding:    '7px 10px',
    background: '#1a1208',
    border:     '1px solid #3a2a10',
    borderRadius: 4,
    color:      '#c9c0a8',
    fontSize:   13,
    outline:    'none',
    resize:     'vertical',
    fontFamily: 'inherit',
    lineHeight: 1.5,
  },
  error: {
    color:    '#8b0000',
    fontSize: 12,
    margin:   0,
  },
  btnRow: {
    display:        'flex',
    justifyContent: 'flex-end',
    gap:            8,
    marginTop:      4,
  },
  cancelBtn: {
    padding:      '7px 16px',
    background:   'none',
    border:       '1px solid #333',
    borderRadius: 4,
    color:        '#666',
    cursor:       'pointer',
    fontSize:     13,
  },
  submitBtn: {
    padding:      '7px 20px',
    background:   '#2a1f06',
    border:       '1px solid #C9A84C',
    borderRadius: 4,
    color:        '#C9A84C',
    cursor:       'pointer',
    fontSize:     13,
    fontWeight:   600,
  },
}
