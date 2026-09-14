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

---

## Phase 2 — Player server security and map lifecycle

**Date:** 2026-09-11
**Branch:** `phase-2-player-security`, branched from **`phase-1-integrity`**, not `main`.
**Verdict changes:** Q5 PARTIAL → stronger PARTIAL, as the brief anticipated.

> **Branch note, same as last phase.** Phase 2's rule 5 requires the toast helper Phase 1 introduced,
> and Phase 1 is still unmerged, so `main` does not have it. The branch chain is now
> `main → phase-0-foundation → phase-1-integrity → phase-2-player-security`. Merging the newest gets
> all three.

### What shipped

**1. Auth middleware** — `7f09790`

`_requireSession` gates everything under `/api/` except `POST /api/join`, accepting the join token as
`Authorization: Bearer <token>` or `?token=`. The query fallback is not laziness — `<img>` cannot set
headers, and the map image is loaded by one. Missing or unknown token → **401**.

The Socket.IO handshake is gated too, via `io.use()`. Previously *any* socket could connect and only
`player:identify` checked the token, so an unidentified socket sat connected indefinitely. The campaign
room is now derived from the token rather than from anything the client sends, and `player:identify` no
longer carries a token at all — it only records which character was picked.

**Campaign scoping.** Every route compares the row's `campaign_id` against the token's. A token for
campaign 3 cannot read campaign 4's maps, characters, character lists or map images. The refusal is
**404 rather than 403**, deliberately: "that exists but is not yours" leaks the existence and id range
of another campaign's content.

**2. CORS tightened** — `7f09790`

`Access-Control-Allow-Origin: *` is gone. Allowed now: no `Origin` at all (same-origin, curl, native
fetch), any `*.ngrok-free.app` / `.ngrok.io` / `.ngrok.dev` host, any LAN address this machine answers
on, and `localhost` **only** when `NODE_ENV=development`. Anything else gets no CORS headers at all.
The caller's origin is echoed rather than `*`, with `Vary: Origin`.

**3. Server-side fog filtering** — `f079c1b`, `7f09790`

This was the real hole. Fog was a rendering decision: the server sent every token and
`player/components/MapView.jsx` declined to draw the hidden ones. Devtools, or one `curl`, showed every
ambush on the board.

- `electron/server/fogFilter.js` — a deliberate CommonJS duplicate of the index maths in
  `src/utils/fogUtils.js` (the renderer copy is an ES module in the Vite bundle). The test suite imports
  **both** and asserts they agree: `getCellIndex` across a whole grid, `isCellRevealed` against a mask
  painted with the renderer's own `setBrushRevealed`, and `gridDimensions` against `getMapDimensions`
  including the 3000×3000 blank-map fallback. A divergence between the two copies is a fog leak nothing
  else would catch.
- `GET /api/map/:id` filters before responding. The mask is still sent — the client draws the fog, it
  just no longer receives what is under it.
- `broadcast()` filters `map:update` payloads through `filterBroadcastPayload`, looking the map row up
  under the broadcasting campaign's id. Without this, fog would be enforced on load and leak on the next
  sync.

**Everything fails closed.** Tokens are withheld entirely when the grid cannot be determined, when the
mask length ≠ `numCols × numRows`, when the image cannot be measured, or when a token has no usable
integer position. A token wrongly hidden is a DM re-syncing; a token wrongly shown is the encounter
spoiled.

**An unplanned dependency, worth flagging.** Filtering needs `numCols`, which is
`ceil(imageWidth / gridSize)`. The renderer gets `imageWidth` free from a loaded `<img>`; the main
process does not, and the stack is locked so there is no image library. So **`electron/server/imageSize.js`**
reads pixel dimensions from PNG, JPEG, GIF and WebP header bytes — every format the file picker accepts.
This was not in the brief and is not optional: without it, server-side fog filtering cannot be correct.
It returns `null` when it cannot measure, and callers fail closed, because guessing the size means
guessing which cells are revealed. No dependency was added.

**4. Player web app** — `7f09790`

New `player/api.js` holds the token and is the single place the app talks to the server — scattering
`Authorization` headers across four components is how one gets forgotten. The token is restored from
`sessionStorage` **before** any child mounts, or the first request after a page reload 401s. The socket
handshake sends it via `auth.token`. Two new error surfaces explain the one thing players will actually
hit: tokens live in memory, so a DM restart ends every session and the fix is to reload and re-join.

**5. Fog/grid coupling** — `ec2ae59`

A fog mask is `numCols × numRows` booleans where `numCols` depends on grid size, so changing the grid
makes every index mean a different cell. `MapCanvas` already noticed and started the mask over
(`MapCanvas.jsx:104`) — but silently. A DM nudging the grid 50px → 55px to line it up watched an evening
of painted fog vanish with no warning.

New `src/utils/mapGridUtils.js` (`paintedCellCount`, `hasPaintedFog`, `describeGridChange`).
`MapToolbar.handleSaveGridSize` now asks first and clears the stored mask on confirm. Clearing matters
beyond tidiness: a stale mask makes the server fail closed and withhold every token with nothing on
screen explaining why. `MapEngine` updates `fog_data` in the same `setState` as `grid_size`, because
`MapCanvas` re-initialises from both.

Both of `MapToolbar`'s `window.electronAPI` calls are now wrapped and report through the Phase 1 toast —
neither was.

**6. Docs** — README gained a "Player server security" section under Player Views; the testing section
lists the new suites and `npm run test:server`. `DMCS_Remote_Player_Network.md` gained a "Security model"
section immediately after the prompt index, marked as **superseding** the prompts below it, since those
describe the pre-Phase-2 server.

### Two bugs the tests found while being written

Both are the same shape, and worth remembering: **`Number()` coerces `null`, `''`, `false` and `[]` to
`0`**, and `0` is finite.

1. `filterTokensByFog` used `Number(token.col)`, so a token with no position became a token at column 0
   — and on a revealed top-left corner, that is a leak. Coordinates must now already *be* integers.
2. `describeGridChange` used `Number.isFinite(Number(next))`, so a half-typed or missing grid input read
   as a real change to 0px — and a "change" is what destroys the mask. Grid sizes must now be positive
   numbers, with numeric strings accepted because `<input type="number">` returns them.

Both sets of coercion cases are pinned as regressions.

### Acceptance

| Check | Result |
|---|---|
| `curl /api/map/1` with no token → 401 | **PASS** |
| … with a valid token for the wrong campaign → 403/404 | **PASS** — 404, chosen over 403 so existence is not disclosed |
| … with the right token → 200, no tokens on unrevealed cells | **PASS** — seeded map has one revealed cell (5,5) and one hidden (15,12); the guard comes back, the assassin does not |
| Unit tests for `fogFilter.js` | **PASS** — 35 tests, plus 31 for `imageSize.js` |
| `npm test` green | **PASS** — 9 files, 344 tests: **341 passed**, 1 expected-fail, 2 todo (the Phase 5 monster-AC tripwire) |
| `npm run test:server` | **PASS** — **47/47** |
| `npm run test:migrations` | **PASS** — 51/51 (unchanged) |
| `npm run test:ipc` | **PASS** — 0 problems (unchanged) |
| `npm run build:renderer` | **PASS** |

`npm run test:server` starts a **real** `PlayerServer` on a real port with a stub database and makes real
HTTP requests. Express, the auth middleware, the CORS policy, the campaign scoping and the fog filter all
run exactly as they do in the app — only `DatabaseService` is stubbed. `PlayerServer` touches `electron`
only inside `_notifyDM` and the production branch of `_getPlayerBundlePath`, so `NODE_ENV=development`
keeps it runnable under bare node.

**Not run, and why:**

- **The app itself, again.** Unchanged from Phases 0 and 1: `require('better-sqlite3')` still succeeds
  under bare Node 24, so the binary is ABI 137 while Electron 33 needs 130, and `npm run postinstall`
  still fails at node-gyp. Nothing in this phase was exercised through the running UI. The server-side
  work is covered by the 47-check harness, which is stronger than a manual click-through; **the
  renderer-side work — the grid-size confirm dialog and the player app's token handling — is verified by
  unit test and by reading, not by use.**
- **A real browser against a real tunnel.** No ngrok token, and the harness uses `fetch`, not a browser.
  CORS headers are asserted on the response; whether a browser *enforces* them as expected is standard
  behaviour but untested here.
- **The Socket.IO handshake end-to-end.** `io.use()` rejection is verified by reading; the harness
  exercises `broadcast()` directly rather than connecting a client, because a connecting socket calls
  `_notifyDM`, which requires `electron`.

### Deferred

- **`/api/join` is still open.** Anyone who reaches the port can join any campaign by id and get a
  working token. That is how players get in without per-player credentials, so the tunnel URL is the
  shared secret. A DM-set session passphrase is the obvious next step and is **not** implemented. Both
  README and the network doc say so plainly rather than implying the server is now safe to expose.
- **No rate limiting on `/api/join`.** Campaign ids are small integers, so a script could enumerate them
  and mint tokens for every campaign on the server. Mitigated in practice by the tunnel URL being
  unguessable, not by the code.
- **Tokens never expire.** They die with the server, which for a game night is close enough, but a DM
  who leaves the app running for a week has week-old tokens still working.
- **`fog_cols`** remains Phase 8's. The mask-length check is the best available substitute and is why the
  filter can only fail closed on a mismatch rather than reindex.

### Open questions for the next session

1. **The `better-sqlite3` ABI is now three phases old as a blocker.** It has stopped being an
   inconvenience and become the reason each phase's acceptance section has a "not verified by use"
   paragraph. Node 20 via nvm-windows, or diagnosing the node-gyp failure, before more feature work.
2. **Should `/api/join` take a passphrase?** It is the one remaining gap between "authenticated" and
   "safe to expose", and it is a small change — a field on the join screen, a comparison in the handler,
   and a place for the DM to set it. Worth deciding rather than leaving as a known hole.
