# DMCS Capability Review

**Subject:** Dungeon Master's Campaign Suite v1.0.0 — Electron + React + SQLite, local-first
**Branch reviewed:** `installer-m1` @ `08a8f94`
**Method:** Source-level audit. Every capability claim below is traced through all four layers
(React component → `electron/preload.js` → `electron/ipc/*Handlers.js` → `DatabaseService`/service)
and against the schema in `electron/database/DatabaseService.js`. Where the README or a `DMCS_*.md`
spec doc describes something the code does not do, the gap is flagged. Nothing here is inferred from
module names.

---

## Executive Summary

| # | Question | Verdict |
|---|---|---|
| 1 | Track every town, shop, character, enemy | **PARTIAL** |
| 2 | Manage lore and plot details | **PARTIAL** |
| 3 | Add to lore and plot on request (AI) | **MISSING** |
| 4 | Pull up rules and solve situations | **PARTIAL** |
| 5 | Manage maps | **PARTIAL** |
| 6 | Create maps | **MISSING** |
| 7 | Manage combat | **PARTIAL** |
| 8 | Create encounters | **PARTIAL** |

Nothing scores SOLVED at whole-question granularity. That is not a condemnation — several
*sub-capabilities* are genuinely finished and better than what the competition ships (the XP/CR
calculator is DMG-2014-exact; fog-of-war enforcement in the player view is real). But every one of
the eight questions has at least one layer missing, and in three cases the missing layer is
persistence, which is the layer that matters at a table.

**The single most important structural finding:** DMCS models *nouns* well (locations, NPCs,
factions, characters, monsters, maps) and *verbs* not at all. There is no table for anything that
happens over time — no sessions, no plot threads, no timeline, no combat state.
`campaigns.session_count` exists in the schema and is displayed on the dashboard, but nothing in the
codebase ever increments it. That single absence is what caps Questions 2, 3 and 7 at PARTIAL, and it
is what the competitors named in Part 2 are built almost entirely around.

### Top three real differentiators

1. **Local-first with no account, no subscription, no cloud.** Verified: `better-sqlite3` writes a
   single file under `app.getPath('userData')`; there is no auth code, no telemetry, no remote
   persistence anywhere in `electron/`. The only network calls in the whole app are dnd5eapi.co
   (SRD seed), api.anthropic.com (optional), localhost:11434 (optional) and ngrok (opt-in).
2. **RAG over the DM's own purchased PDFs with page attribution and contiguous-chunk stitching.**
   Verified end-to-end and genuinely more sophisticated than a naive top-k retriever.
3. **One app spanning prep and live play, including a fog-enforced player view.** Verified: hidden
   cells render fully opaque and tokens on hidden cells are not drawn at all in player mode.

### Top three roadmap items

1. **Sessions + plot threads + a reveal flag** (migration 009). Unlocks Q2 → SOLVED, Q3 → PARTIAL,
   and is the precondition for competing with Archivist and Tabletop Arc at all. ~6–8 days.
2. **Persist combat state** (migration 010). Q7 PARTIAL → SOLVED. An app crash mid-boss-fight
   currently loses the entire encounter. ~3–4 days.
3. **Make AI output saveable** (no migration; reuse existing `lore:create` / `npcs:create` channels).
   Q3 MISSING → PARTIAL. ~4–5 days, and the highest ratio of perceived value to effort in this
   document.

Before any of those: **four verified bugs** in "Engineering hygiene" will bite a DM in the first
session, and two of them are silent (a Delete button that does nothing, with no error shown).

---

# Part 1 — The Eight Questions

## Q1. How does it track every town, shop, character, and enemy?

### a. Verdict

**PARTIAL** — the core CRUD for every entity type is complete and correct; the connective tissue
between entity types, and the global search across them, are not.

### b. How it works today

Six separate tables carry the world, all created in migration 001 and all scoped by
`campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE`
(`electron/database/DatabaseService.js:83-214`).

**Locations** (`locations`) do have a hierarchy at the schema level:
`parent_location_id INTEGER REFERENCES locations(id)`, with a `type` CHECK constraint limiting a
location to `town | dungeon | shop | region | landmark`. Migration 007 later added `has_own_map` and
`floor_number` for multi-floor sites. So "region → town → shop" is representable. The UI, however,
does not render it as a tree: `db:locations:getAll` (`electron/ipc/dbHandlers.js:86-93`) does a single
self-JOIN that resolves exactly *one* level of ancestry into a `parent_name` column, and
`src/pages/world/Locations.jsx` renders a flat card grid with a clickable breadcrumb to the immediate
parent (`Locations.jsx:205-209`) plus a "has sub-locations" filter (`Locations.jsx:51`). A DM with
Waterdeep → Dock Ward → The Yawning Portal sees three sibling cards, each naming its parent, not a
nested outline.

**NPCs** (`npcs`) carry `race`, `class`, `role`, `notes`, `secrets`, `motivation`, `is_alive`, plus
FKs to both a location and a faction. `db:npcs:getAll` JOINs both so every NPC row arrives with
`location_name` and `faction_name` already resolved (`dbHandlers.js:29-39`).

**Factions** (`factions`) are the thinnest table: name, description, alignment, notes.

**Player characters** (`characters`) are the richest, but most of that richness lives inside three
JSON-string columns — `stats`, `inventory`, `spell_slots` — which the handlers read-modify-write
whole (`dbHandlers.js:340-420`). Death saves, currency, AC overrides and known spells are all nested
inside `stats` or `spell_slots` rather than being columns.

**Enemies exist in three distinct and non-interchangeable forms:**

- *SRD cache* — `srd_cache(resource_type, slug, data)`, seeded from `https://www.dnd5eapi.co` by
  `electron/services/SrdService.js:3-8` with a 30-day TTL. Read-only, campaign-agnostic, shared by
  all campaigns.
- *Homebrew* — `compendium_custom` rows with `type='monster'`, campaign-scoped, edited through
  `src/components/compendium/forms/CustomMonsterForm.jsx`.
- *Encounter instances* — not rows at all. They are objects inside the `encounters.monsters` JSON
  string, shaped `{id, name, source, source_index, cr, xp, hp_max, hp_current, count, …}`
  (`src/utils/encounterUtils.js:1-2, 21-33`).

`src/components/encounter/MonsterSearchPanel.jsx:36-62` queries the first two in parallel and
normalises them into one list with a `_source` tag, so from the DM's chair SRD and homebrew monsters
are interchangeable when building an encounter.

**The Connections graph** is a single polymorphic table:
`connections(entity_a_type, entity_a_id, entity_b_type, entity_b_id, relationship, notes)`, with
`campaign_id` bolted on by migration 002. `src/pages/world/Connections.jsx:6` restricts the type
dropdown to exactly three values: `['npc', 'location', 'faction']`. The Mind Map
(`src/hooks/useMindMapData.js`) loads those same three entity types into a React Flow graph with
persisted node positions in `mind_map_positions`, and drops any edge whose endpoints aren't both
present (`useMindMapData.js:36-40`).

**Global search** is `db:world:search` (`dbHandlers.js:205-221`), mounted in the TopBar and available
from every page whenever a campaign is active (`src/components/TopBar.jsx:45`). It runs four `LIKE`
queries and returns locations, factions, NPCs and lore.

### c. How I explain it

Every town, shop, NPC, faction, player character and monster in my campaign lives in its own record in
a local database, and towns can nest inside regions. NPCs are pinned to a location and a faction, and
I can draw named relationships between any NPC, place or faction and see the whole web as a mind map.
There's a search box in the title bar that finds people, places, factions and lore as I type. What it
can't do yet is link a *map* or an *encounter* into that web — those are tracked, but they sit outside
the relationship graph.

### d. Gaps and risks

**Deleting a location fails silently.** This is the one a DM hits first. Every FK pointing at
`locations` — `npcs.location_id`, `maps.location_id`, `encounters.location_id`,
`locations.parent_location_id` — was declared with no `ON DELETE` clause, so SQLite defaults to
`NO ACTION`, and `DatabaseService.js:8` turns `PRAGMA foreign_keys = ON`. I reproduced this against
the real migration-001 DDL: deleting a location that has even one NPC in it raises
`FOREIGN KEY constraint failed`. And `Locations.jsx:125-128` has no `try`/`catch`, so the rejection is
unhandled — the modal closes, `load()` never runs, the location is still there, and the DM is shown no
error at all. A Delete button that does nothing.

**Deleting a campaign fails the same way, for the same reason.** `connections.campaign_id` was added
in migration 002 as `REFERENCES campaigns(id)` with no cascade. Verified: with even one Connections
row present, `DELETE FROM campaigns WHERE id=?` raises `FOREIGN KEY constraint failed`.
`src/pages/CampaignManager.jsx:40-45` also has no `try`/`catch` — so after confirming a scary "This
cannot be undone" dialog, nothing happens.

**Connections orphan.** `entity_a_id`/`entity_b_id` are plain integers with no FK, so deleting an NPC
leaves its Connections rows pointing at a dead id — verified. The Mind Map hides these
(`useMindMapData.js:36-40`) but `Connections.jsx:54` surfaces them as `Unknown npc`. Nothing ever
cleans them up. Same for `mind_map_positions`.

**No, an entity cannot be linked to a map, an encounter and a lore entry at the same time.** The
Connections type list is three values. Lore, maps, encounters, characters and items are all
unreachable from the graph. There *is* a `maps.location_id` and an `encounters.location_id`, so a map
and an encounter can each point at a location — but that's a one-way FK, not a queryable
relationship, and nothing in the UI shows "everything attached to Waterdeep."

**Search misses half the app.** `db:world:search` covers 4 of the ~8 things a DM would want to find.
Characters, encounters, maps, homebrew monsters, spells and equipment are all invisible to it. Worse,
the lore branch searches `name LIKE ?` only — lore *body text* lives inside the `data` JSON column and
is not searched at all, so searching for a phrase you wrote in a lore entry returns nothing.
Two-character minimum, 300 ms debounce (`src/components/world/WorldSearch.jsx:30, 46`).

**Parent-cycle guard is one level deep.** `Locations.jsx:104-106` blocks a location from being its own
parent, but nothing blocks A→B and B→A. The single-level JOIN means this won't infinite-loop today,
but any future recursive tree render would hang.

**JSON columns can't be queried.** You cannot ask "which characters carry a Potion of Healing" or
"which NPCs are level 5" in SQL — inventory, stats and spell slots are opaque strings. Every such
question requires loading every row and parsing in JS.

### e. Path to solved

**Migration 009 — referential integrity and search.** Because SQLite cannot `ALTER` a foreign key,
follow the pattern already established twice in this codebase (migrations 002 and 008): create
`locations_m009` / `npcs_m009` / `maps_m009` / `encounters_m009` with the same columns but
`ON DELETE SET NULL` on the soft references (`npcs.location_id`, `maps.location_id`,
`encounters.location_id`, `locations.parent_location_id`) and `ON DELETE CASCADE` on
`connections.campaign_id`; `INSERT … SELECT *`; `DROP`; `RENAME`. Add a cleanup in `db:npcs:delete` /
`db:locations:delete` / `db:factions:delete` that also deletes matching `connections` and
`mind_map_positions` rows — wrap all of it in the existing `db.transaction()` helper.
Effort: **1.5 days**, mostly test data.

**Widen Connections to all entity types.** No migration needed — the table is already polymorphic.
Extend `ENTITY_TYPES` in `Connections.jsx:6` to
`['npc','location','faction','lore','map','encounter','character']`, extend `resolveEntityName`
(`Connections.jsx:54`) with the corresponding `getById` calls, and add node builders to
`src/utils/mindMapUtils.js` (which already defines an unused `item` type at line 7).
Effort: **2 days**.

**Extend `db:world:search`.** Add `characters`, `encounters`, `maps` and non-lore `compendium_custom`
branches to `dbHandlers.js:205-221`, and search lore content via
`json_extract(data, '$.content') LIKE ?` — SQLite's JSON1 extension is compiled into `better-sqlite3`
by default, so this needs no new dependency. Add the corresponding `TYPE_COLORS` and `ENTITY_PATH`
entries in `WorldSearch.jsx:5-17`. Effort: **1 day**. AI: not required, works in all four modes.

**An "everything attached to X" panel** on the location and NPC detail views, fed by
`db:connections:getForEntity` (already exists, already in preload) plus `db:npcs:getByLocation`
(exists) plus new `db:maps:getByLocation` and `db:encounters:getByLocation` handlers.
Effort: **1.5 days**.

**Total: ~6 days to SOLVED.**

---

## Q2. How does it manage lore and plot details?

### a. Verdict

**PARTIAL** — lore entries are real and work. Plot, in every sense a DM means it, does not exist.

### b. How it works today

**Confirmed: lore is `compendium_custom` with `type='lore'`, and migration 002 is what made that
legal.** Migration 001 created `compendium_custom` with
`type TEXT CHECK(type IN ('item','spell','equipment','monster'))`. Migration 002
(`DatabaseService.js:221-238`) recreates the table as `compendium_custom_new` with `'lore'` added to
the CHECK list, copies the rows, drops and renames — the standard SQLite CHECK-widening dance,
repeated again in migration 008 to add `'source_book'` to the `source` CHECK.

