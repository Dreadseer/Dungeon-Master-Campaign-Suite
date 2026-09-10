# DMCS Build Status

Running log of the phased rebuild described in `docs/DMCS_Build_Plan.md`, against the findings in
`docs/DMCS_CAPABILITY_REVIEW.md`. Newest entry last. Each entry records what shipped, what changed
verdict, what was deferred, and what is still unknown.

---

## Phase 0 — Environment, test harness, repo hygiene

**Date:** 2026-09-10
**Branch:** `phase-0-foundation` (from `main` @ `08a8f94`)
**Verdict changes:** none — Phase 0 changes no application behaviour.

### What shipped

**1. Runtime pinned** — `3d3db01`
- `package.json` gains `"engines": { "node": ">=20 <23" }`; `.nvmrc` contains `20`.
- README Troubleshooting's `NODE_MODULE_VERSION` entry rewritten to explain the **cause**, not just
  the fix: `better-sqlite3` is a native module compiled against one V8 ABI, Electron 33 reports 130
  and Node 24 reports 137, `npm install` builds for Node and the `postinstall` hook rebuilds for
  Electron — which is why the same tree can work under `npm run dev` and fail under bare `node`.
  Both rebuild directions are now documented.
- The Prerequisites line that read "the Node version is *not* enforced by an `engines` field" was
  corrected.

**2. Vitest harness** — `59f88aa`
- `npm i -D vitest` (the one devDependency the phase rules permit). No runtime dependency added.
- Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
- Configured inside the existing `vite.config.js` via a `test` block rather than a second config
  file: `environment: 'node'`, `include: ['src/**/__tests__/**/*.test.js']`. Adding the block does
  not affect `vite build` (verified — see Acceptance).
- **`.npmrc` with `legacy-peer-deps=true` added.** Unrelated to Vitest, and not a change I would have
  made unprompted: `react-konva@18.2.10` declares a peer range of `konva` ^7/^8/^9 while
  `package.json` pins `konva` ^10.3.0, so **any** clean `npm install` fails with `ERESOLVE`. The
  already-installed tree violates this too (konva 10.3.0 sits next to react-konva 18.2.10 and
  works). The flag makes the existing state reproducible; it does not fix the mismatch. See Open
  Questions.

**3-5. Three test suites** — `a166d4e`
| Suite | Tests | Notes |
|-------|-------|-------|
| `src/utils/__tests__/encounterUtils.test.js` | 118 pass, 4 expected-fail, 3 todo | |
| `src/utils/__tests__/fogUtils.test.js` | 39 pass | |
| `src/utils/__tests__/combatUtils.test.js` | 38 pass, 1 expected-fail, 2 todo | |

- **All 80 `XP_THRESHOLDS` values match DMG 2014 p. 82.** The expected values are transcribed from
  the book into the test file, not read from the module under test. All 20 levels × 4 tiers pass, as
  named individual assertions. This independently confirms the review's finding.
- All six `monsterMultiplier` bands pass, including the boundary cases (6→×2 / 7→×2.5, 10→×2.5 /
  11→×3, 14→×3 / 15→×4).
- `partyThresholds` for four level-5 PCs = `[1000, 2000, 3000, 4400]` ✅
- Both end-to-end ratings from the review reproduce: 1 × CR 5 vs four L5 = **Easy** (1800 adjusted);
  4 × CR 2 vs four L5 = **Hard** (3600 adjusted).
- `fogUtils`: brush clamping verified at all four edges *and* all four corners, including the case
  that would wrap a brush from column 0 onto the last cell of the previous row if the clamp were
  missing. `getMapDimensions` covered for non-divisible image sizes (1024×768 @ 50 → 21×16) and the
  blank-map 3000×3000 fallback. Note: the phase brief calls this function `getGridDimensions`; the
  actual export is `getMapDimensions` and it was tested under its real name — renaming an export is
  a behaviour change and out of scope for Phase 0.
- `combatUtils`: initiative DEX tiebreak, count expansion producing "Goblin 1"/"Goblin 2", per-copy
  HP isolation, `nextTurn` wraparound, and all 15 PHB conditions.

