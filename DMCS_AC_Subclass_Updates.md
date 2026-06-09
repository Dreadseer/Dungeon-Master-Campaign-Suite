# ⚔ DMCS — AC & Subclass Updates
## Claude Code Update Prompts 01 – 03

> **Save this file as:** `DMCS_AC_Subclass_Updates.md`

**Updates covered:** Armor Class Engine · 24 SRD Subclasses · Level-Up Selection · Features Tab Integration

---

## Update Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | Armor Class System | `acUtils.js` with full armor table and calculation engine, AC chip on Stats tab, AC breakdown panel, override controls | 2 – 3 hrs |
| 02 | Subclass Data Layer | Migration 006, 24 SRD subclasses seeded for all 12 classes, `setSubclass` IPC handler | 2 – 3 hrs |
| 03 | Subclass UI | Creation modal picker, Level Up selection step, `SubclassCard` component, Features tab integration | 2 – 3 hrs |

*Total estimated time: 6 – 9 hours*

> **⚔ IMPORTANT:** These prompts require the previous character sheet updates (Attacks Tab, Features & Traits Tab, Inventory, Spells, Speed) to already be implemented. Prompt 01 adds AC to the existing stat chip row. Prompt 03 adds to the existing Features tab. Run those update prompts first if not already done.

---

## Update Prompt 01 — Armor Class (AC) System
### *AC calculation engine, equipment-based AC, unarmored formulas, display on Stats tab*

---

### Context

Armor Class (AC) is the number an attacker must meet or beat on an attack roll to hit a creature. It does **not** reduce damage — it is purely a hit-or-miss threshold. A goblin rolls d20 + attack bonus; if the total meets or beats the target's AC, the attack hits. AC comes from: equipped armor, shields, Dexterity modifier, class features (Barbarian/Monk Unarmored Defense), magic items, and manual overrides. This prompt builds the full AC calculation engine and adds the AC chip to the Stats tab.

---

### Your Task

#### ▸ Step 1 — Create the AC calculation utility

📄 `src/utils/acUtils.js`

