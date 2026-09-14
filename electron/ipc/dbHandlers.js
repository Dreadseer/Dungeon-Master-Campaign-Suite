const { app } = require('electron')
const { registerHandler } = require('./registerHandler')
const fs   = require('fs')
const path = require('path')

// Entity types that can appear in `connections` (either side) and in
// `mind_map_positions`. Both tables store a polymorphic reference — the row
// names its own target table in entity_a_type / entity_type — which SQLite
// cannot express as a foreign key, so migration 009 leaves them unconstrained
// and the cleanup happens here instead.
const POLYMORPHIC_TYPES = ['npc', 'location', 'faction', 'lore']

// Delete an entity and everything that points at it polymorphically, atomically.
// Without this, deleting an NPC left its connection rows behind pointing at an
// id that no longer exists; the Connections page then rendered them as
// "Unknown", and the Mind Map kept a position row for a node it could not draw.
//
// Phase 4.5 adds `reveals` to the same sweep. Phase 4 introduced it with the
// same polymorphic shape and the same problem: deleting a revealed NPC left a
// reveals row pointing at a dead id, which the player's "What you know" view
// then silently skipped — invisible rather than wrong, but still an orphan, and
// worse, a NEW entity could later be given that id and inherit the reveal.
function deleteWithPolymorphicRefs(db, table, entityType, id) {
  if (!POLYMORPHIC_TYPES.includes(entityType)) {
    throw new Error(`Unknown polymorphic entity type: ${entityType}`)
  }
  return db.transaction(() => {
    db.run(
      `DELETE FROM connections
       WHERE (entity_a_type = ? AND entity_a_id = ?)
          OR (entity_b_type = ? AND entity_b_id = ?)`,
      [entityType, id, entityType, id]
    )
    db.run(
      'DELETE FROM mind_map_positions WHERE entity_type = ? AND entity_id = ?',
      [entityType, id]
    )
    db.run(
      'DELETE FROM reveals WHERE entity_type = ? AND entity_id = ?',
      [entityType, id]
    )
    return db.run(`DELETE FROM ${table} WHERE id = ?`, [id])
  })
}