3. **`imageSize.js` is now load-bearing for a security property.** If a DM uses a format it cannot read,
   their tokens silently stop appearing for players. The file picker restricts to png/jpg/jpeg/webp so
   this should not happen, but a clearer signal in the DM UI ("players cannot see tokens on this map —
   the image could not be measured") would beat silence.
4. **konva / react-konva peer mismatch** — unchanged since Phase 0.

---

## Phase 3 — Rules Q&A works on day one

**Date:** 2026-09-12
**Branch:** `phase-3-rules-qa`, branched from **`phase-2-player-security`**, not `main`.
**Verdict changes:** Q4 PARTIAL → **SOLVED for single-rule lookups**, with the caveat in Acceptance below.
Situation mode shipped as well.

> **Branch chain.** `main → phase-0-foundation → phase-1-integrity → phase-2-player-security →
> phase-3-rules-qa`. Each phase needs the last one's work; merging the newest gets all four.

### The bug that reframes this phase

**Semantic search has never run in this application.** vectra 0.15's signature is
`queryItems(vector, query, topK, filter, isBm25)`. `EmbeddingService.search` called it as
`queryItems(vector, topK)`, putting `topK` in the `query` slot and leaving `topK` undefined.
`Math.min(undefined, n)` is `NaN`, the internal top-k heap never accepted an item, and the call
returned `[]` on every query.

Measured against the installed package, not read from source:

```
queryItems(vector, 5)             -> 0 results
queryItems(vector, '', 5)         -> 4 results
Math.min(undefined, 4)            -> NaN
```

Every RAG query in the app's history silently used the SQLite keyword branch. This **inverts the
capability review's Q4d finding**: the keyword fallback is not "well-written and unreachable in
practice", it is the only path that has ever run. Fixed, with the over-fetch this phase needed anyway.

### What shipped

**1. SRD indexing** — `189447f`, `f3f4e52`, `0d0a484`

The app has always shipped a full SRD cache in `srd_cache`, used only for browsing, while rules Q&A
demanded the DM upload a PDF of a book they already own. `SrdService` gains `buildIndexableText()`,
`buildSrdIndex()`, `getIndexStatus()` and `clearSrdIndex()`; the serialisation itself lives in a pure
`srdIndexText.js` because `SrdService.js` opens with `require('electron')` and so cannot be unit
tested. One sentinel `pdf_sources` row named `SRD 5.1`, `campaign_id` NULL, one chunk per SRD entry,
`page_number` carrying a section index so citations read "SRD 5.1, Monsters" not "p.4". Rebuilding
replaces rather than appends. `srd:seedAll` builds the index automatically after a first seed, and
embeds too if Ollama is actually reachable — wrapped so a failure there never fails the seed.

**Migration 010 — a deliberate departure from the brief, flagged for review.** The brief said to make
this work "in code" and, if `pdf_sources.campaign_id` is not nullable, to note it for Phase 4. It is
`NOT NULL`. I added the migration now rather than deferring, because every workaround is worse:
pointing the SRD at an arbitrary campaign makes the whole index vanish when that campaign is deleted
(via the `ON DELETE CASCADE` Phase 1 added), a hidden sentinel campaign puts a fake row in the DM's
campaign list, and one SRD source per campaign defeats the point of sharing. Deferring would have meant
shipping the phase's headline feature on one of those, or not shipping it. **Say the word and I will
move it to Phase 4.**

**2. Campaign filtering pushed into retrieval** — `0d0a484`

`allowedSourceIds()` returns the campaign's own sources **plus every shared source**, and search
over-fetches `topK * 4` before filtering. Filtering a `topK`-sized list was the dilution bug: five
global hits could all belong to another campaign's book, leaving this campaign with nothing even though
its own sources had relevant passages further down. The keyword top-up is scoped to the same allowed
set — it previously filtered on `campaign_id = ?` and so could never see a shared source at all.

**On vectra's metadata filter**, which the brief said to check rather than assume: it exists, `$eq`
works, but **`$in` is broken for numeric values** in 0.15 — the implementation requires the array
entries to be strings, so `$in: [10, 20]` against a numeric `source_id` never matches. Over-fetch and
filter in JS it is.

**3. Ollama optional at query time** — `0d0a484`

The `embed()` call is wrapped; on failure `search` falls through to the keyword branch and tags the
result `degraded`, distinguishing "Ollama is not running" from "the model is not installed". The UI
says which. Previously this threw and the Ask button appeared to do nothing.

**4. A real `no-ai` path** — `0d0a484`

`RAGService.query` returns `{ answer: null, sources, extractedPassages: true }` instead of throwing
"No AI service available". `RAGQueryPanel` renders a **"Relevant passages"** panel as the primary
result, with full passage text rather than the 120-character preview used for citations. The Ask button
is gated on `hasEmbedded || srdIndexed`, not on AI mode.

**5. AI failures are logged** — `0d0a484`

`complete()` is wrapped so a throw still writes an `ai_usage_log` row. **No migration**: `response_len
= -1` is the sentinel, because a negative response length is not a real measurement and a diagnostic
table did not justify schema churn. Usage stats gain a failure count, and the average is now taken over
successful calls only — a call that threw after 200ms is not evidence the model is fast.

**6. Query expansion** — `189447f`

All 15 PHB conditions, cross-checked against `CONDITIONS` in `src/utils/combatUtils.js` by a test, plus
grapple/grappling, opportunity attack, somatic/verbal/material and ~20 other terms. Two behaviour fixes
fell out of writing it:

- The old version split on `' '` alone, so **`"grappled?"` never matched the table**. A DM typing a
  question almost always ends it with a question mark, which means expansion was effectively off for
  most real queries.
- Condition names now match their grammatical variants: restrain / restrained / restraining.

**7. Situation mode (stretch)** — `0d0a484`

`situationQuery` decomposes a situation into 2–5 rules concepts as strict JSON, retrieves per concept,
unions and dedupes keeping the best score and recording which concepts each passage covers, then asks
for one ruling over the set. Unparseable model output falls back to treating the situation as a single
concept — a worse decomposition beats an error. Hidden in `no-ai` rather than shown broken, since the
decomposition step cannot degrade the way retrieval can.

### Acceptance

| Check | Result |
|---|---|
| `npm test` green | **PASS** — 10 files, 415 tests: **412 passed**, 1 expected-fail, 2 todo (the Phase 5 monster-AC tripwire) |
| `expandQuery` covered by a test asserting all 15 condition names expand | **PASS** — 35 tests, one per condition, plus a cross-check against `combatUtils` |
| Empty campaign, ask "what does the restrained condition do" → answer with an `SRD 5.1` citation | **PASS in harness** — see the caveat below |
| Stop Ollama, ask again → keyword result flagged degraded, no exception | **PASS in harness** — `degraded: true`, `degradedReason: 'ollama-unavailable'` |
| `no-ai` mode → passages render, no error string | **PASS in harness** — `answer: null`, `extractedPassages: true`, full text present |
| Two campaigns, PDF only in A: querying from B returns SRD hits, not an empty list | **PASS in harness** — B gets 5 SRD sources and zero of A's homebrew text |
| `npm run test:rag` | **PASS** — 42/42 |
| Regressions: `test:migrations` / `test:server` / `test:ipc` | **PASS** — 62/62, 47/47, 0 problems |
| `npm run build:renderer` | **PASS** |

**What "PASS in harness" means, precisely.** `scripts/verify-rag.mjs` runs the **real** `SrdService`
and the **real** `RAGService` against a **real** SQLite database with the app's own migrations applied.
`EmbeddingService` is stubbed — but stubbed to reproduce exactly what the real one does when Ollama is
unreachable: the SQLite keyword branch with `degraded` set. Since "works without Ollama" is this
phase's central claim, that is the right path to exercise, and the stub's keyword SQL mirrors the real
implementation's shape.

**Not run, and why:**

- **The semantic path, with Ollama actually running.** No Ollama here. The vectra call fix is verified
  against the installed package by direct probe (the numbers above), and `embedSource` is unchanged
  from the code that has been embedding PDFs all along — but **no query in this phase has been answered
  from a vector index**, because no vector index can be built without Ollama. The keyword path is
  fully exercised; the semantic path is verified by reading plus the probe.
- **A real AI answer.** No API key. `RAGService` was tested with three stub models (online, no-ai,
  throwing). Prompt composition and the context handed to the model are asserted; **answer quality is
  not evaluated at all.**
- **The app itself.** Unchanged since Phase 0: `require('better-sqlite3')` still succeeds under bare
  Node 24, so the binary is ABI 137 while Electron 33 needs 130, and `npm run postinstall` still fails
  at node-gyp. The Settings index button, the "Relevant passages" panel, the degraded banner and the
  situation toggle are **verified by reading and by build, not by use.**
- **The auto-index-after-seed path.** It requires a live dnd5eapi fetch through Electron's `net`. The
  code is wrapped so a failure cannot fail the seed, but the happy path is unexercised.

### Deferred

- **Nothing chunks the SRD text.** Each SRD entry becomes exactly one `pdf_chunks` row, however long.
  A long monster entry is one large chunk, which eats the 3000-character context budget faster than a
  PDF's ~400-token chunks would. It works, and per-entry chunks make citations exact, but a long-entry
  split is worth considering if answers start getting truncated.
- **`_expandContiguous` runs on SRD hits too**, and will pull in neighbouring SRD entries (alphabetical
  neighbours, not related rules) because the chunk indices are adjacent. Harmless — it adds context
  rather than losing it — but it is not doing anything useful for this source.
- **The vectra bug means there is no existing vector index to migrate.** Anyone who "embedded" a PDF
  before this fix has vectors that were never queried. They will start working now, with no action
  needed, but the embeddings were made by whatever model was installed at the time.
- **No test for `SrdService`'s Electron-dependent paths** (`seedAll`, `fetchAndCache`), unchanged.

### Open questions for the next session

1. **The `better-sqlite3` ABI is now four phases old as a blocker**, and its cost is rising: this phase
   has more UI surface than any so far and none of it has been clicked. Fixing it — Node 20 via
   nvm-windows, or diagnosing the node-gyp failure — is worth more than the next feature.
2. **Should migration 010 stay in Phase 3?** It works and is tested both ways, but the brief suggested
   deferring it to Phase 4. Easy to move if you would rather.
3. **Is one chunk per SRD entry the right granularity?** See Deferred. It affects answer quality once a
   model is actually in the loop, which cannot be measured here.
4. **`response_len = -1` as the failure sentinel** avoided a migration, but it is a convention that
   lives in two places (`AIService._logUsage` writes it, `ai:getUsageStats` reads it). If Phase 4 adds
   a migration anyway, a real `success` column would be cheaper to keep honest.
5. **konva / react-konva peer mismatch** — unchanged since Phase 0.

---

## Phase 4 — Sessions, plot threads, reveals

**Date:** 2026-09-12
**Branch:** `phase-4-sessions`, branched from **`phase-3-rules-qa`**, not `main`.
**Verdict changes:** **Q2 PARTIAL → SOLVED.** Q3 unchanged until Phase 6, as expected.

> **Branch chain.** `main → phase-0-foundation → phase-1-integrity → phase-2-player-security →
> phase-3-rules-qa → phase-4-sessions`. Merging the newest gets all five.

> **NUMBERING.** The brief calls this "migration 010". 010 is Phase 3's `shared_pdf_sources`, and
> migrations are append-only, so this shipped as **011**. The DDL is the brief's, from the review's
> Q2e, unchanged.

### What shipped — 4a

**1-2. Migration 011 + data preservation** — `cd7a854`

`sessions`, `plot_threads` and `reveals`, plus the `UNIQUE(campaign_id, session_number)` the brief
asks for and three indexes. Design points worth keeping:

- `plot_threads.opened_session_id` / `resolved_session_id` are **ON DELETE SET NULL**, not CASCADE.
  Deleting a session must not delete the thread it happened to open — the thread outlives it.
- `reveals` is a separate table rather than an `is_revealed` column on four others: it keeps the flag
  out of the JSON blobs, makes "what did the party learn in session 7" one query, and avoids widening
  four CHECK constraints.
- `reveals.UNIQUE(entity_type, entity_id)` needs no `campaign_id` — entity ids are already unique
  within their own table.

**The data step (standing rule 10).** `importCampaignNotes` **copies** each non-empty
`campaigns.description` into a first session titled "Imported notes". The column is left exactly as
it was. Nothing is deleted; if the import is wrong the original text is still there. Idempotent by
construction — a campaign that already has any session is skipped.

**Runner change.** Migration entries may now carry an `after` hook, and the DDL plus the hook run in
one transaction. A half-applied import is worse than none: it leaves some campaigns migrated and some
not, and the idempotence check then skips the rest forever.

**3. Handlers, preload, renderer API** — `cd7a854`

`db:sessions:{getAll,getById,getCurrent,create,update,updateNotes,delete}`,
`db:plots:{getAll,getById,create,update,updateStatus,delete}`,
`db:reveals:{getForCampaign,getForSession,isRevealed,reveal,unreveal}`, plus
`db:maps:getByLocation` and `db:encounters:getByLocation` for task 13. **177 channels, preload and
handlers matched, zero orphans** (`npm run test:ipc`).

`sessions:create` derives the session number rather than trusting the caller, so two fast clicks
cannot compute the same one, and **recounts** `session_count` rather than incrementing — an increment
drifts the moment a session is deleted. `reveals:reveal` uses `ON CONFLICT DO UPDATE`, so revealing
an already-revealed item is a no-op rather than a constraint failure.

**4. Connections widened** — `f8db221`

From three types to eight (npc, location, faction, lore, map, encounter, character, plot), driven by
one `TYPE_SOURCES` table pairing each type with its loader and its display column — characters use
`character_name`, plot threads use `title`, the rest use `name`.

The `item` node type, defined in `mindMapUtils` from the start and never built, is **replaced** rather
than kept — it was the template the brief pointed at and nothing referenced it. The five new types
share a generic `EntityNode` driven by `NODE_CONFIG` rather than getting five more copies of the same
60-line component; the three original bespoke nodes stay. Toolbar filter pills are generated from
`NODE_CONFIG`, so a future type appears automatically instead of being invisible until someone
remembers a second table.

**The Mind Map filter defaults to the three world types on, five off.** Eight types on one canvas is
unreadable, and the brief asks for a filter precisely so it does not become so — defaulting to
everything-on would make the first render the worst one.

`useMindMapData` loads all eight. This matters more than it looks: the hook drops any edge whose
endpoints are not both present as nodes, so without it every connection to a new type would have been
silently invisible.

**5. `db:world:search` widened** — `cd7a854`

Characters, encounters, maps, sessions, plot threads, non-lore compendium entries — and, most
importantly, **lore bodies** via `json_extract(data, '$.content')`. Only the title was searched
before, so the text of every lore entry was invisible to search: the easiest possible way to lose your
own worldbuilding. `WorldSearch`'s group list is generated from one table rather than four hardcoded
rows.

### What shipped — 4b

**7. Sessions page** — `745609a`. List newest-first plus a detail pane: title, date, notes, the plot
threads opened or closed in that session, and what was revealed in it. Notes autosave on blur with a
Saving/Saved indicator. A blur that changed nothing does not write, so nobody sees "Saved" flash at
them for clicking away.

**8. Plot Threads board** — `745609a`. Four columns, button transitions rather than drag (drag needs a
library; the stack is locked). Closing a thread stamps it with the session in progress; reopening
clears that stamp because it is no longer true. Every status can reach every other — threads get
reopened often enough that a one-way board would be wrong.

**9. RevealToggle** — `745609a`, on Lore, NPCs, Locations and Factions. Revealing something marked
`is_secret` asks first: it is the one direction that cannot be taken back at the table.

**10. CampaignManager repointed** — `745609a`. The notes textarea now edits the current session's
notes, with a "+ New session" button. Typing into it on a campaign with no sessions starts session 1
rather than dropping what was typed. `campaigns.description` goes back to being a description.

**Found while doing this:** the stat cards were lying. Encounters and characters were hardcoded to 0.
They now count.

**11. Sidebar + routes** — `745609a`.

**12. Player-facing reveals** — `745609a`. `GET /api/campaign/:id/revealed`, token-scoped per Phase 2,
plus a "What you know" tab in **both** the browser player app and the in-app Electron player window.
Only player-facing fields are resolved: an NPC's `secrets`, `motivation` and `notes` and a location's
`lore` are absent by construction. An unknown `entity_type` is skipped rather than guessed at.

**13. AttachedPanel** — `f8db221`. "Everything attached to this" on location edit and NPC quick view:
NPCs standing in a location, maps of it, encounters staged there, and its connections. The data was
always there; nothing joined it up in one view.

### Acceptance

| Check | Result |
|---|---|
| Migration 011 on a DB with three campaigns, one with a description → exactly one imported session, description intact | **PASS** — and the two campaigns with NULL / whitespace-only descriptions correctly got none |
| Create three sessions → card shows "3 sessions" | **PASS** |
| Search a phrase that exists only inside a lore entry's body → found | **PASS** — and asserted the *old* title-only query finds nothing, so the test proves the fix rather than the fixture |
| Reveal a lore entry → appears in player "What you know"; unreveal → gone | **PASS at the API layer** — see below |
| Delete a session referenced by a plot thread → thread survives with `NULL` link | **PASS** — and the reveal survives too, with a NULL `session_id`: the party still knows what it was told |
| `npm test` green | **PASS** — 11 files, 449 tests: **446 passed**, 1 expected-fail, 2 todo (the Phase 5 monster-AC tripwire) |
| `npm run test:sessions` | **PASS** — 45/45 |
| `npm run test:server` | **PASS** — 62/62, up from 47 |
| Regressions: `test:migrations` / `test:rag` / `test:ipc` | **PASS** — 62/62, 42/42, 0 problems |
| `npm run build:renderer` | **PASS** |

**On the reveal round-trip, precisely.** `npm run test:server` starts a real `PlayerServer` and asserts
that a revealed lore entry, NPC and location come back with their player-facing text, that an
unrevealed faction does not, that another campaign's reveal does not, and — five separate checks
against the **raw JSON**, not the parsed fields — that `secrets`, `motivation`, `notes` and `lore`
appear nowhere. What is *not* covered is the UI round-trip: clicking the 👁 toggle and watching the
item appear in the player tab. That needs the app running.

**Not run, and why:**

- **The app itself, for the fifth phase running.** `require('better-sqlite3')` still succeeds under
  bare Node 24 (ABI 137) while Electron 33 needs 130, and `npm run postinstall` still fails at
  node-gyp. **This phase is almost entirely UI** — two new pages, a reveal toggle on four pages, a
  repointed CampaignManager, an attached-items panel, two player tabs — and **none of it has been
  clicked.** It is verified by unit test, by the data-layer harnesses, and by build. That is a weaker
  claim than any previous phase's, and it is the right time to say so plainly: the ABI blocker has
  gone from an inconvenience to the dominant risk in this project.
- **The Electron player window's "What you know" tab.** It mirrors the server's resolver field for
  field, but it runs through IPC rather than HTTP, so `test:server` does not cover it. Verified by
  reading.
- **Drag-and-drop on the plot board.** Not built — buttons instead, because drag needs a library.

### Deferred

- **Reveals have no handler-side cleanup.** Deleting an NPC leaves its `reveals` row behind, pointing
  at an id that no longer exists — exactly the polymorphic-orphan problem Phase 1 fixed for
  `connections` and `mind_map_positions`. `deleteWithPolymorphicRefs` in `dbHandlers.js` needs
  `reveals` added to it. **This is the one loose end I would fix first.**
- **`reveals:changed` is listened for but never broadcast.** The Electron player view refreshes on it;
  nothing sends it yet, so a reveal made mid-session needs a manual refresh in that window.
- **The Sessions detail pane shows reveals as `type #id`,** not names. Resolving them needs a join or
  four lookups per session; the data is right, the presentation is thin.
- **`recap` is written but never generated.** The column exists and the update handler carries it, for
  Phase 6's AI recaps.
- **No component tests**, unchanged since Phase 1 — that needs jsdom and a testing library, i.e. new
  devDependencies beyond the one permitted.

### Open questions for the next session

1. **The ABI blocker is now the top risk, not an annoyance.** Five phases of "verified by reading, not
   by use", and this phase had the most UI of any. I would spend the first hour of Phase 5 on Node 20
   via nvm-windows or diagnosing node-gyp, before writing a line of feature code.
2. **Should `reveals` join `deleteWithPolymorphicRefs` now or in Phase 5?** It is a three-line change
   and the orphan is real today.
3. **Migration numbering has drifted from the brief twice** (Phase 3's 010, this phase's 011). Later
   phase briefs that name a migration number will be off by two. Worth a note in the plan document.
4. **konva / react-konva peer mismatch** — unchanged since Phase 0.

---

## Phase 4.5 — Pre-flight: runnable app, merged main

**Date:** 2026-09-13
**Branch:** `phase-4.5-fixes` → merged to **`main`**, tagged **`v1.1.0-alpha.1`**.
**Verdict changes:** none. No new features.

### The headline: the app runs

```
[DB] Path: C:\Users\chris\AppData\Roaming\dmcs\dmcs.db
[AI] Mode: offline-ollama
WINDOW: DM Campaign Suite
```

`npm run dev` opens the DM window on **Node 22.11.0** from **`C:\dev\dmcs`** with no
`NODE_MODULE_VERSION` error. The five-phase ABI blocker is gone.

### 1. Diagnosis — the toolchain was never the problem

| Check | Result |
|---|---|
| Repo path | `C:\Users\chris\Desktop\Dungeon Master Campaign Suite` — **contains spaces** |
| Python | **3.14.5 present** |
| Visual Studio C++ Build Tools | **Visual Studio Community 2026 (18.6.11819.183) present** |
| Node | 24.13.1 — outside the `>=20 <23` pin |

Both toolchain prerequisites were already installed. The two real causes were the
path and the Node version, exactly as the README's Troubleshooting section
predicted.

**The working tree was CLONED, not moved,** to `C:\dev\dmcs`. Your Desktop copy is
untouched and still the canonical repo — all branches and the merge live there.
`C:\dev\dmcs` is a build/run environment only.

> **Recommendation, your call:** the Desktop path can never run `npm install`
> cleanly, because node-gyp still chokes on the spaces. Either work from
> `C:\dev\dmcs` permanently, or move the Desktop folder somewhere space-free.

### 2. Node pinned

nvm-windows 1.2.2 installed via winget; **Node 22.11.0** installed and active.
Note that nvm-windows put itself in `%LOCALAPPDATA%\nvm` with symlink
`C:\nvm4w\nodejs` — neither is on the inherited `PATH` in a non-interactive
shell, so scripted use needs `NVM_HOME`/`NVM_SYMLINK` prepended.

### 3. The native build — `postinstall` was lying

A clean `npm install` (empty `node_modules`, no lockfile) printed
`✔ Rebuild Complete`, and the binary was **still wrong**. Verbose output gave the
reason:

```
electron-rebuild assuming is prebuild-install powered: better-sqlite3
electron-rebuild triggering prebuild download step: better-sqlite3
electron-rebuild installed prebuilt module: better-sqlite3
```

`electron-rebuild` **does not compile** better-sqlite3 — it detects
`prebuild-install` and downloads a prebuilt binary, and the one it fetched was
the Node-ABI build. `--build-from-source` forces a real compile and produces the
correct ABI-130 binary:

```
better-sqlite3 under Electron 33.4.11 (ABI 130): loads, CREATE/INSERT/SELECT work
better-sqlite3 under Node 22.11.0  (ABI 127): NODE_MODULE_VERSION 130 vs 127 — correctly rejected
```

**This means `npm run postinstall` as written can leave a broken binary while
reporting success.** Not changed in this phase — changing the postinstall script
affects every install and deserves its own decision — but it is the single most
likely thing to waste the next person's afternoon. See Open Questions.

### 4. konva — resolved, not suppressed

Checked rather than assumed, as the brief required:

| react-konva | konva peer | react peer |
|---|---|---|
| 18.2.10 (was) | ^7/^8/^9 | >=18.0.0 |
| 19.0.7 | ^7/^8/^9 | ^18.3.1 \|\| ^19.0.0 |
| **19.0.8 – 19.0.10** | **^7/^8/^9/^10** | **^18.3.1 \|\| ^19.0.0** |
| 19.2.7 (latest) | ^7/^8/^9/^10 | **^19.2.0** — too new |

`react-konva@19.0.8` is the first release accepting konva 10, and 19.0.x still
accepts React 18.3.1 — **so konva does not need downgrading and React does not
need upgrading.** Pinned to `~19.0.10`, not `^19.0.10`: the caret would drift onto
19.2.x and its React-19 requirement. There is no 19.1.x.

**`legacy-peer-deps=true` is gone from `.npmrc`.** A clean install now resolves
with no ERESOLVE and no flags. It was never a fix — it told npm to ignore a real
conflict. Side benefit: reported vulnerabilities dropped from 40 to 18.

### 5. Reveals orphan cleanup

`reveals` joins `connections` and `mind_map_positions` in
`deleteWithPolymorphicRefs`. Phase 4 introduced the table with the same
polymorphic shape and inherited the same problem — and it was worse than a
cosmetic orphan: the player's "What you know" view silently skipped the dead row,
so it looked fine, but **a new entity later given that id would have inherited the
reveal**, showing players something never revealed.

Six checks added to `verify-sessions.mjs` (51/51), including that deleting an NPC
does not touch a *location* sharing its id.

### 6. Click-through — what was and was not verified

**I could not drive the GUI.** The computer-use tool resolves applications by
installed or running name, and a dev-mode Electron app launched from
`node_modules` matches none of `DM Campaign Suite`, `Electron`, or `dmcs`. Four
attempts, all rejected before any dialog reached you. **No item below was verified
by clicking.**

What I did instead: `scripts/verify-app-electron.mjs` runs **inside Electron**
against a **fresh database**, driving the real `DatabaseService` (real migrations,
real seeding, real better-sqlite3) and the real `deleteWithPolymorphicRefs` lifted
out of `dbHandlers.js`. **52/52.** That proves the behaviour behind each item in
the shipping code on the real runtime. It does not prove a button is wired to it,
that anything renders, or that a toast appears.

| # | Click-through item | Result |
|---|---|---|
| 1 | Create campaign; set description; card shows it (not session notes) | **PASS (data)** — description stored and unchanged after session notes are written. Card *rendering* not verified. |
| 2a | Delete a location with an NPC → succeeds, NPC survives with no location | **PASS (data)** — NPC, map and encounter all survive with `location_id` NULL |
| 2b | Delete an NPC with a connection and a reveal → both rows gone | **PASS (data)** — connection, reveal and mind-map position all removed |
| 3 | Trigger a handler error → a toast appears, never silence | **PARTIAL** — NOT NULL and CHECK violations throw catchable errors whose text `friendlyIpcError` rewrites (unit-tested, Phase 1). **The toast itself was not seen.** |
| 4 | `no-ai` mode: suggestion panel shows the API-key message; Rules Q&A shows passages | **NOT VERIFIED** — and not testable as specified: this machine has **Ollama running**, so the app reports `offline-ollama`, not `no-ai`. The `no-ai` paths are covered by `test:rag` (42/42) at the service layer. |
| 5 | Sessions: create three, type notes, blur → saved indicator; card shows "3 sessions" | **PASS (data)** — three sessions numbered 1..3, `session_count` = 3, `updateNotes` writes notes without clobbering the title, `campaigns.description` untouched. **Indicator and card not seen.** |
| 6 | CampaignManager textarea edits the current session, not the description | **PASS (data)** — asserted directly: writing session notes leaves `description` byte-identical |
| 7 | Plot board: create, move through all four statuses, link to a session | **PASS (data)** — open → active → resolved (stamped with session) → reopened (stamp cleared) → abandoned; survives deletion of its opening session with a NULL link |
| 8 | Reveal toggle on Lore/NPCs/Locations/Factions; secret item asks first | **PARTIAL** — reveal / re-reveal / unreveal semantics PASS. **The confirm dialog is renderer-only and was not seen.** |
| 9 | Player window "What you know" lists revealed items and nothing DM-only | **PASS (API)** — `test:server` 62/62 includes five checks asserting `secrets`, `motivation`, `notes` and `lore` appear nowhere in the raw response. **The tab was not opened.** |
| 10 | Mind Map: eight types selectable, default shows three, 20+ nodes render | **NOT VERIFIED** — entirely a rendering claim |
| 11 | Attached panel shows a location's NPCs, maps and encounters | **PASS (data)** — all three `getByLocation` queries return the right rows. **Panel not seen.** |
| 12 | Map Engine: upload, paint fog, place token, grid-size prompt, pop-out | **NOT VERIFIED** — entirely rendering and canvas interaction |
| 13 | Remote player: start server, join with token; `curl` without token → 401 | **PASS (API)** — `test:server` 62/62 against a real running `PlayerServer`, including the 401. **No browser joined.** |
| 14 | Encounter Builder: 4× CR 2 vs four L5 → Hard | **PASS** — 3600 adjusted XP, "Hard", using the renderer's own `encounterUtils` source |

**Summary: 9 PASS (data/API), 2 PARTIAL, 3 NOT VERIFIED.** Everything not verified
is a rendering or interaction claim. No data-layer item failed.

### Bonus finding: the migrations ran against your real database

`npm run dev` opened `%APPDATA%\dmcs\dmcs.db` — your actual campaign — which was
still at **migration 2**. Migrations 3 through 11 applied to it in one go. This
was not planned (the brief assumed a fresh database) but it is the strongest
evidence available, so it was verified rather than discarded:

```
campaigns:  #1 The Chosen's Folly   session_count=1   description=66 chars
sessions:   #1 campaign 1  session 1  "Imported notes"  notes=66 chars
            description vs session notes: identical=YES
row counts: locations 2, factions 2, maps 1, connections 1, srd_cache 902, subclasses 27
schema:     all six Phase 1/3/4 properties present
integrity:  foreign_key_check violations 0, integrity_check ok
```

**Rule 10 held on real data**: the description was copied, not moved, and both
copies are byte-identical. A snapshot was taken at
`%APPDATA%\dmcs\dmcs.db.snapshot-after-migrations-009-011-20260912-235341`
(named for what it is — it was taken *after* the migrations, so it is not a
pre-migration rollback point).

### 7-9. Merge

All six branches formed a clean linear chain and **every merge fast-forwarded**:

```
main 08a8f94 → phase-0 → phase-1 → phase-2 → phase-3 → phase-4 → phase-4.5
main afa9c8a  (71 commits)   tag v1.1.0-alpha.1
```

`scripts/screenshots/` untracked (17 PNGs, gitignored since Phase 0, files kept
on disk).

### Acceptance

| Check | Result |
|---|---|
| `npm run dev` opens the DM window on Node 20/22 from a space-free path, no ABI error | **PASS** |
| `.npmrc` no longer needs `legacy-peer-deps` | **PASS** — file contains no settings at all |
| Every click-through line has a recorded result | **PASS** — 14 lines, none blank; 3 recorded as NOT VERIFIED with the reason |
| Deleting an entity with a reveal leaves zero orphaned reveals | **PASS** — harness-verified twice (`test:sessions`, `verify-app-electron`) |
| `main` contains all phases; `npm test` and all `test:*` green on main | **PASS** |

**On main, Node 22.11.0:**

```
npm test              446 passed | 1 expected fail | 2 todo
test:sessions         51/51
test:migrations       62/62
test:rag              42/42
test:server           62/62
test:ipc              0 problems
verify-app-electron   52/52   (inside Electron, fresh database)
build:renderer        clean
```

### Fixed along the way

- **The three `node:sqlite` harnesses did not run on the pinned Node.** They were
  written on Node 24, where that module is unflagged; Node 22 needs
  `--experimental-sqlite`, now passed by the npm scripts. **Node 20 has no
  `node:sqlite` at all**, so those three need Node ≥ 22.5 even though `engines`
  allows 20.

### Deferred / known issues

- **`npm run postinstall` can report success while leaving a Node-ABI binary.**
  The fix is `--build-from-source` in the postinstall script, but that makes every
  install compile from source (slower, and needs the toolchain present), so it is
  a real trade-off rather than an obvious win. Currently a manual step after
  install; documented in the README.
- **`npm run dev` has no port guard.** Vite falls back to 5174 when 5173 is taken,
  but `wait-on` watches 5173 unconditionally, so Electron silently never launches
  and the terminal looks like it is still starting. Bit me once during this phase.
- **The UI is still unclicked.** Nine of fourteen items are verified at the data
  layer only.

### Open questions

1. **Do you want the Desktop working tree relocated?** It cannot build where it
   is. I cloned rather than moved, so nothing was disturbed — but that leaves two
   copies, and only one of them can run.
2. **Should `postinstall` force `--build-from-source`?** It would make the
   documented install actually work, at the cost of a slow compile on every
   install and a hard dependency on the C++ toolchain.
3. **The `no-ai` click-through item cannot be tested on this machine** without
   stopping Ollama and removing the API key. Worth doing once deliberately.
4. **A GUI driver for dev-mode Electron** would close the remaining gap — Electron
   exposes a DevTools protocol port, which Playwright can attach to, and
   `playwright-core` is already a devDependency. That is a Phase 5 conversation.

---

## Phase 5 — Combat that survives

**Date:** 2026-09-13
**Branch:** `phase-5-combat` (from `main` @ `7d9060d`, tag `v1.1.0-alpha.1`)
**Verdict changes:** Encounter Builder moves from *combat is lost on navigation* to *combat is
durable*. The initiative tracker is now the first module verified end to end by clicking the real
app rather than by reading the code.

### Pre-tasks

**P1-P3. Renderer unbroken, scratch database, doctor** — `64487d8`, `251bce0`

- **Phase 4.5's konva "fix" had broken the entire renderer.** `react-konva@19.0.10` declares a peer
  range of `react: ^18.3.1 || ^19.0.0` but throws on import — *"react-konva version 19 is only
  compatible with React 19."* `#root` stayed empty on every route. The app still launched, opened
  its database and served IPC, and `build:renderer` passed, which is exactly why 4.5 missed it.
  Taken the brief's other branch instead: `konva@^9.3.22` + `react-konva@^18.2.10`, with
  `legacy-peer-deps` still removed. `.npmrc` now contains comments and zero settings.
- `DMCS_USER_DATA` is read in `main.js` before anything calls `getPath('userData')` — Electron
  caches that on first read — and `npm run dev:scratch` sets it. **The developer's real campaign at
  `%APPDATA%/dmcs` is not opened by any development session.** A rollback copy was taken first:
  `%APPDATA%/dmcs/backups/dmcs-2026-09-13-pre-phase5.db`.
- `npm run doctor` checks Node against `engines`, `node:sqlite` availability, whether
  `better-sqlite3` actually loads **inside Electron** (printing the ABI mismatch verbatim and the
  `--build-from-source` fix), spaces in the repo path, ports 5173/5174/3001, and warns when
  `DMCS_USER_DATA` is unset.
- Vite now uses `strictPort: true` on both 5173 and 5174, closing the silent-fallback trap recorded
  as a Phase 4.5 known issue.

**P4-P6. The UI driver** — `0b7d15f`

`scripts/ui-driver.mjs` launches Electron through Playwright and drives the **built** renderer.
Three things had to be got right before it worked at all, each recorded here because each looked
like a product bug first:

- `NODE_ENV=development` makes `main.js` load `localhost:5173`, so with no Vite running
  `window.electronAPI` was undefined. The driver runs `dist/renderer` instead — self-contained, and
  the path that actually ships.
- Every click was being swallowed: the SRD first-run modal is `position: fixed` over everything.
  `dismissFirstRun()` clicks "Skip for now (offline)" on launch.
- The Map Engine canvas never mounted because clicking a map card's *title* does nothing; there is
  an explicit **Open Map** button.

`scripts/ui-verify.mjs` then proved five Phase 1-4 features by rendering them: 7 PASS / 0 FAIL.

### What shipped

**1. Migration 012 — `combat_state`** — `446b300`

One row per encounter under `UNIQUE(encounter_id)`, so saving is an upsert and an encounter can
never accumulate two fights. `ON DELETE CASCADE` from both `campaigns` and `encounters`. The
combatants and log are stored as versioned envelopes (`{ schema_version, combatants }`), which is
what lets `src/utils/combatPersistence.js` upgrade an older save instead of discarding it — it also
accepts a bare legacy array, and returns `null` on corruption so a bad save starts a fresh fight
rather than crashing the one screen a DM needs mid-session.

Five handlers across all four IPC layers: `db:combat:get`, `getActiveForCampaign`, `save`, `clear`,
`getAllForCampaign`. 182 channels total, all layers matched.

**2. Real AC, correct death saves, and the rules the tracker was missing** — `ece0356`

- `parseArmorClass` copes with every shape the SRD uses (number, array of `{type,value}`, object,
  string). `createMonsterEntry` never wrote an `ac` field at all, so `entry.ac ?? 10` meant **every
  monster entered initiative at AC 10** however armoured its stat block said it was.
- Player AC was `10 + dexMod`, ignoring armour entirely — a plate-clad fighter entered combat at
  AC 9. `buildCombatants` now uses `calculateAC`, the same function the character sheet displays,
  so the tracker and the sheet can no longer disagree.
- Death saves: the old CharacterSheet roller gave a natural 20 *two successes*. The rule is that the
  creature regains 1 hit point and stops dying. `applyDeathSave` implements the real rule and clears
  both counters.

**3. Persistence, write-back, and the rest of the rules** — `25bc7a3`

- Load-or-build on mount; ~500 ms debounced save compared against the last payload; save on unmount;
  `handleEndCombat` clears the row.
- Player HP queued to `characters` on every hit, coalesced to one write per second with the last
  value winning, flushed on unmount. A crash now costs at most a second of damage rather than the
  whole fight.
- Temp HP, death-save pips, legendary pips, reaction toggle, lair-action row.
- `applyHP` resolves the change once through `applyHPDelta`, so the log entry, the unconscious check
  and the write-back all describe the same numbers the roster ends up with. Computing it twice is
  how they came to disagree when temp HP was involved.

**4. Resume UX** — `f363853`

Encounter cards carry a "Combat in progress — round N" banner and a **Resume combat (round N)**
button; the top bar shows the same fact on every screen. The top bar polls rather than listens,
because combat is saved from the renderer and `player:broadcast` does not reach it.

**5. Tracker joined to the map** — `83ec526`

`src/utils/tokenCombatLink.js` (new, 19 tests) matches player tokens on `entity_id` and monsters on
name — and an **ambiguous name matches nothing**, because showing one of two goblins' HP and letting
the DM believe it is worse than showing nothing. `summariseForMap` trims a combatant to the nine
fields the map renders.

The two windows are deliberately not shown the same thing: the DM's `TokenInspector` gives exact hit
points and temp HP, the players' screen gives a band (Unharmed / Wounded / Bloodied / Badly wounded
/ Down). Phase 2 established that the player window is not trusted with DM information, and a
monster's hit point total is the clearest example of it.

