import { useState } from 'react'

const COINS = [
  { key: 'pp', label: 'PP', name: 'Platinum', color: '#E0E0E0' },
  { key: 'gp', label: 'GP', name: 'Gold',     color: '#C9A84C' },
  { key: 'ep', label: 'EP', name: 'Electrum', color: '#2A8D7A' },
  { key: 'sp', label: 'SP', name: 'Silver',   color: '#A0A0A0' },
  { key: 'cp', label: 'CP', name: 'Copper',   color: '#B87333' },
]

// Copper-piece value of each denomination (for exact integer math)
const CP_VALUE = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 }

function totalGp(currency) {
  const c = currency ?? {}
  return (c.pp ?? 0) * 10 + (c.gp ?? 0) + (c.ep ?? 0) * 0.5 +
         (c.sp ?? 0) * 0.1 + (c.cp ?? 0) * 0.01
}

export default function CurrencyWallet({ currency, characterId, onRefresh }) {
  const cur = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...currency }

  const [editingField, setEditingField] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)

  // ── Inline edit ──────────────────────────────────────────────────────────
  function startEdit(key) {
    setEditingField(key)
    setEditingValue(String(cur[key] ?? 0))
  }

  async function commitEdit(key) {
    const val = parseInt(editingValue, 10)
    if (!isNaN(val) && val >= 0) {
      await window.electronAPI.db.characters.updateCurrency(characterId, { [key]: val })
      onRefresh()
    }
    setEditingField(null)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      {/* Coin row */}
      <div style={s.coinRow}>
        {COINS.map(({ key, label, name, color }) => (
          <div key={key} style={s.coin} title={name}>
            <span style={{ ...s.coinLabel, color }}>{label}</span>
            {editingField === key ? (
              <input
                style={s.coinInput}
                type="number" min="0"
                value={editingValue}
                onChange={e => setEditingValue(e.target.value)}
                onBlur={() => commitEdit(key)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  commitEdit(key)
                  if (e.key === 'Escape') setEditingField(null)
                }}
                autoFocus
              />
            ) : (
              <button
                style={s.coinAmount}
                onClick={() => startEdit(key)}
                title={`Click to edit ${name}`}
              >
                {(cur[key] ?? 0).toLocaleString()}
              </button>
            )}
          </div>
        ))}

        {/* Total + transfer button */}
        <div style={s.totalBlock}>
          <span style={s.totalLabel}>≈ {totalGp(cur).toFixed(1)} gp</span>
          <button style={s.transferBtn} onClick={() => setShowTransfer(true)} title="Convert currency">
            ⇄
          </button>
        </div>
      </div>

      {/* Transfer modal */}
      {showTransfer && (
        <TransferModal
          currency={cur}
          characterId={characterId}
          onDone={() => { setShowTransfer(false); onRefresh() }}
          onClose={() => setShowTransfer(false)}
        />
      )}
    </div>
  )
}

// ── Transfer modal ────────────────────────────────────────────────────────────

