# ⚔ DMCS — Phase 4 Agent Prompts
## Compendium & Sheets — Claude Code Edition

> **Save this file as:** `DMCS_Phase4_Agent_Prompts.md`
> Place it in the root of your project folder alongside the spec and rules documents.

**Modules covered:** SRD Browser · Custom Entries · Character Sheets · Inventory · Spell Slots · Level Up

---

## Prompt Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | Compendium Browser | SRD monsters/spells/equipment with filters and full stat block detail panels | 2 – 3 hrs |
| 02 | Custom Compendium | Custom item/spell/equipment/monster CRUD, Homebrew merged into SRD browsers | 2 – 3 hrs |
| 03 | Character Sheet Foundation | Character creation, ability scores, HP tracker, saving throws, skills, 5e math utilities | 2 – 3 hrs |
| 04 | Inventory, Spells & Equipment | Inventory management, spell slot tracking, long rest, Compendium add-to-character flow | 2 – 3 hrs |
| 05 | Polish, Level Up & Audit | Death saves, level up workflow, AI assistant, notes tab, full phase audit | 1 – 2 hrs |

*Total estimated time: 9 – 14 hours*

> **⚔ RULE:** Before starting any prompt, open your Claude Code session with the Master Session Opener from `DMCS_Claude_Code_Rules.md`. Update the filename reference to `DMCS_Phase4_Agent_Prompts.md`.

---

## Agent Prompt 01 — Compendium Browser
### *SRD items, spells, and equipment — search, filter, and full stat block detail view*

---

### Context

Phase 3 is complete. The Map Engine — image import, grid rendering, pan/zoom, fog of war, and unit tokens — is fully working. This is Prompt 01 of 05 for Phase 4. You are building the Compendium module, starting with the browser for SRD data cached to SQLite in Phase 1. The DM can search and filter all monsters, spells, and equipment from the D&D 5e SRD and view full stat blocks.

---

### Your Task

#### ▸ Step 1 — Add Compendium IPC handlers

📄 `electron/ipc/srdHandlers.js`

Add these enhanced query handlers. The existing `seedAll`, `onProgress`, and `getCacheStats` handlers stay — append these:

```javascript
// Enhanced SRD query handlers
ipcMain.handle('srd:getMonsters', (_, filters = {}) => {
  const rows = db.all('SELECT slug, data FROM srd_cache WHERE resource_type = ?', ['monster'])
  let results = rows.map(r => JSON.parse(r.data))
  if (filters.name)  results = results.filter(m => m.name.toLowerCase().includes(filters.name.toLowerCase()))
  if (filters.cr !== undefined && filters.cr !== '') results = results.filter(m => String(m.challenge_rating) === String(filters.cr))
  if (filters.type)  results = results.filter(m => m.type?.toLowerCase().includes(filters.type.toLowerCase()))
  if (filters.size)  results = results.filter(m => m.size?.toLowerCase() === filters.size.toLowerCase())
  return results.map(m => ({ name: m.name, index: m.index, challenge_rating: m.challenge_rating, type: m.type, size: m.size, hit_points: m.hit_points }))
})

ipcMain.handle('srd:getMonsterByIndex', (_, index) => {
  const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['monster', index])
  return row ? JSON.parse(row.data) : null
})

ipcMain.handle('srd:getSpells', (_, filters = {}) => {
  const rows = db.all('SELECT slug, data FROM srd_cache WHERE resource_type = ?', ['spell'])
  let results = rows.map(r => JSON.parse(r.data))
  if (filters.name)   results = results.filter(s => s.name.toLowerCase().includes(filters.name.toLowerCase()))
  if (filters.level !== undefined && filters.level !== '') results = results.filter(s => s.level === Number(filters.level))
  if (filters.school) results = results.filter(s => s.school?.name?.toLowerCase() === filters.school.toLowerCase())
  if (filters.classes) results = results.filter(s => s.classes?.some(c => c.name.toLowerCase().includes(filters.classes.toLowerCase())))
  return results.map(s => ({ name: s.name, index: s.index, level: s.level, school: s.school?.name, casting_time: s.casting_time, range: s.range }))
})

ipcMain.handle('srd:getSpellByIndex', (_, index) => {
  const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['spell', index])
  return row ? JSON.parse(row.data) : null
})

ipcMain.handle('srd:getEquipment', (_, filters = {}) => {
  const rows = db.all('SELECT slug, data FROM srd_cache WHERE resource_type = ?', ['equipment'])
  let results = rows.map(r => JSON.parse(r.data))
  if (filters.name)     results = results.filter(e => e.name.toLowerCase().includes(filters.name.toLowerCase()))
  if (filters.category) results = results.filter(e => e.equipment_category?.name?.toLowerCase().includes(filters.category.toLowerCase()))
  return results.map(e => ({ name: e.name, index: e.index, equipment_category: e.equipment_category?.name, cost: e.cost, weight: e.weight }))
})

ipcMain.handle('srd:getEquipmentByIndex', (_, index) => {
  const row = db.get('SELECT data FROM srd_cache WHERE resource_type = ? AND slug = ?', ['equipment', index])
  return row ? JSON.parse(row.data) : null
})
```

---

#### ▸ Step 2 — Update preload.js

Update the srd object in contextBridge — keep existing entries and append:

- `srd.getMonsters(filters)`
- `srd.getMonsterByIndex(index)`
- `srd.getSpells(filters)`
- `srd.getSpellByIndex(index)`
- `srd.getEquipment(filters)`
- `srd.getEquipmentByIndex(index)`

