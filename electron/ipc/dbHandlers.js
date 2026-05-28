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

  // NPCs
  ipcMain.handle('db:npcs:getAll',   (_, campaignId) =>
    db.all('SELECT * FROM npcs WHERE campaign_id = ?', [campaignId]))

  ipcMain.handle('db:npcs:create',   (_, data) =>
    db.run(
      `INSERT INTO npcs (campaign_id, name, race, class, role, location_id, faction_id,
         notes, secrets, motivation, is_alive, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
      [data.campaign_id, data.name, data.race, data.class, data.role,
       data.location_id, data.faction_id, data.notes, data.secrets, data.motivation]
    ))

  ipcMain.handle('db:npcs:update',   (_, id, data) =>
    db.run(
      `UPDATE npcs SET name = ?, race = ?, class = ?, role = ?,
         notes = ?, secrets = ?, motivation = ?, is_alive = ?
       WHERE id = ?`,
      [data.name, data.race, data.class, data.role,
       data.notes, data.secrets, data.motivation, data.is_alive, id]
    ))

  ipcMain.handle('db:npcs:delete',   (_, id) =>
    db.run('DELETE FROM npcs WHERE id = ?', [id]))

  // Locations
  ipcMain.handle('db:locations:getAll',   (_, campaignId) =>
    db.all('SELECT * FROM locations WHERE campaign_id = ?', [campaignId]))

  ipcMain.handle('db:locations:create',   (_, data) =>
    db.run(
      `INSERT INTO locations (campaign_id, name, type, description, lore, parent_location_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [data.campaign_id, data.name, data.type, data.description, data.lore, data.parent_location_id]
    ))

  ipcMain.handle('db:locations:update',   (_, id, data) =>
    db.run(
      'UPDATE locations SET name = ?, type = ?, description = ?, lore = ? WHERE id = ?',
      [data.name, data.type, data.description, data.lore, id]
    ))

  ipcMain.handle('db:locations:delete',   (_, id) =>
    db.run('DELETE FROM locations WHERE id = ?', [id]))

  // Connections
  ipcMain.handle('db:connections:getAll',  (_, campaignId) =>
    db.all(
      `SELECT c.* FROM connections c
       WHERE (c.entity_a_type = 'npc' AND c.entity_a_id IN (SELECT id FROM npcs WHERE campaign_id = ?))
          OR (c.entity_b_type = 'npc' AND c.entity_b_id IN (SELECT id FROM npcs WHERE campaign_id = ?))`,
      [campaignId, campaignId]
    ))

  ipcMain.handle('db:connections:create',  (_, data) =>
    db.run(
      `INSERT INTO connections (entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.entity_a_type, data.entity_a_id, data.entity_b_type, data.entity_b_id,
       data.relationship, data.notes]
    ))

  ipcMain.handle('db:connections:delete',  (_, id) =>
    db.run('DELETE FROM connections WHERE id = ?', [id]))
}

module.exports = registerDbHandlers