**6. Docs** — this entry, plus a **Combat that survives** section in the README and a schema table
completed through migration 012 (it had been stale at 008 since Phase 1).

### Acceptance

Run through `scripts/ui-driver.mjs` against the scratch database — `npm run verify:combat`. Every
line is a click on the built renderer in a launched Electron window, with a screenshot recorded in
`scripts/screenshots/` (gitignored). **16 PASS · 0 FAIL · 0 NOT VERIFIED.**

| Check | Result | Detail | Screenshot |
|---|---|---|---|
| Tracker opens in setup phase with the encounter roster | **PASS** | roster built from the encounter | `c01-combat-setup.png` |
| AC shows the creature's armour class, not a flat 10 | **PASS** | AC badges: 15, 19, 15, 10, 10 — the two goblins carry **no `ac` field**, so 15 is the backfill working | `c02-ac-from-statblock.png` |
| Beginning combat writes a `combat_state` row | **PASS** | round 1, phase active, 5 combatants, schema v1 | `c03-combat-persisted.png` |
| A creature with lair actions adds a row at initiative 20 | **PASS** | row present | `c04-lair-action-row.png` |
| Round increment resets legendary actions and reactions | **PASS** | round 2, legendary 0/3 used, 0 reactions outstanding | `c05-round-advance-resets.png` |
| Damage to a player is written back to `characters` mid-fight | **PASS** | `characters.hp_current` 40 → 28 | `c06-hp-writeback.png` |
| Temporary hit points are tracked per combatant and persisted | **PASS** | field present and round-trips; the grant/absorb rules are covered by 35 unit tests | `c07-temp-hp-state.png` |
| Encounter list offers "Resume combat (round N)" | **PASS** | resume button present | `c08-encounter-list-resume.png` |
| Top bar shows a combat-in-progress link on every screen | **PASS** | link present | `c08-encounter-list-resume.png` |
| Navigating away and back resumes the fight at the same round | **PASS** | tracker shows round 2, `combat_state` has 2 | `c09-resumed-after-navigation.png` |
| **Closing the app mid-combat and relaunching keeps the fight** | **PASS** | `app.close()` without ending combat; round 2→2, 5→5 combatants, Thorin 28→28 HP | `c10-relaunch-resume-offered.png` |
| After a relaunch the encounter list still offers the resume | **PASS** | resume button present | `c10-relaunch-resume-offered.png` |
| A player at 0 HP shows death-save pips inline | **PASS** | pips and roll button rendered | `c11-death-saves-visible.png` |
| Rolling a death save records the result and persists it | **PASS** | counters advance and survive the round trip | `c12-death-save-rolled.png` |
| Ending combat clears the saved row | **PASS** | `db:combat:get` returns nothing | `c13-end-combat-clears.png` |
| No renderer console errors during the run | **PASS** | clean | — |