---

#### ▸ Step 3 — Build the Compendium page shell with tabs

📄 `src/pages/Compendium.jsx`

Replace the Phase 1 placeholder with a tabbed Compendium page. The Compendium is **NOT** campaign-specific — it is global and available without an active campaign. Remove it from CampaignGuard if currently wrapped.

Tab structure:
- **Monsters** — SRD monster list (default tab)
- **Spells** — SRD spell list
- **Equipment** — SRD equipment list
- **Custom** — DM-created custom entries (built in Prompt 02)

Each tab maintains its own filter state independently. Switching tabs preserves the filter state of the previous tab.

---

#### ▸ Step 4 — Build the Monster browser

📄 `src/components/compendium/MonsterBrowser.jsx`

**Filter bar:**
- Name search — text input, debounced 300ms
- CR filter — select: All, 0, 1/8, 1/4, 1/2, 1–30
- Type filter — select: All, Beast, Undead, Humanoid, Dragon, Fiend, Celestial, Construct, Elemental, Fey, Giant, Monstrosity, Ooze, Plant, Aberration
- Size filter — select: All, Tiny, Small, Medium, Large, Huge, Gargantuan
- Result count: "332 monsters" or "12 of 332 monsters" when filtered

**Monster list:**
- Render 50 at a time with a "Load more" button (avoid performance issues with 332 entries)
- Each row: monster name (bold), CR badge (color-coded), type, size, HP
- Click a row to open MonsterStatBlock detail panel

**CR badge color coding:**

```javascript
// src/utils/crColor.js
export const crColor = (cr) => {
  const n = parseFloat(String(cr).replace('1/8','0.125').replace('1/4','0.25').replace('1/2','0.5'))
  if (n <= 4)  return '#2D7A2D'  // green
  if (n <= 10) return '#B8750A'  // amber
  return '#8B0000'               // red
}
```

---

#### ▸ Step 5 — Build MonsterStatBlock detail panel

📄 `src/components/compendium/MonsterStatBlock.jsx`

Slide-in right panel showing the full SRD stat block:

- **Header:** monster name (large gold), type, size, alignment
- **Combat stats row:** AC, HP (hit dice), Speed
- **Ability scores grid (2×3):** STR | DEX | CON | INT | WIS | CHA — score and modifier
- Saving throws, Skills (comma-separated, if any)
- Damage immunities, resistances, vulnerabilities (if any)
- Senses, Languages, Challenge Rating + XP
- Special Abilities — name (italic) + description
- Actions — name (bold) + description, attack bonus and damage where present
- Legendary Actions (if any)

**Ability score modifier helper:**

```javascript
export const abilityMod = (score) => {
  const mod = Math.floor((score - 10) / 2)
  return mod >= 0 ? `+${mod}` : `${mod}`
}
```

**Panel actions:**
- "Add to Encounter" — placeholder toast: "Encounter Builder coming in Phase 5"
- "Add to Map as Token" — if a map is active, adds a monster token; otherwise shows "Open a map first"
- "Close" button

---

#### ▸ Step 6 — Build the Spell browser

📄 `src/components/compendium/SpellBrowser.jsx`

**Filter bar:** Name search (debounced), Level (All, Cantrip, 1st–9th), School (All + 8 schools), Class (text input)

**Spell list:** name, level badge (color-coded: Cantrip=gray, 1–2=blue, 3–5=purple, 6–9=gold), school, casting time, range

📄 `src/components/compendium/SpellDetail.jsx`

Slide-in right panel:
- Header: spell name, level + school (e.g. "3rd-level Evocation")
- Casting time, Range, Components (V/S/M + material), Duration, Concentration badge, Ritual badge
- Full description with paragraph breaks preserved
- Higher Levels section (if present)
- Classes (comma-separated)
- "Add to Character" button — placeholder for Prompt 04

---

#### ▸ Step 7 — Build the Equipment browser

📄 `src/components/compendium/EquipmentBrowser.jsx`

**Filter bar:** Name search (debounced), Category (All, Weapon, Armor, Adventuring Gear, Tools, Mounts and Vehicles, Trade Goods)

**Equipment list:** name, category, cost, weight. Click row opens EquipmentDetail panel.

📄 `src/components/compendium/EquipmentDetail.jsx`

Slide-in right panel:
- Name, category, cost, weight
- Weapon properties: damage die + type, properties (finesse, thrown, etc.), range
- Armor properties: base AC, max Dex bonus, min Strength, stealth disadvantage
- "Add to Inventory" — placeholder toast: "Open a character sheet to add items"

---

### Verification Steps

> **✓ VERIFY:** Test the full Compendium browser:

```javascript
// DevTools console
await window.electronAPI.srd.getMonsters({ name: "goblin" })
// Expected: array with goblin including name, cr, type, size, hp

await window.electronAPI.srd.getMonsterByIndex("goblin")
// Expected: full goblin stat block with actions, abilities, etc.

await window.electronAPI.srd.getSpells({ level: 3, school: "Evocation" })
// Expected: 3rd-level Evocation spells (Fireball should be in there)

await window.electronAPI.srd.getEquipment({ category: "Weapon" })
// Expected: array of weapons with name, cost, weight
```

- Compendium page loads without requiring an active campaign
- Monster tab: search "dragon" returns all dragon-type monsters, CR filter narrows results
- Clicking a monster opens the stat block panel with ability scores, actions, and special abilities
- CR badges show correct colors (green/amber/red)
- Spell tab: level and school filters work, clicking opens full detail panel
- Equipment tab: category filter works, weapon/armor specific fields show

