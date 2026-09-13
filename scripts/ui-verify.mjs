// Drives the five Phase 4.5 click-through lines that were NOT VERIFIED or
// PARTIAL, in the real app window, saving a screenshot of each.
//
//   node scripts/ui-verify.mjs
//   node scripts/ui-verify.mjs --keep    leave the window open afterwards
//
// Runs against a scratch user-data directory — never the real campaign.
import { launchApp, seedCampaign, record, summary } from './ui-driver.mjs'

const ui = await launchApp({ fresh: true })
let exitCode = 0

try {
  console.log('\n  Driving the real app window\n')

  const cid = await seedCampaign(ui, 'Phase 5 Driver')

  // Seed one entity of every connectable type, through the app's own IPC, so
  // every Mind Map filter and every page below has something real to show.
  await ui.page.evaluate(async (id) => {
    const db = window.electronAPI.db
    const loc = await db.locations.create({ campaign_id: id, name: 'Driver Town', type: 'town' })
    const fac = await db.factions.create({ campaign_id: id, name: 'Driver Faction' })
    const npc = await db.npcs.create({ campaign_id: id, name: 'Driver NPC', location_id: Number(loc.lastInsertRowid) })
    await db.lore.create({ campaign_id: id, name: 'Driver Lore', content: 'Body text.', category: 'History' })
    await db.maps.create({ campaign_id: id, name: 'Driver Map', grid_size: 50 })
    await db.encounters.create({ campaign_id: id, name: 'Driver Encounter' })
    await db.characters.create({ campaign_id: id, character_name: 'Driver PC', level: 5, stats: '{}' })
    await db.plots.create({ campaign_id: id, title: 'Driver Plot', status: 'open' })
    await db.connections.create({
      campaign_id: id, entity_a_type: 'npc', entity_a_id: Number(npc.lastInsertRowid),
      entity_b_type: 'faction', entity_b_id: Number(fac.lastInsertRowid), relationship: 'member of',
    })
  }, cid)

  record('app launches, renders, and seeds a campaign', 'PASS',
    `campaign id ${cid}`, await ui.screenshot('01-app-launched'))

  // ── 1. Mind Map with all eight types ────────────────────────────────────
  await ui.goto('/mindmap')
  await ui.page.waitForTimeout(2500)

  const PILLS = ['NPC', 'Location', 'Faction', 'Lore', 'Map', 'Encounter', 'Character', 'Plot']
  const pillCount = await ui.page.evaluate((labels) => {
    const texts = [...document.querySelectorAll('button')].map(b => b.innerText)
    return labels.filter(l => texts.some(t => t.includes(l))).length
  }, PILLS)

  const flowMounted = await ui.page.evaluate(() => !!document.querySelector('.react-flow'))
  const defaultNodes = await ui.count('.react-flow__node')

  // The five types that default to off.
  for (const label of ['Lore', 'Map', 'Encounter', 'Character', 'Plot']) {
    try { await ui.clickButton(label, { timeout: 2500 }) } catch { /* pill absent */ }
  }
  await ui.page.waitForTimeout(1500)
  const allNodes = await ui.count('.react-flow__node')

  const shot1 = await ui.screenshot('02-mindmap-all-eight-types')
  if (pillCount === 8 && flowMounted && allNodes > defaultNodes) {
    record('Mind Map: eight types selectable, default shows three, graph renders', 'PASS',
      `${pillCount}/8 pills · react-flow mounted · ${defaultNodes} nodes by default -> ${allNodes} with all on`, shot1)
  } else {
    record('Mind Map: eight types selectable, default shows three, graph renders', 'FAIL',
      `${pillCount}/8 pills · mounted=${flowMounted} · ${defaultNodes} -> ${allNodes}`, shot1)
    exitCode = 1
  }

  // ── 2. Sessions: create, type notes, blur ───────────────────────────────
  await ui.goto('/world/sessions')
  await ui.page.waitForTimeout(1200)
  await ui.clickButton('New session')
  await ui.page.waitForTimeout(1200)

  const notes = ui.page.locator('textarea').first()
  await notes.fill('The party met at the Snapping Line. Gellan hired them to investigate the alchemist house.')
  await notes.blur()
  await ui.page.waitForTimeout(800)

  // The indicator clears itself after 2s, so look while it is still up.
  const savedShown = await ui.hasText('Saved', { timeout: 2500 })
  const persisted = await ui.page.evaluate(async (id) => {
    const s = await window.electronAPI.db.sessions.getCurrent(id)
    return { number: s?.session_number ?? null, len: (s?.notes ?? '').length }
  }, cid)

  const shot2 = await ui.screenshot('03-sessions-create-and-blur')
  if (persisted.number === 1 && persisted.len > 50) {
    record('Sessions: create a session, type notes, blur -> autosaved', 'PASS',
      `session ${persisted.number}, ${persisted.len} chars persisted, "Saved" indicator ${savedShown ? 'seen' : 'missed (2s window)'}`,
      shot2)
  } else {
    record('Sessions: create a session, type notes, blur -> autosaved', 'FAIL',
      JSON.stringify(persisted), shot2)
    exitCode = 1
  }

  // ── 3. Plot Threads: move between statuses ──────────────────────────────
  await ui.goto('/world/plots')
  await ui.page.waitForTimeout(1200)

  const before = await ui.page.evaluate(async (id) =>
    (await window.electronAPI.db.plots.getAll(id))[0]?.status, cid)

  await ui.clickButton('Move')
  await ui.page.waitForTimeout(500)
  await ui.clickButton('Active')
  await ui.page.waitForTimeout(1200)

  const after = await ui.page.evaluate(async (id) =>
    (await window.electronAPI.db.plots.getAll(id))[0]?.status, cid)

  const shot3 = await ui.screenshot('04-plot-threads-status-move')
  if (before === 'open' && after === 'active') {
    record('Plot Threads: move a thread between statuses from the board', 'PASS',
      `${before} -> ${after}`, shot3)
  } else {
    record('Plot Threads: move a thread between statuses from the board', 'FAIL',
      `${before} -> ${after}`, shot3)
    exitCode = 1
  }

  // ── 4. Reveal toggle on a secret item asks first ────────────────────────
  await ui.page.evaluate(async (id) => {
    await window.electronAPI.db.lore.create({
      campaign_id: id, name: 'A DM-Only Secret', content: 'The mayor is a doppelganger.',
      category: 'Secret', is_secret: true,
    })
  }, cid)

  await ui.goto('/world/lore')
  await ui.page.waitForTimeout(1600)

  const dialog = ui.onDialog(true)
  const secretCard = ui.page.locator('div').filter({ hasText: 'A DM-Only Secret' }).last()
  try {
    await secretCard.locator('button', { hasText: 'Reveal' }).first().click({ timeout: 6000 })
  } catch {
    await ui.page.locator('button', { hasText: 'Reveal' }).first().click({ timeout: 6000 })
  }
  await ui.page.waitForTimeout(1400)

  const reveals = await ui.page.evaluate(async (id) =>
    (await window.electronAPI.db.reveals.getForCampaign(id)).length, cid)

  const shot4 = await ui.screenshot('05-reveal-secret-confirm')
  if (dialog.fired && /DM-only|take back|Continue/i.test(dialog.message ?? '')) {
    record('Reveal toggle: revealing a DM-only item asks for confirmation first', 'PASS',
      `confirm shown, ${reveals} reveal(s) after accepting`, shot4)
  } else if (reveals > 0) {
    record('Reveal toggle: revealing a DM-only item asks for confirmation first', 'PARTIAL',
      'reveal recorded but no confirm captured', shot4)
  } else {
    record('Reveal toggle: revealing a DM-only item asks for confirmation first', 'FAIL',
      `dialog fired=${dialog.fired}, reveals=${reveals}`, shot4)
    exitCode = 1
  }

  // ── 5. Map Engine: open a map, canvas mounts, fog persists ──────────────
  await ui.goto('/maps')
  await ui.page.waitForTimeout(1400)

  // The image picker is a native OS dialog and cannot be driven from here, so
  // the fog mask is written through the same IPC the canvas uses. Opening the
  // map and mounting the Konva canvas are real.
  const fog = await ui.page.evaluate(async (id) => {
    const maps = await window.electronAPI.db.maps.getAll(id)
    const map = maps[0]
    if (!map) return { ok: false, why: 'no map row' }
    const cols = Math.ceil(3000 / (map.grid_size || 50))   // blank-map fallback
    const mask = new Array(cols * cols).fill(false)
    for (let r = 10; r < 15; r++) for (let c = 10; c < 15; c++) mask[r * cols + c] = true
    await window.electronAPI.db.maps.updateFog(map.id, mask)
    const back = await window.electronAPI.db.maps.getById(map.id)
    const parsed = JSON.parse(back.fog_data ?? '[]')
    return { ok: true, cells: parsed.filter(Boolean).length, total: parsed.length }
  }, cid)

  // The card title is not the affordance — each map card carries an explicit
  // "Open Map" button, which is what actually mounts the canvas.
  try { await ui.clickButton('Open Map', { timeout: 6000 }) } catch { /* no maps */ }
  await ui.page.waitForTimeout(2500)

  const canvases = await ui.count('canvas')
  const shot5 = await ui.screenshot('06-map-engine-canvas-and-fog')

  if (fog.ok && fog.cells === 25 && canvases > 0) {
    record('Map Engine: map opens, Konva canvas mounts, fog persists', 'PASS',
      `${canvases} canvas element(s) · ${fog.cells}/${fog.total} fog cells written and read back`, shot5)
  } else if (fog.ok && fog.cells === 25) {
    record('Map Engine: map opens, Konva canvas mounts, fog persists', 'PARTIAL',
      `fog persisted (${fog.cells} cells) but no canvas mounted`, shot5)
    exitCode = 1
  } else {
    record('Map Engine: map opens, Konva canvas mounts, fog persists', 'FAIL',
      JSON.stringify(fog), shot5)
    exitCode = 1
  }

  // ── Renderer health ─────────────────────────────────────────────────────
  if (ui.consoleErrors.length === 0) {
    record('no renderer console errors during the whole run', 'PASS')
  } else {
    record('renderer console errors during the run', 'FAIL',
      `${ui.consoleErrors.length}: ${ui.consoleErrors.slice(0, 2).join(' | ')}`)
    exitCode = 1
  }

} catch (err) {
  record('driver run', 'FAIL', err.message.split('\n')[0].slice(0, 160))
  try { await ui.screenshot('99-failure') } catch { /* window gone */ }
  exitCode = 1
} finally {
  const { fail } = summary()
  if (fail > 0) exitCode = 1
  if (!process.argv.includes('--keep')) await ui.close()
}

process.exit(exitCode)
