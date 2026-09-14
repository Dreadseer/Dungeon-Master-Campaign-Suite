// Verification for the campaign lore index (Phase 6 task 7).
//
//   npm run test:lore
//
// Exercises electron/services/CampaignLoreIndex.js — the real class, required
// directly — against a real SQLite database built from the app's own migration
// SQL. The embedding service is stubbed, because embedding needs Ollama and the
// thing under test is the chunk bookkeeping, not the vectors.
//
// The property that matters most here is the one a unit test cannot show: that
// a re-sync rewrites only the chunks it owns and never touches an imported
// PDF's.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const CampaignLoreIndex = require('../electron/services/CampaignLoreIndex.js')

const SRC = readFileSync('electron/database/DatabaseService.js', 'utf8')

let failures = 0, checks = 0
const check = (label, ok, detail = '') => {
  checks++
  if (!ok) failures++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
  return ok
}

const sqlFor = (n) => {
  const tag = 'const MIGRATION_' + String(n).padStart(3, '0') + ' = `'
  const start = SRC.indexOf(tag) + tag.length
  return SRC.slice(start, SRC.indexOf('`', start))
}

/** A stub that records what it was asked to do. */
const stubEmbedder = () => {
  const calls = { embedSource: [], deleteChunks: [] }
  return {
    calls,
    async embedSource(sourceId) {
      calls.embedSource.push(sourceId)
      return { embedded: 0 }
    },
    async deleteChunks(ids) {
      calls.deleteChunks.push([...ids])
      return { deleted: ids.length }
    },
  }
}

/** A stub that fails the way a missing Ollama does. */
const brokenEmbedder = () => ({
  async embedSource() { throw new Error('Ollama is not running') },
  async deleteChunks() { throw new Error('Ollama is not running') },
})

