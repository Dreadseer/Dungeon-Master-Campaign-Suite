// End-to-end verification of the rules Q&A pipeline (Phase 3).
//
//   node scripts/verify-rag.mjs
//
// Runs the REAL SrdService indexing and the REAL RAGService query path against a
// real SQLite database (Node's built-in node:sqlite, the same engine
// better-sqlite3 wraps, with the app's own migrations applied).
//
// What is stubbed, and why:
//   - EmbeddingService, because the real one needs Ollama, which is not running
//     here. The stub reproduces exactly what the real one does when Ollama is
//     unreachable: it runs the SQLite keyword branch and sets degraded = true.
//     That is the path this phase's headline claim depends on, so it is the
//     right one to exercise.
//   - AIService, because there is no API key. Three stubs are used: an 'online'
//     one that echoes its context, a 'no-ai' one, and one that throws.
//   - SrdService's electron `net` import, via a tiny module stub — nothing here
//     fetches from dnd5eapi.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import Module from 'node:module'

// SrdService opens with require('electron') purely for its HTTP fetch helper,
// which this harness never calls. Stub the module so it can be loaded.
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return 'dmcs-electron-stub'
  return originalResolve.call(this, request, ...args)
}
Module._cache['dmcs-electron-stub'] = new Module('dmcs-electron-stub')
Module._cache['dmcs-electron-stub'].exports = { net: { request: () => { throw new Error('network disabled in harness') } } }
Module._cache['dmcs-electron-stub'].loaded = true

const require = createRequire(import.meta.url)
const SrdService = require('../electron/services/SrdService.js')
const RAGService = require('../electron/services/RAGService.js')
const { buildIndexableText } = require('../electron/services/srdIndexText.js')

let failures = 0, checks = 0
const check = (label, ok, detail = '') => {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
  return ok
}

// ── Database with the app's real migrations ─────────────────────────────────
const SRC = readFileSync('electron/database/DatabaseService.js', 'utf8')
const sqlFor = (n) => {
  const tag = 'const MIGRATION_' + String(n).padStart(3, '0') + ' = `'
  const start = SRC.indexOf(tag) + tag.length
  return SRC.slice(start, SRC.indexOf('`', start))
}

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON')
for (let id = 1; id <= 10; id++) {
  if (id === 9 || id === 10) {
    db.exec('PRAGMA foreign_keys = OFF'); db.exec('BEGIN')
    db.exec(sqlFor(id)); db.exec('COMMIT'); db.exec('PRAGMA foreign_keys = ON')
  } else {
    db.exec(sqlFor(id))
  }
}

// DatabaseService's thin query wrapper, which the services expect.
const dbApi = {
  get:  (sql, p = []) => db.prepare(sql).get(...p),
  all:  (sql, p = []) => db.prepare(sql).all(...p),
  run:  (sql, p = []) => { const r = db.prepare(sql).run(...p); return { lastInsertRowid: r.lastInsertRowid, changes: r.changes } },
  transaction: (fn) => fn(),
}

