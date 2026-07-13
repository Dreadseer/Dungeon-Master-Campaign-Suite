import { useState, useEffect } from 'react'
import { calculateAC }         from '../../src/utils/acUtils'
import { abilityMod, profBonus, modStr } from '../../src/utils/dnd5e'

const ABILITY_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }

export default function CharacterSheet({ campaignId, character, onSelectCharacter }) {
  const [characters, setCharacters] = useState([])
  const [activeTab,  setActiveTab]  = useState('stats')

  useEffect(() => {
    if (character) return
    fetch(`/api/campaign/${campaignId}/characters`)
      .then(r => r.json())
      .then(setCharacters)
      .catch(() => {})
  }, [campaignId, character])

  const handleSelectCharacter = (char) => {
    fetch(`/api/character/${char.id}`)
      .then(r => r.json())
      .then(full => {
        setCharacters([])
        onSelectCharacter(full)
      })
      .catch(() => {})
  }

  // ── Character selection screen ─────────────────────────────────────────────
  if (!character) {
    return (
      <div style={{ padding: '2rem', maxWidth: '500px', margin: '0 auto' }}>
        <h2 style={{ color: '#C9A84C', fontFamily: 'Georgia', marginBottom: '1rem' }}>
          Choose Your Character
        </h2>
        {characters.length === 0 && (
          <div style={{ color: '#6b6b6b', fontSize: '14px' }}>Loading characters...</div>
        )}
        {characters.map(char => (
          <div
            key={char.id}
            onClick={() => handleSelectCharacter(char)}
            style={{ border: '1px solid #2d1f0a', borderLeft: '4px solid #C9A84C',
              borderRadius: '8px', padding: '1rem', cursor: 'pointer', marginBottom: '8px',
              background: '#1a1208' }}
          >
            <div style={{ fontFamily: 'Georgia', color: '#C9A84C', fontSize: '16px' }}>
              {char.character_name}
            </div>
            <div style={{ color: '#6b6b6b', fontSize: '13px', marginTop: '4px' }}>
              {char.race} · {char.class} · Level {char.level}
              {char.subclass_name ? ` (${char.subclass_name})` : ''}
            </div>
            <div style={{ color: '#c0b8a8', fontSize: '13px', marginTop: '2px' }}>
              HP {char.hp_current} / {char.hp_max}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── Parse data ─────────────────────────────────────────────────────────────
  const stats     = (() => { try { return JSON.parse(character.stats     ?? '{}') } catch { return {} } })()
  const inventory = (() => { try { return JSON.parse(character.inventory ?? '[]') } catch { return [] } })()
  const spellSlots= (() => { try { return JSON.parse(character.spell_slots ?? '{}') } catch { return {} } })()

  const level  = character.level ?? 1
  const pb     = profBonus(level)
  const acInfo = calculateAC(character)

  const hpPct   = character.hp_max > 0 ? (character.hp_current / character.hp_max) * 100 : 0
  const hpColor = hpPct > 50 ? '#27ae60' : hpPct > 25 ? '#f39c12' : '#e74c3c'

  const passivePerception = 10 + abilityMod(stats.wis ?? 10) +
    (stats.skills?.perception ? pb : 0)

  // ── Tab content ─────────────────────────────────────────────────────────────
  const renderStats = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Ability scores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        {Object.entries(ABILITY_LABELS).map(([key, label]) => {
          const score = stats[key] ?? 10
          const mod   = abilityMod(score)
          return (
            <div key={key} style={{ background: '#1a1208', border: '1px solid #2d1f0a',
              borderRadius: '8px', padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ color: '#6b6b6b', fontSize: '10px', textTransform: 'uppercase',
                letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ color: '#C9A84C', fontSize: '22px', fontFamily: 'Georgia',
                lineHeight: 1.2 }}>{mod >= 0 ? `+${mod}` : mod}</div>
              <div style={{ color: '#888', fontSize: '12px' }}>{score}</div>
            </div>
          )
        })}
      </div>

      {/* Saving throws */}
      <Section title="Saving Throws">
        {Object.entries(ABILITY_LABELS).map(([key, label]) => {
          const isProficient = !!(stats.saves?.[key])
          const bonus = abilityMod(stats[key] ?? 10) + (isProficient ? pb : 0)
          return (
            <StatRow key={key} label={label} value={bonus >= 0 ? `+${bonus}` : `${bonus}`}
              dot={isProficient} />
          )
        })}
      </Section>

      {/* Skills */}
      <Section title="Skills">
        {SKILLS.map(({ key, label, ability }) => {
          const isProficient = !!(stats.skills?.[key])
          const bonus = abilityMod(stats[ability] ?? 10) + (isProficient ? pb : 0)
          return (
            <StatRow key={key} label={`${label} (${ABILITY_LABELS[ability]})`}
              value={bonus >= 0 ? `+${bonus}` : `${bonus}`} dot={isProficient} />
          )
        })}
      </Section>
    </div>
  )

  const renderInventory = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {inventory.length === 0 && (
        <div style={{ color: '#6b6b6b', fontSize: '13px' }}>No items.</div>
      )}
      {inventory.map((item, i) => (
        <div key={item.id ?? i} style={{ background: '#1a1208', border: '1px solid #2d1f0a',
          borderRadius: '6px', padding: '8px 12px', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ color: '#e8e0d0', fontSize: '13px' }}>
              {item.equipped && <span style={{ color: '#C9A84C', marginRight: '6px' }}>E</span>}
              {item.name}
            </div>
            {item.description && (
              <div style={{ color: '#6b6b6b', fontSize: '11px', marginTop: '2px' }}>
                {item.description}
              </div>
            )}
          </div>
          {item.quantity > 1 && (
            <div style={{ color: '#6b6b6b', fontSize: '12px', flexShrink: 0, marginLeft: '8px' }}>
              ×{item.quantity}
            </div>
          )}
        </div>
      ))}
    </div>
  )

  const renderSpells = () => {
    const slotLevels = Object.entries(spellSlots)
      .filter(([, v]) => v && typeof v === 'object')
      .sort(([a], [b]) => parseInt(a) - parseInt(b))

    const knownSpells = (() => {
      try { return JSON.parse(character.known_spells ?? '[]') } catch { return [] }
    })()

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Spell slots */}
        {slotLevels.length > 0 && (
          <Section title="Spell Slots">
            {slotLevels.map(([lvl, slot]) => {
              const total = slot.total ?? 0
              const used  = slot.used  ?? 0
              const remaining = total - used
              return (
                <div key={lvl} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '4px 0',
                  borderBottom: '1px solid #1a1208' }}>
                  <span style={{ color: '#888', fontSize: '12px' }}>Level {lvl}</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {Array.from({ length: total }).map((_, i) => (
                      <div key={i} style={{ width: '12px', height: '12px', borderRadius: '50%',
                        border: '1px solid #C9A84C',
                        background: i < remaining ? '#C9A84C' : 'transparent' }} />
                    ))}
                  </div>
                </div>
              )
            })}
          </Section>
        )}

        {/* Known spells */}
        {knownSpells.length > 0 && (
          <Section title="Known Spells">
            {knownSpells.map((spell, i) => (
              <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #1a1208',
                color: '#c0b8a8', fontSize: '13px' }}>
                {spell.name ?? spell}
                {spell.level != null && (
                  <span style={{ color: '#6b6b6b', fontSize: '11px', marginLeft: '6px' }}>
                    Lvl {spell.level}
                  </span>
                )}
              </div>
            ))}
          </Section>
        )}

        {slotLevels.length === 0 && knownSpells.length === 0 && (
          <div style={{ color: '#6b6b6b', fontSize: '13px' }}>No spell data.</div>
        )}
      </div>
    )
  }

  const renderAttacks = () => {
    const weapons = inventory.filter(item =>
      item.equipped && (item.damage || item.attack_bonus != null)
    )
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {weapons.length === 0 && (
          <div style={{ color: '#6b6b6b', fontSize: '13px' }}>No equipped weapons.</div>
        )}
        {weapons.map((item, i) => {
          const strMod = abilityMod(stats.str ?? 10)
          const dexMod = abilityMod(stats.dex ?? 10)
          const isFinesse = item.properties?.includes?.('finesse')
          const atkMod = (item.attack_bonus ?? 0) + pb +
            (isFinesse ? Math.max(strMod, dexMod) : strMod)
          return (
            <div key={item.id ?? i} style={{ background: '#1a1208', border: '1px solid #2d1f0a',
              borderRadius: '6px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#e8e0d0', fontSize: '13px', fontWeight: 600 }}>
                  {item.name}
                </span>
                <span style={{ color: '#C9A84C', fontSize: '13px', fontFamily: 'Georgia' }}>
                  {atkMod >= 0 ? `+${atkMod}` : atkMod} to hit
                </span>
              </div>
              {item.damage && (
                <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>
                  {item.damage}
                  {item.damage_type ? ` ${item.damage_type}` : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const TABS = ['stats', 'attacks', 'inventory', 'spells']

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '1rem' }}>
      {/* Identity header */}
      <div style={{ background: '#1a1208', border: '1px solid #2d1f0a', borderRadius: '10px',
        padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ fontFamily: 'Georgia', color: '#C9A84C', fontSize: '20px' }}>
          {character.character_name}
        </div>
        <div style={{ color: '#888', fontSize: '13px', marginTop: '2px' }}>
          {character.race} · {character.class}
          {character.subclass_name ? ` (${character.subclass_name})` : ''}
          {' '}· Level {level}
          {character.player_name ? ` · ${character.player_name}` : ''}
        </div>

        {/* HP bar */}
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', color: '#6b6b6b' }}>Hit Points</span>
            <span style={{ fontSize: '13px', color: hpColor, fontWeight: 600 }}>
              {character.hp_current} / {character.hp_max}
            </span>
          </div>
          <div style={{ height: '8px', background: '#0d0a05', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, hpPct))}%`,
              background: hpColor, borderRadius: '4px',
              transition: 'width 0.3s ease, background 0.3s ease' }} />
          </div>
        </div>

        {/* Stat chips */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
          <Chip label="AC"   value={acInfo.ac} />
          <Chip label="Prof" value={`+${pb}`} />
          <Chip label="Spd"  value={`${stats.speed ?? 30} ft`} />
          <Chip label="Perc" value={passivePerception} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2d1f0a', marginBottom: '1rem' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{ flex: 1, padding: '8px 4px', background: 'none',
              border: 'none', borderBottom: activeTab === tab ? '2px solid #C9A84C' : '2px solid transparent',
              color: activeTab === tab ? '#C9A84C' : '#6b6b6b',
              cursor: 'pointer', fontSize: '12px', textTransform: 'capitalize' }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'stats'     && renderStats()}
        {activeTab === 'attacks'   && renderAttacks()}
        {activeTab === 'inventory' && renderInventory()}
        {activeTab === 'spells'    && renderSpells()}
      </div>
    </div>
  )
}

function Chip({ label, value }) {
  return (
    <div style={{ background: '#0d0a05', border: '1px solid #2d1f0a', borderRadius: '6px',
      padding: '4px 10px', textAlign: 'center', minWidth: '52px' }}>
      <div style={{ color: '#6b6b6b', fontSize: '9px', textTransform: 'uppercase',
        letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ color: '#C9A84C', fontSize: '14px', fontFamily: 'Georgia',
        fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ background: '#1a1208', border: '1px solid #2d1f0a', borderRadius: '8px',
      padding: '10px 12px' }}>
      <div style={{ color: '#6b6b6b', fontSize: '10px', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: '8px' }}>{title}</div>
      {children}
    </div>
  )
}

function StatRow({ label, value, dot }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '3px 0', borderBottom: '1px solid #12100a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ width: '7px', height: '7px', borderRadius: '50%',
          background: dot ? '#C9A84C' : 'transparent',
          border: '1px solid #3d2f1a', flexShrink: 0 }} />
        <span style={{ color: '#888', fontSize: '12px' }}>{label}</span>
      </div>
      <span style={{ color: '#c0b8a8', fontSize: '12px', fontFamily: 'Georgia' }}>{value}</span>
    </div>
  )
}

const SKILLS = [
  { key: 'acrobatics',     label: 'Acrobatics',     ability: 'dex' },
  { key: 'animalHandling', label: 'Animal Handling', ability: 'wis' },
  { key: 'arcana',         label: 'Arcana',          ability: 'int' },
  { key: 'athletics',      label: 'Athletics',       ability: 'str' },
  { key: 'deception',      label: 'Deception',       ability: 'cha' },
  { key: 'history',        label: 'History',         ability: 'int' },
  { key: 'insight',        label: 'Insight',         ability: 'wis' },
  { key: 'intimidation',   label: 'Intimidation',    ability: 'cha' },
  { key: 'investigation',  label: 'Investigation',   ability: 'int' },
  { key: 'medicine',       label: 'Medicine',        ability: 'wis' },
  { key: 'nature',         label: 'Nature',          ability: 'int' },
  { key: 'perception',     label: 'Perception',      ability: 'wis' },
  { key: 'performance',    label: 'Performance',     ability: 'cha' },
  { key: 'persuasion',     label: 'Persuasion',      ability: 'cha' },
  { key: 'religion',       label: 'Religion',        ability: 'int' },
  { key: 'sleightOfHand',  label: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth',        label: 'Stealth',         ability: 'dex' },
  { key: 'survival',       label: 'Survival',        ability: 'wis' },
]
