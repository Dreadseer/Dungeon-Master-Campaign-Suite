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

  // ══ L4: the dungeon generator — seed 42 twice ═════════════════════════════
  async function generate(name, seed) {
    await ui.page.locator('[data-open-generator]').click()
    await ui.page.locator('[data-map-generator]').waitFor({ timeout: 5000 })
    await ui.page.locator('[data-field="gen-seed"]').fill(String(seed))
    await ui.page.locator('[data-field="gen-name"]').fill(name)
    await sleep(400)
    const summaryText = await ui.page.locator('[data-generator-summary]').textContent()
    const shot = await ui.screenshot(`m07-generator-${name.replace(/\W+/g, '-').toLowerCase()}`)
    const startedAt = Date.now()
    await ui.page.locator('[data-generate]').click()
    await ui.page.locator('[data-map-generator]').waitFor({ state: 'detached', timeout: 30000 })
    await sleep(600)
    const row = await ui.page.evaluate(async ({ cid, n }) =>
      (await window.electronAPI.db.maps.getAll(cid)).find(m => m.name === n), { cid: campaignId, n: name })
    return { row, summaryText, shot, ms: Date.now() - startedAt }
  }

  const pngInfo = (file) => {
    const buf = fs.readFileSync(file)
    return {
      sha: createHash('sha256').update(buf).digest('hex'),
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      bytes: buf.length,
    }
  }

  await ui.page.locator('button', { hasText: '← Maps' }).first().click()
  await sleep(800)
  const genA = await generate('Seed 42 A', 42)
  const genB = await generate('Seed 42 B', 42)
  const genC = await generate('Seed 43', 43)

  const fileA = genA.row && fs.existsSync(genA.row.image_path) ? pngInfo(genA.row.image_path) : null
  const fileB = genB.row && fs.existsSync(genB.row.image_path) ? pngInfo(genB.row.image_path) : null
  const fileC = genC.row && fs.existsSync(genC.row.image_path) ? pngInfo(genC.row.image_path) : null

  record('Generate seed 42 twice → identical images',
    fileA && fileB && fileA.sha === fileB.sha && genA.row.image_path !== genB.row.image_path ? 'PASS' : 'FAIL',
    fileA && fileB
      ? `two separate files, sha256 ${fileA.sha.slice(0, 16)}… both, ${fileA.bytes} bytes, generated in ${genA.ms} ms`
      : 'an image file is missing',
    genA.shot)
  record('…and a different seed gives a different image (the comparison can fail)',
    fileA && fileC && fileA.sha !== fileC.sha ? 'PASS' : 'FAIL',
    fileC ? `seed 43 sha256 ${fileC.sha.slice(0, 16)}…` : 'seed 43 image missing', genC.shot)

  const paramsA = JSON.parse(genA.row?.generated_params ?? 'null')
  record('The generated map is saved with its grid, fog_cols and parameters set to match',
    fileA && fileA.width === 2000 && fileA.height === 1500 && genA.row.grid_size === 50 &&
    genA.row.fog_cols === 40 && paramsA?.kind === 'dungeon' && paramsA.seed === 42 &&
    genA.row.image_path.includes('maps') ? 'PASS' : 'FAIL',
    `${fileA?.width}×${fileA?.height} px, grid ${genA.row?.grid_size}, fog_cols ${genA.row?.fog_cols}, params ${genA.row?.generated_params}`)

  // Fog and tokens on the generated map. Aim at a real room, taken from the same
  // generator the app used.
  const { generateDungeon } = await import('../src/utils/dungeonGen.js')
  const room = generateDungeon(paramsA).rooms[0]

  await openMapByName(ui, 'Seed 42 A')
  await ui.clickButton('Reveal')
  await ui.page.locator('button', { hasText: '3×3' }).click()
  const roomAt = await toScreen(ui, centre(room.cx, room.cy))
  await ui.page.mouse.click(roomAt.x, roomAt.y)
  await sleep(1100)
  const genFog = await getMap(ui, genA.row.id)
  const genMask = JSON.parse(genFog.fog_data)
  const genPainted = genMask.filter(v => v === true).length
  record('Fog paints correctly on the generated map',
    genMask.length === 40 * 30 && genPainted === 9 && genMask[room.cy * 40 + room.cx] === true ? 'PASS' : 'FAIL',
    `mask ${genMask.length} cells (want 1200), ${genPainted} revealed around room 1's centre (${room.cx},${room.cy})`)

  // Token: double-click deliberately OFF the cell centre, then drag it and
  // release off-centre again. Both must land on whole cells.
  await ui.clickButton('Token')
  const offCentre = await toScreen(ui, { x: room.cx * G + 7, y: room.cy * G + 43 })
  await ui.page.mouse.dblclick(offCentre.x, offCentre.y)
  await ui.page.locator('input[placeholder="Goblin, Aria, Chest…"]').fill('Goblin')
  await ui.page.locator('button', { hasText: 'Place Token' }).click()
  await sleep(900)
  const placed = JSON.parse((await getMap(ui, genA.row.id)).tokens)[0]

  const tokenScreen = await toScreen(ui, centre(room.cx, room.cy))
  const dropAt = await toScreen(ui, { x: (room.cx + 2) * G + 44, y: (room.cy + 1) * G + 3 })
  await ui.page.mouse.move(tokenScreen.x, tokenScreen.y)
  await ui.page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await ui.page.mouse.move(tokenScreen.x + ((dropAt.x - tokenScreen.x) * i) / 10, tokenScreen.y + ((dropAt.y - tokenScreen.y) * i) / 10)
  }
  await ui.page.mouse.up()
  await sleep(900)
  const moved = JSON.parse((await getMap(ui, genA.row.id)).tokens)[0]
  const shotTokens = await ui.screenshot('m08-generated-fog-and-token')
  record('Tokens snap to the generated grid — placed and dragged from off-centre points',
    placed && placed.col === room.cx && placed.row === room.cy &&
    moved && moved.col === room.cx + 2 && moved.row === room.cy + 1 ? 'PASS' : 'FAIL',
    `placed at (${placed?.col},${placed?.row}) want (${room.cx},${room.cy}); dragged to (${moved?.col},${moved?.row}) want (${room.cx + 2},${room.cy + 1})`,
    shotTokens)

  // ══ L5: grid change on a map with fog — clear, then keep ══════════════════
  await ui.clickButton('Pan')
  const gridPlus = ui.page.locator('button[title="Increase grid size"]')
  const gridSave = ui.page.locator('button', { hasText: /^Save$/ })

  await gridPlus.click()   // 50 → 55: 2000/55 → 37 cols, 1500/55 → 28 rows
  await gridSave.click()
  const dialogShown = await ui.page.locator('[data-grid-change-dialog]').isVisible({ timeout: 4000 }).catch(() => false)
  const shotDialog = await ui.screenshot('m09-grid-change-dialog')
  await ui.page.locator('[data-grid-change-dialog] button', { hasText: 'Clear fog' }).click()
  await sleep(900)
  const cleared55 = await getMap(ui, genA.row.id)
  const clearedMask = JSON.parse(cleared55.fog_data)
  record('Change grid size on a map with fog → the clear-or-keep dialog appears',
    dialogShown ? 'PASS' : 'FAIL', dialogShown ? 'shown' : 'no dialog', shotDialog)
  record('Choosing "Clear" clears the fog and records the new fog_cols',
    cleared55.grid_size === 55 && cleared55.fog_cols === 37 && clearedMask.length === 37 * 28 &&
    clearedMask.every(v => v === false) ? 'PASS' : 'FAIL',
    `grid ${cleared55.grid_size}, fog_cols ${cleared55.fog_cols}, mask ${clearedMask.length} cells, ${clearedMask.filter(Boolean).length} revealed`)

  // Paint at 55px, then change to 60px and keep.
  await ui.clickButton('Reveal')
  const paintPx = { x: room.cx * G + G / 2, y: room.cy * G + G / 2 }   // a pixel inside room 1
  const paintAt = await toScreen(ui, paintPx)
  await ui.page.mouse.click(paintAt.x, paintAt.y)
  await sleep(1100)
  const before60 = await getMap(ui, genA.row.id)
  const painted55 = JSON.parse(before60.fog_data).filter(Boolean).length

  await ui.clickButton('Pan')
  await gridPlus.click()   // 55 → 60: 2000/60 → 34 cols, 1500/60 → 25 rows
  await gridSave.click()
  await ui.page.locator('[data-grid-change-dialog]').waitFor({ timeout: 4000 }).catch(() => {})
  await ui.page.locator('[data-grid-change-dialog] button', { hasText: 'Keep fog' }).click()
  await sleep(900)
  const kept60 = await getMap(ui, genA.row.id)
  const keptMask = JSON.parse(kept60.fog_data)
  const keptCell = keptMask[Math.floor(paintPx.y / 60) * 34 + Math.floor(paintPx.x / 60)]
  const shotKept = await ui.screenshot('m10-grid-change-kept')
  record('Choosing "Keep" keeps the fog, rescaled, and fog_cols updates',
    kept60.grid_size === 60 && kept60.fog_cols === 34 && keptMask.length === 34 * 25 &&
    keptMask.filter(Boolean).length > 0 && keptCell === true ? 'PASS' : 'FAIL',
    `grid ${kept60.grid_size}, fog_cols ${kept60.fog_cols} (was 37), mask ${keptMask.length} cells, ` +
    `${keptMask.filter(Boolean).length} revealed (${painted55} before), the painted pixel is ${keptCell ? 'still revealed' : 'NOT revealed'}`,
    shotKept)

  // ══ L6: Re-roll and Tweak reuse the stored parameters ═════════════════════
  await ui.page.locator('button', { hasText: '← Maps' }).first().click()
  await sleep(900)
  await ui.page.locator(`[data-tweak="${genB.row.id}"]`).click()
  await ui.page.locator('[data-map-generator]').waitFor({ timeout: 5000 })
  const tweakSeed = await ui.page.locator('[data-field="gen-seed"]').inputValue()
  const tweakName = await ui.page.locator('[data-field="gen-name"]').inputValue()
  await ui.page.locator('[data-map-generator] button', { hasText: 'Cancel' }).click()
  await ui.page.locator(`[data-reroll="${genB.row.id}"]`).click()
  await ui.page.locator('[data-map-generator]').waitFor({ timeout: 5000 })
  const rerollSeed = await ui.page.locator('[data-field="gen-seed"]').inputValue()
  const shotReroll = await ui.screenshot('m11-reroll')
  await ui.page.locator('[data-map-generator] button', { hasText: 'Cancel' }).click()
  record('Tweak reopens the generator with the stored seed; Re-roll with a new one',
    tweakSeed === '42' && tweakName === 'Seed 42 B (tweaked)' && rerollSeed !== '42' && rerollSeed !== '' ? 'PASS' : 'FAIL',
    `Tweak seed ${tweakSeed} name "${tweakName}"; Re-roll seed ${rerollSeed}`, shotReroll)

  // ══ Console ════════════════════════════════════════════════════════════════
  const errors = ui.consoleErrors.filter(e => !/net::ERR_|Failed to load resource/.test(e))
  record('No unexpected renderer console errors', errors.length === 0 ? 'PASS' : 'FAIL',
    errors.length ? errors.slice(0, 3).join(' | ') : 'clean')

  await ui.close()
  process.exit(summary().fail === 0 ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
