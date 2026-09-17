# DMCS — positioning

**Version 1.1.0 · 2026-09-17**

This is the honest pitch. It is derived from the capability review's post-roadmap
positioning statement (`DMCS_CAPABILITY_REVIEW.md`, Part 2d), edited down to what
Phases 1–8 actually shipped and verified. Every clause below is backed by a
harness, a driver run, or a screenshot recorded in `BUILD_STATUS.md`. Where the
review's forward-looking statement promised something that has not shipped, it
has been cut rather than softened — see **What this does not claim**.

---

## The statement

> **DMCS — best for the DM who owns their books and their data, and wants a
> campaign that remembers itself.**
>
> It is a single offline desktop app where an entire campaign lives in one SQLite
> file on your own machine, with no account, no subscription and no server.
>
> Build your world as linked NPCs, factions and nested locations, and keep a
> record that survives between games: sessions with the notes they left behind,
> plot threads from hook to payoff, and an explicit line between what your
> players know and what you are still holding back.
>
> Drop in your battlemaps — or generate a dungeon from a seed when the party goes
> somewhere you did not prepare — and run fog of war on a second screen your
> players can actually see, measuring reach and range from the map itself.
> Assemble encounters from the people who are standing in the room, score them
> against a DMG-exact XP calculator, and run initiative with conditions, death
> saves, legendary actions and automatic HP write-back that survives a crash.
>
> Ask the AI for a rival thieves' guild and get a faction, an NPC and a lore
> entry saved and linked into the world you already wrote — not invented over the
> top of it. Ask a rules question and get an answer grounded in the SRD, or in the
> PDFs you already paid for, with citations you can check.
>
> And it all keeps working with the AI switched off entirely.

---

## Best for

- **The DM who wants to own their campaign.** One file, no account, no telemetry,
  no subscription, readable with any SQLite client, backed up by copying it.
- **The DM who owns rulebooks.** Index your own PDFs locally; the file never
  leaves your machine. A cloud service cannot legally invite you to do this.
- **The DM who plays offline, or on an unreliable connection.** Everything except
  the AI works with no network. The one exception is the first-run SRD download.
- **The DM who improvises.** A dungeon in ten seconds, encounters built from the
  NPCs already in the room, and wandering tables you rolled yourself.

## Not for

- **The DM who wants their maps rendered in 3D.** DMCS is a 2D grid over an
  image. Make those maps in Dungeon Alchemist and import them — they are
  complements, not competitors.
- **The DM committed to Foundry or Roll20.** There is no VTT export. Maps and
  encounters live in DMCS.
- **The DM who wants their sessions transcribed from audio.** Out of scope by
  choice: an audio pipeline is a different product and hostile to a local-first,
  offline design. DMCS writes recaps from the notes you typed.
- **The DM who wants AI to run the game.** The AI here proposes and grounds; you
  approve every record it writes.

---

## Where DMCS is genuinely ahead

Ranked by how hard it would be for a funded competitor to match, following the
review's own ranking.

1. **Local-first data ownership, no account, no subscription.** Not technically
   hard — *architecturally opposed* to how subscription competitors are built.
2. **Rules Q&A over your own PDFs, with citations.** Defensible for a legal
   reason as much as a technical one: a cloud service cannot host your rulebooks.
3. **It works with the AI off.** Every core loop — world, maps, combat,
   encounters, sessions, compendium — is plain SQLite with no model on the path.
4. **A player view with fog enforced on the server**, not merely drawn on the
   client. Tokens standing in the dark are not sent to a player's browser at all.
5. **One app across prep and play.** The least defensible — anyone can add
   features — and the most immediately valuable: no alt-tabbing mid-session.

## Where DMCS is behind

- **Map creation.** A seeded dungeon generator, and nothing above ground. Dungeon
  Alchemist wins this outright and is not worth fighting.
- **Session transcription.** Conceded, as above.
- **Rules coverage on day one.** The SRD index covers monsters, spells, equipment
  and classes — the API exposes no rules-chapter prose — so questions about
  procedures ("how does grappling work") are answered from your own PDFs or not
  at all. See the README's Rules Q&A section.
- **Polish.** One developer, no designer. The app is dense and keyboard-light.

---

## What this does not claim

The review's post-roadmap statement was written before the work was done. These
clauses are deliberately absent:

- **It does not claim the AI writes to your world unsupervised.** Suggestions are
  editable cards; nothing is saved until you press Save, and a batch can be undone.
- **It does not claim recaps are automatic.** Recaps are generated on request from
  session notes you wrote, and the player-facing variant is filtered by what has
  actually been revealed.
- **It does not claim map generation beyond dungeons.**
- **It does not claim "fog enforcement" for everything.** It is enforced for
  tokens and for map rows served over the network; the fog mask itself is still
  sent so the client can draw it.
- **It does not claim security for a public URL.** `POST /api/join` is
  deliberately open — that is how players get in — so the tunnel URL is the shared
  secret. Do not post it publicly, and stop the server when the session ends.
- **It does not claim a tested installer on a machine other than the developer's.**
  See `BUILD_STATUS.md`, Phase 9, for exactly what was and was not verified.