```javascript
import { abilityMod } from './dnd5e'

// D&D 5e SRD armor table
// base_ac: AC provided by the armor
// max_dex: maximum DEX bonus allowed (null = no cap)
// min_strength: minimum STR to wear without speed penalty
// stealth_disadvantage: true if armor causes stealth disadvantage
// armor_type: "light" | "medium" | "heavy" | "shield"
export const ARMOR_TABLE = {
  // Light armor — adds full DEX mod
  'padded':          { base_ac: 11, max_dex: null, min_strength: null, stealth_disadvantage: true,  armor_type: 'light'  },
  'leather':         { base_ac: 11, max_dex: null, min_strength: null, stealth_disadvantage: false, armor_type: 'light'  },
  'studded leather': { base_ac: 12, max_dex: null, min_strength: null, stealth_disadvantage: false, armor_type: 'light'  },
  // Medium armor — adds DEX mod up to +2
  'hide':            { base_ac: 12, max_dex: 2,    min_strength: null, stealth_disadvantage: false, armor_type: 'medium' },
  'chain shirt':     { base_ac: 13, max_dex: 2,    min_strength: null, stealth_disadvantage: false, armor_type: 'medium' },
  'scale mail':      { base_ac: 14, max_dex: 2,    min_strength: null, stealth_disadvantage: true,  armor_type: 'medium' },
  'breastplate':     { base_ac: 14, max_dex: 2,    min_strength: null, stealth_disadvantage: false, armor_type: 'medium' },
  'half plate':      { base_ac: 15, max_dex: 2,    min_strength: null, stealth_disadvantage: true,  armor_type: 'medium' },
  // Heavy armor — no DEX bonus
  'ring mail':       { base_ac: 14, max_dex: 0,    min_strength: null, stealth_disadvantage: true,  armor_type: 'heavy'  },
  'chain mail':      { base_ac: 16, max_dex: 0,    min_strength: 13,   stealth_disadvantage: true,  armor_type: 'heavy'  },
  'splint':          { base_ac: 17, max_dex: 0,    min_strength: 15,   stealth_disadvantage: true,  armor_type: 'heavy'  },
  'plate':           { base_ac: 18, max_dex: 0,    min_strength: 15,   stealth_disadvantage: true,  armor_type: 'heavy'  },
  // Shield — flat +2
  'shield':          { base_ac: 2,  max_dex: null, min_strength: null, stealth_disadvantage: false, armor_type: 'shield' },
}

// Fuzzy-match an item name against the armor table
export const matchArmor = (itemName) => {
  const name = (itemName ?? '').toLowerCase().trim()
  if (ARMOR_TABLE[name]) return { key: name, data: ARMOR_TABLE[name] }
  for (const [key, data] of Object.entries(ARMOR_TABLE)) {
    if (name.includes(key) || key.includes(name)) return { key, data }
  }
  return null
}

// Unarmored Defense formulas per class
export const UNARMORED_FORMULAS = {
  Barbarian: (stats) => 10 + abilityMod(stats.dex ?? 10) + abilityMod(stats.con ?? 10),
  Monk:      (stats) => 10 + abilityMod(stats.dex ?? 10) + abilityMod(stats.wis ?? 10),
  default:   (stats) => 10 + abilityMod(stats.dex ?? 10),
}

/**
 * calculateAC(character) → {
 *   ac:          number  — final calculated AC
 *   breakdown:   string  — "Chain Mail (16) + Shield (+2) = 18"
 *   wearing:     string  — equipped armor name or "Unarmored"
 *   has_shield:  boolean — whether a shield is equipped
 *   stealth_dis: boolean — whether stealth disadvantage applies
 *   warnings:    string[] — STR requirement not met, etc.
 * }
 */
export const calculateAC = (character) => {
  const stats    = JSON.parse(character.stats    ?? '{}')
  const inv      = JSON.parse(character.inventory ?? '[]')
  const warnings = []

  // Manual override bypasses all calculation
  if (stats.ac_override != null) {
    return {
      ac:          stats.ac_override,
      breakdown:   `Manual override: ${stats.ac_override}`,
      wearing:     'Custom',
      has_shield:  false,
      stealth_dis: false,
      warnings:    [],
    }
  }

  const dexMod   = abilityMod(stats.dex ?? 10)
  const strScore = stats.str ?? 10

  // Find equipped armor and shield
  let equippedArmor  = null
  let equippedShield = null

  inv.filter(item => item.equipped).forEach(item => {
    const match = matchArmor(item.name)
    if (!match) return
    if (match.data.armor_type === 'shield') {
      equippedShield = { item, armorData: match.data }
    } else {
      equippedArmor  = { item, armorData: match.data }
    }
  })

  const magicAcBonus = stats.ac_magic_bonus ?? 0
  let baseAC     = 0
  let breakdown  = ''
  let wearing    = 'Unarmored'
  let stealthDis = false

  if (equippedArmor) {
    const ad   = equippedArmor.armorData
    wearing    = equippedArmor.item.name
    stealthDis = ad.stealth_disadvantage

    if (ad.min_strength && strScore < ad.min_strength) {
      warnings.push(`STR ${ad.min_strength} required for ${wearing}. Speed is reduced by 10 ft.`)
    }

    if (ad.armor_type === 'heavy') {
      baseAC    = ad.base_ac
      breakdown = `${wearing} (${ad.base_ac})`
    } else {
      const dexBonus = ad.max_dex != null ? Math.min(dexMod, ad.max_dex) : dexMod
      baseAC         = ad.base_ac + dexBonus
      const capNote  = ad.max_dex != null && dexMod > ad.max_dex ? ` (capped at +${ad.max_dex})` : ''
      breakdown      = `${wearing} (${ad.base_ac}) + DEX +${dexBonus}${capNote}`
    }
  } else {
    const className = character.class ?? ''
    const formula   = UNARMORED_FORMULAS[className] ?? UNARMORED_FORMULAS.default
    baseAC          = formula(stats)
    if (className === 'Barbarian') {
      breakdown = `Unarmored Defense (10 + DEX +${dexMod} + CON +${abilityMod(stats.con ?? 10)})`
    } else if (className === 'Monk') {
      breakdown = `Unarmored Defense (10 + DEX +${dexMod} + WIS +${abilityMod(stats.wis ?? 10)})`
    } else {
      breakdown = `Unarmored (10 + DEX +${dexMod})`
    }
  }

  const shieldBonus = equippedShield ? equippedShield.armorData.base_ac : 0
  if (shieldBonus)   breakdown += ` + Shield (+${shieldBonus})`
  if (magicAcBonus)  breakdown += ` + Magic (+${magicAcBonus})`

  const finalAC = baseAC + shieldBonus + magicAcBonus
  breakdown    += ` = ${finalAC}`

  return { ac: finalAC, breakdown, wearing, has_shield: !!equippedShield, stealth_dis: stealthDis, warnings }
}
```

