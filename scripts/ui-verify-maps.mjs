// Phase 8 acceptance — maps: measurement and generation.
//
//   npm run build:renderer && npm run verify:maps
//
// Every line is driven through the built renderer in a launched Electron window
// against a scratch database (never %APPDATA%\dmcs), with a screenshot each.
// Nothing here needs a model or the network: measurement, blank maps and the
// dungeon generator are all offline features.
import * as path from 'node:path'
import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { launchApp, seedCampaign, record, summary } from './ui-driver.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const USER_DATA = path.join(HERE, '.maps-userdata')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const G = 50
const centre = (col, row) => ({ x: col * G + G / 2, y: row * G + G / 2 })

async function stageBox(ui) {
  const box = await ui.page.locator('.konvajs-content').first().boundingBox()
  if (!box) throw new Error('map stage not found')
  return box
}

// Stage coordinates → screen, assuming the view is at 100% and the origin,
// which is how a map opens.
async function toScreen(ui, p) {
  const box = await stageBox(ui)
  return { x: box.x + p.x, y: box.y + p.y }
}

async function drag(ui, from, to, { shift = false } = {}) {
  const a = await toScreen(ui, from)
  const b = await toScreen(ui, to)
  if (shift) await ui.page.keyboard.down('Shift')
  await ui.page.mouse.move(a.x, a.y)
  await ui.page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await ui.page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8)
  }
  await ui.page.mouse.up()
  if (shift) await ui.page.keyboard.up('Shift')
  await sleep(250)
}

const measureLabel = (ui) => ui.page.locator('[data-measure-label]').first().textContent()

const getMap = (ui, id) => ui.page.evaluate((mapId) => window.electronAPI.db.maps.getById(mapId), id)

async function openMapByName(ui, name) {
  // A map opens inside the /maps route, so navigating to #/maps while one is
  // open fires no hashchange and changes nothing. Leave through the app's own
  // back button, which also reloads the list.
  const back = ui.page.locator('button', { hasText: '← Maps' })
  if (await back.count()) await back.first().click()
  else await ui.goto('/maps')
  await sleep(900)
  const card = ui.page.locator('div', { has: ui.page.locator('span', { hasText: new RegExp(`^${name}$`) }) })
    .filter({ has: ui.page.locator('button', { hasText: 'Open Map' }) }).last()
  await card.locator('button', { hasText: 'Open Map' }).click()
  await ui.page.locator('.konvajs-content').first().waitFor({ timeout: 10000 })
  await sleep(900)
}

