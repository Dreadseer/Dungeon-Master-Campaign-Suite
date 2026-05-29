/**
 * Screenshot driver for DMCS — Phase 3 Prompt 02 verification
 * node scripts/screenshot-driver.mjs
 */
import { _electron as electron } from 'playwright-core'
import * as path from 'path'
import * as fs   from 'fs'
import { fileURLToPath } from 'url'

const __dirname    = path.dirname(fileURLToPath(import.meta.url))
const ROOT         = path.resolve(__dirname, '..')
const SHOTS        = path.join(__dirname, 'screenshots')
const USERDATA_DIR = path.join(__dirname, '.test-userdata')
const ELECTRON_BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

fs.mkdirSync(SHOTS, { recursive: true })

async function ss(page, name) {
  const f = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: f })
  console.log('📸', name)
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function clickBtn(page, text) {
  return page.evaluate(t => {
    const el = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === t)
    if (!el) return false
    el.click(); return true
  }, text)
}

async function waitForTopbar(page, timeout = 8000) {
  return page.waitForFunction(
    () => {
      const spans = [...document.querySelectorAll('span')]
      return spans.some(s => s.textContent?.trim() && !s.textContent?.includes('No Campaign Loaded'))
    },
    { timeout }
  ).catch(() => false)
}

// ── Launch ─────────────────────────────────────────────────────────────
console.log('Launching Electron...')
const app = await electron.launch({
  executablePath: ELECTRON_BIN,
  args: [ROOT, `--user-data-dir=${USERDATA_DIR}`],
  env: { ...process.env, NODE_ENV: 'development' },
  timeout: 30_000,
})

// Wait for main app window
let page = null
for (let i = 0; i < 20 && !page; i++) {
  await sleep(1000)
  page = app.windows().find(w => w.url().startsWith('http://localhost'))
}
page = page ?? await app.firstWindow()

await page.waitForLoadState('domcontentloaded').catch(() => {})
await page.waitForFunction(
  () => document.getElementById('root')?.children.length > 0,
  { timeout: 20_000 }
).catch(() => {})
await sleep(1500)

// Dismiss SRD modal if present
const hasSrd = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Skip for now'))
  if (btn) { btn.click(); return true }
  return false
})
if (hasSrd) { console.log('Dismissed SRD modal'); await sleep(600) }

// ── 1. Campaign Manager ───────────────────────────────────────────────
await ss(page, '01-campaign-manager')

// Create a campaign
await clickBtn(page, '+ New Campaign')
await sleep(500)

// Type name into campaign name input
await page.fill('input[placeholder*="Shattered"], input[placeholder*="Name"], input[placeholder*="name"]', 'Test Campaign')
await sleep(300)

// Submit
const submitted = await clickBtn(page, 'Create Campaign')
console.log('Submitted Create Campaign:', submitted)

// Wait for campaign to be auto-loaded (onLoad is called after create)
await waitForTopbar(page)
await sleep(800)

// ── 2. Verify campaign loaded ─────────────────────────────────────────
const topbarText = await page.evaluate(() =>
  document.querySelector('header')?.innerText ?? '(no header)'
)
console.log('Topbar:', topbarText.replace(/\n/g,' ').trim())
await ss(page, '02-campaign-loaded')

// ── 3. Navigate to Maps ───────────────────────────────────────────────
await page.evaluate(() => {
  const link = [...document.querySelectorAll('a')].find(a => a.textContent?.trim() === 'Map Engine')
  link?.click()
})
await sleep(1000)
await ss(page, '03-maps-empty')

// ── 4. Create Map modal ───────────────────────────────────────────────
await clickBtn(page, '+ New Map')
await sleep(500)
await ss(page, '04-create-map-modal')

// Fill map name using Playwright's native fill (properly triggers React state)
await page.fill('input[placeholder*="Riverdale"]', 'Test Battle Map')
await sleep(200)

await clickBtn(page, 'Create Map')
await sleep(1000)
await ss(page, '05-maps-list-with-card')

// ── 5. Open the map canvas ────────────────────────────────────────────
await clickBtn(page, 'Open Map')
await sleep(2500)   // Konva needs time to mount and paint
await ss(page, '06-map-canvas')

// Grab zoom display to verify toolbar rendered
const zoomText = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span')]
  return spans.find(s => s.textContent?.includes('%'))?.textContent ?? 'no zoom display'
})
console.log('Zoom display:', zoomText)

// Simulate wheel zoom on the canvas
await page.evaluate(() => {
  const canvas = document.querySelector('canvas')
  if (canvas) {
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -500, bubbles: true, cancelable: true, clientX: 500, clientY: 300
    }))
  }
})
await sleep(800)
await ss(page, '07-map-canvas-zoomed')

// Back to list
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('← Maps'))
  btn?.click()
})
await sleep(700)
await ss(page, '08-back-to-list')

console.log('\n✅ Done. Screenshots in:', SHOTS)
await app.close()
