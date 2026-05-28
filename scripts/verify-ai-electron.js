// Prompt 04 verification — AIService + KeyService in Electron main process
const { app } = require('electron')
const path = require('path')
const os   = require('os')
const fs   = require('fs')

app.whenReady().then(async () => {
  const AIService  = require('../electron/services/AIService')
  const KeyService = require('../electron/services/KeyService')

  const testKeyPath = path.join(os.tmpdir(), 'dmcs-test-' + Date.now() + '.key')
  let exitCode = 0

  // Monkey-patch KeyService to use temp path so we don't touch the real key file
  const keyService = new KeyService()
  keyService.keyPath = testKeyPath

  const aiService = new AIService()

  try {
    // Test 1: initialize with no key — should land on offline-ollama or no-ai
    const r1 = await aiService.initialize(null)
    if (r1.mode === 'offline-ollama' || r1.mode === 'no-ai') {
      console.log('✅ Test 1 PASS — no-key init mode:', r1.mode)
    } else {
      console.error('❌ Test 1 FAIL — unexpected mode:', r1.mode); exitCode = 1
    }

    // Test 2: getMode() matches initialize result
    const mode = aiService.getMode()
    if (mode === r1.mode) {
      console.log('✅ Test 2 PASS — getMode():', mode)
    } else {
      console.error('❌ Test 2 FAIL — getMode mismatch'); exitCode = 1
    }

    // Test 3: KeyService save/load/has/delete
    keyService.saveKey('test-api-key-12345')
    const loaded = keyService.loadKey()
    const has    = keyService.hasKey()
    if (loaded === 'test-api-key-12345' && has === true) {
      console.log('✅ Test 3 PASS — KeyService save/load/has working')
    } else {
      console.error('❌ Test 3 FAIL — loaded:', loaded, 'has:', has); exitCode = 1
    }

    keyService.deleteKey()
    if (!keyService.hasKey()) {
      console.log('✅ Test 4 PASS — KeyService delete working')
    } else {
      console.error('❌ Test 4 FAIL — key still exists after delete'); exitCode = 1
    }

    // Test 5: complete() with no-ai throws correct error
    const noAiService = new AIService()
    noAiService.mode = 'no-ai'
    try {
      await noAiService.complete('system', 'user')
      console.error('❌ Test 5 FAIL — should have thrown'); exitCode = 1
    } catch (err) {
      if (err.message.includes('No AI service available')) {
        console.log('✅ Test 5 PASS — no-ai throws correct error')
      } else {
        console.error('❌ Test 5 FAIL — wrong error:', err.message); exitCode = 1
      }
    }

    console.log(exitCode === 0 ? '\n✅ All AI/Key verification tests passed.' : '\n❌ Some tests failed.')

  } catch (err) {
    console.error('❌ UNEXPECTED ERROR:', err.message)
    exitCode = 1
  } finally {
    try { fs.unlinkSync(testKeyPath) } catch {}
  }

  process.exit(exitCode)
})