function TransferModal({ currency, characterId, onDone, onClose }) {
  const [fromKey, setFromKey] = useState('gp')
  const [toKey,   setToKey]   = useState('sp')
  const [amount,  setAmount]  = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const cur = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...currency }
  const amt = parseInt(amount, 10)

  // Calculate result
  const canCalc  = !isNaN(amt) && amt > 0 && fromKey !== toKey
  const totalCp  = canCalc ? amt * CP_VALUE[fromKey] : 0
  const result   = canCalc ? Math.floor(totalCp / CP_VALUE[toKey]) : 0
  const hasEnough = (cur[fromKey] ?? 0) >= (canCalc ? amt : Infinity)

  async function handleConvert() {
    if (!canCalc || result === 0 || !hasEnough) return
    setSaving(true); setError('')
    try {
      const newCur = {
        ...cur,
        [fromKey]: (cur[fromKey] ?? 0) - amt,
        [toKey]:   (cur[toKey]   ?? 0) + result,
      }
      // Save all denominations that changed
      await window.electronAPI.db.characters.updateCurrency(characterId, {
        [fromKey]: newCur[fromKey],
        [toKey]:   newCur[toKey],
      })
      onDone()
    } catch {
      setError('Conversion failed.')
    }
    setSaving(false)
  }

  const preview = canCalc
    ? result > 0
      ? `→  ${result.toLocaleString()} ${toKey.toUpperCase()}`
      : `Not enough ${fromKey.toUpperCase()} for even 1 ${toKey.toUpperCase()}`
    : null

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>Convert Currency</span>
          <button style={s.modalClose} onClick={onClose}>✕</button>
        </div>

        <div style={s.modalBody}>
          {/* From row */}
          <div style={s.modalRow}>
            <input
              style={{ ...s.modalInput, width: 80 }}
              type="number" min="1" placeholder="Amount"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError('') }}
            />
            <select style={s.modalSelect} value={fromKey} onChange={e => setFromKey(e.target.value)}>
              {COINS.map(c => (
                <option key={c.key} value={c.key}>
                  {c.label} ({(cur[c.key] ?? 0).toLocaleString()} available)
                </option>
              ))}
            </select>
            <span style={{ color: '#6b5a3a', fontSize: '0.85rem' }}>→</span>
            <select style={s.modalSelect} value={toKey} onChange={e => setToKey(e.target.value)}>
              {COINS.filter(c => c.key !== fromKey).map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Exchange rates reference */}
          <p style={s.ratesHint}>
            Rates: 10 CP = 1 SP · 10 SP = 1 GP · 10 GP = 1 PP · 1 GP = 2 EP
          </p>

          {/* Preview */}
          {preview && (
            <div style={{ ...s.preview, color: result > 0 ? '#8ada6a' : '#da7a6a' }}>
              {canCalc && result > 0 && (
                <span style={{ color: '#a89060' }}>
                  {amt} {fromKey.toUpperCase()}
                </span>
              )}
              {' '}{preview}
            </div>
          )}

          {!hasEnough && canCalc && (
            <p style={s.errorMsg}>Not enough {fromKey.toUpperCase()} (have {cur[fromKey] ?? 0}).</p>
          )}
          {error && <p style={s.errorMsg}>{error}</p>}
        </div>

        <div style={s.modalFooter}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...s.convertBtn, opacity: (!canCalc || result === 0 || !hasEnough) ? 0.4 : 1 }}
            disabled={!canCalc || result === 0 || !hasEnough || saving}
            onClick={handleConvert}
          >
            {saving ? 'Converting…' : 'Convert'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  root: {
    flexShrink: 0,
    background: '#0a0805',
    border:     '1px solid #2a1c08',
    borderRadius: 5,
    padding:    '0.5rem 0.75rem',
  },

  coinRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        '0.35rem',
    flexWrap:   'wrap',
  },

  coin: {
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    gap:           2,
    background:    '#0d0a05',
    border:        '1px solid #2a1c08',
    borderRadius:  4,
    padding:       '0.25rem 0.4rem',
    minWidth:      52,
  },
  coinLabel: {
    fontSize:      '0.6rem',
    fontWeight:    700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  coinAmount: {
    background:  'none',
    border:      'none',
    color:       '#e8e0d0',
    fontSize:    '0.88rem',
    fontWeight:  700,
    fontFamily:  'Georgia, serif',
    cursor:      'pointer',
    padding:     0,
    lineHeight:  1,
  },
  coinInput: {
    background:  '#0d0a05',
    border:      '1px solid #c9a84c',
    borderRadius: 3,
    color:       '#e8e0d0',
    fontSize:    '0.82rem',
    width:       46,
    textAlign:   'center',
    padding:     '0.1rem 0.2rem',
    outline:     'none',
  },

  totalBlock: {
    display:    'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap:        2,
    marginLeft: 'auto',
  },
  totalLabel: {
    color:     '#6b5a3a',
    fontSize:  '0.72rem',
    fontStyle: 'italic',
    whiteSpace: 'nowrap',
  },
  transferBtn: {
    background:  '#1a1208',
    border:      '1px solid #3a2a10',
    color:       '#a89060',
    borderRadius: 3,
    padding:     '0.15rem 0.4rem',
    cursor:      'pointer',
    fontSize:    '0.78rem',
  },

  // Modal
  modalOverlay: {
    position:   'fixed',
    inset:      0,
    background: 'rgba(0,0,0,0.6)',
    display:    'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex:     1000,
  },
  modal: {
    background:   '#12100a',
    border:       '1px solid #3a2a10',
    borderRadius: 6,
    width:        400,
    maxWidth:     '90vw',
    display:      'flex',
    flexDirection:'column',
    boxShadow:    '0 8px 32px rgba(0,0,0,0.7)',
  },
  modalHeader: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    padding:        '0.6rem 0.85rem',
    borderBottom:   '1px solid #2a1c08',
  },
  modalTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.95rem' },
  modalClose: { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.9rem', padding: 0 },
  modalBody:  { padding: '0.75rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  modalFooter:{ padding: '0.5rem 0.85rem', borderTop: '1px solid #2a1c08', display: 'flex', justifyContent: 'flex-end', gap: '0.4rem' },

  modalRow: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' },
  modalInput: {
    background:  '#0d0a05',
    border:      '1px solid #3a2a10',
    borderRadius: 3,
    color:       '#e8e0d0',
    padding:     '0.28rem 0.4rem',
    fontSize:    '0.82rem',
    outline:     'none',
  },
  modalSelect: {
    background:  '#0d0a05',
    border:      '1px solid #3a2a10',
    borderRadius: 3,
    color:       '#e8e0d0',
    padding:     '0.28rem 0.4rem',
    fontSize:    '0.82rem',
    outline:     'none',
    flex:        1,
    minWidth:    120,
  },

  ratesHint: {
    color:    '#6b5a3a',
    fontSize: '0.7rem',
    margin:   0,
    fontStyle:'italic',
  },
  preview: {
    fontFamily: 'Georgia, serif',
    fontSize:   '0.9rem',
    fontWeight: 600,
    textAlign:  'center',
    padding:    '0.35rem',
    background: '#0d0a05',
    borderRadius: 4,
    border:     '1px solid #2a1c08',
  },
  errorMsg: { color: '#da7a6a', fontSize: '0.75rem', margin: 0 },

  cancelBtn:  { background: 'transparent', border: '1px solid #3a2a10', color: '#6b5a3a', borderRadius: 3, padding: '0.28rem 0.65rem', cursor: 'pointer', fontSize: '0.8rem' },
  convertBtn: { background: '#2a3a1a', border: '1px solid #4a7a2a', color: '#8ada6a', borderRadius: 3, padding: '0.28rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 },
}
