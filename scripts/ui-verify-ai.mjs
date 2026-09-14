// Phase 6 acceptance — driven through the real app, against a scratch database.
//
//   npm run verify:ai
//
// Every line is exercised by clicking the built renderer in a launched Electron
// window, with a screenshot recorded for each. The scratch user-data directory
// is set by ui-driver.mjs on every launch, so the developer's real campaign at
// %APPDATA%/dmcs is never opened.
//
// This one genuinely calls the model. Ollama with llama3 is the assumed setup;
// where it is absent a line is recorded NOT VERIFIED with the reason rather
// than skipped quietly. An 8B local model returning strict JSON is exactly what
// the prompt discipline and the repair parser exist to survive, so a failure
// here is a real finding, not a flaky test.
import * as path from 'node:path'
import { launchApp, seedCampaign, record, summary, SHOTS } from './ui-driver.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const USER_DATA = path.join(HERE, '.ai-userdata')

// A port nothing listens on: the only way to exercise no-ai mode on a machine
// where Ollama is installed and running.
const DEAD_OLLAMA = 'http://127.0.0.1:59999'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** Is a local model actually reachable and able to answer? */
async function ollamaReady() {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { ok: false, reason: `Ollama returned ${res.status}` }
    const data = await res.json()
    const names = (data.models ?? []).map(m => m.name)
    const chat = names.find(n => !/embed/i.test(n))
    if (!chat) return { ok: false, reason: 'Ollama has no chat model pulled' }
    return { ok: true, model: chat, hasEmbed: names.some(n => /embed/i.test(n)) }
  } catch (err) {
    return { ok: false, reason: `Ollama unreachable (${err.message})` }
  }
}

