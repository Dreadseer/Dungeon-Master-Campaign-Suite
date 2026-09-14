// UI driver — launches the real Electron app and drives its window.
//
//   node scripts/ui-driver.mjs            run the built-in scenarios
//   node scripts/ui-driver.mjs --keep     leave the app open at the end
//   node scripts/ui-driver.mjs --headed   (default) the window is visible either way
//
// Also importable: `import { launchApp } from './ui-driver.mjs'` gives the same
// helpers to a scenario file of your own.
//
// WHY THIS EXISTS
// Phases 0-4 shipped a lot of UI that was never rendered once. Phase 4.5 tried to
// click through it and could not: the computer-use tooling resolves applications
// by installed or running name, and a dev-mode Electron app matches none of them.
// Playwright's Electron support attaches to the process directly, which sidesteps
// that entirely — and playwright-core is already a devDependency, so this needs
// no new package.
//
// SAFETY
// Every launch sets DMCS_USER_DATA to a scratch directory. The developer's real
// campaign at %APPDATA%/dmcs must never be opened by a driver run, and the only
// way to guarantee that is to always pass the override.
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const existsSyncSafe = (p) => { try { return fs.existsSync(p) } catch { return false } }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SHOTS = path.join(HERE, 'screenshots')
const DEFAULT_USER_DATA = path.join(HERE, '.ui-userdata')

// ── Result recording ─────────────────────────────────────────────────────────
const results = []
export const record = (line, status, detail = '', shot = null) => {
  results.push({ line, status, detail, shot })
  const colour = status === 'PASS' ? '\x1b[32m' : status === 'FAIL' ? '\x1b[31m' : '\x1b[33m'
  console.log(`  ${colour}${status.padEnd(12)}\x1b[0m ${line}${detail ? ' — ' + detail : ''}${shot ? `  [${shot}]` : ''}`)
}

export function summary() {
  const pass = results.filter(r => r.status === 'PASS').length
  const fail = results.filter(r => r.status === 'FAIL').length
  const other = results.length - pass - fail
  console.log(`\n  ${pass} PASS · ${fail} FAIL · ${other} other  (of ${results.length})\n`)
  console.log('  For BUILD_STATUS.md:\n')
  for (const r of results) {
    console.log(`  | ${r.line} | **${r.status}** | ${r.detail || '—'} | ${r.shot ? '`' + r.shot + '.png`' : '—'} |`)
  }
  console.log()
  return { pass, fail, other, results }
}

/**
 * Launch the app against a scratch user-data directory.
 *
 * @param {object} opts
 *   userData  — directory to use (default scripts/.ui-userdata)
 *   fresh     — wipe it first, so the run starts from an empty database
 *   env       — extra environment variables
 */
