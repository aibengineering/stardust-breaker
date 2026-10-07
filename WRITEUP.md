# Write-up: an asteroid shooter coded entirely by Haiku 5.5 agents

**Date:** 7 October 2026
**Result:** [Stardust Breaker](https://aibengineering.github.io/stardust-breaker/), about 3,600 lines
of JS, CSS, HTML and TypeScript test tooling, playable on a phone.

## The brief

Ben's mission: build a simple asteroid shooter with nice upgrades, but have **every coding task done
by well-scoped Claude Haiku 5.5 subagents**. The coordinating model (Opus) was limited to writing the
spec, giving each agent a clear mission, reviewing and verifying the work, and handling deployment.

## How it was organised

1. **Contract first.** Before any agent started, the coordinator wrote [`BRIEF.md`](BRIEF.md). It
   names the owner of every file, every export with its exact signature and object fields, all DOM
   ids, colours, units (px, s, rad, angle 0 = +x) and gameplay numbers. Agents were told "match the
   interfaces exactly; never edit a file you don't own; report contract concerns instead of working
   around them".
2. **Parallel chunks, then integration.** Four agents ran at once, each owning separate files:

   | Chunk | Files | Job |
   |---|---|---|
   | A | `server.ts`, `index.html`, `style.css`, `ui.js`, `input.js` | server, overlays, HUD, floating joystick |
   | B | `entities.js`, `audio.js` | all game objects and drawing, synthesised sound |
   | C | `upgrades.js` | base stats, 14 upgrades, weighted rolls, XP curve |
   | E | `tools/smoke.ts` | headless phone smoke test written blind against the contract |

   Integration agent **D** then wrote `game.js` and `main.js` against the *real* exports of A, B and C,
   and had to make E's smoke test pass.
3. **Each agent tested its own work** with throwaway scripts (kept out of the repo) and `bun build`
   parse checks. Agents that started servers used private ports and stopped only their own PID,
   because this homelab runs many live Bun services.
4. **Coordinator review** of every file, plus running the tests and reading the screenshots.
   Findings went back to fresh Haiku agents as precise fix lists.

In all, Haiku 5.5 did 10 agent runs: the four chunks, integration, one fix round, a showcase and
balance tool, a pacing tune, a test de-flake, and the Pages workflow.

## Verifying the model really was Haiku 5.5

The first four agents were launched with the Agent tool's `haiku` alias. The transcripts showed
they were actually running on **Haiku 4.5**, because the alias had not yet been pointed at the new
model. They were stopped and their output deleted. The run was then checked directly:

| Requested | `model` in the API response | Outcome |
|---|---|---|
| `claude-haiku-5-5` | `claude-haiku-5-5` | answered correctly |
| `claude-haiku-9-9` (made-up control) | none | error: model does not exist, so there is no silent fallback |
| `haiku` (old alias) | `claude-haiku-4-5-20251001` | the cause of the mix-up |

The chunks were re-run with `claude -p --model claude-haiku-5-5` (see `.agents/run.sh`). The alias was
then remapped with `ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-5-5`, and every later agent's
transcript was checked for the served model, not the model's own claim about itself.

## What review caught

Haiku's first pass was solid: 8/8 smoke steps passed on the first integration run. The coordinator
still found these, and Haiku agents fixed them:

- **Real bug:** if a gem pickup triggered a level-up in the same frame as the fatal hit, the upgrade
  screen opened over the death and stalled the game-over.
- **Phone layout:** upgrade card names were truncated ("REINFORCE…") at 390 px wide.
- **Joystick:** its circles stayed on screen under the upgrade and pause overlays while a finger was
  still down.
- **Rotation:** after a resize the starfield only covered the original screen area.
- **Untested surface:** the epic weapons had never been on screen. A showcase tool now grants each
  loadout, screenshots it and measures FPS. Missiles, orbitals, nova and shields all render, and
  with every upgrade maxed it still runs at about 33 FPS in headless Chromium.
- **Pacing:** a bot probe reached only level 5 after two minutes. Upgrades are the fun, so the
  pickup magnet went 80 → 115 px, gems last 20 s instead of 14 s, and the XP curve became
  `4 + 3L + 0.5L²`. Bots now reach level 6 by 70–110 s, and survival, not XP, is the limit.
- **Flaky test:** faster levelling let a natural level-up interrupt smoke steps 5–7 (1 run in 5).
  The test now clears any upgrade screen first; 5 of 5, then 3 of 3 against the live server, passed.

## Observations on Haiku 5.5 as a coder

- **Followed the contract precisely.** Across five independently written modules there was not a
  single interface mismatch at integration time.
- **Tested its own work without being pushed:** sanity scripts, stubbed AudioContexts, path-traversal
  probes on the server, PID-scoped servers.
- **Reported its limits honestly**, for example "I could not confirm missile sprites in this frame",
  "not verified in a browser", "this flake is in a file I don't own". The reports were accurate
  enough to act on, with one small factual slip (a claim that `applyUpgrade` doesn't cap levels;
  it does).
- **Weaknesses** were judgement calls more than code: it left gameplay pacing alone until told,
  wrote a test that a faster game would make flaky, and some fixes stopped at "what was asked"
  rather than the obvious neighbouring case.
- **Short prompts were enough** once the contract existed. Most fix rounds were around 15 lines.

## Round 2: sectors, bosses and a bigger arena

After beating v1 (wave 54, level 61, every upgrade maxed), Ben asked for more systems spread across
different maps, with beating them unlocking things, plus more time to react to incoming rocks.
The coordinator turned that into a v2 contract (the current `BRIEF.md`). Its most important part
is one shared **game object and `game.api`** (damage, spawn, hurt, gems, effects). Every new module
codes against it, so no module needs to import `game.js`.

**Seven Haiku 5.5 agents built it.** Six ran in parallel, each owning its own files:
progression (`upgrades.js`, `sectors.js`), hazards and bosses (`systems.js`, `bosses.js`), weapons
(`weapons.js`), world and radar (`entities.js`, `overlay.js`), interface and audio (`index.html`,
`style.css`, `ui.js`, `audio.js`), and both test tools. The seventh then rewrote `game.js` against
the real exports. Each module agent tested its code with a fake game object built from the contract
before anything else existed. Integration then passed the 12-step smoke test on its first full run.

**What review caught this time:**
- **Performance.** All the new glow put the busiest scenes at 5–19 FPS in headless Chromium. The
  integration agent profiled it properly: about 97% of frame time went to rasterising `shadowBlur`,
  and with glow switched off the same scene ran at 59 FPS. A five-agent fix round set a glow budget
  of a handful of shadowed draws per frame, with fake glow from wide low-alpha strokes everywhere
  else. Every sector, boss and evolution scene now runs at 54–60 FPS headless, even with the
  machine heavily loaded by other work.
- **Bosses arrived too slowly.** They spawned in the far corner and crawled in. They now spawn just
  off-screen and fly in.
- **Pacing in the bigger arena.** Waves spawned heading for the arena centre and wandered. Rocks now
  aim at the ship, and stardust homes in once it is a few seconds old.
- **Layout.** The star map's route line crossed the card text, and the sector intro collided with
  the "WAVE 1" banner.
- **Small fixes.** Frost Shards could chain off boss shards. `?unlockall=1` (a test flag) would have
  been saved into real progress.

v2 is about 7,600 lines across 13 game modules and the two tools. Every agent transcript was
checked for the served model, and all of them were `claude-haiku-5-5`.