**How known bugs are recorded.** Each gets *two* tests: one that passes and pins the current wrong
behaviour, and one marked `it.fails` asserting the correct behaviour. `it.fails` passes only while
its body throws — so the moment the fix lands, that test starts erroring and forces someone to delete
the modifier. It is a tripwire, not a skip. A `test.todo` accompanies each, which is why `npm test`
prints a non-zero todo count. Recorded this phase:

| Bug | Current behaviour (pinned) | Fixed in |
|-----|----------------------------|----------|
| `CR_XP` missing CR 25–29 | `crToXP(25..29)` returns `0` | Phase 1 |
| `parseCR` unguarded `parseFloat` | `parseCR('bogus')` returns `NaN`, which reaches `crToXP` and silently becomes a 0-XP monster | Phase 1 |
| No party-size multiplier shift | `monsterMultiplier` ignores party size entirely | Phase 1 |
| Monsters have no AC | `createMonsterEntry` never writes `ac`, so every monster enters combat at AC 10 regardless of stat block | Phase 5 |

A fifth todo notes that player AC is `10 + dexMod`, ignoring armour (also Phase 5).

**6. Repo hygiene** — `a1c20b3`
- `git rm -r --cached scripts/.test-userdata` — **122 files** of Electron runtime cache untracked.
  Every file remains on disk; git simply stops tracking them.
- `.gitignore` replaced (was two lines): `node_modules/`, `dist/`, `release/`,
  `scripts/.test-userdata/`, `scripts/screenshots/`, `*.log`, `.env` / `.env.*`, `.DS_Store`,
  `Thumbs.db`. The `.env` entries matter most — nothing previously stopped an API key being
  committed. (At runtime the app already does the right thing, storing the Anthropic key via
  Electron `safeStorage` in `electron/services/KeyService.js`.)
- `agent/dmcs-agent.mjs` → `tools/dmcs-agent.mjs`, **kept not deleted**, with `tools/README.md`
  stating it is an LM Studio experiment unrelated to the app's Anthropic-online/Ollama-offline
  architecture and imported by nothing. Kept because it is a working reference for driving a local
  OpenAI-compatible endpoint through the Anthropic SDK.
- `ai/features/` deleted. It was never tracked by git (git does not track empty directories), so it
  existed only on disk.
- README Testing section rewritten — it claimed "There is no automated test suite", no longer true.
  README project tree and Open Questions updated.

**7. Migration constants reordered** — `7ae47da`
- `MIGRATION_006` now defined before 007 and 008. Readability only; execution order was already
  correct via the id-ordered array at `DatabaseService.js:24-33`. A pure move — 16 insertions, 16
  deletions, with the script asserting the sorted character multiset was unchanged before writing.
  No `MIGRATION_00N` constant was edited, per the append-only rule.

**8. This file.**

### Migration verification

No migration was added this phase, but the reorder touches the file that holds them, so both halves
of the standing migration rule were exercised. `DatabaseService` cannot be imported under bare
`node` (its `better-sqlite3` is built for a different ABI), so the `MIGRATION_00N` template literals
were extracted from the source and run against Node's built-in `node:sqlite` — the same SQLite
engine executing the same DDL.

**Fresh database:** all 8 migrations applied in order. 16 tables created (`_migrations`,
`ai_usage_log`, `campaigns`, `characters`, `compendium_custom`, `connections`, `encounters`,
`factions`, `locations`, `maps`, `mind_map_positions`, `npcs`, `pdf_chunks`, `pdf_sources`,
`srd_cache`, `subclasses`). Confirmed present: `characters.subclass_name` (006),
`encounters.map_id`, `locations.has_own_map`, `locations.floor_number` (007), and the widened
`compendium_custom` CHECK (008).

**Database already containing rows:** applied 1–7, inserted three `compendium_custom` rows
(`custom`, `srd`, `pdf_upload`), confirmed the pre-008 CHECK rejects `'source_book'`
(`CHECK constraint failed: source IN ('custom','srd','pdf_upload')`), then applied 008:

