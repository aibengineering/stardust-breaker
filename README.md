# Stardust Breaker

A small neon asteroid shooter with roguelite upgrades. Phone-first, also plays on desktop.

**Play:** https://aibengineering.github.io/stardust-breaker/

- Drag anywhere to steer (a joystick appears under your thumb). The ship fires automatically.
- Shot asteroids split and drop green stardust. Collect enough and the game pauses to offer
  three upgrade cards. You can hold 6 different upgrades per run, and you get a few rerolls.
- The arena is bigger than the screen. Edge arrows and a radar show what's coming.
- Desktop: arrows / WASD to steer, P to pause. Add `?fps=1` to the URL for an FPS meter.

**Star map.** Six sectors, each with its own hazard and a boss. Beating a boss clears the sector,
opens the next one and adds new weapons and evolutions to every future run.

| # | Sector | Hazard | Boss | Unlocks |
|---|---|---|---|---|
| 1 | Asteroid Belt | none, just rocks | The Mother Rock | Seeker Missiles, Nova Pulse, Prism Lance, Railstorm |
| 2 | Ion Storm | telegraphed lightning strikes, supercharged stardust | Storm Eye | Arc Coil, Tempest, Cluster Swarm |
| 3 | Gravity Well | a black hole pulls everything in | Event Horizon | Gravity Bomb, Singularity Blades, Black Star |
| 4 | Ice Field | frictionless drift, crystal rocks split in three | Glacier King | Frost Shards, Wingman Drone, Aegis Core |
| 5 | Ember Nebula | darkness and homing comets | Ember Phoenix | Hivemind, The Deep |
| 6 | The Deep | all hazards, rotating | every boss, every 5 waves | endless high score |

**Upgrades:** 18 regular upgrades plus Overcharge, which is offered only when nothing else is left.
**Evolutions:** when an upgrade is maxed and you own its partner, a gold EVOLUTION card can appear
(Prism Lance, Railstorm, Tempest, Cluster Swarm, Singularity Blades, Black Star, Aegis Core, Hivemind).

Every line of code was written by Claude Haiku 5.5 subagents working from a spec, with a
coordinating model doing only the spec, review and verification. See [WRITEUP.md](WRITEUP.md).

## Run locally

Plain JavaScript ES modules, Canvas 2D, WebAudio. No build step, no dependencies, no external assets.

```sh
bun server.ts                 # http://127.0.0.1:8780 (PORT and HOST env override)
bun tools/smoke.ts            # headless flow test, 12 steps (needs playwright-core + Chromium)
bun tools/showcase.ts         # every sector, boss and evolution on screen + FPS + a bot balance probe
```

Any static file server works too: everything the browser needs is in `site/`.

## Layout

```
BRIEF.md            the contract every agent coded against (interfaces, DOM ids, numbers)
WRITEUP.md          how it was built
server.ts           tiny Bun static server for site/
site/index.html     DOM skeleton          site/style.css   all styling
site/js/main.js     boot                  site/js/game.js  state machine, camera, runs, waves, collisions, game.api
site/js/entities.js ship, rocks (+crystal/shard/comet), bullets, gems, missiles, orbitals, particles, stars, border
site/js/overlay.js  off-screen threat arrows + radar
site/js/upgrades.js stats, upgrades, evolutions, slots, weighted card rolls, XP curve
site/js/sectors.js  the six sectors, wave specs, unlocks, saved progress
site/js/systems.js  sector hazards        site/js/bosses.js the five bosses
site/js/weapons.js  missiles, nova, orbitals, chain lightning, gravity bombs, frost, drones, evolutions
site/js/ui.js       HUD, star map and overlays   site/js/input.js keyboard + floating touch joystick
site/js/audio.js    synthesised sound effects
tools/              smoke.ts (12-step flow) and showcase.ts (every sector, boss and evolution + a bot)
.agents/            some of the agent prompts and the launcher script
.github/workflows/  GitHub Pages deploy (publishes site/ as-is)
```