---

#### ▸ Step 2 — Extend stats JSON for AC overrides

Two new optional fields (backward-compatible — existing characters will have them as `undefined`):

```javascript
// stats.ac_override:    number | null — bypasses all calculation, uses this value directly
//                                       Use for: Wild Shape, Mage Armor, homebrew
// stats.ac_magic_bonus: number        — adds ON TOP of calculated AC (default 0)
//                                       Use for: Ring of Protection, Cloak of Protection
```

---

#### ▸ Step 3 — Add AC IPC handler

📄 `electron/ipc/dbHandlers.js`

```javascript
ipcMain.handle('db:characters:updateAC', (_, charId, updates) => {
  // updates: { ac_override?: number|null, ac_magic_bonus?: number }
  const char  = db.get('SELECT stats FROM characters WHERE id=?', [charId])
  const stats = JSON.parse(char.stats ?? '{}')
  if ('ac_override'    in updates) stats.ac_override    = updates.ac_override
  if ('ac_magic_bonus' in updates) stats.ac_magic_bonus = updates.ac_magic_bonus ?? 0
  return db.run('UPDATE characters SET stats=? WHERE id=?', [JSON.stringify(stats), charId])
})
```

Add to preload.js: `db.characters.updateAC(charId, updates)`

---

#### ▸ Step 4 — Add the AC Chip to the Stats tab

📄 `src/components/character/CharacterSheet.jsx`

```javascript
import { calculateAC } from '../../utils/acUtils'

// Inside the Stats tab render:
const acResult = calculateAC(character)
```

Update `StatChip` to support `tooltip` and `badge` props, then add AC as the first chip:

```jsx
<div style={{ display:'flex', gap:'1rem', margin:'1rem 0', flexWrap:'wrap' }}>
  <StatChip
    label="Armor Class"
    value={acResult.ac}
    color="#C0392B"
    tooltip={acResult.breakdown}
    badge={acResult.has_shield ? '🛡' : undefined}
  />
  <StatChip label="Proficiency Bonus"  value={`+${profBonus(character.level)}`} color="#C9A84C" />
  <StatChip label="Movement Speed"     value={`${stats.speed ?? 30} ft`}         color="#4A90D9" />
  <StatChip label="Passive Perception" value={passivePerception(...)}            color="#9B59B6" />
</div>
```

Updated `StatChip` signature:
```jsx
function StatChip({ label, value, color, tooltip, badge }) {
  return (
    <div title={tooltip} style={{
      background: '#1a1208', border: `2px solid ${color}`,
      borderRadius: '8px', padding: '10px 16px',
      textAlign: 'center', minWidth: '120px',
      cursor: tooltip ? 'help' : 'default',
    }}>
      <div style={{ fontSize:'22px', fontWeight:'bold', color, fontFamily:'Georgia' }}>
        {value}
        {badge && <span style={{ fontSize:'14px', marginLeft:'4px' }}>{badge}</span>}
      </div>
      <div style={{ fontSize:'11px', color:'#6b6b6b', marginTop:'4px',
        textTransform:'uppercase', letterSpacing:'0.5px' }}>{label}</div>
    </div>
  )
}
```

---

#### ▸ Step 5 — Add AC warnings

Below the chip row, show warnings when STR requirements are not met or stealth disadvantage applies:

```jsx
{acResult.warnings.length > 0 && (
  <div style={{ marginTop:'8px' }}>
    {acResult.warnings.map((w, i) => (
      <div key={i} style={{
        background:'#2a0a00', border:'1px solid #BA7517', borderRadius:'4px',
        padding:'6px 12px', color:'#F5A623', fontSize:'13px', marginBottom:'4px'
      }}>
        ⚠ {w}
      </div>
    ))}
  </div>
)}
{acResult.stealth_dis && (
  <div style={{ fontSize:'12px', color:'#8a8a8a', marginTop:'4px' }}>
    🔇 Stealth disadvantage from {acResult.wearing}
  </div>
)}
```

---

#### ▸ Step 6 — Build the AC Breakdown Panel

📄 `src/components/character/ACBreakdownPanel.jsx`

Expandable panel below the chip row showing formula + override controls:

- Collapsed by default, "▼ AC Breakdown" toggle button
- When expanded shows:
  - Full breakdown string in gold (e.g. "Chain Mail (16) + Shield (+2) = 18")
  - **Manual AC Override** — number input, leave blank to use calculated AC. Saves via `db.characters.updateAC(character.id, { ac_override: val })` on blur. Hint: "Use for Wild Shape, Mage Armor, or homebrew AC"
  - **Magic AC Bonus** — number input (default 0). Saves via `db.characters.updateAC(character.id, { ac_magic_bonus: val })` on blur. Hint: "Ring of Protection, Cloak of Protection, etc."

Render `<ACBreakdownPanel character={character} />` directly below the chip row in the Stats tab.

---

#### ▸ Step 7 — Update Player Character Sheet

📄 `src/components/player/PlayerCharacterSheet.jsx`

Replace the static "AC 14" shield badge with the full calculated result:

```javascript
import { calculateAC } from '../../utils/acUtils'
const acResult = calculateAC(character)
// Display: acResult.ac in shield badge
// Display: acResult.wearing in small text below (e.g. "Leather Armor")
// Shield emoji if acResult.has_shield
```

---

### Verification Steps

> **✓ VERIFY:** Test AC calculation across all armor types:

```javascript
// 1. Unarmored Fighter (DEX 14 = +2 mod)
//    Expected AC: 12 | Breakdown: "Unarmored (10 + DEX +2) = 12"

// 2. Equip Leather Armor (light)
//    Expected AC: 13 | Breakdown: "Leather (11) + DEX +2 = 13"

// 3. Equip Chain Mail (heavy) — no DEX
//    Expected AC: 16 | Breakdown: "Chain Mail (16) = 16"

// 4. Equip Chain Mail + Shield
//    Expected AC: 18 | Breakdown: "Chain Mail (16) + Shield (+2) = 18"

// 5. Barbarian unarmored (DEX +2, CON +3)
//    Expected AC: 15 | Breakdown: "Unarmored Defense (10 + DEX +2 + CON +3) = 15"

// 6. Half Plate (medium) with DEX +4 — DEX capped at +2
//    Expected AC: 17 | Breakdown: "Half Plate (15) + DEX +2 (capped at +2) = 17"

// 7. Set ac_override to 20 in breakdown panel
//    Expected: AC chip shows 20, breakdown shows "Manual override: 20"

// 8. Plate armor (STR 15 req) on character with STR 12
//    Expected: AC calculates correctly + amber warning banner appears
```

- AC chip is the leftmost chip in the Stats tab
- AC updates automatically when items are equipped/unequipped
- Manual override replaces calculation; clearing restores automatic calculation
- Magic bonus stacks on top of calculated AC
- Barbarian and Monk use their special unarmored formulas
- Player sheet shows correct AC using the same calculation

> **⚠ WARNING:** Do NOT move to Prompt 02 until AC updates live when items are equipped/unequipped and all 8 test cases produce the correct values.

---

## Update Prompt 02 — Subclass Data Layer
### *DB schema, all subclasses for all 12 classes, IPC handlers*

---

### Context

Prompt 01 is complete. This prompt builds the subclass data layer. A subclass is a specialization of a base class — it does not replace the class, it adds extra features at specific levels. A Fighter is always a Fighter; Champion and Battle Master are both Fighter subclasses that add different features on top. This prompt adds the database table, seeds all 24 SRD subclasses, and wires the IPC handlers.

---

### Your Task

#### ▸ Step 1 — Add subclasses table migration

📄 `electron/database/DatabaseService.js`

Add Migration 006 inside `runMigrations()`:

```javascript
// Migration 006 — Subclasses catalog table
db.run(`
  CREATE TABLE IF NOT EXISTS subclasses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    class_name   TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    unlock_level INTEGER NOT NULL DEFAULT 3,
    features     TEXT NOT NULL DEFAULT '[]',
    source       TEXT DEFAULT 'srd'
  )
`)

// Add subclass_name to characters table
db.run('ALTER TABLE characters ADD COLUMN subclass_name TEXT')
```

After Migration 006 runs, call `this.seedSubclasses()`.

---

#### ▸ Step 2 — Seed the subclass catalog

Add a `seedSubclasses()` method to `DatabaseService`. Only runs if the table is empty. Seeds all 24 SRD subclasses — 2 per class for all 12 base classes:

| Class | Subclass 1 | Unlock | Subclass 2 | Unlock |
|---|---|---|---|---|
| Fighter | Champion | 3 | Battle Master | 3 |
| Fighter | Eldritch Knight | 3 | — | — |
| Rogue | Thief | 3 | Assassin | 3 |
| Rogue | Arcane Trickster | 3 | — | — |
| Wizard | School of Evocation | 2 | School of Necromancy | 2 |
| Wizard | School of Illusion | 2 | — | — |
| Cleric | Life Domain | 1 | War Domain | 1 |
| Barbarian | Path of the Berserker | 3 | Path of the Totem Warrior | 3 |
| Paladin | Oath of Devotion | 3 | Oath of the Ancients | 3 |
| Ranger | Hunter | 3 | Beast Master | 3 |
| Druid | Circle of the Land | 2 | Circle of the Moon | 2 |
| Bard | College of Lore | 3 | College of Valor | 3 |
| Monk | Way of the Open Hand | 3 | Way of Shadow | 3 |
| Sorcerer | Draconic Bloodline | 1 | Wild Magic | 1 |
| Warlock | The Fiend | 1 | The Archfey | 1 |

Each subclass has a `features` JSON array of `{ name, description, level_gained }` objects covering all features from unlock level through level 20.

Key features per subclass (include all of these in the seed data):

**Fighter — Champion:** Improved Critical (3), Remarkable Athlete (7), Additional Fighting Style (10), Superior Critical (15), Survivor (18)

**Fighter — Battle Master:** Combat Superiority (3), Student of War (3), Know Your Enemy (7), Improved Combat Superiority (10), Relentless (15)

**Fighter — Eldritch Knight:** Spellcasting (3), Weapon Bond (3), War Magic (7), Eldritch Strike (10), Arcane Charge (15)

**Rogue — Thief:** Fast Hands (3), Second-Story Work (3), Supreme Sneak (9), Use Magic Device (13), Thief's Reflexes (17)

**Rogue — Assassin:** Bonus Proficiencies (3), Assassinate (3), Infiltration Expertise (9), Impostor (13), Death Strike (17)

**Rogue — Arcane Trickster:** Spellcasting (3), Mage Hand Legerdemain (3), Magical Ambush (9), Versatile Trickster (13), Spell Thief (17)

**Wizard — School of Evocation:** Evocation Savant (2), Sculpt Spells (2), Potent Cantrip (6), Empowered Evocation (10), Overchannel (14)

**Barbarian — Berserker:** Frenzy (3), Mindless Rage (6), Intimidating Presence (10), Retaliation (14)

**Sorcerer — Draconic Bloodline:** Dragon Ancestor (1), Draconic Resilience (1) — *Note: Draconic Resilience grants AC = 13 + DEX modifier when unarmored. Store this in the feature description.*

---

#### ▸ Step 3 — Add Subclass IPC handlers

📄 `electron/ipc/dbHandlers.js`

```javascript
// Subclasses
ipcMain.handle('db:subclasses:getByClass', (_, className) =>
  db.all('SELECT * FROM subclasses WHERE class_name = ? ORDER BY name ASC', [className]))

ipcMain.handle('db:subclasses:getByName', (_, className, subclassName) =>
  db.get('SELECT * FROM subclasses WHERE class_name = ? AND name = ?', [className, subclassName]))

ipcMain.handle('db:subclasses:getAll', () =>
  db.all('SELECT * FROM subclasses ORDER BY class_name ASC, name ASC'))

// Set character subclass
ipcMain.handle('db:characters:setSubclass', (_, charId, subclassName) =>
  db.run('UPDATE characters SET subclass_name=? WHERE id=?', [subclassName ?? null, charId]))

// Custom (homebrew) subclass CRUD
ipcMain.handle('db:subclasses:create', (_, data) =>
  db.run(`
    INSERT INTO subclasses (class_name, name, description, unlock_level, features, source)
    VALUES (?,?,?,?,?,'custom')`,
    [data.class_name, data.name, data.description, data.unlock_level,
     JSON.stringify(data.features ?? [])]))

ipcMain.handle('db:subclasses:delete', (_, id) =>
  db.run('DELETE FROM subclasses WHERE id=?', [id]))
```

---

#### ▸ Step 4 — Expose in preload.js

- `db.subclasses.getByClass(className)` · `db.subclasses.getByName(className, subclassName)` · `db.subclasses.getAll()`
- `db.characters.setSubclass(charId, subclassName)`
- `db.subclasses.create(data)` · `db.subclasses.delete(id)`

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// After the migration runs on app launch:
const fighterSubs = await window.electronAPI.db.subclasses.getByClass("Fighter")
console.log(fighterSubs.map(s => s.name))
// Expected: ["Battle Master", "Champion", "Eldritch Knight"]

