# ⚔ DMCS — Phase 5 Agent Prompts
## Encounter Tools — Claude Code Edition

> **Save this file as:** `DMCS_Phase5_Agent_Prompts.md`
> Place it in the root of your project folder alongside the spec and rules documents.

**Modules covered:** Encounter Builder · XP Calculator · Initiative Tracker · Conditions · Combat Log · Map Integration

---

## Prompt Index

| Prompt | Title | Key Deliverables | Time Est. |
|---|---|---|---|
| 01 | Encounter Builder Foundation | Encounter CRUD, monster roster with count/HP/name overrides, monster search panel | 2 – 3 hrs |
| 02 | XP Budget & CR Calculator | Full 5e XP math, party thresholds, multipliers, difficulty badge, AI advisor | 2 – 3 hrs |
| 03 | Initiative Tracker | Combat setup, sorted turn order, HP management, lifecycle (planned→active→completed) | 2 – 3 hrs |
| 04 | Live Combat Tools | 15 conditions, concentration tracking, combat log with export, mid-combat stat blocks | 2 – 3 hrs |
| 05 | Polish, Map Integration & Audit | HP sync, encounter history, map token sync, list polish, full phase audit | 1 – 2 hrs |

*Total estimated time: 9 – 14 hours*

> **⚔ RULE:** Before starting any prompt, open your Claude Code session with the Master Session Opener from `DMCS_Claude_Code_Rules.md`. Update the filename reference to `DMCS_Phase5_Agent_Prompts.md`.

---

## Agent Prompt 01 — Encounter Builder Foundation
### *Create encounters, link to locations, build monster rosters from SRD and custom compendium*

---

### Context

Phase 4 is complete. The Compendium browser shows SRD and custom monsters, spells, and equipment. Character sheets track stats, HP, inventory, and spell slots. This is Prompt 01 of 05 for Phase 5. You are building the Encounter Builder — starting with the data layer and encounter creation UI. The DM assembles a roster of monsters, links the encounter to a location, and saves it for future reference. XP math and the initiative tracker come in Prompts 02 and 03.

---

### Your Task

#### ▸ Step 1 — Add Encounter IPC handlers

📄 `electron/ipc/dbHandlers.js`

Replace the Phase 1 stub encounter handlers:

```javascript
// Encounters — replace Phase 1 stubs
ipcMain.handle('db:encounters:getAll', (_, campaignId) =>
  db.all(`
    SELECT e.*, l.name as location_name
    FROM encounters e
    LEFT JOIN locations l ON e.location_id = l.id
    WHERE e.campaign_id = ?
    ORDER BY e.created_at DESC`,
    [campaignId]))

ipcMain.handle('db:encounters:getById', (_, id) =>
  db.get('SELECT * FROM encounters WHERE id = ?', [id]))

ipcMain.handle('db:encounters:create', (_, data) =>
  db.run(`
    INSERT INTO encounters
      (campaign_id, name, location_id, monsters, status, xp_total, notes, created_at)
    VALUES (?,?,?,?,'planned',?,?,datetime('now'))`,
    [data.campaign_id, data.name, data.location_id ?? null,
     JSON.stringify(data.monsters ?? []),
     data.xp_total ?? 0, data.notes ?? '']))

ipcMain.handle('db:encounters:update', (_, id, data) =>
  db.run(`
    UPDATE encounters
    SET name=?, location_id=?, monsters=?, status=?, xp_total=?, notes=?
    WHERE id=?`,
    [data.name, data.location_id ?? null,
     JSON.stringify(data.monsters), data.status,
     data.xp_total, data.notes, id]))

ipcMain.handle('db:encounters:updateStatus', (_, id, status) =>
  db.run('UPDATE encounters SET status=? WHERE id=?', [status, id]))

ipcMain.handle('db:encounters:updateMonsters', (_, id, monsters, xpTotal) =>
  db.run('UPDATE encounters SET monsters=?, xp_total=? WHERE id=?',
    [JSON.stringify(monsters), xpTotal, id]))

ipcMain.handle('db:encounters:delete', (_, id) =>
  db.run('DELETE FROM encounters WHERE id=?', [id]))
```

