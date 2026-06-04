import { useState, useEffect } from 'react'
import { abilityMod, modStr } from '../../utils/dnd5e'

const ABILITY_LABELS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']
const ABILITY_KEYS   = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']

export default function MonsterStatBlock({ index, onClose }) {
  const [monster, setMonster] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast,   setToast]   = useState('')

  useEffect(() => {
    setLoading(true)
    setMonster(null)
    window.electronAPI.srd.getMonsterByIndex(index)
      .then(m => { setMonster(m); setLoading(false) })
      .catch(() => setLoading(false))
  }, [index])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  if (loading) return (
    <div style={s.panel}>
      <div style={s.panelHeader}>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>
      <p style={s.msg}>Loading…</p>
    </div>
  )

  if (!monster) return (
    <div style={s.panel}>
      <div style={s.panelHeader}>
        <span style={s.mName}>Not found</span>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>
      <p style={s.msg}>Monster data not available.</p>
    </div>
  )

  return (
    <div style={s.panel}>
      {/* Toast notification */}
      {toast && <div style={s.toast}>{toast}</div>}

      {/* Header */}
      <div style={s.panelHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={s.mName}>{monster.name}</h2>
          <p style={s.mMeta}>
            {[monster.size, monster.type, monster.alignment].filter(Boolean).join(', ')}
          </p>
        </div>
        <button style={s.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      {/* Scrollable body */}
      <div style={s.scrollBody}>
        {/* Combat stats */}
        <div style={s.combatRow}>
          <StatBox label="AC"    value={formatAC(monster.armor_class)} />
          <StatBox label="HP"    value={`${monster.hit_points}`} sub={monster.hit_points_roll ?? monster.hit_dice} />
          <StatBox label="Speed" value={formatSpeed(monster.speed)} />
        </div>

        <Divider />

        {/* Ability scores */}
        <div style={s.abilityGrid}>
          {ABILITY_LABELS.map((label, i) => {
            const score = monster[ABILITY_KEYS[i]] ?? 10
            return (
              <div key={label} style={s.abilityCell}>
                <span style={s.abilityLabel}>{label}</span>
                <span style={s.abilityScore}>{score}</span>
                <span style={s.abilityMod}>{modStr(score)}</span>
              </div>
            )
          })}
        </div>

        <Divider />

        {/* Traits block */}
        <div style={s.traitBlock}>
          <TraitRow label="Saving Throws" value={
            monster.proficiencies
              ?.filter(p => p.proficiency.index.startsWith('saving-throw'))
              .map(p => `${p.proficiency.name.replace('Saving Throw: ', '')} +${p.value}`)
              .join(', ')
          } />
          <TraitRow label="Skills" value={
            monster.proficiencies
              ?.filter(p => p.proficiency.index.startsWith('skill'))
              .map(p => `${p.proficiency.name.replace('Skill: ', '')} +${p.value}`)
              .join(', ')
          } />
          <TraitRow label="Damage Immunities"      value={monster.damage_immunities?.join(', ')} />
          <TraitRow label="Damage Resistances"     value={monster.damage_resistances?.join(', ')} />
          <TraitRow label="Damage Vulnerabilities" value={monster.damage_vulnerabilities?.join(', ')} />
          <TraitRow label="Condition Immunities"   value={monster.condition_immunities?.map(c => c.name).join(', ')} />
          <TraitRow label="Senses"     value={formatSenses(monster.senses)} />
          <TraitRow label="Languages"  value={monster.languages} />
          <TraitRow label="Challenge"  value={`${monster.challenge_rating} (${(monster.xp ?? 0).toLocaleString()} XP)`} />
        </div>

        {/* Special Abilities */}
        {monster.special_abilities?.length > 0 && (
          <Section title="Special Abilities">
            {monster.special_abilities.map((a, i) => (
              <ActionEntry key={i} name={a.name} desc={a.desc} italic />
            ))}
          </Section>
        )}

        {/* Actions */}
        {monster.actions?.length > 0 && (
          <Section title="Actions">
            {monster.actions.map((a, i) => (
              <ActionEntry key={i} name={a.name} desc={a.desc} />
            ))}
          </Section>
        )}

        {/* Reactions */}
        {monster.reactions?.length > 0 && (
          <Section title="Reactions">
            {monster.reactions.map((a, i) => (
              <ActionEntry key={i} name={a.name} desc={a.desc} />
            ))}
          </Section>
        )}

        {/* Legendary Actions */}
        {monster.legendary_actions?.length > 0 && (
          <Section title="Legendary Actions">
            {monster.legendary_actions.map((a, i) => (
              <ActionEntry key={i} name={a.name} desc={a.desc} />
            ))}
          </Section>
        )}
      </div>

      {/* Footer actions */}
      <div style={s.footer}>
        <button style={s.actionBtn} onClick={() => showToast('⚔ Encounter Builder coming in Phase 5')}>
          + Encounter
        </button>
        <button style={s.actionBtn} onClick={() => showToast('🗺 Open a map first to place a token')}>
          🪙 Map Token
        </button>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBox({ label, value, sub }) {
  return (
    <div style={s.statBox}>
      <span style={s.statLabel}>{label}</span>
      <span style={s.statVal}>{value}</span>
      {sub && <span style={s.statSub}>({sub})</span>}
    </div>
  )
}

function Divider() {
  return <hr style={s.divider} />
}

function TraitRow({ label, value }) {
  if (!value) return null
  return (
    <p style={s.traitRow}>
      <strong style={s.traitLabel}>{label}: </strong>
      <span style={s.traitValue}>{value}</span>
    </p>
  )
}

function Section({ title, children }) {
  return (
    <div style={s.section}>
      <h3 style={s.sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

function ActionEntry({ name, desc, italic }) {
  return (
    <p style={s.actionEntry}>
      <strong style={s.actionName}>{name}. </strong>
      <span style={italic ? { ...s.actionDesc, fontStyle: 'italic' } : s.actionDesc}>{desc}</span>
    </p>
  )
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatAC(ac) {
  if (!ac) return '—'
  if (typeof ac === 'number') return String(ac)
  if (Array.isArray(ac)) {
    return ac.map(a => {
      let str = String(a.value ?? '?')
      if (a.type && a.type !== 'natural') str += ` (${a.type})`
      if (a.armor?.length) str += ` (${a.armor.map(x => x.name).join(', ')})`
      return str
    }).join(', ')
  }
  return String(ac)
}

function formatSpeed(speed) {
  if (!speed) return '—'
  if (typeof speed === 'string') return speed
  const parts = []
  if (speed.walk)   parts.push(`${speed.walk} ft.`)
  if (speed.fly)    parts.push(`Fly ${speed.fly} ft.`)
  if (speed.swim)   parts.push(`Swim ${speed.swim} ft.`)
  if (speed.climb)  parts.push(`Climb ${speed.climb} ft.`)
  if (speed.burrow) parts.push(`Burrow ${speed.burrow} ft.`)
  if (speed.hover)  parts.push(`(hover)`)
  return parts.join(', ') || '—'
}

function formatSenses(senses) {
  if (!senses) return null
  return Object.entries(senses)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
    .join(', ')
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  panel: {
    width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column',
    background: '#0a0805', border: '1px solid #2a1c08', borderRadius: 6, overflow: 'hidden',
  },
  toast: {
    background: '#1a3a1a', border: '1px solid #3a6a3a', color: '#8ada8a',
    fontSize: '0.78rem', padding: '0.3rem 0.75rem', margin: '0.4rem 0.6rem',
    borderRadius: 4, textAlign: 'center', flexShrink: 0,
  },
  panelHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '0.7rem 0.85rem 0.5rem', borderBottom: '1px solid #2a1c08', flexShrink: 0,
  },
  mName:    { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '1.05rem', margin: 0 },
  mMeta:    { color: '#a89060', fontSize: '0.73rem', margin: '0.15rem 0 0', fontStyle: 'italic' },
  closeBtn: { background: 'none', border: 'none', color: '#6b5a3a', cursor: 'pointer', fontSize: '0.9rem', padding: '0', lineHeight: 1, flexShrink: 0 },

  scrollBody: { flex: 1, overflowY: 'auto', padding: '0.6rem 0.85rem' },
  msg:        { color: '#6b5a3a', padding: '2rem', textAlign: 'center', fontSize: '0.85rem' },

  combatRow: { display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' },
  statBox:   { flex: 1, background: '#0d0a05', borderRadius: 4, padding: '0.3rem 0.4rem', textAlign: 'center' },
  statLabel: { display: 'block', color: '#6b5a3a', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.06em' },
  statVal:   { display: 'block', color: '#e8e0d0', fontSize: '0.82rem', fontWeight: 700 },
  statSub:   { display: 'block', color: '#6b5a3a', fontSize: '0.65rem' },

  divider: { border: 'none', borderTop: '1px solid #2a1c08', margin: '0.45rem 0' },

  abilityGrid:  { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.25rem', marginBottom: '0.4rem', textAlign: 'center' },
  abilityCell:  {},
  abilityLabel: { display: 'block', color: '#6b5a3a', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' },
  abilityScore: { display: 'block', color: '#e8e0d0', fontSize: '0.9rem', fontWeight: 700 },
  abilityMod:   { display: 'block', color: '#c9a84c', fontSize: '0.7rem' },

  traitBlock: { marginBottom: '0.4rem' },
  traitRow:   { margin: '0.18rem 0', fontSize: '0.77rem', lineHeight: 1.45, color: '#a89060' },
  traitLabel: { color: '#e8e0d0', fontWeight: 600 },
  traitValue: { color: '#a89060' },

  section:      { marginBottom: '0.4rem' },
  sectionTitle: { color: '#c9a84c', fontFamily: 'Georgia, serif', fontSize: '0.82rem', fontWeight: 700, borderBottom: '1px solid #2a1c08', paddingBottom: '0.2rem', margin: '0.5rem 0 0.3rem' },
  actionEntry:  { margin: '0.2rem 0', fontSize: '0.77rem', lineHeight: 1.45 },
  actionName:   { color: '#e8e0d0', fontWeight: 600 },
  actionDesc:   { color: '#a89060' },

  footer: { borderTop: '1px solid #2a1c08', padding: '0.45rem 0.85rem', display: 'flex', gap: '0.4rem', flexShrink: 0 },
  actionBtn: { flex: 1, background: 'transparent', border: '1px solid #3a2a10', color: '#a89060', borderRadius: 3, padding: '0.28rem 0.4rem', cursor: 'pointer', fontSize: '0.72rem' },
}