```
OK   all 3 rows preserved byte-for-byte across the table recreate
OK   post-008 accepts source='source_book'
OK   the CHECK still rejects an unknown source value
OK   FK to campaigns with ON DELETE CASCADE survived the recreate
```

### Acceptance

| Check | Result |
|-------|--------|
| `npm test` green with ≥ 3 suites | **PASS** — 3 files, 205 tests: **195 passed, 5 expected-fail, 5 todo**, 271 ms |
| Known-bug tests visibly pending, not deleted | **PASS** — 5 `it.fails` tripwires + 5 `test.todo` entries, both counted in the summary line |
| `npm run build:renderer` succeeds | **PASS** — renderer 438 modules → 1,359.05 kB (gzip 388.47 kB) in 7.67 s; player 63 modules → 213.36 kB (gzip 67.47 kB) in 688 ms. The pre-existing >500 kB chunk warning is unchanged. |
| `git status` shows no tracked files under `scripts/.test-userdata/` | **PASS** — `git ls-files scripts/.test-userdata` returns 0 |
| `node -e "require('./package.json').engines"` | **PASS** — prints `{ node: '>=20 <23' }` |

**Not run, and why:**

- **`npm install` on Node 20 or 22.** This machine has **Node v24.13.1 only**, with no `nvm` or
  `fnm` installed. Nothing was verified on the pinned version. Everything above ran on Node 24.
- **A full clean `npm install`.** Deliberately not run. Its `postinstall` hook force-rebuilds
  `better-sqlite3`, and a failed rebuild would leave the working tree without a loadable binary —
  a hard-to-reverse change to the user's environment. A `--dry-run` was used instead, which proved:
  dependency **resolution succeeds** with the new `.npmrc` and still fails with `ERESOLVE` without
  it. The dry run then reached the `postinstall` step and `electron-rebuild` failed at node-gyp
  (`node-gyp failed to rebuild ... better-sqlite3`); the underlying gyp output was swallowed by
  electron-rebuild and is not in the npm log, so the cause is **not diagnosed**. The existing
  `better_sqlite3.node` was left untouched (still dated 12 May) — nothing was broken.
- **The GUI (`npm run dev`) and the packaged installer.** Not launched. Related measurement below.

### Findings

**The checked-in `better-sqlite3` is currently built for Node, not Electron.** Measured, not read:
`node -e "require('better-sqlite3')"` **succeeds** under bare Node 24, which means the binary is ABI
137. Electron 33 needs 130 and would reject it. This is the *opposite* of the state the capability
review recorded ("the checked-in build targets NODE_MODULE_VERSION 130"), and it means `npm run dev`
would hit the mismatch from this tree until `npm run postinstall` succeeds — which, per the previous
section, currently fails. This is pre-existing and untouched by Phase 0, but it is the first thing
that will block Phase 1 if Phase 1 needs to run the app.

### Deferred

- **The 17 PNGs already tracked under `scripts/screenshots/`** stay tracked. The new `.gitignore`
  entry stops more accumulating; removing the existing ones deletes committed content and is the
  user's call. One line if wanted: `git rm -r --cached scripts/screenshots`.
- **No LICENSE file** — flagged by the review, unchanged. Out of Phase 0's stated scope.
- **The systemic unhandled-IPC-error problem** (review: `ai:ragQuery`, `embed:source`, ~100 channels
  with no wrapper) is Phase 1's `registerHandler` work, not Phase 0's.
- **No React component or Electron main-process code has a test.** `DatabaseService`, the IPC
  handlers and the AI services remain unexercised by the suite; the manual `scripts/verify-*.js`
  files are still the only coverage there. A reusable migration-test harness would need either a
  correctly-built `better-sqlite3` or a commitment to `node:sqlite` (still flagged experimental in
  Node 24) — worth deciding before a phase actually adds a migration.

### Open questions for the next session

1. **konva / react-konva peer mismatch.** `react-konva@18.2.10` wants `konva` ^7/^8/^9; the project
   runs ^10.3.0. Papered over with `legacy-peer-deps=true`. Real fix is to downgrade konva to ^9 or
   move to a react-konva release accepting ^10 — both runtime dependency changes, so both need your
   call under the locked-stack rule.
