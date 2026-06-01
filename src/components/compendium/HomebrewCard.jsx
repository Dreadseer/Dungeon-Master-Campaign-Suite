/**
 * HomebrewCard — lightweight detail panel shown when a homebrew entry
 * is clicked in an SRD browser tab (Monsters / Spells / Equipment).
 * Full editing is available in the Custom Compendium tab.
 */

const TYPE_LABELS = { item: 'Item', spell: 'Spell', equipment: 'Equipment', monster: 'Monster' }

const LEVEL_LABELS = ['Cantrip','1st','2nd','3rd','4th','5th','6th','7th','8th','9th']

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
            <span style={s.brewBadge}>Homebrew</span>
          </div>
        </div>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={s.body}>
        {/* Monster fields */}
        {type === 'monster' && (
          <>
            <Row label="Size / Type" value={[d.size, d.type].filter(Boolean).join(' ')} />
            <Row label="Challenge"   value={d.cr ? `CR ${d.cr} (${(d.xp ?? 0).toLocaleString()} XP)` : null} />
            <Row label="AC"         value={d.armor_class} />
            <Row label="HP"         value={d.hit_points ? `${d.hit_points} (${d.hit_dice ?? ''})` : null} />
            <Row label="Speed"      value={d.speed_walk ? `${d.speed_walk} ft.` : null} />
            <Row label="Alignment"  value={d.alignment} />
          </>
        )}

        {/* Spell fields */}
        {type === 'spell' && (
          <>
            <Row label="Level"        value={d.level !== undefined ? LEVEL_LABELS[d.level] : null} />
            <Row label="School"       value={d.school} />
            <Row label="Casting Time" value={d.casting_time} />
            <Row label="Range"        value={d.range} />
            <Row label="Duration"     value={d.duration} />
            {d.concentration && <p style={s.badge2}>Concentration</p>}
            {d.ritual        && <p style={s.badge2}>Ritual</p>}
            {d.description   && <p style={s.desc}>{d.description}</p>}
          </>
        )}

        {/* Item fields */}
        {type === 'item' && (
          <>
            <Row label="Item Type"  value={d.item_type} />
            <Row label="Rarity"     value={d.rarity} />
            <Row label="Cost"       value={d.cost} />
            <Row label="Weight"     value={d.weight ? `${d.weight} lb` : null} />
            {d.requires_attunement && <p style={s.badge2}>Requires Attunement</p>}
            {d.description && <p style={s.desc}>{d.description}</p>}
          </>
        )}

        {/* Equipment fields */}
        {type === 'equipment' && (
          <>
            <Row label="Category"   value={d.category} />
            <Row label="Cost"       value={d.cost} />
            <Row label="Weight"     value={d.weight ? `${d.weight} lb` : null} />
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

function Row({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <p style={s.row}>
      <span style={s.rowLabel}>{label}: </span>
      <span style={s.rowValue}>{value}</span>
    </p>
  )
}

const s = {
  card: {
    width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column',
    background: '#0a0805', border: '1px solid #3a6a3a', borderRadius: 6, overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'flex-start',
    padding: '0.7rem 0.85rem 0.5rem', borderBottom: '1px solid #2a3a2a', flexShrink: 0,
  },
  name:     { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.05rem', margin: '0 0 0.3rem' },
  badgeRow: { display: 'flex', gap: '0.35rem' },
  typeBadge: { background: '#1a2a1a', border: '1px solid #3a5a3a', color: '#7aba7a', fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 3 },
  brewBadge: { background: '#2a1a3a', border: '1px solid #5a3a7a', color: '#aa7aca', fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 3 },
  closeBtn: { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.9rem', padding: 0, lineHeight: 1, flexShrink: 0 },

  body:      { flex: 1, padding: '0.65rem 0.85rem', overflowY: 'auto' },
  row:       { margin: '0.2rem 0', fontSize: '0.8rem', lineHeight: 1.45 },
  rowLabel:  { color: '#6b5a3a' },
  rowValue:  { color: '#e8e0d0' },
  badge2:    { display: 'inline-block', background: '#1a2a3a', border: '1px solid #2a4a6a', color: '#6aaada', fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 10, margin: '0.15rem 0' },
  desc:      { color: '#a89060', fontSize: '0.78rem', lineHeight: 1.5, margin: '0.4rem 0 0', fontStyle: 'italic' },

  footer: { borderTop: '1px solid #2a3a2a', padding: '0.45rem 0.85rem', flexShrink: 0 },
  hint:   { color: '#6b5a3a', fontSize: '0.75rem', margin: 0 },
}