> **⚠ WARNING:** Do NOT move to Prompt 02 until all three browsers load SRD data and all three detail panels display correctly.

---

## Agent Prompt 02 — Custom Compendium Entries
### *Create, edit, and manage DM-created items, spells, equipment, and monsters*

---

### Context

Prompt 01 is complete. The Compendium browser shows all SRD monsters, spells, and equipment. This prompt builds the Custom tab — where the DM creates their own compendium entries using the `compendium_custom` table. Custom entries co-exist with SRD data and can be added to encounters, inventories, and maps.

---

### Your Task

#### ▸ Step 1 — Add custom compendium IPC handlers

📄 `electron/ipc/dbHandlers.js`

```javascript
// Custom Compendium
ipcMain.handle('db:compendium:getAll', (_, campaignId, type) => {
  const query  = type
    ? 'SELECT * FROM compendium_custom WHERE campaign_id = ? AND type = ? ORDER BY name ASC'
    : 'SELECT * FROM compendium_custom WHERE campaign_id = ? AND type != ? ORDER BY name ASC'
  const params = type ? [campaignId, type] : [campaignId, 'lore']
  return db.all(query, params)
})

ipcMain.handle('db:compendium:getById', (_, id) =>
  db.get('SELECT * FROM compendium_custom WHERE id = ?', [id]))

ipcMain.handle('db:compendium:create', (_, data) =>
  db.run(`
    INSERT INTO compendium_custom (campaign_id, type, name, data, source, created_at)
    VALUES (?, ?, ?, ?, 'custom', datetime('now'))`,
    [data.campaign_id, data.type, data.name, JSON.stringify(data.data)]))

ipcMain.handle('db:compendium:update', (_, id, data) =>
  db.run('UPDATE compendium_custom SET name=?, data=? WHERE id=?',
    [data.name, JSON.stringify(data.data), id]))

ipcMain.handle('db:compendium:delete', (_, id) =>
  db.run('DELETE FROM compendium_custom WHERE id=?', [id]))

ipcMain.handle('db:compendium:search', (_, campaignId, query) => {
  const q = `%${query}%`
  return db.all(`
    SELECT * FROM compendium_custom
    WHERE campaign_id = ? AND type != 'lore' AND name LIKE ?
    ORDER BY type ASC, name ASC`,
    [campaignId, q])
})
```

---

#### ▸ Step 2 — Update preload.js

- `db.compendium.getAll(campaignId, type)`
- `db.compendium.getById(id)`
- `db.compendium.create(data)`
- `db.compendium.update(id, data)`
- `db.compendium.delete(id)`
- `db.compendium.search(campaignId, query)`

---

#### ▸ Step 3 — Build the Custom Compendium tab

📄 `src/components/compendium/CustomBrowser.jsx`

- Type filter tabs: All | Item | Spell | Equipment | Monster
- Name search — debounced 300ms
- Each entry as an EntityCard: name, type badge, "Homebrew" badge, created date
- "+ New Entry" button — opens type selector first, then the appropriate form
- Empty state: "No custom entries yet. Create your first homebrew item, spell, or monster."

---

#### ▸ Step 4 — Custom Item form

📄 `src/components/compendium/forms/CustomItemForm.jsx`

Fields:
- Name (required), Item Type (select: Weapon/Armor/Potion/Ring/Rod/Scroll/Staff/Wand/Wondrous Item/Ammunition/Gear/Tool)
- Rarity (select: Common/Uncommon/Rare/Very Rare/Legendary/Artifact)
- Requires Attunement (checkbox), Cost (text), Weight (number)
- Description (textarea, 5 rows), Properties (textarea, 3 rows — mechanical effects)

On submit: `db.compendium.create({ campaign_id, type: "item", name, data: { item_type, rarity, requires_attunement, cost, weight, description, properties } })`

---

#### ▸ Step 5 — Custom Spell form

📄 `src/components/compendium/forms/CustomSpellForm.jsx`

Fields:
- Name (required), Level (Cantrip–9th), School (8 schools)
- Casting Time, Range
- Components: V/S/M checkboxes, material description input if M checked
- Duration, Concentration (checkbox), Ritual (checkbox)
- Classes — comma-separated text input
- Description (textarea, 6 rows), At Higher Levels (textarea, 3 rows, optional)

---

#### ▸ Step 6 — Custom Monster form

📄 `src/components/compendium/forms/CustomMonsterForm.jsx`

**Tab 1 — Identity:**
- Name, Size, Type, Alignment, CR (number), XP (auto-calculated from 5e XP table)
- AC, HP, Hit Dice (e.g. "3d8+6"), Speed

**Tab 2 — Ability Scores & Traits:**
- Six ability score inputs (STR/DEX/CON/INT/WIS/CHA) with live modifier display
- Saving throw proficiency checkboxes, Skill proficiencies
- Damage Immunities, Resistances, Vulnerabilities, Condition Immunities (comma-separated text)
- Senses, Languages

**Tab 3 — Actions:**
- Special Abilities — dynamic list: "+ Add Ability" creates `{ name, description }` pair
- Actions — dynamic list: "+ Add Action" creates `{ name, attack_bonus, damage, description }`
- Legendary Actions — textarea (optional)

> **ℹ NOTE:** CR → XP table: 0=10, 1/8=25, 1/4=50, 1/2=100, 1=200, 2=450, 3=700, 4=1100, 5=1800, 6=2300, 7=2900, 8=3900, 9=5000, 10=5900, 11=7200, 12=8400, 13=10000, 14=11500, 15=13000, 16=15000, 17=18000, 18=20000, 19=22000, 20=25000, 30=155000

