const { ipcMain } = require('electron')

function registerDbHandlers(db) {
  // Campaigns
  ipcMain.handle('db:campaigns:getAll',  () =>
    db.all('SELECT * FROM campaigns ORDER BY updated_at DESC'))

  ipcMain.handle('db:campaigns:getById', (_, id) =>
    db.get('SELECT * FROM campaigns WHERE id = ?', [id]))

  ipcMain.handle('db:campaigns:create',  (_, data) =>
    db.run(
      `INSERT INTO campaigns (name, description, world_setting, created_at, updated_at, session_count)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), 0)`,
      [data.name, data.description, data.world_setting]
    ))

  ipcMain.handle('db:campaigns:update',  (_, id, data) =>
    db.run(
      `UPDATE campaigns SET name = ?, description = ?, world_setting = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [data.name, data.description, data.world_setting, id]
    ))

  ipcMain.handle('db:campaigns:delete',  (_, id) =>
    db.run('DELETE FROM campaigns WHERE id = ?', [id]))

  // NPCs — Phase 2: JOIN queries, getById, getByLocation, getByFaction, toggleAlive
  ipcMain.handle('db:npcs:getAll', (_, campaignId) =>
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

  ipcMain.handle('db:npcs:getById', (_, id) =>
    db.get(`
      SELECT n.*,
             l.name AS location_name,
             f.name AS faction_name
      FROM npcs n
      LEFT JOIN locations l ON n.location_id = l.id
      LEFT JOIN factions  f ON n.faction_id  = f.id
      WHERE n.id = ?
    `, [id]))

  ipcMain.handle('db:npcs:getByLocation', (_, locationId) =>
    db.all('SELECT * FROM npcs WHERE location_id = ? ORDER BY name ASC', [locationId]))

  ipcMain.handle('db:npcs:getByFaction', (_, factionId) =>
    db.all('SELECT * FROM npcs WHERE faction_id = ? ORDER BY name ASC', [factionId]))

  ipcMain.handle('db:npcs:create', (_, data) =>
    db.run(`
      INSERT INTO npcs
        (campaign_id, name, race, class, role, location_id, faction_id,
         notes, secrets, motivation, is_alive, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,datetime('now'))
    `, [data.campaign_id, data.name, data.race, data.class, data.role,
        data.location_id ?? null, data.faction_id ?? null,
        data.notes, data.secrets, data.motivation]))

  ipcMain.handle('db:npcs:update', (_, id, data) =>
    db.run(`
      UPDATE npcs
      SET name=?, race=?, class=?, role=?, location_id=?, faction_id=?,
          notes=?, secrets=?, motivation=?, is_alive=?
      WHERE id=?
    `, [data.name, data.race, data.class, data.role,
        data.location_id ?? null, data.faction_id ?? null,
        data.notes, data.secrets, data.motivation, data.is_alive, id]))

  ipcMain.handle('db:npcs:toggleAlive', (_, id, isAlive) =>
    db.run('UPDATE npcs SET is_alive = ? WHERE id = ?', [isAlive ? 1 : 0, id]))

  ipcMain.handle('db:npcs:delete', (_, id) =>
    db.run('DELETE FROM npcs WHERE id = ?', [id]))

  // Locations — Phase 2: upgraded getAll with parent join, parent_location_id in update,
  //             new getById and getByType channels
  ipcMain.handle('db:locations:getAll', (_, campaignId) =>
    db.all(`
      SELECT l.*, p.name AS parent_name
      FROM locations l
      LEFT JOIN locations p ON l.parent_location_id = p.id
      WHERE l.campaign_id = ?
      ORDER BY l.name ASC
    `, [campaignId]))

  ipcMain.handle('db:locations:getById', (_, id) =>
    db.get('SELECT * FROM locations WHERE id = ?', [id]))

  ipcMain.handle('db:locations:getByType', (_, campaignId, type) =>
    db.all('SELECT * FROM locations WHERE campaign_id = ? AND type = ? ORDER BY name ASC', [campaignId, type]))

  ipcMain.handle('db:locations:create', (_, data) =>
    db.run(
      `INSERT INTO locations (campaign_id, name, type, description, lore, parent_location_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [data.campaign_id, data.name, data.type, data.description, data.lore, data.parent_location_id ?? null]
    ))

  ipcMain.handle('db:locations:update', (_, id, data) =>
    db.run(
      'UPDATE locations SET name = ?, type = ?, description = ?, lore = ?, parent_location_id = ? WHERE id = ?',
      [data.name, data.type, data.description, data.lore, data.parent_location_id ?? null, id]
    ))

  ipcMain.handle('db:locations:delete', (_, id) =>
    db.run('DELETE FROM locations WHERE id = ?', [id]))

  // Factions — Phase 2: all new
  ipcMain.handle('db:factions:getAll', (_, campaignId) =>
    db.all('SELECT * FROM factions WHERE campaign_id = ? ORDER BY name ASC', [campaignId]))

  ipcMain.handle('db:factions:getById', (_, id) =>
    db.get('SELECT * FROM factions WHERE id = ?', [id]))

  ipcMain.handle('db:factions:create', (_, data) =>
    db.run(
      `INSERT INTO factions (campaign_id, name, description, alignment, notes, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [data.campaign_id, data.name, data.description, data.alignment, data.notes]
    ))

  ipcMain.handle('db:factions:update', (_, id, data) =>
    db.run(
      'UPDATE factions SET name = ?, description = ?, alignment = ?, notes = ? WHERE id = ?',
      [data.name, data.description, data.alignment, data.notes, id]
    ))

  ipcMain.handle('db:factions:delete', (_, id) =>
    db.run('DELETE FROM factions WHERE id = ?', [id]))

  // Connections — Phase 2 Prompt 03 (replaces Phase 1 stub)
  ipcMain.handle('db:connections:getAll', (_, campaignId) =>
    db.all(`
      SELECT c.*
      FROM connections c
      WHERE c.campaign_id = ?
      ORDER BY c.relationship ASC
    `, [campaignId]))

  ipcMain.handle('db:connections:getForEntity', (_, entityType, entityId) =>
    db.all(`
      SELECT * FROM connections
      WHERE (entity_a_type = ? AND entity_a_id = ?)
         OR (entity_b_type = ? AND entity_b_id = ?)`,
      [entityType, entityId, entityType, entityId]))

  ipcMain.handle('db:connections:create', (_, data) =>
    db.run(`
      INSERT INTO connections
        (campaign_id, entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes)
      VALUES (?,?,?,?,?,?,?)`,
      [data.campaign_id, data.entity_a_type, data.entity_a_id,
       data.entity_b_type, data.entity_b_id, data.relationship, data.notes]))

  ipcMain.handle('db:connections:update', (_, id, data) =>
    db.run(`
      UPDATE connections SET relationship=?, notes=? WHERE id=?`,
      [data.relationship, data.notes, id]))

  ipcMain.handle('db:connections:delete', (_, id) =>
    db.run('DELETE FROM connections WHERE id=?', [id]))

  // Lore entries (stored in compendium_custom with type='lore')
  ipcMain.handle('db:lore:getAll', (_, campaignId) =>
    db.all(`
      SELECT * FROM compendium_custom
      WHERE campaign_id = ? AND type = 'lore'
      ORDER BY name ASC`,
      [campaignId]))

  ipcMain.handle('db:lore:getById', (_, id) =>
    db.get('SELECT * FROM compendium_custom WHERE id = ?', [id]))

  ipcMain.handle('db:lore:create', (_, data) =>
    db.run(`
      INSERT INTO compendium_custom
        (campaign_id, type, name, data, source, created_at)
      VALUES (?, 'lore', ?, ?, 'custom', datetime('now'))`,
      [data.campaign_id, data.name,
       JSON.stringify({ content: data.content, category: data.category, is_secret: data.is_secret ?? false })]))

  ipcMain.handle('db:lore:update', (_, id, data) =>
    db.run(`
      UPDATE compendium_custom
      SET name=?, data=? WHERE id=?`,
      [data.name,
       JSON.stringify({ content: data.content, category: data.category, is_secret: data.is_secret ?? false }),
       id]))

  ipcMain.handle('db:lore:delete', (_, id) =>
    db.run('DELETE FROM compendium_custom WHERE id=?', [id]))

  // Global world search
  ipcMain.handle('db:world:search', (_, campaignId, query) => {
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
    const lore = db.all(
      `SELECT id, name, 'lore' AS entity_type FROM compendium_custom WHERE campaign_id=? AND type='lore' AND name LIKE ?`,
      [campaignId, q])
    return { locations, factions, npcs, lore,
             total: locations.length + factions.length + npcs.length + lore.length }
  })

  // Maps — Phase 3
  ipcMain.handle('db:maps:getAll', (_, campaignId) =>
    db.all(`
      SELECT m.*, l.name AS location_name
      FROM maps m
      LEFT JOIN locations l ON m.location_id = l.id
      WHERE m.campaign_id = ?
      ORDER BY m.name ASC`,
      [campaignId]))

  ipcMain.handle('db:maps:getById', (_, id) =>
    db.get('SELECT * FROM maps WHERE id = ?', [id]))

  ipcMain.handle('db:maps:create', (_, data) =>
    db.run(`
      INSERT INTO maps
        (campaign_id, name, location_id, image_path, grid_size, fog_data, tokens, created_at)
      VALUES (?,?,?,?,?,?,?,datetime('now'))`,
      [data.campaign_id, data.name, data.location_id ?? null,
       data.image_path ?? null, data.grid_size ?? 50,
       JSON.stringify([]), JSON.stringify([])]))

  ipcMain.handle('db:maps:update', (_, id, data) =>
    db.run(`
      UPDATE maps SET name=?, location_id=?, grid_size=? WHERE id=?`,
      [data.name, data.location_id ?? null, data.grid_size ?? 50, id]))

  ipcMain.handle('db:maps:updateImagePath', (_, id, imagePath) =>
    db.run('UPDATE maps SET image_path=? WHERE id=?', [imagePath, id]))

  ipcMain.handle('db:maps:updateFog', (_, id, fogData) =>
    db.run('UPDATE maps SET fog_data=? WHERE id=?', [JSON.stringify(fogData), id]))

  ipcMain.handle('db:maps:updateTokens', (_, id, tokens) =>
    db.run('UPDATE maps SET tokens=? WHERE id=?', [JSON.stringify(tokens), id]))

  ipcMain.handle('db:maps:delete', (_, id) =>
    db.run('DELETE FROM maps WHERE id=?', [id]))
}

module.exports = registerDbHandlers