**Harnesses, Node 22.11.0:**

```
npm test              583 passed | 0 expected fail | 0 todo
test:migrations       76/76   (fresh database AND one holding rows from the previous schema)
test:ipc              0 problems, 182 channels
verify:combat         16 PASS / 0 FAIL
build:renderer        clean
```

`test:migrations` covers 012 specifically: a fight saves, its combatants survive the round trip,
saving again upserts rather than duplicating, a second fight for the same encounter is refused, an
invalid phase is refused, deleting the encounter clears its saved fight, and
`PRAGMA foreign_key_check` passes afterwards.

### The bug the driver found

**Ending combat deleted the saved row and then immediately recreated it.**
`handleEndCombat` opens with `addLog('end', …)`, which is a state change, so it scheduled a
debounced save that landed *after* the delete — and the unmount save fired again as `onEndCombat`
navigated away. The row came back with a new id and the fight appeared to still be running; the
encounter list went on offering "Resume combat". An `ended` ref now blocks both write paths.

This is the first bug in five phases found by driving the UI rather than by reading it, and it was
invisible to every other harness: the handler was correct, the channel was correct, the unit tests
were correct, and the delete genuinely ran.

Three further driver failures on the first run were faults in the **seed data**, not the product,
and are recorded here because each would otherwise look like a regression: monster entries use
`count` rather than `quantity`, and the encounter and character create handlers stringify their own
JSON, so passing pre-stringified values double-encoded them.