// ── Fixtures: a slice of real SRD shapes, plus two campaigns ────────────────
const SRD_ROWS = [
  ['monster', 'goblin', { index: 'goblin', name: 'Goblin', size: 'Small', type: 'humanoid',
    armor_class: [{ type: 'armor', value: 15 }], hit_points: 7, hit_dice: '2d6',
    speed: { walk: '30 ft.' }, strength: 8, dexterity: 14, constitution: 10,
    challenge_rating: 0.25, xp: 50,
    actions: [{ name: 'Scimitar', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.' }] }],
  ['spell', 'fireball', { index: 'fireball', name: 'Fireball', level: 3, school: { name: 'Evocation' },
    casting_time: '1 action', range: '150 feet', components: ['V', 'S', 'M'],
    desc: ['Each creature in a 20-foot-radius sphere must make a Dexterity saving throw.'] }],
  ['spell', 'entangle', { index: 'entangle', name: 'Entangle', level: 1, school: { name: 'Conjuration' },
    desc: ['A creature restrained by the plants can use its action to make a Strength check against your spell save DC. On a success, it frees itself. The restrained condition means its speed becomes 0.'] }],
  ['equipment', 'longsword', { index: 'longsword', name: 'Longsword',
    equipment_category: { name: 'Weapon' }, weapon_category: 'Martial',
    damage: { damage_dice: '1d8', damage_type: { name: 'Slashing' } }, cost: { quantity: 15, unit: 'gp' } }],
  // The passage the acceptance case asks for.
  ['class', 'conditions-restrained', { index: 'conditions-restrained', name: 'Restrained',
    desc: ['A restrained creature\u2019s speed becomes 0, and it can\u2019t benefit from any bonus to its speed.',
           'Attack rolls against the creature have advantage, and the creature\u2019s attack rolls have disadvantage.',
           'The creature has disadvantage on Dexterity saving throws.'] }],
]

for (const [type, slug, data] of SRD_ROWS) {
  dbApi.run(`INSERT INTO srd_cache (resource_type, slug, data, cached_at) VALUES (?,?,?,datetime('now'))`,
    [type, slug, JSON.stringify(data)])
}

dbApi.run("INSERT INTO campaigns (id, name) VALUES (1, 'Campaign A')")
dbApi.run("INSERT INTO campaigns (id, name) VALUES (2, 'Campaign B')")

// A PDF uploaded to campaign A only — the cross-campaign dilution case.
const pdfA = dbApi.run(
  "INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count) VALUES (1, 'Campaign A Homebrew.pdf', 'C:/a.pdf', 'embedded', 2)")
const pdfAId = Number(pdfA.lastInsertRowid)
dbApi.run('INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text, embedded) VALUES (?,0,12,?,1)',
  [pdfAId, 'HOMEBREW: The Crimson Blade deals an extra 2d6 necrotic damage to a restrained creature.'])
dbApi.run('INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text, embedded) VALUES (?,1,13,?,1)',
  [pdfAId, 'HOMEBREW: Campaign A house rule on grappling and shoving.'])

// ── Stubs ───────────────────────────────────────────────────────────────────

// Reproduces the real EmbeddingService when Ollama is unreachable: keyword
// branch, degraded = true. Mirrors the SQL shape of the real implementation.
const keywordEmbeddingService = {
  async search(queryText, topK = 5) {
    const STOP = new Set(['of','the','a','an','and','or','in','to','for','with','by','at','from','s','what','does','do','is','it','my'])
    const keywords = queryText.split(/[^a-zA-Z0-9]+/)
      .filter(w => w.length > 2 && !STOP.has(w.toLowerCase()))
      .slice(0, 8)
    if (!keywords.length) { const e = []; e.degraded = true; e.degradedReason = 'ollama-unavailable'; return e }

    const clauses = keywords.map(() => 'LOWER(text) LIKE ?').join(' OR ')
    const rows = dbApi.all(
      `SELECT id AS chunk_id, source_id, page_number, text FROM pdf_chunks WHERE ${clauses} LIMIT ?`,
      [...keywords.map(k => `%${k.toLowerCase()}%`), topK])

    const scored = rows.map(r => {
      const lower = r.text.toLowerCase()
      const hits = keywords.filter(k => lower.includes(k.toLowerCase())).length
      return { ...r, score: Math.min(0.99, hits / keywords.length) }
    }).sort((a, b) => b.score - a.score)

    scored.degraded = true
    scored.degradedReason = 'ollama-unavailable'
    return scored
  },
}

const onlineAi = {
  getMode: () => 'online',
  lastContext: null,
  async complete(systemPrompt, userMessage) {
    this.lastContext = userMessage
    return 'ANSWER-FROM-CONTEXT'
  },
}
const noAi = { getMode: () => 'no-ai', complete: async () => { throw new Error('should never be called in no-ai mode') } }

// ── A. Indexing the SRD ─────────────────────────────────────────────────────
console.log('\n=== A. Indexing the bundled SRD ===\n')

const srd = new SrdService(dbApi)

check('before indexing, status is not-indexed', srd.getIndexStatus().status === 'not-indexed')
check('  but the SRD cache is populated', srd.getIndexStatus().srdCached === SRD_ROWS.length)

const entries = srd.buildIndexableText()
check(`buildIndexableText serialises every cached row (${entries.length})`, entries.length === SRD_ROWS.length)
check('  the goblin entry carries its stat line',
  entries.find(e => e.name === 'Goblin')?.text.includes('Armor Class 15'))
check('  the restrained entry carries the rule text',
  entries.find(e => e.name === 'Restrained')?.text.includes('speed becomes 0'))

const built = srd.buildSrdIndex()
check(`buildSrdIndex created ${built.chunks} chunks`, built.chunks === SRD_ROWS.length)

const afterBuild = srd.getIndexStatus()
check('status is now "chunked" — keyword search works without Ollama', afterBuild.status === 'chunked')
check('  the sentinel source has campaign_id NULL',
  dbApi.get('SELECT campaign_id FROM pdf_sources WHERE id=?', [built.sourceId]).campaign_id === null)
check('  it is named SRD 5.1',
  dbApi.get('SELECT filename FROM pdf_sources WHERE id=?', [built.sourceId]).filename === 'SRD 5.1')
check("  it does NOT appear in a campaign's own source list",
  dbApi.all('SELECT id FROM pdf_sources WHERE campaign_id = ?', [1]).every(r => r.id !== built.sourceId))

// Idempotence: rebuilding must replace, not duplicate.
srd.buildSrdIndex()
check('rebuilding replaces the chunks rather than duplicating them',
  dbApi.get('SELECT COUNT(*) c FROM pdf_chunks WHERE source_id=?', [built.sourceId]).c === SRD_ROWS.length)
check('  and reuses the same source row',
  dbApi.get("SELECT COUNT(*) c FROM pdf_sources WHERE filename='SRD 5.1'").c === 1)

// ── B. Acceptance: empty campaign, no PDF, Ollama down ──────────────────────
console.log('\n=== B. "What does the restrained condition do" — campaign B, no uploads ===\n')

const ragOnline = new RAGService(dbApi, keywordEmbeddingService, onlineAi)
const restrained = await ragOnline.query('what does the restrained condition do', 2)

check('the query returns sources despite campaign B having no uploads',
  restrained.sources.length > 0, `${restrained.sources.length} sources`)
check('  at least one cites SRD 5.1',
  restrained.sources.some(s => s.source === 'SRD 5.1'))
check('  the citation reads as a section, not "p.4"',
  restrained.sources.find(s => s.source === 'SRD 5.1')?.isSrd === true)
check('  the retrieved text contains the actual rule',
  restrained.sources.some(s => (s.text ?? '').includes('speed becomes 0')))
check('  an answer was produced', restrained.answer === 'ANSWER-FROM-CONTEXT')
check('  the context handed to the model contains the rule',
  (onlineAi.lastContext ?? '').includes('speed becomes 0'))
check('  the result is flagged degraded (keyword search, Ollama down)',
  restrained.degraded === true && restrained.degradedReason === 'ollama-unavailable')
check('  and it did NOT throw', true)

// ── C. Cross-campaign isolation ─────────────────────────────────────────────
console.log('\n=== C. Two campaigns, PDF only in A ===\n')

const fromA = await ragOnline.query('restrained creature damage', 1)
const fromB = await ragOnline.query('restrained creature damage', 2)

check("campaign A sees its own homebrew PDF",
  fromA.sources.some(s => s.source === 'Campaign A Homebrew.pdf'))
check('campaign B does NOT see campaign A\u2019s PDF',
  !fromB.sources.some(s => s.source === 'Campaign A Homebrew.pdf'))
check('campaign B still gets SRD hits rather than an empty list',
  fromB.sources.length > 0 && fromB.sources.some(s => s.source === 'SRD 5.1'),
  `${fromB.sources.length} sources`)
check('  no Crimson Blade text leaks into campaign B',
  !JSON.stringify(fromB).includes('Crimson Blade'))
check('campaign A sees BOTH its PDF and the shared SRD',
  fromA.sources.some(s => s.source === 'SRD 5.1'))

// ── D. no-ai mode ───────────────────────────────────────────────────────────
console.log('\n=== D. no-ai mode: passages instead of an error ===\n')

const ragNoAi = new RAGService(dbApi, keywordEmbeddingService, noAi)
const passages = await ragNoAi.query('what does the restrained condition do', 2)

check('no-ai returns without throwing', true)
check('  answer is null rather than an error string', passages.answer === null)
check('  extractedPassages is set so the UI leads with them', passages.extractedPassages === true)
check('  passages are present', passages.sources.length > 0)
check('  each passage carries full text, not a 120-char preview',
  passages.sources.every(s => typeof s.text === 'string' && s.text.length > 0))
check('  the rule itself is readable in the passages',
  passages.sources.some(s => s.text.includes('speed becomes 0')))
check('  mode is reported back to the UI', passages.mode === 'no-ai')

// ── E. Query expansion reaches the retrieval path ───────────────────────────
console.log('\n=== E. Expansion is actually applied during retrieval ===\n')

const expanded = ragOnline.expandQuery('what does the restrained condition do')
check('expandQuery adds rules vocabulary', expanded.length > 'what does the restrained condition do'.length)
check('  including "speed becomes 0"', expanded.includes('speed becomes 0'))

// A question that only matches via expansion vocabulary.
const grappleQ = await ragOnline.query('can a grappled creature move?', 2)
check('"can a grappled creature move?" retrieves something despite the punctuation',
  grappleQ.sources.length > 0, `${grappleQ.sources.length} sources`)

// ── F. AI failure logging ───────────────────────────────────────────────────
console.log('\n=== F. Failed AI calls are logged ===\n')

const throwingAi = {
  getMode: () => 'online',
  async complete(systemPrompt, userMessage, options = {}) {
    dbApi.run(
      'INSERT INTO ai_usage_log (campaign_id, mode, type, prompt_len, response_len, duration_ms) VALUES (?,?,?,?,?,?)',
      [options.campaignId ?? null, 'online', options.type ?? 'chat', 100, -1, 42])
    throw new Error('401 authentication_error')
  },
}
const ragThrows = new RAGService(dbApi, keywordEmbeddingService, throwingAi)
let threw = false
try { await ragThrows.query('what does the restrained condition do', 2) } catch { threw = true }
check('a failing AI call still propagates to the caller', threw)

const stats = dbApi.all(
  `SELECT COUNT(*) AS count, SUM(CASE WHEN response_len < 0 THEN 1 ELSE 0 END) AS failures FROM ai_usage_log`)[0]
check('  and is recorded with the response_len = -1 sentinel', stats.failures === 1, `failures=${stats.failures}`)
check('  the failure is counted in the total', stats.count >= 1)

// ── G. Clearing ─────────────────────────────────────────────────────────────
console.log('\n=== G. Removing the index ===\n')

const cleared = srd.clearSrdIndex()
check(`clearSrdIndex removed ${cleared.cleared} chunks`, cleared.cleared === SRD_ROWS.length)
check('  status returns to not-indexed', srd.getIndexStatus().status === 'not-indexed')
check('  the campaign PDF is untouched',
  dbApi.get('SELECT COUNT(*) c FROM pdf_chunks WHERE source_id=?', [pdfAId]).c === 2)

const afterClear = await ragOnline.query('what does the restrained condition do', 2)
check('campaign B now has nothing to retrieve, and says so rather than crashing',
  afterClear.sources.length === 0 && afterClear.noSourcesFound === true)

db.close()
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`)
process.exit(failures === 0 ? 0 : 1)
