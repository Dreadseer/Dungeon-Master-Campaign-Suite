// Query expansion for rules retrieval.
//
// Embedding recall is sensitive to phrasing: a DM at the table types "can a
// grappled creature move", and the SRD text says "Speed becomes 0". Adding the
// vocabulary the rules actually use to the query text pulls those passages up.
//
// The condition list is a deliberate duplicate of CONDITIONS in
// src/utils/combatUtils.js — that is an ES module in the renderer bundle, this
// is CommonJS in the main process. The test suite imports both and asserts the
// two agree, the same guard used for electron/server/fogFilter.js.

// All 15 PHB conditions. Each maps to the words the SRD uses to describe it, so
// a question naming the condition retrieves the passage defining it even when
// the passage never repeats the condition's name.
const CONDITION_EXPANSIONS = {
  blinded: "blinded condition can't see automatically fails ability check sight attack rolls disadvantage",
  charmed: "charmed condition can't attack the charmer social ability checks advantage",
  deafened: "deafened condition can't hear automatically fails ability check hearing",
  exhaustion: 'exhaustion condition levels penalties long rest disadvantage speed halved',
  frightened: "frightened condition disadvantage ability checks attack rolls source of fear can't willingly move closer",
  grappled: "grappled condition speed becomes 0 grappler incapacitated escape grapple",
  incapacitated: "incapacitated condition can't take actions or reactions",
  invisible: "invisible condition can't be seen heavily obscured attack rolls advantage attacks against disadvantage",
  paralyzed: 'paralyzed condition incapacitated automatically fails strength dexterity saving throws attacks critical hit within 5 feet',
  petrified: 'petrified condition transformed into stone incapacitated resistance to all damage immune poison disease',
  poisoned: 'poisoned condition disadvantage attack rolls ability checks',
  prone: 'prone condition crawl disadvantage attack rolls melee attacks advantage ranged disadvantage stand up half movement',
  restrained: "restrained condition speed becomes 0 attack rolls disadvantage attacks against advantage dexterity saving throws disadvantage",
  stunned: 'stunned condition incapacitated automatically fails strength dexterity saving throws attacks against advantage',
  unconscious: 'unconscious condition incapacitated drops what it is holding falls prone automatically fails strength dexterity saving throws critical hit within 5 feet',
}

// Terms a DM types that are not condition names.
const GENERAL_EXPANSIONS = {
  attack: 'attack roll hit bonus proficiency',
  damage: 'damage dice roll damage type',
  spell: 'spell casting spellcasting spell slot',
  spells: 'spell casting spellcasting spell slot',
  save: 'saving throw',
  saves: 'saving throw',
  saving: 'saving throw',
  dc: 'difficulty class saving throw',
  proficiency: 'proficiency bonus proficient',
  reaction: 'reaction action bonus action your turn',
  action: 'action bonus action reaction free object interaction',
  grapple: 'grappled condition speed becomes 0 escape athletics acrobatics contest',
  grappling: 'grappled condition speed becomes 0 escape athletics acrobatics contest',
  shove: 'shove push prone athletics contest',
  opportunity: 'opportunity attack reaction leaves your reach disengage',
  somatic: 'somatic component free hand spellcasting components',
  verbal: 'verbal component speak spellcasting components silence',
  material: 'material component component pouch spellcasting focus',
  components: 'verbal somatic material component spellcasting focus component pouch',
  concentration: 'concentration constitution saving throw lose concentration damage',
  advantage: 'advantage roll two d20 higher',
  disadvantage: 'disadvantage roll two d20 lower',
  cover: 'half cover three-quarters cover total cover armor class dexterity saving throw',
  initiative: 'initiative dexterity check turn order surprise',
  surprise: 'surprised stealth initiative first turn',
  rest: 'short rest long rest hit dice recover',
  death: 'death saving throw stabilize dying unconscious 0 hit points',
  dying: 'death saving throw stabilize dying unconscious 0 hit points',
  crit: 'critical hit natural 20 extra damage dice',
  critical: 'critical hit natural 20 extra damage dice',
  flanking: 'flanking optional rule advantage melee',
  invisibility: "invisible condition can't be seen heavily obscured",
  hidden: 'hiding stealth unseen attacker advantage',
  hide: 'hiding stealth unseen attacker advantage passive perception',
}

// Condition names appear in questions in several grammatical forms.
// "restrain", "restrained" and "restraining" should all reach the same passage.
function conditionAliases(condition) {
  const aliases = new Set([condition])
  if (condition.endsWith('ed')) {
    const stem = condition.slice(0, -2)
    aliases.add(stem)              // restrained -> restrain
    aliases.add(`${stem}ing`)      // restrained -> restraining
    if (stem.endsWith('n') && stem.length > 3) {
      aliases.add(stem.slice(0, -1))  // stunned -> stun (drops the doubled consonant)
    }
  }
  return [...aliases].filter(a => a.length > 2)
}

// Flattened lookup: every alias of every condition, plus the general terms.
const EXPANSIONS = (() => {
  const table = {}
  for (const [condition, expansion] of Object.entries(CONDITION_EXPANSIONS)) {
    for (const alias of conditionAliases(condition)) {
      table[alias] = expansion
    }
  }
  // General terms are applied second so a deliberate entry wins over a
  // generated alias if the two ever collide.
  for (const [word, expansion] of Object.entries(GENERAL_EXPANSIONS)) {
    table[word] = expansion
  }
  return table
})()

/**
 * Append rules vocabulary to a question, based on the words it contains.
 * Each expansion is added at most once however often its trigger appears.
 *
 * @param {string} q
 * @returns {string} the original question plus any expansions
 */
function expandQuery(q) {
  if (typeof q !== 'string' || q.trim() === '') return typeof q === 'string' ? q : ''

  // Split on anything that is not a letter or digit, so "grappled?" and
  // "(restrained)" still match. The old version split on ' ' alone, which meant
  // a trailing question mark defeated every expansion — and a DM typing a
  // question usually ends it with one.
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

  const seen = new Set()
  const extra = []
  for (const word of words) {
    const expansion = EXPANSIONS[word]
    if (expansion && !seen.has(expansion)) {
      seen.add(expansion)
      extra.push(expansion)
    }
  }

  return extra.length > 0 ? `${q} ${extra.join(' ')}` : q
}

/** The 15 condition keys, for the test that cross-checks combatUtils. */
const CONDITION_KEYS = Object.keys(CONDITION_EXPANSIONS)

module.exports = { expandQuery, CONDITION_EXPANSIONS, GENERAL_EXPANSIONS, CONDITION_KEYS }
