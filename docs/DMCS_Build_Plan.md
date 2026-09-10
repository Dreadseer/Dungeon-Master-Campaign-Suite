# DMCS Build Plan — Phased Instructions for Claude Code

**How to use this document.** Section 0 is the master instruction block. Paste **Section 0 plus exactly one phase** into a fresh Claude Code session, in order. Each phase is sized to finish in one focused session (or two for Phases 4 and 6) and ends with acceptance checks that Claude Code must run and report before declaring the phase done. Don't skip ahead — later phases depend on migrations and helpers introduced earlier.

The plan is derived from `docs/DMCS_CAPABILITY_REVIEW.md` (the source-level audit of `installer-m1` @ `08a8f94`). Every task below cites the file and line the review found, so Claude Code can go straight to the code rather than re-auditing.

**Migration numbering is fixed here to avoid collisions.** The review reused "009" and "010" across several proposals; this plan assigns one migration per phase:

| Migration | Phase | Contents |
|---|---|---|
| 009 | 1 | Referential integrity rebuild + `pdf_sources.status` CHECK widening |
| 010 | 4 | `sessions`, `plot_threads`, `reveals` |
| 011 | 5 | `combat_state` |
| 012 | 7 | `encounter_tables` |
| 013 | 8 | `maps.feet_per_cell`, `maps.fog_cols`, `maps.generated_params` |

---

## Section 0 — Master instructions (paste with every phase)

You are continuing development of the **Dungeon Master's Campaign Suite (DMCS)**, a local-first Electron + React + SQLite app for D&D 5e DMs. Read `README.md` and `docs/DMCS_CAPABILITY_REVIEW.md` before writing code — the review is the authoritative list of what is broken and why, with file/line citations. Then read `docs/BUILD_STATUS.md` if it exists to see what earlier phases completed.

**Standing rules for every phase:**

