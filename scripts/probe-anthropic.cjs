// Diagnostic: does the saved Anthropic key work, and which models does it see?
//
//   npx electron scripts/probe-anthropic.cjs [--profile real|scratch|<path>]
//
// Phase 6.1 Part A step 4. The key is stored with Electron's safeStorage, so it
// can only be decrypted inside an Electron process — hence the .cjs entry point
// rather than a plain node script.
//
// SAFETY
//   - The key is NEVER printed. Only its length and last four characters are
//     shown, which is enough to tell two keys apart and useless to anyone else.
//   - This script opens NO database. It reads one file and makes one HTTPS
//     request. The developer's campaign at %APPDATA%/dmcs/dmcs.db is not touched.
const { app, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const https = require('https')

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const PROFILES = {
  real: path.join(process.env.APPDATA || '', 'dmcs'),
  scratch: path.resolve(__dirname, '..', '.scratch-userdata'),
}

function resolveProfile(which) {
  return PROFILES[which] ?? path.resolve(which)
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, timeout: 20000 }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('timeout', () => { req.destroy(new Error('timed out after 20s')) })
    req.on('error', reject)
    req.end()
  })
}

app.whenReady().then(async () => {
  const which = argOf('--profile', 'real')
  const dir = resolveProfile(which)
  const keyPath = path.join(dir, 'dmcs.key')

  console.log('\n  Anthropic key probe — Phase 6.1 Part A step 4\n')
  console.log(`  profile        : ${which}`)
  console.log(`  userData path  : ${dir}`)
  console.log(`  key path       : ${keyPath}`)
  console.log(`  safeStorage    : ${safeStorage.isEncryptionAvailable() ? 'available' : 'UNAVAILABLE'}`)

  if (!fs.existsSync(keyPath)) {
    console.log('\n  RESULT: no key file in this profile.\n')
    app.exit(2)
    return
  }

  const raw = fs.readFileSync(keyPath)
  console.log(`  key file       : ${raw.length} bytes, header "${raw.subarray(0, 5).toString('latin1')}"`)

  // Distinguish "safeStorage is broken" from "this particular blob is stale".
  // Without this the two look identical, and they need opposite fixes.
  let roundTrip = 'not attempted'
  try {
    const probe = safeStorage.encryptString('round-trip-probe')
    console.log(`  fresh blob     : ${probe.length} bytes, header "${probe.subarray(0, 5).toString('latin1')}"`)
    roundTrip = safeStorage.decryptString(probe) === 'round-trip-probe'
      ? 'WORKS — encryption is healthy right now'
      : 'returned the wrong plaintext'
  } catch (err) {
    roundTrip = `FAILS — ${err.message}`
  }
  console.log(`  fresh round-trip: ${roundTrip}`)

  let key = null
  try {
    key = safeStorage.decryptString(raw)
  } catch (err) {
    console.log(`\n  RESULT: the key file is present but CANNOT BE DECRYPTED — ${err.message}`)
    console.log('')
    console.log('  This is the reported bug. KeyService.hasKey() only checks that the file')
    console.log('  EXISTS, so the UI shows a masked key and a "Remove Key" button; but')
    console.log('  KeyService.loadKey() catches the decryption failure and returns null, so')
    console.log('  AIService.initialize(null) never even attempts the Claude branch. The app')
    console.log('  believes it has a key and behaves as though it has none, and says nothing.')
    console.log('')
    console.log(roundTrip.startsWith('WORKS')
      ? '  Encryption is healthy NOW, so the stored blob itself is stale — written by a\n'
      + '  different OS user, machine, or an Electron build with another safeStorage\n'
      + '  backend. The fix for the developer is to re-enter the key; the fix for the\n'
      + '  app is to report this instead of silently pretending there is no key.'
      : '  Encryption is not working at all in this process, so no key could be read\n'
      + '  even if it were freshly written.')
    console.log('')
    app.exit(3)
    return
  }

  // Never the key itself.
  console.log(`  key            : ${key.length} chars, ends "…${key.slice(-4)}", prefix "${key.slice(0, 8)}…"`)

  const headers = {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }

  console.log('\n  GET https://api.anthropic.com/v1/models')
  let res
  try {
    res = await get('https://api.anthropic.com/v1/models?limit=100', headers)
  } catch (err) {
    console.log(`  RESULT: network error — ${err.message}`)
    console.log('  (This is the "offline" case: neither key nor model id can be judged.)\n')
    app.exit(4)
    return
  }

  console.log(`  HTTP ${res.status}`)

  if (res.status === 401 || res.status === 403) {
    let why = ''
    try { why = JSON.parse(res.body)?.error?.message ?? '' } catch { /* non-JSON body */ }
    console.log(`  RESULT: the key is INVALID or expired. ${why}`)
    console.log('  => mode should be "no-ai" for Claude, and the UI must say exactly this.\n')
    app.exit(0)
    return
  }

  if (res.status !== 200) {
    console.log(`  RESULT: unexpected status. Body: ${res.body.slice(0, 300)}\n`)
    app.exit(5)
    return
  }

  let models = []
  try {
    models = (JSON.parse(res.body).data ?? []).map(m => m.id)
  } catch (err) {
    console.log(`  RESULT: 200 but unparseable body — ${err.message}\n`)
    app.exit(6)
    return
  }

  const LOCKED = 'claude-sonnet-5'
  const hasLocked = models.includes(LOCKED)

  console.log(`  models returned: ${models.length}`)
  console.log(`  "${LOCKED}" present: ${hasLocked ? 'YES' : 'NO'}`)
  console.log('\n  Sonnet ids the API actually returns:')
  const sonnets = models.filter(id => /sonnet/i.test(id))
  for (const id of sonnets) console.log(`    - ${id}`)
  if (sonnets.length === 0) console.log('    (none)')

  console.log('\n  Full model list:')
  for (const id of models) console.log(`    - ${id}`)

  console.log(hasLocked
    ? '\n  RESULT: key valid AND the locked model id exists => the validation logic is at fault.\n'
    : `\n  RESULT: key valid but "${LOCKED}" DOES NOT EXIST => the hard-locked model id is the cause.\n`)

  app.exit(0)
}).catch(err => {
  console.error('probe crashed:', err)
  app.exit(1)
})
