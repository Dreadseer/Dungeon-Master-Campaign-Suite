const { ipcMain } = require('electron')

function registerSrdHandlers(db, srdService) {
  ipcMain.handle('srd:seedAll', async (event) => {
    return srdService.seedAll((percent, message) => {
      event.sender.send('srd:progress', { percent, message })
    })
  })

  ipcMain.handle('srd:getMonsters',   (_, filters) => srdService.getMonsters(filters))
  ipcMain.handle('srd:getSpells',     (_, filters) => srdService.getSpells(filters))
  ipcMain.handle('srd:getEquipment',  (_, filters) => srdService.getEquipment(filters))

  ipcMain.handle('srd:getCacheStats', () =>
    db.all(`SELECT resource_type, COUNT(*) as count FROM srd_cache GROUP BY resource_type`)
  )
}

module.exports = registerSrdHandlers