---

#### ▸ Step 2 — Update preload.js

- `db.encounters.getAll(campaignId)` · `db.encounters.getById(id)` · `db.encounters.create(data)`
- `db.encounters.update(id, data)` · `db.encounters.updateStatus(id, status)`
- `db.encounters.updateMonsters(id, monsters, xpTotal)` · `db.encounters.delete(id)`

---

#### ▸ Step 3 — Define the encounter monster data structure

📄 `src/utils/encounterUtils.js`

```javascript
// Monster entry shape in encounters.monsters JSON array:
// { id, name, source, source_index, cr, xp, hp_max, hp_current, count, custom_name, notes }

export const CR_XP = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
  1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800,
  6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000,
  21: 33000, 22: 41000, 23: 50000, 24: 62000, 30: 155000
}

export const parseCR = (cr) => {
  if (typeof cr === 'number') return cr
  const map = { '1/8': 0.125, '1/4': 0.25, '1/2': 0.5 }
  return map[String(cr)] ?? parseFloat(cr) ?? 0
}

export const crToXP = (cr) => CR_XP[parseCR(cr)] ?? 0

export const createMonsterEntry = (statBlock, source) => ({
  id:           crypto.randomUUID(),
  name:         statBlock.name,
  source,
  source_index: statBlock.index ?? statBlock.id,
  cr:           statBlock.challenge_rating,
  xp:           crToXP(statBlock.challenge_rating),
  hp_max:       statBlock.hit_points ?? 10,
  hp_current:   statBlock.hit_points ?? 10,
  count:        1,
  custom_name:  null,
  notes:        '',
})
```

---

#### ▸ Step 4 — Build the Encounter Builder page

📄 `src/pages/EncounterBuilder.jsx`

**View A — Encounter list:**
- Fetch `db.encounters.getAll(activeCampaign.id)` on mount
- Each card: name, location badge, monster count, total XP, status badge (Planned=gray, Active=green, Completed=gold)
- "+ New Encounter" button, "Open" button, "Delete" with confirmation
- Status filter tabs: All | Planned | Active | Completed
- Empty state: "No encounters yet. Build your first combat encounter."

**Create Encounter modal:**
- Encounter Name (required), Link to Location (select from `db.locations.getAll()`), Notes (textarea, 3 rows)
- On submit: `db.encounters.create({ ...formData, campaign_id: activeCampaign.id, monsters: [], xp_total: 0 })`

**View B — Encounter editor:**
- "← Encounters" back button, encounter name header, status badge
- Two-column layout: left = Monster Roster (60%), right = Monster Search Panel (40%)

---

#### ▸ Step 5 — Build the Monster Roster panel

📄 `src/components/encounter/MonsterRoster.jsx`

- Each monster entry: name, CR badge, count (+/- buttons), HP, XP value, notes button, remove button
- "Custom HP" override: click HP value → inline input (overrides for this encounter only)
- "Custom Name" override: click name → inline input (e.g. rename "Goblin" to "Scar-Eye")
- Subtotal row: total monster count, raw XP sum (before multipliers)
- "Save Roster" button calls `db.encounters.updateMonsters(id, monsters, xpTotal)`
- Auto-saves with a 1-second debounce after any count/HP change

---

#### ▸ Step 6 — Build the Monster Search panel

📄 `src/components/encounter/MonsterSearchPanel.jsx`

- Search input debounced 300ms — queries `srd.getMonsters({ name })` and `db.compendium.getAll(campaignId, "monster")` simultaneously
- Filter row: CR range (min/max), Type dropdown, Source toggle (SRD / Homebrew / Both)
- Results: name, CR badge, type, HP, source indicator
- "+ Add" button per result calls `createMonsterEntry()` and appends to roster
- If same monster already in roster: button shows "+ Add Another"
- "Recently Used" section at top: last 5 monsters added to any encounter in this campaign

---

### Verification Steps

> **✓ VERIFY:**

