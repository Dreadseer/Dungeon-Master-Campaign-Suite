// Condensed stat block slide-in panel — triggered by clicking a combatant name
// For players: AC, saving throws, HP. For monsters: condensed SRD data.

const ABILITY_NAMES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']
const ABILITY_KEYS  = ['str', 'dex', 'con', 'int', 'wis', 'cha']

const mod = (score) => {
  const m = Math.floor((score - 10) / 2)
  return (m >= 0 ? '+' : '') + m
}

export default function CombatStatBlock({ combatant, onClose }) {
  if (!combatant) return null

  const se = combatant.source_entry ?? {}

  // Parse stats JSON for player characters
  let stats = {}
  if (combatant.is_player) {
    try { stats = JSON.parse(se.stats ?? '{}') } catch { /* empty */ }
  }

  // Parse actions / special abilities for monsters
  let actions = []
  let specialAbilities = []
  try {
    if (se.data) {
      const parsed = typeof se.data === 'string' ? JSON.parse(se.data) : se.data
      actions = parsed.actions ?? []
      specialAbilities = parsed.special_abilities ?? []
    } else {
      actions = se.actions ?? []
      specialAbilities = se.special_abilities ?? []
    }
  } catch { /* empty */ }

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.name}>{combatant.name}</span>
          {!combatant.is_player && se.type && (
            <span style={s.subtype}>{se.size ?? ''} {se.type ?? ''}</span>
          )}
        </div>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={s.body}>
        {/* Core stats row */}
        <div style={s.statRow}>
          <div style={s.statCell}>
            <div style={s.statLabel}>HP</div>
            <div style={s.statVal}>{combatant.hp_current}<span style={s.statMax}>/{combatant.hp_max}</span></div>
          </div>
          <div style={s.statCell}>
            <div style={s.statLabel}>AC</div>
            <div style={s.statVal}>{combatant.ac}</div>
          </div>
          {!combatant.is_player && se.challenge_rating !== undefined && (
            <div style={s.statCell}>
              <div style={s.statLabel}>CR</div>
              <div style={s.statVal}>{se.challenge_rating}</div>
            </div>
          )}
          {!combatant.is_player && se.speed && (
            <div style={s.statCell}>
              <div style={s.statLabel}>Speed</div>
              <div style={s.statVal}>{typeof se.speed === 'object' ? (se.speed.walk ?? '—') : se.speed} ft</div>
            </div>
          )}
        </div>

        {/* Ability scores */}
        {combatant.is_player ? (
          Object.keys(stats).length > 0 && (
            <div style={s.abilityGrid}>
              {ABILITY_KEYS.map((key, i) => (
                <div key={key} style={s.abilityCell}>
                  <div style={s.abilityLabel}>{ABILITY_NAMES[i]}</div>
                  <div style={s.abilityScore}>{stats[key] ?? '—'}</div>
                  <div style={s.abilityMod}>{stats[key] ? mod(stats[key]) : '—'}</div>
                </div>
              ))}
            </div>
          )
        ) : (
          (se.str !== undefined) && (
            <div style={s.abilityGrid}>
              {ABILITY_KEYS.map((key, i) => (
                <div key={key} style={s.abilityCell}>
                  <div style={s.abilityLabel}>{ABILITY_NAMES[i]}</div>
                  <div style={s.abilityScore}>{se[key] ?? '—'}</div>
                  <div style={s.abilityMod}>{se[key] ? mod(se[key]) : '—'}</div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Special abilities */}
        {specialAbilities.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionLabel}>Special Abilities</div>
            {specialAbilities.slice(0, 3).map((a, i) => (
              <div key={i} style={s.actionBlock}>
                <span style={s.actionName}>{a.name}. </span>
                <span style={s.actionDesc}>{a.desc}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        {actions.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionLabel}>Actions</div>
            {actions.slice(0, 5).map((a, i) => (
              <div key={i} style={s.actionBlock}>
                <span style={s.actionName}>{a.name}. </span>
                <span style={s.actionDesc}>{a.desc}</span>
              </div>
            ))}
            {actions.length > 5 && (
              <p style={s.more}>+{actions.length - 5} more actions</p>
            )}
          </div>
        )}

        {/* Player: saving throw proficiencies */}
        {combatant.is_player && se.saving_throws && (
          <div style={s.section}>
            <div style={s.sectionLabel}>Saving Throw Proficiencies</div>
            <p style={s.plainText}>{se.saving_throws}</p>
          </div>
        )}

        {/* Player: spell slots */}
        {combatant.is_player && (() => {
          try {
            const slots = JSON.parse(se.spell_slots ?? '{}')
            const slotEntries = Object.entries(slots).filter(([k]) => k !== 'known_spells' && !isNaN(k))
            if (slotEntries.length === 0) return null
            return (
              <div style={s.section}>
                <div style={s.sectionLabel}>Spell Slots</div>
                <div style={s.slotRow}>
                  {slotEntries.map(([lvl, v]) => (
                    <div key={lvl} style={s.slotCell}>
                      <div style={s.slotLevel}>L{lvl}</div>
                      <div style={s.slotVal}>{v.max - v.used}/{v.max}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          } catch { return null }
        })()}
      </div>
    </div>
  )
}

const s = {
  panel: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    width: 300, zIndex: 20,
    background: '#1a1a1a', borderLeft: '1px solid #444',
    display: 'flex', flexDirection: 'column',
    boxShadow: '-4px 0 16px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '12px 14px', background: '#222', borderBottom: '1px solid #333',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 2 },
  name:    { color: '#c9a84c', fontSize: 15, fontWeight: 700 },
  subtype: { color: '#777', fontSize: 11 },
  closeBtn: {
    background: 'none', border: 'none', color: '#666',
    cursor: 'pointer', fontSize: 16, padding: '0 2px', flexShrink: 0,
  },
  body: { flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
  statRow:  { display: 'flex', gap: 8, flexWrap: 'wrap' },
  statCell: { textAlign: 'center', minWidth: 48 },
  statLabel: { color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
  statVal:   { color: '#e0d5c0', fontSize: 18, fontWeight: 700 },
  statMax:   { color: '#555', fontSize: 12, fontWeight: 400 },
  abilityGrid: { display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 4 },
  abilityCell:  { textAlign: 'center', background: '#111', borderRadius: 4, padding: '4px 2px' },
  abilityLabel: { color: '#666', fontSize: 9, textTransform: 'uppercase' },
  abilityScore: { color: '#e0d5c0', fontSize: 13, fontWeight: 600 },
  abilityMod:   { color: '#c9a84c', fontSize: 10 },
  section:      { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionLabel: { color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
  actionBlock:  { fontSize: 11, lineHeight: 1.4 },
  actionName:   { color: '#c9a84c', fontWeight: 600 },
  actionDesc:   { color: '#888' },
  more:         { color: '#555', fontSize: 11, margin: 0 },
  plainText:    { color: '#888', fontSize: 12, margin: 0 },
  slotRow:      { display: 'flex', gap: 6, flexWrap: 'wrap' },
  slotCell:     { textAlign: 'center', minWidth: 32 },
  slotLevel:    { color: '#666', fontSize: 9 },
  slotVal:      { color: '#7ab0ff', fontSize: 12, fontWeight: 600 },
}
