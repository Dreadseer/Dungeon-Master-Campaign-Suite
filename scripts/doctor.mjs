// npm run doctor — check the four things that actually stop this app starting.
//
// Every one of these cost real time during Phases 0-4.5, and every one of them
// fails in a way that points somewhere else. The native module reports a version
// number rather than "your path has spaces"; a busy port makes Electron silently
// never launch; the wrong Node version produces a rebuild that succeeds and then
// does not work. This runs in about a second and names the actual cause.
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

let problems = 0
const ok = (label, detail = '') => console.log(`  \x1b[32mOK\x1b[0m    ${label}${detail ? ' — ' + detail : ''}`)
const bad = (label, detail = '') => { problems++; console.log(`  \x1b[31mFAIL\x1b[0m  ${label}${detail ? ' — ' + detail : ''}`) }
const warn = (label, detail = '') => console.log(`  \x1b[33mWARN\x1b[0m  ${label}${detail ? ' — ' + detail : ''}`)
const fix = (lines) => lines.forEach(l => console.log(`        \x1b[36m${l}\x1b[0m`))

console.log('\n  DMCS doctor\n')

// ── 1. Node version against engines ──────────────────────────────────────────
{
  const range = pkg.engines?.node ?? '(no engines field)'
  const [major] = process.versions.node.split('.').map(Number)
  // The engines range is ">=20 <23"; parse the bounds rather than pulling in semver.
  const min = Number(/>=\s*(\d+)/.exec(range)?.[1] ?? 0)
  const max = Number(/<\s*(\d+)/.exec(range)?.[1] ?? Infinity)
  if (major >= min && major < max) {
    ok(`Node ${process.versions.node}`, `satisfies "${range}"`)
  } else {
    bad(`Node ${process.versions.node}`, `outside "${range}"`)
    fix([
      'nvm install 22 && nvm use 22',
      'Native modules are compiled per ABI. A version outside the range will',
      'build a binary Electron cannot load, or vice versa.',
    ])
  }

  // node:sqlite is needed by three of the verification harnesses.
  const [maj, min2] = process.versions.node.split('.').map(Number)
  const hasSqlite = maj > 22 || (maj === 22 && min2 >= 5)
  if (hasSqlite) ok('node:sqlite available', 'test:migrations / test:rag / test:sessions can run')
  else warn('node:sqlite missing', `Node ${process.versions.node} — those three harnesses need >= 22.5`)
}

// ── 2. The native module, on the runtime that matters ────────────────────────
{
  const electronBin = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const electronBinUnix = join(root, 'node_modules', '.bin', 'electron')
  const bin = existsSync(electronBin) ? electronBin : electronBinUnix

  if (!existsSync(bin)) {
    bad('electron not installed', 'run npm install')
  } else {
    try {
      const out = execFileSync(bin, ['-e', "require('better-sqlite3'); console.log('ok')"], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      })
      if (out.includes('ok')) ok('better-sqlite3 loads inside Electron', 'the app can open its database')
      else bad('better-sqlite3 gave no confirmation', out.trim().slice(0, 120))
    } catch (err) {
      const message = `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`
      bad('better-sqlite3 will NOT load inside Electron')
      // Verbatim, because the version numbers are the diagnosis.
      const abi = message.split('\n').filter(l => /NODE_MODULE_VERSION|was compiled against|requires/.test(l))
      if (abi.length) abi.forEach(l => console.log(`        ${l.trim()}`))
      else console.log(`        ${message.split('\n')[0]?.trim().slice(0, 160)}`)
      fix([
        'npx electron-rebuild -f -w better-sqlite3 --build-from-source',
        '',
        '--build-from-source matters: without it electron-rebuild DOWNLOADS a',
        'prebuilt binary instead of compiling, and the one it fetches can be the',
        'Node-ABI build. It then prints "Rebuild Complete" and nothing works.',
      ])
    }
  }
}

// ── 3. Path with spaces ──────────────────────────────────────────────────────
{
  if (/\s/.test(root)) {
    bad('repository path contains spaces', root)
    fix([
      'node-gyp fails on paths with spaces, so the native build cannot run here.',
      'Clone or move to a space-free path, e.g. C:\\dev\\dmcs, and reinstall.',
    ])
  } else {
    ok('repository path has no spaces', root)
  }
}

// ── 4. Ports ─────────────────────────────────────────────────────────────────
{
  const portFree = (port) => new Promise((res) => {
    const srv = createServer()
    srv.once('error', () => res(false))
    srv.once('listening', () => srv.close(() => res(true)))
    srv.listen(port, '127.0.0.1')
  })

  const ports = [
    [5173, 'Vite (DM renderer)'],
    [5174, 'Vite (player app)'],
    [3001, 'Player server'],
  ]
  for (const [port, what] of ports) {
    // eslint-disable-next-line no-await-in-loop
    if (await portFree(port)) ok(`port ${port} free`, what)
    else {
      bad(`port ${port} IN USE`, what)
      fix([
        `Something is already listening on ${port}.`,
        port === 5173
          ? 'vite.config.js sets strictPort, so `npm run dev` will now fail loudly rather than sliding to 5174 and leaving Electron waiting forever.'
          : 'Stop the other process, or expect this feature to fail to bind.',
        'Windows:  Get-NetTCPConnection -LocalPort ' + port + ' -State Listen',
      ])
    }
  }
}

// ── 5. Which database would a dev run open? ─────────────────────────────────
{
  const scratch = process.env.DMCS_USER_DATA
  if (scratch) {
    ok('DMCS_USER_DATA set', resolve(scratch))
  } else {
    warn('DMCS_USER_DATA not set', 'a dev run would open the REAL campaign database')
    fix([
      'npm run dev:scratch     # uses ./.scratch-userdata instead',
      'Use this for development. `npm run dev` opens %APPDATA%/dmcs/dmcs.db.',
    ])
  }
}

console.log(`\n  ${problems === 0 ? '\x1b[32mNo problems found.\x1b[0m' : `\x1b[31m${problems} problem(s) found.\x1b[0m`}\n`)
process.exit(problems === 0 ? 0 : 1)
