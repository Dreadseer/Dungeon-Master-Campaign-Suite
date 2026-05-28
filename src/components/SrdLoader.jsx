import { useState, useEffect, useRef } from 'react'

export default function SrdLoader() {
  const [visible, setVisible]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [percent, setPercent]   = useState(0)
  const [message, setMessage]   = useState('')
  const [toast, setToast]       = useState(false)
  const listenerSet = useRef(false)

  useEffect(() => {
    window.electronAPI.srd.getCacheStats().then(stats => {
      const types = stats.map(s => s.resource_type)
      const allCached = ['monster','spell','equipment','class'].every(t => types.includes(t))
      if (!allCached) setVisible(true)
    })
  }, [])

  useEffect(() => {
    if (listenerSet.current) return
    listenerSet.current = true
    window.electronAPI.srd.onProgress(({ percent: p, message: m }) => {
      setPercent(p)
      setMessage(m)
    })
  }, [])

  async function handleLoad() {
    setLoading(true)
    setPercent(0)
    setMessage('Starting...')
    await window.electronAPI.srd.seedAll()
    setLoading(false)
    setVisible(false)
    setToast(true)
    setTimeout(() => setToast(false), 3000)
  }

  if (!visible && !toast) return null

  return (
    <>
      {visible && (
        <div style={styles.overlay}>
          <div style={styles.card}>
            <h2 style={styles.heading}>⚔ Load Game Data</h2>
            <p style={styles.body}>
              Download D&amp;D 5e monsters, spells, equipment, and classes from the SRD.
              This only happens once and takes 2–5 minutes.
            </p>

            {loading && (
              <div style={styles.progressWrap}>
                <div style={{ ...styles.progressBar, width: percent + '%' }} />
              </div>
            )}
            {loading && <p style={styles.progressMsg}>{message}</p>}

            <div style={styles.buttons}>
              <button style={styles.btnPrimary} onClick={handleLoad} disabled={loading}>
                {loading ? 'Loading...' : 'Load Game Data'}
              </button>
              <button style={styles.btnSecondary} onClick={() => setVisible(false)} disabled={loading}>
                Skip for now (offline)
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={styles.toast}>Game data ready!</div>
      )}
    </>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  card: {
    background: '#1a1208', border: '1px solid #c9a84c', borderRadius: 8,
    padding: '2rem', width: 480, maxWidth: '90vw',
  },
  heading: {
    color: '#c9a84c', fontSize: '1.4rem', marginBottom: '1rem',
  },
  body: {
    color: '#e8e0d0', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '1.5rem',
  },
  progressWrap: {
    background: '#2d1f0a', borderRadius: 4, height: 12,
    overflow: 'hidden', marginBottom: '0.5rem',
  },
  progressBar: {
    background: '#c9a84c', height: '100%',
    transition: 'width 0.3s ease', borderRadius: 4,
  },
  progressMsg: {
    color: '#a89060', fontSize: '0.85rem', marginBottom: '1.5rem', minHeight: '1.2em',
  },
  buttons: {
    display: 'flex', gap: '1rem', flexWrap: 'wrap',
  },
  btnPrimary: {
    background: '#c9a84c', color: '#0d0a05', border: 'none',
    padding: '0.6rem 1.4rem', borderRadius: 4, cursor: 'pointer',
    fontWeight: 'bold', fontSize: '0.95rem',
  },
  btnSecondary: {
    background: 'transparent', color: '#a89060',
    border: '1px solid #a89060', padding: '0.6rem 1.4rem',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.95rem',
  },
  toast: {
    position: 'fixed', bottom: '2rem', right: '2rem',
    background: '#2d4a1e', color: '#8fbc5a', border: '1px solid #8fbc5a',
    padding: '0.75rem 1.5rem', borderRadius: 6, zIndex: 1001,
    fontSize: '0.95rem', fontWeight: 'bold',
  },
}
