# ⚔ DMCS — Character Sheet Updates
## Claude Code Update Prompts 01 – 04

> **Save this file as:** `DMCS_CharacterSheet_Updates.md`

**Updates covered:** Attacks Tab · Features & Traits Tab · Currency · Equipment Slots · Item Popups · Spell Casting · Movement Speed

---

## Update Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | Attacks Tab | `attackUtils.js` with weapon/finesse/ranged math, equipped weapons, extra attacks, damage spells | 2 – 3 hrs |
| 02 | Features & Traits Tab | `FeatureCard` component, 4 sections, pre-populated racial traits & class features for all 12 classes | 2 – 3 hrs |
| 03 | Inventory Tab Upgrades | `CurrencyWallet` (PP/GP/EP/SP/CP), `EquipmentSlots` panel, `ItemDescriptionPopup` with equip/unequip | 2 – 3 hrs |
| 04 | Spells Tab Upgrades & Stats Polish | `SpellDescriptionPopup`, cast spell with slot consumption, movement speed on Stats tab | 1 – 2 hrs |

*Total estimated time: 7 – 11 hours*

> **⚠ IMPORTANT:** These prompts update an existing Phase 4 character sheet. Before running Prompt 01, ensure your Phase 4 character sheet implementation (`CharacterSheet.jsx`, `SpellSlotsPanel.jsx`, `InventoryPanel.jsx`) is committed and working. Run each prompt in order — they build on each other.

---

## Update Prompt 01 — Attacks Tab
### *Weapon attacks, racial & class attacks, damage spells — all in one combat-ready tab*

---

### Context

You are updating the DMCS Character Sheet (built in Phase 4). `CharacterSheet.jsx` currently has these tabs: **Stats | Inventory | Spells | Notes**. You are adding a new **Attacks** tab between Stats and Inventory. This tab is the player's single source of truth for everything they can do on their turn in combat.

---

### Your Task

#### ▸ Step 1 — Extend the character stats JSON schema

The character's attacks and additional data are stored in the `stats` JSON column. Add these backward-compatible fields (existing characters will have them as undefined — the UI must handle this with sensible defaults):

```javascript
// New fields added to stats JSON — backward compatible
// {
//   ...existing fields (str, dex, con, int, wis, cha, save_proficiencies, skill_proficiencies, death_saves),
//   speed:          number,          // movement speed in feet, default 30
//   weapon_attacks: [],              // managed via inventory — not stored separately
//   extra_attacks:  [],              // racial/class/feat attacks (see Step 3)
//   currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
//   features: {
//     racial_traits:  [],
//     class_features: [],
//     background: { personality_traits: '', ideals: '', bonds: '', flaws: '' },
//     feats: [],
//   }
// }
```

---

#### ▸ Step 2 — Create attack utility functions

📄 `src/utils/attackUtils.js`

