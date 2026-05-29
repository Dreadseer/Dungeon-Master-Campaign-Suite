import { useState, useEffect } from 'react'
import EntityModal from '../world/EntityModal'
import { createToken, TOKEN_COLORS } from '../../utils/tokenUtils'

const TOKEN_TYPES = [
  { value: 'player',  label: 'Player' },
  { value: 'npc',     label: 'NPC' },
  { value: 'monster', label: 'Monster' },
  { value: 'object',  label: 'Object' },
]

export default function AddTokenModal({ isOpen, onClose, onAdd, cell, campaignId }) {
  const [label,    setLabel]    = useState('')
  const [type,     setType]     = useState('monster')
  const [entityId, setEntityId] = useState('')
  const [npcs,     setNpcs]     = useState([])
  const [error,    setError]    = useState('')

  // Load NPCs for the NPC-link dropdown
  useEffect(() => {
    if (!isOpen || !campaignId) return
    window.electronAPI.db.npcs.getAll(campaignId).then(setNpcs).catch(() => setNpcs([]))
  }, [isOpen, campaignId])

  // Reset form when opened
  useEffect(() => {
    if (isOpen) {
      setLabel('')
      setType('monster')
      setEntityId('')
      setError('')
    }
  }, [isOpen])

  function handleSubmit(e) {
    e.preventDefault()
    if (!label.trim()) { setError('Label is required.'); return }

    const resolvedEntityType = type === 'npc' && entityId ? 'npc' : null
    const resolvedEntityId   = type === 'npc' && entityId ? Number(entityId) : null

    onAdd(createToken(label, type, cell.col, cell.row, resolvedEntityType, resolvedEntityId))
  }

  const previewColor = TOKEN_COLORS[type] ?? TOKEN_COLORS.object

  return (
    <EntityModal title="Place Token" isOpen={isOpen} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {/* Cell position info */}
        <p style={s.pos}>Placing at Col {cell.col}, Row {cell.row}</p>

        {/* Label */}
        <label style={s.label}>Label *</label>
        <input
          style={s.input}
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Goblin, Aria, Chest…"
          autoFocus
          maxLength={30}
        />
        {error && <p style={s.err}>{error}</p>}

        {/* Type + colour preview */}
        <label style={s.label}>Type</label>
        <div style={s.typeRow}>
          {TOKEN_TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              style={type === t.value ? { ...s.typeBtn, ...s.typeBtnActive, borderColor: TOKEN_COLORS[t.value] } : s.typeBtn}
              onClick={() => { setType(t.value); setEntityId('') }}
            >
              <span style={{ ...s.typeDot, background: TOKEN_COLORS[t.value] }} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Colour preview circle */}
        <div style={s.previewRow}>
          <div style={{ ...s.previewCircle, background: previewColor }} />
          <span style={s.previewLabel}>{label.substring(0, 3).toUpperCase() || '???'}</span>
        </div>

        {/* Entity link */}
        {type === 'npc' && (
          <>
            <label style={s.label}>Link to NPC (optional)</label>
            <select
              style={s.input}
              value={entityId}
              onChange={e => setEntityId(e.target.value)}
            >
              <option value="">No NPC linked</option>
              {npcs.map(n => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </>
        )}

        {type === 'player' && (
          <p style={s.phase4note}>
            🔗 Link to Character — available in Phase 4 (Character Sheets)
          </p>
        )}

        <div style={s.footer}>
          <button style={s.btnPrimary} type="submit">Place Token</button>
          <button style={s.btnSecondary} type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </EntityModal>
  )
}

const s = {
  pos:         { color: '#6b5a3a', fontSize: '0.78rem', margin: '0 0 0.75rem' },
  label:       { display: 'block', color: '#a89060', fontSize: '0.82rem', marginBottom: '0.35rem' },
  input:       { display: 'block', width: '100%', background: '#0d0a05', border: '1px solid #3a2a10', borderRadius: 4, color: '#e8e0d0', padding: '0.45rem 0.7rem', fontSize: '0.9rem', marginBottom: '0.9rem', outline: 'none', boxSizing: 'border-box' },
  err:         { color: '#e05050', fontSize: '0.82rem', marginTop: '-0.6rem', marginBottom: '0.75rem' },
  typeRow:     { display: 'flex', gap: '0.4rem', marginBottom: '0.9rem', flexWrap: 'wrap' },
  typeBtn:     { display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 4, padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem' },
  typeBtnActive: { background: '#1a1208', color: '#e8e0d0' },
  typeDot:     { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  previewRow:  { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.9rem' },
  previewCircle: { width: 36, height: 36, borderRadius: '50%' },
  previewLabel:  { color: '#e8e0d0', fontSize: '0.82rem', fontWeight: 'bold' },
  phase4note:  { color: '#6b5a3a', fontSize: '0.78rem', fontStyle: 'italic', marginBottom: '0.9rem' },
  footer:      { display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', paddingTop: '0.75rem', borderTop: '1px solid #2a1c08', marginTop: '0.5rem' },
  btnPrimary:  { background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
  btnSecondary:{ background: 'transparent', color: '#a89060', border: '1px solid #a89060', padding: '0.5rem 1.2rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' },
}