function registerDbHandlers(db) {
  // Campaigns
  registerHandler('db:campaigns:getAll',  () =>
    db.all('SELECT * FROM campaigns ORDER BY updated_at DESC'))

  registerHandler('db:campaigns:getById', (_, id) =>
    db.get('SELECT * FROM campaigns WHERE id = ?', [id]))

  registerHandler('db:campaigns:create',  (_, data) =>
    db.run(
      `INSERT INTO campaigns (name, description, world_setting, created_at, updated_at, session_count)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), 0)`,
      [data.name, data.description, data.world_setting]
    ))

  registerHandler('db:campaigns:update',  (_, id, data) =>
    db.run(
      `UPDATE campaigns SET name = ?, description = ?, world_setting = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [data.name, data.description, data.world_setting, id]
    ))

  registerHandler('db:campaigns:delete',  (_, id) =>
    db.run('DELETE FROM campaigns WHERE id = ?', [id]))

  // NPCs — Phase 2: JOIN queries, getById, getByLocation, getByFaction, toggleAlive
  registerHandler('db:npcs:getAll', (_, campaignId) =>
    db.all(`
      SELECT n.*,
             l.name AS location_name,
             f.name AS faction_name
      FROM npcs n
      LEFT JOIN locations l ON n.location_id = l.id
      LEFT JOIN factions  f ON n.faction_id  = f.id
      WHERE n.campaign_id = ?
      ORDER BY n.name ASC
    `, [campaignId]))

  registerHandler('db:npcs:getById', (_, id) =>
    db.get(`
      SELECT n.*,
             l.name AS location_name,
             f.name AS faction_name
      FROM npcs n
      LEFT JOIN locations l ON n.location_id = l.id
      LEFT JOIN factions  f ON n.faction_id  = f.id
      WHERE n.id = ?
    `, [id]))

  registerHandler('db:npcs:getByLocation', (_, locationId) =>
    db.all('SELECT * FROM npcs WHERE location_id = ? ORDER BY name ASC', [locationId]))

  registerHandler('db:npcs:getByFaction', (_, factionId) =>
    db.all('SELECT * FROM npcs WHERE faction_id = ? ORDER BY name ASC', [factionId]))

  registerHandler('db:npcs:create', (_, data) =>
    db.run(`
      INSERT INTO npcs
        (campaign_id, name, race, class, role, location_id, faction_id,
         notes, secrets, motivation, is_alive, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,datetime('now'))
    `, [data.campaign_id, data.name, data.race, data.class, data.role,
        data.location_id ?? null, data.faction_id ?? null,
        data.notes, data.secrets, data.motivation]))

  registerHandler('db:npcs:update', (_, id, data) =>
    db.run(`
      UPDATE npcs
      SET name=?, race=?, class=?, role=?, location_id=?, faction_id=?,
          notes=?, secrets=?, motivation=?, is_alive=?
      WHERE id=?
    `, [data.name, data.race, data.class, data.role,
        data.location_id ?? null, data.faction_id ?? null,
        data.notes, data.secrets, data.motivation, data.is_alive, id]))

  registerHandler('db:npcs:toggleAlive', (_, id, isAlive) =>
    db.run('UPDATE npcs SET is_alive = ? WHERE id = ?', [isAlive ? 1 : 0, id]))

  // Also clears the NPC's connections (either side) and mind-map position.
  registerHandler('db:npcs:delete', (_, id) =>
    deleteWithPolymorphicRefs(db, 'npcs', 'npc', id))

  // Locations — Phase 2: upgraded getAll with parent join, parent_location_id in update,
  //             new getById and getByType channels
  registerHandler('db:locations:getAll', (_, campaignId) =>
    db.all(`
      SELECT l.*, p.name AS parent_name
      FROM locations l
      LEFT JOIN locations p ON l.parent_location_id = p.id
      WHERE l.campaign_id = ?
      ORDER BY l.name ASC
    `, [campaignId]))

  registerHandler('db:locations:getById', (_, id) =>
    db.get('SELECT * FROM locations WHERE id = ?', [id]))

  registerHandler('db:locations:getByType', (_, campaignId, type) =>
    db.all('SELECT * FROM locations WHERE campaign_id = ? AND type = ? ORDER BY name ASC', [campaignId, type]))

  registerHandler('db:locations:create', (_, data) =>
    db.run(
      `INSERT INTO locations (campaign_id, name, type, description, lore, parent_location_id, has_own_map, floor_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [data.campaign_id, data.name, data.type, data.description, data.lore,
       data.parent_location_id ?? null, data.has_own_map ? 1 : 0, data.floor_number ?? null]
    ))

  registerHandler('db:locations:update', (_, id, data) =>
    db.run(
      'UPDATE locations SET name = ?, type = ?, description = ?, lore = ?, parent_location_id = ?, has_own_map = ?, floor_number = ? WHERE id = ?',
      [data.name, data.type, data.description, data.lore, data.parent_location_id ?? null,
       data.has_own_map ? 1 : 0, data.floor_number ?? null, id]
    ))

  // Also clears the location's connections and mind-map position. NPCs, maps
  // and encounters that referenced it survive with location_id NULL (migration 009).
  registerHandler('db:locations:delete', (_, id) =>
    deleteWithPolymorphicRefs(db, 'locations', 'location', id))

  // Factions — Phase 2: all new
  registerHandler('db:factions:getAll', (_, campaignId) =>
    db.all('SELECT * FROM factions WHERE campaign_id = ? ORDER BY name ASC', [campaignId]))

  registerHandler('db:factions:getById', (_, id) =>
    db.get('SELECT * FROM factions WHERE id = ?', [id]))

  registerHandler('db:factions:create', (_, data) =>
    db.run(
      `INSERT INTO factions (campaign_id, name, description, alignment, notes, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [data.campaign_id, data.name, data.description, data.alignment, data.notes]
    ))

  registerHandler('db:factions:update', (_, id, data) =>
    db.run(
      'UPDATE factions SET name = ?, description = ?, alignment = ?, notes = ? WHERE id = ?',
      [data.name, data.description, data.alignment, data.notes, id]
    ))

  // Also clears the faction's connections and mind-map position. Member NPCs
  // survive with faction_id NULL (migration 009).
  registerHandler('db:factions:delete', (_, id) =>
    deleteWithPolymorphicRefs(db, 'factions', 'faction', id))

  // Connections — Phase 2 Prompt 03 (replaces Phase 1 stub)
  registerHandler('db:connections:getAll', (_, campaignId) =>
    db.all(`
      SELECT c.*
      FROM connections c
      WHERE c.campaign_id = ?
      ORDER BY c.relationship ASC
    `, [campaignId]))

  registerHandler('db:connections:getForEntity', (_, entityType, entityId) =>
    db.all(`
      SELECT * FROM connections
      WHERE (entity_a_type = ? AND entity_a_id = ?)
         OR (entity_b_type = ? AND entity_b_id = ?)`,
      [entityType, entityId, entityType, entityId]))

  // ── Batched world save (Phase 6.1 task 16) ───────────────────────────────
  //
  // "Save all" on the AI suggestion cards used to run one create per card and
  // then one insert per connection, each its own statement. A failure partway
  // through — a CHECK-violating location type, a missing column — left the
  // campaign holding half a guild, with no way to tell which half.
  //
  // One transaction: everything lands or nothing does. The ids come back so the
  // renderer can offer an Undo that deletes exactly what this call wrote.
  const WORLD_INSERTS = {
    npc: (d) => db.run(
      `INSERT INTO npcs (campaign_id, name, race, class, role, location_id, faction_id,
         notes, secrets, motivation, is_alive, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`,
      [d.campaign_id, d.name, d.race, d.class, d.role, d.location_id ?? null,
       d.faction_id ?? null, d.notes, d.secrets, d.motivation]),

    location: (d) => db.run(
      `INSERT INTO locations (campaign_id, name, type, description, lore,
         parent_location_id, created_at)
       VALUES (?,?,?,?,?,?,datetime('now'))`,
      [d.campaign_id, d.name, d.type, d.description, d.lore, d.parent_location_id ?? null]),

    faction: (d) => db.run(
      `INSERT INTO factions (campaign_id, name, description, alignment, notes, created_at)
       VALUES (?,?,?,?,?,datetime('now'))`,
      [d.campaign_id, d.name, d.description, d.alignment, d.notes]),

    lore: (d) => db.run(
      `INSERT INTO compendium_custom (campaign_id, type, name, data, source, created_at)
       VALUES (?,'lore',?,?,'custom',datetime('now'))`,
      [d.campaign_id, d.name,
       JSON.stringify({ content: d.content, category: d.category, is_secret: d.is_secret ?? false })]),
  }

  const WORLD_DELETES = {
    npc:      (id) => db.run('DELETE FROM npcs WHERE id = ?', [id]),
    location: (id) => db.run('DELETE FROM locations WHERE id = ?', [id]),
    faction:  (id) => db.run('DELETE FROM factions WHERE id = ?', [id]),
    lore:     (id) => db.run(`DELETE FROM compendium_custom WHERE id = ? AND type = 'lore'`, [id]),
  }

  /**
   * @param records     [{ kind, payload }]
   * @param connections [{ fromIndex, toKind, toId, toIndex, relationship }]
   *                    fromIndex/toIndex point into `records`; toKind/toId name
   *                    an entity that already existed.
   */
  registerHandler('db:world:saveBatch', (_, { records = [], connections = [] } = {}) =>
    db.transaction(() => {
      const saved = []

      for (const { kind, payload } of records) {
        const insert = WORLD_INSERTS[kind]
        if (!insert) throw new Error(`Unknown record kind "${kind}"`)
        const { lastInsertRowid } = insert(payload)
        saved.push({ kind, id: Number(lastInsertRowid), name: payload.name })
      }

      const written = []
      for (const link of connections) {
        // Resolve now that every record has an id.
        const from = saved[link.fromIndex]
        if (!from) continue
        const to = link.toIndex != null ? saved[link.toIndex] : { kind: link.toKind, id: link.toId }
        if (!to || to.id == null) continue

        const { lastInsertRowid } = db.run(
          `INSERT INTO connections
             (campaign_id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes)
           VALUES (?,?,?,?,?,?,?)`,
          [link.campaign_id, from.kind, from.id, to.kind, to.id, link.relationship ?? 'related to', ''])
        written.push(Number(lastInsertRowid))
      }

      return { records: saved, connectionIds: written }
    }))

  /** Undo exactly what one saveBatch wrote (task 16). */
  registerHandler('db:world:undoBatch', (_, { records = [], connectionIds = [] } = {}) =>
    db.transaction(() => {
      // Connections first: deleting an entity while a row still points at it is
      // the failure mode this ordering avoids.
      for (const id of connectionIds) db.run('DELETE FROM connections WHERE id = ?', [id])
      let removed = 0
      for (const r of records) {
        const del = WORLD_DELETES[r.kind]
        if (!del) continue
        removed += del(r.id).changes ?? 0
      }
      return { removed, connections: connectionIds.length }
    }))

  registerHandler('db:connections:create', (_, data) =>
    db.run(`
      INSERT INTO connections
        (campaign_id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes)
      VALUES (?,?,?,?,?,?,?)`,
      [data.campaign_id, data.entity_a_type, data.entity_a_id,
       data.entity_b_type, data.entity_b_id, data.relationship, data.notes]))

  registerHandler('db:connections:update', (_, id, data) =>
    db.run(`
      UPDATE connections SET relationship=?, notes=? WHERE id=?`,
      [data.relationship, data.notes, id]))

  registerHandler('db:connections:delete', (_, id) =>
    db.run('DELETE FROM connections WHERE id=?', [id]))

  // Lore entries (stored in compendium_custom with type='lore')
  registerHandler('db:lore:getAll', (_, campaignId) =>
    db.all(`
      SELECT * FROM compendium_custom
      WHERE campaign_id = ? AND type = 'lore'
      ORDER BY name ASC`,
      [campaignId]))

  registerHandler('db:lore:getById', (_, id) =>
    db.get('SELECT * FROM compendium_custom WHERE id = ?', [id]))

  registerHandler('db:lore:create', (_, data) =>
    db.run(`
      INSERT INTO compendium_custom
        (campaign_id, type, name, data, source, created_at)
      VALUES (?, 'lore', ?, ?, 'custom', datetime('now'))`,
      [data.campaign_id, data.name,
       JSON.stringify({ content: data.content, category: data.category, is_secret: data.is_secret ?? false })]))

  registerHandler('db:lore:update', (_, id, data) =>
    db.run(`
      UPDATE compendium_custom
      SET name=?, data=? WHERE id=?`,
      [data.name,
       JSON.stringify({ content: data.content, category: data.category, is_secret: data.is_secret ?? false }),
       id]))

  // Lore is not yet selectable in the Connections UI (Phase 4), but world:search
  // already emits 'lore' as an entity_type and the mind map can position one, so
  // the same cleanup applies.
  registerHandler('db:lore:delete', (_, id) =>
    deleteWithPolymorphicRefs(db, 'compendium_custom', 'lore', id))

  // ── Sessions — Phase 4 ───────────────────────────────────────────────────
  registerHandler('db:sessions:getAll', (_, campaignId) =>
    db.all(`
      SELECT s.*,
             (SELECT COUNT(*) FROM reveals r WHERE r.session_id = s.id) AS reveal_count,
             (SELECT COUNT(*) FROM plot_threads p WHERE p.opened_session_id = s.id) AS opened_count,
             (SELECT COUNT(*) FROM plot_threads p WHERE p.resolved_session_id = s.id) AS resolved_count
      FROM sessions s
      WHERE s.campaign_id = ?
      ORDER BY s.session_number DESC`,
      [campaignId]))

  registerHandler('db:sessions:getById', (_, id) =>
    db.get('SELECT * FROM sessions WHERE id = ?', [id]))

  // The session the DM is currently running: the highest-numbered one.
  registerHandler('db:sessions:getCurrent', (_, campaignId) =>
    db.get(
      'SELECT * FROM sessions WHERE campaign_id = ? ORDER BY session_number DESC LIMIT 1',
      [campaignId]))

  registerHandler('db:sessions:create', (_, data) =>
    db.transaction(() => {
      // Derive the number rather than trusting the caller, so two fast clicks
      // cannot both compute the same one. UNIQUE(campaign_id, session_number)
      // is the backstop if they somehow do.
      const next = data.session_number ?? (
        (db.get('SELECT MAX(session_number) AS n FROM sessions WHERE campaign_id = ?',
          [data.campaign_id])?.n ?? 0) + 1
      )

      const result = db.run(`
        INSERT INTO sessions (campaign_id, session_number, title, played_on, notes, recap, created_at)
        VALUES (?,?,?,?,?,?,datetime('now'))`,
        [data.campaign_id, next, data.title ?? `Session ${next}`,
         data.played_on ?? null, data.notes ?? '', data.recap ?? null])

      // campaigns.session_count was read and never written before Phase 4.
      // Recount rather than increment: an increment drifts the moment a session
      // is deleted, and this is one cheap indexed count.
      db.run(`
        UPDATE campaigns
           SET session_count = (SELECT COUNT(*) FROM sessions WHERE campaign_id = ?),
               updated_at = datetime('now')
         WHERE id = ?`,
        [data.campaign_id, data.campaign_id])

      return { ...result, session_number: next }
    }))

  registerHandler('db:sessions:update', (_, id, data) =>
    db.run(`
      UPDATE sessions SET title = ?, played_on = ?, notes = ?, recap = ? WHERE id = ?`,
      [data.title, data.played_on ?? null, data.notes ?? '', data.recap ?? null, id]))

  // Autosave target for the notes textarea — narrower than a full update so a
  // blur cannot clobber a title edited in another field.
  registerHandler('db:sessions:updateNotes', (_, id, notes) =>
    db.run('UPDATE sessions SET notes = ? WHERE id = ?', [notes ?? '', id]))

  registerHandler('db:sessions:delete', (_, id) =>
    db.transaction(() => {
      const session = db.get('SELECT campaign_id FROM sessions WHERE id = ?', [id])
      // plot_threads.opened_session_id / resolved_session_id are ON DELETE SET
      // NULL, so threads survive with a null link. reveals.session_id likewise:
      // the party still knows what it was told, even if the session record goes.
      const result = db.run('DELETE FROM sessions WHERE id = ?', [id])
      if (session) {
        db.run(`
          UPDATE campaigns
             SET session_count = (SELECT COUNT(*) FROM sessions WHERE campaign_id = ?)
           WHERE id = ?`,
          [session.campaign_id, session.campaign_id])
      }
      return result
    }))

  // ── Plot threads — Phase 4 ───────────────────────────────────────────────
  registerHandler('db:plots:getAll', (_, campaignId) =>
    db.all(`
      SELECT p.*,
             o.session_number AS opened_session_number,
             o.title          AS opened_session_title,
             r.session_number AS resolved_session_number,
             r.title          AS resolved_session_title
      FROM plot_threads p
      LEFT JOIN sessions o ON p.opened_session_id   = o.id
      LEFT JOIN sessions r ON p.resolved_session_id = r.id
      WHERE p.campaign_id = ?
      ORDER BY
        CASE p.status WHEN 'active' THEN 0 WHEN 'open' THEN 1
                      WHEN 'resolved' THEN 2 ELSE 3 END,
        p.created_at DESC`,
      [campaignId]))

  registerHandler('db:plots:getById', (_, id) =>
    db.get('SELECT * FROM plot_threads WHERE id = ?', [id]))

  registerHandler('db:plots:create', (_, data) =>
    db.run(`
      INSERT INTO plot_threads (campaign_id, title, description, status, opened_session_id, created_at)
      VALUES (?,?,?,?,?,datetime('now'))`,
      [data.campaign_id, data.title, data.description ?? null,
       data.status ?? 'open', data.opened_session_id ?? null]))

  registerHandler('db:plots:update', (_, id, data) =>
    db.run(`
      UPDATE plot_threads
         SET title = ?, description = ?, status = ?,
             opened_session_id = ?, resolved_session_id = ?
       WHERE id = ?`,
      [data.title, data.description ?? null, data.status ?? 'open',
       data.opened_session_id ?? null, data.resolved_session_id ?? null, id]))

  // Status transition from the board. Moving a thread to 'resolved' stamps it
  // with the current session, so "which session closed this" is answerable
  // without the DM having to remember to set it.
  registerHandler('db:plots:updateStatus', (_, id, status, sessionId) =>
    db.transaction(() => {
      const resolving = status === 'resolved' || status === 'abandoned'
      if (resolving) {
        return db.run(
          'UPDATE plot_threads SET status = ?, resolved_session_id = COALESCE(?, resolved_session_id) WHERE id = ?',
          [status, sessionId ?? null, id])
      }
      // Reopening clears the resolving session — it is no longer true.
      return db.run(
        'UPDATE plot_threads SET status = ?, resolved_session_id = NULL WHERE id = ?',
        [status, id])
    }))

  registerHandler('db:plots:delete', (_, id) =>
    db.run('DELETE FROM plot_threads WHERE id = ?', [id]))

  // ── Reveals — Phase 4 ────────────────────────────────────────────────────
  // What the party has actually been told, as opposed to what the DM knows.
  registerHandler('db:reveals:getForCampaign', (_, campaignId) =>
    db.all(`
      SELECT r.*, s.session_number, s.title AS session_title
      FROM reveals r
      LEFT JOIN sessions s ON r.session_id = s.id
      WHERE r.campaign_id = ?
      ORDER BY r.revealed_at DESC`,
      [campaignId]))

  registerHandler('db:reveals:getForSession', (_, sessionId) =>
    db.all('SELECT * FROM reveals WHERE session_id = ? ORDER BY revealed_at DESC', [sessionId]))

  registerHandler('db:reveals:isRevealed', (_, entityType, entityId) => {
    const row = db.get(
      'SELECT id, revealed_at, session_id FROM reveals WHERE entity_type = ? AND entity_id = ?',
      [entityType, entityId])
    return { revealed: !!row, ...(row ?? {}) }
  })

  registerHandler('db:reveals:reveal', (_, campaignId, entityType, entityId, sessionId) =>
    // UNIQUE(entity_type, entity_id) makes revealing twice a no-op rather than
    // an error — the DM clicking a already-revealed toggle should not see a
    // constraint failure.
    db.run(`
      INSERT INTO reveals (campaign_id, entity_type, entity_id, session_id, revealed_at)
      VALUES (?,?,?,?,datetime('now'))
      ON CONFLICT(entity_type, entity_id) DO UPDATE
        SET session_id = excluded.session_id, revealed_at = excluded.revealed_at`,
      [campaignId, entityType, entityId, sessionId ?? null]))

  registerHandler('db:reveals:unreveal', (_, entityType, entityId) =>
    db.run('DELETE FROM reveals WHERE entity_type = ? AND entity_id = ?', [entityType, entityId]))

  // ── Everything attached to one entity — Phase 4 task 13 ──────────────────
  registerHandler('db:maps:getByLocation', (_, locationId) =>
    db.all('SELECT id, name, grid_size, image_path FROM maps WHERE location_id = ? ORDER BY name', [locationId]))

  registerHandler('db:encounters:getByLocation', (_, locationId) =>
    db.all('SELECT id, name, status, xp_total FROM encounters WHERE location_id = ? ORDER BY name', [locationId]))

  // ── Combat state — Phase 5 ───────────────────────────────────────────────
  // One row per encounter. Combat used to live only in React state, so
  // navigating away or crashing lost the whole fight.
  registerHandler('db:combat:get', (_, encounterId) =>
    db.get('SELECT * FROM combat_state WHERE encounter_id = ?', [encounterId]))

  // The launch-time question: is there a fight to resume in this campaign?
  // 'ended' rows are excluded — a finished fight is history, not an invitation.
  registerHandler('db:combat:getActiveForCampaign', (_, campaignId) =>
    db.get(`
      SELECT cs.*, e.name AS encounter_name
      FROM combat_state cs
      JOIN encounters e ON e.id = cs.encounter_id
      WHERE cs.campaign_id = ? AND cs.phase != 'ended'
      ORDER BY cs.updated_at DESC
      LIMIT 1`,
      [campaignId]))

  // Upsert, because UNIQUE(encounter_id) makes one row per encounter the whole
  // point. The renderer debounces this; the handler stays dumb.
  registerHandler('db:combat:save', (_, state) =>
    db.run(`
      INSERT INTO combat_state
        (campaign_id, encounter_id, round_count, phase, combatants, log_entries, updated_at)
      VALUES (?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(encounter_id) DO UPDATE SET
        round_count = excluded.round_count,
        phase       = excluded.phase,
        combatants  = excluded.combatants,
        log_entries = excluded.log_entries,
        updated_at  = excluded.updated_at`,
      [state.campaign_id, state.encounter_id, state.round_count ?? 1,
       state.phase ?? 'setup',
       typeof state.combatants  === 'string' ? state.combatants  : JSON.stringify(state.combatants  ?? []),
       typeof state.log_entries === 'string' ? state.log_entries : JSON.stringify(state.log_entries ?? [])]))

  registerHandler('db:combat:clear', (_, encounterId) =>
    db.run('DELETE FROM combat_state WHERE encounter_id = ?', [encounterId]))

  // Encounter list badges: which encounters have a fight to resume.
  registerHandler('db:combat:getAllForCampaign', (_, campaignId) =>
    db.all(`
      SELECT encounter_id, round_count, phase, updated_at
      FROM combat_state
      WHERE campaign_id = ? AND phase != 'ended'`,
      [campaignId]))

  // Global world search
  // Searches every table a DM might have written the phrase into, not just the
  // four world tables. The two that mattered most were missing entirely: lore
  // BODIES (only the title was searched, so the text of every lore entry was
  // invisible) and session notes, which is where most of a campaign's prose ends
  // up once Phase 4 exists.
  registerHandler('db:world:search', (_, campaignId, query) => {
    const q = `%${query}%`
    const locations = db.all(
      `SELECT id, name, type, 'location' AS entity_type FROM locations WHERE campaign_id=? AND (name LIKE ? OR description LIKE ? OR lore LIKE ?)`,
      [campaignId, q, q, q])
    const factions = db.all(
      `SELECT id, name, alignment AS subtitle, 'faction' AS entity_type FROM factions WHERE campaign_id=? AND (name LIKE ? OR description LIKE ? OR notes LIKE ?)`,
      [campaignId, q, q, q])
    const npcs = db.all(
      `SELECT id, name, role AS subtitle, 'npc' AS entity_type FROM npcs WHERE campaign_id=? AND (name LIKE ? OR notes LIKE ? OR motivation LIKE ?)`,
      [campaignId, q, q, q])

    // Lore content lives inside the `data` JSON blob as $.content. Searching
    // only `name` meant a DM could not find a lore entry by anything written in
    // it — the single most common way to lose a piece of your own worldbuilding.
    const lore = db.all(
      `SELECT id, name, 'lore' AS entity_type FROM compendium_custom
        WHERE campaign_id=? AND type='lore'
          AND (name LIKE ? OR json_extract(data, '$.content') LIKE ?)`,
      [campaignId, q, q])

    const characters = db.all(
      `SELECT id, character_name AS name, class AS subtitle, 'character' AS entity_type
         FROM characters
        WHERE campaign_id=? AND (character_name LIKE ? OR player_name LIKE ? OR notes LIKE ?)`,
      [campaignId, q, q, q])

    const encounters = db.all(
      `SELECT id, name, status AS subtitle, 'encounter' AS entity_type
         FROM encounters
        WHERE campaign_id=? AND (name LIKE ? OR notes LIKE ?)`,
      [campaignId, q, q])

    const maps = db.all(
      `SELECT id, name, 'map' AS entity_type FROM maps WHERE campaign_id=? AND name LIKE ?`,
      [campaignId, q])

    const sessions = db.all(
      `SELECT id, COALESCE(title, 'Session ' || session_number) AS name,
              'Session ' || session_number AS subtitle, 'session' AS entity_type
         FROM sessions
        WHERE campaign_id=? AND (title LIKE ? OR notes LIKE ? OR recap LIKE ?)
        ORDER BY session_number DESC`,
      [campaignId, q, q, q])

    const plots = db.all(
      `SELECT id, title AS name, status AS subtitle, 'plot' AS entity_type
         FROM plot_threads
        WHERE campaign_id=? AND (title LIKE ? OR description LIKE ?)`,
      [campaignId, q, q])

    // Homebrew items/spells/monsters — everything in compendium_custom that is
    // not a lore entry, which the old query excluded without saying so.
    const compendium = db.all(
      `SELECT id, name, type AS subtitle, 'compendium' AS entity_type
         FROM compendium_custom
        WHERE campaign_id=? AND type <> 'lore' AND (name LIKE ? OR data LIKE ?)`,
      [campaignId, q, q])

    const groups = { locations, factions, npcs, lore, characters, encounters, maps, sessions, plots, compendium }
    const total = Object.values(groups).reduce((sum, rows) => sum + rows.length, 0)
    return { ...groups, total }
  })

  // Maps — Phase 3
  registerHandler('db:maps:getAll', (_, campaignId) =>
    db.all(`
      SELECT m.*, l.name AS location_name
      FROM maps m
      LEFT JOIN locations l ON m.location_id = l.id
      WHERE m.campaign_id = ?
      ORDER BY m.name ASC`,
      [campaignId]))

  registerHandler('db:maps:getById', (_, id) =>
    db.get('SELECT * FROM maps WHERE id = ?', [id]))

  registerHandler('db:maps:create', (_, data) =>
    db.run(`
      INSERT INTO maps
        (campaign_id, name, location_id, image_path, grid_size, fog_data, tokens, created_at)
      VALUES (?,?,?,?,?,?,?,datetime('now'))`,
      [data.campaign_id, data.name, data.location_id ?? null,
       data.image_path ?? null, data.grid_size ?? 50,
       JSON.stringify([]), JSON.stringify([])]))

  registerHandler('db:maps:update', (_, id, data) =>
    db.run(`
      UPDATE maps SET name=?, location_id=?, grid_size=? WHERE id=?`,
      [data.name, data.location_id ?? null, data.grid_size ?? 50, id]))

  registerHandler('db:maps:updateImagePath', (_, id, imagePath) =>
    db.run('UPDATE maps SET image_path=? WHERE id=?', [imagePath, id]))

  registerHandler('db:maps:updateFog', (_, id, fogData) =>
    db.run('UPDATE maps SET fog_data=? WHERE id=?', [JSON.stringify(fogData), id]))

  registerHandler('db:maps:updateTokens', (_, id, tokens) =>
    db.run('UPDATE maps SET tokens=? WHERE id=?', [JSON.stringify(tokens), id]))

  // Deleting a map also removes its image and thumbnail from disk. Both are
  // best-effort: a missing or locked file must not block the database delete,
  // or the map becomes undeletable. Same pattern as pdf:delete.
  registerHandler('db:maps:delete', (_, id) => {
    const map = db.get('SELECT image_path FROM maps WHERE id = ?', [id])
    const result = db.run('DELETE FROM maps WHERE id=?', [id])

    if (map?.image_path) {
      try {
        if (fs.existsSync(map.image_path)) fs.unlinkSync(map.image_path)
      } catch (err) {
        console.error(`[db:maps:delete] could not remove image ${map.image_path}:`, err.message)
      }
    }

    try {
      const thumb = path.join(app.getPath('userData'), 'maps', 'thumbs', `thumb_${id}.png`)
      if (fs.existsSync(thumb)) fs.unlinkSync(thumb)
    } catch (err) {
      console.error(`[db:maps:delete] could not remove thumbnail for map ${id}:`, err.message)
    }

    return result
  })

  // ── Custom Compendium (items, spells, equipment, monsters) ──────────
  // Note: type='lore' entries are managed separately via db:lore:* handlers.
  // getAll with no type arg returns everything EXCEPT lore entries.
  registerHandler('db:compendium:getAll', (_, campaignId, type) => {
    const query  = type
      ? 'SELECT * FROM compendium_custom WHERE campaign_id = ? AND type = ? ORDER BY name ASC'
      : 'SELECT * FROM compendium_custom WHERE campaign_id = ? AND type != ? ORDER BY name ASC'
    const params = type ? [campaignId, type] : [campaignId, 'lore']
    return db.all(query, params)
  })

  registerHandler('db:compendium:getById', (_, id) =>
    db.get('SELECT * FROM compendium_custom WHERE id = ?', [id]))

  registerHandler('db:compendium:create', (_, data) =>
    db.run(`
      INSERT INTO compendium_custom (campaign_id, type, name, data, source, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [data.campaign_id, data.type, data.name, JSON.stringify(data.data), data.source ?? 'custom']))

  registerHandler('db:compendium:update', (_, id, data) =>
    db.run('UPDATE compendium_custom SET name=?, data=? WHERE id=?',
      [data.name, JSON.stringify(data.data), id]))

  registerHandler('db:compendium:delete', (_, id) =>
    db.run('DELETE FROM compendium_custom WHERE id=?', [id]))

  registerHandler('db:compendium:search', (_, campaignId, query) => {
    const q = `%${query}%`
    return db.all(`
      SELECT * FROM compendium_custom
      WHERE campaign_id = ? AND type != 'lore' AND name LIKE ?
      ORDER BY type ASC, name ASC`,
      [campaignId, q])
  })

  // ── Characters ────────────────────────────────────────────────────────────
  registerHandler('db:characters:getAll', (_, campaignId) =>
    db.all('SELECT * FROM characters WHERE campaign_id = ? ORDER BY character_name ASC', [campaignId]))

  registerHandler('db:characters:getById', (_, id) =>
    db.get('SELECT * FROM characters WHERE id = ?', [id]))

  registerHandler('db:characters:create', (_, data) =>
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

  registerHandler('db:characters:update', (_, id, data) =>
    db.run(`
      UPDATE characters
      SET player_name=?, character_name=?, class=?, race=?, level=?,
          stats=?, hp_current=?, hp_max=?, inventory=?, spell_slots=?, notes=?
      WHERE id=?`,
      [data.player_name, data.character_name, data.class, data.race, data.level,
       JSON.stringify(data.stats), data.hp_current, data.hp_max,
       JSON.stringify(data.inventory), JSON.stringify(data.spell_slots),
       data.notes, id]))

  registerHandler('db:characters:updateHP', (_, id, hpCurrent) =>
    db.run('UPDATE characters SET hp_current=? WHERE id=?', [hpCurrent, id]))

  registerHandler('db:characters:updateStats', (_, id, stats) =>
    db.run('UPDATE characters SET stats=? WHERE id=?', [JSON.stringify(stats), id]))

  registerHandler('db:characters:delete', (_, id) =>
    db.run('DELETE FROM characters WHERE id=?', [id]))

  // ── Character inventory ───────────────────────────────────────────────────
  registerHandler('db:characters:addItem', (_, charId, item) => {
    const char = db.get('SELECT inventory FROM characters WHERE id=?', [charId])
    const inv  = JSON.parse(char.inventory ?? '[]')
    inv.push({ ...item, id: require('crypto').randomUUID() })
    return db.run('UPDATE characters SET inventory=? WHERE id=?', [JSON.stringify(inv), charId])
  })

  registerHandler('db:characters:removeItem', (_, charId, itemId) => {
    const char = db.get('SELECT inventory FROM characters WHERE id=?', [charId])
    const inv  = JSON.parse(char.inventory ?? '[]').filter(i => i.id !== itemId)
    return db.run('UPDATE characters SET inventory=? WHERE id=?', [JSON.stringify(inv), charId])
  })

  registerHandler('db:characters:updateItem', (_, charId, itemId, changes) => {
    const char = db.get('SELECT inventory FROM characters WHERE id=?', [charId])
    const inv  = JSON.parse(char.inventory ?? '[]').map(i => i.id === itemId ? { ...i, ...changes } : i)
    return db.run('UPDATE characters SET inventory=? WHERE id=?', [JSON.stringify(inv), charId])
  })

  // ── Spell slots ───────────────────────────────────────────────────────────
  registerHandler('db:characters:useSlot', (_, charId, slotLevel) => {
    const char  = db.get('SELECT spell_slots FROM characters WHERE id=?', [charId])
    const slots = JSON.parse(char.spell_slots ?? '{}')
    if (slots[slotLevel] && slots[slotLevel].used < slots[slotLevel].max) slots[slotLevel].used += 1
    return db.run('UPDATE characters SET spell_slots=? WHERE id=?', [JSON.stringify(slots), charId])
  })

  registerHandler('db:characters:restoreSlot', (_, charId, slotLevel) => {
    const char  = db.get('SELECT spell_slots FROM characters WHERE id=?', [charId])
    const slots = JSON.parse(char.spell_slots ?? '{}')
    if (slots[slotLevel] && slots[slotLevel].used > 0) slots[slotLevel].used -= 1
    return db.run('UPDATE characters SET spell_slots=? WHERE id=?', [JSON.stringify(slots), charId])
  })

  registerHandler('db:characters:bulkUpdateHP', (_, updates) => {
    // updates: [{ id, hp_current }]
    for (const u of (updates ?? [])) {
      db.run('UPDATE characters SET hp_current=? WHERE id=?', [u.hp_current, u.id])
    }
  })

  registerHandler('db:characters:longRest', (_, charId) => {
    const char  = db.get('SELECT hp_max, spell_slots FROM characters WHERE id=?', [charId])
    const slots = JSON.parse(char.spell_slots ?? '{}')
    Object.keys(slots).forEach(lvl => {
      if (typeof slots[lvl] === 'object' && 'used' in slots[lvl]) slots[lvl].used = 0
    })
    return db.run('UPDATE characters SET hp_current=?, spell_slots=? WHERE id=?',
      [char.hp_max, JSON.stringify(slots), charId])
  })

  registerHandler('db:characters:updateCurrency', (_, charId, currency) => {
    const char  = db.get('SELECT stats FROM characters WHERE id=?', [charId])
    const stats = JSON.parse(char.stats ?? '{}')
    stats.currency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...stats.currency, ...currency }
    return db.run('UPDATE characters SET stats=? WHERE id=?', [JSON.stringify(stats), charId])
  })

  registerHandler('db:characters:updateAC', (_, charId, updates) => {
    // updates: { ac_override?: number|null, ac_magic_bonus?: number }
    const char  = db.get('SELECT stats FROM characters WHERE id=?', [charId])
    const stats = JSON.parse(char.stats ?? '{}')
    if ('ac_override'    in updates) stats.ac_override    = updates.ac_override
    if ('ac_magic_bonus' in updates) stats.ac_magic_bonus = updates.ac_magic_bonus ?? 0
    return db.run('UPDATE characters SET stats=? WHERE id=?', [JSON.stringify(stats), charId])
  })

  registerHandler('db:characters:addKnownSpell', (_, charId, spell) => {
    const char  = db.get('SELECT spell_slots FROM characters WHERE id=?', [charId])
    const slots = JSON.parse(char.spell_slots ?? '{}')
    if (!Array.isArray(slots.known_spells)) slots.known_spells = []
    if (!slots.known_spells.find(s => s.index === spell.index)) slots.known_spells.push(spell)
    return db.run('UPDATE characters SET spell_slots=? WHERE id=?', [JSON.stringify(slots), charId])
  })

  registerHandler('db:characters:removeKnownSpell', (_, charId, spellIndex) => {
    const char  = db.get('SELECT spell_slots FROM characters WHERE id=?', [charId])
    const slots = JSON.parse(char.spell_slots ?? '{}')
    slots.known_spells = (slots.known_spells ?? []).filter(s => s.index !== spellIndex)
    return db.run('UPDATE characters SET spell_slots=? WHERE id=?', [JSON.stringify(slots), charId])
  })

  // ── Subclasses ────────────────────────────────────────────────────────────

  registerHandler('db:subclasses:getByClass', (_, className) =>
    db.all('SELECT * FROM subclasses WHERE class_name = ? ORDER BY name ASC', [className]))

  registerHandler('db:subclasses:getByName', (_, className, subclassName) =>
    db.get('SELECT * FROM subclasses WHERE class_name = ? AND name = ?', [className, subclassName]))

  registerHandler('db:subclasses:getAll', () =>
    db.all('SELECT * FROM subclasses ORDER BY class_name ASC, name ASC'))

  registerHandler('db:characters:setSubclass', (_, charId, subclassName) =>
    db.run('UPDATE characters SET subclass_name=? WHERE id=?', [subclassName ?? null, charId]))

  registerHandler('db:subclasses:create', (_, data) =>
    db.run(
      `INSERT INTO subclasses (class_name, name, description, unlock_level, features, source)
       VALUES (?, ?, ?, ?, ?, 'custom')`,
      [data.class_name, data.name, data.description ?? '',
       data.unlock_level ?? 3, JSON.stringify(data.features ?? [])]))

  registerHandler('db:subclasses:delete', (_, id) =>
    db.run('DELETE FROM subclasses WHERE id=?', [id]))

  // ── Mind Map positions — Phase 6 ─────────────────────────────────────────
  registerHandler('db:mindmap:getPositions', (_, campaignId) =>
    db.all('SELECT * FROM mind_map_positions WHERE campaign_id = ?', [campaignId]))

  registerHandler('db:mindmap:savePosition', (_, data) => {
    const existing = db.get(
      'SELECT id FROM mind_map_positions WHERE campaign_id=? AND entity_type=? AND entity_id=?',
      [data.campaign_id, data.entity_type, data.entity_id])
    if (existing) {
      return db.run(
        'UPDATE mind_map_positions SET x_pos=?, y_pos=? WHERE id=?',
        [data.x_pos, data.y_pos, existing.id])
    }
    return db.run(
      'INSERT INTO mind_map_positions (campaign_id, entity_type, entity_id, x_pos, y_pos) VALUES (?,?,?,?,?)',
      [data.campaign_id, data.entity_type, data.entity_id, data.x_pos, data.y_pos])
  })

  registerHandler('db:mindmap:savePositions', (_, campaignId, positions) => {
    // Note: db.transaction(fn) already invokes the transaction — no extra () needed
    return db.transaction(() => {
      positions.forEach(p => {
        const existing = db.get(
          'SELECT id FROM mind_map_positions WHERE campaign_id=? AND entity_type=? AND entity_id=?',
          [campaignId, p.entity_type, p.entity_id])
        if (existing) {
          db.run('UPDATE mind_map_positions SET x_pos=?, y_pos=? WHERE id=?',
            [p.x_pos, p.y_pos, existing.id])
        } else {
          db.run('INSERT INTO mind_map_positions (campaign_id, entity_type, entity_id, x_pos, y_pos) VALUES (?,?,?,?,?)',
            [campaignId, p.entity_type, p.entity_id, p.x_pos, p.y_pos])
        }
      })
    })
  })

  registerHandler('db:mindmap:clearPositions', (_, campaignId) =>
    db.run('DELETE FROM mind_map_positions WHERE campaign_id=?', [campaignId]))

  // ── Encounters — Phase 5 ─────────────────────────────────────────────────
  registerHandler('db:encounters:getAll', (_, campaignId) =>
    db.all(`
      SELECT e.*, l.name as location_name
      FROM encounters e
      LEFT JOIN locations l ON e.location_id = l.id
      WHERE e.campaign_id = ?
      ORDER BY e.created_at DESC`,
      [campaignId]))

  registerHandler('db:encounters:getById', (_, id) =>
    db.get('SELECT * FROM encounters WHERE id = ?', [id]))

  registerHandler('db:encounters:create', (_, data) =>
    db.run(`
      INSERT INTO encounters
        (campaign_id, name, location_id, map_id, monsters, status, xp_total, notes, created_at)
      VALUES (?,?,?,?,?,'planned',?,?,datetime('now'))`,
      [data.campaign_id, data.name, data.location_id ?? null, data.map_id ?? null,
       JSON.stringify(data.monsters ?? []),
       data.xp_total ?? 0, data.notes ?? '']))

  registerHandler('db:encounters:update', (_, id, data) =>
    db.run(`
      UPDATE encounters
      SET name=?, location_id=?, map_id=?, monsters=?, status=?, xp_total=?, notes=?
      WHERE id=?`,
      [data.name, data.location_id ?? null, data.map_id ?? null,
       JSON.stringify(data.monsters), data.status,
       data.xp_total, data.notes, id]))

  registerHandler('db:encounters:updateStatus', (_, id, status) =>
    db.run('UPDATE encounters SET status=? WHERE id=?', [status, id]))

  registerHandler('db:encounters:setMapId', (_, id, mapId) =>
    db.run('UPDATE encounters SET map_id=? WHERE id=?', [mapId ?? null, id]))

  registerHandler('db:encounters:updateMonsters', (_, id, monsters, xpTotal) =>
    db.run('UPDATE encounters SET monsters=?, xp_total=? WHERE id=?',
      [JSON.stringify(monsters), xpTotal, id]))

  registerHandler('db:encounters:delete', (_, id) =>
    db.run('DELETE FROM encounters WHERE id=?', [id]))

  // ── PDF Sources — Phase 7 ────────────────────────────────────────────────
  registerHandler('db:pdf:getAll', (_, campaignId) =>
    db.all('SELECT * FROM pdf_sources WHERE campaign_id = ? ORDER BY indexed_at DESC', [campaignId]))

  registerHandler('db:pdf:getById', (_, id) =>
    db.get('SELECT * FROM pdf_sources WHERE id = ?', [id]))

  registerHandler('db:pdf:create', (_, data) =>
    db.run(`
      INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count, indexed_at)
      VALUES (?, ?, ?, 'pending', 0, NULL)`,
      [data.campaign_id, data.filename, data.file_path]))

  registerHandler('db:pdf:updateStatus', (_, id, status, chunkCount) =>
    db.run(`
      UPDATE pdf_sources SET status=?, chunk_count=?, indexed_at=datetime('now') WHERE id=?`,
      [status, chunkCount ?? 0, id]))

  // NOTE: this is the database-only delete and it does NOT drop the source's
  // vectra embeddings or its file on disk. Nothing in src/ calls it — the UI
  // uses the `pdf:delete` channel in pdfHandlers.js, which does both. Kept as-is
  // rather than rewired, because giving dbHandlers an embeddingService just for
  // an unused channel is the wrong trade; see docs/BUILD_STATUS.md (Phase 1,
  // deferred). Use pdf:delete.
  registerHandler('db:pdf:delete', (_, id) => {
    db.run('DELETE FROM pdf_chunks WHERE source_id = ?', [id])
    return db.run('DELETE FROM pdf_sources WHERE id = ?', [id])
  })

  // ── PDF Chunks — Phase 7 ─────────────────────────────────────────────────
  registerHandler('db:pdf:getChunks', (_, sourceId) =>
    db.all('SELECT id, source_id, chunk_index, page_number, text FROM pdf_chunks WHERE source_id = ? ORDER BY chunk_index ASC', [sourceId]))

  registerHandler('db:pdf:insertChunks', (_, sourceId, chunks) => {
    return db.transaction(() => {
      chunks.forEach((chunk, i) => {
        db.run(`
          INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text)
          VALUES (?, ?, ?, ?)`,
          [sourceId, i, chunk.page, chunk.text])
      })
    })
  })

  registerHandler('db:pdf:deleteChunks', (_, sourceId) =>
    db.run('DELETE FROM pdf_chunks WHERE source_id = ?', [sourceId]))

  // ── PDF Chunk Search — Phase 7 (Compendium Import) ───────────────────────
  registerHandler('db:pdf:searchChunks', (_, campaignId, query, limit) => {
    const q = `%${query}%`
    return db.all(`
      SELECT pc.id, pc.source_id, pc.chunk_index, pc.page_number,
             pc.text, ps.filename
      FROM pdf_chunks pc
      JOIN pdf_sources ps ON pc.source_id = ps.id
      WHERE ps.campaign_id = ?
        AND ps.status IN ('indexed', 'embedded')
        AND pc.text LIKE ?
      ORDER BY pc.source_id ASC, pc.chunk_index ASC
      LIMIT ?`,
      [campaignId, q, limit ?? 30]
    )
  })

  registerHandler('db:pdf:getChunksBySource', (_, sourceId, offset, limit) =>
    db.all(
      'SELECT id, source_id, chunk_index, page_number, text FROM pdf_chunks WHERE source_id=? ORDER BY chunk_index ASC LIMIT ? OFFSET ?',
      [sourceId, limit ?? 50, offset ?? 0]
    )
  )

  registerHandler('db:pdf:getChunkContext', (_, sourceId, chunkIndex, contextRadius) => {
    const radius = contextRadius ?? 1
    return db.all(
      'SELECT id, chunk_index, page_number, text FROM pdf_chunks WHERE source_id=? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index ASC',
      [sourceId, chunkIndex - radius, chunkIndex + radius]
    )
  })
}

module.exports = registerDbHandlers