Lore has a dedicated handler family (`db:lore:*`, `dbHandlers.js:175-202`) kept deliberately separate
from `db:compendium:*`, and the compendium handlers exclude it: `db:compendium:getAll` with no type
argument runs `WHERE type != 'lore'` (`dbHandlers.js:265-271`), and `db:compendium:search` likewise
(`dbHandlers.js:289-296`). So lore never pollutes the monster/spell/item browser.

A lore entry's real content is a JSON string in the `data` column: `{ content, category, is_secret }`
(`dbHandlers.js:191`). `src/pages/world/Lore.jsx:8` fixes the category list to five values — History,
Faction, Location, Secret, Other — and offers a client-side filter over them (`Lore.jsx:41-45`).
Entries render as cards with a full-view overlay.

**`is_secret` exists and is purely cosmetic.** I traced every use: it produces a 🔒 prefix on the
title, a dark-red accent border instead of gold, and a muted preview style
(`Lore.jsx:129, 135, 141, 143, 159, 162`; `src/pages/WorldBuilder.jsx:170-172`). It gates nothing.
There is no consumer of it outside those two files.

NPCs have a parallel and equally DM-only mechanism: the `npcs.secrets` column, shown behind a
show/hide toggle in `src/components/world/NPCQuickView.jsx:63` — a toggle for the DM's own screen, not
a player-facing gate.

**Session notes.** `src/pages/CampaignManager.jsx` renders a "Session Notes" textarea on the active
campaign dashboard (`CampaignManager.jsx:196-203`). It is bound to `campaigns.description`: loaded at
`CampaignManager.jsx:31` as `activeCampaign.description`, saved on blur at `CampaignManager.jsx:47-54`
as `description: notes`.

### c. How I explain it

I can write lore entries, file them under one of five categories, and mark one as a secret so it shows
up flagged in my own list. NPCs have a separate hidden "secrets" field I can toggle open at the table.
What I don't have is any sense of *time or progression* — there's no session log, no plot threads I
can track from hook to payoff, no timeline, and no way to mark a piece of lore as "the party knows
this now." Everything is a flat pile of notes that looks the same in session twelve as it did in
session one.

### d. Gaps and risks

**Session notes silently destroy the campaign description — and each other.** Because the textarea
writes to `campaigns.description`, there is exactly *one* notes field per campaign, forever. Typing
session 2's notes overwrites session 1's notes, and both overwrite whatever description the DM wrote
when creating the campaign. There is no history, no per-session record, no undo. This is the most
likely path to real data loss in the app, and it happens by design, on blur, with no confirmation. It
also means the campaign card on the manager screen (`CampaignManager.jsx:116`) displays last session's
raw notes where a description should be.

**`campaigns.session_count` is dead.** The column exists (`DatabaseService.js:88`), is initialised to
0 by `db:campaigns:create` (`dbHandlers.js:13-16`), and is rendered on every campaign card as "N
sessions" (`CampaignManager.jsx:117`). Nothing in the entire codebase ever increments it — the only
three references are those. Every campaign displays "0 sessions" forever.

**No plot threads, no timeline, no "what happened last session."** There is no table, no handler, no
preload entry and no component for any of these. `DMCS_AI_Spec_Sheet.md:53` specifies M1 as including
"session notes, timeline log", and `DMCS_Phase1_Agent_Prompts.md:176` describes the Campaign Manager
page as "Manage your campaigns, session notes, and timeline." **Neither the timeline nor per-session
notes was ever built.** This is the clearest spec-vs-code gap in the project.

**`/lore` — "Lore & Connections" — is a live sidebar link to an empty page.**
`src/components/Sidebar.jsx:19` lists it between the World sub-pages and the Mind Map.
`src/App.jsx:76` routes it to `src/pages/LoreConnections.jsx`, which is twelve lines: an `<h1>`
reading "Lore & Connections" and a `<p>` reading "Track narrative threads, secrets, and faction
allegiances". Nothing else. A DM exploring the sidebar in their first session will click it, and per
the verdict scale this is a placeholder UI — Missing. It is also, ironically, an accurate
advertisement for the feature this question is asking about. It should either be built or removed from
`Sidebar.jsx`.

**Lore content is not searchable.** As noted in Q1, `db:world:search`'s lore branch matches
`name LIKE ?` only (`dbHandlers.js:216-218`). The body text is inside the JSON `data` column. A DM who
writes three paragraphs about the Zhentarim under an entry titled "Notes" can never find it again by
searching for "Zhentarim."

**No player-facing lore at all.** `electron/server/PlayerServer.js` exposes exactly four read routes —
campaign, character, campaign characters, map (`PlayerServer.js:60-110`). There is no lore route, and
the Electron player view doesn't render lore either. So even if a "revealed" flag existed, there is
currently nowhere for revealed lore to appear.

**Category list is hardcoded.** Five values in a JS constant (`Lore.jsx:8`). No custom categories, no
tags, no per-campaign taxonomy. Filtering happens client-side by parsing every entry's JSON on every
keystroke (`Lore.jsx:41-45`).

### e. Path to solved

This is the highest-value work in the document, because it's the axis on which every competitor in
Part 2 is built.