const champion  = await window.electronAPI.db.subclasses.getByName("Fighter", "Champion")
console.log(champion.unlock_level)  // 3
const features  = JSON.parse(champion.features)
console.log(features[0].name)       // "Improved Critical"
console.log(features[0].level_gained)  // 3

const all = await window.electronAPI.db.subclasses.getAll()
console.log(all.length)  // Expected: 24 (2+ per class × 12 classes)

// Set a subclass on a character:
await window.electronAPI.db.characters.setSubclass(1, "Champion")
const char = await window.electronAPI.db.characters.getById(1)
console.log(char.subclass_name)  // "Champion"
```

- Migration 006 creates `subclasses` table and adds `subclass_name` column to `characters`
- 24+ SRD subclasses seeded correctly
- `getByClass()` returns only subclasses for the specified class
- Features parse correctly from JSON
- `setSubclass()` persists to the characters table

> **⚠ WARNING:** Do NOT move to Prompt 03 until the DB has 24 seeded subclasses and `setSubclass()` persists to the characters table.

---

## Update Prompt 03 — Subclass UI
### *Character creation picker, Level Up selection step, Features tab integration*

---

### Context

Prompt 02 is complete. The subclasses table has all SRD subclasses seeded and all IPC handlers are wired. This prompt builds the UI: subclass selection in character creation, subclass selection during level-up, and subclass features displayed in the Features & Traits tab.

---

### Your Task

#### ▸ Step 1 — Add subclass selection to character creation

📄 `src/pages/CharacterSheets.jsx`

After the Class field in the character creation modal, add dynamic subclass loading:

```javascript
const [availableSubclasses, setAvailableSubclasses] = useState([])

// Load subclasses when class changes
useEffect(() => {
  if (!formData.class) return
  window.electronAPI.db.subclasses.getByClass(formData.class)
    .then(subs => {
      setAvailableSubclasses(subs)
      setFormData(prev => ({ ...prev, subclass_name: '' }))
    })
}, [formData.class])

// Only show subclass picker if level meets the unlock requirement
const minUnlock = availableSubclasses.length > 0
  ? Math.min(...availableSubclasses.map(s => s.unlock_level))
  : 3

const showSubclass = parseInt(formData.level) >= minUnlock
```

When `showSubclass` is true, render:

```jsx
<div>
  <label>Subclass (optional)</label>
  <select
    value={formData.subclass_name ?? ''}
    onChange={e => setFormData(prev => ({ ...prev, subclass_name: e.target.value }))}
  >
    <option value="">— Choose a subclass —</option>
    {availableSubclasses.map(s => (
      <option key={s.id} value={s.name}>{s.name}</option>
    ))}
  </select>
  <span style={{ fontSize:'12px', color:'#6b6b6b' }}>
    Subclasses unlock at level {minUnlock} for {formData.class}.
    You can select one now or leave blank to choose later.
  </span>
