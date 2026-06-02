import { useState, useRef, useCallback } from 'react'
import { crColor } from '../../utils/crColor'

export default function MonsterRoster({ encounterId, monsters, onChange }) {
  // inline-edit state: { monsterId, field }
  const [editing, setEditing]   = useState(null)
  const [editVal, setEditVal]   = useState('')
  const [saving, setSaving]     = useState(false)
  const debounceRef = useRef(null)

  // Debounced auto-save after any mutation
  const scheduleSave = useCallback((updatedMonsters) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      if (!encounterId) return
      try {
        setSaving(true)
        const xpTotal = updatedMonsters.reduce((s, m) => s + (m.xp ?? 0) * m.count, 0)
        await window.electronAPI.db.encounters.updateMonsters(encounterId, updatedMonsters, xpTotal)
      } finally {
        setSaving(false)
      }
    }, 1000)
  }, [encounterId])

  const mutate = (updater) => {
    const next = updater(monsters)
    onChange(next)
    scheduleSave(next)
  }

  const changeCount = (id, delta) => {
    mutate(prev => prev.map(m =>
      m.id === id ? { ...m, count: Math.max(1, m.count + delta) } : m
    ))
  }

  const removeMonster = (id) => {
    mutate(prev => prev.filter(m => m.id !== id))
  }

  const startEdit = (monsterId, field, currentVal) => {
    setEditing({ monsterId, field })
    setEditVal(String(currentVal ?? ''))
  }

  const commitEdit = (id, field) => {
    mutate(prev => prev.map(m => {
      if (m.id !== id) return m
      if (field === 'custom_name') return { ...m, custom_name: editVal.trim() || null }
      if (field === 'hp_max') {
        const hp = parseInt(editVal, 10)
        if (!isNaN(hp) && hp > 0) return { ...m, hp_max: hp, hp_current: hp }
      }
      return m
    }))
    setEditing(null)
  }

  const saveRosterNow = async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!encounterId) return
    try {
      setSaving(true)
      const xpTotal = monsters.reduce((s, m) => s + (m.xp ?? 0) * m.count, 0)
      await window.electronAPI.db.encounters.updateMonsters(encounterId, monsters, xpTotal)
    } finally {
      setSaving(false)
    }
  }

  const totalCount = monsters.reduce((s, m) => s + m.count, 0)
  const totalXP    = monsters.reduce((s, m) => s + (m.xp ?? 0) * m.count, 0)

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerTitle}>Monster Roster</span>
        <span style={s.savingBadge}>{saving ? 'Saving…' : ''}</span>
        <button style={s.saveBtn} onClick={saveRosterNow}>Save Roster</button>
      </div>

      {monsters.length === 0 ? (
        <p style={s.empty}>No monsters added yet. Search for monsters on the right →</p>
      ) : (
        <>
          {/* Monster rows */}
          {monsters.map(m => {
            const displayName = m.custom_name || m.name
            const crNum       = m.cr ?? '?'
            const isEditingName = editing?.monsterId === m.id && editing?.field === 'custom_name'
            const isEditingHP   = editing?.monsterId === m.id && editing?.field === 'hp_max'

            return (
              <div key={m.id} style={s.row}>
                {/* Name — click to rename */}
                <div style={s.nameCol}>
                  {isEditingName ? (
                    <input
                      autoFocus
                      style={s.inlineInput}
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(m.id, 'custom_name')}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit(m.id, 'custom_name'); if (e.key === 'Escape') setEditing(null) }}
                    />
                  ) : (
                    <span
                      style={{ ...s.monsterName, ...(m.custom_name ? s.customName : {}) }}
                      title="Click to rename for this encounter"
                      onClick={() => startEdit(m.id, 'custom_name', m.custom_name || m.name)}
                    >
                      {displayName}
                      {m.custom_name && <span style={s.origName}> ({m.name})</span>}
                    </span>
                  )}
                  <span style={{ ...s.crBadge, background: crColor(crNum) }}>
                    CR {crNum}
                  </span>
                </div>

                {/* Count controls */}
                <div style={s.countCol}>
                  <button style={s.countBtn} onClick={() => changeCount(m.id, -1)}>−</button>
                  <span style={s.countVal}>{m.count}</span>
                  <button style={s.countBtn} onClick={() => changeCount(m.id, +1)}>+</button>
                </div>

                {/* HP — click to override */}
                <div style={s.hpCol}>
                  {isEditingHP ? (
                    <input
                      autoFocus
                      style={{ ...s.inlineInput, width: 52 }}
                      value={editVal}
                      type="number"
                      min={1}
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(m.id, 'hp_max')}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit(m.id, 'hp_max'); if (e.key === 'Escape') setEditing(null) }}
                    />
                  ) : (
                    <span
                      style={s.hpVal}
                      title="Click to override HP for this encounter"
                      onClick={() => startEdit(m.id, 'hp_max', m.hp_max)}
                    >
                      {m.hp_max} HP
                    </span>
                  )}
                </div>

                {/* XP */}
                <div style={s.xpCol}>
                  <span style={s.xpVal}>{((m.xp ?? 0) * m.count).toLocaleString()} XP</span>
                </div>

                {/* Remove */}
                <button style={s.removeBtn} title="Remove from roster" onClick={() => removeMonster(m.id)}>✕</button>
              </div>
            )
          })}

          {/* Subtotal row */}
          <div style={s.subtotal}>
            <span style={s.subtotalLabel}>{totalCount} monster{totalCount !== 1 ? 's' : ''}</span>
            <span style={s.subtotalXP}>Raw XP: {totalXP.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  )
}

