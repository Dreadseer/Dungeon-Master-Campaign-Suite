import { useState } from 'react'
import useToastStore from '../../stores/toastStore'

// Mounted once, in App.jsx. Renders the toast queue as a fixed stack in the
// bottom-right. Errors stay long enough to read (8s) and can be expanded to show
// the underlying technical message when one was rewritten for readability.

export default function Toasts() {
  const toasts = useToastStore(s => s.toasts)
  const dismiss = useToastStore(s => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div style={s.stack} role="status" aria-live="polite">
      {toasts.map(t => (
        <Toast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function Toast({ toast, onDismiss }) {
  const [showDetail, setShowDetail] = useState(false)
  const tone = TONES[toast.kind] ?? TONES.info

  return (
    <div style={{ ...s.toast, borderLeftColor: tone.accent }}>
      <span style={{ ...s.icon, color: tone.accent }}>{tone.icon}</span>

      <div style={s.body}>
        <p style={s.message}>{toast.message}</p>

        {toast.detail && (
          <>
            <button
              style={s.detailToggle}
              onClick={() => setShowDetail(v => !v)}
            >
              {showDetail ? 'Hide details' : 'Show details'}
            </button>
            {showDetail && <pre style={s.detail}>{toast.detail}</pre>}
          </>
        )}
      </div>

      <button style={s.close} onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  )
}

const TONES = {
  error:   { accent: '#e05050', icon: '⚠' },
  success: { accent: '#5ba85b', icon: '✓' },
  info:    { accent: '#c9a84c', icon: 'ℹ' },
}

const s = {
  stack: {
    position: 'fixed', bottom: '1.25rem', right: '1.25rem', zIndex: 9999,
    display: 'flex', flexDirection: 'column', gap: '0.6rem',
    maxWidth: 420, pointerEvents: 'none',
  },
  toast: {
    pointerEvents: 'auto',
    display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
    background: '#15100a', border: '1px solid #3a2a10', borderLeft: '3px solid',
    borderRadius: 4, padding: '0.7rem 0.8rem',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
  },
  icon:    { fontSize: '0.95rem', lineHeight: 1.4, flexShrink: 0 },
  body:    { flex: 1, minWidth: 0 },
  message: { color: '#e8e0d0', fontSize: '0.86rem', margin: 0, lineHeight: 1.45, wordBreak: 'break-word' },
  detailToggle: {
    background: 'none', border: 'none', color: '#a89060', fontSize: '0.75rem',
    padding: '0.3rem 0 0', cursor: 'pointer', textDecoration: 'underline',
  },
  detail: {
    color: '#6b5a3a', fontSize: '0.72rem', margin: '0.35rem 0 0',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace',
  },
  close: {
    background: 'none', border: 'none', color: '#6b5a3a', fontSize: '1.1rem',
    lineHeight: 1, padding: '0 0 0 0.3rem', cursor: 'pointer', flexShrink: 0,
  },
}