async function main() {
  console.log('\n  Phase 8 acceptance — maps: measurement and generation\n')

  const ui = await launchApp({ userData: USER_DATA, fresh: true })
  const campaignId = await seedCampaign(ui, 'Off the Map')

  // ══ L1: measurement ═══════════════════════════════════════════════════════
  // A blank 20x15 map with two tokens three squares apart on the diagonal.
  const measureMapId = await ui.page.evaluate(async (cid) => {
    const r = await window.electronAPI.db.maps.create({
      campaign_id: cid, name: 'Ruler Field', grid_size: 50, image_path: null,
      generated_params: { kind: 'blank', cols: 20, rows: 15 },
    })
    const id = Number(r.lastInsertRowid)
    await window.electronAPI.db.maps.updateTokens(id, [
      { id: 'pc', label: 'Vex', type: 'player', col: 2, row: 2, color: '#4A90D9' },
      { id: 'foe', label: 'Ogre', type: 'monster', col: 5, row: 5, color: '#D0021B' },
    ])
    return id
  }, campaignId)

  await openMapByName(ui, 'Ruler Field')
  await ui.page.locator('[data-tool="measure"]').click()
  await sleep(300)

  await drag(ui, centre(2, 2), centre(5, 5))
  const diag = (await measureLabel(ui))?.trim()
  const shot1 = await ui.screenshot('m01-measure-diagonal')
  record('Measure two tokens 3 squares apart diagonally → 15 ft',
    /^15 ft\b/.test(diag ?? '') ? 'PASS' : 'FAIL', `label "${diag}"`, shot1)

  const afterMeasure = JSON.parse((await getMap(ui, measureMapId)).tokens)
  const ogre = afterMeasure.find(t => t.id === 'foe')
  record('Measuring from a token does not move it',
    ogre && ogre.col === 5 && ogre.row === 5 ? 'PASS' : 'FAIL',
    ogre ? `Ogre still at (${ogre.col},${ogre.row})` : 'token missing')

  // Shift-drag adds a leg from where the last one ended.
  await drag(ui, centre(5, 5), centre(5, 9), { shift: true })
  const chained = (await measureLabel(ui))?.trim()
  const shot2 = await ui.screenshot('m02-measure-chained')
  record('Shift-drag chains a second leg and sums grid distance',
    /^35 ft \(2 legs\)/.test(chained ?? '') ? 'PASS' : 'FAIL', `label "${chained}"`, shot2)

  await ui.page.keyboard.press('Escape')
  await sleep(200)
  const cleared = (await measureLabel(ui))?.trim()
  record('Escape clears the ruler', cleared === '' ? 'PASS' : 'FAIL', `label "${cleared}"`)

  // A 10 ft map measures at 10 ft a square.
  await ui.page.evaluate((id) => window.electronAPI.db.maps.update(id, { name: 'Ruler Field', grid_size: 50, feet_per_cell: 10 }), measureMapId)
  await openMapByName(ui, 'Ruler Field')
  await ui.page.locator('[data-tool="measure"]').click()
  await drag(ui, centre(2, 2), centre(5, 5))
  const tenFt = (await measureLabel(ui))?.trim()
  record('feet_per_cell scales the answer (10 ft squares → 30 ft)',
    /^30 ft\b/.test(tenFt ?? '') ? 'PASS' : 'FAIL', `label "${tenFt}"`)

  // ══ L2: a blank map, created through the modal ═════════════════════════════
  await ui.page.locator('button', { hasText: '← Maps' }).first().click()
  await sleep(800)
  await ui.page.locator('button', { hasText: '+ New Map' }).first().click()
  await ui.page.locator('input[placeholder="Riverdale Town Square"]').fill('Blank Hall')
  await ui.page.locator('[data-background="blank"]').click()
  await ui.page.locator('[data-field="cols"]').fill('24')
  await ui.page.locator('[data-field="rows"]').fill('16')
  const shotModal = await ui.screenshot('m03-blank-map-modal')
  await ui.page.locator('button', { hasText: 'Create Map' }).click()
  await sleep(1200)

  const blankRow = await ui.page.evaluate(async (cid) =>
    (await window.electronAPI.db.maps.getAll(cid)).find(m => m.name === 'Blank Hall'), campaignId)
  const blankParams = blankRow ? JSON.parse(blankRow.generated_params ?? 'null') : null
  record('"Blank grid" creates a map with no image, sized in squares',
    blankRow && blankRow.image_path === null && blankParams?.kind === 'blank' &&
    blankParams.cols === 24 && blankParams.rows === 16 && blankRow.fog_cols === 24 ? 'PASS' : 'FAIL',
    blankRow ? `image_path=${blankRow.image_path} params=${blankRow.generated_params} fog_cols=${blankRow.fog_cols}` : 'no row',
    shotModal)

  await openMapByName(ui, 'Blank Hall')
  // Reveal a 3x3 block centred on (4,4) and check the mask is sized to the blank
  // map (24x16 = 384), not the 3000px fallback (60x60 = 3600).
  await ui.clickButton('Reveal')
  await ui.page.locator('button', { hasText: '3×3' }).click()
  const revealAt = await toScreen(ui, centre(4, 4))
  await ui.page.mouse.click(revealAt.x, revealAt.y)
  await sleep(1100)
  const blankFog = await getMap(ui, blankRow.id)
  const blankMask = JSON.parse(blankFog.fog_data)
  const painted = blankMask.filter(v => v === true).length
  const shotBlank = await ui.screenshot('m04-blank-map-fog')
  record('Fog paints on a blank map against its own grid, not the 3000px fallback',
    blankMask.length === 24 * 16 && painted === 9 && blankMask[4 * 24 + 4] === true && blankFog.fog_cols === 24 ? 'PASS' : 'FAIL',
    `mask ${blankMask.length} cells (want 384), ${painted} revealed, (4,4)=${blankMask[4 * 24 + 4]}, fog_cols=${blankFog.fog_cols}`,
    shotBlank)

  // ══ L3: DM annotations — saved, and never drawn in player view ════════════
  await ui.page.locator('[data-tool="annotate"]').click()
  await sleep(200)
  const labelAt = await toScreen(ui, { x: 12 * G, y: 3 * G })
  await ui.page.mouse.click(labelAt.x, labelAt.y)
  await ui.page.locator('[data-annotation-input]').fill('Secret door behind the tapestry')
  await ui.page.keyboard.press('Enter')
  await sleep(600)

  await ui.page.locator('[data-annotation-kind="rect"]').click()
  await drag(ui, { x: 2 * G, y: 9 * G }, { x: 7 * G, y: 13 * G })
  await sleep(600)

  const notes = JSON.parse((await getMap(ui, blankRow.id)).annotations ?? '[]')
  const dmCount = await ui.page.locator('[data-annotation-count]').first().textContent()
  const shotNotes = await ui.screenshot('m05-annotations-dm')
  record('A label and a box are saved to maps.annotations and drawn for the DM',
    notes.length === 2 && notes.some(n => n.kind === 'text' && n.text === 'Secret door behind the tapestry') &&
    notes.some(n => n.kind === 'rect' && n.width === 250 && n.height === 200) && dmCount === '2' ? 'PASS' : 'FAIL',
    `${notes.length} saved (${notes.map(n => n.kind).join(', ')}), ${dmCount} drawn`, shotNotes)

  await ui.page.locator('button', { hasText: '👁 Player' }).click()
  await sleep(500)
  const playerCount = await ui.page.locator('[data-annotation-count]').first().textContent()
  const shotPlayer = await ui.screenshot('m06-annotations-player-view')
  record('Player view draws no annotations', playerCount === '0' ? 'PASS' : 'FAIL',
    `${playerCount} drawn in player view (2 stored)`, shotPlayer)
  await ui.page.locator('button', { hasText: '🎲 DM' }).click()
  await sleep(300)

  // ══ Console ════════════════════════════════════════════════════════════════
  const errors = ui.consoleErrors.filter(e => !/net::ERR_|Failed to load resource/.test(e))
  record('No unexpected renderer console errors', errors.length === 0 ? 'PASS' : 'FAIL',
    errors.length ? errors.slice(0, 3).join(' | ') : 'clean')

  await ui.close()
  process.exit(summary().fail === 0 ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