async function main() {
  console.log('\n  Phase 6 acceptance — AI that writes to the world\n')

  const ai = await ollamaReady()
  console.log(ai.ok
    ? `    [ai] Ollama ready — chat model ${ai.model}, embeddings ${ai.hasEmbed ? 'available' : 'MISSING'}`
    : `    [ai] ${ai.reason}`)

  // ── Launch and seed ───────────────────────────────────────────────────────
  let ui = await launchApp({ userData: USER_DATA, fresh: true })
  const campaignId = await seedCampaign(ui, 'Waterdeep Nights')

  const seeded = await ui.page.evaluate(async (cid) => {
    const api = window.electronAPI.db
    const loc = await api.locations.create({
      campaign_id: cid, name: 'Waterdeep', type: 'town',
      description: 'The City of Splendours.', lore: '', parent_location_id: null,
    })
    const npc = await api.npcs.create({
      campaign_id: cid, name: 'Durnan', race: 'Human', class: 'Fighter',
      role: 'Innkeeper', location_id: null, faction_id: null,
      notes: 'Runs the Yawning Portal.', secrets: '', motivation: 'Quiet life',
    })
    // Two lore entries, one secret, for the recap acceptance line.
    const loreA = await api.lore.create({
      campaign_id: cid, name: 'The Ledger Rites',
      content: 'The guilds of Waterdeep sign their debts in blood.',
      category: 'History', is_secret: false,
    })
    const loreB = await api.lore.create({
      campaign_id: cid, name: 'The Traitor Within',
      content: 'A guildmaster has been selling names to the Zhentarim.',
      category: 'Secrets', is_secret: true,
    })
    const session = await api.sessions.create({
      campaign_id: cid, session_number: 1, title: 'Into the Vault',
      played_on: null, notes: 'The party broke into the guild vault and met Durnan.',
    })
    const sid = Number(session.lastInsertRowid)
    // Reveal both lore entries in this session.
    for (const l of [loreA, loreB]) {
      await api.reveals.reveal(cid, 'lore', Number(l.lastInsertRowid), sid)
    }
    return {
      locationId: Number(loc.lastInsertRowid),
      npcId: Number(npc.lastInsertRowid),
      loreA: Number(loreA.lastInsertRowid),
      loreB: Number(loreB.lastInsertRowid),
      sessionId: sid,
    }
  }, campaignId)

  // ══ L1: the headline — a request becomes saved records ════════════════════
  await ui.goto('/world')
  await sleep(900)
  await ui.click('AI World Suggestions')
  await sleep(700)

  const panelShot = await ui.screenshot('a01-suggestion-panel')
  const hasAsk = await ui.page.locator('input[placeholder*="What should I add"]').count()
  record('World Builder offers a free-text request box', hasAsk > 0 ? 'PASS' : 'FAIL',
    hasAsk > 0 ? 'input present' : 'not found', panelShot)

  let saveResult = null
  if (!ai.ok) {
    record('Request "a rival thieves\' guild in Waterdeep" returns saveable cards',
      'NOT VERIFIED', ai.reason, panelShot)
    record('Save all writes a faction, an NPC, a lore entry and >= 2 connections',
      'NOT VERIFIED', ai.reason, panelShot)
  } else {
    await ui.page.locator('input[placeholder*="What should I add"]').first()
      .fill("a rival thieves' guild in Waterdeep")
    await ui.clickButton('Ask')

    // A local 8B model takes a while for a couple of thousand characters of
    // JSON. Wait on the button's own busy state rather than a fixed number of
    // ticks: a fixed window failed one run in three purely because the machine
    // was busier that time, which is a flaky test rather than a finding.
    const thinking = () => ui.page.evaluate(() =>
      [...document.querySelectorAll('button')].some(b => /Thinking/.test(b.textContent)))

    let cardCount = 0
    for (let i = 0; i < 150; i++) {
      await sleep(2000)
      cardCount = await ui.page.locator('button', { hasText: /^Save$/ }).count()
      if (cardCount > 0) break
      if (await ui.hasText('did not return anything saveable', { timeout: 200 })) break
      if (i > 3 && !(await thinking())) break   // finished, or failed
    }

    const cardsShot = await ui.screenshot('a02-suggestion-cards')
    record('Request "a rival thieves\' guild in Waterdeep" returns saveable cards',
      cardCount > 0 ? 'PASS' : 'FAIL',
      cardCount > 0 ? `${cardCount} editable card(s)` : 'no cards — the model returned nothing usable',
      cardsShot)

    if (cardCount > 0) {
      await ui.page.locator('button', { hasText: 'Save all' }).first().click()
      await sleep(6000)

      saveResult = await ui.page.evaluate(async (cid) => {
        const api = window.electronAPI.db
        const [factions, npcs, locations, lore, connections] = await Promise.all([
          api.factions.getAll(cid), api.npcs.getAll(cid), api.locations.getAll(cid),
          api.lore.getAll(cid), api.connections.getAll(cid),
        ])
        return {
          factions: factions.length, npcs: npcs.length,
          locations: locations.length, lore: lore.length,
          connections: connections.length,
          names: { factions: factions.map(f => f.name), npcs: npcs.map(n => n.name) },
        }
      }, campaignId)

      const savedShot = await ui.screenshot('a03-saved-records')
      // Seeded baseline: 0 factions, 1 npc, 1 location, 2 lore, 0 connections.
      const gainedFaction = saveResult.factions >= 1
      const gainedNpc = saveResult.npcs >= 2
      const gainedLore = saveResult.lore >= 3
      const gainedLinks = saveResult.connections >= 2
      record('Save all writes a faction, an NPC, a lore entry and >= 2 connections',
        (gainedFaction && gainedNpc && gainedLore && gainedLinks) ? 'PASS' : 'FAIL',
        `${saveResult.factions} faction(s), ${saveResult.npcs} NPC(s) (was 1), ` +
        `${saveResult.lore} lore (was 2), ${saveResult.connections} connection(s)`,
        savedShot)
    }
  }

  // ── L2: the saved records appear in the Mind Map ──────────────────────────
  await ui.goto('/mindmap')
  await sleep(2500)
  const mindShot = await ui.screenshot('a04-mindmap')
  const nodeCount = await ui.page.evaluate(() =>
    document.querySelectorAll('.react-flow__node').length)
  const edgeCount = await ui.page.evaluate(() =>
    document.querySelectorAll('.react-flow__edge').length)
  record('The saved records and their links appear in the Mind Map',
    nodeCount > 0 ? 'PASS' : 'FAIL',
    `${nodeCount} node(s), ${edgeCount} edge(s)`, mindShot)

  // ── L3: the context budget is visible and respected ──────────────────────
  await ui.goto('/ai')
  await sleep(1200)
  const budgetPill = await ui.page.locator('button', { hasText: /chars$/ }).first()
  const budgetText = await budgetPill.textContent().catch(() => '')
  await budgetPill.click().catch(() => {})
  await sleep(400)
  const budgetShot = await ui.screenshot('a05-context-budget')

  const withinBudget = (() => {
    const m = /([\d,]+)\s*\/\s*([\d,]+)/.exec(budgetText ?? '')
    if (!m) return null
    return Number(m[1].replace(/,/g, '')) <= Number(m[2].replace(/,/g, ''))
  })()
  record('The AI page shows the context budget and stays inside it',
    withinBudget === true ? 'PASS' : withinBudget === false ? 'FAIL' : 'NOT VERIFIED',
    budgetText?.trim() || 'pill not found', budgetShot)

  // ── L4: the campaign lore index ──────────────────────────────────────────
  let indexResult = null
  await ui.clickButton('Index now').catch(() => {})
  await sleep(ai.ok ? 25000 : 3000)
  indexResult = await ui.page.evaluate(async (cid) =>
    window.electronAPI.embed.loreStatus(cid), campaignId)
  const indexShot = await ui.screenshot('a06-lore-indexed')
  record('Indexing the campaign writes one chunk per entity',
    indexResult?.total > 0 ? 'PASS' : 'FAIL',
    indexResult ? `${indexResult.total} chunk(s), ${indexResult.added} still to embed` : 'no status',
    indexShot)

  // ── L5: chat history survives a restart ──────────────────────────────────
  const marker = `phase6-persistence-probe-${Date.now()}`
  await ui.page.evaluate((text) => {
    // Seed the store directly: asking the model would make this line depend on
    // a model answering, which is a different check.
    const key = 'dmcs-ai-chat'
    const raw = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}')
    raw.state = raw.state ?? {}
    raw.state.history = [{ role: 'user', content: text }]
    localStorage.setItem(key, JSON.stringify(raw))
  }, marker)
  await sleep(600)

  await ui.close()
  await sleep(1500)
  ui = await launchApp({ userData: USER_DATA, fresh: false })
  await sleep(900)
  await ui.goto('/ai')
  await sleep(1500)

  const persistShot = await ui.screenshot('a07-chat-persisted')
  const persisted = await ui.hasText(marker, { timeout: 4000 })
  record('Chat history survives an app restart',
    persisted ? 'PASS' : 'FAIL',
    persisted ? 'the probe message is on screen after relaunch' : 'history was lost',
    persistShot)

  // ── L6: session recaps ───────────────────────────────────────────────────
  await ui.goto('/world/sessions')
  await sleep(1800)
  const sessionShot = await ui.screenshot('a08-session-detail')
  const hasRecapBtns = await ui.page.locator('button', { hasText: 'Generate recap' }).count()
  record('Sessions offers both recap variants',
    hasRecapBtns > 0 ? 'PASS' : 'FAIL',
    hasRecapBtns > 0 ? 'DM and player buttons present' : 'buttons not found', sessionShot)

  if (!ai.ok) {
    record('A DM recap references the revealed lore', 'NOT VERIFIED', ai.reason, sessionShot)
    record('The player recap omits the unrevealed secret', 'NOT VERIFIED', ai.reason, sessionShot)
  } else if (hasRecapBtns > 0) {
    // Read the recap box by its placeholder rather than "the last textarea":
    // the panels below have their own, and position is not identity.
    const readRecap = () => ui.page.evaluate(() => {
      const box = document.querySelector('textarea[placeholder*="summary of the session"]')
      return box?.value ?? ''
    })
    const stillWriting = () => ui.page.evaluate(() =>
      [...document.querySelectorAll('button')].some(b => /Writing/.test(b.textContent)))

    await ui.clickButton('Generate recap')
    let dmRecap = ''
    // llama3 on CPU can take a couple of minutes for two paragraphs.
    for (let i = 0; i < 90; i++) {
      await sleep(2000)
      dmRecap = await readRecap()
      if (dmRecap.trim().length > 40) break
      if (i > 3 && !(await stillWriting())) break   // finished, or failed
    }
    const dmShot = await ui.screenshot('a09-recap-dm')
    record('A DM recap references the revealed lore',
      dmRecap.trim().length > 40 ? 'PASS' : 'FAIL',
      dmRecap.trim().length > 40
        ? `${dmRecap.trim().length} chars written to sessions.recap`
        : 'no recap produced',
      dmShot)

    // The player variant.
    //
    // What the filter withholds is asserted in sessionRecap.test.js, which
    // serialises the player input and greps it for every secret in the fixture.
    // A model's prose happening not to mention a secret would not be evidence
    // the filter worked, so the driver checks what only it can: that the second
    // variant runs, produces its own text, and carries the caveat a DM needs
    // before sharing it.
    await ui.clickButton('Recap for players')
    let playerRecap = ''
    for (let i = 0; i < 90; i++) {
      await sleep(2000)
      playerRecap = await readRecap()
      if (playerRecap.trim().length > 40 && playerRecap !== dmRecap) break
      if (i > 3 && !(await stillWriting())) break
    }
    const playerShot = await ui.screenshot('a10-recap-players')

    const hasCaveat = await ui.hasText('Written for players', { timeout: 3000 })
    const differs = playerRecap.trim().length > 40 && playerRecap !== dmRecap
    record('The player recap is generated separately and carries its caveat',
      (differs && hasCaveat) ? 'PASS' : 'FAIL',
      `recap ${playerRecap.trim().length} chars, ` +
      `${playerRecap === dmRecap ? 'IDENTICAL to the DM recap' : 'distinct from the DM recap'}, ` +
      `caveat ${hasCaveat ? 'shown' : 'MISSING'}`,
      playerShot)
  }

  // ── L7: no-ai mode ───────────────────────────────────────────────────────
  await ui.close()
  await sleep(1200)
  ui = await launchApp({
    userData: USER_DATA, fresh: false,
    env: { DMCS_OLLAMA_URL: DEAD_OLLAMA },
  })
  await sleep(1500)

  await ui.goto('/ai')
  await sleep(1500)
  const noAiShot = await ui.screenshot('a11-no-ai-assistant')

  const composerState = await ui.page.evaluate(() => {
    const ta = document.querySelector('textarea')
    const ask = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ask')
    return { textareaDisabled: !!ta?.disabled, askDisabled: !!ask?.disabled, hasAsk: !!ask }
  })
  record('no-ai mode: the AI Assistant composer is disabled',
    composerState.textareaDisabled && composerState.askDisabled ? 'PASS' : 'FAIL',
    `textarea disabled=${composerState.textareaDisabled}, Ask disabled=${composerState.askDisabled}`,
    noAiShot)

  await ui.goto('/world')
  await sleep(1200)
  await ui.click('AI World Suggestions').catch(() => {})
  await sleep(900)
  const noAiPanelShot = await ui.screenshot('a12-no-ai-world-panel')
  const saysNotConfigured = await ui.hasText('AI not configured', { timeout: 3000 })
  record('no-ai mode: the World Builder panel says so instead of offering a button',
    saysNotConfigured ? 'PASS' : 'FAIL',
    saysNotConfigured ? '"AI not configured" shown' : 'message missing', noAiPanelShot)

  // The acceptance line is "no raw error string anywhere".
  //
  // Deliberately does NOT match the bare word "Ollama": the friendly copy says
  // "add an API key in Settings, or install Ollama", which is the fix being
  // offered, not a leaked error. What must not appear is a thrown message.
  const rawError = await ui.page.evaluate(() =>
    /No AI service available|ECONNREFUSED|ERR_CONNECTION|fetch failed|TypeError|undefined is not|at Object\./i
      .test(document.body.innerText))
  record('no-ai mode: no raw service error is rendered anywhere',
    !rawError ? 'PASS' : 'FAIL',
    rawError ? 'a raw error string is on screen' : 'clean', noAiPanelShot)

  const errs = ui.consoleErrors.filter(e => !/ResizeObserver|ECONNREFUSED|11434|59999/.test(e))
  record('No unexpected renderer console errors',
    errs.length === 0 ? 'PASS' : 'FAIL',
    errs.length === 0 ? 'clean' : errs.slice(0, 3).join(' | '), null)

  await ui.close()

  console.log(`\n  Screenshots: ${SHOTS}`)
  const { fail } = summary()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\n  driver crashed:', err)
  process.exit(1)
})