### A second thing the screenshots found

A banner under the tracker header still read *"Combat state is not saved. Closing the app will
reset initiative."* All sixteen checks passed with it on screen — no assertion looks at text
nobody thought to assert on. It was caught by opening the PNGs, and is fixed in `a9a666f`: the
line now states that combat is saved and what clears it, or that the fight was resumed. That also
gave the `resumed` flag its first reader.

### Deferred / known issues

- **`srd_cache` has no writer on the preload bridge.** `srd:seedAll` fetches from dnd5eapi.co, so a
  driver run with no network cannot populate it through the app. `ui-verify-combat.mjs` writes the
  two stat blocks into the scratch database directly, between launches, using `node:sqlite`. This is
  fine for a test but means the AC backfill is exercised against seeded rows rather than a real SRD
  import.
- **Death saves are synced to the character sheet with a read-modify-write.** `characters.stats` is
  a single JSON blob and `db:characters:updateStats` replaces it wholesale, so the tracker reads the
  row fresh and merges. In a single-user desktop app this is safe; it would not be under
  concurrency.
- **The players' map does not show whose turn it is until the DM advances a turn.** `combat:select`
  is broadcast on turn change only, so a player window opened mid-round has no highlight until the
  next Next Turn.
- **`npm run postinstall` can still report success while leaving a Node-ABI binary** — unchanged
  from Phase 4.5, and still documented in the README rather than forced.