```javascript
const cid = 1

await window.electronAPI.db.encounters.create({
  campaign_id: cid,
  name: "Goblin Ambush at the Bridge",
  location_id: 1,
  notes: "Players crossing at night. Goblins attack from both sides."
})

const enc = await window.electronAPI.db.encounters.getAll(cid)
console.log(enc[0].name, enc[0].location_name)
// "Goblin Ambush at the Bridge"  "Riverdale"

console.log(JSON.parse(enc[0].monsters).length)  // 0

const goblins = await window.electronAPI.srd.getMonsters({ name: "goblin" })
console.log(goblins[0].challenge_rating)  // 0.25
```

- Status filter tabs correctly filter encounter list
- "Open" switches to two-column editor view
- Monster search finds goblins, "+ Add" adds to roster
- Count +/- updates raw XP subtotal
- "Custom Name" inline edit persists after save
- Auto-save debounce: rapid count changes don't fire multiple DB writes

> **⚠ WARNING:** Do NOT move to Prompt 02 until roster add/remove/count/custom-name all work and auto-save persists to DB.

---

## Agent Prompt 02 — XP Budget & CR Calculator
### *Encounter difficulty rating, party threshold math, and monster count multipliers*

---

### Context

Prompt 01 is complete. This prompt builds the XP Budget calculator — the D&D 5e system for rating encounter difficulty (Easy, Medium, Hard, Deadly) based on party composition and the monster multiplier table.

---

### Your Task

#### ▸ Step 1 — Create the encounter math utilities

📄 `src/utils/encounterUtils.js` — append to existing file:

```javascript
// XP Thresholds per character level [Easy, Medium, Hard, Deadly]
export const XP_THRESHOLDS = {
   1: [25,   50,   75,   100],   2: [50,   100,  150,  200],
   3: [75,   150,  225,  400],   4: [125,  250,  375,  500],
   5: [250,  500,  750,  1100],  6: [300,  600,  900,  1400],
   7: [350,  750,  1100, 1700],  8: [450,  900,  1400, 2100],
   9: [550,  1100, 1600, 2400],  10: [600, 1200, 1900, 2800],
  11: [800,  1600, 2400, 3600],  12: [1000,2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100],  14: [1250,2500, 3800, 5700],
  15: [1400, 2800, 4300, 6400],  16: [1600,3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800],  18: [2100,4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900], 20: [2800,5700, 8500, 12700],
}

// Sum thresholds for all party members at each tier
export const partyThresholds = (characters) =>
  [0,1,2,3].map(tier =>
    characters.reduce((sum, c) => sum + (XP_THRESHOLDS[c.level]?.[tier] ?? 0), 0)
  )  // returns [easy, medium, hard, deadly]

// Monster count multiplier per 5e DMG
export const monsterMultiplier = (totalMonsterCount) => {
  if (totalMonsterCount === 1)  return 1
  if (totalMonsterCount === 2)  return 1.5
  if (totalMonsterCount <= 6)   return 2
  if (totalMonsterCount <= 10)  return 2.5
  if (totalMonsterCount <= 14)  return 3
  return 4
}

// Adjusted XP = raw XP × multiplier
export const adjustedXP = (monsters) => {
  const totalCount = monsters.reduce((sum, m) => sum + m.count, 0)
  const rawXP      = monsters.reduce((sum, m) => sum + (m.xp * m.count), 0)
  return Math.round(rawXP * monsterMultiplier(totalCount))
}

// Raw XP — used for player reward
export const rawXP = (monsters) =>
  monsters.reduce((sum, m) => sum + (m.xp * m.count), 0)

// Difficulty label and color from adjusted XP vs party thresholds
export const difficultyRating = (adjustedXp, thresholds) => {
  const [easy, medium, hard, deadly] = thresholds
  if (adjustedXp < easy)   return { label: 'Trivial', color: '#6B6B6B' }
  if (adjustedXp < medium) return { label: 'Easy',    color: '#2D7A2D' }
  if (adjustedXp < hard)   return { label: 'Medium',  color: '#B8750A' }
  if (adjustedXp < deadly) return { label: 'Hard',    color: '#C0392B' }
  return                          { label: 'Deadly',  color: '#8B0000' }
}

export const xpBudget = (characters, targetDifficulty) => {
  const tierMap = { easy: 0, medium: 1, hard: 2, deadly: 3 }
  const tier    = tierMap[targetDifficulty.toLowerCase()] ?? 1
  return characters.reduce((sum, c) => sum + (XP_THRESHOLDS[c.level]?.[tier] ?? 0), 0)
}
```

