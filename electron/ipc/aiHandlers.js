const { registerHandler, registerListener } = require('./registerHandler')

function registerAiHandlers(aiService, keyService) {
  registerHandler('ai:initialize', async () => {
    const key = keyService.loadKey()
    return aiService.initialize(key)
  })

  registerHandler('ai:getMode', () => ({ mode: aiService.getMode() }))

  registerHandler('ai:complete', async (_, systemPrompt, userMessage, options) => {
    return aiService.complete(systemPrompt, userMessage, options)
  })

  registerHandler('ai:saveKey', async (_, key) => {
    keyService.saveKey(key)
    return aiService.initialize(key)
  })

  registerHandler('ai:deleteKey', () => {
    keyService.deleteKey()
    aiService.initialize(null)
    return { success: true }
  })

  registerHandler('ai:hasKey', () => ({ hasKey: keyService.hasKey() }))

  // RAG query — routes question through vector search + grounded AI answer
  registerHandler('ai:ragQuery', async (_, question, campaignId, options) => {
    return global.ragService.query(question, campaignId, options)
  })

  // AI usage stats — aggregate counts and timings from ai_usage_log
  registerHandler('ai:getUsageStats', (_, campaignId) => {
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

  registerHandler('ai:clearUsageLog', (_, campaignId) => {
    if (campaignId) {
      global.db.run('DELETE FROM ai_usage_log WHERE campaign_id = ?', [campaignId])
    } else {
      global.db.run('DELETE FROM ai_usage_log')
    }
    return { success: true }
  })

  // RAG settings — stored in-process and persisted to userData/rag-settings.json
  registerHandler('rag:getSettings', () => global.ragSettings)

  registerHandler('rag:saveSettings', (_, settings) => {
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
  registerListener('ai:stream:start', async (event, { systemPrompt, messages, requestId }) => {
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
