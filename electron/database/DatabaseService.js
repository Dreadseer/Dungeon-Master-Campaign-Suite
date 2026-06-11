const Database = require('better-sqlite3')

class DatabaseService {
  constructor(dbPath) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.runMigrations()
  }

  runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        run_at DATETIME DEFAULT (datetime('now'))
      )
    `)

    const ran = new Set(
      this.db.prepare('SELECT id FROM _migrations').all().map(r => r.id)
    )

    const migrations = [
      { id: 1, name: 'core_schema',       sql: MIGRATION_001 },
      { id: 2, name: 'connections_lore',  sql: MIGRATION_002 },
      { id: 3, name: 'pdf_chunks',        sql: MIGRATION_003 },
      { id: 4, name: 'embedding_columns', sql: MIGRATION_004 },
      { id: 5, name: 'ai_usage_log',      sql: MIGRATION_005 },
      { id: 6, name: 'subclasses',        sql: MIGRATION_006 },
      { id: 7, name: 'encounter_map_loc_fields', sql: MIGRATION_007 },
    ]

    for (const m of migrations) {
      if (ran.has(m.id)) continue
      this.db.exec(m.sql)
      this.db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(m.id, m.name)
    }

    // Seed reference data — each method is idempotent (checks before inserting)
    this.seedSubclasses()
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params)
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(...params)
  }

  run(sql, params = []) {
    const stmt = this.db.prepare(sql)
    const result = stmt.run(...params)
    return { lastInsertRowid: result.lastInsertRowid, changes: result.changes }
  }

  transaction(fn) {
    return this.db.transaction(fn)()
  }

  // ── Seed helpers ────────────────────────────────────────────────────────────

  seedSubclasses() {
    const { n } = this.db.prepare('SELECT COUNT(*) as n FROM subclasses').get()
    if (n > 0) return  // Already seeded — idempotent

    const insert = this.db.prepare(`
      INSERT INTO subclasses (class_name, name, description, unlock_level, features, source)
      VALUES (?, ?, ?, ?, ?, 'srd')
    `)

    this.db.transaction(() => {
      for (const s of SUBCLASS_SEED_DATA) {
        insert.run(s.class_name, s.name, s.description, s.unlock_level, JSON.stringify(s.features))
      }
    })()
  }
}

const MIGRATION_001 = `
  CREATE TABLE IF NOT EXISTS campaigns (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    world_setting TEXT,
    session_count INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT (datetime('now')),
    updated_at    DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS locations (
    id                 INTEGER PRIMARY KEY,
    campaign_id        INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    type               TEXT CHECK(type IN ('town','dungeon','shop','region','landmark')),
    description        TEXT,
    lore               TEXT,
    parent_location_id INTEGER REFERENCES locations(id),
    created_at         DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS factions (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    alignment   TEXT,
    notes       TEXT,
    created_at  DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS npcs (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    race        TEXT,
    class       TEXT,
    role        TEXT,
    location_id INTEGER REFERENCES locations(id),
    faction_id  INTEGER REFERENCES factions(id),
    notes       TEXT,
    secrets     TEXT,
    motivation  TEXT,
    is_alive    BOOLEAN DEFAULT 1,
    created_at  DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS connections (
    id            INTEGER PRIMARY KEY,
    entity_a_type TEXT NOT NULL,
    entity_a_id   INTEGER NOT NULL,
    entity_b_type TEXT NOT NULL,
    entity_b_id   INTEGER NOT NULL,
    relationship  TEXT,
    notes         TEXT
  );

  CREATE TABLE IF NOT EXISTS characters (
    id             INTEGER PRIMARY KEY,
    campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    player_name    TEXT,
    character_name TEXT NOT NULL,
    class          TEXT,
    race           TEXT,
    level          INTEGER DEFAULT 1,
    stats          TEXT,
    hp_current     INTEGER,
    hp_max         INTEGER,
    inventory      TEXT,
    spell_slots    TEXT,
    notes          TEXT,
    created_at     DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS encounters (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT,
    location_id INTEGER REFERENCES locations(id),
    monsters    TEXT,
    status      TEXT DEFAULT 'planned' CHECK(status IN ('planned','active','completed')),
    xp_total    INTEGER,
    notes       TEXT,
    created_at  DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS maps (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT,
    location_id INTEGER REFERENCES locations(id),
    image_path  TEXT,
    grid_size   INTEGER DEFAULT 50,
    fog_data    TEXT,
    tokens      TEXT,
    created_at  DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS compendium_custom (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    type        TEXT CHECK(type IN ('item','spell','equipment','monster')),
    name        TEXT NOT NULL,
    data        TEXT,
    source      TEXT DEFAULT 'custom' CHECK(source IN ('custom','srd','pdf_upload')),
    created_at  DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS srd_cache (
    id            INTEGER PRIMARY KEY,
    resource_type TEXT NOT NULL,
    slug          TEXT NOT NULL,
    data          TEXT NOT NULL,
    cached_at     DATETIME DEFAULT (datetime('now')),
    UNIQUE(resource_type, slug)
  );

  CREATE TABLE IF NOT EXISTS pdf_sources (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    filename    TEXT,
    file_path   TEXT,
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','indexed','failed')),
    chunk_count INTEGER,
    indexed_at  DATETIME
  );

  CREATE TABLE IF NOT EXISTS mind_map_positions (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    x_pos       REAL,
    y_pos       REAL
  );
`

// Migration 002 — add campaign_id to connections; expand compendium_custom type check to include 'lore'
const MIGRATION_002 = `
  ALTER TABLE connections ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id);

  CREATE TABLE IF NOT EXISTS compendium_custom_new (
    id          INTEGER PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    type        TEXT CHECK(type IN ('item','spell','equipment','monster','lore')),
    name        TEXT NOT NULL,
    data        TEXT,
    source      TEXT DEFAULT 'custom' CHECK(source IN ('custom','srd','pdf_upload')),
    created_at  DATETIME DEFAULT (datetime('now'))
  );

  INSERT INTO compendium_custom_new SELECT * FROM compendium_custom;
  DROP TABLE compendium_custom;
  ALTER TABLE compendium_custom_new RENAME TO compendium_custom;
`

// Migration 003 — PDF chunks table for RAG pipeline
const MIGRATION_003 = `
  CREATE TABLE IF NOT EXISTS pdf_chunks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id    INTEGER NOT NULL REFERENCES pdf_sources(id) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL,
    page_number  INTEGER,
    text         TEXT NOT NULL
  )
`

// Migration 004 — Embedding tracking columns on pdf_chunks
const MIGRATION_004 = `
  ALTER TABLE pdf_chunks ADD COLUMN embedded       INTEGER DEFAULT 0;
  ALTER TABLE pdf_chunks ADD COLUMN embedding_model TEXT;
`

// Migration 005 — AI usage log for stats and auditing
const MIGRATION_005 = `
  CREATE TABLE IF NOT EXISTS ai_usage_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id  INTEGER REFERENCES campaigns(id),
    mode         TEXT,
    type         TEXT,
    prompt_len   INTEGER,
    response_len INTEGER,
    duration_ms  INTEGER,
    created_at   DATETIME DEFAULT (datetime('now'))
  )
`

// Migration 007 — Add map_id to encounters; add has_own_map + floor_number to locations
const MIGRATION_007 = `
  ALTER TABLE encounters  ADD COLUMN map_id      INTEGER REFERENCES maps(id);
  ALTER TABLE locations   ADD COLUMN has_own_map INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE locations   ADD COLUMN floor_number INTEGER;
`

// Migration 006 — Subclasses catalog table; subclass_name column on characters
// ALTER TABLE runs exactly once (tracked by _migrations); IF NOT EXISTS guards the table.
const MIGRATION_006 = `
  CREATE TABLE IF NOT EXISTS subclasses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    class_name   TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    unlock_level INTEGER NOT NULL DEFAULT 3,
    features     TEXT NOT NULL DEFAULT '[]',
    source       TEXT DEFAULT 'srd'
  );

  ALTER TABLE characters ADD COLUMN subclass_name TEXT;
`

// ── SRD Subclass Seed Data — 27 subclasses (2–3 per class × 12 classes) ────────
const SUBCLASS_SEED_DATA = [

  // ── Fighter ─────────────────────────────────────────────────────────────────
  {
    class_name: 'Fighter', name: 'Champion', unlock_level: 3,
    description: 'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection. Those who model themselves on this archetype combine rigorous training with physical excellence to deal devastating blows.',
    features: [
      { name: 'Improved Critical',         level_gained: 3,  description: 'Your weapon attacks score a critical hit on a roll of 19 or 20.' },
      { name: 'Remarkable Athlete',         level_gained: 7,  description: "You can add half your proficiency bonus (rounded up) to any Strength, Dexterity, or Constitution check that doesn't already use your proficiency bonus. When you make a running long jump, the distance increases by a number of feet equal to your Strength modifier." },
      { name: 'Additional Fighting Style',  level_gained: 10, description: 'You can choose a second option from the Fighting Style class feature.' },
      { name: 'Superior Critical',          level_gained: 15, description: 'Your weapon attacks score a critical hit on a roll of 18–20.' },
      { name: 'Survivor',                   level_gained: 18, description: "At the start of each of your turns, you regain hit points equal to 5 + your Constitution modifier if you have no more than half of your hit points left. You don't gain this benefit if you have 0 hit points." },
    ],
  },
  {
    class_name: 'Fighter', name: 'Battle Master', unlock_level: 3,
    description: 'Those who emulate the archetypal Battle Master employ martial techniques passed down through generations. To a Battle Master, combat is an academic field, sometimes including subjects beyond the battlefield.',
    features: [
      { name: 'Combat Superiority',          level_gained: 3,  description: 'You learn maneuvers fueled by superiority dice (d8). You have four superiority dice, restored on a short or long rest. Save DC = 8 + proficiency bonus + STR or DEX modifier.' },
      { name: 'Student of War',              level_gained: 3,  description: "You gain proficiency with one type of artisan's tools of your choice." },
      { name: 'Know Your Enemy',             level_gained: 7,  description: 'If you spend at least 1 minute observing or interacting with another creature outside combat, you can learn certain information about its capabilities compared to your own.' },
      { name: 'Improved Combat Superiority', level_gained: 10, description: 'Your superiority dice turn into d10s. At 18th level, they turn into d12s.' },
      { name: 'Relentless',                  level_gained: 15, description: 'When you roll initiative and have no superiority dice remaining, you regain 1 superiority die.' },
    ],
  },
  {
    class_name: 'Fighter', name: 'Eldritch Knight', unlock_level: 3,
    description: 'The archetypal Eldritch Knight combines the martial mastery common to all fighters with a careful study of magic, learning techniques similar to those practiced by wizards.',
    features: [
      { name: 'Spellcasting',    level_gained: 3,  description: 'You augment your martial prowess with the ability to cast spells from the wizard list, focusing on abjuration and evocation.' },
      { name: 'Weapon Bond',     level_gained: 3,  description: "You learn a ritual that creates a magical bond with one weapon. You can't be disarmed of it unless incapacitated, and you can summon it as a bonus action." },
      { name: 'War Magic',       level_gained: 7,  description: 'When you use your action to cast a cantrip, you can make one weapon attack as a bonus action.' },
      { name: 'Eldritch Strike', level_gained: 10, description: 'When you hit a creature with a weapon attack, that creature has disadvantage on the next saving throw it makes against a spell you cast before the end of your next turn.' },
      { name: 'Arcane Charge',   level_gained: 15, description: 'When you use Action Surge, you can teleport up to 30 feet to an unoccupied space you can see, either before or after the additional action.' },
    ],
  },

  // ── Rogue ────────────────────────────────────────────────────────────────────
  {
    class_name: 'Rogue', name: 'Thief', unlock_level: 3,
    description: 'You hone your skills in the larcenous arts. Burglars, bandits, cutpurses, and other criminals typically follow this archetype, as do rogues who prefer to think of themselves as professional treasure seekers.',
    features: [
      { name: 'Fast Hands',         level_gained: 3,  description: 'You can use the bonus action granted by Cunning Action to make a Sleight of Hand check, use thieves\' tools, or take the Use an Object action.' },
      { name: 'Second-Story Work',  level_gained: 3,  description: 'Climbing no longer costs you extra movement. When you make a running jump, the distance you cover increases by a number of feet equal to your Dexterity modifier.' },
      { name: 'Supreme Sneak',      level_gained: 9,  description: 'You have advantage on a Dexterity (Stealth) check if you move no more than half your speed on the same turn.' },
      { name: 'Use Magic Device',   level_gained: 13, description: 'You ignore all class, race, and level requirements on the use of magic items.' },
      { name: "Thief's Reflexes",   level_gained: 17, description: 'You can take two turns during the first round of any combat — one at your normal initiative and one at your initiative minus 10.' },
    ],
  },
  {
    class_name: 'Rogue', name: 'Assassin', unlock_level: 3,
    description: 'You focus your training on the grim art of death. Hired killers, spies, bounty hunters, and even specially anointed priests trained to exterminate the enemies of their deity follow this archetype.',
    features: [
      { name: 'Bonus Proficiencies',    level_gained: 3,  description: "You gain proficiency with the disguise kit and the poisoner's kit." },
      { name: 'Assassinate',            level_gained: 3,  description: 'You have advantage on attack rolls against any creature that hasn\'t taken a turn in the combat yet. Any hit you score against a surprised creature is a critical hit.' },
      { name: 'Infiltration Expertise', level_gained: 9,  description: 'You can unfailingly create false identities for yourself. You must spend 7 days and 25 gp to establish the history, profession, and affiliations for an identity.' },
      { name: 'Impostor',               level_gained: 13, description: 'You gain the ability to unerringly mimic another person\'s speech, writing, and behavior after at least 3 hours of study.' },
      { name: 'Death Strike',           level_gained: 17, description: 'When you attack and hit a creature that is surprised, it must make a Constitution saving throw (DC 8 + DEX mod + proficiency bonus). On a failed save, double the damage.' },
    ],
  },
  {
    class_name: 'Rogue', name: 'Arcane Trickster', unlock_level: 3,
    description: 'Some rogues enhance their fine-honed skills of stealth and agility with magic, learning tricks of enchantment and illusion.',
    features: [
      { name: 'Spellcasting',          level_gained: 3,  description: 'You gain the ability to cast spells from the wizard list, focusing on enchantment and illusion spells.' },
      { name: 'Mage Hand Legerdemain', level_gained: 3,  description: 'Your mage hand can be made invisible and can pick locks, disarm traps, and pick pockets.' },
      { name: 'Magical Ambush',        level_gained: 9,  description: 'If you are hidden from a creature when you cast a spell on it, it has disadvantage on any saving throw against the spell this turn.' },
      { name: 'Versatile Trickster',   level_gained: 13, description: 'As a bonus action, designate a creature within 5 feet of your mage hand to gain advantage on attack rolls against that creature until the end of the turn.' },
      { name: 'Spell Thief',           level_gained: 17, description: 'Immediately after a creature casts a spell that targets you, you can use your reaction to force a saving throw. On a failed save, you negate the effect against you and steal knowledge of the spell.' },
    ],
  },

  // ── Wizard ───────────────────────────────────────────────────────────────────
  {
    class_name: 'Wizard', name: 'School of Evocation', unlock_level: 2,
    description: 'You focus your study on magic that creates powerful elemental effects — bitter cold, searing flame, rolling thunder, crackling lightning, and burning acid. Many evokers find employment in military forces as artillery.',
    features: [
      { name: 'Evocation Savant',    level_gained: 2,  description: 'The gold and time you must spend to copy an evocation spell into your spellbook is halved.' },
      { name: 'Sculpt Spells',       level_gained: 2,  description: 'When you cast an evocation spell that affects other creatures you can see, you can choose a number of them equal to 1 + the spell\'s level to automatically succeed on their saving throws and take no damage on a successful save.' },
      { name: 'Potent Cantrip',      level_gained: 6,  description: 'When a creature succeeds on a saving throw against your cantrip, it takes half the cantrip\'s damage but suffers no additional effect.' },
      { name: 'Empowered Evocation', level_gained: 10, description: 'You can add your Intelligence modifier to one damage roll of any wizard evocation spell you cast.' },
      { name: 'Overchannel',         level_gained: 14, description: 'When you cast a wizard spell of 5th level or lower that deals damage, you can deal maximum damage with that spell (once per turn; subsequent uses cause necrotic damage to you).' },
    ],
  },
  {
    class_name: 'Wizard', name: 'School of Necromancy', unlock_level: 2,
    description: 'The School of Necromancy explores the cosmic forces of life, death, and undeath. You focus your studies on spells that manipulate life force and raise the dead to do your bidding.',
    features: [
      { name: 'Necromancy Savant', level_gained: 2,  description: 'The gold and time you must spend to copy a necromancy spell into your spellbook is halved.' },
      { name: 'Grim Harvest',      level_gained: 2,  description: 'Once per turn when you kill one or more creatures with a spell of 1st level or higher, you regain hit points equal to twice the spell\'s level (three times if it\'s a necromancy spell).' },
      { name: 'Undead Thralls',    level_gained: 6,  description: 'You add animate dead to your spellbook. When you cast it, you can target one additional corpse. Undead you create gain bonus HP equal to your wizard level and add your proficiency bonus to their damage rolls.' },
      { name: 'Inured to Undeath', level_gained: 10, description: 'You have resistance to necrotic damage, and your hit point maximum can\'t be reduced.' },
      { name: 'Command Undead',    level_gained: 14, description: 'As an action, choose an undead within 60 feet. It must make a Charisma saving throw against your spell save DC or fall under your control for 24 hours.' },
    ],
  },
  {
    class_name: 'Wizard', name: 'School of Illusion', unlock_level: 2,
    description: 'You focus your studies on magic that dazzles the senses, befuddles the mind, and tricks even the wisest folk. Your illusions make the impossible seem real.',
    features: [
      { name: 'Illusion Savant',         level_gained: 2,  description: 'The gold and time you must spend to copy an illusion spell into your spellbook is halved.' },
      { name: 'Improved Minor Illusion', level_gained: 2,  description: 'You can cast minor illusion as a cantrip. When you cast it, you can create both a sound and an image with a single casting.' },
      { name: 'Malleable Illusions',     level_gained: 6,  description: 'When you cast an illusion spell that has a duration of 1 minute or longer, you can use your action to change the nature of that illusion.' },
      { name: 'Illusory Self',           level_gained: 10, description: 'When a creature makes an attack roll against you, you can use your reaction to interpose an illusory duplicate. The attack automatically misses, then the illusion dissipates.' },
      { name: 'Illusory Reality',        level_gained: 14, description: 'When you cast an illusion spell of 1st level or higher, you can choose one inanimate, nonmagical object that is part of the illusion and make that object real for 1 minute.' },
    ],
  },

  // ── Cleric ───────────────────────────────────────────────────────────────────
  {
    class_name: 'Cleric', name: 'Life Domain', unlock_level: 1,
    description: 'The Life domain focuses on the vibrant positive energy that sustains all life. Clerics who are drawn to this domain are especially skilled at channeling positive energy to mend wounds.',
    features: [
      { name: 'Bonus Proficiency', level_gained: 1,  description: 'You gain proficiency with heavy armor.' },
      { name: 'Disciple of Life',  level_gained: 1,  description: 'Whenever you use a spell of 1st level or higher to restore hit points, the creature regains additional hit points equal to 2 + the spell\'s level.' },
      { name: 'Preserve Life',     level_gained: 2,  description: 'As an action, you present your holy symbol and evoke healing energy that can restore hit points equal to five times your cleric level, distributed among creatures within 30 feet.' },
      { name: 'Blessed Healer',    level_gained: 6,  description: 'When you cast a spell of 1st level or higher that restores hit points to a creature other than you, you regain hit points equal to 2 + the spell\'s level.' },
      { name: 'Divine Strike',     level_gained: 8,  description: 'Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 radiant damage (2d8 at 14th level).' },
      { name: 'Supreme Healing',   level_gained: 17, description: 'When you would normally roll one or more dice to restore hit points with a spell, you instead use the highest number possible for each die.' },
    ],
  },
  {
    class_name: 'Cleric', name: 'War Domain', unlock_level: 1,
    description: 'War has many manifestations. Clerics who tap into the magic of the War domain excel in battle, inspiring warriors and dealing havoc among enemies.',
    features: [
      { name: 'Bonus Proficiencies', level_gained: 1,  description: 'You gain proficiency with martial weapons and heavy armor.' },
      { name: 'War Priest',          level_gained: 1,  description: 'When you use the Attack action, you can make one weapon attack as a bonus action a number of times per short or long rest equal to your Wisdom modifier (minimum once).' },
      { name: 'Guided Strike',       level_gained: 2,  description: 'You can use your Channel Divinity to gain a +10 bonus to an attack roll. You can choose to do so after seeing the roll but before the DM says whether it hits or misses.' },
      { name: "War God's Blessing",  level_gained: 6,  description: 'When a creature within 30 feet makes an attack roll, you can use your reaction to grant that creature a +10 bonus to the roll, using your Channel Divinity.' },
      { name: 'Divine Strike',       level_gained: 8,  description: 'Once on each of your turns when you hit with a weapon attack, you can cause the attack to deal an extra 1d8 damage of the same type dealt by the weapon (2d8 at 14th level).' },
      { name: 'Avatar of Battle',    level_gained: 17, description: 'You gain resistance to bludgeoning, piercing, and slashing damage from nonmagical weapons.' },
    ],
  },

  // ── Barbarian ────────────────────────────────────────────────────────────────
  {
    class_name: 'Barbarian', name: 'Path of the Berserker', unlock_level: 3,
    description: "For some barbarians, rage is a means to an end — that end being violence. The Path of the Berserker is a path of untrammeled fury, slick with blood.",
    features: [
      { name: 'Frenzy',                level_gained: 3,  description: 'You can go into a frenzy when you rage. For the duration, you can make a single melee weapon attack as a bonus action each turn. When your rage ends, you suffer one level of exhaustion.' },
      { name: 'Mindless Rage',         level_gained: 6,  description: "You can't be charmed or frightened while raging. If you are charmed or frightened when you enter your rage, the effect is suspended for the duration." },
      { name: 'Intimidating Presence', level_gained: 10, description: 'As an action, choose a creature within 30 feet. If it can see or hear you, it must succeed on a Wisdom saving throw or be frightened of you until the end of your next turn.' },
      { name: 'Retaliation',           level_gained: 14, description: 'When you take damage from a creature within 5 feet of you, you can use your reaction to make a melee weapon attack against that creature.' },
    ],
  },
  {
    class_name: 'Barbarian', name: 'Path of the Totem Warrior', unlock_level: 3,
    description: 'The Path of the Totem Warrior is a spiritual journey, as the barbarian accepts a spirit animal as guide, protector, and inspiration. Your totem spirit fills you with supernatural might during rage.',
    features: [
      { name: 'Spirit Seeker',       level_gained: 3,  description: 'You can cast beast sense and speak with animals as rituals.' },
      { name: 'Totem Spirit',        level_gained: 3,  description: 'Choose a totem spirit: Bear (resistance to all damage except psychic while raging), Eagle (enemies have disadvantage on opportunity attacks against you while raging), or Wolf (allies have advantage on melee attacks against enemies within 5 feet of you while raging).' },
      { name: 'Aspect of the Beast', level_gained: 6,  description: 'You gain a magical benefit from your totem: Bear (doubled carrying capacity and advantage on STR checks to push/pull/lift/break), Eagle (see up to 1 mile clearly), or Wolf (track creatures while traveling at fast pace).' },
      { name: 'Spirit Walker',       level_gained: 10, description: 'You can cast commune with nature as a ritual, guided by a spirit version of your totem animal.' },
      { name: 'Totemic Attunement',  level_gained: 14, description: 'Choose a totem attunement: Bear (enemies within 5 feet have disadvantage on attacks against others), Eagle (flying speed equal to walking speed while raging), or Wolf (bonus action to knock a Large or smaller creature prone when you hit it while raging).' },
    ],
  },

  // ── Paladin ──────────────────────────────────────────────────────────────────
  {
    class_name: 'Paladin', name: 'Oath of Devotion', unlock_level: 3,
    description: 'The Oath of Devotion binds a paladin to the loftiest ideals of justice, virtue, and order. Sometimes called cavaliers, white knights, or holy warriors, these paladins meet the ideal of the knight in shining armor.',
    features: [
      { name: 'Sacred Weapon',    level_gained: 3,  description: 'As an action, imbue one weapon with positive energy using Channel Divinity. For 1 minute, add your Charisma modifier (minimum +1) to attack rolls with that weapon.' },
      { name: 'Turn the Unholy',  level_gained: 3,  description: 'You can use Channel Divinity to cause fiends and undead within 30 feet that can hear you to make a Wisdom saving throw or be turned for 1 minute.' },
      { name: 'Aura of Devotion', level_gained: 7,  description: "You and friendly creatures within 10 feet of you can't be charmed while you are conscious (30 feet at 18th level)." },
      { name: 'Purity of Spirit', level_gained: 15, description: 'You are always under the effects of a protection from evil and good spell.' },
      { name: 'Holy Nimbus',      level_gained: 20, description: 'As an action, emanate an aura of sunlight for 1 minute. Bright light fills a 30-foot radius, dim light 30 feet beyond. Enemies in bright light have disadvantage on saving throws against spells dealing fire or radiant damage.' },
    ],
  },
  {
    class_name: 'Paladin', name: 'Oath of the Ancients', unlock_level: 3,
    description: "The Oath of the Ancients is as old as the race of elves and the rituals of the druids. Paladins who swear this oath share the fey creatures' ancient love of nature and all that is fair, joyful, and alive.",
    features: [
      { name: "Nature's Wrath",    level_gained: 3,  description: 'Use Channel Divinity to cause spectral vines to spring up and grasp a creature within 10 feet. It must succeed on a STR or DEX saving throw or be restrained.' },
      { name: 'Turn the Faithless', level_gained: 3,  description: 'You can use Channel Divinity to utter words that are painful for fey and fiends. Each fey or fiend within 30 feet that can hear you must make a Wisdom saving throw or be turned for 1 minute.' },
      { name: 'Aura of Warding',   level_gained: 7,  description: 'You and friendly creatures within 10 feet have resistance to damage from spells (30 feet at 18th level).' },
      { name: 'Undying Sentinel',  level_gained: 15, description: "When you are reduced to 0 hit points and not killed outright, you can choose to drop to 1 hit point instead (once per long rest). You also don't suffer the drawbacks of old age and can't be aged magically." },
      { name: 'Elder Champion',    level_gained: 20, description: 'As an action, assume the form of an ancient force of nature for 1 minute. You regain 10 hit points at the start of each turn, cast spells needing 10 minutes in 1 action, and emanate a 10-foot aura compelling enemies to make saves against your paladin spells at disadvantage.' },
    ],
  },

  // ── Ranger ───────────────────────────────────────────────────────────────────
  {
    class_name: 'Ranger', name: 'Hunter', unlock_level: 3,
    description: "Emulating the Hunter archetype means accepting your place as a bulwark between civilization and the terrors of the wilderness. As you walk the Hunter's path, you learn specialized techniques for fighting the threats you face.",
    features: [
      { name: "Hunter's Prey",             level_gained: 3,  description: "Choose one: Colossus Slayer (extra 1d8 damage once per turn against a damaged foe), Giant Killer (reaction attack when Large+ creature misses you), or Horde Breaker (attack a second adjacent creature once per turn)." },
      { name: 'Defensive Tactics',         level_gained: 7,  description: 'Choose one: Escape the Horde (opportunity attacks against you have disadvantage), Multiattack Defense (+4 AC against subsequent attacks from same creature), or Steel Will (advantage on saves against frightened).' },
      { name: 'Multiattack',               level_gained: 11, description: 'Choose one: Volley (ranged attack against every creature in a 10-foot-radius cylinder), or Whirlwind Attack (melee attack against all creatures within 5 feet).' },
      { name: "Superior Hunter's Defense", level_gained: 15, description: 'Choose one: Evasion (no damage on successful DEX saves), Stand Against the Tide (redirect missed attacks to adjacent creatures), or Uncanny Dodge (use reaction to halve damage).' },
    ],
  },
  {
    class_name: 'Ranger', name: 'Beast Master', unlock_level: 3,
    description: 'The archetypal Beast Master forms a deep bond with a beast companion that fights alongside them. The ranger and companion complement each other perfectly.',
    features: [
      { name: "Ranger's Companion", level_gained: 3,  description: 'You gain a beast companion (Medium or smaller, CR 1/4 or lower). Add your proficiency bonus to its AC, attack rolls, damage rolls, and any saving throws and skills it is proficient in.' },
      { name: 'Exceptional Training', level_gained: 7,  description: 'On any turn the beast does not attack, you can use a bonus action to command it to Dash, Disengage, Dodge, or Help.' },
      { name: 'Bestial Fury',        level_gained: 11, description: 'Your companion can make two attacks when you command it to use the Attack action.' },
      { name: 'Share Spells',        level_gained: 15, description: 'When you cast a spell targeting yourself, you can also affect your beast companion if it is within 30 feet of you.' },
    ],
  },

  // ── Druid ────────────────────────────────────────────────────────────────────
  {
    class_name: 'Druid', name: 'Circle of the Land', unlock_level: 2,
    description: 'The Circle of the Land is made up of mystics and sages who safeguard ancient knowledge and rites through a vast oral tradition.',
    features: [
      { name: 'Bonus Cantrip',       level_gained: 2,  description: 'You learn one additional druid cantrip of your choice.' },
      { name: 'Natural Recovery',    level_gained: 2,  description: 'During a short rest, you can recover expended spell slots with a combined level up to half your druid level (rounded up). None of the slots can be 6th level or higher.' },
      { name: 'Circle Spells',       level_gained: 3,  description: 'Your mystical connection to the land grants access to spells based on your chosen terrain (Arctic, Coast, Desert, Forest, Grassland, Mountain, Swamp, or Underdark) at 3rd, 5th, 7th, and 9th level.' },
      { name: "Land's Stride",       level_gained: 6,  description: 'Moving through nonmagical difficult terrain costs you no extra movement. You can also pass through nonmagical plants without being slowed or damaged.' },
      { name: "Nature's Ward",       level_gained: 10, description: "You can't be charmed or frightened by elementals or fey, and you are immune to poison and disease." },
      { name: "Nature's Sanctuary",  level_gained: 14, description: 'When a beast or plant creature attacks you, it must make a Wisdom saving throw against your spell save DC or be forced to choose a different target.' },
    ],
  },
  {
    class_name: 'Druid', name: 'Circle of the Moon', unlock_level: 2,
    description: 'Druids of the Circle of the Moon are fierce guardians of the wilds who often assume animal forms at the first sign of danger.',
    features: [
      { name: 'Combat Wild Shape',    level_gained: 2,  description: 'You can use Wild Shape as a bonus action. While transformed, you can expend a spell slot (bonus action) to regain 1d8 hit points per level of the slot.' },
      { name: 'Circle Forms',         level_gained: 2,  description: 'You can transform into beasts with higher CR: CR 1 at 2nd level, CR 2 at 6th, CR 3 at 9th, CR 4 at 12th, CR 5 at 15th, CR 6 at 18th.' },
      { name: 'Primal Strike',        level_gained: 6,  description: 'Your attacks in beast form count as magical for the purpose of overcoming resistance and immunity to nonmagical attacks.' },
      { name: 'Elemental Wild Shape', level_gained: 10, description: 'You can expend two uses of Wild Shape to transform into an air elemental, earth elemental, fire elemental, or water elemental.' },
      { name: 'Thousand Forms',       level_gained: 14, description: 'You can cast alter self at will.' },
    ],
  },

  // ── Bard ─────────────────────────────────────────────────────────────────────
  {
    class_name: 'Bard', name: 'College of Lore', unlock_level: 3,
    description: 'Bards of the College of Lore know something about most things, collecting bits of knowledge from sources as diverse as scholarly tomes and peasant tales.',
    features: [
      { name: 'Bonus Proficiencies',        level_gained: 3,  description: 'You gain proficiency with three skills of your choice.' },
      { name: 'Cutting Words',              level_gained: 3,  description: 'When a creature you can see within 60 feet makes an attack roll, ability check, or damage roll, you can use your reaction to expend a Bardic Inspiration die and subtract the number from the roll.' },
      { name: 'Additional Magical Secrets', level_gained: 6,  description: 'You learn two spells of your choice from any class. They count as bard spells for you but don\'t count against the number of bard spells you know.' },
      { name: 'Peerless Skill',             level_gained: 14, description: 'When you make an ability check, you can expend a Bardic Inspiration die and add the number rolled to your ability check (after rolling, before the DM tells you the result).' },
    ],
  },
  {
    class_name: 'Bard', name: 'College of Valor', unlock_level: 3,
    description: 'Bards of the College of Valor are daring skalds whose tales keep alive the memory of great heroes and inspire a new generation.',
    features: [
      { name: 'Bonus Proficiencies', level_gained: 3,  description: 'You gain proficiency with medium armor, shields, and martial weapons.' },
      { name: 'Combat Inspiration',  level_gained: 3,  description: 'A creature with a Bardic Inspiration die from you can roll it and add the number to a weapon damage roll, or use it as a reaction to add to its AC against one attack.' },
      { name: 'Extra Attack',        level_gained: 6,  description: 'You can attack twice, instead of once, whenever you take the Attack action on your turn.' },
      { name: 'Battle Magic',        level_gained: 14, description: 'When you use your action to cast a bard spell, you can make one weapon attack as a bonus action.' },
    ],
  },

  // ── Monk ─────────────────────────────────────────────────────────────────────
  {
    class_name: 'Monk', name: 'Way of the Open Hand', unlock_level: 3,
    description: 'Monks of the Way of the Open Hand are the ultimate masters of martial arts combat, learning techniques to push and trip opponents, manipulate ki to heal, and practice advanced meditation.',
    features: [
      { name: 'Open Hand Technique', level_gained: 3,  description: 'Whenever you hit with Flurry of Blows, you can impose one of three effects: knock the target prone, push it 15 feet away, or prevent it from taking reactions until the end of your next turn.' },
      { name: 'Wholeness of Body',   level_gained: 6,  description: 'As an action, you can regain hit points equal to three times your monk level. You must finish a long rest before using this feature again.' },
      { name: 'Tranquility',         level_gained: 11, description: 'At the end of a long rest, you gain the effect of a sanctuary spell (DC = 8 + WIS mod + proficiency bonus) lasting until the start of your next long rest.' },
      { name: 'Quivering Palm',      level_gained: 17, description: 'When you hit with an unarmed strike, you can spend 3 ki points to start lethal vibrations. As an action, you can end them: the creature makes a CON save or drops to 0 hit points.' },
    ],
  },
  {
    class_name: 'Monk', name: 'Way of Shadow', unlock_level: 3,
    description: 'Monks of the Way of Shadow follow a tradition that values stealth and subterfuge. These monks might be called ninjas or shadowdancers.',
    features: [
      { name: 'Shadow Arts',      level_gained: 3,  description: 'Spend 2 ki points to cast darkness, darkvision, pass without trace, or silence (no material components). You also know the minor illusion cantrip.' },
      { name: 'Shadow Step',      level_gained: 6,  description: 'When you are in dim light or darkness, you can teleport up to 60 feet as a bonus action to another such space. You then have advantage on your first melee attack before the end of the turn.' },
      { name: 'Cloak of Shadows', level_gained: 11, description: 'When in dim light or darkness, you can use your action to become invisible. You remain invisible until you attack, cast a spell, or are in bright light.' },
      { name: 'Opportunist',      level_gained: 17, description: 'When a creature within 5 feet is hit by an attack from a creature other than you, you can use your reaction to make a melee attack against that creature.' },
    ],
  },

  // ── Sorcerer ─────────────────────────────────────────────────────────────────
  {
    class_name: 'Sorcerer', name: 'Draconic Bloodline', unlock_level: 1,
    description: 'Your innate magic comes from draconic magic that was mingled with your blood or that of your ancestors, perhaps from a mighty sorcerer who made a bargain with a dragon.',
    features: [
      { name: 'Dragon Ancestor',     level_gained: 1,  description: 'Choose a dragon type. Your breath weapon and damage resistance are determined by it. You can also speak, read, and write Draconic.' },
      { name: 'Draconic Resilience', level_gained: 1,  description: 'Your hit point maximum increases by 1 per sorcerer level. When not wearing armor, your AC equals 13 + your Dexterity modifier.' },
      { name: 'Elemental Affinity',  level_gained: 6,  description: "When you cast a spell dealing damage of your draconic ancestry type, add your CHA modifier to one damage roll. You can spend 1 sorcery point to gain resistance to that damage type for 1 hour." },
      { name: 'Dragon Wings',        level_gained: 14, description: 'As a bonus action, sprout a pair of dragon wings, gaining a flying speed equal to your current speed. They last until you dismiss them as a bonus action.' },
      { name: 'Draconic Presence',   level_gained: 18, description: 'As an action, spend 5 sorcery points to emanate an aura (60-foot radius) of awe or fear for 1 minute. Creatures in the aura must make a Wisdom saving throw or be charmed or frightened.' },
    ],
  },
  {
    class_name: 'Sorcerer', name: 'Wild Magic', unlock_level: 1,
    description: 'Your innate magic comes from the wild forces of chaos that underlie the order of creation, perhaps from exposure to raw magic through a planar portal or the mysterious Far Realm.',
    features: [
      { name: 'Wild Magic Surge',  level_gained: 1,  description: 'Immediately after casting a sorcerer spell of 1st level or higher, the DM can have you roll a d20. On a 1, roll on the Wild Magic Surge table for a random magical effect.' },
      { name: 'Tides of Chaos',    level_gained: 1,  description: 'You can gain advantage on one attack roll, ability check, or saving throw (once per long rest). The DM can then cause a Wild Magic Surge before you regain the use of this feature.' },
      { name: 'Bend Luck',         level_gained: 6,  description: "When another creature you can see makes an attack roll, ability check, or saving throw, you can use your reaction and spend 2 sorcery points to roll 1d4 and apply it as a bonus or penalty to the creature's roll." },
      { name: 'Controlled Chaos',  level_gained: 14, description: 'Whenever you roll on the Wild Magic Surge table, you can roll twice and use either number.' },
      { name: 'Spell Bombardment', level_gained: 18, description: 'When you roll damage for a spell and roll the highest number possible on any of the dice, choose one of those dice, roll it again, and add the roll to the damage (once per turn).' },
    ],
  },

  // ── Warlock ──────────────────────────────────────────────────────────────────
  {
    class_name: 'Warlock', name: 'The Fiend', unlock_level: 1,
    description: 'You have made a pact with a fiend from the lower planes whose aims are evil, even if you strive against those aims. Such beings desire the corruption or destruction of all things, ultimately including you.',
    features: [
      { name: "Dark One's Blessing",  level_gained: 1,  description: 'When you reduce a hostile creature to 0 hit points, you gain temporary hit points equal to your Charisma modifier + your warlock level (minimum 1).' },
      { name: "Dark One's Own Luck",  level_gained: 6,  description: 'When you make an ability check or saving throw, you can add a d10 to your roll (after seeing the initial roll, before effects occur). Once used, requires a short or long rest to recharge.' },
      { name: 'Fiendish Resilience',  level_gained: 10, description: 'Choose one damage type when you finish a short or long rest. You gain resistance to that damage type until you choose a different one. Magical weapon and silver weapon damage ignores this resistance.' },
      { name: 'Hurl Through Hell',    level_gained: 14, description: "When you hit a creature with an attack, you can transport it through the lower planes. At the end of your next turn, it returns. If it is not a fiend, it takes 10d10 psychic damage. Once used, requires a long rest to recharge." },
    ],
  },
  {
    class_name: 'Warlock', name: 'The Archfey', unlock_level: 1,
    description: "Your patron is a lord or lady of the fey whose motivations are often inscrutable and sometimes whimsical, involving the acquisition of knowledge, the sowing of strife among powerful courts, or a magnificent treasure.",
    features: [
      { name: 'Fey Presence',       level_gained: 1,  description: 'As an action, cause each creature in a 10-foot cube originating from you to make a Wisdom saving throw or be charmed or frightened (your choice) until the end of your next turn.' },
      { name: 'Misty Escape',       level_gained: 6,  description: 'When you take damage, you can use your reaction to turn invisible and teleport up to 60 feet to an unoccupied space you can see. Invisibility lasts until the start of your next turn or until you attack or cast a spell.' },
      { name: 'Beguiling Defenses', level_gained: 10, description: "You are immune to being charmed. When another creature attempts to charm you, you can use your reaction to attempt to turn the charm back on that creature." },
      { name: 'Dark Delirium',      level_gained: 14, description: 'As an action, plunge a creature within 60 feet into an illusory realm. It must make a Wisdom saving throw or be charmed or frightened (your choice) for 1 minute or until your concentration breaks.' },
    ],
  },
]

module.exports = DatabaseService
