const { ipcMain } = require('electron')

function registerAiHandlers(aiService, keyService) {
  ipcMain.handle('ai:initialize', async () => {
    const key = keyService.loadKey()
    return aiService.initialize(key)
  })

  ipcMain.handle('ai:getMode', () => ({ mode: aiService.getMode() }))

  ipcMain.handle('ai:complete', async (_, systemPrompt, userMessage) => {
    return aiService.complete(systemPrompt, userMessage)
  })

  ipcMain.handle('ai:saveKey', async (_, key) => {
    keyService.saveKey(key)
    return aiService.initialize(key)
  })

  ipcMain.handle('ai:deleteKey', () => {
    keyService.deleteKey()
    aiService.initialize(null)
    return { success: true }
  })

  ipcMain.handle('ai:hasKey', () => ({ hasKey: keyService.hasKey() }))
}

module.exports = registerAiHandlers