```javascript
import { abilityMod, profBonus } from './dnd5e'

export const FINESSE_PROPS = ['finesse']
export const RANGED_PROPS  = ['ammunition', 'thrown', 'ranged']

// Determine ability used for weapon (melee=STR, ranged=DEX, finesse=higher)
export const weaponAbility = (weapon, stats) => {
  const props     = (weapon.properties ?? '').toLowerCase()
  const isRanged  = RANGED_PROPS.some(p => props.includes(p))
  const isFinesse = FINESSE_PROPS.some(p => props.includes(p))
  if (isFinesse) {
    return abilityMod(stats.str) >= abilityMod(stats.dex) ? 'str' : 'dex'
  }
  return isRanged ? 'dex' : 'str'
}

export const weaponAttackBonus = (weapon, stats, level) => {
  const ability = weaponAbility(weapon, stats)
  const mod     = abilityMod(stats[ability] ?? 10)
  const prof    = weapon.proficient !== false ? profBonus(level) : 0
  const magic   = weapon.magic_bonus ?? 0
  return mod + prof + magic
}

export const formatBonus = (n) => n >= 0 ? `+${n}` : `${n}`

export const weaponDamageStr = (weapon, stats, level) => {
  const ability  = weaponAbility(weapon, stats)
  const mod      = abilityMod(stats[ability] ?? 10)
  const magic    = weapon.magic_bonus ?? 0
  const bonus    = mod + magic
  const die      = weapon.damage_die  ?? '1d4'
  const type     = weapon.damage_type ?? ''
  const bonusStr = bonus !== 0 ? ` ${formatBonus(bonus)}` : ''
  return `${die}${bonusStr} ${type}`.trim()
}

// Detect if an inventory item is a weapon
export const isWeapon = (item) => {
  const t = (item.item_type ?? item.category ?? item.name ?? '').toLowerCase()
  return ['weapon','sword','axe','dagger','bow','crossbow','staff','mace','spear',
          'hammer','club','flail','lance','pike','rapier','scimitar','whip']
    .some(w => t.includes(w))
}

// Build the full attacks list from all sources
export const buildAttacksList = (character) => {
  const stats   = JSON.parse(character.stats ?? '{}')
  const inv     = JSON.parse(character.inventory ?? '[]')
  const level   = character.level ?? 1
  const attacks = []

  // 1. Equipped weapons from inventory
  inv
    .filter(item => item.equipped && isWeapon(item))
    .forEach(item => {
      attacks.push({
        id:           item.id,
        name:         item.name,
        source:       'weapon',
        attack_bonus: formatBonus(weaponAttackBonus(item, stats, level)),
        damage:       weaponDamageStr(item, stats, level),
        range:        item.range ?? '5 ft',
        properties:   item.properties ?? '',
        notes:        item.notes ?? '',
      })
    })

  // 2. Extra attacks (racial, class, feats)
  ;(stats.extra_attacks ?? []).forEach(atk => {
    attacks.push({ ...atk, source: atk.source ?? 'feature' })
  })

  // 3. Damage spells from known_spells
  const slots = JSON.parse(character.spell_slots ?? '{}')
  const known = slots.known_spells ?? []
  known
    .filter(s => s.is_damage_spell)
    .forEach(spell => {
      attacks.push({
        id:           `spell-${spell.index}`,
        name:         spell.name,
        source:       'spell',
        attack_bonus: spell.attack_bonus ?? '—',
        damage:       spell.damage ?? '—',
        range:        spell.range ?? '—',
        properties:   `${spell.school ?? ''} • Level ${spell.level === 0 ? 'Cantrip' : spell.level}`,
        notes:        spell.description_short ?? '',
      })
    })

  return attacks
}
```

---

#### ▸ Step 3 — Build the Attacks Tab component

📄 `src/components/character/AttacksTab.jsx`

```jsx
import { buildAttacksList } from '../../utils/attackUtils'

export default function AttacksTab({ character, onUpdateStats }) {
  const attacks = buildAttacksList(character)
  const stats   = JSON.parse(character.stats ?? '{}')

  return (
    <div style={{ padding: '1.5rem' }}>
      {attacks.length === 0 ? (
        <EmptyAttacks />
      ) : (
        <AttacksTable attacks={attacks} />
      )}
      <AddExtraAttack character={character} onUpdateStats={onUpdateStats} />
    </div>
  )
}
```

**`AttacksTable` sub-component:**
- Table columns: Name | Attack Bonus | Damage | Range | Source | Notes
- Source column color-coded: weapon=gold, feature=blue, spell=purple
- Rows grouped with section headers: "⚔ Weapons", "✨ Features & Abilities", "🔮 Damage Spells"
- Clicking a row opens an attack detail popover (name, full properties, notes)
- Cantrip damage spells show "Cantrip" badge — never consume spell slots
- Leveled damage spells show their spell level

**`EmptyAttacks` sub-component:**
- Message: "No attacks yet. Equip a weapon from your Inventory, or add racial and class attacks below."
- Two quick-action buttons: "Go to Inventory" and "Add Custom Attack"

**`AddExtraAttack` sub-component — collapsible form:**
- "+ Add Attack" toggle button expands/collapses
- Fields: Attack Name (required), Source (select: Class Feature/Racial Trait/Feat/Other), Attack Bonus (text, e.g. "+5"), Damage (text, e.g. "1d6 + 3 fire"), Range (text), Notes (text)
- On submit: appends to `stats.extra_attacks` array, calls `db.characters.updateStats(id, newStats)`
- Existing extra attacks listed below with delete (×) button per entry

---

#### ▸ Step 4 — Wire the Attacks tab into CharacterSheet

📄 `src/components/character/CharacterSheet.jsx`

New tab order: **Stats | Attacks | Inventory | Spells | Notes**

- Import `AttacksTab`
- Add "Attacks" as the second tab button
- Render `<AttacksTab character={character} onUpdateStats={handleUpdateStats} />` when `activeTab === "attacks"`

