const TYPE_LABELS  = { item: 'Item', spell: 'Spell', equipment: 'Equipment', monster: 'Monster' }
const LEVEL_LABELS = ['Cantrip','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']
const ABILITIES    = ['str','dex','con','int','wis','cha']

export default function HomebrewCard({ entry, onClose }) {
  if (!entry) return null

  let d = {}
  try { d = JSON.parse(entry.data_raw ?? '{}') } catch { d = {} }

  const type = entry.type

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={s.name}>{entry.name}</h2>
          <div style={s.badgeRow}>
            <span style={s.typeBadge}>{TYPE_LABELS[type] ?? type}</span>
            {entry.source === 'source_book'
              ? <span style={s.srcBadge}>Source Book</span>
              : <span style={s.brewBadge}>Homebrew</span>
            }
          </div>
        </div>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={s.body}>

        {/* ── Monster full stat block ── */}
        {type === 'monster' && <MonsterBlock d={d} />}

        {/* ── Spell ── */}
        {type === 'spell' && (
          <>
            <Row label="Level"        value={d.level !== undefined ? LEVEL_LABELS[d.level] : null} />
            <Row label="School"       value={d.school} />
            <Row label="Casting Time" value={d.casting_time} />
            <Row label="Range"        value={d.range} />
            <Row label="Duration"     value={d.duration} />
            <Row label="Components"   value={[d.components_v && 'V', d.components_s && 'S', d.components_m && 'M'].filter(Boolean).join(', ') || null} />
            {d.material      && <Row label="Material" value={d.material} />}
            {d.concentration && <span style={s.badge2}>Concentration</span>}
            {d.ritual        && <span style={s.badge2}>Ritual</span>}
            {d.classes       && <Row label="Classes" value={d.classes} />}
            {d.description   && <p style={s.desc}>{d.description}</p>}
            {d.higher_levels && <p style={s.higherLevels}><em>At Higher Levels.</em> {d.higher_levels}</p>}
          </>
        )}

        {/* ── Item ── */}
        {type === 'item' && (
          <>
            <Row label="Item Type" value={d.item_type} />
            <Row label="Rarity"    value={d.rarity} />
            <Row label="Cost"      value={d.cost} />
            <Row label="Weight"    value={d.weight ? `${d.weight} lb` : null} />
            {d.requires_attunement && <span style={s.badge2}>Requires Attunement</span>}
            {d.description && <p style={s.desc}>{d.description}</p>}
          </>
        )}

        {/* ── Equipment ── */}
        {type === 'equipment' && (
          <>
            <Row label="Category" value={d.category} />
            <Row label="Cost"     value={d.cost} />
            <Row label="Weight"   value={d.weight ? `${d.weight} lb` : null} />
            {d.weapon_damage && <>
              <Row label="Damage"     value={`${d.weapon_damage} ${d.weapon_type ?? ''}`} />
              <Row label="Properties" value={d.weapon_properties} />
            </>}
            {d.armor_base_ac > 0 && <>
              <Row label="Base AC" value={d.armor_base_ac} />
              {d.armor_min_str > 0  && <Row label="Min STR" value={d.armor_min_str} />}
              {d.armor_stealth_disadvantage && <span style={s.badge2}>Stealth Disadvantage</span>}
            </>}
            {d.description && <p style={s.desc}>{d.description}</p>}
          </>
        )}

      </div>

      <div style={s.footer}>
        <p style={s.hint}>✏ Manage this entry in the <strong style={{ color: '#c9a84c' }}>Custom</strong> tab.</p>
      </div>
    </div>
  )
}

// ── Full monster stat block ───────────────────────────────────────────────────