---

#### ▸ Step 7 — Custom Equipment form

📄 `src/components/compendium/forms/CustomEquipmentForm.jsx`

Fields: Name (required), Category (select), Cost, Weight, Description. For weapons: damage + type + properties. For armor: base AC + Dex cap + min STR + stealth disadvantage checkbox.

---

#### ▸ Step 8 — Merge custom entries into SRD browsers

📄 `src/components/compendium/MonsterBrowser.jsx`

After loading SRD monsters, fetch `db.compendium.getAll(activeCampaign?.id, "monster")`, parse their `data` JSON, merge into results, show "Homebrew" badge on custom rows. Apply same filters to both. Repeat for SpellBrowser and EquipmentBrowser.

---

### Verification Steps

> **✓ VERIFY:**

```javascript
const cid = 1

await window.electronAPI.db.compendium.create({
  campaign_id: cid,
  type: "item",
  name: "Amulet of the Iron Wolves",
  data: {
    item_type: "Wondrous Item",
    rarity: "Rare",
    requires_attunement: true,
    description: "While attuned, you gain +1 to AC and advantage on Intimidation checks.",
    properties: "+1 AC, advantage on Intimidation",
    cost: "—", weight: 0
  }
})

const items = await window.electronAPI.db.compendium.getAll(cid, "item")
console.log(items[0].name)                      // "Amulet of the Iron Wolves"
console.log(JSON.parse(items[0].data).rarity)   // "Rare"

const results = await window.electronAPI.db.compendium.search(cid, "Amulet")
console.log(results.length)  // 1
```

- Custom monster form: ability score modifiers update live as scores are typed
- Custom monsters appear in Monster browser tab merged with SRD entries with "Homebrew" badge
- Edit modal pre-fills all fields from saved data JSON

> **⚠ WARNING:** Do NOT move to Prompt 03 until custom CRUD works for all four types and Homebrew entries appear correctly in the SRD browser tabs.

---

## Agent Prompt 03 — Character Sheet Foundation
### *Create characters, core 5e stats, HP tracking, proficiency, and saving throws*

---

### Context

Prompts 01 and 02 are complete. This prompt builds the Character Sheet module — character creation, the six ability scores with auto-calculated modifiers, HP tracking, proficiency bonus, saving throws, and all 18 skills. Inventory and spell slots come in Prompt 04.

---

### Your Task

#### ▸ Step 1 — Add Character IPC handlers

📄 `electron/ipc/dbHandlers.js`

Replace Phase 1 stub character handlers with these complete versions:

```javascript
// Characters — replace Phase 1 stubs
ipcMain.handle('db:characters:getAll', (_, campaignId) =>
  db.all('SELECT * FROM characters WHERE campaign_id = ? ORDER BY character_name ASC', [campaignId]))

ipcMain.handle('db:characters:getById', (_, id) =>
  db.get('SELECT * FROM characters WHERE id = ?', [id]))

ipcMain.handle('db:characters:create', (_, data) =>
  db.run(`
    INSERT INTO characters
      (campaign_id, player_name, character_name, class, race, level,
       stats, hp_current, hp_max, inventory, spell_slots, notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    [data.campaign_id, data.player_name, data.character_name,
     data.class, data.race, data.level ?? 1,
     JSON.stringify(data.stats ?? { str:10, dex:10, con:10, int:10, wis:10, cha:10 }),
     data.hp_current ?? 0, data.hp_max ?? 0,
     JSON.stringify(data.inventory ?? []),
     JSON.stringify(data.spell_slots ?? {}),
     data.notes ?? '']))

ipcMain.handle('db:characters:update', (_, id, data) =>
  db.run(`
    UPDATE characters
    SET player_name=?, character_name=?, class=?, race=?, level=?,
        stats=?, hp_current=?, hp_max=?, inventory=?, spell_slots=?, notes=?
    WHERE id=?`,
    [data.player_name, data.character_name, data.class, data.race, data.level,
     JSON.stringify(data.stats), data.hp_current, data.hp_max,
     JSON.stringify(data.inventory), JSON.stringify(data.spell_slots),
     data.notes, id]))

ipcMain.handle('db:characters:updateHP', (_, id, hpCurrent) =>
  db.run('UPDATE characters SET hp_current=? WHERE id=?', [hpCurrent, id]))

ipcMain.handle('db:characters:updateStats', (_, id, stats) =>
  db.run('UPDATE characters SET stats=? WHERE id=?', [JSON.stringify(stats), id]))

ipcMain.handle('db:characters:delete', (_, id) =>
  db.run('DELETE FROM characters WHERE id=?', [id]))
```

---

#### ▸ Step 2 — Update preload.js

- `db.characters.getAll(campaignId)` · `db.characters.getById(id)` · `db.characters.create(data)`
- `db.characters.update(id, data)` · `db.characters.updateHP(id, hpCurrent)` · `db.characters.updateStats(id, stats)` · `db.characters.delete(id)`

---

#### ▸ Step 3 — Create 5e calculation utilities

📄 `src/utils/dnd5e.js`

```javascript
// Ability modifier
export const abilityMod = (score) => Math.floor((score - 10) / 2)
export const modStr     = (score) => { const m = abilityMod(score); return m >= 0 ? `+${m}` : `${m}` }

// Proficiency bonus from level
export const profBonus  = (level) => Math.ceil(level / 4) + 1