**Migration 009 (share with Q1's) — three new tables:**

```sql
CREATE TABLE sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_number INTEGER NOT NULL,
  title          TEXT,
  played_on      DATE,
  notes          TEXT,              -- long-form, one row per session
  recap          TEXT,              -- AI-generated or hand-written
  created_at     DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE plot_threads (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id         INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  status              TEXT DEFAULT 'open' CHECK(status IN ('open','active','resolved','abandoned')),
  opened_session_id   INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  resolved_session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  created_at          DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE reveals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,     -- 'lore' | 'npc' | 'location' | 'faction'
  entity_id   INTEGER NOT NULL,
  revealed_at DATETIME DEFAULT (datetime('now')),
  session_id  INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  UNIQUE(entity_type, entity_id)
);
```

A separate `reveals` table rather than an `is_revealed` column keeps this out of the JSON blob, makes
"what did the party learn in session 7" a one-line query, and needs no CHECK-widening dance.

**DatabaseService / handlers:** `db:sessions:{getAll,getById,create,update,delete,getCurrent}`,
`db:plots:{getAll,create,update,updateStatus,delete}`,
`db:reveals:{getForCampaign,reveal,unreveal,isRevealed}`. Increment `campaigns.session_count` inside
`db:sessions:create` in the same transaction — that finally makes the dashboard number true. All
follow the existing `dbHandlers.js` shape exactly.

**Preload:** three new blocks in the `db` object, matching the existing style.

**React:** a new `src/pages/world/Sessions.jsx` (list + per-session detail with notes and linked
threads), a `PlotThreads.jsx` board grouped by status, and a `RevealToggle` component dropped into
`Lore.jsx`, `NPCs.jsx` and `Locations.jsx` card actions. **Repoint the CampaignManager textarea at the
current session's `sessions.notes`** and restore `description` to being a description — and write a
one-shot migration step that copies the existing `campaigns.description` into a first `sessions` row
so nobody loses what's already typed there.

**Then delete `src/pages/LoreConnections.jsx` and repoint the `/lore` sidebar entry at Sessions,** or
drop the entry from `Sidebar.jsx:19`.

AI: **not required.** Every part of this works in `no-ai` mode; AI only makes recaps nicer (Q3).

Effort: **6–8 days.**

---

## Q3. Can it add to lore and plot if requested?

### a. Verdict

**MISSING** — AI generates suggestions and displays them. It never writes to lore, NPCs, locations or
factions. I confirmed this negatively: `grep` for `electronAPI.db.*.(create|update)` across
`src/components/ai/`, `src/pages/AIAssistant.jsx`, `src/components/world/AISuggestionPanel.jsx` and
`src/components/mindmap/AIInsightsPanel.jsx` returns **zero matches**.

### b. How it works today

There are two AI surfaces relevant to this question, plus one that does persist but writes somewhere
else entirely.

**The World Builder suggestion panel** (`src/components/world/AISuggestionPanel.jsx`, 97 lines) is a
collapsible panel that calls `ai.complete` once and renders the result as `<p>` lines split on
newlines (`AISuggestionPanel.jsx:36-37, 44-46, 71-73`). The only actions offered are "Generate
Suggestions" and "↺ Regenerate" (`AISuggestionPanel.jsx:61, 75`). There is no Save, no Apply, no
Accept.

**What context it injects is the key finding.** `AISuggestionPanel.jsx:30-33` builds the entire user
message from: the campaign name, `world_setting`, three integer counts, and the names of the first
three NPCs. That is the whole prompt:

> My campaign "X" is set in Y. It has 4 factions, 12 locations, and 30 NPCs. Recent additions: Volo,
> Durnan, Mirt. Give me 3 world-building suggestions to develop this world further.

**No lore text is injected. None.** Not a single lore entry's content, not a location description, not
an NPC's motivation or secret, not a faction's description. The model is told how *many* things exist,
not what any of them are. There is no token budget because there is nothing to budget — the prompt is
a few hundred characters regardless of campaign size.

**The AI Assistant chat** (`src/pages/AIAssistant.jsx`) does better but not by much.
`buildSystemPrompt` (`AIAssistant.jsx:11-28`) injects: campaign name and setting; *every* player
character with race/class/level; the first **five** NPC **names** only, plus "and N more"; and *every*
faction **name**. Again: no lore, no locations, no descriptions, no notes, no secrets, no motivations.
The only budget is `MAX_HISTORY = 20` (`AIAssistant.jsx:7`), applied as `.slice(-MAX_HISTORY)` to the
message array at `AIAssistant.jsx:179`; output is capped at `max_tokens: 1024` in
`electron/services/AIService.js:105`. The character and faction lists are themselves unbounded — a
campaign with 60 factions puts 60 names in every system prompt.

Chat lives in `src/stores/aiStore.js`, a plain zustand store with no `persist` middleware, so the
conversation is gone on app restart. (Compare `src/stores/campaignStore.js`, which does use `persist`.)

**The one place AI output *is* persisted** is the compendium importers:
`src/components/compendium/BulkImportModal.jsx:117-120` and
`src/components/compendium/SourceBookImportModal.jsx:87, 118, 128` run `ai.complete` over a PDF chunk
and write the structured result through `db:compendium:create` or `db:subclasses:create`. So the
machinery for "AI produces structured data → app saves it" already exists and works — it just points
at monsters, spells, equipment and subclasses rather than at the world.

**Can a DM say "add a rival thieves' guild in Waterdeep" and end up with a persisted faction + NPC +
lore entry?** No. They will get three sentences of prose in a chat bubble, which they must then
re-type by hand into three separate forms.

### c. How I explain it

The AI can riff — I can ask it for world-building ideas or chat with it about my campaign, and it
knows my campaign's name, my party, and roughly how big my world is. But it's a conversation, not an
assistant: nothing it says gets saved. If I like an idea, I copy it out by hand into the NPC form
myself. And it's working half-blind — it knows I have thirty NPCs, but it's never been shown a word of
my actual lore.

### d. Gaps and risks

**The `no-ai` guard in the World Builder panel never fires.** `AISuggestionPanel.jsx:13-14` does
`const mode = await window.electronAPI.ai.getMode(); setAiMode(mode)`. But `ai:getMode` returns an
*object*: `ipcMain.handle('ai:getMode', () => ({ mode: aiService.getMode() }))`
(`electron/ipc/aiHandlers.js:9`). So `aiMode` holds `{mode:'no-ai'}`, and the check at
`AISuggestionPanel.jsx:56` (`aiMode === 'no-ai'`) is comparing an object to a string — always false.
The friendly "Configure your API key in Settings" message is unreachable. A DM in `no-ai` mode sees an
enabled "Generate Suggestions" button, clicks it, and gets `Error: No AI service available. Please
configure an API key or install Ollama.` rendered as a suggestion (`AISuggestionPanel.jsx:39`).
`TopBar.jsx:25` and `AIAssistant.jsx:33-36` both destructure correctly — this is an isolated slip in
one file, and a one-line fix.

**Context poverty is the deeper problem.** Even with persistence bolted on, an assistant told only
that a world has "12 locations" cannot produce lore that fits the world. It cannot avoid contradicting
established facts because it has never been shown them. Any serious version of this feature needs
retrieval over the DM's own lore — which is notable, because **DMCS already has a working retrieval
pipeline** (`EmbeddingService` + `RAGService`); it is simply pointed exclusively at PDF chunks and has
never been aimed at the campaign's own tables.

**Unbounded prompt growth.** `buildSystemPrompt` interpolates every character and every faction with
no cap. This is fine at 5 factions and a real cost at 100 — silently, on every message, with no
truncation and no warning.

**Chat history is lost on restart** (`aiStore.js` has no `persist`), so there is no record of what the
AI suggested last week even for manual re-entry.

**AI failures are unlogged.** `AIService.complete` logs successful calls to `ai_usage_log`
(`AIService.js:86-94`) but a thrown call logs nothing, so the Settings usage stats systematically
undercount and never show a failure rate.

### e. Path to solved

**Stage 1 — make output saveable (no migration, ~4–5 days).** This is the cheapest large win in the
document.

Add a structured-output mode to the World Builder panel: change the system prompt at
`AISuggestionPanel.jsx:24-28` to request strict JSON of the shape
`{ suggestions: [{ kind: 'npc'|'location'|'faction'|'lore', name, fields: {...} }] }` — exactly the
technique `src/utils/compendiumExtractor.js` already uses successfully for PDF extraction, so copy its
prompt discipline and its parsing/repair helpers rather than inventing new ones. Render each
suggestion as a card with **Save** and **Edit & Save** buttons wired to the *existing*
`db:npcs:create`, `db:locations:create`, `db:factions:create` and `db:lore:create` channels — all four
are already in `preload.js` and need no changes. Then, when the DM saves more than one entity from a
single suggestion, also write the `connections` rows joining them (also an existing channel), so "a
rival thieves' guild in Waterdeep" lands as a faction + an NPC + a lore entry + two connections in one
click.

**Stage 2 — give the AI real context (~3 days).** Extend `buildSystemPrompt`
(`AIAssistant.jsx:11-28`) to include location names with one-line descriptions and lore entry titles,
hard-capped by a character budget (mirror `RAGService`'s `maxContextLen = 3000` approach at
`RAGService.js:25, 79`). Then aim the *existing* embedding pipeline at campaign lore:
`EmbeddingService.embedSource` already knows how to embed arbitrary text and store it in vectra with
metadata — feeding it `compendium_custom` rows with `type='lore'` alongside `pdf_chunks` is a metadata
change and a second index namespace, not a new system. This makes "does this contradict anything?"
answerable. AI required (Ollama for embeddings even in online mode — see Q4).

**Stage 3 — AI session recaps (~2 days, depends on Q2's `sessions` table).** Feed `sessions.notes` to
`ai.complete` and write the result to `sessions.recap`. This is the feature Tabletop Arc and Archivist
are built on, and once `sessions` exists it is a small addition.

**Total: ~9–10 days to a genuinely useful PARTIAL/SOLVED.** Stage 1 alone moves this to PARTIAL.

---

## Q4. Can it pull up rules and solve situations?

### a. Verdict

**PARTIAL** — the retrieval pipeline is real, well-engineered and better than a naive RAG. But it
covers only uploaded PDFs (never the SRD), it hard-requires Ollama in every mode, it has no `no-ai`
path at all, and it retrieves passages rather than adjudicating situations.

### b. How it works today

The chain is `PdfIngestionService` → `EmbeddingService` → `RAGService`, and every link is present.

**Ingestion** (`electron/services/PdfIngestionService.js`): the PDF is copied into
`userData/pdfs/<timestamp>_<name>.pdf` (`PdfIngestionService.js:15-19`), text is extracted with
`pdf-parse` and split on form-feed characters into pages (`PdfIngestionService.js:22-31`), then
chunked.

**Confirmed chunk size: 400 tokens with 80 tokens of overlap, minimum 50 tokens**
(`PdfIngestionService.js:34-39`), converted to characters at a flat 4 chars/token, so 1600-char chunks
with 320-char overlap (`PdfIngestionService.js:41-42`). Chunks never span a page boundary — the loop
is per-page — which is what makes page attribution trustworthy later. Rows land in `pdf_chunks`
(migration 003) inside one transaction (`PdfIngestionService.js:70-77`).

**Embedding** (`electron/services/EmbeddingService.js`): each un-embedded chunk is sent to Ollama's
`nomic-embed-text` and inserted into a `vectra` `LocalIndex` at `userData/vectra`, with
`{chunk_id, source_id, page_number, text}` as metadata; `pdf_chunks.embedded` and `embedding_model`
(migration 004) are set per chunk (`EmbeddingService.js:72-114`). The `embed()` method tries the
modern `/api/embed` endpoint and falls back to legacy `/api/embeddings` on a 404, with a specific,
helpful error if the model isn't pulled (`EmbeddingService.js:23-69`).

**Confirmed: contiguous-chunk stitching is real, and it's the most sophisticated code in the
project.** `_expandContiguous` (`EmbeddingService.js:222-282`) doesn't walk blindly outward from a
single anchor. It picks the highest-scoring hit as the anchor, maps every same-source hit to its
`chunk_index`, discards hits more than `NEIGHBOUR = 12` chunks away, then takes the span from the
earliest to the latest surviving hit and fills the gaps plus `BACK_MARGIN = 2` chunks before (to catch
a heading) and `FWD_MARGIN = 4` after (to catch a capstone feature). It then drops any chunk whose
page drifts more than 3 pages from the anchor, as a guard against spilling into an adjacent entry, and
returns the cluster *first* so it can't be crowded out of the downstream character budget. The
reasoning is documented in a 19-line comment at `EmbeddingService.js:204-221`.

**Query** (`electron/services/RAGService.js`): **confirmed top-k default is 5**, with a
`maxContextLen` of 3000 **characters** (`RAGService.js:25`). The query is first expanded with a small
hand-built D&D synonym table — "save" → "saving throw", "dc" → "difficulty class", and five others
(`RAGService.js:9-22`). Results are filtered to the active campaign's sources (`RAGService.js:31-36`).
If fewer than two chunks score above 0.5, a keyword `LIKE` search over `pdf_chunks` is merged in at a
flat 0.4 score and deduped (`RAGService.js:38-63`).

**Confirmed: page attribution is real.** Each chunk enters the prompt as
`[Source: <filename>, p.<n>]` (`RAGService.js:78`), and the handler returns a `sources` array of
`{source, page, preview, score}` (`RAGService.js:81-86`) which `src/components/ai/RAGQueryPanel.jsx`
renders as an expandable "📄 Sources consulted (N)" panel (`RAGQueryPanel.jsx:158-170`). The system
prompt instructs the model to answer using **only** the provided context and to say so if the context
is insufficient (`RAGService.js:100-106`).

### c. How I explain it

I can drop my own PDFs — the books I actually bought — into the app, and it slices them up, indexes
them, and answers rules questions by quoting the relevant passage back at me with the page number, so
I can check it. It's smart about pulling a whole subclass or stat block rather than a half-sentence
fragment. The catch is it only knows the books I've uploaded — the free SRD data the app ships with
isn't in that index — and the indexing needs Ollama installed locally even if I'm paying for the
Claude API.

### d. Gaps and risks

**It does not work with only the SRD.** The `srd_cache` table is never touched by any part of the RAG
pipeline — `RAGService` queries `pdf_chunks` and `pdf_sources` exclusively. With no PDFs uploaded,
`contextText` is empty and Step 6 (`RAGService.js:89-97`) falls straight through to
`aiService.complete` with a generic "You are a D&D 5e rules expert" prompt — i.e. the model's own
training data, with `noSourcesFound: true` and an empty sources array. That's an honest fallback, but
it is not grounded retrieval, and it directly contradicts `DMCS_AI_Spec_Sheet.md:53` (M11: "Query SRD
and uploaded PDFs using RAG").

**It does not work in `no-ai` mode at all.** There is no plain-text compendium search path here.
`RAGQueryPanel.jsx:82` gates the Ask button on `hasEmbedded` — whether any PDF has chunks — and *not*
on AI mode. So in `no-ai` with a PDF indexed, the button is enabled, the query fires, and it fails:
either `EmbeddingService.embed()` throws because Ollama isn't there, or `aiService.complete` throws
`No AI service available` (`AIService.js:82`). The DM gets a raw error string. A `no-ai` DM does still
have `db:compendium:search` (`dbHandlers.js:289-296`) and the SRD browsers, but those are name-only
lookups on a different page, not a rules Q&A.

**Ollama is required even in `online` mode, and the failure is total.** `EmbeddingService.search()`
calls `this.embed(queryText)` at line 121 — *before* any fallback logic. The SQLite keyword fallback
at `EmbeddingService.js:135-174` only triggers when the vectra index returns **zero results**, which
can't be reached if `embed()` has already thrown. So with a valid Claude key but Ollama not running,
`RAGService.query` throws at Step 1 and the whole feature is dead. `ai:ragQuery`
(`aiHandlers.js:29-31`) has no `try`/`catch`, so this surfaces to the renderer as a raw rejection.
The README does warn "Embeddings require Ollama running even when chat is online" — accurate, but it
undersells that this is a hard dependency with no degraded mode.

**Verified bug: `EmbeddingService.embedSource` always throws at the end.** Line 108-111 runs
`UPDATE pdf_sources SET status='embedded'`, but the CHECK constraint from migration 001 is
`status IN ('pending','indexed','failed')` (`DatabaseService.js:205`). I reproduced this against the
real DDL: `CHECK constraint failed: status IN ('pending','indexed','failed')`. Because the per-chunk
vectra insert and `pdf_chunks.embedded=1` update happen *before* this line, the embedding work is
actually saved and search does work — but `embed:source` (`electron/ipc/embeddingHandlers.js:6-10`)
rejects, so the UI reports failure after a successful multi-minute job. Two other places already
expect the impossible `'embedded'` value: `dbHandlers.js:579` (`WHERE ps.status IN ('indexed',
'embedded')`) and `AIAssistant.jsx:78` / `RAGQueryPanel.jsx:24` (which are saved only by their
`|| s.chunk_count > 0` clause). Fix: widen the CHECK in migration 009, or write `'indexed'`.

**Cross-campaign dilution.** `RAGService.query` asks the vector index for the global top-5 and *then*
filters by campaign (`RAGService.js:29-36`). A DM with the PHB in campaign A and nothing in campaign B
gets 5 hits, all filtered out, every time. The `topK` should be pushed down into the vectra query as a
metadata filter, or over-fetched and filtered.

**Deleting a PDF orphans its vectors.** `pdf:delete` (`electron/ipc/pdfHandlers.js:43-48`) deletes the
chunks, the source row and the file, but never calls `embeddingService.deleteSource(sourceId)` — even
though that method exists (`EmbeddingService.js:386-393`), is exposed in preload, and *is* correctly
called by `reIngest` (`PdfIngestionService.js:97-99`). The stale vectors are invisible to
`RAGService` (which filters by live `pdf_sources` rows) but not to `embed:search`, which the
compendium importer uses unfiltered.

**It retrieves, it does not adjudicate.** "A grappled creature tries to cast a somatic spell while
prone" requires composing three separate rules — grappled sets speed to 0, prone imposes disadvantage,
somatic components need a free hand — and none of those passages contain the others' keywords. Query
expansion (`RAGService.js:9-22`) covers seven single words and none of the condition names. With a
3000-character budget and top-5, a multi-condition question will retrieve one or two of the three
relevant passages and the model will answer from a partial picture — plausibly, and without flagging
what it's missing. For single-rule lookups ("what does *restrained* do", "how far can I jump") it is
genuinely good.

**Chunking is naive about structure.** Fixed 1600-char windows sliced from raw `pdf-parse` output,
with no awareness of columns, stat-block boundaries or tables. Two-column PDFs interleave text across
columns before chunking. `_expandContiguous` exists precisely to paper over this, and it does so well —
but the underlying extraction is lossy for tabular content.

### e. Path to solved

**Index the SRD (~2 days, no migration).** `srd_cache` already holds full JSON for every monster,
spell and equipment item. Serialise each to readable text and feed it through the existing
`EmbeddingService.embedSource` path with `source_id = 0` (or a sentinel `pdf_sources` row named "SRD
5.1"). Add it to the campaign filter set in `RAGService.js:31-36` unconditionally. This makes rules
Q&A work out of the box for a DM who has uploaded nothing, which is every new user.

**Add a real `no-ai` path (~1.5 days).** When `aiService.getMode() === 'no-ai'`, skip the model
entirely and return the top chunks verbatim as an "extracted passages" result — same `sources` panel,
no `answer`. `RAGQueryPanel.jsx` already renders sources independently, so the UI change is small.
Gate the button on mode as well as `hasEmbedded`.

**Make Ollama optional for querying (~1 day).** Wrap `EmbeddingService.search`'s `embed()` call in a
`try`/`catch` that falls through to the *existing* SQLite keyword branch at lines 135-174 rather than
throwing. That code is written, tested and unreachable today; this is a five-line change that turns a
total failure into a degraded one.

**Fix the three verified bugs above** (CHECK constraint, orphaned vectors, cross-campaign dilution).
Effort: **1 day** total.

**Situation adjudication (~3 days, AI required).** Add a "Situation" mode to `RAGQueryPanel` that
first asks the model to decompose the question into constituent rules concepts, runs a retrieval per
concept, unions the results, and then asks for a ruling with each component cited. Extend the
`expandQuery` table (`RAGService.js:10-18`) to cover all 15 condition names — `combatUtils.js:71-87`
already has them with descriptions, so it can be generated from that constant rather than hand-written.

**Total: ~8–9 days to SOLVED.**

---

## Q5. How does it manage maps?

### a. Verdict

**PARTIAL** — upload, grid, fog, tokens, the pop-out window and the fog-enforced player view are all
genuinely implemented and work. Measurement, scale, layers and any lifecycle handling are absent, and
the remote player server has no access control.

### b. How it works today

The `maps` table (migration 001, `DatabaseService.js:169-179`) is:
`campaign_id`, `name`, `location_id`, `image_path`, `grid_size INTEGER DEFAULT 50`, `fog_data`,
`tokens`. The last two are JSON strings, initialised to `'[]'` on create (`dbHandlers.js:243`).
Migration 007 added the reverse link, `encounters.map_id INTEGER REFERENCES maps(id)`, plus
`locations.has_own_map` and `locations.floor_number`.

**Upload** goes through `electron/ipc/fileHandlers.js`: an OS file dialog, a copy into
`userData/maps/`, and a stored absolute path. Rendering avoids IPC round-trips and base64 entirely via
a custom privileged scheme — `preload.js:139-142` converts a path to `dmcs-asset:///<encoded path>`
and `electron/main.js:87-89` registers `dmcs-asset` as a privileged scheme whose handler reads the
file and returns a `Response`.

**Fog of war** is a flat boolean array, `fogData[row * numCols + col] === true` meaning *revealed*
(`src/utils/fogUtils.js:1-16`). `setBrushRevealed` (`fogUtils.js:18-29`) paints a square brush;
`MapToolbar.jsx` exposes brush sizes 1/3/5 and reveal-all / hide-all. Grid dimensions are derived from
image size and `grid_size` (`fogUtils.js:31-38`), and `isCellInViewport` (`fogUtils.js:41-50`) culls
off-screen cells so a 3000×3000 map doesn't render 3600 rects.

**Confirmed: player fog enforcement is real, and it goes further than opacity.** In
`src/components/map/MapCanvas.jsx:290-292` the fog fill is `rgba(0,0,0,1)` — fully opaque — in player
mode versus `rgba(10,8,5,0.92)` for the DM. And at `MapCanvas.jsx:429-438` the token layer *filters
out* any token standing on an unrevealed cell in player mode, so a hidden ambush isn't merely dimmed;
it is not drawn.

**Tokens** are `{id, label, type, col, row, color, entity_type, entity_id}`
(`src/utils/tokenUtils.js:2, 12-21`) with four colour-coded types (player/npc/monster/object) and grid
snapping (`tokenUtils.js:24-27`). `entity_type`/`entity_id` let a token point back at an NPC or
character, which `src/components/map/TokenInspector.jsx:21` uses to fetch and display the NPC record.

**The pop-out combat window** is `encounter:openMapWindow` → `createEncounterMapWindow`
(`main.js:37-68`), a second `BrowserWindow` at `#/maps?autoMap=<id>` which `MapEngine.jsx:17, 144-147`
picks up to auto-open that map. Note this is a second **DM** window, not a player view; the player
view is a separate window at `#/player?campaign=<id>` (`main.js:8-32`).

**Live sync to players** happens by broadcast, not polling: `MapEngine.jsx:59-86` pushes `fog:update`
and `token:update` messages through `player:broadcast`, relayed in `main.js:79-83` to the player
window.

**Linking:** `maps.location_id` is set from a dropdown in the create/edit modal and JOINed back as
`location_name` by `db:maps:getAll` (`dbHandlers.js:224-231`). `encounters.map_id` is set by
`db:encounters:setMapId`. **Multiple maps per location are supported** — the FK is on the map side, so
N maps can point at one location, and `locations.floor_number` exists to distinguish them (though
nothing in the map UI reads or displays it).

**Grid support: yes.** Per-map `grid_size`, live-adjustable from the toolbar
(`MapEngine.jsx:40`, `MapToolbar.jsx`), used for fog cells, token snapping and grid rendering.

### c. How I explain it

I drop in a battlemap image, set the grid size to line up with the squares, then paint fog over it
with a brush. Players see a second window — or their own phones over the network — where everything
I haven't revealed is solid black, and monsters standing in the dark genuinely aren't drawn on their
screen, not just dimmed. I can pop the map out into its own window for combat, and maps can be tied to
a location, several per place if it's a multi-floor dungeon.

### d. Gaps and risks

**No measurement, no scale, no ruler.** The toolbar has exactly four tools — pan, fog-reveal,
fog-hide, token (`MapToolbar.jsx:67-99`). There is no distance measurement anywhere in the codebase; a
grep for ruler/measure/distance/feet across `src/components/map/`, `MapEngine.jsx` and the player
`MapView.jsx` returns nothing relevant. `grid_size` is pixels-per-cell, with no notion that a cell is
5 feet. So a DM cannot answer "is he in range of my Fireball?" from the map — the single most common
thing a DM does with a battlemap during combat.

**No layers, no drawing.** The Konva `<Layer>` elements at `MapCanvas.jsx:397-452` are four fixed
rendering layers (image, grid, fog, tokens) — not user-manipulable layers. There is no way to draw a
wall, drop a light source, add a text label, or place a map-only annotation.

**Deleting a location that has a map fails.** Same root cause as Q1: `maps.location_id` has no
`ON DELETE` clause and `foreign_keys` is ON. Verified — the delete raises
`FOREIGN KEY constraint failed`. So the answer to "what happens to a map when its location is
deleted?" is: **the location deletion is silently refused, and the map is untouched.** The DM sees
nothing.

**Deleting a map orphans its files and its encounter link.** `db:maps:delete`
(`dbHandlers.js:259-260`) is a bare `DELETE FROM maps`. The image in `userData/maps/` and the
thumbnail in `userData/maps/thumbs/` are both left on disk forever. And `encounters.map_id` still
points at the dead row — no cascade, no `SET NULL` — so `db:encounters:getById` returns a `map_id`
that resolves to nothing.

**No access control on the remote player server.** `PlayerServer.js:60-110` exposes
`/api/campaign/:id`, `/api/character/:id`, `/api/campaign/:id/characters` and `/api/map/:id` with
**no session-token check on any of them**, plus `Access-Control-Allow-Origin: *`
(`PlayerServer.js:50`). The join token is validated only on the Socket.IO `player:identify` event
(`PlayerServer.js:185-195`). `/api/map/:id` returns `SELECT * FROM maps` — the entire row, including
the full `tokens` array and the complete `fog_data` mask. So fog enforcement for **remote browser
players is client-side rendering only**: the raw positions of every hidden monster are served to
anyone who can reach the port, and map ids can be enumerated by incrementing an integer. On a LAN this
is a curious player with devtools; through the ngrok tunnel (`electron/server/TunnelService.js`) it is
the public internet. The in-app Electron player window is not exposed this way. This should be
stated plainly rather than claimed as enforcement — see Part 2b, where I rank this differentiator
accordingly.

**Fog resolution is tied to grid size.** Changing `grid_size` after painting fog re-derives `numCols`
(`fogUtils.js:31-38`) while `fog_data` keeps its old length and indices, so the painted fog shifts and
smears. Nothing migrates or invalidates the mask on a grid change.

**`locations.floor_number` and `has_own_map` are written but never read** by the map UI — set in
`Locations.jsx` and persisted by `dbHandlers.js:101-114`, then unused.

### e. Path to solved

**Measurement tool (~2 days, no migration).** Add a `measure` tool to `MapToolbar.jsx:67-99` and a
drag-line handler in `MapCanvas.jsx` that renders a Konva `Line` plus a `Text` label. Add
`maps.feet_per_cell INTEGER DEFAULT 5` in migration 009 with a field in the create/edit modal, and
compute both Euclidean and 5e grid distance (every square = 5 ft, the standard PHB rule). This is the
single highest-value map addition.

**Map lifecycle (~1.5 days).** In migration 009, rebuild `encounters` with
`map_id … ON DELETE SET NULL` (same table-recreate pattern as Q1). Extend `db:maps:delete` to unlink
the image and thumbnail from disk via `fs.unlinkSync` inside a `try`/`catch`, following
`pdfHandlers.js:46`.

**Player server auth (~1 day).** Add an Express middleware that requires the join token (already
minted at `PlayerServer.js:149-151`) as a header or query param on every `/api/*` route, and scope
each query to `session.campaignId`. Then filter `/api/map/:id`'s response server-side: strip tokens
standing on unrevealed cells and return the fog mask only as needed. `src/utils/fogUtils.js` is a pure
ES module and the same `isCellRevealed` logic can be duplicated main-side in a few lines.

**Fog/grid coupling (~0.5 days).** On grid-size change, either resample the mask or prompt to clear
it. Store `numCols` alongside `fog_data` so a mismatch is detectable.

**Total: ~5 days to SOLVED**, and the auth item should be treated as a security fix rather than a
feature.

---

## Q6. Can it create maps?

### a. Verdict

**MISSING** — DMCS is strictly upload-only. There is no map generation of any kind: not procedural,
not AI-image, not tile-based, not template-based. Searches for `generateMap`, `procedural`,
`dungeonGen`, `roomGen`, `tileset` and `generate.*map` across `src/`, `electron/` and `player/` return
only `generateThumbnail` (a Konva canvas export, `MapCanvas.jsx:36`, `MapEngine.jsx:90`) and Ollama's
`/api/generate` endpoint (`AIService.js:72`). Neither has anything to do with map creation.

### b. How it works today

The only path from nothing to a map is: `file:openImageDialog` → OS picker → `file:copyMapImage` into
`userData/maps/` → `db:maps:create` with the stored path (`MapEngine.jsx:28, 150-165`;
`electron/ipc/fileHandlers.js`). The DM must bring their own image, from Dungeon Alchemist, Inkarnate,
DungeonDraft, a scanned module, or a Google Images result.

What DMCS adds *after* upload is real — grid alignment, fog, tokens, player sync (Q5) — but the
creation step is entirely outside the app.

### c. How I explain it

It doesn't make maps. I make or buy the image somewhere else and bring it in — then DMCS handles
everything after that: the grid, the fog, the tokens, and what the players are allowed to see.

### d. Gaps and risks

The practical consequence is that DMCS cannot serve an improvising DM. A party goes somewhere
unplanned, and there is no way to produce a usable battlemap inside the app — the DM alt-tabs to
another tool, exports a PNG, and comes back. That is the single most common live-play failure mode
this feature would address.

There is also no blank-canvas option: a DM cannot create a map with no image at all and just use the
grid, fog and tokens on an empty field, because `db:maps:create` accepts a null `image_path`
(`dbHandlers.js:241-243`) but `MapCanvas` renders `getMapDimensions` from `imageSize`, falling back to
a hardcoded 3000×3000 (`fogUtils.js:31-33`). Whether that degrades gracefully is untested — I could
not run the GUI (see Appendix: Unverified).

### e. Path to solved

**Dungeon Alchemist-style 3D generation is out of scope, and should be stated as such.** It is a
Unity application with a bespoke 3D asset pipeline, procedural furniture placement, and real-time
lighting — years of specialised work, none of it expressible in React + Konva. Konva is a 2D canvas
library; the stack is locked per the README (no new libraries). Competing there is not a roadmap item,
it is a different product. DMCS's honest position is "bring the map you made in Dungeon Alchemist" —
they are complements, not competitors.

Three realistic options within the locked stack:

**Option A — Konva-based procedural dungeon generator.** A pure-JS BSP or room-and-corridor generator
(the classic algorithm is ~200 lines: recursively split a rectangle, place a room in each leaf,
connect siblings with L-corridors) producing a room/corridor cell grid, rendered as Konva `Rect`s and
`Line`s on the existing `MapCanvas` stage, then exported to PNG via the `generateThumbnail` machinery
that already exists (`MapCanvas.jsx:36`) and saved through `file:saveExportedImage`
(`preload.js:144-145`, already in preload). Parameters: size, room density, corridor width, theme
colours.
*Pros:* fully offline, works in `no-ai` mode, instant, deterministic with a seed, zero new
dependencies, reuses the grid/fog/token stack unchanged, and the output is exactly the kind of map
that gets improvised (a dungeon). *Cons:* geometric and abstract-looking, not artwork; bad at
above-ground or urban maps.
*Effort:* **4–5 days** (2 for the generator + tests, 2 for the UI and parameter panel, 1 for export
and wiring).

**Option B — tile stamper.** A palette of tile images (floor, wall, door, water, stairs) that the DM
paints onto the grid with a brush, saved as a `tiles` JSON array alongside `fog_data` and `tokens` and
rendered as a fifth Konva layer.
*Pros:* prettier than Option A, gives full authorial control, and the paint-brush interaction is
almost identical to the fog brush already built (`fogUtils.js:18-29`) so much of the interaction code
is reusable. *Cons:* it is *manual creation*, not generation — it does not solve the improvisation
problem, it just moves the drawing tool in-app. It also needs an art asset pack, which is a
licensing and sourcing problem, not a coding one.
*Effort:* **5–6 days** plus unresolved art sourcing.

**Option C — AI image generation.** Out of the question under the current constraints: the Anthropic
SDK is the only AI dependency and it does not generate images; adding an image model means a new
provider, a new dependency, per-map cost, and it breaks the `no-ai` and offline guarantees that are
DMCS's main differentiator. Discounted.

**Recommendation: Option A**, then Option B's brush as a follow-on *editing* layer on top of generated
output. Option A is the only one that solves the actual problem (a map appears in ten seconds when the
party goes off-book), it is the only one that works in `no-ai` mode — which is where DMCS's identity
is — and it needs no assets, no licensing and no new libraries. Adding `maps.generated_params TEXT`
in migration 009 to store the seed and parameters makes generated maps re-rollable and tweakable,
which is worth the one extra column.

Migration: 009 (`maps.generated_params TEXT`, plus `maps.feet_per_cell` from Q5). New handlers: none
required — the generator runs in the renderer and saves through the existing
`file:saveExportedImage` + `db:maps:create` + `db:maps:updateImagePath` chain. New components:
`src/components/map/MapGeneratorModal.jsx` and `src/utils/dungeonGen.js` (pure, and therefore the
best possible first Vitest target). AI: **not required**.

---

## Q7. How does it manage combat?

### a. Verdict

**PARTIAL** — the initiative tracker is a competent, complete-feeling live-play tool for one sitting.
Nothing about it survives closing the app, and several 5e resources it appears to track are display
only.

### b. How it works today

`src/components/encounter/InitiativeTracker.jsx` (711 lines) is a three-phase state machine — setup,
active, ended — driven entirely by React state.

**Combatants** are built on mount by `buildCombatants` (`src/utils/combatUtils.js:8-57`), which parses
`encounters.monsters`, expands each entry by its `count` into individually named combatants ("Goblin
1", "Goblin 2"), and appends every campaign character with an initiative modifier derived from their
DEX (`combatUtils.js:35-53`).

**Turn order:** the DM types each combatant's initiative, or clicks "roll all monsters"
(`InitiativeTracker.jsx:86-92`); `sortByInitiative` (`combatUtils.js:59-63`) sorts descending with a
DEX-modifier tiebreak. `handleNextTurn` (`InitiativeTracker.jsx:115-136`) advances through **living**
combatants only, detects wrap-around to increment the round counter, and logs each transition.

**HP tracking** (`applyHP`, `InitiativeTracker.jsx:138-180`) applies damage or healing with clamping
at 0 and `hp_max`, and writes a combat-log entry showing the before → after values. Dropping to 0
logs "unconscious" for players and "defeated" for monsters, and defeated combatants sink to the bottom
of the display order (`orderedCombatants`, `InitiativeTracker.jsx:109-113`).

**Conditions:** all 15 official 5e conditions with colours, icons and rules-text summaries
(`combatUtils.js:71-87`), toggled per combatant with a log entry (`InitiativeTracker.jsx:182-192`).

**Concentration** is a per-combatant flag. When a concentrating combatant takes damage, the tracker
computes `DC = max(10, floor(damage / 2))` — the correct RAW formula — raises a 5-second alert and
logs it (`InitiativeTracker.jsx:164-172`).

**HP sync back to `characters`: confirmed, and it happens once, at the end.** `handleEndCombat`
(`InitiativeTracker.jsx:211-234`) collects every player combatant with an `entity_id`, calls
`db:characters:bulkUpdateHP` (`dbHandlers.js:374-379`), and broadcasts a `character:sync` message per
character so the player window refreshes live.

**Combat log** (`src/components/encounter/CombatLog.jsx`) records typed entries — start, turn, round,
damage, heal, condition, concentration, defeat, end — tagged with the round number.

**Map connection** is one-way. `populateTokens` (`InitiativeTracker.jsx:236-259`) reads a chosen map,
generates a token per combatant (players in row 0, monsters in rows 1+), and appends them via
`db:maps:updateTokens`.

### c. How I explain it

I roll initiative, the tracker sorts everyone, and I click through turns while it counts rounds. I
apply damage and healing per combatant, slap conditions on people, and it warns me with the right DC
when a concentrating caster gets hit. It keeps a running log of the whole fight. When combat ends, my
players' HP gets written back to their character sheets automatically, and their own screens update.
I can also push everyone onto a battlemap as tokens in one click.

### d. Gaps and risks

**Combat state does not survive an app restart. It does not survive navigating away from the page.**
This is the headline gap, and the code says so itself — line 1 of `src/utils/combatUtils.js` reads
"Combatant shape stored in-memory during combat (NOT persisted)". Everything — initiative order, every
combatant's current HP, every condition, the round counter, the entire combat log — is React state in
one component. There is no `combat_state` table, no `db:combat:*` channel in `preload.js`, and no
persistence call anywhere in the file except the one-shot HP write at the end. A crash, an accidental
click on another sidebar item, or a power cut during a three-hour boss fight loses all of it, and the
players' HP never reaches their sheets because `handleEndCombat` never ran.

**Death saves are implemented, but not where combat happens.** `CharacterSheet.jsx:127-139` has a full
death-save roller persisting to `stats.death_saves`, and the player view renders the pips
(`PlayerCharacterSheet.jsx:118, 170`). The **initiative tracker has none of it** — a player at 0 HP
gets a log line reading "💤 X is unconscious" and nothing more. The DM must leave the tracker, open
that character's sheet, and roll there — losing the tracker's state by navigating away. (Minor rules
note: `CharacterSheet.jsx:131` treats a natural 20 as +2 successes; RAW, a natural 20 immediately
restores 1 HP and ends the dying condition.)

**Legendary actions are display-only.** SRD legendary actions render on the stat block
(`src/components/compendium/MonsterStatBlock.jsx:137-140`) and homebrew stores them as free text
(`CustomMonsterForm.jsx:70, 124`), but there is **no legendary action economy** in the tracker — no
counter, no per-round reset, no prompt at the end of another creature's turn. The DM tracks it on
paper.

**Lair actions do not exist at all.** Zero occurrences of "lair" anywhere in `src/`, `electron/` or
`player/`. No initiative-20 slot, no field, no display.

**Reactions are not tracked.** Displayed on stat blocks (`MonsterStatBlock.jsx:128-131`), never
modelled as a per-round resource.

**Clicking a token does not select a combatant.** The link is one-directional. `TokenInspector.jsx`
can look up the NPC record behind a token (`TokenInspector.jsx:21`), but it has no concept of
combatants, initiative or HP. More fundamentally, the map and the tracker are usually in **different
windows** (`main.js:37-68`) with no shared state and no IPC between them — the tracker pushes tokens
once and the two never speak again. Damage applied in the tracker does not change the token; moving a
token does not touch the tracker.

**Monster AC is almost always wrong.** `buildCombatants` sets `ac: entry.ac ?? 10`
(`combatUtils.js:24`), but `createMonsterEntry` (`encounterUtils.js:21-33`) never writes an `ac` field
— it stores name, source, cr, xp, hp_max, hp_current and count. So every monster in the tracker shows
**AC 10**. Player AC is `10 + dexMod` (`combatUtils.js:46`), ignoring armour entirely, even though
`src/utils/acUtils.js` exists specifically to compute AC correctly and `db:characters:updateAC` stores
overrides.

**No initiative for lair actions, no delayed/readied actions, no temporary HP, no damage types or
resistances.** Damage is a single untyped number.

**The concentration flag is manual.** Nothing sets it when a character casts a concentration spell —
the DM must remember to toggle it, which is the thing they were hoping the app would remember.

### e. Path to solved

**Migration 010 — persist combat.**

```sql
CREATE TABLE combat_state (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  encounter_id  INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  round_count   INTEGER NOT NULL DEFAULT 1,
  phase         TEXT DEFAULT 'setup' CHECK(phase IN ('setup','active','ended')),
  combatants    TEXT NOT NULL DEFAULT '[]',   -- the array from buildCombatants
  log_entries   TEXT NOT NULL DEFAULT '[]',
  updated_at    DATETIME DEFAULT (datetime('now')),
  UNIQUE(encounter_id)
);
```

Handlers: `db:combat:{get,save,clear}`, three preload entries. In `InitiativeTracker.jsx`, replace the
mount effect (`InitiativeTracker.jsx:61-67`) with a load-or-build, and add a debounced save (~500 ms)
on every `setCombatants` / `setRoundCount` / `addLog`. Move the player HP write from end-of-combat only
to also firing on each `applyHP` for player combatants, so a crash can't lose HP. Effort: **3–4 days**,
and this is the highest-priority combat work by a wide margin.

**Death saves in the tracker (~1.5 days).** Add `death_saves: {successes, failures}` to the combatant
shape in `combatUtils.js:8-57`, render pips inline for any player at 0 HP, and reuse the existing roll
logic from `CharacterSheet.jsx:127-139` (extract it to `src/utils/dnd5e.js` first so both call sites
share it — and fix the natural-20 rule while it's being moved). Sync to `stats.death_saves` on combat
end alongside HP.

**Legendary and lair actions (~2 days).** Add `legendary_max`, `legendary_used` and `lair_action_text`
to the combatant shape, populated from the SRD stat block during `createMonsterEntry`
(`encounterUtils.js:21-33` — the SRD JSON already contains `legendary_actions`). Reset `legendary_used`
on each round increment in `handleNextTurn`. Insert a synthetic "Lair Actions" row at initiative count
20 when any combatant has lair text.

**Fix monster and player AC (~0.5 days).** Add `ac: statBlock.armor_class` to `createMonsterEntry`
(the SRD field exists), and call `src/utils/acUtils.js` for players instead of `10 + dexMod`.

**Link tracker and map (~2 days).** The clean approach given the two-window architecture: promote
combat state to the main process (it will be in SQLite after migration 010) and have both windows
subscribe. Broadcast a `combat:update` on every save via the existing `player:broadcast` relay pattern
(`main.js:79-83`), extended to reach map windows. Then `TokenInspector` can show live HP and
conditions, and clicking a token can emit a `combat:select`.

**Total: ~9–10 days to SOLVED.** The first item alone is what a DM would notice.

---

## Q8. Can it create encounters?

### a. Verdict

**PARTIAL** — the XP/CR difficulty calculator is complete, correct and verified exact against the DMG
2014 tables. There is no encounter *generation* of any kind, no location-aware assembly, and no random
encounter tables.

### b. How it works today

**The math is in `src/utils/encounterUtils.js` and I verified it numerically against the DMG.**

`XP_THRESHOLDS` (`encounterUtils.js:38-49`) holds all 20 character levels × 4 tiers. I checked every
one of the 80 values against the DMG 2014 "Experience Point Thresholds by Character Level" table
(p. 82): **all 80 match.** `partyThresholds` (`encounterUtils.js:54-57`) sums per-tier across the
party — I confirmed four level-5 PCs yields `[1000, 2000, 3000, 4400]`, which is exactly right.

`monsterMultiplier` (`encounterUtils.js:60-67`) implements the DMG "Encounter Multipliers" table:
1 → ×1, 2 → ×1.5, 3–6 → ×2, 7–10 → ×2.5, 11–14 → ×3, 15+ → ×4. **Correct.**

`CR_XP` (`encounterUtils.js:4-11`) maps challenge rating to XP; the values present all match the DMG
"Experience Points by Challenge Rating" table. `parseCR` handles the fractional CRs `1/8`, `1/4`,
`1/2` (`encounterUtils.js:13-17`).

`difficultyRating` (`encounterUtils.js:81-88`) compares adjusted XP against the four thresholds with
correct boundary handling. End to end, I confirmed a single CR 5 monster against four level-5 PCs
rates **Easy** (1800 adjusted vs. a 2000 medium threshold) and four CR 2 monsters rate **Hard**
(3600 adjusted vs. 3000 hard / 4400 deadly) — both correct by hand-check.

**This is unambiguously the 2014 rules.** The 2024 DMG replaced the four-tier threshold table with a
three-tier (Low/Moderate/High) per-monster-XP-budget system and dropped the count multiplier entirely.
Nothing in this codebase reflects that, which is consistent — the SRD it seeds from
(`SrdService.js:3-8`, dnd5eapi.co) is SRD 5.1, also 2014.

The calculator surfaces in two places: `src/components/encounter/XPCalculator.jsx` inside the Encounter
Builder (which can pull real party levels from `db:characters:getAll`, `XPCalculator.jsx:28-34`, or
take a manual count/level), and `src/pages/CombatCalculator.jsx` as a standalone page with SRD name
lookup per row.

**Encounters persist** as `encounters` rows (migration 001 + 007) with the monster list as a JSON
array, a `status` of `planned | active | completed`, a stored `xp_total`, an optional `location_id`
and an optional `map_id`. `src/pages/EncounterBuilder.jsx` provides the full CRUD, and
`MonsterSearchPanel.jsx` adds monsters from SRD and homebrew with CR and type filters.

**There is exactly one AI feature here, and it is an advisor, not a generator.**
`XPCalculator.jsx:66-89` sends the *already-assembled* encounter — name, party size, average level,
the monster list, and the computed difficulty — and asks for "2-3 specific, actionable suggestions" on
rebalancing. The result goes to `setAiResult` and is rendered as text. It is never saved and it never
modifies the encounter.

### c. How I explain it

I pick monsters from the SRD or my own homebrew, and it tells me live whether the fight is Trivial,
Easy, Medium, Hard or Deadly for my actual party — using their real levels from their character
sheets, with the proper DMG multipliers for fighting several monsters at once. I can also ask the AI
to critique a fight I've built and suggest tweaks. What it won't do is build the encounter for me:
there's no "give me a Hard fight for four level-5s in a swamp," and it doesn't know which monsters or
NPCs belong to the location I picked.

### d. Gaps and risks

**No AI-assisted encounter generation.** Confirmed by inspection of `EncounterBuilder.jsx`: it
contains no AI call at all, and no reference to generation or randomness. Location appears in that
file only as a dropdown for `location_id` and a `📍 name` badge (`EncounterBuilder.jsx:32, 573-577,
272-273`). "Give me a Hard encounter for four level-5 PCs in a swamp" is not expressible.

**Encounters do not pull a location's NPCs or factions.** `location_id` is a label. Nothing queries
`db:npcs:getByLocation` from the encounter flow — even though that handler exists
(`dbHandlers.js:52-53`), is exposed in preload, and would make this work almost for free. A DM who
built out Waterdeep's Zhentarim cell gets no help when building a Zhentarim ambush.

**No random encounter tables.** No table, no handler, no component, no roller. Nothing to build a
d20 wandering-monster list per region and roll on it — a staple of prep.

**CR 25 through 29 return 0 XP.** `CR_XP` jumps from 24 → 62000 straight to 30 → 155000
(`encounterUtils.js:10`). I verified: `crToXP(25)`, `crToXP(26)` and `crToXP(29)` all return `0`. The
DMG values are 75000 / 90000 / 105000 / 120000 / 135000. No SRD monster occupies that band, so this
only bites homebrew — but it bites silently, contributing 0 XP and rating an ancient-dragon-tier fight
as Trivial. **One-line fix.**

**The party-size multiplier adjustment is missing.** The DMG's encounter multiplier table has a rule
attached: for a party of fewer than three characters, use the *next higher* multiplier; for six or
more, the *next lower*. `monsterMultiplier` (`encounterUtils.js:60-67`) takes only the monster count
and never sees the party. So a 3-monster fight is rated identically for a duo and for a party of
seven, when the DMG intends ×2.5 and ×1.5 respectively. This is the one genuine fidelity gap in
otherwise exact math.

**`parseCR` can return `NaN`.** `parseFloat(cr) ?? 0` (`encounterUtils.js:16`) — `??` only catches
`null`/`undefined`, not `NaN`. Verified: `parseCR('bogus')` returns `NaN`. `crToXP` then yields 0 via
its own `?? 0`, so nothing crashes today, but the `NaN` escapes into any other consumer of `parseCR`.

**Encounter monster HP is a single shared value.** The JSON entry carries one `hp_max`/`hp_current`
for all N copies (`encounterUtils.js:21-33`); per-instance HP only comes into being when
`buildCombatants` expands them (`combatUtils.js:13-32`), and dies with the tracker (Q7).

**The AI advisor's output is not saved** — same pattern as Q3.

### e. Path to solved

**Fix the math first (~0.5 days, no migration).** Add CR 25–29 to `CR_XP`. Change
`monsterMultiplier(count)` to `monsterMultiplier(count, partySize = 4)` and shift one step up when
`partySize < 3` and one step down when `partySize >= 6` — implement it as an index into an array of
the six multiplier values so the shift is `Math.max(0, Math.min(5, idx + delta))`. Update both call
sites (`XPCalculator.jsx:53`, `CombatCalculator.jsx`). Fix `parseCR`'s `NaN`. **These functions are
pure and dependency-free — write the Vitest suite here first** (see hygiene).

**AI encounter generation (~4 days, AI required).** New component
`src/components/encounter/EncounterGenerator.jsx`. Inputs: target difficulty, party (already resolved
by `XPCalculator.jsx:37-44`), location, and an environment/theme string. Compute the XP budget with
the existing `xpBudget` helper (`encounterUtils.js:90-94` — already written and unused by anything).
Then two candidate approaches, and the second is better: rather than asking the model to invent
monsters, pre-filter SRD monsters by CR band and type via `srd:getMonsters`, hand the model that
candidate list plus the budget, and ask it to *select and compose* from it, returning strict JSON
`{ name, monsters: [{index, count}], notes }`. That guarantees every monster is real and every CR is
accurate, and it works with a small local model — which matters, because generation should not be
gated on an API key. Validate against the budget locally, then persist via the existing
`db:encounters:create`. Reuse `compendiumExtractor.js`'s JSON parsing helpers.

**Location-aware assembly (~1.5 days, no AI needed).** When `location_id` is set in the create modal,
call the existing `db:npcs:getByLocation` and show a "Notable figures here" panel offering to add
those NPCs to the encounter (and, once Q1's work lands, the location's factions via
`db:connections:getForEntity`). This is a small change with a large "it knows my world" effect, and it
works in `no-ai` mode.

**Random encounter tables (~3 days).** Migration 010:

```sql
CREATE TABLE encounter_tables (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  die         TEXT DEFAULT 'd20',
  entries     TEXT NOT NULL DEFAULT '[]'   -- [{ roll_min, roll_max, label, encounter_id? }]
);
```

Handlers `db:encounterTables:{getAll,create,update,delete,roll}`, a `RandomTables.jsx` page, and a
"Roll" button that resolves to a linked encounter and opens it. AI optional — an AI button that
populates a table from a location description is a nice addition on top, not a requirement.

**Total: ~9 days to SOLVED**, and the first half-day of it fixes real math bugs.

---

# Part 2 — Differentiation

Competitor rows are based on the one-line descriptions supplied for this review. I did not have
verified access to current competitor feature lists, so cells that their descriptions do not settle
are marked **?** rather than guessed. DMCS cells match the Part 1 verdicts exactly.

## a. Capability matrix

| Capability | DMCS | CharGen | Tabletop Arc | Archivist | Dungeon Alchemist |
|---|---|---|---|---|---|
| World / entity tracking | ⚠️ | ? | ⚠️ | ✅ | ❌ |
| Lore & plot | ⚠️ | ? | ✅ | ✅ | ❌ |
| AI lore generation | ❌ | ⚠️ | ⚠️ | ? | ❌ |
| Rules lookup / RAG | ⚠️ | ❌ | ⚠️ | ❌ | ❌ |
| Map management | ⚠️ | ✅ | ❌ | ❌ | ⚠️ |
| Map creation | ❌ | ✅ | ❌ | ❌ | ✅ |
| Combat tracker | ⚠️ | ? | ❌ | ❌ | ❌ |
| Encounter creation | ⚠️ | ? | ❌ | ❌ | ❌ |
| Session recaps / transcription | ❌ | ⚠️ | ✅ | ✅ | ❌ |
| Player views | ✅ | ? | ? | ? | ❌ |
| Offline operation | ✅ | ❌ | ❌ | ❌ | ✅ |
| Data ownership / local storage | ✅ | ❌ | ❌ | ❌ | ✅ |
| Pricing model (no subscription) | ✅ | ? | ❌ | ❌ | ✅ |
| VTT export | ❌ | ✅ | ❌ | ❌ | ✅ |

Reading the DMCS column: ✅ = SOLVED, ⚠️ = PARTIAL, ❌ = MISSING. Two DMCS cells are ✅ that aren't in
the eight questions — player views and the local-first/pricing pair — and those are exactly where the
differentiation lives.

Notes on specific cells. *Session recaps* is DMCS's starkest ❌: it is the entire product for two of
the four competitors. *VTT export* is ❌ — nothing in the codebase exports to Roll20, Foundry or
Universal VTT format; maps are PNG-in, PNG-never-out. *Map creation* ✅ for CharGen and Dungeon
Alchemist per their descriptions. *Offline operation* is ✅ for DMCS with one caveat: the first-run SRD
seed requires internet (`SrdService.js:3-8`), after which everything except the optional AI works
disconnected forever.

## b. Where DMCS is actually differentiated

Ranked by defensibility — how hard it would be for a funded competitor to match.

**1. Local-first data ownership with no account and no subscription. (Most defensible.)**
**Confirmed.** There is no authentication code anywhere in `electron/`, no telemetry, no cloud
persistence. The entire campaign is one SQLite file under `app.getPath('userData')`, readable with any
SQLite client, backed up by copying a file. This is defensible not because it is technically hard —
it isn't — but because it is *architecturally opposed* to how the three SaaS competitors are built.
Tabletop Arc and Archivist cannot match it without abandoning their business model. It is also the
one thing DMCS can promise about a campaign in five years' time.

**2. RAG over the DM's own purchased PDFs with page attribution. (Highly defensible.)**
**Confirmed** end-to-end: `PdfIngestionService` → `EmbeddingService` → `RAGService`, with real page
citations rendered in the UI (`RAGQueryPanel.jsx:158-170`) and a contiguous-chunk stitching algorithm
(`EmbeddingService.js:222-282`) more careful than most production RAG. Defensible for a legal reason
as much as a technical one: a cloud service cannot invite users to upload copyrighted rulebooks to its
servers. A local app where the PDF never leaves the DM's disk can. That asymmetry is structural.
*Caveat to state honestly:* it covers only uploaded PDFs, not the SRD (Q4), so a new user with no PDFs
gets an ungrounded answer.

**3. Fully functional in `no-ai` mode. (Defensible, and currently under-delivered.)**
**Partially confirmed.** The architecture supports it — `AIService.initialize` degrades
online → offline-ollama → no-ai (`AIService.js:13-38`), and every core loop (world building, maps,
combat, encounters, character sheets, compendium) is pure SQLite with no AI on the path. But two
verified bugs undercut it: the World Builder's `no-ai` guard never fires (Q3d), and rules Q&A offers
no degraded mode at all (Q4d). The claim is true of the app and not yet true of the UI. Cheap to fix,
and worth fixing before it's marketed.

**4. Integrated player view with fog enforcement. (Moderately defensible — with a real caveat.)**
**Confirmed for the in-app Electron player window:** hidden cells are fully opaque and tokens on
hidden cells are not rendered at all (`MapCanvas.jsx:290-292, 429-438`). **Not confirmed for remote
browser players:** `/api/map/:id` serves the whole row — every token, the complete fog mask — with no
session check and `Access-Control-Allow-Origin: *` (`PlayerServer.js:50, 101-110`). Remote fog is
client-side rendering, not enforcement. Rank this fourth, describe it as "fog-enforced player display"
rather than "fog enforcement", and fix the server before claiming more (Q5e).

**5. A single app spanning prep and live play. (Least defensible, most immediately valuable.)**
**Confirmed** as a fact about the app: world building, maps, compendium, character sheets, encounter
building and the initiative tracker are all present in one binary with one data store. Least
defensible because it is a matter of scope rather than architecture — anyone can add features. Most
valuable because it is what a DM feels in session one: not alt-tabbing.

## c. Where DMCS is behind

Blunt, per question.

**Q1 (entity tracking) — Archivist wins, moderately.** DMCS models more *kinds* of entity, and models
them in a real relational schema with a graph view Archivist likely lacks. But Archivist tracks
entities *across sessions*, which is the axis DMCS has none of, and DMCS's own search can't find half
its own data or any lore body text. Call it close, with Archivist ahead on the dimension DMs actually
use between sessions.

**Q2 (lore & plot) — Archivist and Tabletop Arc both win, decisively.** This is not close. A "living
wiki" and "searchable campaign continuity" are precisely plot threads, session history and evolving
entity state — the three things DMCS has no table for. DMCS offers flat notes with a cosmetic lock
icon, one session-notes box that overwrites itself, and a sidebar link to an empty page. Worst
relative position of the eight.

**Q3 (AI lore generation) — Tabletop Arc wins, decisively; CharGen wins on adjacent content.** DMCS
generates text and throws it away. An "AI memory layer" with a living wiki writes back by definition.
The gap is not model quality, it is that DMCS has no write path at all.

**Q4 (rules lookup / RAG) — DMCS wins.** The only question where DMCS is ahead outright. None of the
four competitors is described as doing rules retrieval over the DM's own books with page attribution.
Tabletop Arc's evidence-grounded recaps are RAG over *session transcripts*, a different corpus for a
different question. Protect this lead by indexing the SRD (Q4e) so it works on day one.

**Q5 (map management) — CharGen wins, narrowly.** Comparable fog and tokens are table stakes; CharGen
bundles portraits, tokens and battlemaps into one prep stack. DMCS's grid/fog/token/player-sync
implementation is solid and its player enforcement is better, but no measurement tool is a real
functional gap in live play, and no VTT export means DMCS's maps are trapped in DMCS.

**Q6 (map creation) — Dungeon Alchemist wins, overwhelmingly; CharGen wins too.** DMCS scores zero.
Not a fight worth picking against Dungeon Alchemist (see Q6e). Worth picking against "nothing at all,"
via Option A.

**Q7 (combat) — DMCS wins on features, loses to itself on persistence.** None of the four competitors
is described as offering an initiative tracker, so on paper DMCS wins by default. In practice a
tracker that loses a boss fight to an accidental sidebar click is not something to claim a win with.
The competitor here is Foundry/Roll20 and a paper notepad, and the notepad currently has better
durability.

**Q8 (encounter creation) — DMCS wins on math, loses on generation.** The DMG-exact calculator is
better than most dedicated encounter builders. But "AI-assisted" is the phrase in the market, and
DMCS's AI critiques rather than creates.

**Session recaps and transcription — DMCS scores zero against two competitors whose entire product it
is.** Worth being explicit: DMCS should not try to win transcription (audio pipeline, a different
technical universe, and hostile to a local-first offline design). Recaps *from typed session notes*
are within reach and cheap once `sessions` exists (Q3e Stage 3).

## d. Positioning statement

**Today, honestly:**

> **DMCS — best for the DM who owns their books and their data.** It is a single offline desktop app
> where an entire campaign lives in one SQLite file on your own machine, with no account, no
> subscription, and no server: build your world as linked NPCs, factions and nested locations; drop in
> your battlemaps and run fog-of-war on a second screen your players can actually see; assemble
> encounters against a DMG-exact XP calculator and run initiative with conditions, concentration and
> automatic HP write-back to character sheets. Its distinguishing feature is rules Q&A grounded in the
> PDFs you already paid for — indexed locally, answered with page citations you can check — and the
> whole thing keeps working with the AI switched off entirely.

Every clause is verified above. Note what it does not claim: that AI writes anything to your world,
that it makes maps, that it remembers your sessions.

**After the roadmap:**

> **DMCS — best for the DM who wants a campaign that remembers itself, entirely on their own machine.**
> Everything above, plus a campaign with a memory: sessions, plot threads from hook to payoff, and a
> record of what your players actually know versus what you're still holding back. Ask for a rival
> thieves' guild in Waterdeep and get a faction, an NPC and a lore entry saved and linked — grounded in
> the lore you have already written, not invented over the top of it. Generate a dungeon when the party
> goes off-book, roll on your own wandering-monster tables, and run a combat that survives a crash.
> Still one file, still no subscription, still fully functional offline.

---

# Part 3 — Roadmap

Ranked by table impact ÷ effort, with defensibility as the tiebreak. Effort estimates assume a solo
developer already fluent in this codebase.

## Next 2 weeks

**1. Bug-fix sprint — the four silent failures.** *~2 days.*
No verdict change; this is the price of admission. Migration 009 rebuilds `locations`, `npcs`, `maps`,
`encounters` and `connections` with correct `ON DELETE` behaviour and widens the `pdf_sources.status`
CHECK to include `'embedded'`; add `try`/`catch` + a visible error toast to every renderer delete path
(`Locations.jsx:125`, `CampaignManager.jsx:40`, and the sibling world pages); fix the `getMode()`
object-vs-string comparison at `AISuggestionPanel.jsx:56`; call `embeddingService.deleteSource` from
`pdfHandlers.js:43`. Ranked first because two of these make a *button do nothing with no message* —
the worst class of bug for a solo-developed app with no test suite and users who can't read a stack
trace.

**2. Encounter math fixes + the first Vitest suite.** *~1.5 days.*
Q8 stays PARTIAL but stops being *wrong*: add CR 25–29 to `CR_XP`, add the DMG party-size multiplier
adjustment, fix `parseCR`'s `NaN`. Pair it with the first tests, because `encounterUtils.js` is pure,
dependency-free, and has an authoritative external oracle (the DMG tables) — the ideal place to prove
the harness. Touch points: `src/utils/encounterUtils.js`, `XPCalculator.jsx:53`, `CombatCalculator.jsx`.

**3. Index the SRD into the RAG pipeline.** *~2 days.*
Q4 PARTIAL → nearly SOLVED. Highest ratio of user-visible value to effort in the document: it converts
DMCS's strongest differentiator from "works once you've uploaded a rulebook" to "works on first
launch," which is the difference between a feature users discover and one they don't. Touch points:
`EmbeddingService.embedSource` (new SRD source path), `RAGService.js:31-36` (unconditional inclusion),
one sentinel `pdf_sources` row. No migration.

**4. Remove or build `/lore`.** *~10 minutes now, or fold into item 5.*
Delete the `Sidebar.jsx:19` entry and `src/pages/LoreConnections.jsx`, or leave both until item 5
replaces them. Listed explicitly because a dead link in the primary navigation is the first thing a
new user finds.

## Next 1–2 months

**5. Sessions, plot threads and reveals (migration 009).** *~6–8 days.*
**Q2 PARTIAL → SOLVED. Unblocks Q3 Stage 3.** The single most important feature in this document. It
closes the biggest competitive gap (Part 2c: DMCS loses Q2 decisively to two competitors), it fixes a
live data-loss bug (session notes overwriting `campaigns.description`), and it makes
`campaigns.session_count` finally true. Full plan in Q2e. Not ranked first only because the bug-fix
sprint must precede any migration work.

**6. Persist combat state (migration 010).** *~3–4 days.*
**Q7 PARTIAL → SOLVED.** Ranked immediately after sessions on table impact: right now an accidental
sidebar click during a boss fight destroys the encounter and the players' HP never reaches their
sheets. Full plan in Q7e. Include the per-`applyHP` player HP write so a crash can't lose damage.

**7. Make AI output saveable (Stage 1).** *~4–5 days.*
**Q3 MISSING → PARTIAL.** Ranked after 5 and 6 despite being the flashiest item, because it depends on
nothing but delivers less at the table than durable sessions and durable combat. Reuses existing
`create` channels and `compendiumExtractor.js`'s JSON discipline; no migration. Plan in Q3e Stage 1.

**8. Map measurement tool + `feet_per_cell`.** *~2 days.*
Q5 moves materially toward SOLVED. "Can I reach him?" is asked more often in a session than anything
else on this list. Touch points: `MapToolbar.jsx:67-99`, `MapCanvas.jsx`, `maps.feet_per_cell` in
migration 009.

**9. Player server authentication.** *~1 day.*
No verdict change; a security fix. Required before the ngrok tunnel should be recommended to anyone.
Plan in Q5e.

**10. Combat: death saves, legendary/lair actions, correct AC.** *~4 days.*
Q7 hardening, after persistence lands. The AC fix is half a day and removes a visible embarrassment
(every monster displays AC 10).

**11. Location-aware encounter assembly + AI encounter generation.** *~5.5 days.*
**Q8 PARTIAL → SOLVED.** Do the location-aware half first — it is 1.5 days, needs no AI, and produces
the "it knows my world" feeling that the AI half only amplifies. Plan in Q8e.

## Later / maybe never

**12. Procedural dungeon generator (Option A).** *~4–5 days.*
**Q6 MISSING → PARTIAL.** Genuinely useful and genuinely optional. Ranked here because a DM can bring
a PNG from elsewhere in thirty seconds, whereas none of the gaps above have a workaround. Do it when
the core is durable. Recommendation and rationale in Q6e.

**13. Random encounter tables (migration 010).** *~3 days.*
Nice, classic, and entirely additive. No verdict changes on its own.

**14. AI session recaps (Q3 Stage 3).** *~2 days, requires item 5.*
Cheap once `sessions` exists, and it is the headline feature of two competitors. Worth doing purely
for the demo.

**15. Aim the embedding pipeline at campaign lore (Q3 Stage 2).** *~3 days.*
The right long-term answer for AI quality, and the thing that would make generated lore actually fit
the world. Deferred because it multiplies the value of item 7 rather than standing alone.

**16. VTT export (Universal VTT / Foundry JSON).** *Unestimated.*
Listed for completeness — it is a matrix ❌ against two competitors. Probably never: it serves DMs who
have already chosen a different VTT, i.e. not DMCS's user.

**17. Audio transcription.** *Never.*
Architecturally opposed to local-first and offline operation, and a different technical universe.
Concede this to Tabletop Arc explicitly rather than half-building it.

## Engineering hygiene

Not features, but each will cost time or credibility.

**No test suite, and a 32,000-line codebase.** The README is admirably straight about this. Ten pure
modules in `src/utils/` export 69 functions between them with no React or Electron dependencies —
they can be tested today with nothing but Vitest and a `test` script. Recommended starting targets, in
order:

1. **`encounterUtils.js`** (11 exports) — first, because the DMG is an external oracle: assert all 80
   threshold values, all 6 multiplier bands including the party-size shift, and the full CR→XP table
   including the 25–29 gap this review found. Tests here would have caught that bug.
2. **`combatUtils.js`** (6) — `sortByInitiative` tiebreaks, `nextTurn` wraparound, `buildCombatants`
   count expansion (and the missing `ac` field).
3. **`fogUtils.js`** (7) — pure index math; `setBrushRevealed` edge clamping at map borders is exactly
   the kind of off-by-one that silently ruins a fog mask.
4. **`acUtils.js`** (4) and **`attackUtils.js`** (10) — 5e formulas with known-correct answers.
5. **`compendiumExtractor.js`** (6) — JSON repair against real malformed model output; the highest-risk
   code in the app because it processes untrusted LLM text.
6. **`dnd5e.js`** (14), **`tokenUtils.js`** (4), **`mindMapUtils.js`** (6), **`crColor.js`** (1).

Add `"test": "vitest run"` and `"test:watch": "vitest"` to `package.json`. Vitest reuses the existing
Vite config, so this is a devDependency and two lines.

**No license.** No `LICENSE` file; `package.json` has an `author` but no `license` field. The README
already flags it. Until one exists the default is all-rights-reserved, which blocks any contribution
or distribution. Pick MIT or "all rights reserved" explicitly, and add the `license` field. Also worth
noting: the SRD content cached from dnd5eapi.co carries its own attribution requirements (OGL 1.0a /
CC-BY-4.0 depending on the endpoint) and DMCS displays none.

**Node version unpinned.** No `engines` field, no `.nvmrc`, no `.node-version`. This matters more than
usual here because `better-sqlite3` is a native module compiled against a specific ABI — I hit exactly
this during the review: the checked-in build targets `NODE_MODULE_VERSION 130` (Electron 33) and the
local Node 24 (`137`) refuses to load it. Add `"engines": { "node": ">=20 <23" }` and a `.nvmrc`, and
note the Electron-vs-Node ABI split in the README's troubleshooting section (which already covers the
symptom but not the cause).

**Orphaned `agent/dmcs-agent.mjs`.** A 94-line standalone CLI pointing at LM Studio
(`baseURL: 'http://localhost:1234'`, `Llama-3.2-1B-Instruct-GGUF`). Not imported by anything, not
referenced by any npm script, and it contradicts the documented AI architecture (Anthropic + Ollama).
Delete it, or move it to a `tools/` directory with a README explaining it is a dev experiment.

**Empty `ai/features/`.** Two empty nested directories tracked in the repo. Delete.

**122 files of Electron browser cache committed to git.** `scripts/.test-userdata/` contains
`Cache/`, `Code Cache/`, `GPUCache/`, `Local Storage/leveldb/`, `Network/`, `DawnWebGPUCache/` and
more — 122 tracked files of binary runtime junk from a screenshot-driver run. `git rm -r --cached
scripts/.test-userdata` and add it to `.gitignore`.

**`.gitignore` is two lines.** `node_modules` and `dist/`. It should also cover
`scripts/.test-userdata/`, `scripts/screenshots/`, `release/`, `*.log`, `.env*`, `.DS_Store` and
`Thumbs.db`. The `.env` omission is the one that matters — nothing currently stops an API key being
committed. (Credit where due: the app itself does the right thing at runtime, storing the Anthropic
key via Electron `safeStorage` in `electron/services/KeyService.js` rather than in a file.)

**Unhandled IPC errors are systemic, not incidental.** `ai:ragQuery` (`aiHandlers.js:29-31`) and
`embed:source` (`embeddingHandlers.js:6-10`) forward service exceptions straight to the renderer with
no wrapping, and several renderer call sites have no `catch`. A rejected `ipcRenderer.invoke`
surfaces as an unhandled promise rejection with a mangled `Error invoking remote method` message. Two
options, both cheap: wrap each handler to return `{ ok: false, error }` instead of throwing, or add a
`registerHandler` helper in `dbHandlers.js` that wraps every `ipcMain.handle` callback in a single
`try`/`catch`. The second is ~15 lines and covers all ~100 channels at once.

**Missing foreign keys and the CHECK constraint mismatch** are covered in the roadmap's item 1 —
listed here so the hygiene section is complete: no FK on `connections.entity_a_id`/`entity_b_id` or
`mind_map_positions.entity_id` (polymorphic, so genuinely unenforceable in SQLite — needs handler-side
cleanup instead), no `ON DELETE` on five soft references, and `pdf_sources.status` rejecting the
`'embedded'` value that `EmbeddingService.js:108-111` writes.

**Unbounded AI context.** `buildSystemPrompt` (`AIAssistant.jsx:11-28`) interpolates every character
and every faction with no cap; `RAGService` correctly bounds its context at 3000 characters
(`RAGService.js:25`) but the chat path bounds nothing but message count. Add a character budget to the
system prompt using the same pattern.

**Dead code and dead columns.** `xpBudget` (`encounterUtils.js:90-94`) is exported and never called —
it will be needed by Q8's generator. `mindMapUtils.js:7` defines an `item` node type never built.
`locations.has_own_map` and `floor_number` (migration 007) are written and never read.
`campaigns.session_count` is read and never written. `EmbeddingService.search`'s SQLite keyword
fallback (lines 135-174) is well-written and unreachable in practice (Q4d). None of these are bugs;
all of them are traps for a future reader.

**Migration ordering is safe but looks fragile.** `MIGRATION_006` is *defined* after 007 and 008 in
the file (`DatabaseService.js:271-308`) but executed in id order by the array at
`DatabaseService.js:24-33`, so the behaviour is correct. Reorder the constants to match their ids
before this trips someone up.

---

# Appendix: Evidence Index

Every file cited in this review, grouped by the question it supports. Line numbers are from the
reviewed commit.

**Schema (all questions)**
- `electron/database/DatabaseService.js` — `:5-9` (constructor, WAL, `foreign_keys = ON`),
  `:11-45` (migration runner, id-ordered array), `:82-214` (MIGRATION_001), `:221-238` (MIGRATION_002,
  lore CHECK widening), `:240-249` (003 pdf_chunks), `:251-255` (004 embedding columns),
  `:257-269` (005 ai_usage_log), `:271-277` (007 map/location fields), `:279-294` (008 source_book),
  `:297-308` (006 subclasses)

**Q1 — Entity tracking**
- `electron/ipc/dbHandlers.js:5-26` campaigns · `:29-82` NPCs · `:86-117` locations ·
  `:120-140` factions · `:143-172` connections · `:205-221` world search · `:299-337` characters ·
  `:447-483` mind map positions
- `electron/preload.js:6-134` (full `db` surface)
- `src/pages/world/Locations.jsx:10, 51, 72, 104-106, 125-128, 186-209, 239-240`
- `src/pages/world/Connections.jsx:6, 54, 89, 155-164, 184-192`
- `src/hooks/useMindMapData.js:12-45` · `src/utils/mindMapUtils.js:4-14`
- `src/components/world/WorldSearch.jsx:5-17, 30, 42-47`
- `src/components/TopBar.jsx:5, 45`
- `src/components/encounter/MonsterSearchPanel.jsx:25, 36-62, 119-129`
- `src/utils/encounterUtils.js:1-2, 21-33`
- `electron/services/SrdService.js:3-8, 10, 36-50`
- `src/pages/CampaignManager.jsx:40-45`

**Q2 — Lore & plot**
- `electron/database/DatabaseService.js:181-189, 221-238, 279-294`
- `electron/ipc/dbHandlers.js:175-202` (lore) · `:216-218` (lore search) · `:265-271, 289-296`
  (compendium excludes lore) · `:13-16` (session_count init)
- `src/pages/world/Lore.jsx:8-9, 41-45, 55-60, 68-80, 129-143, 159-162, 193`
- `src/pages/WorldBuilder.jsx:170-172`
- `src/components/world/NPCQuickView.jsx:63`
- `src/pages/CampaignManager.jsx:10, 31, 40-54, 116-117, 196-203`
- `src/pages/LoreConnections.jsx` (entire file, 12 lines)
- `src/components/Sidebar.jsx:19` · `src/App.jsx:76`
- `electron/server/PlayerServer.js:60-110` (no lore route)
- `DMCS_AI_Spec_Sheet.md:53` · `DMCS_Phase1_Agent_Prompts.md:176`

**Q3 — AI adding to lore/plot**
- `src/components/world/AISuggestionPanel.jsx:9-19, 21-42, 24-33, 36-37, 44-46, 56, 61, 71-73, 75`
- `src/pages/AIAssistant.jsx:7, 11-28, 33-36, 66-80, 100-128, 130-185, 179`
- `src/stores/aiStore.js` (no `persist`) vs `src/stores/campaignStore.js:4-21` (uses `persist`)
- `electron/ipc/aiHandlers.js:9, 11-13, 77-88`
- `electron/services/AIService.js:45-97, 86-94, 99-156`
- `src/components/ai/AIToolbox.jsx:4-32, 82`
- `src/components/compendium/BulkImportModal.jsx:117-120`
- `src/components/compendium/SourceBookImportModal.jsx:87, 118, 128`
- `src/utils/compendiumExtractor.js:55`
- `src/components/mindmap/AIInsightsPanel.jsx:94, 102`

**Q4 — Rules & RAG**
- `electron/services/PdfIngestionService.js:15-19, 22-31, 34-58, 61-90, 93-102`
- `electron/services/EmbeddingService.js:4-11, 23-69, 72-114, 108-111 (CHECK bug), 116-133, 135-202,
  204-282 (contiguous stitching), 287-366, 386-393, 396-407`
- `electron/services/RAGService.js:9-22, 24-25, 27-36, 38-63, 65-72, 74-87, 89-97, 99-117`
- `electron/ipc/aiHandlers.js:29-31` · `electron/ipc/embeddingHandlers.js:6-10, 18-20`
- `electron/ipc/pdfHandlers.js:19-33, 43-48, 92-94`
- `electron/ipc/dbHandlers.js:530-600`, esp. `:571-585` (`status IN ('indexed','embedded')`)
- `src/components/ai/RAGQueryPanel.jsx:12, 19-24, 80-83, 89-90, 135-149, 158-170`
- `src/pages/AIAssistant.jsx:78, 109-127`
- `electron/services/SrdService.js:3-8` (SRD never enters the index)

**Q5 — Map management**
- `electron/database/DatabaseService.js:169-179` (maps) · `:271-277` (migration 007)
- `electron/ipc/dbHandlers.js:224-260`
- `electron/ipc/fileHandlers.js` (dialog, copy, thumbnails) · `electron/preload.js:136-146`
- `electron/main.js:8-32` (player window), `:37-68` (map window), `:79-83` (broadcast relay),
  `:87-89` (dmcs-asset scheme), `:109` (MIME)
- `src/utils/fogUtils.js:4-16, 18-29, 31-38, 41-50`
- `src/utils/tokenUtils.js:2, 5-10, 12-21, 24-33`
- `src/components/map/MapCanvas.jsx:2, 62-66, 290-292, 397-452, 429-438`
- `src/components/map/MapToolbar.jsx:44, 67-99, 101-109`
- `src/components/map/TokenInspector.jsx:21, 49, 56`
- `src/pages/MapEngine.jsx:17, 20-48, 59-86, 90-104, 122-147, 150-165`
- `electron/server/PlayerServer.js:43-57, 60-110, 101-110, 112-132, 140-155, 182-199, 209`
- `electron/server/TunnelService.js`
- `player/components/MapView.jsx`

**Q6 — Map creation**
- Negative evidence: no matches for `generateMap|procedural|dungeonGen|roomGen|tileset` across
  `src/`, `electron/`, `player/`
- `src/components/map/MapCanvas.jsx:36` and `src/pages/MapEngine.jsx:90` (`generateThumbnail` —
  canvas export, not generation)
- `src/pages/MapEngine.jsx:28, 150-165` (upload-only path) · `electron/preload.js:144-145`
  (`saveExportedImage`, reusable for generated output)
- `package.json` dependencies (`konva`, `react-konva`; locked stack)

**Q7 — Combat**
- `src/utils/combatUtils.js:1-2 (NOT persisted), 5-6, 8-57, 24 (ac ?? 10), 46, 59-63, 65-68, 71-87`
- `src/components/encounter/InitiativeTracker.jsx:21-58, 61-67, 71-77, 86-92, 94-107, 109-113,
  115-136, 138-180, 164-172, 182-192, 194-209, 211-234, 236-259`
- `src/components/encounter/CombatLog.jsx` · `ConditionManager.jsx` · `CombatStatBlock.jsx`
- `electron/ipc/dbHandlers.js:330-331, 374-379` (HP write-back)
- `src/components/character/CharacterSheet.jsx:127-139, 141-145, 258-263, 471-501`
- `src/components/player/PlayerCharacterSheet.jsx:118, 170`
- `src/components/compendium/MonsterStatBlock.jsx:128-131, 137-140`
- `src/components/compendium/forms/CustomMonsterForm.jsx:70, 124, 341-345`
- Negative: no matches for `lair` anywhere in `src/`, `electron/`, `player/`
- `src/utils/acUtils.js` (exists, unused by combat)

**Q8 — Encounter creation**
- `src/utils/encounterUtils.js:4-11 (CR_XP), 13-17 (parseCR), 21-33, 38-49 (XP_THRESHOLDS),
  54-57, 60-67, 70-74, 77-78, 81-88, 90-94 (xpBudget, unused)`
- `src/components/encounter/XPCalculator.jsx:11-19, 28-34, 37-44, 47-53, 66-89, 101-104`
- `src/pages/CombatCalculator.jsx:1-10, 15-41`
- `src/pages/EncounterBuilder.jsx:32-33, 65-68, 112-117, 157, 228, 272-273, 519-520, 573-577`
- `electron/ipc/dbHandlers.js:486-527`
- `src/components/encounter/MonsterSearchPanel.jsx:36-62` · `MonsterRoster.jsx`
- `electron/services/SrdService.js:3-8` (SRD 5.1 = 2014 rules)

**Part 2 / Part 3 / hygiene**
- `README.md:320-337 (modules), :338-348 (AI layer), :350-357 (player views), :359-370 (testing),
  :415-427 (open questions), :429-433 (license)`
- `DMCS_AI_Spec_Sheet.md:11, 50-66` (M1–M13)
- `package.json` (no `test` script, no `engines`, dependency list)
- `.gitignore` (2 lines) · absence of `LICENSE`, `.nvmrc`
- `agent/dmcs-agent.mjs:1-25` · `ai/features/` (empty)
- `scripts/.test-userdata/` (122 tracked files) · `scripts/verify-*.js` · `scripts/screenshot-driver.mjs`
- `electron/services/KeyService.js` (safeStorage)
- `src/utils/` — 10 modules, 69 exports (Vitest targets)

---

# Appendix: Unverified

Things I could not confirm, and why. Stated as "couldn't test" rather than guessed.

**The GUI was never run.** `npm run dev` needs a display and a working native `better-sqlite3` build;
the checked-in binary targets `NODE_MODULE_VERSION 130` (Electron 33) and the environment's Node 24
requires `137`, so `require('better-sqlite3')` fails outside Electron. Every runtime claim in this
review is derived from source reading, except the SQLite behaviour noted below. Specifically
unverified by execution: that any page renders, that the fog brush behaves correctly at map edges,
that the pop-out map window loads, that drag-to-move tokens works, and that the blank-map (null
`image_path`) case degrades gracefully.

**What I *did* execute.** To avoid guessing about the constraint behaviour that drives four findings,
I extracted the real `MIGRATION_001` / `002` / `007` SQL from `DatabaseService.js` and ran it against
Node 24's built-in `node:sqlite` (the same SQLite engine, same DDL). That confirmed, empirically:
deleting a location with a dependent NPC/map/encounter raises `FOREIGN KEY constraint failed`;
deleting a campaign with any `connections` row raises the same; deleting an NPC leaves its
`connections` rows orphaned; and `UPDATE pdf_sources SET status='embedded'` raises
`CHECK constraint failed`. I also executed `src/utils/encounterUtils.js` directly (it is a pure ES
module) to verify the CR 25–29 gap, `parseCR('bogus') === NaN`, the four-level-5 thresholds
`[1000,2000,3000,4400]`, and two end-to-end difficulty ratings. These are measurements, not readings.

**Ollama was not running,** so nothing in the embedding path was exercised live: not `/api/embed`,
not the legacy `/api/embeddings` fallback, not vectra index creation or querying. The chunk-size,
top-k and stitching constants are read from source and are certain; whether retrieval *quality* is
good is untested.

**No PDFs were available to ingest,** so the RAG pipeline was never run against a real book. In
particular the claim that page attribution is accurate rests on the code splitting on form-feed
characters (`PdfIngestionService.js:26-29`) — how reliably `pdf-parse` emits `\f` at page boundaries
for a given publisher's PDF is unverified, and it varies by producer. Two-column extraction quality
is likewise untested.

**No Anthropic API key was used.** No AI call in this review was executed. Prompt contents, context
composition and the absence of write-back are all read from source and are certain; response quality
is not assessed. I also did not verify that `claude-sonnet-5` (`AIService.js:10`) is a currently valid
model id against the live API.

**The remote player network was not exercised.** `PlayerServer` was not started, no browser client
joined, and the ngrok tunnel was not opened. The finding that `/api/*` routes lack a session check is
from reading `PlayerServer.js:43-110` — every route handler is visible in that range and none consults
`this._sessions` — but I did not confirm by request that an unauthenticated `GET /api/map/1` returns
data.

**Competitor feature sets are unverified.** I had no confirmed access to current documentation for
CharGen, Tabletop Arc, Archivist or Dungeon Alchemist. The Part 2 matrix uses only the one-line
descriptions supplied in the review brief; every cell those descriptions do not settle is marked **?**
rather than inferred. Pricing, offline capability and player-view support for the three SaaS products
are assumptions from their category, flagged as such, and should be checked before any of Part 2 is
used publicly.

**The Windows installer was not built or run.** `npm run build:win` was not attempted, so the
packaged-app paths — `loadFile` with a hash route, `asarUnpack` for `better-sqlite3`, the
`extraResources` player bundle — are unverified in a packaged context. The README already flags the
symlink/Developer Mode prerequisite.

**SRD seeding was not run,** so the dnd5eapi.co shapes consumed by `srdHandlers.js:11-63` (e.g.
`m.challenge_rating`, `s.school.name`, `e.equipment_category.name`, `monster.legendary_actions`) are
assumed from the handler code rather than confirmed against live payloads. `srd_cache` was empty
throughout.

**Migration behaviour on an existing database was not tested.** All schema checks ran against a fresh
database. In particular I did not verify that migrations 002 and 008 (`INSERT INTO … SELECT *`,
which depends on exact column order surviving the rename) behave correctly on a database that has
real rows and has already been through the earlier migrations.