---

#### ▸ Step 2 — Build the XP Budget Calculator component

📄 `src/components/encounter/XPCalculator.jsx`

**Party configuration section:**
- Toggle: "Use Campaign Characters" (loads from `db.characters.getAll()`, DM can uncheck absent players) OR "Manual Entry" (number of players + level input)

**Difficulty display (updates live as roster changes):**
- Large difficulty badge: "DEADLY" / "HARD" / "MEDIUM" / "EASY" / "TRIVIAL" in correct color

**XP breakdown table:**
- Raw Monster XP (before multiplier)
- Monster Count Multiplier (×1, ×1.5, etc.)
- Adjusted XP
- XP Reward per player (rawXP ÷ party size)

**Party thresholds table:** Easy | Medium | Hard | Deadly values for current party

**Threshold bar:** horizontal bar showing where adjusted XP falls relative to the four thresholds

**AI Difficulty Advisor:**

```javascript
const systemPrompt = `You are an expert D&D 5e Dungeon Master.
Analyze this encounter and give 2-3 specific, actionable suggestions.
Be concise — one sentence per suggestion.`

const userMessage = `Encounter: "${encounter.name}"
Party: ${partySize} players, average level ${avgLevel}
Monsters: ${monsters.map(m => `${m.count}x ${m.name} (CR ${m.cr})`).join(', ')}
Difficulty: ${difficulty.label} (${adjustedXp} adjusted XP)
What adjustments would make this encounter better balanced?`
```

Display numbered suggestions below the calculator. "✨ Ask AI" button triggers the call.

---

#### ▸ Step 3 — Build the standalone Combat Calculator page

📄 `src/pages/CombatCalculator.jsx`

Replace the Phase 1 placeholder with a standalone tool:

**Party inputs:** number of players (1–8), individual levels OR average level toggle

**Monster inputs:** dynamic list — each row has search-as-you-type name input (resolves CR from SRD), CR input, count input. "+ Add Monster Row" button, remove (×) per row.

**Results panel:** updates live — difficulty badge, full XP breakdown, threshold bar

**"Save as Encounter" button:** pre-fills Encounter Builder create modal with current monsters and navigates to `/encounters`

---

#### ▸ Step 4 — Integrate XPCalculator into encounter editor

📄 `src/pages/EncounterBuilder.jsx`

- Render `XPCalculator` below `MonsterRoster` in View B
- Pass current `monsters` array as prop — recalculates on any roster change
- When difficulty is "Deadly": show subtle red border around MonsterRoster as visual warning

---

### Verification Steps

> **✓ VERIFY:** Test the math:

```javascript
import { partyThresholds, adjustedXP, difficultyRating, monsterMultiplier } from '../utils/encounterUtils'

// 4 level-5 players
const party  = [{ level:5 },{ level:5 },{ level:5 },{ level:5 }]
const thresh = partyThresholds(party)
console.log(thresh)  // [1000, 2000, 3000, 4400]

// 5 goblins (CR 1/4, 50 XP each)
const monsters = [{ name:"Goblin", cr:"1/4", xp:50, count:5 }]
console.log(monsterMultiplier(5))   // 2
console.log(adjustedXP(monsters))   // 500 (250 raw × 2)
console.log(difficultyRating(500, thresh).label)  // "Trivial" (< 1000 easy)

// 8 goblins
const hard = [{ name:"Goblin", cr:"1/4", xp:50, count:8 }]
console.log(adjustedXP(hard))  // 1000 (400 raw × 2.5)
console.log(difficultyRating(1000, thresh).label)  // "Medium"
```