---

#### ▸ Step 5 — Extend the spell schema for damage spells

📄 `src/components/compendium/SpellDetail.jsx`

Update the "Add to Character" flow to populate damage fields when saving a spell:

```javascript
// When building the spell object to save:
const extractDamage = (spell) => {
  const desc  = spell.desc?.join(' ') ?? ''
  const match = desc.match(/(\d+d\d+(?:\s*\+\s*\d+)?)\s+(\w+)\s+damage/i)
  return match ? `${match[1]} ${match[2]}` : '—'
}

const spellToSave = {
  name:              spell.name,
  index:             spell.index,
  level:             spell.level,
  source:            'srd',
  school:            spell.school?.name ?? '',
  range:             spell.range ?? '',
  description_short: spell.desc?.[0]?.slice(0, 120) ?? '',
  is_damage_spell:   /\d+d\d+/.test(spell.desc?.join(' ') ?? ''),
  damage:            extractDamage(spell),
  attack_bonus:      spell.attack_type ? 'calculated' : '—',
}
```

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// 1. Equip a longsword on a STR-based fighter (STR 16 = +3 mod)
//    Expected: "Longsword | +5 | 1d8 + 3 slashing | 5 ft | weapon"

// 2. Add a custom racial attack
//    Name: "Breath Weapon", Source: "Racial Trait", Damage: "2d6 fire", Range: "15 ft cone"
//    Expected: appears in "✨ Features & Abilities" section

// 3. Add Fireball to a Wizard's spell list via Compendium
//    Expected: appears in "🔮 Damage Spells" with "8d6 fire"

// 4. Equip a shortbow (DEX weapon) — Expected: uses DEX modifier
// 5. Equip a rapier (finesse) — Expected: uses higher of STR/DEX

// DevTools: verify extra_attacks saves
const char  = await window.electronAPI.db.characters.getById(1)
const stats = JSON.parse(char.stats)
console.log(stats.extra_attacks)  // should show breath weapon entry
```

- "Attacks" tab appears between Stats and Inventory
- Equipped weapons show correct bonus and damage
- Finesse weapons use the higher ability modifier
- Damage spells from the spell list populate the Damage Spells section
- Custom extra attacks persist after page reload

> **⚠ WARNING:** Do NOT move to Prompt 02 until weapon attack bonuses calculate correctly for STR, DEX, and finesse weapons, and damage spells populate from the spell list.

---

## Update Prompt 02 — Features & Traits Tab
### *Racial traits, class features, background pillars, and feats*

---

### Context

Prompt 01 is complete. The Attacks tab is working. This prompt adds the Features & Traits tab — the catch-all for everything that makes the character unique beyond their ability scores.

---

### Your Task

#### ▸ Step 1 — Build the FeatureCard component

📄 `src/components/character/FeatureCard.jsx`

```jsx
import { useState } from 'react'

