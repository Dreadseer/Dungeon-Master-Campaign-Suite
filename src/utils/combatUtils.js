// Combatant shape stored in-memory during combat (NOT persisted):
// { id, name, type, initiative, initiative_mod, hp_max, hp_current,
//   ac, conditions, concentration, is_active, is_player, entity_id, source_entry }

export const rollInitiative = (mod = 0) =>
  Math.floor(Math.random() * 20) + 1 + mod

export const buildCombatants = (encounter, characters) => {
  const monsters   = JSON.parse(encounter.monsters ?? '[]')
  const combatants = []

  // Expand each monster entry by count into individual combatants
  monsters.forEach(entry => {
    for (let i = 0; i < entry.count; i++) {
      combatants.push({
        id:             crypto.randomUUID(),
        name:           entry.count > 1 ? `${entry.name} ${i + 1}` : entry.name,
        type:           'monster',
        initiative:     0,
        initiative_mod: 0,
        hp_max:         entry.hp_max,
        hp_current:     entry.hp_current ?? entry.hp_max,
        ac:             entry.ac ?? 10,
        conditions:     [],
        concentration:  false,
        is_active:      false,
        is_player:      false,
        entity_id:      null,
        source_entry:   entry,
      })
    }
  })

  // Add player characters
  characters.forEach(char => {
    const stats  = JSON.parse(char.stats ?? '{}')
    const dexMod = Math.floor(((stats.dex ?? 10) - 10) / 2)
    combatants.push({
      id:             crypto.randomUUID(),
      name:           char.character_name,
      type:           'player',
      initiative:     0,
      initiative_mod: dexMod,
      hp_max:         char.hp_max,
      hp_current:     char.hp_current,
      ac:             10 + dexMod,
      conditions:     [],
      concentration:  false,
      is_active:      false,
      is_player:      true,
      entity_id:      char.id,
      source_entry:   char,
    })
  })

  return combatants
}

export const sortByInitiative = (combatants) =>
  [...combatants].sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative
    return b.initiative_mod - a.initiative_mod  // tie-break by DEX mod
  })

export const nextTurn = (combatants, currentIndex) => {
  const next = (currentIndex + 1) % combatants.length
  return combatants.map((c, i) => ({ ...c, is_active: i === next }))
}

// ── Conditions (Phase 5 Prompt 04) ────────────────────────────────────────
export const CONDITIONS = [
  { name: 'Blinded',       color: '#555',    icon: '👁️',  description: "Can't see, auto-fails sight checks, attack rolls have disadvantage in/out" },
  { name: 'Charmed',       color: '#E91E8C', icon: '💕',  description: "Can't attack charmer, charmer has advantage on social checks" },
  { name: 'Deafened',      color: '#795548', icon: '🔇',  description: "Can't hear, auto-fails hearing checks" },
  { name: 'Exhaustion',    color: '#9C27B0', icon: '😫',  description: 'Levels 1-6, each with cumulative penalties' },
  { name: 'Frightened',    color: '#FF5722', icon: '😨',  description: "Disadvantage on checks/attacks while source is in sight, can't move closer" },
  { name: 'Grappled',      color: '#607D8B', icon: '🤝',  description: "Speed 0, ends if grappler incapacitated or out of reach" },
  { name: 'Incapacitated', color: '#F44336', icon: '💫',  description: "Can't take actions or reactions" },
  { name: 'Invisible',     color: '#90A4AE', icon: '👻',  description: "Can't be seen, attack rolls advantage, attacks against have disadvantage" },
  { name: 'Paralyzed',     color: '#FF9800', icon: '🧊',  description: "Incapacitated, auto-fails STR/DEX saves, attacks within 5ft auto-crit" },
  { name: 'Petrified',     color: '#9E9E9E', icon: '🗿',  description: "Transformed to stone, incapacitated, immune to poison/disease" },
  { name: 'Poisoned',      color: '#4CAF50', icon: '🤢',  description: "Disadvantage on attack rolls and ability checks" },
  { name: 'Prone',         color: '#795548', icon: '⬇️',  description: "Disadvantage on attacks, melee attacks from within 5ft have advantage" },
  { name: 'Restrained',    color: '#FF9800', icon: '🕸️',  description: "Speed 0, disadvantage on attacks and DEX saves, attacks against have advantage" },
  { name: 'Stunned',       color: '#F44336', icon: '⭐',  description: "Incapacitated, auto-fails STR/DEX saves, attacks against have advantage" },
  { name: 'Unconscious',   color: '#212121', icon: '💤',  description: "Incapacitated, drops items, prone, auto-fails STR/DEX saves, auto-crit within 5ft" },
]

export const getCondition = (name) => CONDITIONS.find(c => c.name === name)
