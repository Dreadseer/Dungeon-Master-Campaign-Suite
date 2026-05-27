# Dungeon Master Campaign Suite — CLAUDE.md

## Project Overview

AI-assisted D&D desktop application (Electron + Claude API). 8 phases, 13 modules. See the wiki for full architecture and spec.

---

## Local Wiki (Second Brain)

A structured knowledge base lives at:

```
C:\Users\chris\Documents\First Vault\wiki\
```

**Master Index:** `C:\Users\chris\Documents\First Vault\wiki\index.md`

### When to consult the wiki

Only reference the wiki when:
- You lack enough information to confidently answer or implement something (e.g., game rules, architecture decisions, D&D source content)
- You need a second opinion or want to verify your approach against established project decisions

Do **not** reference the wiki for every task — trust the code and conversation context first.

### How to use it

1. Read the Master Index at `C:\Users\chris\Documents\First Vault\wiki\index.md` to find the relevant entry.
2. Follow the `[[slug]]` link to the specific file at `C:\Users\chris\Documents\First Vault\wiki\<slug>.md`.
3. Use only what is relevant; do not load the entire wiki unnecessarily.

### What's in the wiki

| Category | Contents |
|----------|----------|
| DMCS Project | Full system spec (8 phases, all 13 modules), Phase 1 agent build prompts, prompt corrections |
| D&D 5e Rules | PHB, DMG, MM, Xanathar's, Tasha's, Volo's, Mordenkainen's |
| D&D 5e Settings | Sword Coast, Eberron, Ravnica, Elemental Evil, Tortle Package |
| Concepts | Electron IPC pattern, AI online/offline fallback, SRD cache layer, PDF RAG pipeline, Claude Code agent prompt structure |
| Analyses | Phase 1 prompt corrections (SRD cache fix, model ID fix) |