export default function FeatureCard({ name, badge, description, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{
      border: '1px solid #2d1f0a', borderLeft: '4px solid #C9A84C',
      borderRadius: '6px', marginBottom: '8px', background: '#0d0a05',
    }}>
      <div
        style={{ display:'flex', alignItems:'center', padding:'10px 14px', cursor:'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ flex:1, fontWeight:'bold', color:'#e8e0d0', fontFamily:'Arial' }}>{name}</span>
        {badge && (
          <span style={{ fontSize:'11px', color:'#C9A84C', marginRight:'8px',
            border:'1px solid #C9A84C', borderRadius:'3px', padding:'1px 6px' }}>
            {badge}
          </span>
        )}
        <span style={{ color:'#6b6b6b', fontSize:'12px', marginRight:'8px' }}>
          {expanded ? '▲' : '▼'}
        </span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            style={{ background:'none', border:'none', color:'#8B0000', cursor:'pointer', fontSize:'16px' }}
          >×</button>
        )}
      </div>
      {expanded && (
        <div style={{ padding:'0 14px 12px', color:'#c0b8a8', fontSize:'13px',
          lineHeight:'1.6', borderTop:'1px solid #2d1f0a', paddingTop:'10px' }}>
          {description || <em style={{ color:'#6b6b6b' }}>No description added.</em>}
        </div>
      )}
    </div>
  )
}
```

---

#### ▸ Step 2 — Build the Features & Traits Tab

📄 `src/components/character/FeaturesTab.jsx`

Four collapsible sections, each with add/delete functionality:

**Section 1 — 🧬 Racial Traits (with race name in header)**
- Each trait as a `FeatureCard` (expandable)
- "+ Add Racial Trait" — inline form: Name + Description
- On save: appends to `stats.features.racial_traits`, calls `updateStats()`
- Empty state: "No racial traits added yet."

**Section 2 — ⚔ Class Features (with class name in header)**
- Each feature as a `FeatureCard` with `level_gained` badge (e.g. "Level 1")
- Features sorted by `level_gained` ascending
- "+ Add Class Feature" — form: Name, Level Gained (1–20), Description
- On save: appends to `stats.features.class_features`, sorted by level

**Section 3 — 📖 Background & Personality (collapsed by default)**
- Four labeled textareas with auto-save on blur:
  - Personality Traits — "Quirks, habits, and speech patterns..."
  - Ideals — "The core principles your character lives by..."
  - Bonds — "People, places, or objectives your character is connected to..."
  - Flaws — "Vices, fears, or limitations..."
- Each textarea saves its field to `stats.features.background.[field]` on blur
- Character count shown below each (max 500 chars)

**Section 4 — ✨ Feats**
- Each feat as a `FeatureCard`
- "+ Add Feat" — form: Name, Description, Source (optional, e.g. "Level 4 ASI")
- Empty state: "No feats added yet. You gain feats by choosing them instead of an Ability Score Improvement."

---

#### ▸ Step 3 — Wire Features tab into CharacterSheet

📄 `src/components/character/CharacterSheet.jsx`

New tab order: **Stats | Attacks | Inventory | Spells | Features | Notes**

---

#### ▸ Step 4 — Pre-populate racial traits and class features for new characters

📄 `src/pages/CharacterSheets.jsx`

In the character creation submit handler, auto-populate features from these tables:

```javascript
const RACIAL_TRAITS = {
  Elf:        [
    { name:'Darkvision',   description:'You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
    { name:'Fey Ancestry', description:'You have advantage on saving throws against being charmed, and magic can\'t put you to sleep.' },
    { name:'Trance',       description:'Elves don\'t need to sleep. Instead, they meditate deeply for 4 hours a day.' },
  ],
  Dwarf:      [
    { name:'Darkvision',          description:'You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
    { name:'Dwarven Resilience',  description:'You have advantage on saving throws against poison, and resistance against poison damage.' },
    { name:'Stonecunning',        description:'Whenever you make an Intelligence (History) check related to stonework, you are considered proficient in the History skill.' },
  ],
  Halfling:   [
    { name:'Lucky',       description:'When you roll a 1 on the d20 for an attack roll, ability check, or saving throw, you can reroll and must use the new roll.' },
    { name:'Brave',       description:'You have advantage on saving throws against being frightened.' },
    { name:'Nimbleness',  description:'You can move through the space of any creature that is of a size larger than yours.' },
  ],
  Tiefling:   [
    { name:'Darkvision',       description:'You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
    { name:'Hellish Resistance', description:'You have resistance to fire damage.' },
    { name:'Infernal Legacy',  description:'You know the Thaumaturgy cantrip. At 3rd level, you can cast Hellish Rebuke once per day.' },
  ],
  Human:      [{ name:'Extra Language', description:'You can speak, read, and write one extra language of your choice.' }],
  Dragonborn: [
    { name:'Breath Weapon',       description:'You can use your action to exhale destructive energy. Your draconic ancestry determines size, shape, and damage type.' },
    { name:'Damage Resistance',   description:'You have resistance to the damage type associated with your draconic ancestry.' },
  ],
}

const CLASS_FEATURES_L1 = {
  Fighter:  [
    { name:'Fighting Style', level_gained:1, description:'You adopt a particular style of fighting as your specialty.' },
    { name:'Second Wind',    level_gained:1, description:'As a bonus action, regain 1d10 + fighter level HP. Once per short or long rest.' },
  ],
  Rogue:    [
    { name:'Expertise',    level_gained:1, description:'Choose two skill proficiencies. Your proficiency bonus is doubled for those skills.' },
    { name:'Sneak Attack', level_gained:1, description:'Once per turn, deal extra 1d6 damage when you have advantage on the attack roll.' },
    { name:"Thieves' Cant", level_gained:1, description:'You know a secret mix of dialect and code used by thieves to hide messages in normal conversation.' },
  ],
  Wizard:   [
    { name:'Arcane Recovery', level_gained:1, description:'Once per day on a short rest, recover expended spell slots up to half your wizard level (rounded up).' },
    { name:'Spellcasting',    level_gained:1, description:'As a student of arcane magic, you have a spellbook containing spells.' },
  ],
  Barbarian:[
    { name:'Rage',             level_gained:1, description:'As a bonus action, enter a rage: advantage on STR checks/saves, +2 damage, resistance to bludgeoning/piercing/slashing.' },
    { name:'Unarmored Defense', level_gained:1, description:'Without armor, AC = 10 + DEX modifier + CON modifier.' },
  ],
  Paladin:  [
    { name:'Divine Sense', level_gained:1, description:'Detect celestials, fiends, and undead within 60 feet as an action.' },
    { name:'Lay on Hands', level_gained:1, description:'Pool of healing power equal to 5 × your paladin level, replenished on long rest.' },
  ],
  Ranger:   [
    { name:'Favored Enemy',    level_gained:1, description:'You have significant experience tracking a certain type of enemy.' },
    { name:'Natural Explorer', level_gained:1, description:'You are adept at traveling and surviving in a particular natural environment.' },
  ],
  Cleric:   [
    { name:'Divine Domain', level_gained:1, description:'Choose a domain related to your deity, granting domain spells and features.' },
    { name:'Spellcasting',  level_gained:1, description:'As a conduit for divine power, you can cast cleric spells.' },
  ],
  Druid:    [
    { name:'Druidic',    level_gained:1, description:'You know Druidic, the secret language of druids.' },
    { name:'Spellcasting', level_gained:1, description:'Drawing on the divine essence of nature, you can cast spells.' },
  ],
  Bard:     [
    { name:'Bardic Inspiration', level_gained:1, description:'Bonus action: give one creature within 60 ft a Bardic Inspiration die (d6) to add to one ability check, attack, or save.' },
    { name:'Spellcasting',       level_gained:1, description:'You have learned to reshape reality in harmony with your music.' },
  ],
  Monk:     [
    { name:'Unarmored Defense', level_gained:1, description:'Without armor or shield, AC = 10 + DEX modifier + WIS modifier.' },
    { name:'Martial Arts',      level_gained:1, description:'You have mastery of combat styles using unarmed strikes and monk weapons.' },
  ],
  Sorcerer: [
    { name:'Spellcasting',    level_gained:1, description:'An event in your past infused you with arcane magic.' },
    { name:'Sorcerous Origin', level_gained:1, description:'Choose an origin describing the source of your innate magical power.' },
  ],
  Warlock:  [
    { name:'Otherworldly Patron', level_gained:1, description:'You have struck a bargain with an otherworldly being of your choice.' },
    { name:'Pact Magic',          level_gained:1, description:'Your arcane research and patron have given you spells.' },
  ],
}

// In the character creation submit handler:
stats.features = {
  racial_traits:  RACIAL_TRAITS[formData.race]   ?? [],
  class_features: CLASS_FEATURES_L1[formData.class] ?? [],
  background: { personality_traits: '', ideals: '', bonds: '', flaws: '' },
  feats: [],
}
```

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// Create a new Elf Wizard
// Expected: Racial Traits auto-populated: Darkvision, Fey Ancestry, Trance
// Expected: Class Features auto-populated: Arcane Recovery, Spellcasting

// DevTools:
const char  = await window.electronAPI.db.characters.getById(1)
const stats = JSON.parse(char.stats)
console.log(stats.features.racial_traits.length)   // > 0 for Elf
console.log(stats.features.class_features.length)  // > 0 for Wizard
console.log(stats.features.background.ideals)       // shows what was typed
console.log(stats.features.feats)                   // shows added feats
```

- New Elf Wizard: Racial Traits pre-populated with Darkvision, Fey Ancestry, Trance
- New Fighter: Class Features pre-populated with Fighting Style, Second Wind
- Clicking any `FeatureCard` expands/collapses the description
- Background textareas: each field saves independently on blur
- All four sections are collapsible

> **⚠ WARNING:** Do NOT move to Prompt 03 until pre-population works for at least 3 races and 3 classes, and all four background fields save independently.

---

## Update Prompt 03 — Inventory Tab Upgrades
### *Currency tracking (PP/GP/EP/SP/CP), equipment slot system, and item description popups*

---

### Context

Prompts 01 and 02 are complete. This prompt upgrades the Inventory tab with three new features: a currency wallet, an equipment slot display, and item description popups.

---

### Your Task

#### ▸ Step 1 — Add currency IPC handler

📄 `electron/ipc/dbHandlers.js`

```javascript
ipcMain.handle('db:characters:updateCurrency', (_, charId, currency) => {
  const char  = db.get('SELECT stats FROM characters WHERE id=?', [charId])
  const stats = JSON.parse(char.stats ?? '{}')
  stats.currency = { pp:0, gp:0, ep:0, sp:0, cp:0, ...stats.currency, ...currency }
  return db.run('UPDATE characters SET stats=? WHERE id=?', [JSON.stringify(stats), charId])
})
```

Add to preload.js: `db.characters.updateCurrency(charId, currency)`

---

#### ▸ Step 2 — Build the Currency Wallet component

📄 `src/components/character/CurrencyWallet.jsx`

**Display — five coins in a horizontal row:**

| Coin | Abbreviation | Color |
|---|---|---|
| Platinum | PP | Light silver `#E0E0E0` |
| Gold | GP | Gold `#C9A84C` |
| Electrum | EP | Teal `#2A8D7A` |
| Silver | SP | Silver `#A0A0A0` |
| Copper | CP | Copper `#B87333` |

- Total GP equivalent below: "≈ 47.3 gp total"
  - Formula: `PP×10 + GP + EP×0.5 + SP×0.1 + CP×0.01`

**Editing:**
- Clicking a coin amount makes it an inline editable input
- Blur or Enter confirms and calls `db.characters.updateCurrency(charId, { [field]: newValue })`

**Transfer Currency modal:**
- From: amount input + currency dropdown
- Exchange rates: 10 CP = 1 SP, 10 SP = 1 GP, 10 GP = 1 PP, 1 GP = 2 EP
- "Convert" button shows the result before confirming
- On convert: deducts from source, adds to target, saves both

---

#### ▸ Step 3 — Build the Equipment Slots panel

📄 `src/components/character/EquipmentSlots.jsx`

Eight named slots: **Main Hand | Off Hand | Armor | Helmet | Ring 1 | Ring 2 | Boots | Cloak**

- Each shows the equipped item name, or "— empty —" in muted silver
- Clicking a populated slot shows a tooltip: full item name + equip/unequip button

**Slot detection logic** (add to `attackUtils.js` or new `equipmentUtils.js`):

```javascript
export const detectEquipSlot = (item) => {
  const t = (item.item_type ?? item.category ?? item.name ?? '').toLowerCase()
  if (t.includes('helmet') || t.includes('helm') || t.includes('hood')) return 'Helmet'
  if (t.includes('boot')   || t.includes('shoe') || t.includes('greave')) return 'Boots'
  if (t.includes('cloak')  || t.includes('cape') || t.includes('mantle')) return 'Cloak'
  if (t.includes('ring'))    return 'Ring'
  if (t.includes('shield'))  return 'Off Hand'
  if (t.includes('armor')  || t.includes('mail') || t.includes('plate') ||
      t.includes('leather') || t.includes('robe')) return 'Armor'
  if (isWeapon(item)) return 'Main Hand'
  return 'Other'
}

export const getEquippedBySlot = (inventory) => {
  const slots = { 'Main Hand':null, 'Off Hand':null, 'Armor':null,
    'Helmet':null, 'Ring 1':null, 'Ring 2':null, 'Boots':null, 'Cloak':null }
  inventory
    .filter(item => item.equipped)
    .forEach(item => {
      const slot = detectEquipSlot(item)
      if (slot === 'Ring') {
        if (!slots['Ring 1']) slots['Ring 1'] = item
        else if (!slots['Ring 2']) slots['Ring 2'] = item
      } else if (slot in slots && slots[slot] === null) {
        slots[slot] = item
      }
    })
  return slots
}
```

---

#### ▸ Step 4 — Build the Item Description Popup

📄 `src/components/character/ItemDescriptionPopup.jsx`

Triggered by clicking any item name in the inventory list:

- Item name (large gold heading), item type and rarity badges, cost, weight
- Full description text (use `AnswerRenderer` from Phase 7 for basic markdown)
- Properties section: weapon properties, armor properties
- "Equip" / "Unequip" button → `db.characters.updateItem(charId, itemId, { equipped: !current })`
- "Remove from Inventory" button → confirmation → `db.characters.removeItem(charId, itemId)`
- "Close" button or click-outside closes

For SRD items, fetch the full description:

```javascript
useEffect(() => {
  if (item.source === 'srd' && item.source_index) {
    window.electronAPI.srd.getEquipmentByIndex(item.source_index)
      .then(srdData => { if (srdData) setSrdItem(srdData) })
  }
}, [item])
// Display srdItem.desc if available, otherwise fall back to item.notes
```

---

#### ▸ Step 5 — Update the Inventory tab layout

📄 `src/components/character/InventoryPanel.jsx`

- Add `<CurrencyWallet>` at the very top
- Add `<EquipmentSlots>` below the currency wallet
- Make item names clickable in the inventory table: `onClick={() => setSelectedItem(item)}`
  - Style: gold color, underline on hover, pointer cursor
- Render `<ItemDescriptionPopup item={selectedItem} onClose={() => setSelectedItem(null)} />` when `selectedItem` is set

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// 1. Currency: click GP amount → type 50 → Enter
//    Expected: GP shows 50, total GP equivalent updates

// 2. Transfer: open modal → convert 10 SP to 1 GP
//    Expected: SP -10, GP +1

// 3. Equipment slots:
//    Equip longsword → appears in "Main Hand"
//    Equip leather armor → appears in "Armor"
//    Equip two rings → appear in Ring 1 and Ring 2

// 4. Item popup: click a weapon name → popup opens with description
//    Click "Unequip" → item unequipped, Equipment Slots updates

// DevTools:
const char  = await window.electronAPI.db.characters.getById(1)
const stats = JSON.parse(char.stats)
console.log(stats.currency)  // { pp:0, gp:50, ep:0, sp:0, cp:0 }
```

- Currency wallet shows all 5 denominations with correct colors
- Clicking a coin amount makes it editable, saves on blur/Enter
- Transfer modal converts between denominations correctly
- Equipment slots populate when items are equipped
- Rings fill Ring 1 then Ring 2 in order
- Clicking item name opens description popup
- Equip/Unequip from popup updates both inventory and equipment slots

> **⚠ WARNING:** Do NOT move to Prompt 04 until currency persists to DB, equipment slots detect item types correctly, and item popups open with correct data for both SRD and custom items.

---

## Update Prompt 04 — Spells Tab Upgrades & Stats Screen Polish
### *Spell description popups, cast spell with slot consumption, movement speed on Stats tab*

---

### Context

Prompts 01–03 are complete. This final update prompt upgrades the Spells tab with clickable spell descriptions and actual spell casting that consumes spell slots, and adds movement speed to the Stats tab.

---

### Your Task

#### ▸ Step 1 — Add Speed field to character creation modal

📄 `src/pages/CharacterSheets.jsx`

Add a Speed field to the character creation form, below the Level input:

- Speed — number input, default 30, step 5, min 5, max 120
- Label: "Movement Speed (ft)"
- Hint: "Standard speed is 30 ft. Check your race description for exceptions."
- On submit: `stats.speed = formData.speed ?? 30`

For existing characters: `const speed = stats.speed ?? 30` as the safe default everywhere.

---

#### ▸ Step 2 — Display speed on the Stats tab

📄 `src/components/character/CharacterSheet.jsx`

Replace the current single "Proficiency Bonus" display with three stat chips in a row:

```jsx
function StatChip({ label, value, color }) {
  return (
    <div style={{
      background: '#1a1208', border: `1px solid ${color}`,
      borderRadius: '8px', padding: '10px 16px',
      textAlign: 'center', minWidth: '120px'
    }}>
      <div style={{ fontSize:'20px', fontWeight:'bold', color, fontFamily:'Georgia' }}>{value}</div>
      <div style={{ fontSize:'11px', color:'#6b6b6b', marginTop:'4px',
        textTransform:'uppercase', letterSpacing:'0.5px' }}>{label}</div>
    </div>
  )
}

// In Stats tab, below the ability score grid:
<div style={{ display:'flex', gap:'1rem', margin:'1rem 0' }}>
  <StatChip label="Proficiency Bonus" value={`+${profBonus(character.level)}`} color="#C9A84C" />
  <StatChip label="Movement Speed"    value={`${stats.speed ?? 30} ft`}         color="#4A90D9" />
  <StatChip label="Passive Perception" value={passivePerception(stats.wis, character.level,
    (stats.skill_proficiencies ?? []).includes('perception'))}                  color="#9B59B6" />
</div>
```

---

#### ▸ Step 3 — Build the Spell Description Popup

📄 `src/components/character/SpellDescriptionPopup.jsx`

**Content:**
- Spell name (large gold Georgia heading)
- Level + School badge (e.g. "3rd-level Evocation")
- Four-column stat row: Casting Time | Range | Components | Duration
- Concentration badge (if applicable), Ritual badge (if applicable)
- Full description — fetch `srd.getSpellByIndex(spell.index)` for SRD spells
- "At Higher Levels" section if present
- "Classes" line at the bottom

**Cast Spell action:**

```javascript
const getAvailableSlots = (spell, spellSlots) => {
  const minLevel = spell.level === 0 ? 0 : spell.level
  if (minLevel === 0) return []  // cantrip

  const available = []
  for (let lvl = minLevel; lvl <= 9; lvl++) {
    const slot = spellSlots[String(lvl)]
    if (slot && slot.max > 0) {
      available.push({ level: lvl, remaining: slot.max - slot.used, max: slot.max })
    }
  }
  return available
}
```

**Cantrips (level 0):**
- "Cast Cantrip" button — no slot consumption, shows toast: "Cast [spell name]!"

**Leveled spells:**
- Show one "Cast at Nth Level (X/Y remaining)" button per available slot level
- Spell can be upcast — show all slot levels ≥ base level
- Show only slots where `max > 0`
- Disabled with red text if `remaining === 0`

**On clicking "Cast at Level N":**
1. Call `db.characters.useSlot(charId, slotLevel)`
2. Show toast: "Cast [spell name] using a [N]th-level slot! Slots remaining: [X]"
3. Call `onSlotUsed()` to refresh character data in parent
4. Close the popup

---

#### ▸ Step 4 — Wire the spell popup into SpellSlotsPanel

📄 `src/components/character/SpellSlotsPanel.jsx`

- Make spell names clickable in the known spells list: gold color, underline on hover, pointer cursor
- `onClick={() => setSelectedSpell(spell)}` on each spell name
- Render `<SpellDescriptionPopup spell={selectedSpell} character={character} onClose={() => setSelectedSpell(null)} onSlotUsed={handleSlotUsed} />` when `selectedSpell` is set
- `handleSlotUsed`: re-fetches the character from DB (for updated slot counts) and calls parent refresh

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// 1. Stats tab — three chips
//    Create a Dwarf character, set speed to 25 ft
//    Expected: three chips → "Proficiency Bonus: +2" | "Movement Speed: 25 ft" | "Passive Perception: N"

// 2. Spell popup — cantrip
//    Click a cantrip (e.g. "Fire Bolt")
//    Expected: "Cast Cantrip" button — toast shows, no slot consumed

// 3. Spell popup — leveled spell
//    Click Fireball (3rd level, Wizard with 3rd-level slots)
//    Expected: "Cast at 3rd Level (3/3 remaining)", "Cast at 4th Level..." etc.
//    Click "Cast at 3rd Level"
//    Expected: slot pip fills in SpellSlotsPanel, toast shows, popup closes

// 4. No slots remaining
//    Use all 3rd-level slots, then click Fireball
//    Expected: "Cast at 3rd Level" disabled/red
//    But 4th-level slots (if any) should still be available

// DevTools: verify slot was consumed
const char  = await window.electronAPI.db.characters.getById(1)
const slots = JSON.parse(char.spell_slots)
console.log(slots["3"].used)  // should be 1 after one cast
```

- Stats tab: three chips in a row — Proficiency Bonus, Movement Speed, Passive Perception
- Speed chip shows the correct value (default 30 if not set)
- Clicking a spell name opens the full description popup with SRD content
- Cantrip popup: "Cast Cantrip" button, no slot consumption
- Leveled spell popup: slot buttons show for each available level with remaining counts
- Casting: slot consumed, pip fills in `SpellSlotsPanel`, toast appears, popup closes
- No remaining slots: button is disabled
- Character speed set during creation persists and displays correctly

> **⚠ WARNING:** These are the final character sheet updates. Do NOT close this session until all four prompts have been verified end to end: Attacks tab with correct bonuses, Features tab with pre-populated traits, Inventory with currency and item popups, and Spells tab with casting that consumes slots.

---

*⚔ End of Character Sheet Update Prompts ⚔*