2. **Why does `electron-rebuild` fail here?** Two documented candidates, neither confirmed: the
   repository path contains spaces (`Dungeon Master Campaign Suite`, which the README already flags
   as a node-gyp hazard), and the Windows native toolchain (Python 3 + VS Build Tools C++) may be
   incomplete. Worth resolving before any phase that needs to launch the app.
3. **Should the pinned Node range be honoured on this machine?** Everything in Phase 0 ran fine on
   Node 24 because none of it touches native code. The moment the app itself needs to run, the ABI
   question becomes real. Installing Node 20 via nvm-windows would settle both this and (2).
4. **If Phase 1 changes `monsterMultiplier`'s signature,** the two `it.fails` tripwires in
   `encounterUtils.test.js` assume `monsterMultiplier(count, partySize)`. A different signature means
   updating those tests rather than deleting them — the comment in the file says so.

---

## Phase 1 — Silent failures, referential integrity, IPC error handling

**Date:** 2026-09-10
**Branch:** `phase-1-integrity`, branched from **`phase-0-foundation`**, not `main`.
**Verdict changes:** none by the review's scale, as the phase brief anticipated.

> **Branch note.** Standing rule 1 says to branch from the current main branch. Phase 1 needs Phase 0's
> Vitest harness and the three `it.fails` tripwires it is required to flip, and Phase 0 is unmerged, so
> `main` does not have them. Branched from `phase-0-foundation` instead. Merge Phase 0 first, or merge
> this branch and get both.

### What shipped

**1. Global IPC error wrapper** — `3f86277`, `1d69095`

`electron/ipc/registerHandler.js` exports `registerHandler(channel, fn)` and `registerListener(channel, fn)`.
Every handler now logs `[ipc] <channel> failed:` with the full error in the main process, then rethrows
a plain `Error` carrying the underlying message plus a `[channel]` tag.

| File | Channels |
|---|---|
| `dbHandlers.js` | 96 |
| `aiHandlers.js` | 11 + 1 listener |
| `serverHandlers.js` | 11 + 1 listener |
| `pdfHandlers.js` | 8 |
| `srdHandlers.js` | 8 |
| `fileHandlers.js` | 6 |
| `embeddingHandlers.js` | 5 |
| `main.js` | 7 + 1 listener |
| **Total** | **152 handlers, 3 listeners** |

The two the brief named specifically — `ai:ragQuery` and `embed:source` — forwarded service exceptions
straight to the renderer with nothing around them. Both are covered.

**`main.js` was not in the brief's list and had eight unwrapped channels** (`app:version`,
`shell:openExternal`, `encounter:openMapWindow`, four `player:*`, and the `player:broadcast` listener).
The audit script found them after the first sweep looked complete. All are wrapped; no raw `ipcMain`
call remains anywhere in the codebase.

**2. Renderer error surface** — `3f86277`, `1621be3`

- `src/utils/ipcError.js` — `parseIpcError` strips Electron's `Error invoking remote method '<channel>':`
  envelope (which cannot be suppressed from the main process), any stacked `Error: ` prefixes, and the
  channel tag. `friendlyIpcError` rewrites the seven failure modes users actually hit — `FOREIGN KEY`,
  `UNIQUE`, `NOT NULL`, `CHECK`, `SQLITE_BUSY`, `ENOENT`, `EACCES` — into plain language, keeping the
  database wording behind a "Show details" toggle. Unrecognised messages pass through verbatim.
  **18 tests.**
- `src/stores/toastStore.js` — Zustand queue, not persisted, with `notifyError` / `notifySuccess` /
  `notifyInfo` as plain functions rather than hooks so they work inside a `catch` in a non-component
  function. `notifyError` always logs the raw error too.
- `src/components/ui/Toasts.jsx` — mounted once in `App.jsx`.

**Twelve renderer call sites wrapped**, reloading the list only on success: Locations, NPCs, Factions,
Lore, Connections, CampaignManager (delete *and* the session-notes autosave), MapEngine,
CharacterSheets, MindMap edge delete, CustomBrowser, and Settings' two key-removal buttons.

