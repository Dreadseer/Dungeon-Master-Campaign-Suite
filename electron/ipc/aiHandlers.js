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

  // RAG query — routes question through vector search + grounded AI answer
  ipcMain.handle('ai:ragQuery', async (_, question, campaignId, options) => {
    return global.ragService.query(question, campaignId, options)
  })

  // AI usage stats — aggregate counts and timings from ai_usage_log
  ipcMain.handle('ai:getUsageStats', (_, campaignId) => {
    const filter = campaignId ? 'WHERE campaign_id = ?' : ''
    const params = campaignId ? [campaignId] : []
    const rows = global.db.all(
      `SELECT type, COUNT(*) AS count, AVG(duration_ms) AS avg_ms
       FROM ai_usage_log ${filter}
       GROUP BY type`,
      params
    )
    const total = rows.reduce((sum, r) => sum + r.count, 0)
    const avgMs = rows.length
      ? Math.round(rows.reduce((sum, r) => sum + r.avg_ms * r.count, 0) / Math.max(total, 1))
      : 0
    return { rows, total, avgMs }
  })

  ipcMain.handle('ai:clearUsageLog', (_, campaignId) => {
    if (campaignId) {
      global.db.run('DELETE FROM ai_usage_log WHERE campaign_id = ?', [campaignId])
    } else {
      global.db.run('DELETE FROM ai_usage_log')
    }
    return { success: true }
  })

  // RAG settings — stored in-process and persisted to userData/rag-settings.json
  ipcMain.handle('rag:getSettings', () => global.ragSettings)

  ipcMain.handle('rag:saveSettings', (_, settings) => {
    global.ragSettings = { ...global.ragSettings, ...settings }
    const { app } = require('electron')
    const fs   = require('fs')
    const path = require('path')
    try {
      fs.writeFileSync(
        path.join(app.getPath('userData'), 'rag-settings.json'),
        JSON.stringify(global.ragSettings, null, 2)
      )
    } catch { /* non-critical */ }
    return global.ragSettings
  })

  // Streaming chat — uses ipcMain.on (not handle) so it can push chunks back via sender.send
  ipcMain.on('ai:stream:start', async (event, { systemPrompt, messages, requestId }) => {
    try {
      await aiService.stream(
        systemPrompt,
        messages,
        (chunk) => event.sender.send('ai:stream:chunk', { requestId, chunk }),
        ()      => event.sender.send('ai:stream:done',  { requestId }),
      )
    } catch (err) {
      event.sender.send('ai:stream:error', { requestId, error: err.message })
    }
  })
}

module.exports = registerAiHandlers
