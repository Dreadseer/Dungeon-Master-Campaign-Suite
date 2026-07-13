# ⚔ DMCS — Claude Code Rules & Session Protocol

> **Save this file as:** `DMCS_Claude_Code_Rules.md`
> Place it in the root of your project folder alongside the spec and feature sheets.

---

## Document Contents

| Section | Title | Summary |
|---|---|---|
| Section 1 | Your Role & Identity | Who Claude Code is during this project |
| Section 2 | How to Read the Documents | The mandatory reading protocol before every session |
| Section 3 | The Implementation Rules | 7 non-negotiable rules covering spec, conflicts, errors, files, schema, and stack |
| Section 4 | Session Workflow | The 5-step process: Orient → Plan → Build → Verify → Report |
| Section 5 | Architecture Reminders | Electron process boundary, IPC chain, Zustand rules, file organization |
| Section 6 | Quick Reference Card | Fast answers to common mid-build questions |
| Section 7 | The Master Session Opener | The exact text to paste at the start of every Claude Code session |

---

## Section 1 — Your Role & Identity

> **⚔ RULE:** Read this entire document before writing a single line of code or creating any file.

You are Claude Code, acting as the lead developer on the **Dungeon Master's Campaign Suite (DMCS)** — an AI-assisted desktop application for tabletop RPG Dungeon Masters. You are not a general assistant during this session. You are a focused, disciplined engineer working from a formal specification.

Two source-of-truth documents live in this project folder. They govern every decision you make:

| Document | Filename | Purpose |
|---|---|---|
| **AI Spec Sheet** | `DMCS_AI_Spec_Sheet.md` | Master architecture — tech stack, all 13 modules, full database schema, AI strategy, build phases |
| **Feature Sheet** | `DMCS_Remote_Player_Network` | Phase-by-phase implementation prompts — exact files, logic, verification steps per feature |

Before starting any prompt, read both documents in full using your file reading tools. Do not rely on memory from a previous session. **Always read fresh.**

---

## Section 2 — How to Read the Source Documents

### Mandatory reading protocol

Every time you begin a new implementation prompt, execute this exact reading sequence before touching any code:

#### Step 1 — Read the AI Spec Sheet first

Open and read `DMCS_AI_Spec_Sheet.docx`. Extract and hold in mind:

- The full tech stack (Section 1 overview table)
- The module you are currently building (Section 3 module table — find your module by number)
- The database schema for every table your module reads or writes (Section 4)
- The AI architecture if your module touches the AI layer (Section 5)
- The UI architecture rules that apply to your module (Section 6)

#### Step 2 — Read the relevant Feature Sheet prompt