const newDb = () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, run_at DATETIME DEFAULT (datetime('now')))`)
  for (const id of [1, 2, 3, 4]) {
    db.exec('PRAGMA foreign_keys = OFF')
    for (const stmt of sqlFor(id).split(';').map(s => s.trim()).filter(Boolean)) {
      try { db.exec(stmt) } catch (err) {
        if (!/duplicate column/i.test(err.message)) throw err
      }
    }
    db.exec('PRAGMA foreign_keys = ON')
  }
  return db
}

const api = (db) => ({
  get: (sql, p = []) => db.prepare(sql).get(...p),
  all: (sql, p = []) => db.prepare(sql).all(...p),
  run: (sql, p = []) => {
    const r = db.prepare(sql).run(...p)
    return { lastInsertRowid: r.lastInsertRowid, changes: r.changes }
  },
})

/** A campaign with one of each kind of entity. */
const seed = (dbApi) => {
  const c = dbApi.run(
    'INSERT INTO campaigns (name, description, world_setting) VALUES (?,?,?)',
    ['Waterdeep Nights', 'd', 'Faerûn'])
  const campaignId = Number(c.lastInsertRowid)

  dbApi.run(
    `INSERT INTO compendium_custom (campaign_id, type, name, data, source) VALUES (?,'lore',?,?,'custom')`,
    [campaignId, 'The Walking Statues',
      JSON.stringify({ content: 'They guard the city.', category: 'History', is_secret: false })])

  dbApi.run(
    'INSERT INTO npcs (campaign_id, name, race, class, role, notes, secrets, motivation, is_alive) VALUES (?,?,?,?,?,?,?,?,1)',
    [campaignId, 'Volo', 'Human', 'Bard', 'Chronicler', 'Writes guides.', '', 'Fame'])

  dbApi.run(
    'INSERT INTO locations (campaign_id, name, type, description, lore) VALUES (?,?,?,?,?)',
    [campaignId, 'Yawning Portal', 'shop', 'A tavern over a dungeon.', ''])

  dbApi.run(
    'INSERT INTO factions (campaign_id, name, description, alignment, notes) VALUES (?,?,?,?,?)',
    [campaignId, 'Harpers', 'A secret network.', 'CG', ''])

  return campaignId
}

console.log('\n  Campaign lore index — Phase 6 task 7\n')

// ── A. The sentinel source ───────────────────────────────────────────────────
console.log('=== A. The generated source ===\n')
{
  const db = newDb()
  const dbApi = api(db)
  const campaignId = seed(dbApi)
  const idx = new CampaignLoreIndex(dbApi, stubEmbedder())

  const before = idx.findSource(campaignId)
  check('no source exists before the first sync', before === null)

  await idx.sync(campaignId, 'Waterdeep Nights')
  const source = idx.findSource(campaignId)
  check('a sentinel source is created', !!source)
  check('it is named after the campaign', source?.filename === 'Campaign lore — Waterdeep Nights',
    source?.filename)
  check('it has no file_path, which is what marks it generated', source?.file_path === null)
  check('it belongs to the campaign', source?.campaign_id === campaignId)
  check('its status is indexed', source?.status === 'indexed')

  // Renaming the campaign relabels the source rather than making a second one.
  await idx.sync(campaignId, 'Waterdeep Days')
  const all = dbApi.all('SELECT * FROM pdf_sources WHERE campaign_id = ?', [campaignId])
  check('a rename relabels rather than duplicating', all.length === 1, `${all.length} source(s)`)
  check('the new name is used', all[0].filename === 'Campaign lore — Waterdeep Days')
  db.close()
}

// ── B. Chunk contents ────────────────────────────────────────────────────────
console.log('\n=== B. What gets indexed ===\n')
{
  const db = newDb()
  const dbApi = api(db)
  const campaignId = seed(dbApi)
  const idx = new CampaignLoreIndex(dbApi, stubEmbedder())
  await idx.sync(campaignId, 'Waterdeep Nights')

  const source = idx.findSource(campaignId)
  const chunks = dbApi.all('SELECT * FROM pdf_chunks WHERE source_id = ? ORDER BY chunk_index', [source.id])

  check('one chunk per entity', chunks.length === 4, `${chunks.length} chunks`)
  check('the lore entry is indexed', chunks.some(c => c.text.includes('The Walking Statues')))
  check('its body is indexed, not just the title',
    chunks.some(c => c.text.includes('They guard the city.')))
  check('the NPC is indexed', chunks.some(c => c.text.startsWith('NPC: Volo')))
  check('the location is indexed', chunks.some(c => c.text.startsWith('Location: Yawning Portal')))
  check('the faction is indexed', chunks.some(c => c.text.startsWith('Faction: Harpers')))
  check('every chunk starts unembedded', chunks.every(c => c.embedded === 0))
  check('chunk_count is recorded on the source',
    dbApi.get('SELECT chunk_count FROM pdf_sources WHERE id = ?', [source.id]).chunk_count === 4)
  db.close()
}

// ── C. Incremental re-sync ───────────────────────────────────────────────────
console.log('\n=== C. A re-sync only touches what changed ===\n')
{
  const db = newDb()
  const dbApi = api(db)
  const campaignId = seed(dbApi)
  const embedder = stubEmbedder()
  const idx = new CampaignLoreIndex(dbApi, embedder)

  const first = await idx.sync(campaignId, 'C')
  check('the first sync adds everything', first.added === 4, `added ${first.added}`)

  // Pretend the embedding succeeded, as it would with Ollama running.
  dbApi.run('UPDATE pdf_chunks SET embedded = 1 WHERE source_id = ?', [first.sourceId])

  const second = await idx.sync(campaignId, 'C')
  check('an unchanged world adds nothing', second.added === 0, `added ${second.added}`)
  check('and removes nothing', second.removed === 0, `removed ${second.removed}`)
  check('everything is reported unchanged', second.unchanged === 4)
  check('no embedding call is made when nothing changed',
    embedder.calls.embedSource.length === 1, `${embedder.calls.embedSource.length} call(s)`)

  const stillEmbedded = dbApi.all(
    'SELECT embedded FROM pdf_chunks WHERE source_id = ?', [first.sourceId])
  check('existing vectors are kept — editing one NPC must not re-embed the world',
    stillEmbedded.every(c => c.embedded === 1))

  // Edit one NPC.
  dbApi.run('UPDATE npcs SET notes = ? WHERE campaign_id = ?', ['Now writes cookbooks.', campaignId])
  const third = await idx.sync(campaignId, 'C')
  check('editing one entity adds exactly one chunk', third.added === 1, `added ${third.added}`)
  check('and drops exactly one stale chunk', third.removed === 1, `removed ${third.removed}`)
  check('the other three are untouched', third.unchanged === 3)
  check('the stale vector is deleted from the index',
    embedder.calls.deleteChunks.length === 1 && embedder.calls.deleteChunks[0].length === 1)
  check('the total stays at four', third.total === 4, `total ${third.total}`)

  // Delete an entity.
  dbApi.run('DELETE FROM factions WHERE campaign_id = ?', [campaignId])
  const fourth = await idx.sync(campaignId, 'C')
  check('deleting an entity drops its chunk', fourth.removed === 1 && fourth.total === 3,
    `removed ${fourth.removed}, total ${fourth.total}`)
  db.close()
}

// ── D. It never touches a real PDF ───────────────────────────────────────────
console.log('\n=== D. An imported PDF is left alone ===\n')
{
  const db = newDb()
  const dbApi = api(db)
  const campaignId = seed(dbApi)

  // A real imported source, with chunks.
  const pdf = dbApi.run(
    `INSERT INTO pdf_sources (campaign_id, filename, file_path, status, chunk_count)
     VALUES (?, ?, ?, 'indexed', 2)`,
    [campaignId, "Volo's Guide.pdf", 'C:/books/volo.pdf'])
  const pdfId = Number(pdf.lastInsertRowid)
  for (const [i, text] of [[0, 'Page one of the guide.'], [1, 'Page two of the guide.']]) {
    dbApi.run(
      'INSERT INTO pdf_chunks (source_id, chunk_index, page_number, text, embedded) VALUES (?,?,?,?,1)',
      [pdfId, i, i + 1, text])
  }

  const idx = new CampaignLoreIndex(dbApi, stubEmbedder())
  await idx.sync(campaignId, 'Waterdeep Nights')
  await idx.sync(campaignId, 'Waterdeep Nights')

  const found = idx.findSource(campaignId)
  check('findSource returns the sentinel, not the PDF', found.id !== pdfId && !found.file_path)

  const pdfChunks = dbApi.all('SELECT * FROM pdf_chunks WHERE source_id = ? ORDER BY chunk_index', [pdfId])
  check("the PDF's chunks survive a re-sync", pdfChunks.length === 2, `${pdfChunks.length} left`)
  check('their text is unchanged', pdfChunks[0].text === 'Page one of the guide.')
  check('their vectors are still marked embedded', pdfChunks.every(c => c.embedded === 1))
  check('the PDF source row is unchanged',
    dbApi.get('SELECT * FROM pdf_sources WHERE id = ?', [pdfId]).chunk_count === 2)

  // The guard itself.
  let threw = false
  try { idx.assertOwnSource({ id: pdfId, filename: "Volo's Guide.pdf", file_path: 'C:/books/volo.pdf' }) }
  catch { threw = true }
  check('assertOwnSource refuses a real PDF', threw)
  db.close()
}

// ── E. Degrading without Ollama ──────────────────────────────────────────────
console.log('\n=== E. It degrades rather than breaking when Ollama is absent ===\n')
{
  const db = newDb()
  const dbApi = api(db)
  const campaignId = seed(dbApi)
  const idx = new CampaignLoreIndex(dbApi, brokenEmbedder())

  let result = null
  let threw = false
  try { result = await idx.sync(campaignId, 'C') } catch { threw = true }

  check('sync does not throw when embedding fails', !threw)
  check('it reports the failure instead', !!result?.embedError, result?.embedError)
  check('the chunks are still written, so a later sync can embed them',
    result?.total === 4, `total ${result?.total}`)
  check('the rows are marked unembedded',
    dbApi.all('SELECT embedded FROM pdf_chunks WHERE source_id = ?', [result.sourceId])
      .every(c => c.embedded === 0))
  db.close()
}

// ── F. preview() ─────────────────────────────────────────────────────────────
console.log('\n=== F. preview() reports without writing ===\n')
{
  const db = newDb()
  const dbApi = api(db)
  const campaignId = seed(dbApi)
  const idx = new CampaignLoreIndex(dbApi, stubEmbedder())

  const before = idx.preview(campaignId)
  check('preview counts what would be added', before.added === 4, `added ${before.added}`)
  check('preview creates no source row', idx.findSource(campaignId) === null)

  await idx.sync(campaignId, 'C')
  const after = idx.preview(campaignId)
  check('after a sync it reports nothing to do', after.added === 0 && after.removed === 0)
  check('and reports the total indexed', after.total === 4)
  db.close()
}

// ── G. Corrupt lore blob ─────────────────────────────────────────────────────
console.log('\n=== G. A corrupt lore blob does not stop the sync ===\n')
{
  const db = newDb()
  const dbApi = api(db)
  const campaignId = seed(dbApi)
  dbApi.run(
    `INSERT INTO compendium_custom (campaign_id, type, name, data, source) VALUES (?,'lore',?,?,'custom')`,
    [campaignId, 'Broken Entry', '{not json'])

  const idx = new CampaignLoreIndex(dbApi, stubEmbedder())
  let threw = false
  let result = null
  try { result = await idx.sync(campaignId, 'C') } catch { threw = true }

  check('the sync completes', !threw)
  // The broken entry has a name but no parseable body, so it contributes only a
  // title line and is dropped — the other four still index.
  check('the healthy entities are still indexed', result?.total === 4, `total ${result?.total}`)
  db.close()
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`)
process.exit(failures === 0 ? 0 : 1)
