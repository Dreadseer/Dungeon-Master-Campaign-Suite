const { registerHandler, registerListener } = require('./registerHandler')
const { normaliseProvider } = require('../services/aiDetection.cjs')

/**
 * Tell every window the AI mode changed (Phase 6.1 task 9).
 *
 * Before this, ai:saveKey re-initialised the service and nothing told the
 * renderer, so the TopBar badge and every no-ai-gated component kept their
 * stale mode until the app was restarted.
 */
function broadcastModeChanged(aiService) {
  const { BrowserWindow } = require('electron')
  const payload = { mode: aiService.getMode(), detection: aiService.getDetection() }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('ai:modeChanged', payload)
  }
}

/** Persist a RAG/AI setting to the same file rag:saveSettings writes. */
function saveSetting(patch) {
  global.ragSettings = { ...global.ragSettings, ...patch }
  try {
    const { app } = require('electron')
    const fs = require('fs')
    const path = require('path')
    fs.writeFileSync(
      path.join(app.getPath('userData'), 'rag-settings.json'),
      JSON.stringify(global.ragSettings, null, 2),
    )
  } catch { /* non-critical: the setting still applies for this session */ }
  return global.ragSettings
}

function registerAiHandlers(aiService, keyService) {
  /** Re-read the key and re-run detection. The one path that decides the mode. */
  const detect = async () => {
    const { key, error } = keyService.readKey()
    return aiService.initialize(key, { keyError: error })
  }

  registerHandler('ai:initialize', detect)

  registerHandler('ai:getMode', () => ({ mode: aiService.getMode() }))

  // Why the app is in this mode (task 6).
  registerHandler('ai:getDetection', () => aiService.getDetection())

  // Re-detect on demand, and tell every window (task 9).
  registerHandler('ai:redetect', async () => {
    const result = await detect()
    broadcastModeChanged(aiService)
    return result
  })

  // Manual provider switch (task 9b). The preference is persisted, and a
  // failure does NOT fall through to the other provider — the selection stands
  // and the reason is reported.
  registerHandler('ai:setProvider', async (_, provider) => {
    saveSetting({ preferredProvider: normaliseProvider(provider) })
    const result = await detect()
    broadcastModeChanged(aiService)
    return result
  })

  registerHandler('ai:getProvider', () => ({
    provider: normaliseProvider(global.ragSettings?.preferredProvider),
  }))

  // The Claude model id, unlocked (task 8).
  registerHandler('ai:setModel', async (_, modelId) => {
    saveSetting({ anthropicModel: String(modelId ?? '').trim() })
    const result = await detect()
    broadcastModeChanged(aiService)
    return result
  })

  registerHandler('ai:listModels', async () => {
    const { key, error } = keyService.readKey()
    if (error) throw new Error(error)
    return { models: await aiService.listClaudeModels(key) }
  })

  // Test the PROVIDER, not the mode (task 10). Neither of these goes through
  // ai:complete, which reports whatever mode detection landed on and so could
  // never tell a DM why a working key was being ignored.
  registerHandler('ai:testClaude', async () => {
    const { key, error } = keyService.readKey()
    return aiService.testClaude(key, error)
  })

  registerHandler('ai:testOllama', async () => aiService.testOllama())

  registerHandler('ai:complete', async (_, systemPrompt, userMessage, options) => {
    return aiService.complete(systemPrompt, userMessage, options)
  })

  registerHandler('ai:saveKey', async (_, key) => {
    keyService.saveKey(key)
    const result = await detect()
    broadcastModeChanged(aiService)
    return result
  })

  registerHandler('ai:deleteKey', async () => {
    keyService.deleteKey()
    const result = await detect()
    broadcastModeChanged(aiService)
    return { success: true, ...result }
  })

  // `readable` distinguishes "a key is saved" from "a key is saved AND can be
  // read" — the two the old hasKey() conflated, which is what let the UI show a
  // masked key while the app ran with none.
  registerHandler('ai:hasKey', () => {
    const { present, error } = keyService.readKey()
    // readable is true when there is nothing wrong to report — including when
    // there is no key at all. Reporting an absent key as "unreadable" would put
    // a decryption warning in front of a DM who simply has not set one.
    return { hasKey: present, readable: !error, error }
  })

  // RAG query — routes question through vector search + grounded AI answer
  registerHandler('ai:ragQuery', async (_, question, campaignId, options) => {
    return global.ragService.query(question, campaignId, options)
  })

  // Situation mode — decompose into rules concepts, retrieve per concept, rule
  // over the union. AI required; the renderer hides the toggle in no-ai mode.
  registerHandler('ai:ragSituation', async (_, situation, campaignId, options) => {
    return global.ragService.situationQuery(situation, campaignId, options)
  })

  // AI usage stats — aggregate counts and timings from ai_usage_log
  registerHandler('ai:getUsageStats', (_, campaignId) => {
    const filter = campaignId ? 'WHERE campaign_id = ?' : ''
    const params = campaignId ? [campaignId] : []
    // response_len < 0 is the failure sentinel written by AIService._logUsage.
    // Averages are taken over successful calls only — a call that threw after
    // 200ms is not evidence that the model is fast.
    const rows = global.db.all(
      `SELECT type,
              COUNT(*) AS count,
              SUM(CASE WHEN response_len < 0 THEN 1 ELSE 0 END) AS failures,
              AVG(CASE WHEN response_len >= 0 THEN duration_ms END) AS avg_ms
       FROM ai_usage_log ${filter}
       GROUP BY type`,
      params
    )
    const total    = rows.reduce((sum, r) => sum + r.count, 0)
    const failures = rows.reduce((sum, r) => sum + (r.failures ?? 0), 0)
    const succeeded = total - failures
    const avgMs = succeeded > 0
      ? Math.round(
          rows.reduce((sum, r) => sum + (r.avg_ms ?? 0) * (r.count - (r.failures ?? 0)), 0) / succeeded
        )
      : 0
    return { rows, total, failures, succeeded, avgMs }
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