Two were worse than a missing message:

- `CampaignManager.handleNotesBlur` saved session notes on blur with nothing around it. The DM typed,
  tabbed away, and found out on the next launch that nothing had been written.
- `EncounterBuilder` had a `catch`, but it wrote to a page-level banner the list view does not render —
  and the list view is the only place deletes happen.

Successful deletes now show a confirmation naming what went, because "the button does nothing" was true
in both directions.

**3. Migration 009 — integrity rebuild** — `7f093ea`

| Table.column | Was | Now |
|---|---|---|
| `locations.parent_location_id` | RESTRICT | `ON DELETE SET NULL` |
| `npcs.location_id` | RESTRICT | `ON DELETE SET NULL` |
| `npcs.faction_id` | RESTRICT | `ON DELETE SET NULL` |
| `maps.location_id` | RESTRICT | `ON DELETE SET NULL` |
| `encounters.location_id` | RESTRICT | `ON DELETE SET NULL` |
| `encounters.map_id` | RESTRICT | `ON DELETE SET NULL` |
| `connections.campaign_id` | RESTRICT | `ON DELETE CASCADE` |
| `pdf_sources.status` | CHECK rejects `'embedded'` | CHECK accepts it |

No existing `MIGRATION_00N` was touched. Data is copied, never deleted: create new, `INSERT ... SELECT`
with an **explicit column list**, then drop the old. Explicit lists so that a future `ALTER` appending a
column fails loudly here instead of silently shifting every value one position left. The old table is
never renamed — renaming it would make SQLite rewrite every child table's `REFERENCES` clause to point
at the temporary name.

**Runner change.** The recreate procedure needs foreign keys disabled *and* atomicity, and
`PRAGMA foreign_keys` is silently ignored inside a transaction, so the SQL cannot do it itself. Migration
entries may now carry `foreignKeysOff: true`, routing them to `runGuardedMigration`: disable FKs, `BEGIN`,
exec, `PRAGMA foreign_key_check`, `COMMIT`, re-enable in a `finally`. On failure it rolls back and never
writes the `_migrations` row, so the next launch retries against an untouched schema. Migrations 001–008
keep their original auto-commit path via `runSimpleMigration`.

**4. Handler-side cleanup for polymorphic refs** — `95bb0d1`

`connections` and `mind_map_positions` store references whose target table is named in a sibling column,
which SQLite cannot express as a foreign key — so 009 leaves them unconstrained and the cleanup lives in
`dbHandlers.js`. `db:npcs:delete`, `db:locations:delete`, `db:factions:delete` and `db:lore:delete` now
route through `deleteWithPolymorphicRefs()`, which clears matching `connections` rows on **either** side
plus the `mind_map_positions` row, then deletes the entity, all inside one `db.transaction()`. Lore is
included ahead of Phase 4 because `db:world:search` already emits `'lore'` as an entity type.

**5. `no-ai` guard** — `1621be3`

`AISuggestionPanel` stored the whole result of `ai.getMode()`, which resolves to an **object**
(`aiHandlers.js:9`). `aiMode === 'no-ai'` was therefore permanently false, so the "configure your API key
in Settings" message never rendered and the Generate button was offered with no AI behind it. Now
destructured, with a `catch` that falls back to `'no-ai'` — if the mode cannot be determined, hiding the
feature is the safe direction.

**6. Orphaned vectors** — `95bb0d1`

`pdf:delete` dropped the chunk rows but left their vectra embeddings in the index, so RAG kept retrieving
and citing a book the DM had deleted. `embeddingService.deleteSource(sourceId)` now runs first, while the
chunk rows it keys off still exist, in a `try`/`catch`. `registerPdfHandlers` takes `embeddingService` as
a fourth argument; `main.js` constructs it at line 157, well before the handlers register at line 175.

**7. Map file cleanup** — `95bb0d1`

