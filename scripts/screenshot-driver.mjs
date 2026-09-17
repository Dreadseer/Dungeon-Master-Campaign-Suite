// Documentation screenshots — Phase 9, task 4.
//
//   npm run build:renderer && npm run screenshots
//
// Seeds one realistic campaign in a scratch profile, drives the real app through
// the five views the README and docs advertise, and writes them to
// docs/screenshots/ (committed, unlike scripts/screenshots/ which is scratch):
//
//   campaign-manager.png    the campaign list with real counts
//   map-engine-fog.png      a generated dungeon, fog partly revealed, tokens on it
//   initiative-tracker.png  a fight in progress — round 2, HP spent, a condition
//   sessions.png            sessions with notes and recaps
//   rag-citation.png        a rules answer with its SRD citation
//
// The RAG shot needs the SRD seeded (one network fetch on first run) and Ollama
// for the answer. Without either, the run says which shot it could not take
// rather than committing a screenshot of an empty panel.
//
// This replaces the Phase 3 version of this file, which drove the Vite dev
// server; it now uses the same launcher as the acceptance drivers, against the
// built renderer.
import * as path from 'node:path'
import * as fs from 'node:fs'
import { launchApp, seedCampaign, ROOT } from './ui-driver.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const USER_DATA = path.join(HERE, '.shots-userdata')
const OUT = path.join(ROOT, 'docs', 'screenshots')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const G = 50
const centre = (col, row) => ({ x: col * G + G / 2, y: row * G + G / 2 })

const taken = []
const skipped = []

async function shoot(ui, name, note) {
  fs.mkdirSync(OUT, { recursive: true })
  const file = path.join(OUT, `${name}.png`)
  // Two attempts: a capture can time out while Ollama is using every core, and
  // losing a whole run to one slow PNG is the wrong trade.
  for (const attempt of [1, 2]) {
    try {
      await ui.page.screenshot({ path: file, timeout: 120000, animations: 'disabled' })
      const kb = Math.round(fs.statSync(file).size / 1024)
      taken.push(`${name}.png (${kb} KB) — ${note}`)
      console.log(`  📸 ${name}.png — ${note}`)
      return
    } catch (err) {
      if (attempt === 2) {
        skipped.push(`${name}: screenshot failed twice — ${err.message.split('\n')[0]}`)
      } else {
        console.log(`    [shot] ${name} timed out, retrying`)
        await sleep(3000)
      }
    }
  }
}

async function ollamaReady() {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { ok: false, reason: `Ollama returned ${res.status}` }
    const names = ((await res.json()).models ?? []).map(m => m.name)
    const chat = names.find(n => !/embed/i.test(n))
    return chat ? { ok: true, model: chat } : { ok: false, reason: 'Ollama has no chat model pulled' }
  } catch (err) {
    return { ok: false, reason: `Ollama unreachable (${err.message})` }
  }
}