export async function launchApp(opts = {}) {
  const userData = path.resolve(opts.userData ?? DEFAULT_USER_DATA)

  if (opts.fresh !== false) {
    // A driver run should be reproducible. Leaving yesterday's rows behind makes
    // a failure depend on what the last run happened to create.
    fs.rmSync(userData, { recursive: true, force: true })
  }
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(SHOTS, { recursive: true })

  // The driver runs against the BUILT renderer, not the Vite dev server.
  //
  // main.js loads http://localhost:5173 when NODE_ENV=development and
  // dist/renderer/index.html otherwise. Pointing the driver at the dev server
  // would mean starting Vite alongside, keeping the two in sync, and racing its
  // first compile — and it would test a bundle that never ships. Using loadFile
  // makes each run self-contained and exercises the real production path.
  const bundle = path.join(ROOT, 'dist', 'renderer', 'index.html')
  if (!existsSyncSafe(bundle)) {
    throw new Error('dist/renderer is missing — run `npm run build:renderer` before the driver.')
  }

  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: {
      ...process.env,
      // Deliberately NOT development — see above.
      NODE_ENV: opts.dev ? 'development' : 'production',
      // The guard that keeps the real campaign safe. main.js reads this before
      // any app.getPath('userData') call.
      DMCS_USER_DATA: userData,
      // Electron's own sandbox warnings are noise in a driver log.
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      ...(opts.env ?? {}),
    },
    timeout: 60000,
  })

  // Surface main-process output — an exception there is usually the real cause
  // of a renderer that never finishes loading.
  app.process().stdout?.on('data', d => {
    const s = String(d).trim()
    if (s) console.log('    [main]', s.split('\n').slice(0, 3).join(' | ').slice(0, 200))
  })
  app.process().stderr?.on('data', d => {
    const s = String(d).trim()
    if (s && !/DevTools|Autofill|ExperimentalWarning/.test(s)) {
      console.log('    \x1b[31m[main:err]\x1b[0m', s.split('\n')[0].slice(0, 200))
    }
  })

  const page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')

  // domcontentloaded is not enough: the preload bridge and the React root both
  // land after it, and a page.evaluate that runs first sees window.electronAPI
  // as undefined. Wait for the contract the helpers depend on.
  await page.waitForFunction(() => !!window.electronAPI?.db, null, { timeout: 30000 })
  await page.waitForFunction(() => !!document.querySelector('#root')?.firstElementChild, null, { timeout: 30000 })
  .catch(() => { /* some routes render nothing until a campaign exists */ })

  // Renderer console errors are worth seeing; React throws them rather than
  // crashing, so a page can look blank with the reason only in the console.
  const consoleErrors = []
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text()
      if (!/Autofill|DevTools|favicon/.test(t)) consoleErrors.push(t.slice(0, 200))
    }
  })
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message.slice(0, 200)}`))

  const api = {
    app,
    page,
    userData,
    consoleErrors,

    /** Navigate by hash route (the app uses HashRouter). */
    async goto(hash) {
      const target = hash.startsWith('#') ? hash : `#${hash}`
      await page.evaluate(h => { window.location.hash = h }, target)
      await page.waitForTimeout(400)
      return api
    },

    /** Click by visible text, or by selector when it starts with a sigil. */
    async click(what, { timeout = 8000, exact = false } = {}) {
      const locator = /^[.#\[]/.test(what)
        ? page.locator(what)
        : page.getByText(what, { exact }).first()
      await locator.click({ timeout })
      await page.waitForTimeout(250)
      return api
    },

    /** Click a <button> whose text contains `text`. */
    async clickButton(text, { timeout = 8000 } = {}) {
      await page.locator('button', { hasText: text }).first().click({ timeout })
      await page.waitForTimeout(250)
      return api
    },

    async fill(selector, value, { timeout = 8000 } = {}) {
      await page.locator(selector).first().fill(value, { timeout })
      return api
    },

    /** Fill the input/textarea nearest a label's text. */
    async fillByLabel(labelText, value) {
      const input = page.locator(
        `xpath=//*[contains(normalize-space(.), ${JSON.stringify(labelText)})]/following::input[1] | ` +
        `//*[contains(normalize-space(.), ${JSON.stringify(labelText)})]/following::textarea[1]`
      ).first()
      await input.fill(value)
      return api
    },

    async expectText(text, { timeout = 8000 } = {}) {
      await page.getByText(text).first().waitFor({ state: 'visible', timeout })
      return true
    },

    async hasText(text, { timeout = 3000 } = {}) {
      try { await page.getByText(text).first().waitFor({ state: 'visible', timeout }); return true }
      catch { return false }
    },

    async count(selector) { return page.locator(selector).count() },

    /** Answer the next window.confirm / alert. Returns a probe for what it said. */
    onDialog(accept = true) {
      const seen = { fired: false, message: null }
      page.once('dialog', async (d) => {
        seen.fired = true
        seen.message = d.message()
        await (accept ? d.accept() : d.dismiss())
      })
      return seen
    },

    /**
     * Capture a screenshot, never failing the run over it.
     *
     * A shot taken while the app is mid-work — a local model generating, a
     * spinner animating — can exceed the default timeout, and losing a whole
     * acceptance run because one PNG was slow is the wrong trade. Animations
     * are frozen so a spinner cannot stop the page settling.
     *
     * Returns the name on success and null on failure, so the caller records
     * "no screenshot" rather than crashing.
     */
    async screenshot(name) {
      const file = path.join(SHOTS, `${name}.png`)
      try {
        await page.screenshot({ path: file, timeout: 60000, animations: 'disabled' })
        return name
      } catch (err) {
        console.log(`    \x1b[33m[shot]\x1b[0m ${name} failed: ${err.message.split('\n')[0]}`)
        return null
      }
    },

    /**
     * Clear anything a first run puts in front of the app.
     *
     * On an empty database SrdLoader shows a full-screen modal offering to fetch
     * the SRD. It is position:fixed over everything, so every click the driver
     * makes lands on the overlay instead of the page. "Skip for now (offline)"
     * dismisses it without a network fetch, which is what a driver run wants.
     */
    async dismissFirstRun() {
      try {
        await page.locator('button', { hasText: 'Skip for now' }).first().click({ timeout: 4000 })
        await page.waitForTimeout(300)
      } catch { /* already dismissed, or the SRD is cached */ }
      return api
    },

    async close() {
      try { await app.close() } catch { /* already gone */ }
    },
  }

  await api.dismissFirstRun()

  return api
}

/** Seed a campaign through the app's own IPC, so the data is real. */
export async function seedCampaign(ui, name = 'Driver Campaign') {
  const id = await ui.page.evaluate(async (campaignName) => {
    const r = await window.electronAPI.db.campaigns.create({
      name: campaignName, description: 'Created by the UI driver.', world_setting: 'Test',
    })
    return Number(r.lastInsertRowid)
  }, name)
  // Select it the way the app does, then reload so every page sees it.
  await ui.page.evaluate((campaignId) => {
    localStorage.setItem('dmcs-active-campaign', JSON.stringify({ state: { activeCampaign: { id: campaignId } }, version: 0 }))
  }, id)
  await ui.page.reload()
  await ui.page.waitForLoadState('domcontentloaded')
  await ui.page.waitForFunction(() => !!window.electronAPI?.db, null, { timeout: 30000 })
  await ui.dismissFirstRun()
  await ui.page.waitForTimeout(600)
  return id
}

export { SHOTS, ROOT }