`db:maps:delete` removed the row and left the image in `userData/maps/` and the thumbnail in
`userData/maps/thumbs/` forever. Both are unlinked now, each in its own `try`/`catch`: a missing or locked
file must not block the database delete, or the map becomes undeletable.

**8. Encounter math** — `617cd10`

- **CR 25–29 added** (75000 / 90000 / 105000 / 120000 / 135000). The symptom was that a CR 27 threat
  contributed nothing to the difficulty rating, so an encounter that should read Deadly read Trivial.
- **`parseCR` NaN guard.** `parseFloat(cr) ?? 0` only catches null/undefined, so `parseCR('bogus')`
  returned `NaN`, which hit `CR_XP[NaN]` → `undefined` → `0` one layer later: a silent 0-XP monster
  rather than a visible error. Now `Number.isFinite`-guarded on both paths, so `NaN` and `Infinity` are
  caught too.
- **Party-size multiplier shift.** Reimplemented as an index into an exported
  `MULTIPLIER_LADDER = [0.5, 1, 1.5, 2, 2.5, 3, 4]`, shifted +1 when `partySize < 3` and −1 when
  `partySize >= 6`, clamped. Signature is `monsterMultiplier(count, partySize = 4)`, so every existing
  single-argument call keeps its old result.
- **`adjustedXP` also takes `partySize`.** Beyond the brief's wording, and deliberate: `adjustedXP` calls
  `monsterMultiplier` internally, and the UI shows the multiplier beside a difficulty derived from
  `adjustedXP`. Threading party size through only one of them would put two contradicting numbers on the
  same screen. A test asserts they cannot disagree.

Call sites updated: `XPCalculator.jsx`, `CombatCalculator.jsx` (both with `partySize` hoisted above the
math block and added to the `useMemo` deps), and both `adjustedXP` calls in `EncounterBuilder.jsx`.

**The three Phase 0 tripwires did their job.** Each `it.fails` began erroring the moment its fix landed,
forcing the modifier off. All three are now plain assertions; the encounter suite is 136 tests with no
pending and no todo.

**9. Dead sidebar link** — `3f86277`

`/lore` removed from `Sidebar.jsx`, the route removed from `App.jsx`, `src/pages/LoreConnections.jsx`
deleted. No reference survives anywhere in `src/`.

**10. Parent-cycle guard** — `1621be3`

New `src/utils/locationUtils.js` walks the `parent_location_id` chain with a visited set and a 50-hop
bound, rejecting a cycle of any length. The old check compared `parent === self`, so A-under-B-under-A
and every longer loop were accepted; nothing in the database prevents it, because SQLite cannot express
"this self-reference must be acyclic". The message names both locations. The location form's save path is
wrapped too, and `setSaving` moved into a `finally` so a failed save no longer leaves the dialog stuck on
"Saving…". **25 tests.**

One of those tests found a real gap while being written: `wouldCreateCycle` ignored the `cyclic` flag
from the ancestor walk, so attaching a location to an already-broken hierarchy was allowed. Both `cyclic`
and `truncated` now reject.

### New verification scripts

Both run on plain Node — neither needs a working native `better-sqlite3` build.

- **`npm run test:migrations`** (`scripts/verify-migration-009.mjs`) — extracts the real `MIGRATION_00N`
  literals from `DatabaseService.js` and replays them on Node's built-in `node:sqlite`.
- **`npm run test:ipc`** (`scripts/verify-ipc-layers.mjs`) — cross-references `preload.js`'s
  `ipcRenderer.invoke`/`send` literals against the `registerHandler`/`registerListener` literals in
  `electron/ipc/*.js` and `main.js`, failing on a channel present on only one side. This is standing
  rule 2 made checkable; it is what found the eight unwrapped `main.js` channels.

### Acceptance