async function main() {
  console.log('\n  Documentation screenshots\n')
  const ai = await ollamaReady()
  console.log(`    [ai] ${ai.ok ? `Ollama ready — ${ai.model}` : ai.reason}`)

  // Warm the chat model. Embedding the SRD below keeps Ollama busy for a while,
  // and a cold llama3 load can take the better part of a minute on its own —
  // which is time the rules answer would otherwise spend against its deadline.
  if (ai.ok) {
    const warmedAt = Date.now()
    await fetch('http://localhost:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ai.model, prompt: 'Say ok.', stream: false, options: { num_predict: 5 } }),
      signal: AbortSignal.timeout(180000),
    }).catch(() => {})
    console.log(`    [ai] warmed in ${Math.round((Date.now() - warmedAt) / 1000)}s`)
  }

  // DMCS_SHOTS_KEEP=1 reuses the profile from the last run, which skips the SRD
  // download and the embedding pass — several minutes, and a lot of CPU that a
  // screenshot capture has to compete with.
  const keep = process.env.DMCS_SHOTS_KEEP === '1'
  const ui = await launchApp({ userData: USER_DATA, fresh: !keep })

  const campaignId = await seedCampaign(ui, 'The Mere of Dead Men')

  // ── Seed a campaign worth photographing ──────────────────────────────────
  const seeded = await ui.page.evaluate(async (cid) => {
    const api = window.electronAPI.db

    const loc = {}
    for (const [key, name, type, description] of [
      ['town', 'Leilon', 'town', 'A rebuilt town on the High Road, wary of the marsh to its north.'],
      ['shrine', 'The Drowned Shrine', 'dungeon', 'A sunken temple in the Mere, reached only at low tide.'],
      ['shop', 'The Salted Keel', 'shop', 'Chandler, fence, and the only place in Leilon that sells rope.'],
      ['mere', 'The Mere of Dead Men', 'region', 'Salt marsh, sunken ruins, and older things beneath them.'],
    ]) {
      const r = await api.locations.create({
        campaign_id: cid, name, type, description, lore: '', parent_location_id: null,
      })
      loc[key] = Number(r.lastInsertRowid)
    }

    const factions = {}
    for (const [key, name, alignment, description] of [
      ['cult', 'The Drowned Choir', 'Neutral Evil', 'Cultists of a drowned god, growing bolder each tide.'],
      ['watch', 'Leilon Town Watch', 'Lawful Neutral', 'Twelve guards and one very tired captain.'],
    ]) {
      const r = await api.factions.create({ campaign_id: cid, name, alignment, description, notes: '' })
      factions[key] = Number(r.lastInsertRowid)
    }

    const npcs = []
    for (const [name, race, role, locationId, factionId, motivation] of [
      ['Sister Ulmarra', 'Human', 'Corrupted priest', loc.shrine, factions.cult, 'Wake the thing under the shrine.'],
      ['Captain Fendrel', 'Human', 'Watch captain', loc.town, factions.watch, 'Keep Leilon standing one more winter.'],
      ['Grell the Drowned', 'Half-Orc', 'Bog hermit', loc.mere, null, 'Be left alone.'],
      ['Mira Saltkeel', 'Halfling', 'Chandler', loc.shop, null, 'Sell everything twice.'],
    ]) {
      const r = await api.npcs.create({
        campaign_id: cid, name, race, class: '', role, location_id: locationId,
        faction_id: factionId, notes: '', secrets: '', motivation,
      })
      npcs.push(Number(r.lastInsertRowid))
    }

    const party = [
      ['Vex', 'Chris', 'Rogue', 'Elf', 5, 38, 38],
      ['Brother Arn', 'Dana', 'Cleric', 'Human', 5, 44, 44],
      ['Hrothi', 'Sam', 'Fighter', 'Dwarf', 5, 52, 52],
      ['Nissa', 'Ali', 'Wizard', 'Gnome', 5, 31, 31],
    ]
    const characterIds = []
    for (const [character_name, player_name, cls, race, level, hp_max, hp_current] of party) {
      const r = await api.characters.create({
        campaign_id: cid, character_name, player_name, class: cls, race, level, hp_max, hp_current,
        stats: { strength: 12, dexterity: 17, constitution: 14, intelligence: 12, wisdom: 13, charisma: 10 },
      })
      characterIds.push(Number(r.lastInsertRowid))
    }

    // Sessions with real notes, and plot threads at different stages.
    const sessions = []
    for (const [n, title, notes] of [
      [1, 'The road to Leilon', 'The party escorted a salt wagon up the High Road and met Captain Fendrel, who is short of guards and shorter of patience.'],
      [2, 'Low tide', 'Grell showed them the shrine steps. Nissa read the inscription aloud, which in hindsight was a mistake.'],
      [3, 'The Drowned Choir', 'Sister Ulmarra escaped through the flooded nave. The party has her ledger and a name they do not understand yet.'],
    ]) {
      const r = await api.sessions.create({ campaign_id: cid, session_number: n, title, notes, played_on: null })
      sessions.push(Number(r.lastInsertRowid))
    }
    for (const [title, description, status, opened, resolved] of [
      ['Who funds the Choir?', 'The ledger lists payments from a Waterdhavian account.', 'active', sessions[2], null],
      ['Fendrel needs guards', 'The watch is six short. He will trade favours for bodies.', 'open', sessions[0], null],
      ['The inscription', 'Nissa read it aloud. Something answered.', 'active', sessions[1], null],
      ['Missing salt wagon', 'Found, looted, driver alive.', 'resolved', sessions[0], sessions[1]],
    ]) {
      await api.plots.create({
        campaign_id: cid, title, description, status,
        opened_session_id: opened, resolved_session_id: resolved,
      })
    }

    // Monsters for the fight, as homebrew so no network is needed.
    for (const [name, cr, hp, ac] of [
      ['Drowned Thrall', 0.25, 16, 12], ['Choir Acolyte', 1, 27, 13], ['Swamp Troll', 5, 84, 15],
    ]) {
      await api.compendium.create({
        campaign_id: cid, type: 'monster', name, source: 'custom',
        data: { name, challenge_rating: cr, cr, hit_points: hp, armor_class: ac, type: 'undead' },
      })
    }

    const enc = await api.encounters.create({
      campaign_id: cid, name: 'Ambush at the flooded nave', location_id: loc.shrine,
      notes: 'They come up the steps behind the party.', xp_total: 1900,
      monsters: [
        { id: 'm1', name: 'Swamp Troll', count: 1, cr: 5, hp_max: 84, hp_current: 84, ac: 15, xp: 1800 },
        { id: 'm2', name: 'Drowned Thrall', count: 4, cr: 0.25, hp_max: 16, hp_current: 16, ac: 12, xp: 50 },
        { id: 'm3', name: 'Choir Acolyte', count: 1, cr: 1, hp_max: 27, hp_current: 27, ac: 13, xp: 200 },
      ],
    })

    return { encounterId: Number(enc.lastInsertRowid), locationId: loc.shrine, characterIds }
  }, campaignId)

  // ── 1. Campaign Manager ──────────────────────────────────────────────────
  await ui.goto('/campaigns')
  await sleep(1500)
  await ui.dismissFirstRun()
  // seedCampaign puts only the id in storage, which leaves the top bar reading
  // "No Campaign Loaded". Load it the way a DM does.
  const load = ui.page.locator('button', { hasText: 'Load Campaign' })
  if (await load.count()) { await load.first().click(); await sleep(1200) }
  await ui.goto('/campaigns')
  await sleep(1500)
  await shoot(ui, 'campaign-manager', 'the campaign list, with the world counts for each')

  // ── 2. Map Engine: a generated dungeon with fog and tokens ───────────────
  await ui.goto('/maps')
  await sleep(1200)
  await ui.dismissFirstRun()
  await ui.page.locator('[data-open-generator]').click()
  await ui.page.locator('[data-map-generator]').waitFor({ timeout: 8000 })
  await ui.page.locator('[data-field="gen-seed"]').fill('1893')
  await ui.page.locator('[data-field="gen-name"]').fill('The Flooded Nave')
  await sleep(500)
  await ui.page.locator('[data-generate]').click()
  await ui.page.locator('[data-map-generator]').waitFor({ state: 'detached', timeout: 30000 })
  await sleep(1000)

  const mapRow = await ui.page.evaluate(async (cid) =>
    (await window.electronAPI.db.maps.getAll(cid)).find(m => m.name === 'The Flooded Nave'), campaignId)

  // Party and monsters on the map, and fog revealed around them.
  await ui.page.evaluate(async ({ mapId }) => {
    const tokens = [
      { id: 't1', label: 'Vex', type: 'player', col: 7, row: 9, color: '#4A90D9' },
      { id: 't2', label: 'Arn', type: 'player', col: 6, row: 10, color: '#4A90D9' },
      { id: 't3', label: 'Hrothi', type: 'player', col: 8, row: 10, color: '#4A90D9' },
      { id: 't4', label: 'Nissa', type: 'player', col: 6, row: 8, color: '#4A90D9' },
      { id: 't5', label: 'Troll', type: 'monster', col: 12, row: 9, color: '#D0021B' },
      { id: 't6', label: 'Thrall', type: 'monster', col: 13, row: 11, color: '#D0021B' },
      { id: 't7', label: 'Ulmarra', type: 'npc', col: 15, row: 8, color: '#F5A623' },
    ]
    await window.electronAPI.db.maps.updateTokens(mapId, tokens)
  }, { mapId: mapRow.id })

  // Leave and come back so the map list re-reads the row the tokens were just
  // written to. Opening it straight away uses the row the list loaded when the
  // generator saved — with no tokens on it.
  await ui.goto('/calculator')
  await sleep(600)
  await ui.goto('/maps')
  await sleep(1200)
  await ui.dismissFirstRun()
  await ui.page.locator('button', { hasText: 'Open Map' }).first().click()
  await ui.page.locator('.konvajs-content').first().waitFor({ timeout: 10000 })
  await sleep(1200)
  await ui.clickButton('Reveal')
  await ui.page.locator('button', { hasText: '5×5' }).click()
  const box = await ui.page.locator('.konvajs-content').first().boundingBox()
  for (const [col, row] of [[7, 9], [9, 9], [11, 9], [13, 10], [7, 12], [10, 6]]) {
    const p = centre(col, row)
    await ui.page.mouse.click(box.x + p.x, box.y + p.y)
    await sleep(120)
  }
  // A DM note, so the shot shows the annotation layer too.
  await ui.page.locator('[data-tool="annotate"]').click()
  await sleep(200)
  const notePoint = centre(11, 13)
  await ui.page.mouse.click(box.x + notePoint.x, box.y + notePoint.y)
  await ui.page.locator('[data-annotation-input]').fill('Trap: collapsing floor')
  await ui.page.keyboard.press('Enter')
  await sleep(600)
  await ui.page.locator('[data-tool="measure"]').click()
  const from = centre(8, 10), to = centre(12, 9)
  await ui.page.mouse.move(box.x + from.x, box.y + from.y)
  await ui.page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await ui.page.mouse.move(box.x + from.x + ((to.x - from.x) * i) / 6, box.y + from.y + ((to.y - from.y) * i) / 6)
  }
  await ui.page.mouse.up()
  await sleep(700)
  await shoot(ui, 'map-engine-fog', 'a generated dungeon: fog partly revealed, tokens, a DM note, and the ruler')

  // ── 3. Initiative tracker, mid-fight ─────────────────────────────────────
  await ui.goto(`/encounters?open=${seeded.encounterId}`)
  await sleep(2000)
  await ui.clickButton('Start Combat')
  await sleep(1500)
  // "Start Combat" opens the setup screen; the fight begins after initiative is
  // rolled. Without these two clicks the shot is of an empty setup table.
  await ui.page.locator('button', { hasText: 'Roll All Monsters' }).first().click()
  await sleep(900)
  await ui.page.locator('button', { hasText: 'Begin Combat' }).first().click()
  await sleep(2000)
  // Round 2, with damage taken and a condition on someone.
  // Leave the encounter FIRST. The tracker saves its own state on unmount — a
  // Phase 5 feature — so patching the database while it is still mounted gets
  // overwritten the moment the page is left, and the shot shows a fresh round 1.
  await sleep(1500)
  await ui.goto('/calculator')
  await sleep(1200)

  const patched = await ui.page.evaluate(async (encounterId) => {
    const saved = await window.electronAPI.db.combat.get(encounterId)
    if (!saved) return { ok: false, why: 'nothing saved' }
    const envelope = JSON.parse(saved.combatants)
    const combatants = envelope.combatants ?? envelope
    for (const c of combatants) {
      if (c.name?.startsWith('Drowned Thrall 1')) { c.hp_current = 4 }
      if (c.name?.startsWith('Swamp Troll')) { c.hp_current = 51; c.conditions = ['Prone'] }
      if (c.name === 'Vex') { c.hp_current = 24 }
      if (c.name === 'Hrothi') { c.hp_current = 39; c.conditions = ['Poisoned'] }
    }
    await window.electronAPI.db.combat.save({
      encounter_id: encounterId,
      campaign_id: saved.campaign_id,
      round_count: 2,
      phase: saved.phase ?? 'active',
      // The envelope matters: combatPersistence stores
      // { schema_version, combatants } and a bare array is discarded on load,
      // which is why this shot was a fresh round 1 at full HP the first time.
      combatants: JSON.stringify({
        schema_version: envelope.schema_version ?? 1,
        combatants,
      }),
      log_entries: JSON.stringify({
        schema_version: envelope.schema_version ?? 1,
        log_entries: [
          { round: 1, text: 'Vex opens with a sneak attack on the acolyte — 17 damage.' },
          { round: 1, text: 'The troll knocks Hrothi prone and bites: 12 damage.' },
          { round: 2, text: 'Nissa casts grease. The troll falls.' },
        ],
      }),
    })
    const after = await window.electronAPI.db.combat.get(encounterId)
    const back = JSON.parse(after.combatants).combatants ?? []
    return {
      ok: after.round_count === 2 && back.some(c => c.hp_current < c.hp_max),
      round: after.round_count,
      wounded: back.filter(c => c.hp_current < c.hp_max).map(c => `${c.name} ${c.hp_current}/${c.hp_max}`),
    }
  }, seeded.encounterId)
  console.log(`    [combat] round ${patched?.round}, wounded: ${(patched?.wounded ?? []).join(', ') || 'none'}`)
  if (!patched?.ok) skipped.push('initiative-tracker: the mid-fight state did not save — the shot is of a fresh fight')
  // Now mount the tracker again: it loads the patched fight from the database.
  await ui.goto(`/encounters?open=${seeded.encounterId}`)
  await sleep(2500)
  await ui.dismissFirstRun()
  await shoot(ui, 'initiative-tracker', 'a fight in round 2 — initiative order, HP spent, conditions, and the log')

  // ── 4. Sessions ──────────────────────────────────────────────────────────
  await ui.goto('/world/sessions')
  await sleep(1800)
  await ui.dismissFirstRun()
  await sleep(400)
  await shoot(ui, 'sessions', 'the session history, with the notes each one left behind')

  // ── 5. Rules Q&A with a citation ─────────────────────────────────────────
  //
  // The SRD is seeded LAST, not first: indexing and embedding 900 entries keeps
  // every core busy for a while, and a screenshot taken during it times out.
  // (It did, for all four shots above, which is why this moved down here.)
  const srd = await ui.page.evaluate(async () => {
    try {
      await window.electronAPI.srd.seedAll()
      let status = await window.electronAPI.srd.getIndexStatus()
      if ((status?.chunks ?? 0) === 0) {
        await window.electronAPI.srd.buildIndex()
        status = await window.electronAPI.srd.getIndexStatus()
      }
      return { ok: (status?.chunks ?? 0) > 0, cached: status?.srdCached ?? 0, chunks: status?.chunks ?? 0 }
    } catch (err) {
      return { ok: false, reason: String(err?.message ?? err) }
    }
  })
  console.log(`    [srd] ${srd.ok ? `${srd.cached} entries cached, ${srd.chunks} indexed for rules Q&A` : srd.reason}`)


  if (!srd.ok) {
    skipped.push(`rag-citation: the SRD could not be seeded or indexed — ${srd.reason}`)
  } else if (!ai.ok) {
    skipped.push(`rag-citation: ${ai.reason} — a grounded answer needs a model`)
  } else {
    await ui.goto('/ai')
    await sleep(1500)
    await ui.dismissFirstRun()
    // Rules Q&A is the toggle in the toolbox; it only enables once there is a
    // corpus to retrieve from.
    // Toasts stack in the top-right corner, which is where this toggle lives, so
    // a real click can land on a notification from the SRD seed instead. Give
    // them time to clear, then dispatch on the button itself.
    await sleep(6000)
    const toggle = ui.page.locator('button', { hasText: /^(OFF|ON)$/ }).first()
    if (await toggle.count() && (await toggle.textContent())?.trim() === 'OFF') {
      await toggle.evaluate(el => el.click())
      await sleep(600)
    }
    const state = (await toggle.textContent())?.trim()
    if (state !== 'ON') {
      skipped.push(`rag-citation: the Rules Q&A toggle would not turn on (reads "${state}")`)
    } else {
      // A question the SRD index can answer. The index covers monsters, spells,
      // equipment and classes — the API exposes no rules-chapter text — so
      // "how does grappling work" honestly retrieves nothing, and the model
      // says so. That limitation is in the README; it is not a screenshot.
      await ui.page.locator('textarea').first()
        .fill("What is a goblin's armour class, and what does its scimitar do?")
      await sleep(200)
      await ui.page.locator('button', { hasText: /^Ask$/ }).first().click()
      // A cold local model can take a couple of minutes on the first call.
      const startedAt = Date.now()
      // Wait for the citation toggle, which only appears on an answer that came
      // back with sources. Waiting for the text "SRD 5.1" instead depended on
      // the MODEL happening to name the source in its prose — which it did once,
      // in an answer that said it could not find anything.
      const sources = ui.page.locator('button, summary', { hasText: /Sources \(\d+\)/ })
      const answered = await sources.first().waitFor({ timeout: 240000 })
        .then(() => true).catch(() => false)
      await sleep(800)
      // Expand it: collapsed, the shot shows no citation at all.
      if (answered) { await sources.first().click(); await sleep(900) }
      if (answered) {
        await shoot(ui, 'rag-citation',
          `a rules answer grounded in the SRD, with its citations (${Math.round((Date.now() - startedAt) / 1000)}s)`)
      } else {
        skipped.push(`rag-citation: no cited answer appeared within 240 s (Ollama ${ai.model})`)
      }
    }
  }

  // ── Report ───────────────────────────────────────────────────────────────
  console.log(`\n  ${taken.length} screenshot(s) written to docs/screenshots:\n`)
  for (const t of taken) console.log(`    ${t}`)
  if (skipped.length) {
    console.log(`\n  ${skipped.length} NOT taken:\n`)
    for (const s of skipped) console.log(`    ${s}`)
  }
  const errors = ui.consoleErrors.filter(e => !/net::ERR_|Failed to load resource/.test(e))
  if (errors.length) console.log(`\n  renderer console errors: ${errors.slice(0, 3).join(' | ')}`)
  console.log()

  await ui.close()
  process.exit(skipped.length === 0 ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