- XPCalculator updates live as monsters are added/removed from roster
- Multiplier changes: 1=×1, 2=×1.5, 3-6=×2, 7-10=×2.5, 11-14=×3, 15+=×4
- Difficulty badge color matches the correct tier
- Standalone CombatCalculator: search resolves CR from SRD automatically
- "Save as Encounter" pre-fills the create modal correctly
- AI Advisor returns relevant suggestions

> **⚠ WARNING:** Do NOT move to Prompt 03 until all XP math is verified correct using the test cases above.

---

## Agent Prompt 03 — Initiative Tracker
### *Initiative order, turn management, and per-combatant HP tracking*

---

### Context

Prompts 01 and 02 are complete. This prompt builds the Initiative Tracker — the live combat management tool. When the DM starts an encounter, monsters and player characters enter initiative order and combat proceeds turn by turn.

---

### Your Task

#### ▸ Step 1 — Define the combat state data structure

📄 `src/utils/combatUtils.js`

```javascript
// Combatant shape:
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
        name:           entry.count > 1 ? `${entry.name} ${i+1}` : entry.name,
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
```

---

#### ▸ Step 2 — Build the Initiative Tracker component

📄 `src/components/encounter/InitiativeTracker.jsx`

Props: `encounter`, `characters`, `onEndCombat`

**Combat setup phase (before rolling):**
- Shows combatant list with initiative modifier and a number input per combatant
- "Roll All Monsters" button — auto-rolls with `rollInitiative(initiative_mod)` for all monster combatants
- Player initiative values entered manually
- "Begin Combat" button — sorts by initiative and starts the tracker

**Active combat tracker:**
- Sorted combatant list
- Active combatant: gold border + ▶ indicator
- Each row: initiative value, type icon (🧙 player, 💀 monster, 👤 NPC), name, HP bar (color-coded), AC, condition badges, 🎯 if concentrating
- "Next Turn" button at top — advances turn, increments round counter when wrapping
- Round counter: "Round 3" prominently displayed

**HP management inline:**
- Clicking an HP bar opens: Damage (−) and Heal (+) buttons with number input
- Damage: `setHp(Math.max(0, current - amount))`
- Heal: `setHp(Math.min(max, current + amount))`
- Monster at 0 HP: red "Defeated" badge, row dims, moves to bottom
- Player at 0 HP: yellow "Unconscious" badge, prompt DM to begin death saves

---

#### ▸ Step 3 — Wire combat lifecycle into EncounterBuilder

📄 `src/pages/EncounterBuilder.jsx`

**Lifecycle states:**
- `"planned" → "active"`: "Start Combat" switches to `InitiativeTracker`, calls `db.encounters.updateStatus(id, "active")`
- `"active" → "completed"`: "End Combat" confirmation → `db.encounters.updateStatus(id, "completed")` → return to View A
- `"completed"`: View B shows read-only history summary

**Note in UI:** "Combat state is not saved. If you close the app, initiative will reset."

---

#### ▸ Step 4 — Add encounter → map token population

📄 `src/components/encounter/InitiativeTracker.jsx`

"Populate Map Tokens" button (shown if campaign has maps):
- Opens map selector dropdown (all campaign maps from `db.maps.getAll()`)
- Creates tokens using `createToken()` from Phase 3 `tokenUtils.js`:
  - Player combatants: `type="player"`, `entity_type="character"`, `entity_id=combatant.entity_id`
  - Monster combatants: `type="monster"`, free text label
- Calls `db.maps.updateTokens(mapId, newTokens)`
- Toast: "12 tokens added to Riverdale Town Square"

---

### Verification Steps

> **✓ VERIFY:** Full initiative tracker flow:

- Create encounter with 3 goblins, "Start Combat" shows setup phase
- "Roll All Monsters" auto-fills goblin initiatives
- Enter player initiatives, "Begin Combat" — sorted list appears, highest first
- Ties broken by DEX modifier
- "Next Turn" advances through order, wraps from last back to first
- Round counter increments on each wrap
- Damage a goblin to 0 HP — "Defeated" badge, row dims, moves to bottom
- "End Combat" → confirmation → status = "completed" → back to list
- "Populate Map Tokens" adds tokens to selected map

