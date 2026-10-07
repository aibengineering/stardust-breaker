# Stardust Breaker

A small neon asteroid shooter with roguelite upgrades. Phone-first, also plays on desktop.

**Play:** https://aibengineering.github.io/stardust-breaker/

- Drag anywhere to steer (a joystick appears under your thumb). The ship fires automatically.
- Shot asteroids split and drop green stardust. Collect enough and the game pauses to offer
  three upgrade cards.
- Desktop: arrows / WASD to steer, P to pause.

14 upgrades in three rarities:

| Rarity | Upgrades |
|---|---|
| Common | Rapid Fire, Heavy Rounds, Railgun Barrel, Ion Engine, Tractor Beam, Reinforced Hull |
| Rare | Spread Shot, Piercing Rounds, Rear Turret, Deflector Shield, Stardust Greed |
| Epic | Orbital Blades, Seeker Missiles, Nova Pulse |

Every line of code was written by Claude Haiku 5.5 subagents working from a spec, with a
coordinating model doing only the spec, review and verification. See [WRITEUP.md](WRITEUP.md).

## Run locally

Plain JavaScript ES modules, Canvas 2D, WebAudio. No build step, no dependencies, no external assets.

```sh
bun server.ts                 # http://127.0.0.1:8780 (PORT and HOST env override)
bun tools/smoke.ts            # headless smoke test, 8 steps (needs playwright-core + Chromium)
bun tools/showcase.ts         # screenshots of every weapon + a bot balance probe
```

Any static file server works too: everything the browser needs is in `site/`.

## Layout

```
BRIEF.md            the contract every agent coded against (interfaces, DOM ids, numbers)
WRITEUP.md          how it was built
server.ts           tiny Bun static server for site/
site/index.html     DOM skeleton          site/style.css   all styling
site/js/main.js     boot                  site/js/game.js  state machine, loop, waves, collisions, XP
site/js/entities.js ship, rocks, bullets, gems, missiles, orbitals, particles, stars
site/js/upgrades.js base stats, the 14 upgrades, weighted card rolls, XP curve
site/js/ui.js       HUD and overlays      site/js/input.js keyboard + floating touch joystick
site/js/audio.js    synthesised sound effects
tools/              smoke.ts and showcase.ts (headless Chromium via playwright-core)
.agents/            the first-wave agent prompts and the launcher script
.github/workflows/  GitHub Pages deploy (publishes site/ as-is)
```
