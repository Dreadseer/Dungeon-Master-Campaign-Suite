// End-to-end verification of the player server's security posture (Phase 2).
//
//   node scripts/verify-player-server.mjs
//
// This starts a REAL PlayerServer on a real port with a stub database and makes
// real HTTP requests against it. Nothing is mocked on the server side: Express,
// the auth middleware, the CORS policy, the campaign scoping and the fog filter
// all run exactly as they do in the app.
//
// PlayerServer only touches `electron` inside _notifyDM (socket lifecycle) and
// in the production branch of _getPlayerBundlePath, so NODE_ENV=development
// keeps this runnable under bare node.
process.env.NODE_ENV = 'development'

import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'

const require = createRequire(import.meta.url)
const PlayerServer = require('../electron/server/PlayerServer.js')

let failures = 0
let checks = 0
const check = (label, ok, detail = '') => {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
  return ok
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// A real 1000x800 PNG header on disk, so imageSize measures a real file and the
// grid works out to 20 x 16 = 320 cells.
const tmp = mkdtempSync(joinPath(tmpdir(), 'dmcs-verify-'))
const imagePath = joinPath(tmp, 'town.png')
{
  const buf = Buffer.alloc(24)
  buf.writeUInt32BE(0x89504e47, 0); buf.writeUInt32BE(0x0d0a1a0a, 4)
  buf.writeUInt32BE(13, 8); buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(1000, 16); buf.writeUInt32BE(800, 20)
  writeFileSync(imagePath, buf)
}

const NUM_COLS = 20, NUM_ROWS = 16
const fogMask = new Array(NUM_COLS * NUM_ROWS).fill(false)
fogMask[5 * NUM_COLS + 5] = true          // one revealed cell, at (5,5)

const TOKENS = [
  { id: 'tok-visible', label: 'Town Guard', type: 'npc', col: 5, row: 5 },
  { id: 'tok-hidden', label: 'Assassin in the rafters', type: 'monster', col: 15, row: 12 },
]

const CAMPAIGNS = [
  { id: 3, name: "Saltmarsh", description: 'coastal' },
  { id: 4, name: "Someone Else's Game", description: 'private' },
]

const MAPS = [
  { id: 1, campaign_id: 3, name: 'Saltmarsh Docks', grid_size: 50, image_path: imagePath,
    fog_data: JSON.stringify(fogMask), tokens: JSON.stringify(TOKENS) },
  // Map 7 belongs to campaign 4 — the exact case the brief calls out.
  { id: 7, campaign_id: 4, name: 'Other Campaign Map', grid_size: 50, image_path: imagePath,
    fog_data: JSON.stringify(fogMask), tokens: JSON.stringify(TOKENS) },
]

const CHARACTERS = [
  { id: 10, campaign_id: 3, player_name: 'Chris', character_name: 'Vex', class: 'Rogue',
    race: 'Elf', level: 5, stats: '{}', hp_current: 30, hp_max: 30,
    inventory: '[]', spell_slots: '{}', subclass_name: null },
  { id: 20, campaign_id: 4, player_name: 'Nobody', character_name: 'Secret PC', class: 'Cleric',
    race: 'Human', level: 9, stats: '{}', hp_current: 60, hp_max: 60,
    inventory: '[]', spell_slots: '{}', subclass_name: null },
]

// Phase 4: reveals, and the rows they resolve to.
const NPCS = [
  { id: 30, campaign_id: 3, name: 'Gellan Primewater', race: 'Human', class: null, role: 'Council member',
    is_alive: 1, notes: 'DM ONLY: skimming the harbour tax',
    secrets: 'DM ONLY: funds the Sea Ghosts', motivation: 'DM ONLY: greed' },
  { id: 31, campaign_id: 4, name: 'Someone Else NPC', race: 'Elf', role: 'Spy', is_alive: 1 },
]
const LOCATIONS = [
  { id: 40, campaign_id: 3, name: 'The Snapping Line', type: 'shop',
    description: 'A tackle shop on the north quay.', lore: 'DM ONLY: trapdoor to the smugglers tunnel' },
]
const FACTIONS = [
  { id: 50, campaign_id: 3, name: 'The Sea Ghosts', alignment: 'Chaotic Evil', description: 'Smugglers.' },
]
const LORE = [
  { id: 60, campaign_id: 3, name: 'The Wreck of the Emperor', type: 'lore',
    data: JSON.stringify({ content: 'A galleon lost in the shoals sixty years ago.', category: 'History', is_secret: true }) },
]
const REVEALS = [
  { entity_type: 'npc', entity_id: 30, campaign_id: 3, revealed_at: '2026-09-12 20:00:00' },
  { entity_type: 'location', entity_id: 40, campaign_id: 3, revealed_at: '2026-09-12 20:05:00' },
  { entity_type: 'lore', entity_id: 60, campaign_id: 3, revealed_at: '2026-09-12 20:10:00' },
  // Belongs to campaign 4 — must never reach a campaign-3 token.
  { entity_type: 'npc', entity_id: 31, campaign_id: 4, revealed_at: '2026-09-12 20:15:00' },
  // An entity_type this server version does not know about.
  { entity_type: 'artifact', entity_id: 70, campaign_id: 3, revealed_at: '2026-09-12 20:20:00' },
]

// Minimal stand-in for DatabaseService. Only the two methods PlayerServer uses.
const db = {
  get(sql, params = []) {
    const id = Number(params[0])
    if (/FROM campaigns/i.test(sql)) return CAMPAIGNS.find(c => c.id === id) ?? undefined
    if (/FROM maps/i.test(sql)) return MAPS.find(m => m.id === id) ?? undefined
    if (/FROM characters/i.test(sql)) return CHARACTERS.find(c => c.id === id) ?? undefined
    if (/FROM npcs/i.test(sql)) return NPCS.find(n => n.id === id) ?? undefined
    if (/FROM locations/i.test(sql)) return LOCATIONS.find(l => l.id === id) ?? undefined
    if (/FROM factions/i.test(sql)) return FACTIONS.find(f => f.id === id) ?? undefined
    if (/FROM compendium_custom/i.test(sql)) return LORE.find(l => l.id === id) ?? undefined
    return undefined
  },
  all(sql, params = []) {
    if (/FROM reveals/i.test(sql)) {
      return REVEALS.filter(r => r.campaign_id === Number(params[0]))
    }
    if (/FROM characters/i.test(sql)) {
      return CHARACTERS.filter(c => c.campaign_id === Number(params[0]))
    }
    return []
  },
}

// ── Boot ─────────────────────────────────────────────────────────────────────
const server = new PlayerServer(db)
const { port } = await server.start(31847)
const base = `http://127.0.0.1:${port}`
console.log(`\n=== Player server security verification (port ${port}) ===\n`)

const get = (pathname, { token, query, origin } = {}) => {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (origin) headers.Origin = origin
  const url = query ? `${base}${pathname}?token=${encodeURIComponent(query)}` : `${base}${pathname}`
  return fetch(url, { headers })
}

const join = async (campaignId, playerName) => {
  const res = await fetch(`${base}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaignId, playerName }),
  })
  return { status: res.status, body: await res.json() }
}

try {
  // ── A. Joining ─────────────────────────────────────────────────────────────
  console.log('A. Join is public; everything else is not\n')

  const joined = await join(3, 'Chris')
  check('POST /api/join succeeds without a token', joined.status === 200)
  check('  it returns a token and the campaign name',
    typeof joined.body.token === 'string' && joined.body.token.length > 0 &&
    joined.body.campaignName === 'Saltmarsh')
  const token = joined.body.token

  const otherJoin = await join(4, 'Someone Else')
  const otherToken = otherJoin.body.token
  check('a second player can join a different campaign', otherJoin.status === 200 && !!otherToken)
  check('  the two tokens differ', token !== otherToken)

  check('joining a campaign that does not exist is 404', (await join(999, 'Nobody')).status === 404)
  check('joining without a player name is 400', (await join(3, '   ')).status === 400)

  // ── B. The headline check from the brief ───────────────────────────────────
  console.log('\nB. GET /api/map/1 — no token, wrong campaign, right token\n')

  const noToken = await get('/api/map/1')
  check('no token -> 401', noToken.status === 401, `got ${noToken.status}`)
  check('  and no map body comes back', !(await noToken.json()).tokens)

  const badToken = await get('/api/map/1', { token: 'not-a-real-token' })
  check('an invented token -> 401', badToken.status === 401, `got ${badToken.status}`)

  // Map 7 belongs to campaign 4; this token is for campaign 3.
  const wrongCampaign = await get('/api/map/7', { token })
  check('valid token for the WRONG campaign -> 404', wrongCampaign.status === 404,
    `got ${wrongCampaign.status}`)
  check('  the response does not reveal that map 7 exists',
    !JSON.stringify(await wrongCampaign.json()).includes('Other Campaign Map'))

  const ok = await get('/api/map/1', { token })
  check('right token -> 200', ok.status === 200, `got ${ok.status}`)

  const body = await ok.json()
  const returned = JSON.parse(body.tokens)
  check('  the token on the revealed cell (5,5) IS returned',
    returned.length === 1 && returned[0].id === 'tok-visible')
  check('  the token on the unrevealed cell (15,12) is NOT returned',
    !JSON.stringify(body).includes('Assassin'))
  check('  ...checked against the whole response body, not just the tokens field',
    !JSON.stringify(body).includes('tok-hidden'))
  check('  the fog mask itself is still sent, so the client can draw fog',
    JSON.parse(body.fog_data).length === NUM_COLS * NUM_ROWS)
  check('  the rest of the map row is intact',
    body.id === 1 && body.name === 'Saltmarsh Docks' && body.grid_size === 50)

  // ── C. The token in a query string ─────────────────────────────────────────
  console.log('\nC. Query-string token (for <img> and other header-less callers)\n')

  check('?token= is accepted', (await get('/api/map/1', { query: token })).status === 200)
  check('a bad ?token= is rejected', (await get('/api/map/1', { query: 'nope' })).status === 401)

  // ── D. Every other API route ───────────────────────────────────────────────
  console.log('\nD. Scoping applies to every route, not just maps\n')

  const routes = [
    ['/api/campaign/3', '/api/campaign/4'],
    ['/api/campaign/3/characters', '/api/campaign/4/characters'],
    ['/api/character/10', '/api/character/20'],
    ['/api/map-image/1', '/api/map-image/7'],
  ]
  for (const [mine, theirs] of routes) {
    check(`GET ${mine} without a token -> 401`, (await get(mine)).status === 401)
    check(`GET ${mine} with my token -> 200`, (await get(mine, { token })).status === 200)
    check(`GET ${theirs} with my token -> 404`, (await get(theirs, { token })).status === 404)
  }

  const theirChar = await get('/api/character/20', { token })
  check("another campaign's character sheet leaks nothing",
    !JSON.stringify(await theirChar.json()).includes('Secret PC'))

  const myChars = await (await get('/api/campaign/3/characters', { token })).json()
  check('my own character list still works', myChars.length === 1 && myChars[0].character_name === 'Vex')

  // The other player's token is the mirror image.
  check('the campaign-4 token CAN read map 7', (await get('/api/map/7', { token: otherToken })).status === 200)
  check('the campaign-4 token CANNOT read map 1', (await get('/api/map/1', { token: otherToken })).status === 404)

  // ── E. CORS ────────────────────────────────────────────────────────────────
  console.log('\nE. CORS is no longer a wildcard\n')

  const evil = await get('/api/map/1', { token, origin: 'https://evil.example.com' })
  const evilAcao = evil.headers.get('access-control-allow-origin')
  check('a foreign origin gets NO Access-Control-Allow-Origin header', evilAcao === null,
    `got ${evilAcao}`)
  check('  and it is never the wildcard', evilAcao !== '*')

  const localOrigin = `http://127.0.0.1:${port}`
  const same = await get('/api/map/1', { token, origin: localOrigin })
  check('a same-origin request is echoed back exactly',
    same.headers.get('access-control-allow-origin') === localOrigin)
  check('  with Vary: Origin so caches do not cross-contaminate',
    (same.headers.get('vary') ?? '').includes('Origin'))

  const ngrok = await get('/api/map/1', { token, origin: 'https://abc-123.ngrok-free.app' })
  check('an ngrok origin is allowed — that is what the tunnel is for',
    ngrok.headers.get('access-control-allow-origin') === 'https://abc-123.ngrok-free.app')

  check('Authorization is in the allowed request headers',
    (same.headers.get('access-control-allow-headers') ?? '').includes('Authorization'))

  // ── F. Fog filtering on the broadcast path ─────────────────────────────────
  console.log('\nF. The socket broadcast path is filtered too\n')

  let emitted = null
  const realTo = server.io.to.bind(server.io)
  server.io.to = (room) => ({ emit: (type, payload) => { emitted = { room, type, payload } } })

  server.broadcast(3, 'map:update', { mapId: 1, fogData: fogMask, tokens: TOKENS })
  check('map:update is filtered before it is emitted',
    emitted?.payload?.tokens?.length === 1 && emitted.payload.tokens[0].id === 'tok-visible')
  check('  the hidden token is gone from the socket payload',
    !JSON.stringify(emitted.payload).includes('Assassin'))
  check('  it goes to the campaign room', emitted.room === 'campaign:3')

  // Broadcasting a map belonging to another campaign must withhold everything.
  server.broadcast(3, 'map:update', { mapId: 7, fogData: fogMask, tokens: TOKENS })
  check("a map:update naming another campaign's map yields no tokens",
    emitted.payload.tokens.length === 0)

  server.broadcast(3, 'session:note', { text: 'The door creaks open.' })
  check('an unrelated broadcast type passes through untouched',
    emitted.payload.text === 'The door creaks open.')
  server.io.to = realTo

  // ── H. What the party knows (Phase 4) ──────────────────────────────────────
  console.log('\nH. /api/campaign/:id/revealed\n')

  check('the revealed route needs a token',
    (await get('/api/campaign/3/revealed')).status === 401)
  check("a token for another campaign cannot read it",
    (await get('/api/campaign/4/revealed', { token })).status === 404)

  const revealedRes = await get('/api/campaign/3/revealed', { token })
  check('with the right token it returns 200', revealedRes.status === 200)
  const revealed = await revealedRes.json()
  const raw = JSON.stringify(revealed)

  check('  it returns the three resolvable reveals for this campaign',
    revealed.count === 3, `got ${revealed.count}`)
  check('  the revealed NPC is named', revealed.items.some(i => i.name === 'Gellan Primewater'))
  check('  the revealed location carries its public description',
    revealed.items.some(i => i.summary === 'A tackle shop on the north quay.'))
  check('  the revealed lore carries its body text',
    revealed.items.some(i => i.summary?.startsWith('A galleon lost in the shoals')))

  // The whole point: revealing an NPC means the party has MET them, not that
  // they have read the DM's notes.
  check("  the NPC's secrets do NOT leak", !raw.includes('funds the Sea Ghosts'))
  check("  the NPC's motivation does NOT leak", !raw.includes('DM ONLY: greed'))
  check("  the NPC's private notes do NOT leak", !raw.includes('skimming the harbour tax'))
  check("  the location's DM-only lore does NOT leak", !raw.includes('trapdoor to the smugglers tunnel'))
  check('  no field named secrets, motivation or lore appears at all',
    !/"(secrets|motivation|lore)"\s*:/.test(raw))

  check("  another campaign's reveal is not included",
    !raw.includes('Someone Else NPC'))
  check('  an unknown entity_type is skipped rather than guessed at',
    !revealed.items.some(i => i.type === 'artifact'))

  check('  an unrevealed faction does not appear',
    !raw.includes('The Sea Ghosts') || !revealed.items.some(i => i.type === 'faction'))

  // ── G. Tokens die with the server ──────────────────────────────────────────
  console.log('\nG. Session lifetime\n')
  check('the token works right up until shutdown', (await get('/api/map/1', { token })).status === 200)

} finally {
  await server.stop()
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`)
process.exit(failures === 0 ? 0 : 1)