// Saving throw / skill bonus
export const savingThrow = (score, level, isProficient) => {
  const base = abilityMod(score)
  return isProficient ? base + profBonus(level) : base
}
export const skillBonus = savingThrow

// Passive perception
export const passivePerception = (wisScore, level, isProficient) =>
  10 + skillBonus(wisScore, level, isProficient)

// Spellcasting
export const spellSaveDC      = (abilityScore, level) => 8 + profBonus(level) + abilityMod(abilityScore)
export const spellAttackBonus = (abilityScore, level) => profBonus(level) + abilityMod(abilityScore)

// Skill → ability mapping
export const SKILL_ABILITY = {
  acrobatics:"dex", animal_handling:"wis", arcana:"int", athletics:"str",
  deception:"cha", history:"int", insight:"wis", intimidation:"cha",
  investigation:"int", medicine:"wis", nature:"int", perception:"wis",
  performance:"cha", persuasion:"cha", religion:"int",
  sleight_of_hand:"dex", stealth:"dex", survival:"wis",
}

export const SKILLS = Object.keys(SKILL_ABILITY).map(key => ({
  key, label: key.replace(/_/g,' ').replace(/\b\w/g, l => l.toUpperCase()),
  ability: SKILL_ABILITY[key]
}))

// Spell slots by caster type and level
export const SPELL_SLOTS = {
  full: { 1:[2],2:[3],3:[4,2],4:[4,3],5:[4,3,2],6:[4,3,3],7:[4,3,3,1],8:[4,3,3,2],9:[4,3,3,3,1],10:[4,3,3,3,2],11:[4,3,3,3,2,1],12:[4,3,3,3,2,1],13:[4,3,3,3,2,1,1],14:[4,3,3,3,2,1,1],15:[4,3,3,3,2,1,1,1],16:[4,3,3,3,2,1,1,1],17:[4,3,3,3,2,1,1,1,1],18:[4,3,3,3,3,1,1,1,1],19:[4,3,3,3,3,2,1,1,1],20:[4,3,3,3,3,2,2,1,1] },
  half: { 1:[],2:[2],3:[3],4:[3],5:[4,2],6:[4,2],7:[4,3],8:[4,3],9:[4,3,2],10:[4,3,2],11:[4,3,3],12:[4,3,3],13:[4,3,3,1],14:[4,3,3,1],15:[4,3,3,2],16:[4,3,3,2],17:[4,3,3,3,1],18:[4,3,3,3,1],19:[4,3,3,3,2],20:[4,3,3,3,2] },
}

export const getCasterType = (className) => {
  const full = ['Bard','Cleric','Druid','Sorcerer','Wizard']
  const half = ['Paladin','Ranger']
  const cls  = className?.trim() ?? ''
  if (full.some(c => cls.toLowerCase().includes(c.toLowerCase()))) return 'full'
  if (half.some(c => cls.toLowerCase().includes(c.toLowerCase()))) return 'half'
  return null
}

// Hit dice by class
export const HIT_DICE = {
  Barbarian: 12, Fighter: 10, Paladin: 10, Ranger: 10,
  Bard: 8, Cleric: 8, Druid: 8, Monk: 8, Rogue: 8, Warlock: 8,
  Sorcerer: 6, Wizard: 6,
}
```

---

#### ▸ Step 4 — Build the Character Sheets page

📄 `src/pages/CharacterSheets.jsx`

**Character list view:**
- Fetch `db.characters.getAll(activeCampaign.id)` on mount
- Each card: character name (large), player name, class + race, level badge, HP progress bar (color: green >50%, amber 25–50%, red <25%)
- "+ New Character" button, "Open Sheet" button, "Delete" with confirmation

**Character creation modal:**
- Character Name (required), Player Name, Race (datalist), Class (select — all 12 classes)
- Level (1–20, default 1), Maximum HP (number input)
- Ability Scores: six inputs (STR/DEX/CON/INT/WIS/CHA) with live modifier display below each
- On submit: `db.characters.create()` with `hp_current = hp_max`, stats JSON, empty inventory/spell_slots

---

#### ▸ Step 5 — Build the full Character Sheet view

📄 `src/components/character/CharacterSheet.jsx`

Full-page view with "← Characters" back button. Tab bar: Stats | Inventory | Spells | Notes

**Sheet header:**
- Character name (large gold), class, race, level
- Proficiency Bonus: `+${profBonus(level)}`
- Passive Perception (calculated)

**HP tracker:**
- Large "24 / 40 HP" display with color-coded progress bar
- "Damage" and "Heal" buttons — each opens a small inline amount input, applies, saves via `db.characters.updateHP()`
- "Full Rest" button — sets `hp_current = hp_max`
- `hp_current` cannot go below 0 or above `hp_max`

**Ability scores panel (Stats tab):**
- 6-column grid with ability name label, large editable score number, auto-calculated modifier
- Clicking score makes it editable, saves on blur via `db.characters.updateStats()`

**Saving throws panel:**
- All 6 saves with proficiency checkboxes
- Proficiency state in `stats.save_proficiencies` array
- Each row: checkbox, ability name, calculated bonus
- Checkbox toggle saves to stats JSON

**Skills panel:**
- All 18 skills using `SKILLS` from dnd5e.js
- Each row: checkbox (proficient), skill name, ability abbreviation, calculated bonus
- Proficiency in `stats.skill_proficiencies` array

---

### Verification Steps

> **✓ VERIFY:**

```javascript
const cid = 1