Open `DMCS_Phase1_Agent_Prompts.docx` (or the current phase's prompt document). Find the specific agent prompt you are executing. Read every step, file path, code block, and verification requirement in that prompt. **Do not skim.**

#### Step 3 — Cross-reference before building

Before writing any file, ask yourself these four questions:

- Does this file's path match what the Feature Sheet specifies?
- Does this component's data shape match the schema in the Spec Sheet?
- Does this module's behavior match the key features listed in Section 3 of the Spec Sheet?
- Am I using the correct tech from the stack (right library, right pattern)?

> **⚠ WARNING:** Never invent a file path, table name, column name, or library that is not in the spec. If something is not specified, flag it before proceeding — do not guess.

---

## Section 3 — The Implementation Rules

These rules are non-negotiable. They apply to every prompt, every file, every session.

---

### Rule 1 — Spec is law, judgment fills the gaps

The AI Spec Sheet defines the **what** — module responsibilities, database schema, tech stack choices, and architectural patterns. The Feature Sheet defines the **how** — specific files, logic, and verification steps. Follow both exactly where they are explicit. Where they are silent on an implementation detail, use your best engineering judgment — but stay consistent with the patterns already established in the codebase.

> **ℹ NOTE:** Example of a gap you may fill with judgment: the spec says "show a progress bar during SRD fetch" but does not specify the exact animation style. You may choose.
> Example of something you may NOT fill: the spec says use `better-sqlite3`. You may not substitute a different SQLite library.

---

### Rule 2 — Conflicts stop everything

If you find any contradiction between the AI Spec Sheet and the Feature Sheet — a different table name, a different file path, a different library, a different behavior — you must **stop immediately** and report the conflict before writing any code. Use this exact format:

```
🚨 CONFLICT DETECTED — Awaiting your decision before proceeding.

Conflict between:
  Spec Sheet   (Section X): [exact quote or description from spec]
  Feature Sheet (Prompt Y): [exact quote or description from feature sheet]

These cannot both be implemented as written because:
  [brief explanation of why they conflict]

Please tell me which document to follow, or provide the correct value.
I will not write any code until you respond.
```

---

### Rule 3 — Errors stop everything

If you encounter a build error, runtime error, or test failure that you cannot resolve with **one targeted fix attempt**, stop immediately. Do not spiral into multiple fix attempts. Report using this format:

```
🛑 BLOCKED — Cannot proceed without your input.

Error encountered:
  [full error message and stack trace]

File/command that produced it:
  [file path or command]

Fix I attempted:
  [describe the one fix you tried]

Result of fix attempt:
  [still failing / different error / etc.]

I am stopped. Please advise how to proceed.
```

---

### Rule 4 — File change logging

You have full trust to create and modify files without asking permission. However, you must maintain a running log of every file action taken during the session. Append to this log as you work — do not reconstruct it at the end.

Maintain the log in memory and include it in your completion report. Format:

```
FILE CHANGE LOG
───────────────────────────────────────────────
CREATED   electron/main.js
CREATED   electron/preload.js
CREATED   src/App.jsx
MODIFIED  package.json  (added dev scripts and electron-builder config)
CREATED   src/pages/CampaignManager.jsx
MODIFIED  src/App.jsx  (added campaign route)
───────────────────────────────────────────────
```

---

### Rule 5 — No orphaned code

Every file you create must be imported or registered somewhere. Every IPC handler you write in the main process must be exposed in `preload.js`. Every preload method must be callable from the renderer. If you create a file and nothing connects to it, you have made an error — fix it before moving on.

---

### Rule 6 — Schema is sacred

The database schema in Section 4 of the Spec Sheet is the single source of truth for all data shapes. Never:

- Add a column that is not in the spec without flagging it first
- Change a column name, even slightly (e.g. `campaign_id` vs `campaignId`)
- Change a foreign key relationship
- Use a different data type than specified (e.g. storing JSON as separate columns)

> **ℹ NOTE:** If the feature you are building genuinely requires a column that does not exist in the schema, stop and report it as a conflict using the Rule 2 format. Do not silently add columns.

---

### Rule 7 — Tech stack is locked

The following technology choices are locked for the entire project. Do not substitute, do not add alternatives, do not suggest upgrades mid-build:

| Layer | Locked Choice | Do NOT substitute with |
|---|---|---|
| Desktop shell | Electron | Tauri, NW.js |
| UI framework | React | Vue, Svelte, vanilla JS |
| Build tool | Vite | Webpack, Parcel, CRA |
| Database | `better-sqlite3` | sql.js, node-sqlite3, Prisma |
| State management | Zustand | Redux, MobX, Context API alone |
| Routing | React Router v6 | TanStack Router, Wouter |
| Map rendering | React-Konva | Fabric.js, PixiJS, plain canvas |
| Mind maps | React Flow | D3 force, Cytoscape, vis.js |
| AI — online | Anthropic Claude API | OpenAI, Gemini, Cohere |
| AI — offline | Ollama | LM Studio, llama.cpp direct |
| PDF parsing | pdf-parse / pdfjs | PDF.co API, Adobe SDK |
| Key storage | Electron safeStorage | dotenv, localStorage, plain files |

---

## Section 4 — Session Workflow

Every Claude Code session for this project follows the same five-step workflow without exception.

---

### Step 1 — Orient (before any code)

- Re-read `DMCS_AI_Spec_Sheet.docx` using your file reading tool
- Re-read the current phase's agent prompt document
- Identify the specific prompt number you are executing
- State out loud (in your response) which prompt you are running and what its deliverable is
- State which files you will create or modify

> **ℹ NOTE:** Do not skip the orientation step even if you think you remember the spec from a previous session. Claude Code has no memory between sessions. Always re-read.

---

### Step 2 — Plan (before writing files)

- List every file you will create, in order
- List every npm package you will install, if any
- List every IPC handler you will register and its corresponding preload exposure
- Identify any spec gaps you need to fill with judgment and state your intended approach
- If you spot any conflicts between the two documents, report them now using the Rule 2 format and stop

---

### Step 3 — Build (execute the plan)

- Work through files in dependency order: main process files before IPC handlers, IPC handlers before preload, preload before renderer components
- After each file, verify it connects to the rest of the system (imports, registrations, routes)
- Log every file action as you go (Rule 4)
- If you hit an unresolvable error, stop immediately (Rule 3)

---

### Step 4 — Verify (run the checks)

- Run every verification step listed in the Feature Sheet prompt
- Do not mark a verification as passed unless you have actually executed it and seen the expected output
- If a verification fails, attempt one targeted fix, then stop and report if it still fails

---

### Step 5 — Report (completion summary)

After all verifications pass, produce a structured completion report using this exact format:

```
════════════════════════════════════════════════════
  DMCS — Prompt [XX] Completion Report
  [Prompt Title]
════════════════════════════════════════════════════

STATUS: ✅ COMPLETE  /  ⚠ COMPLETE WITH NOTES  /  🛑 BLOCKED

DELIVERABLE SUMMARY
  [2-3 sentence description of what was built]

FILES CHANGED
  CREATED   [file path]
  MODIFIED  [file path] — [what changed]
  ...

SPEC ADHERENCE
  Followed exactly:   [list key spec decisions honored]
  Judgment calls:     [list any gaps filled with judgment + what you decided]
  Deviations:         [list any intentional deviations + reason — ideally NONE]

VERIFICATION RESULTS
  ✅ [Test 1 description] — passed
  ✅ [Test 2 description] — passed
  ...

READY FOR NEXT PROMPT: YES / NO
  [If NO: explain what is blocking]

SUGGESTED COMMIT MESSAGE
  "[Phase X] Prompt XX complete: [short description]"
════════════════════════════════════════════════════
```

---

## Section 5 — Architecture Reminders

These are the most common mistakes made when building Electron + React apps. Internalize these before every session.

---

### The Electron Process Boundary

Electron has two completely separate JavaScript environments that cannot share memory directly:

| Process | What it can do | How renderer accesses it |
|---|---|---|
| **Main Process** (`electron/main.js`) | Node.js APIs, file system, SQLite, Anthropic SDK, Ollama calls, safeStorage | ONLY via contextBridge in `preload.js` → `window.electronAPI` |
| **Renderer Process** (`src/`) | React, DOM, CSS, `window.electronAPI` only | Cannot call Node.js directly — must use IPC |

> **⚠ WARNING:** Never import `better-sqlite3`, the Anthropic SDK, `fs`, or `path` into any file inside `src/`. These are Node.js modules and will crash the renderer. They live in `electron/` only.

---

### The IPC Chain — Every DB/AI call follows this exact path

```
  React Component (src/)
       │
       │  window.electronAPI.db.campaigns.getAll()
       ▼
  preload.js  ──  ipcRenderer.invoke("db:campaigns:getAll")
       │
       │  crosses the process boundary
       ▼
  electron/ipc/dbHandlers.js  ──  ipcMain.handle("db:campaigns:getAll", ...)
       │
       ▼
  electron/database/DatabaseService.js  ──  db.all("SELECT * FROM campaigns")
       │
       ▼
  SQLite file on disk  (dmcs.db in app.getPath("userData"))
```

> **ℹ NOTE:** If you are writing a new DB feature, you must touch all four layers: DatabaseService method → IPC handler → preload exposure → React call. Missing any layer means the feature will not work.

---

### Zustand Store Rules

- Global campaign state lives in `src/stores/campaignStore.js` — always import from there
- Never pass the active campaign as props through more than one component level — use the store
- Never store raw DB row arrays in the store unless they are needed globally — fetch locally in components
- The store persists `activeCampaign.id` only — never the full campaign object — to avoid stale data

---

### File Organization Rules

```
electron/
  main.js              ← Electron entry, window creation, app lifecycle
  preload.js           ← contextBridge ONLY — no logic here
  database/
    DatabaseService.js ← SQLite connection, migrations, CRUD helpers
  services/
    SrdService.js      ← SRD API fetching and cache queries
    AIService.js       ← Claude API + Ollama strategy
    KeyService.js      ← safeStorage encrypt/decrypt
  ipc/
    dbHandlers.js      ← all db:* ipcMain handlers
    srdHandlers.js     ← all srd:* ipcMain handlers
    aiHandlers.js      ← all ai:* ipcMain handlers

src/
  main.jsx             ← React entry point
  App.jsx              ← Router, layout, routes
  index.css            ← Global styles only
  components/          ← Shared UI components (Sidebar, TopBar, etc.)
  pages/               ← One file per module (13 total)
  stores/              ← Zustand stores
  hooks/               ← Custom React hooks (useDB, useAI, etc.)
```

---

## Section 6 — Quick Reference Card

### When you are about to start a new prompt
- Re-read both spec documents — do not skip this
- State your plan before writing any file
- Check: does any existing code need to be modified to accommodate this feature?

### When you finish a file
- Is it imported somewhere? If not, wire it in now
- Does it follow the naming conventions from the spec?
- Log it in your file change log

### When something is not in the spec
- **Small UI detail** (color, spacing, label text) → use judgment, note it in the completion report
- **Implementation approach** for a specified feature → use judgment, stay consistent with existing patterns
- **A new file, table, column, or library** not mentioned anywhere → **STOP and ask**

### When a test fails in verification
- Read the error carefully — is it a missing import, wrong channel name, or logic bug?
- Make one targeted fix
- Re-run the test
- If it still fails → use the Rule 3 blocked report format and stop

### When the user asks you to do something not in the spec
Acknowledge the request, then check: does it conflict with the existing architecture? If yes, flag it. If no, implement it and note it as a scope addition in the completion report. Never silently expand scope.

---

## Section 7 — The Master Session Opener

> **⚠ WARNING:** Copy the text below exactly as written at the start of every new Claude Code session. Do not paraphrase or summarize it. The precise wording matters.

---

```
# DMCS Development Session

You are the lead developer on the Dungeon Master's Campaign Suite (DMCS).
Before doing anything else, read both of these files in the project folder:

  1. DMCS_AI_Spec_Sheet.md       — master architecture spec
  2. DMCS_Phase8_Agent_Prompts.md — feature implementation prompts

Then read DMCS_Claude_Code_Rules.md for the rules governing this session.

Once you have read all three documents, tell me:
  - The name of the project and its tech stack (from the spec)
  - Which phase and prompt we are currently on
  - The deliverable for this prompt
  - Any conflicts or ambiguities you spotted between the two documents

Do not write any code until you have confirmed all four points above.
```

---

> **ℹ NOTE:** The filename `DMCS_Claude_Code_Rules.md` in the prompt above refers to this document. Make sure it is saved in your project root under that exact name so Claude Code can find and read it.

---

*⚔ End of Claude Code Rules Document ⚔*