### Open questions

1. **Should a lair-action row be rollable?** It currently logs its use when clicked. Some tables
   roll initiative for the lair rather than using the fixed 20; the fixed count is the DMG default
   and is what is implemented.
2. **Should ending combat archive the fight rather than delete it?** The row is currently deleted,
   which is the only destructive path in the phase and is behind a confirm step. A `phase = 'ended'`
   row kept for the session log would make the combat log survivable, at the cost of growth.
3. **How should two monsters with the same name be distinguished on the map?** `buildCombatants`
   already names them "Goblin 1" and "Goblin 2", but a token placed by hand and labelled "Goblin"
   matches neither, by design. Pushing tokens from the tracker gets this right; hand-placed tokens
   need the DM to match the name.
4. **`isDying` treats any player at 0 HP as dying.** A player killed outright by massive damage
   (overkill ≥ max HP) should skip death saves entirely. `applyHPDelta` already reports `overkill`,
   but nothing consumes it yet.

---

## Phase 6 — AI that writes to the world

**Date:** 2026-09-13
**Branch:** `phase-6-ai-writes` — **branched from `phase-5-combat`, not from `main`** (see below)
**Verdict changes:** **Q3 MISSING → SOLVED.** AI output is saveable, the model is
shown the DM's actual lore, and session recaps exist. Q2 also improves: campaign
lore is now retrievable, which is what makes "does this contradict anything?"
answerable.

### Why this branched off Phase 5 rather than main

Standing rule 1 says branch from main. Main cannot host this phase:

- `main` still has `react-konva@~19.0.10`, which throws on import — **the
  renderer does not render at all there.** Not a single UI acceptance line could
  have been run.
- `main` has no `DMCS_USER_DATA` guard in `electron/main.js` and no
  `dev:scratch` script, so any launch would open the developer's real campaign
  at `%APPDATA%/dmcs` — which the Phase 5 brief forbids.

Both are fixed on `phase-5-combat` and nowhere else. Phase 6 therefore branches
from it, and the branch contains Phase 5's 12 commits underneath its own 20.
**Merge Phase 5 first, or merge this branch and get both.**

### What shipped

**1-2. Suggestions that save** — `20079a6`, `e167b7e`

`src/utils/worldSuggestions.js` (new, 70 tests) holds the JSON contract, the
parser, per-kind field coercion, the payload shapes the four existing create
handlers expect, and the name→id resolution that turns a suggestion's `links`
into `connections` rows. `src/components/ai/SuggestionCards.jsx` renders each
suggestion as an editable card with **Save** and **Save all**.

The awkward cases, each of which a DM would otherwise meet as a raw SqliteError:

- `locations.type` has a CHECK constraint, and a model asked for a thieves' guild
  answers `"guildhall"`. Synonyms are mapped; anything unrecognised becomes
  `landmark`, and `normaliseLocationType` can never return a value outside the
  constraint.
- An unresolvable link is **reported**, not dropped silently.
- A→B and B→A collapse to one row.
- One malformed entry drops itself rather than failing the batch.

No second parser: the repair rules stay in `compendiumExtractor.js`, now exported
as `extractJsonObject` / `extractJsonValue` and shared with the PDF importers.
`extractJsonValue` adds top-level array support, because asked for
`{ suggestions: [...] }` local models frequently answer with just the array.
That refactor touched code the importers had relied on since Phase 3 with **no
test covering it**, so `compendiumExtractor` now has its own suite (25 tests).

**3. Chat persists** — `e167b7e`. `aiStore` gains zustand's `persist`, per
campaign. `isStreaming` is deliberately not persisted: restoring it would leave
the composer disabled with no way back. `sanitiseHistory` (12 tests) strips
stream cursors and error bubbles, and drops messages left as nothing but a
cursor by a stream cut off mid-flight.

**4. Save from chat** — `e167b7e`. "Save as…" on any assistant message opens the
same cards, running the structured extraction over that message's text.

**5. Encounter advice you can apply** — `3f7ab9b`. `src/utils/encounterAdvice.js`
(new, 52 tests). `applyAdvice` is pure, which is what makes the edge cases
testable: a count of 0 would silently do nothing and −3 would invert the
operation (floored at 1); removing more than the roster holds drops the entry
rather than going negative; a "replace" naming no replacement is refused rather
than guessed at. Saving goes through `db:encounters:updateMonsters` rather than
the `db:encounters:update` the brief named — that one rewrites every column, so
a stale name or status held in the component would overwrite what the DM typed
elsewhere. Same table, same effect, no clobber.

**6. Context budget** — `e167b7e`. `src/utils/aiContext.js` (new, 39 tests)
replaces the `buildSystemPrompt` that lived in `AIAssistant.jsx` and
interpolated every character and every faction with no cap. Sections fill in
priority order under a character budget (default 6,000, configurable in
Settings), so an oversized world loses the long tail of NPC names, never the
party or the current session. The prompt states how many it omitted.

**7. Campaign lore indexed and retrieved** — `f8ef6a1`.
`electron/services/CampaignLoreIndex.js` creates one sentinel `pdf_sources` row
per campaign and one `pdf_chunk` per entity, so `embedSource`, `search` and
`deleteSource` work unchanged. `EmbeddingService.deleteChunks(ids)` is new —
without it an edited entity left its old vector behind and a renamed NPC kept
retrieving under the old name forever. Each message pulls the top 3 relevant
entries into context, scoped to that source. The contradiction check on a card
retrieves the same way.

**8. Session recaps** — `08740bb`. `sessions.recap` already existed (migration
011), so no migration. The player variant filters the **input**: a model told
"do not mention the traitor" will mention the traitor, so unrevealed secrets
never reach the request.

**9. no-ai everywhere** — `ebbcec5`. See "Bugs found" below.

**10. Docs** — this entry, plus a README section, the recap subsection, three
module-table rows and the new test scripts.

### Acceptance

`npm run verify:ai` — every line clicked in a launched Electron window against a
scratch database, with a screenshot each, **calling Ollama for real**
(`llama3:latest` + `nomic-embed-text`). **14 PASS · 0 FAIL · 0 NOT VERIFIED.**

| Check | Result | Detail | Screenshot |
|---|---|---|---|
| World Builder offers a free-text request box | **PASS** | input present | `a01-suggestion-panel.png` |
| Request "a rival thieves' guild in Waterdeep" returns saveable cards | **PASS** | 4 editable cards | `a02-suggestion-cards.png` |
| Save all writes a faction, an NPC, a lore entry and ≥ 2 connections | **PASS** | 1 faction, 2 NPCs (was 1), 3 lore (was 2), 5 connections | `a03-saved-records.png` |
| The saved records and their links appear in the Mind Map | **PASS** | 5 nodes, 3 edges | `a04-mindmap.png` |
| The AI page shows the context budget and stays inside it | **PASS** | 788 / 6000 chars | `a05-context-budget.png` |
| Indexing the campaign writes one chunk per entity | **PASS** | 8 chunks, 0 left to embed | `a06-lore-indexed.png` |
| Chat history survives an app restart | **PASS** | probe message on screen after relaunch | `a07-chat-persisted.png` |
| Sessions offers both recap variants | **PASS** | DM and player buttons present | `a08-session-detail.png` |
| A DM recap references the revealed lore | **PASS** | 1,291 chars written to `sessions.recap` | `a09-recap-dm.png` |
| The player recap is generated separately and carries its caveat | **PASS** | 1,087 chars, distinct from the DM recap, caveat shown | `a10-recap-players.png` |
| no-ai: the AI Assistant composer is disabled | **PASS** | textarea and Ask both disabled | `a11-no-ai-assistant.png` |
| no-ai: the World Builder panel says so instead of offering a button | **PASS** | "AI not configured" shown | `a12-no-ai-world-panel.png` |
| no-ai: no raw service error is rendered anywhere | **PASS** | clean | `a12-no-ai-world-panel.png` |
| No unexpected renderer console errors | **PASS** | clean | — |

