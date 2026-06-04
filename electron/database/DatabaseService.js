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
    ]

    for (const m of migrations) {
      if (ran.has(m.id)) continue
      this.db.exec(m.sql)
      this.db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(m.id, m.name)
    }
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

module.exports = DatabaseService