await window.electronAPI.db.characters.create({
  campaign_id: cid,
  player_name: "Chris",
  character_name: "Kaelthas Sunblade",
  class: "Wizard", race: "Elf", level: 5,
  stats: { str:8, dex:14, con:12, int:18, wis:13, cha:10,
           save_proficiencies: ["int","wis"],
           skill_proficiencies: ["arcana","history","perception","investigation"] },
  hp_current: 28, hp_max: 28,
})

// Verify 5e math (import in a test component)
// profBonus(5)   → 3 (levels 5-8)
// abilityMod(18) → 4
// modStr(8)      → "-1"
```

- Character creation: ability score modifiers update live as scores are typed
- HP bar shows correct color, Damage/Heal/Full Rest all persist to DB
- Saving throw checkboxes update displayed bonus correctly
- All 18 skills listed with correct ability mapping

> **⚠ WARNING:** Do NOT move to Prompt 04 until all 5e calculations are correct and HP updates persist.

---

## Agent Prompt 04 — Inventory, Spells & Equipment
### *Item management, spell slot tracking, equipped gear, and weight calculation*

---

### Context

Prompt 03 is complete. Character sheets show core stats, ability scores, HP tracking, saving throws, and skills. This prompt adds inventory management, spell slot tracking, equipped gear, and encumbrance calculation.

---

### Your Task

#### ▸ Step 1 — Data structures

```javascript
// inventory — array stored in characters.inventory JSON
// Each item: { id, name, quantity, weight, equipped, source, source_index, notes }

// spell_slots — object stored in characters.spell_slots JSON
// { "1": { max: 4, used: 1 }, "2": { max: 3, used: 0 }, ..., known_spells: [...] }
```

---

#### ▸ Step 2 — Add inventory and spell IPC handlers

📄 `electron/ipc/dbHandlers.js`

```javascript
// Inventory
ipcMain.handle('db:characters:addItem', (_, charId, item) => {
  const char = db.get('SELECT inventory FROM characters WHERE id=?', [charId])
  const inv  = JSON.parse(char.inventory ?? '[]')
  inv.push({ ...item, id: require('crypto').randomUUID() })
  return db.run('UPDATE characters SET inventory=? WHERE id=?', [JSON.stringify(inv), charId])
})

ipcMain.handle('db:characters:removeItem', (_, charId, itemId) => {
  const char = db.get('SELECT inventory FROM characters WHERE id=?', [charId])
  const inv  = JSON.parse(char.inventory ?? '[]').filter(i => i.id !== itemId)
  return db.run('UPDATE characters SET inventory=? WHERE id=?', [JSON.stringify(inv), charId])
})

ipcMain.handle('db:characters:updateItem', (_, charId, itemId, changes) => {
  const char = db.get('SELECT inventory FROM characters WHERE id=?', [charId])
  const inv  = JSON.parse(char.inventory ?? '[]').map(i => i.id === itemId ? { ...i, ...changes } : i)
  return db.run('UPDATE characters SET inventory=? WHERE id=?', [JSON.stringify(inv), charId])
})

// Spell slots
ipcMain.handle('db:characters:useSlot', (_, charId, slotLevel) => {
  const char  = db.get('SELECT spell_slots FROM characters WHERE id=?', [charId])
  const slots = JSON.parse(char.spell_slots ?? '{}')
  if (slots[slotLevel] && slots[slotLevel].used < slots[slotLevel].max) slots[slotLevel].used += 1
  return db.run('UPDATE characters SET spell_slots=? WHERE id=?', [JSON.stringify(slots), charId])
})

ipcMain.handle('db:characters:restoreSlot', (_, charId, slotLevel) => {
  const char  = db.get('SELECT spell_slots FROM characters WHERE id=?', [charId])
  const slots = JSON.parse(char.spell_slots ?? '{}')
  if (slots[slotLevel] && slots[slotLevel].used > 0) slots[slotLevel].used -= 1
  return db.run('UPDATE characters SET spell_slots=? WHERE id=?', [JSON.stringify(slots), charId])
})

ipcMain.handle('db:characters:longRest', (_, charId) => {
  const char  = db.get('SELECT hp_max, spell_slots FROM characters WHERE id=?', [charId])
  const slots = JSON.parse(char.spell_slots ?? '{}')
  Object.keys(slots).forEach(lvl => {
    if (typeof slots[lvl] === 'object' && 'used' in slots[lvl]) slots[lvl].used = 0
  })
  return db.run('UPDATE characters SET hp_current=?, spell_slots=? WHERE id=?',
    [char.hp_max, JSON.stringify(slots), charId])
})

ipcMain.handle('db:characters:addKnownSpell', (_, charId, spell) => {
  const char  = db.get('SELECT spell_slots FROM characters WHERE id=?', [charId])
  const slots = JSON.parse(char.spell_slots ?? '{}')
  if (!Array.isArray(slots.known_spells)) slots.known_spells = []
  if (!slots.known_spells.find(s => s.index === spell.index)) slots.known_spells.push(spell)
  return db.run('UPDATE characters SET spell_slots=? WHERE id=?', [JSON.stringify(slots), charId])
})