| Check | Result |
|---|---|
| `npm test` green, including the formerly-pending encounter math | **PASS** — 5 files, 259 tests: **256 passed**, 1 expected-fail, 2 todo. The remaining tripwire + todos are the Phase 5 monster-AC bug, not Phase 1's. |
| Scripted migration test 001→009 on a populated DB | **PASS** — `npm run test:migrations`, **51/51** |
| … delete a location with an NPC, a map and an encounter attached → succeeds, dependents `NULL` | **PASS** — all four dependants asserted, including the child location's `parent_location_id` |
| … delete a campaign with connections → succeeds | **PASS** — connections cascade; all seven child tables cascade; the second campaign is untouched |
| … delete an NPC → its connections and mind-map position rows are gone | **PASS** — covered by `deleteWithPolymorphicRefs`; see the caveat below |
| `UPDATE pdf_sources SET status='embedded'` succeeds | **PASS** — and refused before 009, confirming the defect was real |
| `npm run build:renderer` | **PASS** — renderer 6.0 s, player 0.6 s |
| `npm run test:ipc` | **PASS** — 152 handlers, 3 listeners, 152 invokes, 3 sends, zero unwrapped, zero orphans |

**Caveat on the NPC-delete check.** The migration harness proves the *SQL* — that no foreign key blocks
the delete and the `connections` / `mind_map_positions` rows can be removed in one transaction. It does
**not** execute `deleteWithPolymorphicRefs` itself, because that function lives in `dbHandlers.js` behind
`better-sqlite3` and `electron`. The function is nine lines of parameterised SQL and its channel wiring is
verified by `test:ipc`, but it has not been *run*. Stated plainly rather than counted as a full pass.

**Not run, and why:**

- **The manual UI check** ("delete a location with NPCs from the UI — either it succeeds or a toast
  appears"). **Not performed.** A display is available; the blocker is the one Phase 0 recorded. Measured
  again just now: `node -e "require('better-sqlite3')"` still **succeeds** under bare Node 24, so the
  binary is ABI 137 (Node-flavoured) while Electron 33 needs 130. The app cannot open its database from
  this tree, and `npm run postinstall` — which would fix it — still fails at node-gyp. Force-rebuilding
  would delete a working binary with no guarantee of replacing it, which is your call, not mine.
  **Everything in this phase that touches the running UI is therefore verified by reading and by unit
  test, not by use.**
- **AI-mode behaviour with a real key or a running Ollama.** No API key, no Ollama. The `no-ai` fix is a
  one-line destructure verified by reading `aiHandlers.js:9`; the *rendered* result is unverified.

### Deferred

- **`db:pdf:delete` in `dbHandlers.js`** is a second, database-only path to the same table and does not
  drop vectors or files. Nothing in `src/` calls it — the UI uses `pdf:delete` — so it is annotated with
  a pointer rather than rewired, since handing `dbHandlers` an `embeddingService` for an unused channel is
  the wrong trade. Either delete the channel or wire it properly in a later phase.
- **`ai_usage_log.campaign_id`** still has no `ON DELETE` action. It was not in the brief's list for 009,
  and migrations are append-only, so it would need a 010. Low impact: the rows are diagnostic.
- **No component tests.** The toast queue, `<Toasts/>` and every page remain unexercised by Vitest. That
  needs jsdom and a testing-library, i.e. new devDependencies beyond the one Phase 0 was permitted.
- **`scripts/screenshots/`** — still 17 tracked PNGs, unchanged from Phase 0.

### Open questions for the next session

1. **The `better-sqlite3` ABI is now blocking verification, not just convenience.** Phase 0 could route
   around it; Phase 1's UI work could not be exercised because of it, and Phase 2 onward will be worse.
   Resolving it — Node 20 via nvm-windows, or fixing the node-gyp failure — is the highest-value thing to
   do before more feature work.
2. **Should the toast helpers replace the per-page error banners?** Several pages keep their own
   `setError` / `setLoadError` state alongside the new toast. `EncounterBuilder` now writes to both.
   Consolidating is a small refactor but changes how errors read on every page, so it is worth a decision
   rather than drift.
3. **`monsterMultiplier`'s second parameter defaults to 4.** Every caller now passes a real party size,
   but the default silently applies DMG "no shift" behaviour if a future caller forgets. Consider making
   it required once all callers are known.
4. **konva / react-konva peer mismatch** — unchanged from Phase 0, still papered over by
   `legacy-peer-deps=true` in `.npmrc`.