```javascript
const enc = await window.electronAPI.db.encounters.getAll(1)
console.log(enc[0].status)  // "completed"
```

> **⚠ WARNING:** Do NOT move to Prompt 04 until the full combat lifecycle — setup → active → end — works and encounter status persists.

---

## Agent Prompt 04 — Live Combat Tools
### *Conditions, concentration tracking, combat log, and quick-reference panels*

---

### Context

Prompt 03 is complete. This prompt adds the tools that make live combat management fast: the full 5e condition system, concentration spell tracking, a combat event log, and quick-reference panels for monster stat blocks mid-combat.

---

### Your Task

#### ▸ Step 1 — Define conditions

📄 `src/utils/combatUtils.js` — append:

```javascript
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
```

---

#### ▸ Step 2 — Build the Condition Manager

📄 `src/components/encounter/ConditionManager.jsx`

Popover/dropdown triggered by clicking a combatant's condition area:

- Grid of all 15 condition buttons — icon + name
- Active conditions show as highlighted/checked
- Clicking toggles condition on/off for that combatant
- Active conditions display as color-coded pill badges on the combatant row
- Hovering a badge shows tooltip with full description
- Special: toggling "Concentration" sets `combatant.concentration = true` and shows 🎯
- When a concentrating combatant takes damage: alert "Concentration check required! DC `${Math.max(10, Math.floor(damage/2))}` CON save"

---

#### ▸ Step 3 — Build the Combat Log

📄 `src/components/encounter/CombatLog.jsx`

In-memory log (not persisted), displayed in a collapsible right panel:

**Log entry types:**
- Combat started: "⚔️ Combat started — Round 1 begins"
- Turn start: "▶ [Name]'s turn (Initiative [X])"
- HP damage: "[Name] takes [X] damage — [old] → [new] HP"
- HP heal: "[Name] healed [X] — [old] → [new] HP"
- Defeated: "💀 [Name] has been defeated"
- Unconscious: "💤 [Name] is unconscious (0 HP)"
- Condition applied/removed: "[Condition] applied/removed from [Name]"
- Concentration check: "⚠️ Concentration check required for [Name] — DC [X]"
- New round: "═══ Round [X] begins ═══"
- Combat ended: "🏁 Combat ended — [X] rounds"

**Display:** reverse chronological, round number timestamps, color-coded by type (red=damage/defeat, green=healing, gold=turn/round, gray=conditions)

**"Clear Log"** button. **"Export Log"** button — formats as plain text, copies to clipboard.

---

#### ▸ Step 4 — Build mid-combat quick-reference panels

📄 `src/components/encounter/CombatStatBlock.jsx`

Slide-in right panel (320px), triggered by clicking a monster's name in the tracker:
- Condensed stat block: actions, current combat HP (not original), AC
- For players: AC, saving throw proficiencies, spell slots remaining
- Dismissible

📄 `src/components/encounter/SpellCardPanel.jsx`

Triggered by clicking 🎯 on a concentrating combatant:
- Spell name, duration, key mechanical effects
- "Concentration ends when [Name] loses concentration, is incapacitated, casts another concentration spell, or fails a concentration check"
- "Drop Concentration" button — removes flag, logs the event

---

#### ▸ Step 5 — Wire everything into InitiativeTracker

📄 `src/components/encounter/InitiativeTracker.jsx`

- `ConditionManager`: clicking condition area or "+ Condition" button opens it
- `CombatLog`: collapsible right panel, toggle button at top
- `CombatStatBlock`: clicking combatant name opens it
- Concentration damage alert: fires when concentrating combatant takes damage
- All events (HP changes, conditions, turns, rounds) append to the log

---

### Verification Steps

> **✓ VERIFY:**