ipcMain.handle('db:characters:removeKnownSpell', (_, charId, spellIndex) => {
  const char  = db.get('SELECT spell_slots FROM characters WHERE id=?', [charId])
  const slots = JSON.parse(char.spell_slots ?? '{}')
  slots.known_spells = (slots.known_spells ?? []).filter(s => s.index !== spellIndex)
  return db.run('UPDATE characters SET spell_slots=? WHERE id=?', [JSON.stringify(slots), charId])
})
```

---

#### ▸ Step 3 — Update preload.js

- `db.characters.addItem(charId, item)` · `db.characters.removeItem(charId, itemId)` · `db.characters.updateItem(charId, itemId, changes)`
- `db.characters.useSlot(charId, slotLevel)` · `db.characters.restoreSlot(charId, slotLevel)` · `db.characters.longRest(charId)`
- `db.characters.addKnownSpell(charId, spell)` · `db.characters.removeKnownSpell(charId, spellIndex)`

---

#### ▸ Step 4 — Build the Inventory panel

📄 `src/components/character/InventoryPanel.jsx`

**Inventory table (Inventory tab of CharacterSheet):**
- Columns: equipped checkbox, item name, quantity (+/- buttons), weight per unit, total weight, notes icon
- Equipped items show a shield icon — toggle calls `db.characters.updateItem(charId, itemId, { equipped: !current })`
- Total weight display: "Carrying 34.5 / 120 lbs" — capacity = STR score × 15 lbs
- Encumbrance progress bar — turns red if over capacity
- "+ Add Item" opens the item picker panel

**Item picker panel (slide-in):**
- Search input — queries both `srd.getEquipment()` and `db.compendium.getAll()` simultaneously
- Results list: name, category, cost, weight
- Clicking shows quantity input (default 1) and "Add to Inventory" button
- "Add Manually" button — quick form: name, quantity, weight, notes (for items not in Compendium)
- On add: `db.characters.addItem(charId, { name, quantity, weight, equipped: false, source, source_index, notes: "" })`

---

#### ▸ Step 5 — Build the Spell Slots panel

📄 `src/components/character/SpellSlotsPanel.jsx`

**Spells tab of CharacterSheet:**

Check `getCasterType(character.class)` from `dnd5e.js`. If null, show "This class does not have spell slots."

**Spellcasting stats bar:**
- Spellcasting Ability (class-based: Wizard/Fighter(EK)/Rogue(AT)=INT, Cleric/Druid/Ranger=WIS, Bard/Paladin/Sorcerer/Warlock=CHA)
- Spell Save DC = 8 + profBonus + spellcasting modifier
- Spell Attack Bonus = +profBonus + spellcasting modifier

**Spell slot tracker:**
- Each level row: label ("1st"), pip indicators (filled=available, empty=used), "Use Slot" and "Restore Slot" buttons
- Pip count matches `SPELL_SLOTS[casterType][level]`
- "Long Rest" button at top — calls `db.characters.longRest()` and restores all slots and HP

**Known spells list:**
- All spells from `spell_slots.known_spells`
- Each row: name, level badge, school, "Remove" button
- "+ Add Spell" opens spell picker (same pattern as item picker, using `srd.getSpells()`)
- No duplicates — button disabled if spell already known

---

#### ▸ Step 6 — Wire Compendium "Add to Character" and "Add to Inventory"

📄 `src/components/compendium/SpellDetail.jsx` — wire the "Add to Character" button:
- Show character selector dropdown for the active campaign
- On confirm: `db.characters.addKnownSpell(selectedCharId, { name, index, level, source: "srd" })`
- Success toast: "Fireball added to Kaelthas's spellbook"

📄 `src/components/compendium/EquipmentDetail.jsx` — wire "Add to Inventory":
- Show character selector and quantity input
- On confirm: `db.characters.addItem(selectedCharId, { name, quantity: 1, weight: item.weight?.value ?? 0, equipped: false, source: "srd", source_index: item.index, notes: "" })`

---

### Verification Steps

> **✓ VERIFY:**

```javascript
const charId = 1

// Add an item
await window.electronAPI.db.characters.addItem(charId, {
  name: "Longsword", quantity: 1, weight: 3,
  equipped: true, source: "srd", source_index: "longsword", notes: ""
})

const char = await window.electronAPI.db.characters.getById(charId)
const inv  = JSON.parse(char.inventory)
console.log(inv[0].name, inv[0].equipped)  // "Longsword" true

// Spell slots — Wizard level 5 should have 4/3/2
await window.electronAPI.db.characters.useSlot(charId, "1")
const updated = await window.electronAPI.db.characters.getById(charId)
console.log(JSON.parse(updated.spell_slots)["1"].used)  // 1