</div>
```

In the submit handler, after `db.characters.create()`:

```javascript
if (formData.subclass_name) {
  const allChars = await window.electronAPI.db.characters.getAll(activeCampaign.id)
  const latest   = allChars[allChars.length - 1]
  await window.electronAPI.db.characters.setSubclass(latest.id, formData.subclass_name)
  // Also merge level-appropriate subclass features into stats.features.class_features
}
```

---

#### ▸ Step 2 — Build the SubclassCard component

📄 `src/components/character/SubclassCard.jsx`

```jsx
export default function SubclassCard({ subclass, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  const features = JSON.parse(subclass.features ?? '[]')

  return (
    <div
      onClick={onSelect}
      style={{
        border:       selected ? '2px solid #C9A84C' : '1px solid #2d1f0a',
        borderLeft:   `4px solid ${selected ? '#C9A84C' : '#3d2f1a'}`,
        borderRadius: '8px', padding: '14px', marginBottom: '10px',
        background:   selected ? '#1a1208' : '#0d0a05',
        cursor:       'pointer',
        boxShadow:    selected ? '0 0 10px rgba(201,168,76,0.3)' : 'none',
      }}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontFamily:'Georgia', fontSize:'16px',
            fontWeight:'bold', color: selected ? '#C9A84C' : '#e8e0d0' }}>
            {subclass.name}
          </div>
          <div style={{ fontSize:'12px', color:'#6b6b6b', marginTop:'2px' }}>
            {subclass.class_name} • Unlocks at Level {subclass.unlock_level}
          </div>
        </div>
        {selected && <span style={{ color:'#C9A84C', fontSize:'20px' }}>✓</span>}
      </div>

      <p style={{ fontSize:'13px', color:'#c0b8a8', marginTop:'8px', lineHeight:'1.5' }}>
        {subclass.description}
      </p>

      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(ex => !ex) }}
        style={{ background:'none', border:'none', color:'#6b6b6b',
          fontSize:'12px', cursor:'pointer', padding:'4px 0', marginTop:'4px' }}
      >
        {expanded ? '▲ Hide features' : `▼ See ${features.length} features`}
      </button>

      {expanded && (
        <div style={{ marginTop:'8px', borderTop:'1px solid #2d1f0a', paddingTop:'8px' }}>
          {features.map((f, i) => (
            <div key={i} style={{ marginBottom:'6px' }}>
              <span style={{ fontWeight:'bold', color:'#C9A84C', fontSize:'13px' }}>{f.name}</span>
              <span style={{ fontSize:'11px', color:'#6b6b6b', marginLeft:'6px' }}>
                (Level {f.level_gained})
              </span>
              <p style={{ fontSize:'12px', color:'#c0b8a8', margin:'2px 0 0', lineHeight:'1.5' }}>
                {f.description}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

#### ▸ Step 3 — Add subclass selection to Level Up modal

📄 `src/components/character/LevelUpModal.jsx`

Add a "Choose Subclass" step that appears when `newLevel === subclass unlock level` AND `!character.subclass_name`:

```javascript
const [subclassCandidates, setSubclassCandidates] = useState([])
const [selectedSubclass,   setSelectedSubclass]   = useState(null)

useEffect(() => {
  if (!character.class) return
  window.electronAPI.db.subclasses.getByClass(character.class)
    .then(setSubclassCandidates)
}, [character.class])

// Show subclass step when this level-up triggers it
const triggerSubclass = subclassCandidates.length > 0
  && !character.subclass_name
  && subclassCandidates.some(s => s.unlock_level === newLevel)
```

Step UI — show between Hit Points and Spell Slots steps:

```jsx
// Step: "Choose Subclass"
<div>
  <h3 style={{ color:'#C9A84C', fontFamily:'Georgia' }}>Choose Your Subclass</h3>
  <p style={{ color:'#6b6b6b', fontSize:'13px' }}>
    As a level {newLevel} {character.class}, you choose a specialization.
    This cannot be changed later.
  </p>
  {subclassCandidates
    .filter(s => s.unlock_level <= newLevel)
    .map(sub => (
      <SubclassCard
        key={sub.id}
        subclass={sub}
        selected={selectedSubclass?.id === sub.id}
        onSelect={() => setSelectedSubclass(sub)}
      />
    ))}
  <button
    disabled={!selectedSubclass}
    onClick={() => advanceStep()}
    style={{ opacity: selectedSubclass ? 1 : 0.4, ... }}
  >
    {selectedSubclass ? `Choose ${selectedSubclass.name}` : 'Select a subclass to continue'}
  </button>
</div>
```

In the Level Up "Apply" handler, if subclass was selected:

```javascript
if (selectedSubclass) {
  await window.electronAPI.db.characters.setSubclass(character.id, selectedSubclass.name)
  // Merge subclass features into stats.features.class_features
  const subFeatures = JSON.parse(selectedSubclass.features)
  const newCF = [
    ...(stats.features?.class_features ?? []),
    ...subFeatures.filter(f => f.level_gained <= newLevel)
  ].sort((a, b) => a.level_gained - b.level_gained)
  stats.features = { ...(stats.features ?? {}), class_features: newCF }
  await window.electronAPI.db.characters.updateStats(character.id, stats)
}
```

---

#### ▸ Step 4 — Display subclass in the Features & Traits tab

📄 `src/components/character/FeaturesTab.jsx`

**If character has a subclass — add a Subclass section ABOVE Class Features:**

```jsx
{character.subclass_name && selectedSubclass && (
  <div style={{ marginBottom:'16px' }}>
    <h3 style={{ color:'#C9A84C' }}>
      🌟 Subclass — {character.subclass_name}
      <span style={{ fontSize:'13px', color:'#6b6b6b', marginLeft:'8px' }}>
        ({character.class})
      </span>
    </h3>
    <p style={{ color:'#c0b8a8', fontSize:'13px' }}>{selectedSubclass.description}</p>

    {JSON.parse(selectedSubclass.features).map((f, i) => (
      <FeatureCard
        key={i}
        name={f.name}
        badge={f.level_gained <= character.level ? `Level ${f.level_gained}` : undefined}
        description={f.description}
        style={{
          opacity: f.level_gained <= character.level ? 1 : 0.4,
        }}
      />
    ))}
  </div>
)}
```

Fetch the selected subclass data on tab mount:
```javascript
useEffect(() => {
  if (!character.subclass_name || !character.class) return
  window.electronAPI.db.subclasses.getByName(character.class, character.subclass_name)
    .then(setSelectedSubclass)
}, [character.subclass_name, character.class])
```

**If character is at or above unlock level but has no subclass — show the selection prompt:**

```jsx
{!character.subclass_name && meetsUnlockLevel && (
  <div style={{ background:'#1a1208', border:'2px solid #C9A84C',
    borderRadius:'8px', padding:'16px', marginBottom:'16px' }}>
    <div style={{ color:'#C9A84C', fontFamily:'Georgia', fontSize:'15px', marginBottom:'8px' }}>
      ⚔ Choose Your Subclass
    </div>
    <p style={{ color:'#c0b8a8', fontSize:'13px', marginBottom:'12px' }}>
      As a level {character.level} {character.class}, you can now choose your specialization.
    </p>
    {availableSubclasses
      .filter(s => s.unlock_level <= character.level)
      .map(sub => (
        <SubclassCard
          key={sub.id}
          subclass={sub}
          selected={false}
          onSelect={async () => {
            await window.electronAPI.db.characters.setSubclass(character.id, sub.name)
            const subFeatures = JSON.parse(sub.features)
            const newCF = [
              ...(stats.features?.class_features ?? []),
              ...subFeatures.filter(f => f.level_gained <= character.level)
            ].sort((a, b) => a.level_gained - b.level_gained)
            stats.features = { ...(stats.features ?? {}), class_features: newCF }
            await onUpdateStats(stats)
            // Trigger parent refresh
          }}
        />
      ))}
  </div>
)}
```

---

#### ▸ Step 5 — Update the character sheet header

📄 `src/components/character/CharacterSheet.jsx` and `src/components/player/PlayerCharacterSheet.jsx`

Update the subtitle line below the character name:

```jsx
// Current: "Race · Class · Level"
// Updated: "Race · Class · SubclassName · Level" (when subclass exists)

const subtitle = [
  character.race,
  character.class,
  character.subclass_name,  // only if set
  `Level ${character.level}`,
].filter(Boolean).join(' · ')
```

Example: `"Dwarf · Fighter · Champion · Level 5"`

---

### Verification Steps

> **✓ VERIFY:**

```javascript
// 1. Create a level 3 Fighter → subclass dropdown appears → choose Champion
const char = await window.electronAPI.db.characters.getById(1)
console.log(char.subclass_name)  // "Champion"

// 2. Create a level 1 Fighter → NO subclass dropdown appears

// 3. Level Up a level 2 Fighter to level 3 via Level Up modal
//    Expected: "Choose Subclass" step appears between HP and Spell Slots
//    Expected: SubclassCards show description + expandable features

// 4. Create a level 2 Wizard
//    Expected: subclass dropdown shows (unlock_level = 2)
//    Expected: options are "School of Evocation", "School of Necromancy", "School of Illusion"

// 5. Open Features tab on Champion Fighter
//    Expected: "🌟 Subclass — Champion (Fighter)" section above Class Features
//    Expected: Improved Critical (Level 3) fully visible
//    Expected: Remarkable Athlete (Level 7) dimmed if character is below level 7

// 6. Open Features tab on level 3 Fighter with NO subclass
//    Expected: Gold "Choose Your Subclass" call-to-action with SubclassCards

// 7. Sheet header: "Dwarf · Fighter · Champion · Level 5"
```

- Character creation at level ≥ unlock level: subclass dropdown shows correct options
- Character creation below unlock level: no subclass dropdown
- Level Up modal: "Choose Subclass" step appears at exactly the unlock level
- SubclassCard: description visible, features expandable with level badges
- Features tab with subclass: section shows with dimmed future features
- Features tab without subclass (eligible): gold call-to-action prompt
- Features tab without subclass (not yet eligible): no prompt
- Sheet header shows "Class · Subclass · Level" format
- Selecting a subclass from Features tab adds its features to the class features list

> **⚠ WARNING:** These are the final AC and Subclass updates. Do NOT close this session until all three prompts are verified: AC calculates correctly from equipped armor, all 24 subclasses are seeded, and the subclass selection flow works in character creation, level-up, and the Features tab.

---

*⚔ End of AC & Subclass Update Prompts ⚔*
