import { useState, useEffect } from 'react'

export default function NPCQuickView({ npc, onClose, onEdit }) {
  const [secretsRevealed, setSecretsRevealed] = useState(false)

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Reset secrets on NPC change
  useEffect(() => { setSecretsRevealed(false) }, [npc?.id])

  if (!npc) return null

  const subtitle = [npc.race, npc.role || npc.class].filter(Boolean).join(' ')

  return (
    <>
      {/* Click-outside backdrop */}
      <div style={s.backdrop} onClick={onClose} />

      <div style={s.panel}>
        <div style={s.header}>
          <div>
            <h2 style={s.name}>{npc.is_alive ? '🟢' : '💀'} {npc.name}</h2>
            {subtitle && <p style={s.subtitle}>{subtitle}</p>}
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          {npc.location_name && (
            <div style={s.field}>
              <span style={s.fieldLabel}>Location</span>
              <span style={s.fieldValue}>{npc.location_name}</span>
            </div>
          )}
          {npc.faction_name && (
            <div style={s.field}>
              <span style={s.fieldLabel}>Faction</span>
              <span style={s.fieldValue}>{npc.faction_name}</span>
            </div>
          )}
          {npc.motivation && (
            <div style={s.section}>
              <div style={s.sectionLabel}>Motivation</div>
              <p style={s.sectionText}>{npc.motivation}</p>
            </div>
          )}
          {npc.notes && (
            <div style={s.section}>
              <div style={s.sectionLabel}>DM Notes</div>
              <p style={s.sectionText}>{npc.notes}</p>
            </div>
          )}
          {npc.secrets && (
            <div style={{ ...s.section, ...s.secretsSection }}>
              <div style={s.sectionLabel}>
                🔒 Secrets
                <button style={s.revealBtn} onClick={() => setSecretsRevealed(r => !r)}>
                  {secretsRevealed ? 'Hide' : 'Reveal 🔒'}
                </button>
              </div>
              {secretsRevealed && <p style={{ ...s.sectionText, color: '#c07070' }}>{npc.secrets}</p>}
            </div>
          )}
        </div>

        <div style={s.footer}>
          <button style={s.btnPrimary} onClick={() => { onEdit(npc); onClose() }}>
            Edit Full Profile
          </button>
        </div>
      </div>
    </>
  )
}

const s = {
  backdrop:      { position: 'fixed', inset: 0, zIndex: 199 },
  panel:         { position: 'fixed', top: 0, right: 0, bottom: 0, width: 360, background: '#1a1208', borderLeft: '1px solid #3a2a10', zIndex: 200, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.6)' },
  header:        { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid #2a1c08' },
  name:          { color: '#c9a84c', fontSize: '1.2rem', margin: 0, fontFamily: 'Georgia, serif' },
  subtitle:      { color: '#a89060', fontSize: '0.82rem', margin: '0.25rem 0 0' },
  closeBtn:      { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '1rem', padding: '0.1rem 0.2rem', lineHeight: 1 },
  body:          { flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' },
  field:         { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel:    { color: '#6b5a3a', fontSize: '0.78rem' },
  fieldValue:    { color: '#e8e0d0', fontSize: '0.88rem' },
  section:       { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  sectionLabel:  { color: '#7a6035', fontSize: '0.72rem', fontWeight: 'bold', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionText:   { color: '#c8bfa8', fontSize: '0.88rem', lineHeight: 1.6, margin: 0 },
  secretsSection:{ background: '#120808', border: '1px solid #3a1a1a', borderRadius: 4, padding: '0.6rem 0.75rem' },
  revealBtn:     { background: 'none', border: '1px solid #6a2020', color: '#c06060', borderRadius: 3, padding: '0.1rem 0.4rem', cursor: 'pointer', fontSize: '0.72rem' },
  footer:        { padding: '1rem 1.25rem', borderTop: '1px solid #2a1c08' },
  btnPrimary:    { width: '100%', background: '#c9a84c', color: '#0d0a05', border: 'none', padding: '0.6rem', borderRadius: 4, cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' },
}