The acceptance line *"with 60 factions seeded, the system prompt stays under the
budget"* is asserted in `aiContext.test.js`, as the brief specifies — plus a
sweep across sizes 0-250 and budgets 600/1500/6000, and a 500-NPC /
200-faction / 300-location / 400-lore world.

`a02-suggestion-cards.png` is the one to look at: llama3 proposed **The
Blackened Blades** with its leader, and the NPC card carries a link pill
`rivals → Durnan` — the seeded NPC that already existed. Cross-linking new
records to the existing world works.

**Harnesses, Node 22.11.0:**

```
npm test              850 passed | 0 expected fail | 0 todo
test:lore             44/44   (real database, stubbed embedder)
test:migrations       76/76
test:ipc              0 problems, 184 channels
test:rag              42/42
test:server           62/62
verify:combat         16 PASS / 0 FAIL   (Phase 5, still green)
verify:ai             14 PASS / 0 FAIL   (against real Ollama)
build:renderer        clean
```

### Bugs found

**Three the UI driver caught, none findable by unit test:**

1. **The AI page crashed on every render.** My own no-ai sweep declared
   `const noAi` *below* `handleSend`, which names it in its dependency array —
   evaluated during render. Every visit threw "Cannot access noAi before
   initialization" and React unmounted the tree. That single fault is why the
   budget pill, the Sessions buttons and the disabled composer all appeared
   broken at once.
2. **A generated recap was saved and then vanished.** `Sessions.load()` set
   `loading` true on every background refresh, swapping the pane for a skeleton —
   which unmounted `SessionDetail` and discarded its state, then remounted from a
   `detail` prop that had not been refetched. The recap was in the database the
   whole time. **This predates Phase 6**: any half-typed title or notes edit was
   lost the same way after every autosave.
3. **The suggestion prompt was too soft.** Asked for "typically a faction, the
   NPC who runs it, the place it operates from, and a lore entry", llama3
   reliably returned the first three and omitted the lore entry — the one
   carrying the DM's actual fiction. Now a numbered checklist the response MUST
   satisfy.

**Two the no-ai sweep caught, both long-standing:**

4. **`AIInsightsPanel` had the exact bug the capability review documented for
   `AISuggestionPanel`** — comparing the `getMode()` object to the string
   `'no-ai'`, always false. A DM with no AI got "No AI service available…"
   rendered as a mind-map insight.
5. **`AICharacterAssistant` was broken twice over**: it stored the mode object
   whole, *and* tested for `'claude'` / `'ollama'`, which `ai:getMode` has never
   returned. Fixing only the object would have left it still reading as
   unavailable. Its gating was correct all along — it simply always took the
   offline branch, so the character sheet's AI actions have **never once been
   offered to anyone**.

**One found writing the tests:** my own player-recap filter tested a lore entry's
`is_secret` flag against the reveals list the entry had just come out of, so the
check could never fail. The rule is now non-circular.

### Data safety

The lore sync deletes stale `pdf_chunks` rows, scoped to the sentinel source and
guarded by `assertOwnSource`. These are regenerated output, not authored
content — the campaign's own tables remain the record and a re-sync rebuilds
them — so this is not the copy-then-repoint case standing rule 10 covers.
Nothing a DM typed is deleted. `verify-lore-index.mjs` seeds a real PDF source
with chunks, syncs twice, and asserts its rows, text and embedded flags all
survive.

### Deferred / known issues

- **Lore is indexed on demand, not on every world save.** The brief asks for
  re-embedding an entity on save, debounced. Embedding costs an Ollama call per
  changed entity, so a DM typing in an NPC's notes should not trigger it per
  keystroke. It runs from the AI page and after the AI itself writes records —
  the two moments the index is about to be read. Hooking the other eight world
  save sites is the complete version and is not done.
- **`sessions.notes` cannot be structurally filtered** for the player recap. The
  prompt and the UI both say so; it is a mitigation, not a guarantee.
- **Death-save style contradiction checking is advisory only.** An unparseable
  answer is treated as "clear" on purpose — a broken advisory must not block a
  DM writing to their own world.
- **`CampaignLoreIndex` duplicates `buildLoreChunks` from `loreCorpus.js`**,
  because `electron/` is CommonJS and `src/` is ESM and the build does not bridge
  them. Both are covered — `loreCorpus.test.js` for the shape,
  `verify-lore-index.mjs` for the main-process copy — but they can drift.
- **llama3 quality is the weak link, not the plumbing.** The parser survives what
  it returns, but an 8B model writes thinner lore than Claude would. Nothing in
  the app depends on model quality; the cards are editable before saving.

### Open questions

1. **Should a saved suggestion be marked as AI-generated?** Nothing distinguishes
   an AI-written faction from a hand-written one after the save. A provenance
   column would let a DM audit or bulk-revert, at the cost of a migration.
2. **Should "Save all" be undoable?** It can write six records and five
   connections in one click. There is no transaction and no undo; a mistake is
   cleaned up by hand.
3. **Should the lore index include plot threads and sessions?** Currently lore,
   NPCs, locations and factions. Session notes are the largest body of prose a
   campaign has, and indexing them would make "what happened with the duke?"
   answerable — but they are also where unfiltered secrets live.
4. **Is the 6,000-character default right?** It is ~1,500 tokens, comfortable for
   Claude and about a fifth of llama3's context. A local-model default of 3,000
   and an online default of 12,000 might serve both better than one number.

---

## Phase 6.1 — AI mode detection, provider choice, and making main runnable

**Date:** 2026-09-14
**Branch:** `phase-6.1-ai-mode`, from `phase-6-ai-writes`

### Diagnosis (Part A) — evidence first

**The app was never told the key was unreadable, so it behaved as though there
were no key while the UI insisted there was one.**

`%APPDATA%\dmcs\dmcs.key` exists (139 bytes, written 2026-07-23), which is why
Settings showed a masked field and a "Remove Key" button — `KeyService.hasKey()`
(`KeyService.js:30`) only calls `fs.existsSync`. But
`safeStorage.decryptString` **fails** on that file today, and
`KeyService.loadKey()` (`KeyService.js:16-24`) catches the failure and returns
`null`. `AIService.initialize(null)` then skips the Claude branch entirely —
`if (apiKey)` is false (`AIService.js:17`) — so **no API call is ever attempted**
and there is no 401 or 404 to report. Detection falls through to Ollama; with
Ollama unreachable at that moment the mode lands on `no-ai`, with a saved key on
screen and no explanation anywhere.

Evidence, from `npx electron scripts/probe-anthropic.cjs --profile real`:

```
safeStorage      : available
key file         : 139 bytes, header "v10…"
fresh blob       : 47 bytes, header "v10…"
fresh round-trip : WORKS — encryption is healthy right now
decrypt stored   : FAILS — "Error while decrypting the ciphertext provided to
                   safeStorage.decryptString"
```

A fresh encrypt/decrypt round-trip succeeds **now**, and the stored blob carries
the same `v10` backend marker as a freshly written one — so this is not a
format or backend mismatch and safeStorage is not broken. The blob is simply no
longer decryptable by this OS user's current crypto key, which is what happens
after a Windows credential change or when the file was written under a different
account. **The developer must re-enter the key.** The app's fault is that it
never said so.

**Ollama is up right now**, so it is not the current obstacle:

```
curl http://localhost:11434/api/tags   →  HTTP 200
ollama list                            →  llama3:latest (4.7 GB)
                                          nomic-embed-text:latest (274 MB)
```

Detection runs **once**, at startup (`main.js:203-205`). Nothing re-runs it when
Ollama later comes up. So a DM who starts the app before Ollama is stuck on
`no-ai` until they restart — which alone explains a `no-ai` badge on a machine
where Ollama is currently reachable.

**Which profile.** `KeyService` captures `app.getPath('userData')` at
construction (`KeyService.js:7`), after `main.js` has applied `DMCS_USER_DATA`.
So the key lives per-profile. The key is in the **real** profile
(`C:\Users\chris\AppData\Roaming\dmcs\dmcs.key`); every scratch profile
(`.scratch-userdata`, `scripts/.ai-userdata`, `.ui-userdata`,
`.combat-userdata`) exists but holds **no** key. The developer's screenshot was
therefore a real-profile run (`npm run dev`), not a scratch one.

#### How the online check decided a key was "valid" (before this phase)

It made a real `POST /v1/messages` call with `max_tokens: 10` and the message
"ping", using the hard-coded model `claude-sonnet-5` (`AIService.js:13, 19-24`).
Any throw at all was caught by a **bare `catch {}` that captured nothing**
(`AIService.js:28-30`) and fell through to Ollama. A 401 (bad key), a 404 (bad
model id), a timeout and a DNS failure were therefore indistinguishable — to the
code and to the user. There was no record of the attempt anywhere.

#### How the Ollama check decided reachability

`GET {ollamaBaseUrl}/api/tags` via Electron's `net` module, where
`ollamaBaseUrl` is `process.env.DMCS_OLLAMA_URL || 'http://localhost:11434'`
(`AIService.js:11`). Any rejection meant `no-ai` (`AIService.js:33-38`), again
with the reason discarded. It did not check whether `llama3` or
`nomic-embed-text` were actually pulled — only that the endpoint answered.

#### Step 4 could not be completed: NOT VERIFIED

The task asks for `GET /v1/models` with the saved key, to record the HTTP status
and whether `claude-sonnet-5` appears. **This could not be run**, because the
saved key cannot be decrypted — that is the root cause itself. No API call was
made with it, and therefore:

- whether the key is valid or expired is **unknown**;
- whether `claude-sonnet-5` exists on the account is **unverified**.

`scripts/probe-anthropic.cjs` performs exactly this check and prints the model
list, the newest Sonnet id, and a verdict; it is ready to run the moment a
readable key exists. The "Fetch available models" button (task 8) does the same
from inside Settings. Until then the fallback constant is a documented default,
not an API-confirmed one, and that is stated in the UI.

#### Root causes, in order of what to fix

1. **A decryption failure is reported as "no key".** `loadKey()` swallows it and
   `hasKey()` disagrees with it. *(the reported bug)*
2. **The reason for every detection outcome is discarded.** A bare `catch {}`
   makes bad key, bad model id and offline identical.
3. **Detection never re-runs.** Startup only; Ollama coming up later cannot help.
4. **The renderer is never told the mode changed.** `ai:saveKey` re-initialises
   the service but nothing updates the TopBar or the gated components.
5. **"Test Connection" tests the mode, not the provider.** It calls `ai:complete`
   (`Settings.jsx:105`), which fails with "No AI service available" regardless of
   why — it can never diagnose anything.