- Apply "Poisoned" to a goblin — green pill badge appears, hover shows description
- Apply "Concentration" to a player — 🎯 appears
- Deal damage to concentrating player — alert fires with correct DC
- Click a monster name — condensed stat block slides in
- Click 🎯 — SpellCardPanel shows, "Drop Concentration" removes flag and logs
- "Next Turn" → log records turn start entry
- Damage → log records "[Name] takes X damage — old → new HP"
- Defeat a monster → log records defeat, row dims and moves to bottom
- "Export Log" copies clean plain text to clipboard
- All 15 conditions toggle on/off correctly

> **⚠ WARNING:** Do NOT move to Prompt 05 until conditions, concentration tracking, and the combat log all work in a live combat session.

---

## Agent Prompt 05 — Encounter Polish, Map Integration & Phase 5 Audit
### *Encounter history, HP sync to character sheets, map token sync, and phase completion*

---

### Context

Prompts 01–04 are complete. This final Phase 5 prompt adds encounter outcome recording, syncs combat HP back to player character sheets, polishes the encounter list, and runs the full Phase 5 audit.

---

### Your Task

#### ▸ Step 1 — Add encounter outcome recording

📄 `electron/ipc/dbHandlers.js`

```javascript
// Record final combat outcome
ipcMain.handle('db:encounters:recordOutcome', (_, id, outcome) =>
  db.run(`
    UPDATE encounters
    SET status='completed', notes=?, monsters=?
    WHERE id=?`,
    [outcome.notes, JSON.stringify(outcome.finalMonsters), id]))

// Bulk update character HP after combat
ipcMain.handle('db:characters:bulkUpdateHP', (_, updates) => {
  // updates: array of { id, hp_current }
  return db.transaction(() => {
    updates.forEach(u =>
      db.run('UPDATE characters SET hp_current=? WHERE id=?', [u.hp_current, u.id])
    )
  })()
})
```

Expose in preload.js:
- `db.encounters.recordOutcome(id, outcome)`
- `db.characters.bulkUpdateHP(updates)`

---

#### ▸ Step 2 — HP sync on end combat

📄 `src/components/encounter/InitiativeTracker.jsx`

```javascript
const handleEndCombat = async () => {
  // 1. Collect final monster states
  const finalMonsters = combatants
    .filter(c => c.type === 'monster')
    .map(c => ({ ...c.source_entry, hp_current: c.hp_current }))

  // 2. Collect player HP changes
  const playerUpdates = combatants
    .filter(c => c.is_player && c.entity_id)
    .map(c => ({ id: c.entity_id, hp_current: c.hp_current }))

  // 3. Persist outcome
  await window.electronAPI.db.encounters.recordOutcome(encounter.id, {
    notes: encounter.notes + `\n[Combat ended after ${roundCount} rounds]`,
    finalMonsters,
  })

  // 4. Sync player HP to character sheets
  if (playerUpdates.length > 0) {
    await window.electronAPI.db.characters.bulkUpdateHP(playerUpdates)
  }

  addLogEntry(`🏁 Combat ended — ${roundCount} rounds`)
  onEndCombat()
}
```

> **ℹ NOTE:** Always show confirmation before ending combat: "End combat? Player HP changes will be saved to their character sheets. This cannot be undone."

---

#### ▸ Step 3 — Build the Encounter History view

📄 `src/pages/EncounterBuilder.jsx`

When a "completed" encounter is opened in View B, show a read-only history view:

- Header: encounter name, "Completed" badge, location, round count (parsed from notes)
- "Monster Outcomes" section: all monsters with final HP state (alive/defeated)
- "XP Earned" section: total raw XP, XP per player
- "Session Notes" section: encounter notes, editable (DM adds post-combat notes)
- "Reuse as New Encounter" button: clones roster into a new planned encounter with name + " (rerun)", status="planned", HP reset to max

---

#### ▸ Step 4 — Map token sync on defeat

📄 `src/components/encounter/InitiativeTracker.jsx`

When a monster is defeated (HP reaches 0), if its map token exists:
- Add a `defeated: true` flag to the token data
- Update via `db.maps.updateTokens()` — best-effort, only if DM populated tokens this session
- Defeated tokens show a red "X" overlay (rendered in MapToken component based on the flag)

