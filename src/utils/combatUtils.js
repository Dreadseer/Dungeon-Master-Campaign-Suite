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