1. **Branch per phase.** Create `phase-N-<slug>` from the current main branch. Commit in small, described steps. Do not merge; I will review and merge.
2. **The four-layer IPC rule is absolute.** Any new data operation touches all of: React component → `electron/preload.js` → `electron/ipc/*Handlers.js` → `electron/database/DatabaseService.js`. Verify each new channel name matches exactly across all layers before moving on. A missing layer is a silent no-op.
3. **The tech stack is locked.** No new runtime dependencies. Vitest is the one permitted devDependency (Phase 0). If you believe a task is impossible without a new library, stop and explain rather than adding one.
4. **Migrations are append-only.** Never edit an existing `MIGRATION_00N` constant. Add the new constant, append `{ id, name, sql }` to the migrations array in `DatabaseService.js:24-33`, and follow the table-recreate pattern from migrations 002/008 whenever SQLite can't `ALTER` what you need. Every migration must be tested against **both** a fresh database and a database that already contains rows from the previous schema.
5. **Errors must be visible.** Every new renderer call to `window.electronAPI.*` is wrapped in `try`/`catch` and surfaces failures through the toast/error helper introduced in Phase 1. No new silent failures.
6. **AI is optional.** Every feature must either work in `no-ai` mode or hide/disable itself cleanly with a message when `ai.getMode()` returns `{ mode: 'no-ai' }`. Remember `getMode()` returns an **object** (`aiHandlers.js:9`) — destructure it.
7. **Write tests for pure code.** Anything added to `src/utils/` gets Vitest coverage in the same phase. Run `npm test` before every commit; it must be green.
8. **Update docs in the same phase.** README sections that describe changed behaviour get updated. Append a dated entry to `docs/BUILD_STATUS.md` listing: phase, what shipped, verdict changes, anything deferred, and any new open questions. This file is how the next session knows where you left off.
9. **Verification before "done."** Each phase ends with an Acceptance section. Run every check, paste the results into `docs/BUILD_STATUS.md`, and print a summary to the terminal. If a check can't be run in your environment (no display, no Ollama, no API key), say exactly which and why — don't claim it passed.
10. **Ask before destroying data.** Any change that alters existing user rows (e.g. Phase 4's move of `campaigns.description` into `sessions`) must be a copy-then-repoint, never a delete, and must be described in the commit message.

---

## Phase 0 — Environment, test harness, repo hygiene

**Goal:** A codebase that can be run, tested and trusted before any feature work. No verdict changes.
**Effort:** ~1.5 days.

### Tasks

1. **Pin the runtime.** Add `"engines": { "node": ">=20 <23" }` to `package.json` and a `.nvmrc` containing `20`. In README → Troubleshooting, add a paragraph explaining the Electron-vs-Node ABI split for `better-sqlite3` (the review hit `NODE_MODULE_VERSION 130` vs `137`), not just the symptom. Confirm `npm install` and `npm run build:renderer` succeed on Node 20 or 22.
2. **Install Vitest.** `npm i -D vitest`. Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts. Vitest reuses `vite.config.js`; confirm a trivial test runs.
3. **First test suite — `src/utils/encounterUtils.js`.** Assert all 80 `XP_THRESHOLDS` values against the DMG 2014 table (p. 82), all six `monsterMultiplier` bands, `partyThresholds` for four level-5 PCs = `[1000, 2000, 3000, 4400]`, the two end-to-end ratings from the review (1× CR 5 vs four L5 = Easy; 4× CR 2 = Hard). **Write failing tests** for the three known bugs — `crToXP(25..29)` returning 0, `parseCR('bogus')` returning `NaN`, and the missing party-size multiplier shift — and leave them failing; Phase 1 fixes them. Mark them `test.todo` or `it.fails` so the suite is green.
4. **Second suite — `src/utils/fogUtils.js`.** Index math, `setBrushRevealed` clamping at all four map edges, `getGridDimensions` for non-divisible image sizes.
5. **Third suite — `src/utils/combatUtils.js`.** `sortByInitiative` DEX tiebreak, `buildCombatants` count expansion ("Goblin 1", "Goblin 2"), and a failing/todo test asserting monsters carry a real `ac` (fixed in Phase 5).
6. **Repo cleanup.** `git rm -r --cached scripts/.test-userdata` (122 tracked cache files). Replace the two-line `.gitignore` with one covering `node_modules/`, `dist/`, `release/`, `scripts/.test-userdata/`, `scripts/screenshots/`, `*.log`, `.env*`, `.DS_Store`, `Thumbs.db`. Delete the empty `ai/features/` tree. Move `agent/dmcs-agent.mjs` to `tools/dmcs-agent.mjs` with a three-line README stating it is an unrelated LM Studio experiment, or delete it — your call, state which.
7. **Reorder migration constants** in `DatabaseService.js` so `MIGRATION_006` is defined before 007 and 008 (behaviour is already correct via the id-ordered array; this is readability only).
8. **Create `docs/BUILD_STATUS.md`** with a Phase 0 entry.

### Acceptance

- `npm test` green with ≥ 3 suites; the known-bug tests are visibly marked as pending, not deleted.
- `npm run build:renderer` succeeds.
- `git status` shows no tracked files under `scripts/.test-userdata/`.
- `node -e "require('./package.json').engines"` prints the engines block.

---

## Phase 1 — Silent failures, referential integrity, IPC error handling

**Goal:** No button in the app does nothing without a message. No delete fails silently. Encounter math is DMG-exact.
**Verdict changes:** none by the review's scale, but this is the precondition for everything after.
**Effort:** ~3.5 days.

### Tasks

1. **Global IPC error wrapper.** In `electron/ipc/dbHandlers.js` (and the other handler files), introduce a `registerHandler(channel, fn)` helper that wraps every `ipcMain.handle` callback in `try`/`catch`, logs with the channel name, and rethrows a clean `Error(message)` so the renderer never sees `Error invoking remote method` noise. Apply it to all ~100 channels. Specifically cover `ai:ragQuery` (`aiHandlers.js:29-31`) and `embed:source` (`embeddingHandlers.js:6-10`).
2. **Renderer error surface.** Add a small toast/notification component (Zustand store + a `<Toasts/>` mounted once in `App.jsx`) with a `notifyError(err)` helper. Wrap every existing delete path — `Locations.jsx:125-128`, `CampaignManager.jsx:40-45`, and the sibling world pages (NPCs, Factions, Lore, Connections, Maps, Encounters, Characters) — in `try`/`catch` → `notifyError`. Reload the list only on success.
3. **Migration 009 — integrity rebuild.** Using the 002/008 recreate pattern, rebuild:
   - `npcs` with `location_id … ON DELETE SET NULL`, `faction_id … ON DELETE SET NULL`
   - `locations` with `parent_location_id … ON DELETE SET NULL`
   - `maps` with `location_id … ON DELETE SET NULL`
   - `encounters` with `location_id … ON DELETE SET NULL`, `map_id … ON DELETE SET NULL`
   - `connections` with `campaign_id … ON DELETE CASCADE`
   - `pdf_sources` with `status CHECK(status IN ('pending','indexed','embedded','failed'))`
   Preserve every existing column (including 007/008 additions) and all data. Wrap the whole migration in a transaction. Test on a fresh DB and on a DB pre-populated through migrations 001–008 with rows in every affected table.
4. **Handler-side cleanup for polymorphic refs.** `db:npcs:delete`, `db:locations:delete`, `db:factions:delete` (and lore, once it's in Connections) also delete matching `connections` rows (either side) and `mind_map_positions` rows, inside one `db.transaction()`.
5. **Fix the `no-ai` guard** at `AISuggestionPanel.jsx:13-14, 56`: destructure `{ mode }` and compare the string. Confirm the "configure your API key" message now renders in `no-ai` mode.
6. **Orphaned vectors.** In `pdfHandlers.js:43-48`, call `embeddingService.deleteSource(sourceId)` before deleting chunks, inside `try`/`catch`.
7. **Map file cleanup.** Extend `db:maps:delete` (`dbHandlers.js:259-260`) to `fs.unlink` the image and thumbnail in `try`/`catch`, following `pdfHandlers.js:46`.
8. **Encounter math.** In `src/utils/encounterUtils.js`: add CR 25–29 to `CR_XP` (75000, 90000, 105000, 120000, 135000); change `monsterMultiplier(count)` to `monsterMultiplier(count, partySize = 4)` implemented as an index into `[1, 1.5, 2, 2.5, 3, 4]` shifted +1 when `partySize < 3` and −1 when `partySize >= 6`, clamped; fix `parseCR` to return 0 on `NaN`. Update both call sites (`XPCalculator.jsx:53`, `CombatCalculator.jsx`). Flip the Phase 0 pending tests to real assertions.
9. **Dead sidebar link.** Remove the `/lore` entry from `Sidebar.jsx:19`, the route at `App.jsx:76`, and delete `src/pages/LoreConnections.jsx`. (Phase 4 introduces the real Sessions/Plots pages.)
10. **Parent-cycle guard.** In `Locations.jsx:104-106`, walk the parent chain (bounded to 50 hops) and reject any cycle, not just self-parenting.

### Acceptance

- `npm test` green, including the formerly-pending encounter math tests.
- A scripted Node test (use `node:sqlite` or `better-sqlite3` under Electron) that runs migrations 001→009 on a populated DB, then: deletes a location with an NPC, a map and an encounter attached → succeeds, dependents have `NULL` location; deletes a campaign with connections → succeeds; deletes an NPC → its connections and mind-map position rows are gone.
- `UPDATE pdf_sources SET status='embedded'` succeeds.
- Manual (if a display is available): delete a location with NPCs from the UI — either it succeeds or a toast appears. Never nothing.

---

## Phase 2 — Player server security and map lifecycle

**Goal:** Fog enforcement is real for remote players, not just in-app. Safe to recommend the ngrok tunnel.
**Verdict changes:** Q5 PARTIAL → stronger PARTIAL.
**Effort:** ~2 days.

### Tasks

1. **Auth middleware.** In `electron/server/PlayerServer.js`, add Express middleware on every `/api/*` route that requires the join token (minted at `PlayerServer.js:149-151`) via `Authorization: Bearer <token>` or `?token=`. Reject with 401 otherwise. Scope every query to the token's `campaignId` — a token for campaign 3 cannot read `/api/map/7` if map 7 belongs to campaign 4.
2. **Tighten CORS.** Replace `Access-Control-Allow-Origin: *` (`PlayerServer.js:50`) with the server's own origin(s); the player app is served from the same Express instance, so it needs nothing wider.
3. **Server-side fog filtering.** `/api/map/:id` must not return tokens on unrevealed cells. Duplicate `isCellRevealed` from `src/utils/fogUtils.js` into a main-process-safe module (`electron/server/fogFilter.js`, pure functions, tested) and strip hidden tokens before responding. Apply the same filter to the Socket.IO `token:update` broadcast path so live updates don't leak what the REST route hides.
4. **Update the player web app** (`player/`) to send the token on every fetch and socket handshake.
5. **Fog/grid coupling.** In `MapEngine.jsx`/`MapToolbar.jsx`, when `grid_size` changes on a map with a painted mask, prompt "Changing grid size will clear fog — continue?" and clear on confirm. (Phase 8 adds the `fog_cols` column to detect mismatches properly; for now prevent the smear.)
6. **README:** update the Remote Player Network section and `DMCS_Remote_Player_Network.md` to describe the token requirement.

### Acceptance

- Start the server in a test harness; `curl /api/map/1` with no token → 401; with a valid token for the wrong campaign → 403/404; with the right token → 200 and no tokens on unrevealed cells (seed a map with one revealed and one hidden token to prove it).
- Unit tests for `fogFilter.js`.
- `npm test` green.

---

## Phase 3 — Rules Q&A works on day one

**Goal:** Rules lookup is grounded without any uploaded PDF, degrades instead of dying, and works in every AI mode.
**Verdict changes:** Q4 PARTIAL → SOLVED (single-rule lookups); "situation" mode is the stretch item.
**Effort:** ~5 days (+3 for situation mode).

### Tasks

1. **Index the SRD.** Add `SrdService.buildIndexableText()` that serialises each `srd_cache` monster/spell/equipment row into readable text (name, type, stats, full description). Create one sentinel `pdf_sources` row named `SRD 5.1` with `campaign_id = NULL` (adjust the FK/NOT NULL if needed — do it in code, no new migration is required if `campaign_id` is nullable; if it isn't, note that for Phase 4's migration). Feed the text through the existing `EmbeddingService.embedSource` path with synthetic `page_number` = the SRD section. Make `RAGService.js:31-36` include the SRD source unconditionally alongside the campaign's own PDFs. Add a Settings button "Index SRD for rules Q&A" with progress, and trigger it automatically after the first SRD seed if Ollama is reachable.
2. **Push the campaign filter into retrieval.** Fix cross-campaign dilution (`RAGService.js:29-36`): over-fetch (`topK * 4`) from vectra, then filter by allowed `source_id`s, then truncate to `topK`. Or use vectra's metadata filter if the installed version supports it — check, don't assume.
3. **Make Ollama optional at query time.** Wrap the `embed()` call in `EmbeddingService.search()` (line 121) in `try`/`catch` and fall through to the existing SQLite keyword branch (lines 135-174). Surface `degraded: true` in the result so the UI can say "keyword search — Ollama not running."
4. **A real `no-ai` path.** In `RAGService.query`, when `aiService.getMode() === 'no-ai'`, skip the model and return `{ answer: null, sources, extractedPassages: true }`. `RAGQueryPanel.jsx` renders the sources panel as the primary result with a header "Relevant passages" instead of an answer. Gate the Ask button on `hasEmbedded || srdIndexed`, not AI mode.
5. **Log AI failures.** In `AIService.complete`, write a row to `ai_usage_log` on thrown calls too (status column or a `success` flag — add via a small migration only if unavoidable; prefer reusing an existing column). Settings usage stats show a failure count.
6. **Expand query synonyms.** Generate the condition-name entries in `expandQuery` (`RAGService.js:10-18`) from `combatUtils.js:71-87` so all 15 conditions are covered, plus "grapple/grappled", "opportunity attack", "somatic/verbal/material".
7. **Stretch — Situation mode.** Add a "Situation" toggle to `RAGQueryPanel`: step 1 asks the model to decompose the question into 2–5 rules concepts (strict JSON), step 2 runs one retrieval per concept and unions/dedupes, step 3 asks for a ruling citing each component. AI required; hidden in `no-ai` mode.

### Acceptance

- With an empty campaign and Ollama running, ask "what does the restrained condition do" → an answer with an `SRD 5.1` source citation.
- Stop Ollama, ask again → keyword-search result flagged degraded, no exception.
- Set mode to `no-ai` (remove key, stop Ollama) → passages render, no error string in the UI.
- Two campaigns, PDF only in A: querying from B returns SRD hits, not an empty filtered list.
- `npm test` green; `expandQuery` covered by a test asserting all 15 condition names expand.
- Note explicitly which of the above could not be executed in your environment.

---

## Phase 4 — Sessions, plot threads, reveals

**Goal:** The campaign has a memory. This is the largest competitive gap and the foundation for AI recaps.
**Verdict changes:** Q2 PARTIAL → SOLVED. Q3 unchanged until Phase 6.
**Effort:** ~7 days. Plan for two sessions: 4a (data + handlers + migration), 4b (UI + repointing).

### Tasks — 4a

1. **Migration 010.** Create `sessions`, `plot_threads`, `reveals` exactly as specified in the review's Q2e (copy the DDL from `docs/DMCS_CAPABILITY_REVIEW.md` lines 313-345). Add `UNIQUE(campaign_id, session_number)` on `sessions`.
2. **Data preservation step inside migration 010.** For every existing campaign with a non-empty `description`, insert a `sessions` row (`session_number = 1`, `title = 'Imported notes'`, `notes = description`). Do **not** clear `description`. Log how many rows were migrated.
3. **DatabaseService + handlers + preload.** `db:sessions:{getAll,getById,create,update,delete,getCurrent}` where `getCurrent` returns the highest `session_number`; `create` increments `campaigns.session_count` in the same transaction. `db:plots:{getAll,create,update,updateStatus,delete}`. `db:reveals:{getForCampaign,reveal,unreveal,isRevealed}`. All through `registerHandler`.
4. **Extend Connections.** Widen `ENTITY_TYPES` in `Connections.jsx:6` to `['npc','location','faction','lore','map','encounter','character','plot']`; extend `resolveEntityName` (`Connections.jsx:54`) with the matching `getById` calls; add node builders in `mindMapUtils.js` for the new types (the unused `item` type at line 7 is the template). Add a Mind Map filter so the graph doesn't become unreadable.
5. **Extend `db:world:search`** (`dbHandlers.js:205-221`) to cover characters, encounters, maps, sessions, plot threads, non-lore `compendium_custom`, and lore **content** via `json_extract(data, '$.content') LIKE ?`. Add `TYPE_COLORS`/`ENTITY_PATH` entries in `WorldSearch.jsx:5-17`.
6. Tests for any new pure helpers; an integration script proving migration 010 on a populated DB and that `session_count` increments.

### Tasks — 4b

7. **`src/pages/world/Sessions.jsx`.** List (newest first) + detail: title, date, long-form notes (autosave on blur with a visible "saved" indicator), linked plot threads, and a "Revealed this session" list drawn from `reveals`.
8. **`src/pages/world/PlotThreads.jsx`.** Board grouped by status (open / active / resolved / abandoned) with drag or button transitions; each card links to its opening/resolving session.
9. **`RevealToggle` component** dropped into the card actions of `Lore.jsx`, `NPCs.jsx`, `Locations.jsx`, `Factions.jsx`. Revealed items get a visible badge; `is_secret` continues to mean "DM-only" and a secret item cannot be revealed without confirmation.
10. **Repoint the CampaignManager textarea** (`CampaignManager.jsx:196-203, 47-54`) at the current session's `sessions.notes` with a "New session" button. Restore `campaigns.description` to a proper description field on the campaign edit form. The campaign card (`CampaignManager.jsx:116-117`) shows the description and the now-true session count.
11. **Sidebar:** add Sessions and Plot Threads under World.
12. **Player-facing lore (minimum viable).** Add `/api/campaign/:id/revealed` to `PlayerServer.js` (token-scoped, per Phase 2) returning revealed lore/NPC/location summaries, and a simple "What you know" tab in the player web app and the Electron player view.
13. **"Everything attached to X" panel** on location and NPC detail views, fed by `db:connections:getForEntity` + `db:npcs:getByLocation` + new `db:maps:getByLocation` and `db:encounters:getByLocation`.

### Acceptance

- Migration 010 on a DB with three campaigns, one with a description → exactly one imported session, description intact.
- Create three sessions → card shows "3 sessions".
- Search for a phrase that exists only inside a lore entry's body → found.
- Reveal a lore entry → it appears in the player "What you know" view; unreveal → gone.
- Delete a session referenced by a plot thread → thread survives with `NULL` link.
- `npm test` green.

---

## Phase 5 — Combat that survives

**Goal:** A crash, a mis-click or a restart never loses a fight. Combat tracks what 5e actually needs.
**Verdict changes:** Q7 PARTIAL → SOLVED.
**Effort:** ~7 days.

### Tasks

1. **Migration 011 — `combat_state`.** DDL from the review's Q7e (`docs/DMCS_CAPABILITY_REVIEW.md` lines 1000-1011). Handlers `db:combat:{get,save,clear,getActiveForCampaign}` + preload.
2. **Load-or-build.** Replace the mount effect in `InitiativeTracker.jsx:61-67` with: if `db:combat:get(encounterId)` returns a row, hydrate from it; else `buildCombatants`. Debounced (~500 ms) `db:combat:save` on every change to combatants, round, phase, or log. `handleEndCombat` calls `db:combat:clear`.
3. **Resume UX.** On the Encounter Builder list, encounters with active combat state show a "Resume combat (round N)" badge. On app launch, if `getActiveForCampaign` returns a row, the TopBar shows a "Combat in progress" link.
4. **Per-hit HP write-back.** In `applyHP` (`InitiativeTracker.jsx:138-180`), for player combatants with an `entity_id`, call `db:characters:updateHP` immediately (throttled), and broadcast `character:sync`, so a crash can't lose damage.
5. **Fix AC.** `createMonsterEntry` (`encounterUtils.js:21-33`) stores `ac` from the SRD/homebrew stat block; `buildCombatants` uses `acUtils.js` for players instead of `10 + dexMod`. Flip the Phase 0 pending test.
6. **Death saves in the tracker.** Extract the roller from `CharacterSheet.jsx:127-139` into `src/utils/dnd5e.js` (fix the natural-20 rule: restore 1 HP and end dying, not +2 successes), add `death_saves` to the combatant shape, render pips inline for any player at 0 HP, sync to `stats.death_saves` alongside HP. Tests for the roller.
7. **Legendary and lair actions.** Add `legendary_max`, `legendary_used`, `lair_action_text` to the combatant shape, populated from the SRD JSON (`legendary_actions`) in `createMonsterEntry`. Reset `legendary_used` on round increment in `handleNextTurn`. Show a "Legendary: 2/3" counter with decrement buttons. Insert a synthetic "Lair Actions" row at initiative 20 when any combatant has lair text.
8. **Reactions and temp HP.** Add `reaction_used` (reset each round) and `temp_hp` (absorbed before HP in `applyHP`) to the combatant shape.
9. **Link tracker and map.** Broadcast `combat:update` on every save via the `player:broadcast` relay (`main.js:79-83`), extended to reach the pop-out map window. `TokenInspector.jsx` shows live HP/conditions for a token whose `entity_id` matches a combatant; clicking a token emits `combat:select` which the tracker uses to highlight/scroll. Damage in the tracker updates the token's badge.

### Acceptance

- Start combat, apply damage and a condition, navigate to another page, return → identical state including the log.
- Kill the Electron process mid-combat, relaunch → "Combat in progress" link, resume works.
- Damage a player mid-fight, crash before end → the character sheet already shows the reduced HP.
- Goblin in the tracker shows AC 15, not 10.
- Natural 20 on a death save → 1 HP, out of dying.
- `npm test` green with new tests for `dnd5e.js` death-save logic and `combatUtils.js` AC/legendary reset.

---

## Phase 6 — AI that writes to the world

**Goal:** "Add a rival thieves' guild in Waterdeep" produces a saved faction, NPC, lore entry and connections. The AI knows the actual lore. Session recaps exist.
**Verdict changes:** Q3 MISSING → SOLVED (Stage 3 included).
**Effort:** ~9 days. Two sessions: 6a (structured output + save), 6b (context + recaps).

### Tasks — 6a

1. **Structured suggestion mode.** Rewrite `AISuggestionPanel.jsx` to request strict JSON: `{ suggestions: [{ kind: 'npc'|'location'|'faction'|'lore', name, fields: {...}, links: [{ to: <name>, relationship }] }] }`. Reuse `compendiumExtractor.js`'s prompt discipline and its JSON parse/repair helpers — do not write a second parser. Accept a free-text request box ("what should I add?") in addition to the generic "suggest 3 things."
2. **Save / Edit & Save cards.** Each suggestion renders as a card with the proposed fields editable inline, a **Save** button wired to the existing `db:npcs:create` / `db:locations:create` / `db:factions:create` / `db:lore:create`, and a **Save all** that also writes `connections` rows for the `links` (resolving names to ids among the just-saved batch and existing entities). Saved cards show a link to the new record.
3. **Persist chat.** Add `persist` middleware to `src/stores/aiStore.js` (per-campaign key), with a "Clear history" button.
4. **Save from chat.** In `AIAssistant.jsx`, add a "Save as…" action on any assistant message that runs the same structured-extraction prompt over that message's text and opens the card UI from task 2.
5. **Encounter advisor write-back.** Extend `XPCalculator.jsx:66-89` so the AI returns a JSON `{ suggestions: [{ action: 'add'|'remove'|'replace', monster_index, count }] }` and offers Apply buttons that mutate the encounter through `db:encounters:update`.

### Tasks — 6b

6. **Context budget.** Refactor `buildSystemPrompt` (`AIAssistant.jsx:11-28`) into `src/utils/aiContext.js` (pure, tested) that assembles: campaign + setting; party; current session summary and open plot threads (from Phase 4); location names with one-line descriptions; lore titles; faction names — each section truncated under a total character budget (default 6000, configurable in Settings), mirroring `RAGService.maxContextLen`. Show the budget usage in the AI page.
7. **Embed campaign lore.** Feed `compendium_custom` rows with `type='lore'`, plus location/NPC/faction descriptions, through `EmbeddingService.embedSource` under a per-campaign sentinel source (`Campaign lore — <name>`), re-embedding an entity on save (debounced). Add a "campaign lore" retrieval step to the AI Assistant so each user message pulls the top-3 relevant lore chunks into context. Add a "Check for contradictions" button on the suggestion cards that retrieves related lore and asks the model to flag conflicts before saving.
8. **AI session recaps.** On `Sessions.jsx`, a "Generate recap" button feeds `sessions.notes` (plus revealed items and plot changes that session) to `ai.complete` and writes to `sessions.recap`, editable. A "Recap for players" variant excludes anything not revealed.
9. **`no-ai` behaviour.** Every AI surface above hides behind a clear "AI not configured" panel in `no-ai` mode; nothing throws.

### Acceptance

- In online or Ollama mode: request "a rival thieves' guild in Waterdeep" → Save all → one faction, one NPC, one lore entry and ≥ 2 connections exist in the DB and appear in the Mind Map.
- Restart the app → chat history persists.
- With 60 factions seeded, the system prompt stays under the budget (assert in a test on `aiContext.js`).
- Generate a recap for a session with two revealed lore entries → recap references them; the player variant omits secrets.
- `no-ai` mode: no AI button is clickable, no raw error string anywhere.
- `npm test` green.

---

## Phase 7 — Encounter creation

**Goal:** Encounters know the world and can be generated, not just scored.
**Verdict changes:** Q8 PARTIAL → SOLVED.
**Effort:** ~9 days.

### Tasks

1. **Location-aware assembly (no AI).** When `location_id` is set in the Encounter Builder create/edit modal, call `db:npcs:getByLocation` and `db:connections:getForEntity` and show a "Notable figures here" panel offering one-click add of those NPCs (as `source: 'npc'` entries with their stats if a linked stat block exists, else as a named combatant with manual HP/AC). Also list encounter tables (task 4) attached to the location.
2. **AI encounter generator.** New `src/components/encounter/EncounterGenerator.jsx`. Inputs: target difficulty, party (from `XPCalculator.jsx:37-44`), location, environment/theme text. Compute the budget with the existing unused `xpBudget` (`encounterUtils.js:90-94`). Pre-filter SRD + homebrew monsters by CR band and type, hand the model the candidate list and budget, and ask for strict JSON `{ name, monsters: [{ index, count }], tactics, notes }`. Validate locally against the budget (reject and retry once if off by more than one tier), then persist via `db:encounters:create`. Reuse `compendiumExtractor.js` parsing. Works with a small Ollama model — test with `llama3`.
3. **Per-instance monster HP.** Change the `encounters.monsters` entry shape to carry `instances: [{ hp_current }]` sized to `count`, so HP set in the tracker (Phase 5) round-trips into the encounter row. Migrate existing JSON on read (lazy), not via SQL.
4. **Migration 012 — `encounter_tables`.** DDL from the review's Q8e (`docs/DMCS_CAPABILITY_REVIEW.md` lines 1172-1180). Handlers `db:encounterTables:{getAll,getByLocation,create,update,delete}`; rolling is pure client logic in `src/utils/tableUtils.js` (tested). New `RandomTables.jsx` page: build a table per location/region, entries link to existing encounters or free text, a Roll button resolves and opens the linked encounter. Optional AI "populate from location description" button, hidden in `no-ai`.

### Acceptance

- Create a location with three NPCs; new encounter at that location shows them; adding one produces a combatant in the tracker.
- Generate a Hard encounter for four L5 PCs in a swamp (Ollama) → saved encounter rates Hard in the calculator, every monster exists in SRD/homebrew.
- Roll on a d20 table ten times → every result maps to an entry; linked entries open the encounter.
- `npm test` green with `tableUtils.js` and the budget validator covered.

---

## Phase 8 — Maps: measurement and generation

**Goal:** Answer "can I reach him?" from the map, and produce a dungeon in ten seconds when the party goes off-book.
**Verdict changes:** Q5 PARTIAL → SOLVED; Q6 MISSING → PARTIAL.
**Effort:** ~8 days.

### Tasks

1. **Migration 013.** Add `maps.feet_per_cell INTEGER DEFAULT 5`, `maps.fog_cols INTEGER`, `maps.generated_params TEXT`. Populate `fog_cols` for existing maps on first load (from image size ÷ grid size) so mismatches become detectable; replace the Phase 2 prompt with a proper "grid changed — clear or keep fog?" dialog.
2. **Measurement tool.** Add `measure` to `MapToolbar.jsx:67-99`. Drag in `MapCanvas.jsx` renders a Konva `Line` + `Text` showing both 5e grid distance (each square = `feet_per_cell`, diagonals count as one square per PHB) and Euclidean distance. Shift-click to chain segments. Add `feet_per_cell` to the create/edit modal. Pure distance math in `src/utils/measureUtils.js`, tested.
3. **Blank map.** Allow `db:maps:create` with no image: the modal offers "Blank grid" with width/height in cells; `MapCanvas` renders a neutral background at `cols × grid_size`. Verify `getMapDimensions` fallback (`fogUtils.js:31-33`) handles it.
4. **Procedural dungeon generator (Option A).** `src/utils/dungeonGen.js`: seeded BSP room-and-corridor generator returning a cell grid (`floor | wall | door | corridor`) plus room metadata. Pure, deterministic per seed, tested (same seed → same output; every room reachable). `src/components/map/MapGeneratorModal.jsx`: parameters (size, room density, corridor width, seed, theme palette), live preview on a Konva stage, "Generate" → render to PNG via the existing `generateThumbnail`-style export (`MapCanvas.jsx:36`), save through `file:saveExportedImage` + `db:maps:create` with `generated_params` = the JSON parameters. "Re-roll" and "Tweak" reuse the stored params. Auto-set `grid_size` and `fog_cols` to match.
5. **Annotations layer (small).** A fifth Konva layer for DM-only text labels and simple shapes, stored as `maps.annotations` JSON — add the column in migration 013 as well. Hidden from player views.
6. **README:** document measurement, blank maps and the generator; state plainly that DMCS does not do Dungeon Alchemist-style 3D generation and is designed to import those maps.

### Acceptance

- Measure two tokens 3 squares apart diagonally → shows 15 ft.
- Generate a dungeon with seed 42 twice → identical images; fog paints and tokens snap correctly on it.
- Change grid size on a map with fog → dialog appears; choosing "clear" clears; choosing "keep" keeps and `fog_cols` updates.
- `npm test` green with `dungeonGen.js` and `measureUtils.js` covered.

---

## Phase 9 — Release readiness

**Goal:** Something a non-technical DM can install and a stranger can evaluate.
**Effort:** ~3 days.

### Tasks

1. **License.** Decide (I'll tell you: default to **MIT** unless I say otherwise) and add `LICENSE`, `"license"` in `package.json`, and an About panel in Settings that credits dnd5eapi.co and displays the SRD 5.1 attribution (CC-BY-4.0 / OGL as applicable).
2. **Migration soak test.** Script: build a DB through 001–008 with realistic rows in every table, then run 009–013, then verify row counts and a sample of every FK. Commit it under `scripts/verify-migrations.js` and wire `npm run verify:migrations`.
3. **Packaged-app verification.** `npm run build:win` (Developer Mode / admin per README). Install into a clean Windows user profile. Verify: launch, first-run SRD seed, create campaign, upload a map, open player window, open pop-out map, start and resume combat, RAG query with Ollama, browser player join over LAN with the token. Record results in `docs/BUILD_STATUS.md`.
4. **Screenshots.** Use `scripts/screenshot-driver.mjs` to capture Campaign Manager, Map Engine with fog, Initiative Tracker mid-combat, Sessions page, and the RAG panel with a citation. Commit under `docs/` and replace the README placeholder.
5. **README refresh.** Update Modules, Database Schema (migrations 009–013), AI Layer, Player Views, Testing (there is now a suite — say what it covers), and Open Questions (remove what's resolved). Bump version to 1.1.0.
6. **Positioning.** Add a `docs/POSITIONING.md` containing the review's post-roadmap "Best for…" statement, edited to claim only what Phases 1–8 actually shipped.

### Acceptance

- Installer runs on a clean machine; every item in task 3 passes or is documented as failing with a reason.
- `npm run verify:migrations` green.
- README has no placeholder text and no stale "Open Questions."

---

## Appendix — Deliberately not planned

Per the review's Part 2c and roadmap items 16–17, the following are conceded, not deferred: audio transcription (hostile to local-first), VTT export (serves DMs who chose another VTT), AI image generation for maps (breaks the `no-ai` guarantee and the locked stack), and 3D map generation (a different product). If any of these come up during a phase, note them in `docs/BUILD_STATUS.md` and move on.