// Long rest
await window.electronAPI.db.characters.longRest(charId)
const rested = await window.electronAPI.db.characters.getById(charId)
console.log(JSON.parse(rested.spell_slots)["1"].used)  // 0
console.log(rested.hp_current === rested.hp_max)       // true
```

- Inventory: add from Compendium, add manually, equip/unequip, quantity edit — all persist
- Encumbrance bar turns red when carrying capacity exceeded
- Spell slots: correct pip count for a Wizard level 5 (4/3/2), use/restore/long rest persist
- "Add to Character" in Spell detail adds to known spells list

> **⚠ WARNING:** Do NOT move to Prompt 05 until inventory CRUD, spell slot use/restore, long rest, and the "Add to Character" Compendium flow all work correctly.

---

## Agent Prompt 05 — Character Sheet Polish, Level Up & Phase 4 Audit
### *Death saves, level up system, AI character helper, and phase completion*

---

### Context

Prompts 01–04 are complete. This final Phase 4 prompt adds death saving throws, a level-up workflow, an AI character assistant, a notes tab, and runs the full Phase 4 audit.

---

### Your Task

#### ▸ Step 1 — Add death saving throws

📄 `src/components/character/CharacterSheet.jsx`

When `hp_current === 0`, show the Death Saves panel below the HP tracker:

- State stored in `stats.death_saves: { successes: 0, failures: 0 }`
- Three success pips and three failure pips (checkboxes)
- "Roll Death Save" button — simulates d20: 11+ = success, ≤10 = failure, natural 20 = 2 successes, natural 1 = 2 failures
- 3 successes → "Stable ❤️" banner, lock further rolls
- 3 failures → "Dead 💀" banner
- "Clear Death Saves" button resets to `{ successes: 0, failures: 0 }`
- Save via `db.characters.updateStats()`

---

#### ▸ Step 2 — Build the Level Up workflow

📄 `src/components/character/LevelUpModal.jsx`

Wizard-style multi-step modal triggered by a "Level Up" button in the sheet header:

**Step 1 — Confirm:** current → new level, new proficiency bonus. "Proceed" button.

**Step 2 — Hit Points:** show class hit die (from `HIT_DICE` in dnd5e.js). Two options:
- "Roll Hit Die" — simulate die roll + CON modifier, update `hp_max` and `hp_current`
- "Take Average" — half hit die rounded up + CON modifier

**Step 3 — Spell Slots (if spellcaster):** show new slot progression for the new level. Update `spell_slots` JSON with any new levels, setting `used: 0`.

**Step 4 — Summary:** show all changes. "Apply Level Up" calls `db.characters.update()` with new level, `hp_max`, `hp_current`, `spell_slots`.

---

#### ▸ Step 3 — Add AI Character Assistant

📄 `src/components/character/AICharacterAssistant.jsx`

Collapsible panel at the bottom of the character sheet. Four generation buttons:

- **"Character Background"** — 2-paragraph backstory based on race, class, and highest ability score
- **"Personality Traits"** — 3 personality trait suggestions fitting class and stats
- **"Magic Item Suggestions"** — 3 thematic items appropriate for class and level
- **"NPC Connections"** — 2 NPC connection ideas based on campaign world

```javascript
const systemPrompt = `You are an expert D&D 5e Dungeon Master assistant.
Keep responses concise and immediately usable at the game table.
Format output as a numbered list unless instructed otherwise.`

// Example for background generation
const userMessage = `Generate a 2-paragraph backstory for a level ${char.level}
${char.race} ${char.class} named ${char.character_name}.
Their highest ability score is ${highestAbility} (${highestScore}).
The campaign is set in ${activeCampaign.world_setting}.`
```

- Show spinner while generating
- "Copy to Notes" button — appends output to `character.notes` and saves
- "Regenerate" button for a fresh result

---

#### ▸ Step 4 — Add Notes tab

📄 `src/components/character/CharacterSheet.jsx`

Notes tab:
- Large textarea (12 rows) showing `character.notes`
- Auto-saves on blur via `db.characters.update()` — no save button needed
- "Clear Notes" button with confirmation
- Character count shown below the textarea

---

#### ▸ Step 5 — Phase 4 audit checklist

**Compendium:**
- [ ] Monster browser: all 332 SRD monsters load, name/CR/type/size filters work
- [ ] Monster stat block: ability scores, modifiers, actions, special abilities render correctly
- [ ] Spell browser: level, school, class filters work; full spell details display
- [ ] Equipment browser: category filter works, weapon/armor specific fields show
- [ ] Custom entries: CRUD for all four types works
- [ ] Custom entries appear merged in SRD tabs with Homebrew badge
- [ ] Compendium accessible without active campaign

**Character Sheets:**
- [ ] Character creation: all fields save, `hp_current` initialized to `hp_max`
- [ ] Ability scores: all 6 with correct modifiers, editable inline
- [ ] HP tracker: damage/heal/full rest persist
- [ ] Saving throws: proficiency checkboxes save and update bonuses
- [ ] Skills: all 18 with correct ability mapping and bonuses
- [ ] Inventory: add from Compendium, add manually, equip/unequip, quantity edit, weight total
- [ ] Encumbrance: capacity = STR × 15, bar turns red when exceeded
- [ ] Spell slots: correct pip count per caster type, use/restore/long rest persist
- [ ] Known spells: add from Compendium, remove, no duplicates
- [ ] Death saves: shows at 0 HP, roll simulation works, 3 successes/failures trigger banners
- [ ] Level Up: HP gain, spell slot update, proficiency bonus update all apply
- [ ] AI assistant: generates backstory, traits, items, NPC connections using campaign context
- [ ] Notes tab: auto-saves on blur
- [ ] No console errors on any character sheet operation

---

### Verification Steps

> **✓ VERIFY:** Full Phase 4 end-to-end flow:

- Compendium → search "fireball" → open detail → "Add to Character" → select Kaelthas → spell appears in Known Spells
- Open Kaelthas → Spells tab → Fireball listed → "Use Slot" (3rd level) → pip fills → Long Rest → pip clears, HP restored
- Inventory tab → "Add Item" → search "longsword" → add → equip → shield icon shows
- Damage to 0 HP → Death Saves panel appears → roll 3 successes → "Stable" banner
- Level Up 5 → 6: new slots shown in summary, `hp_max` increases, sheet updates
- AI Assistant: "Character Background" generates text referencing race, class, and campaign world

> **✓ VERIFY:** Phase 4 complete when all checklist items pass and the full Compendium → Character Sheet flow works end to end.

```bash
git add .
git commit -m "[Phase 4] Complete: Compendium browser, custom entries, character sheets, inventory, spell slots, level up"
git push
```

---

*⚔ End of Phase 4 Agent Prompts ⚔*