const s = {
  panel: {
    display: 'flex', flexDirection: 'column', gap: 0,
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', background: '#222', borderBottom: '1px solid #333',
  },
  headerTitle: { color: '#c9a84c', fontWeight: 600, fontSize: 14, flex: 1 },
  savingBadge: { color: '#666', fontSize: 12, fontStyle: 'italic' },
  saveBtn: {
    padding: '4px 12px', background: '#2d5a27', color: '#7fc272',
    border: '1px solid #3d7a37', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  empty: {
    color: '#555', textAlign: 'center', padding: '32px 16px', fontSize: 13, margin: 0,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', borderBottom: '1px solid #2a2a2a',
  },
  nameCol:   { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  countCol:  { display: 'flex', alignItems: 'center', gap: 4 },
  hpCol:     { minWidth: 72, textAlign: 'right' },
  xpCol:     { minWidth: 80, textAlign: 'right' },
  monsterName: {
    color: '#e0d5c0', fontSize: 14, cursor: 'pointer',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    ':hover': { color: '#c9a84c' },
  },
  customName: { color: '#c9a84c', fontStyle: 'italic' },
  origName:   { color: '#666', fontSize: 12 },
  crBadge: {
    fontSize: 11, fontWeight: 600, color: '#fff',
    padding: '1px 6px', borderRadius: 3, flexShrink: 0,
  },
  countBtn: {
    width: 22, height: 22, background: '#2a2a2a', color: '#aaa',
    border: '1px solid #444', borderRadius: 3, cursor: 'pointer',
    fontSize: 14, lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  countVal: { color: '#e0d5c0', fontSize: 14, fontWeight: 600, minWidth: 20, textAlign: 'center' },
  hpVal: {
    color: '#7abfff', fontSize: 13, cursor: 'pointer',
    padding: '1px 4px', borderRadius: 3, border: '1px solid transparent',
  },
  xpVal: { color: '#c9a84c', fontSize: 13 },
  removeBtn: {
    background: 'none', border: 'none', color: '#555', cursor: 'pointer',
    fontSize: 14, padding: '2px 4px', marginLeft: 4,
    ':hover': { color: '#c0392b' },
  },
  inlineInput: {
    background: '#111', border: '1px solid #c9a84c', borderRadius: 3,
    color: '#e0d5c0', padding: '2px 6px', fontSize: 14,
    outline: 'none', width: 140,
  },
  subtotal: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 14px', background: '#222', borderTop: '1px solid #333',
  },
  subtotalLabel: { color: '#888', fontSize: 13 },
  subtotalXP:    { color: '#c9a84c', fontSize: 13, fontWeight: 600 },
}