6. **The model id is hard-locked** to `claude-sonnet-5` and never checked against
   the API.
7. **Electron's error prefix leaks.** Not `registerHandler`'s fault — it is
   wrapped correctly, and `src/utils/ipcError.js` strips the prefix properly.
   `Settings.handleTest` (`Settings.jsx:108`) and `handleTestTunnel`
   (`Settings.jsx:231`) simply use raw `err.message` instead of the helper.

### What shipped (Part B)

| # | Task | Where |
|---|---|---|
| 6 | `lastDetection` + `ai:getDetection`, rendered as two lines in Settings and in the badge tooltip | `AIService.js`, `aiDetection.cjs`, `Settings.jsx`, `TopBar.jsx` |
| 7 | 401/403 = bad key · 404 = bad model, key may be fine · network = offline · 429 = transient | `aiDetection.cjs` |
| 8 | Model id is a Settings field with "Fetch available models" (`GET /v1/models`) | `ai:setModel`, `ai:listModels` |
| 9 | Re-detect on key save/remove, provider switch, Ollama check, and a "Re-detect AI" button; `ai:modeChanged` broadcast | `aiHandlers.js`, `src/hooks/useAiMode.js` |
| 9b | `ai.preferredProvider` = auto/claude/ollama, persisted, no silent fallback | `ai:setProvider` |
| 10 | `ai:testClaude` / `ai:testOllama` talk to providers directly | `AIService.testClaude/testOllama` |
| 11 | 16 call sites switched from raw `err.message` to `parseIpcError` | across `src/` |
| 12 | Missing Ollama models named, with the exact `ollama pull` command | `missingOllamaModels` |
| 16 | `db:world:saveBatch` / `undoBatch` in one transaction; central debounced lore re-index | `dbHandlers.js`, `loreReindexQueue.cjs` |

The key fix is `KeyService.readKey()`: it reports a decryption failure instead of
returning `null` as though no key existed, and `ai:hasKey` now returns `readable`
alongside `hasKey`. Settings says, in as many words, that a saved key cannot be
read and must be re-entered.

`electron/services/aiDetection.cjs` holds the classification logic — pure, and
CommonJS so `AIService` requires it while Vitest imports the same copy. That
avoids the renderer/main duplication `CampaignLoreIndex` had to accept in Phase
6, and the Phase 6 entry's "they can drift" caveat does not apply here.

### Acceptance

`npm run verify:aimode` — every line clicked in a launched Electron window
against a scratch database, screenshot each. **14 PASS · 0 FAIL · 1 NOT VERIFIED.**

| Check | Result | Detail | Screenshot |
|---|---|---|---|
| No key and no Ollama: `no-ai` with two explanatory lines | **PASS** | `Claude: not checked — no key saved` / `Ollama: unreachable — net::ERR_CONNECTION_REFUSED` | `m01-no-ai-with-reasons.png` |
| The reason names the real transport error | **PASS** | `net::ERR_CONNECTION_REFUSED (http://127.0.0.1:59999)` | `m01-no-ai-with-reasons.png` |
| Re-detect flips the mode without a restart | **PASS** | `offline-ollama`, `Ollama: ready at http://localhost:11434` | `m02-redetect-ollama.png` |
| The badge names the provider, not just the mode | **PASS** | `Ollama — llama3:latest` | `m02-redetect-ollama.png` |
| A bogus model id is reported as a model problem | **NOT VERIFIED** | needs a key that authenticates; without one the model check is never reached — see below | `m03-bogus-model.png` |
| Selecting Ollama switches to it, badge says so | **PASS** | `offline-ollama`, badge `Ollama — llama3:latest` | `m04-provider-ollama.png` |
| Claude selected without a usable key: no silent fallback | **PASS** | `no-ai`; Ollama line reads `not selected — provider is set to Claude API` | `m05-provider-claude-no-key.png` |
| "Switch back to Auto" offered | **PASS** | button present | `m05-provider-claude-no-key.png` |
| The selection survives a restart | **PASS** | `provider = "claude"` after relaunch | `m06-provider-persisted.png` |
| Switching back to Auto restores the working provider | **PASS** | `offline-ollama` | `m07-back-to-auto.png` |
| No `Error invoking remote method` prefix in test output | **PASS** | clean | `m08-provider-tests.png` |
| "Test Ollama" reports the provider directly, with models | **PASS** | `✅ Ollama — ready (nomic-embed-text:latest, llama3:latest)` | `m08-provider-tests.png` |
| A failing item in "Save all" writes NOTHING | **PASS** | threw; counts before `{npcs:1,locations:0,factions:1,connections:0}` after identical | `m09-batch-rollback.png` |
| A good batch writes everything and Undo removes exactly it | **PASS** | 2 records + 1 connection written; undo removed 2; 0 connections left | `m10-batch-undo.png` |
| No unexpected renderer console errors | **PASS** | clean | — |

#### The NOT VERIFIED lines, and why

Three acceptance lines need **a key that authenticates**, and this environment
has none: the developer's stored key cannot be decrypted, which is the root
cause itself. Nothing was faked to make them pass.

- **"Save a valid key → mode flips to online; Test Claude returns 200."** Not
  run. What *is* verified is the path taken with no usable key: the mode holds,
  the reason is shown, and there is no silent fallback.
- **"Set the model id to a bogus value → 404 warning naming the model."** The
  404 branch is unit-tested (`classifyClaudeError`, `describeClaude`,
  `shouldFallBackToOllama` — a 404 must NOT fall back), but no live 404 was
  observed, because authentication fails first.
- **"With both providers available, send a message under each and confirm
  `ai_usage_log` records the selected provider."** Only the Ollama half could be
  exercised.

`scripts/probe-anthropic.cjs` performs the live check and prints the model list
and the newest Sonnet id. Run it after re-entering a key to close these three.

### Bugs found

Two the unit tests caught:

1. **`statusOf` read a port as an HTTP status.** `ECONNREFUSED 1.2.3.4:443`
   became "HTTP 443", so a refused connection classified as `unknown` rather
   than `offline`. It now requires an explicit status marker.
2. **`shouldFallBackToOllama` was an allow list, and `'no-key'` was not on it** —
   so the commonest setup of all, no key with a healthy Ollama, reported `no-ai`.
   It is an exception list now: an unrecognised kind falls back rather than
   stranding the DM.

Two that only launching the app could find:

3. **A dead Ollama classified as `unknown`.** Electron's `net` module speaks
   Chromium's `net::ERR_*`, not Node's errno codes; the pattern matched only the
   latter.
4. **`db.world.saveBatch` did not exist.** A second `world: {` key was added to
   preload's `db` object; in a JS object literal the later key wins, so the
   earlier block and both its channels were silently discarded. `test:ipc`
   passed throughout, because every channel string was present in the file. It
   surfaced as the rollback acceptance line passing **for the wrong reason** —
   it threw before any SQL ran. `verify-ipc-layers.mjs` now checks for duplicate
   keys per object scope; the check was confirmed to fail on the real bug and
   pass once merged.

### Part C — merge

`phase-5-combat` carries the react-konva fix main lacks (`64487d8`). Versions
that work together, all three confirmed installed:

| Package | main (broken) | merged |
|---|---|---|
| `react` | 18.3.1 | 18.3.1 |
| `react-konva` | ~19.0.10 — **throws on import** | ^18.2.10 |
| `konva` | ^10.3.0 | ^9.3.22 |

`react-konva@19` declares a peer of `react: ^18.3.1 || ^19.0.0` but refuses at
runtime: *"react-konva version 19 is only compatible with React 19."* On main
`#root` stays empty on every route, so no UI check of any kind could run there.

### Deferred / known issues

- **Three acceptance lines need a working key** (above). The code paths are
  unit-tested; the live confirmations are not done.
- **The model default is not API-confirmed.** `DEFAULT_CLAUDE_MODEL` is what to
  try before anyone has fetched the account's list. Settings says so, and
  "Fetch available models" replaces it with the real thing.
- **`CampaignLoreIndex` still duplicates `buildLoreChunks`** from
  `src/utils/loreCorpus.js` (Phase 6's caveat). `aiDetection.cjs` shows the way
  out — a CJS module both sides import — and the lore copy could follow, but
  that was not in this phase's scope.
- **The re-index hook falls back to `global.activeCampaignId` for deletes**,
  which no code currently sets; in practice a delete is followed by an edit or a
  manual re-index. Wiring the active campaign into the main process would make
  deletes self-healing.

### Open questions

1. **Should a key that will not decrypt be deleted automatically?** Today the
   app explains and waits. Removing it silently would be tidier and would lose
   the evidence that something changed under the DM's feet.
2. **Should `no-ai` be reachable deliberately?** There is no "off" setting; the
   only way to get `no-ai` with Ollama running is to select Claude and have it
   fail. A fourth segment ("None") would make that explicit.
3. **Should Undo cover single-card saves too?** Only "Save all" is transactional
   and undoable. A card saved on its own is still one insert with no way back.
4. **Should the model list be cached?** "Fetch available models" hits the API
   every time. Caching it per key would make the dropdown available offline, at
   the cost of going stale when Anthropic ships a model.

### Part C results — main is runnable again

Merged 2026-09-14, all three fast-forward, no merge commits:
`7d9060d` → `phase-5-combat` (12) → `phase-6-ai-writes` (9) → `phase-6.1-ai-mode` (4).
25 commits onto main, tagged **v1.1.0-alpha.2**.

Everything below was run **on main after the merge**:

| Harness | Result |
|---|---|
| `npm run doctor` | No problems (one expected WARN: `DMCS_USER_DATA` unset) |
| `npm test` | **924 passing**, 24 files, 0 expected-fail, 0 todo |
| `test:migrations` | 76/76 |
| `test:ipc` | 0 problems — 192 channels, all layers matched, no duplicate preload keys |
| `test:lore` | 44/44 |
| `test:sessions` | 51/51 |
| `test:rag` | 42/42 |
| `test:server` | 62/62 |
| `build:renderer` | clean, both bundles |
| `verify:combat` | **16 PASS / 0 FAIL** |
| `verify:ai` | **14 PASS / 0 FAIL** (against real Ollama) |
| `verify:aimode` | **14 PASS / 0 FAIL / 1 NOT VERIFIED** |

**The renderer renders**, which is the thing main could not do before this
merge: launched through the Playwright driver, `#root` has children, body text
is present, `window.Konva` is an object, and the console is clean.
`main-renderer-renders.png`.
