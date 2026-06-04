// Triggered by clicking 🎯 on a concentrating combatant
export default function SpellCardPanel({ combatant, onDropConcentration, onClose }) {
  if (!combatant) return null

  const spellName = combatant.concentration_spell || null

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.icon}>🎯</span>
          <div>
            <div style={s.spellName}>{spellName ?? 'Active Concentration'}</div>
            <div style={s.casterLine}>{combatant.name} is concentrating</div>
          </div>
        </div>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={s.body}>
        {spellName ? (
          <>
            <div style={s.section}>
              <div style={s.sectionLabel}>Concentration Ends When</div>
              <ul style={s.ruleList}>
                <li style={s.ruleItem}>{combatant.name} loses concentration (failed CON save)</li>
                <li style={s.ruleItem}>{combatant.name} is incapacitated or killed</li>
                <li style={s.ruleItem}>{combatant.name} casts another concentration spell</li>
                <li style={s.ruleItem}>The spell's duration expires</li>
              </ul>
            </div>

            <div style={s.section}>
              <div style={s.sectionLabel}>Concentration Check</div>
              <p style={s.ruleText}>
                When {combatant.name} takes damage, make a CON save DC equal to
                half the damage taken (minimum DC 10). On a failure, concentration ends.
              </p>
            </div>
          </>
        ) : (
          <div style={s.section}>
            <div style={s.sectionLabel}>Concentration Rules</div>
            <ul style={s.ruleList}>
              <li style={s.ruleItem}>Takes damage → CON save DC max(10, damage÷2)</li>
              <li style={s.ruleItem}>Incapacitated or killed → automatic failure</li>
              <li style={s.ruleItem}>Casts another concentration spell → previous ends</li>
            </ul>
          </div>
        )}
      </div>

      <div style={s.footer}>
        <button style={s.dropBtn} onClick={() => { onDropConcentration(combatant.id); onClose() }}>
          Drop Concentration
        </button>
      </div>
    </div>
  )
}

const s = {
  panel: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    width: 280, zIndex: 20,
    background: '#1a1a1a', borderLeft: '1px solid #4a2a6a',
    display: 'flex', flexDirection: 'column',
    boxShadow: '-4px 0 16px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '12px 14px', background: '#1e0e2e', borderBottom: '1px solid #3a1a5a',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  icon:       { fontSize: 22, marginTop: 2 },
  spellName:  { color: '#b07cf7', fontSize: 15, fontWeight: 700 },
  casterLine: { color: '#777', fontSize: 12, marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: '#666',
    cursor: 'pointer', fontSize: 16, padding: '0 2px',
  },
  body: { flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 },
  section:      { display: 'flex', flexDirection: 'column', gap: 6 },
  sectionLabel: { color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
  ruleList: { margin: '0 0 0 16px', padding: 0 },
  ruleItem: { color: '#888', fontSize: 12, lineHeight: 1.6, marginBottom: 2 },
  ruleText: { color: '#888', fontSize: 12, lineHeight: 1.5, margin: 0 },
  footer: {
    padding: '10px 14px', borderTop: '1px solid #3a1a5a',
    background: '#1e0e2e', flexShrink: 0,
  },
  dropBtn: {
    width: '100%', padding: '8px', background: '#2a1a3a',
    border: '1px solid #6a3a9a', borderRadius: 5,
    color: '#b07cf7', cursor: 'pointer', fontSize: 13,
    fontWeight: 600,
  },
}
