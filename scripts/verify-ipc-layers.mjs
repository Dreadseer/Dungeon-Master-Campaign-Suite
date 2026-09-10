// Four-layer IPC audit (standing rule 2).
//
//   node scripts/verify-ipc-layers.mjs
//
// A channel name is a string repeated across three files with no compiler
// checking any of them. A typo in one layer is a silent no-op: the button does
// nothing and nothing is logged. This script cross-references the two layers
// that can be checked statically —
//
//   electron/preload.js      ipcRenderer.invoke('channel', ...)
//   electron/ipc/*.js        registerHandler('channel', ...)
//
// — and reports channels that exist on one side only. The renderer and
// DatabaseService layers are not checked: the first goes through a
// `window.electronAPI.db.x.y` property chain rather than a literal, the second
// is plain SQL.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const IPC_DIR = 'electron/ipc'

const handlerFiles = readdirSync(IPC_DIR).filter(f => f.endsWith('.js') && f !== 'registerHandler.js')

// main.js registers eight window/shell channels of its own. They go through the
// same wrapper and the same preload, so they belong in this audit.
const sources = [
  ...handlerFiles.map(f => [f, join(IPC_DIR, f)]),
  ['main.js', 'electron/main.js'],
]

const registered = new Map()   // channel -> file
const listeners = new Map()
let unwrapped = []

for (const [file, fullPath] of sources) {
  const src = readFileSync(fullPath, 'utf8')
  for (const m of src.matchAll(/\bregisterHandler\(\s*'([^']+)'/g)) registered.set(m[1], file)
  for (const m of src.matchAll(/\bregisterListener\(\s*'([^']+)'/g)) listeners.set(m[1], file)
  for (const m of src.matchAll(/\bipcMain\.(handle|on)\(\s*'([^']+)'/g)) {
    unwrapped.push(`${file}: ipcMain.${m[1]}('${m[2]}')`)
  }
}

const preload = readFileSync('electron/preload.js', 'utf8')
const invoked = new Set([...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map(m => m[1]))
const sent = new Set([...preload.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)].map(m => m[1]))
const listened = new Set([...preload.matchAll(/ipcRenderer\.(?:on|removeListener)\(\s*'([^']+)'/g)].map(m => m[1]))

let failures = 0
const report = (label, items, fatal = true) => {
  if (items.length === 0) {
    console.log(`  OK   ${label}: none`)
    return
  }
  if (fatal) failures += items.length
  console.log(`  ${fatal ? 'FAIL' : 'WARN'} ${label}: ${items.length}`)
  for (const i of items) console.log(`         ${i}`)
}

console.log('\n=== IPC layer audit ===\n')
console.log(`  source files       : ${sources.length}`)
console.log(`  registerHandler    : ${registered.size}`)
console.log(`  registerListener   : ${listeners.size}`)
console.log(`  preload invoke     : ${invoked.size}`)
console.log(`  preload send       : ${sent.size}`)
console.log('')

report('unwrapped ipcMain.handle / ipcMain.on', unwrapped)

// A preload invoke with no handler is the silent no-op the rule exists to stop.
const orphanInvokes = [...invoked].filter(c => !registered.has(c))
report('preload invokes a channel nothing handles', orphanInvokes)

const orphanSends = [...sent].filter(c => !listeners.has(c) && !registered.has(c))
report('preload sends to a channel nothing listens on', orphanSends)

// The reverse is legal — a handler the renderer does not use yet — so it is
// reported without failing the run.
const mainOnlyEvents = new Set(['ai:stream:chunk', 'ai:stream:done', 'ai:stream:error',
  'pdf:progress', 'embed:progress', 'server:players-changed'])
const unused = [...registered.keys()]
  .filter(c => !invoked.has(c) && !listened.has(c) && !mainOnlyEvents.has(c))
report('handlers no preload path reaches (informational)', unused, false)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} problem(s)\n`)
process.exit(failures === 0 ? 0 : 1)