📄 `src/components/map/MapToken.jsx` — add defeated state:
- When `token.defeated === true`, render a red semi-transparent overlay and an × symbol over the token

---

#### ▸ Step 5 — Encounter Builder polish

📄 `src/pages/EncounterBuilder.jsx`
- Search input to filter encounters by name
- Compact card summary: monster count, difficulty badge (from last saved XP), rounds if completed
- "Duplicate" option: clones encounter with name + " (copy)", status="planned", HP reset
- Sort order: Active → Planned → Completed

📄 `src/components/encounter/MonsterRoster.jsx`
- "Clear Roster" button with confirmation
- Drag-to-reorder monster entries (HTML5 drag events, no new library)
- Total monster count badge in roster header: "7 monsters across 3 types"

---

#### ▸ Step 6 — Phase 5 audit checklist

**Encounter Builder:**
- [ ] Create, link to location, add monsters from SRD and custom compendium
- [ ] Count +/- updates, custom name/HP overrides persist
- [ ] Auto-save debounce working
- [ ] Status filter tabs: All / Planned / Active / Completed
- [ ] Duplicate encounter: reset HP, planned status
- [ ] "Reuse as New Encounter" from history view

**XP Calculator:**
- [ ] Multiplier correct for all count ranges (1, 2, 3-6, 7-10, 11-14, 15+)
- [ ] Party thresholds correct for all levels 1–20
- [ ] Difficulty badge shows correct tier and color
- [ ] Threshold bar positions adjusted XP correctly
- [ ] AI Difficulty Advisor returns relevant suggestions
- [ ] Standalone Combat Calculator: live updates, "Save as Encounter" works

**Initiative Tracker:**
- [ ] "Roll All Monsters" auto-rolls with correct DEX modifiers
- [ ] Ties broken by initiative modifier
- [ ] "Next Turn" advances correctly, wraps, increments round counter
- [ ] HP: damage/heal updates in real time, 0 HP triggers correct state
- [ ] "Populate Map Tokens" adds tokens to selected map
- [ ] End combat: player HP synced to character sheets, outcome recorded

**Combat Tools:**
- [ ] All 15 conditions toggle on/off, badges show on tracker row
- [ ] Condition tooltips show descriptions
- [ ] Concentration: 🎯 shows, damage triggers DC check alert
- [ ] Combat log records all event types correctly
- [ ] "Export Log" copies clean text to clipboard
- [ ] Monster stat block slide-in during combat
- [ ] Defeated monsters dim and move to bottom
- [ ] Defeated token overlay (red X) syncs to map
- [ ] No console errors during a full combat session

---

### Verification Steps

> **✓ VERIFY:** Full Phase 5 end-to-end flow:

- Create "Goblin Ambush" with 4 goblins linked to Riverdale
- XP Calculator: 4-player level-3 party → 4 goblins should rate as **Medium**
- "Start Combat" → roll monster initiatives → enter player values → "Begin Combat"
- Apply Poisoned to one goblin, Prone to another
- Defeat all 4 goblins — each dims, moves to bottom, log records defeat
- "Populate Map Tokens" → select Riverdale Town Square → tokens appear on map
- "End Combat" → confirm → player HP synced to character sheets → status = completed
- Reopen completed encounter → history view shows monster outcomes and XP earned
- "Reuse as New Encounter" → new planned encounter with reset HP

```javascript
// Verify final state
const enc = await window.electronAPI.db.encounters.getAll(1)
console.log(enc[0].status)  // "completed"

// Verify player HP was synced
const chars = await window.electronAPI.db.characters.getAll(1)
console.log(chars[0].hp_current)  // reflects combat damage taken
```

> **✓ VERIFY:** Phase 5 complete when: build encounter → rate difficulty → run combat → apply conditions → end combat → sync HP → view history all work end to end.

```bash
git add .
git commit -m "[Phase 5] Complete: Encounter builder, XP calculator, initiative tracker, conditions, combat log, map integration"
git push
```

---

*⚔ End of Phase 5 Agent Prompts ⚔*