function MonsterBlock({ d }) {
  const mod = n => { const m = Math.floor(((n ?? 10) - 10) / 2); return (m >= 0 ? '+' : '') + m }

  return (
    <>
      {/* Type line */}
      <p style={s.typeLine}>
        {[d.size, d.type, d.alignment].filter(Boolean).join(' · ')}
      </p>

      <div style={s.divider} />

      {/* Core stats */}
      <Row label="AC" value={d.armor_class ? `${d.armor_class}${d.armor_type ? ` (${d.armor_type})` : ''}` : null} />
      <Row label="HP" value={d.hit_points  ? `${d.hit_points}${d.hit_dice ? ` (${d.hit_dice})` : ''}` : null} />
      <Row label="Speed"     value={d.speed_walk} />
      <Row label="Challenge" value={d.cr    ? `${d.cr} (${(d.xp ?? 0).toLocaleString()} XP)` : null} />

      <div style={s.divider} />

      {/* Ability scores */}
      <div style={s.abilityGrid}>
        {ABILITIES.map(a => (
          <div key={a} style={s.abilityCell}>
            <div style={s.abilityLabel}>{a.toUpperCase()}</div>
            <div style={s.abilityScore}>{d[a] ?? '—'}</div>
            <div style={s.abilityMod}>{d[a] != null ? mod(d[a]) : ''}</div>
          </div>
        ))}
      </div>

      <div style={s.divider} />

      {/* Proficiencies & traits */}
      {d.save_proficiencies?.length > 0 &&
        <Row label="Saves" value={d.save_proficiencies.map(a => `${a.toUpperCase()} ${mod(d[a] ?? 10)}`).join(', ')} />}
      {d.damage_resistances   && <Row label="Resistances"  value={d.damage_resistances} />}
      {d.damage_immunities    && <Row label="Immunities"   value={d.damage_immunities} />}
      {d.damage_vulnerabilities && <Row label="Vulnerable" value={d.damage_vulnerabilities} />}
      {d.condition_immunities && <Row label="Cond. Immune" value={d.condition_immunities} />}
      {d.senses               && <Row label="Senses"       value={d.senses} />}
      {d.languages            && <Row label="Languages"    value={d.languages} />}

      {/* Special abilities */}
      {d.special_abilities?.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Special Abilities</div>
          {d.special_abilities.map((a, i) => (
            <p key={i} style={s.traitText}>
              <strong style={s.traitName}>{a.name}.</strong> {a.description}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      {d.actions?.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Actions</div>
          {d.actions.map((a, i) => (
            <p key={i} style={s.traitText}>
              <strong style={s.traitName}>{a.name}.</strong> {a.description}
            </p>
          ))}
        </div>
      )}

      {/* Legendary actions */}
      {d.legendary_actions_text && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Legendary Actions</div>
          <p style={s.traitText}>{d.legendary_actions_text}</p>
        </div>
      )}
    </>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function Row({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <p style={s.row}>
      <span style={s.rowLabel}>{label}: </span>
      <span style={s.rowValue}>{value}</span>
    </p>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  card: {
    width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
    background: '#0a0805', border: '1px solid #3a6a3a', borderRadius: 6, overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'flex-start',
    padding: '0.7rem 0.85rem 0.5rem', borderBottom: '1px solid #2a3a2a', flexShrink: 0,
  },
  name:      { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.05rem', margin: '0 0 0.3rem' },
  badgeRow:  { display: 'flex', gap: '0.35rem', flexWrap: 'wrap' },
  typeBadge: { background: '#1a2a1a', border: '1px solid #3a5a3a', color: '#7aba7a', fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 3 },
  brewBadge: { background: '#2a1a3a', border: '1px solid #5a3a7a', color: '#aa7aca', fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 3 },
  srcBadge:  { background: '#1a1a0a', border: '1px solid #5a4a1a', color: '#c9a84c', fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 3 },
  closeBtn:  { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.9rem', padding: 0, lineHeight: 1, flexShrink: 0 },

  body:     { flex: 1, padding: '0.65rem 0.85rem', overflowY: 'auto' },
  typeLine: { color: '#a89060', fontSize: '0.78rem', fontStyle: 'italic', margin: '0 0 0.4rem' },
  divider:  { borderTop: '1px solid #2a3a2a', margin: '0.4rem 0' },

  row:      { margin: '0.18rem 0', fontSize: '0.79rem', lineHeight: 1.45 },
  rowLabel: { color: '#6b5a3a' },
  rowValue: { color: '#e8e0d0' },

  abilityGrid:  { display: 'flex', gap: 4, margin: '0.3rem 0' },
  abilityCell:  { flex: 1, background: '#1a1208', borderRadius: 4, padding: '3px 2px', textAlign: 'center' },
  abilityLabel: { color: '#a89060', fontSize: '0.6rem', fontWeight: 700 },
  abilityScore: { color: '#e8e0d0', fontSize: '0.82rem', fontWeight: 700 },
  abilityMod:   { color: '#c9a84c', fontSize: '0.68rem' },

  section:      { marginTop: '0.5rem' },
  sectionTitle: { color: '#c9a84c', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #2a1c08', paddingBottom: 2, marginBottom: 4 },
  traitText:    { color: '#c9c0a8', fontSize: '0.78rem', lineHeight: 1.55, margin: '0.3rem 0' },
  traitName:    { color: '#e8e0d0' },

  badge2:       { display: 'inline-block', background: '#1a2a3a', border: '1px solid #2a4a6a', color: '#6aaada', fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 10, margin: '0.15rem 0.15rem 0.15rem 0' },
  desc:         { color: '#a89060', fontSize: '0.78rem', lineHeight: 1.6, margin: '0.4rem 0 0' },
  higherLevels: { color: '#8a7050', fontSize: '0.75rem', lineHeight: 1.5, margin: '0.3rem 0 0', fontStyle: 'italic' },

  footer: { borderTop: '1px solid #2a3a2a', padding: '0.45rem 0.85rem', flexShrink: 0 },
  hint:   { color: '#6b5a3a', fontSize: '0.75rem', margin: 0 },
}
