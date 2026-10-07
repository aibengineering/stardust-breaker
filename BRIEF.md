# STARDUST BREAKER — the contract

Every agent reads this first. It is the single source of truth for file ownership, module
interfaces, DOM ids and numbers. If you need something not listed, keep it private to your file.

## What it is

A small, juicy Asteroids-style shooter with roguelite upgrades (Vampire-Survivors style level-ups).
Phone-first (Ben plays on a phone over the tailnet), also works with a keyboard on desktop.

- The ship **auto-fires** continuously toward where it points (no fire button).
- Destroyed asteroids split (large → 2 medium → 2 small → gone) and drop green **XP gems**.
- Gems fly to the ship inside its magnet radius. Enough XP → **level up**: game pauses, 3 upgrade
  cards appear, the player taps one.
- Waves: clear all asteroids → banner "WAVE n" → next, bigger wave.
- Hull = lives (3 pips). Getting hit costs 1 hull (or 1 shield charge if any) and gives brief invulnerability.
- Game over screen shows score, wave, level, best score (localStorage), and the upgrades taken.

Neon-on-deep-space look: background `#070b1a`, ship cyan `#4df3ff`, bullets yellow `#ffe66d`,
asteroids outlined `#b9a7ff` (fill `#1a1636`), gems green `#5dff9b`, missiles orange `#ff9f43`,
orbitals magenta `#ff5ad1`, damage/hurt red `#ff4d6d`, shield blue `#6db8ff`. Use `ctx.shadowBlur`
glow sparingly (a few draws per frame, not per particle). Font: system-ui, bold, letter-spaced caps.

## Tech rules

- Plain JavaScript ES modules in the browser, **no build step, no framework, no external assets/CDNs**
  (phone may be offline). Sounds are synthesised with WebAudio. Graphics are Canvas 2D vector shapes.
- Served by a tiny Bun static server (`server.ts`). Port **8780**.
- All units: pixels, seconds, radians. Angle 0 points right (+x), angles increase clockwise
  (canvas y points down). `dt` is seconds, clamped by the game loop to ≤ 0.05.
- `world = { w, h }` is the playfield size in CSS pixels (= window size). Everything wraps at edges.
- Canvas is sized to window × devicePixelRatio; game.js does `ctx.setTransform(dpr,0,0,dpr,0,0)`,
  so all drawing code works in CSS pixels.
- No `console.log` spam in shipped code. No errors in the console.

## File map and owners

```
server.ts                    chunk A   Bun static server for site/
asteroid-shooter.service     chunk A   systemd user unit
package.json                 chunk A
site/index.html              chunk A   DOM skeleton (ids below), loads js/main.js as a module
site/style.css               chunk A   all CSS
site/js/ui.js                chunk A   DOM overlays: HUD, title, upgrade cards, pause, game over, banner
site/js/input.js             chunk A   keyboard + floating touch joystick (draws its own stick DOM)
site/js/entities.js          chunk B   ship, bullets, asteroids, gems, missiles, orbitals, particles, stars
site/js/audio.js             chunk B   WebAudio synth sound effects
site/js/upgrades.js          chunk C   base stats, upgrade definitions, rolling choices
site/js/game.js              chunk D   state machine, loop, waves, collisions, XP, scoring, rendering order
site/js/main.js              chunk D   boot: wires ui/input/game together, sets window.__game
tools/smoke.ts               chunk E   headless-Chromium smoke test + screenshots
```

Never edit a file you don't own. If an interface here seems wrong, implement it as written and
mention the concern in your final report.

---

## server.ts (A)

`PORT` env (default 8780), `HOST` env = comma-separated hostnames to bind (default `127.0.0.1`),
binds one `Bun.serve` per host. Serves `site/` statically: `/` → `site/index.html`. GET/HEAD only.
Reject paths containing `..`. Content types for html/css/js/svg/png/json/webmanifest. Header
`Cache-Control: no-store`. 404 for anything else. Export nothing special; run with `bun server.ts`.

`asteroid-shooter.service` (systemd user unit), modelled on:
```
[Unit]
Description=Stardust Breaker: asteroid shooter with upgrades
After=network-online.target tailscaled.service
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=/home/ben/me/code/2610_asteroid_shooter
Environment=HOST=127.0.0.1,<tailnet-hostname>
Environment=PORT=8780
ExecStart=/home/ben/.bun/bin/bun server.ts
Restart=always
RestartSec=5
NoNewPrivileges=true
UMask=0077
[Install]
WantedBy=default.target
```
`package.json`: name `asteroid-shooter`, private, `"type":"module"`, scripts `start: bun server.ts`,
`smoke: bun tools/smoke.ts`. No dependencies (playwright-core comes from the symlinked node_modules).

## index.html + style.css (A)

`<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`,
`theme-color #070b1a`, title "Stardust Breaker". Body has no scroll, no text selection, no
tap-highlight, `touch-action: none` on the canvas and overlays during play. Respect safe-area insets.

Required DOM (ids are the contract; children/markup otherwise free):
```
<canvas id="game">
<div id="hud">                 top bar during play:
   #hud-score  #hud-wave  #hud-level            text
   #hud-xp > #hud-xp-fill                       XP bar (width %)
   #hud-hull                                    hull pips (filled/empty) + shield pips (blue)
   button#pause-btn  button#mute-btn
<div id="banner">              big centred fading text ("WAVE 3", "LEVEL UP!")
<section id="title-screen">    game name, one-line how-to-play, best score, button#start-btn "PLAY"
<section id="upgrade-screen">  heading "LEVEL UP — choose one", div#upgrade-cards (cards rendered by ui.js)
<section id="pause-screen">    "PAUSED", button#resume-btn, button#quit-btn ("Quit to title")
<section id="gameover-screen"> div#gameover-stats, div#gameover-upgrades, button#restart-btn "PLAY AGAIN"
```
Overlays are hidden with the `hidden` attribute (ui.js toggles it). Upgrade cards are big, tappable
(≥ 64px tall, full width on a 390px phone, 3 stacked vertically on phone; side by side ≥ 700px wide),
show icon, name, "Lv n → n+1" (or "NEW"), description, rarity border colour
(common `#9aa4c7`, rare `#4df3ff`, epic `#ff5ad1`) and a short pop-in animation.

## ui.js (A)

```js
export function initUI(handlers)
  // handlers = { onStart(), onRestart(), onPause(), onResume(), onQuit(), onToggleMute() }
  // wires #start-btn, #restart-btn, #pause-btn, #resume-btn, #quit-btn, #mute-btn (click events).
export function showScreen(name)
  // name: 'title' | 'playing' | 'upgrade' | 'pause' | 'gameover'
  // shows that overlay, hides the others. #hud visible for playing/upgrade/pause.
export function setBest(best)                       // number, shown on title screen
export function updateHUD(h)
  // h = { score, wave, level, xp, xpNext, hull, maxHull, shield, shieldMax }
  // Must be cheap: only touch the DOM when a value changed.
export function showUpgradeChoices(choices, onPick)
  // choices = [{ id, name, icon, rarity, level, maxLevel, desc }]  (level = CURRENT level, 0 = new)
  // renders each card as <button class="upgrade-card rarity-<rarity>" data-id="<id>"> into
  // #upgrade-cards, shows 'upgrade' screen; tapping a card calls onPick(id) once
  // (guard against double taps; ignore input for the first 250 ms so a held thumb doesn't auto-pick).
export function showGameOver(s)
  // s = { score, wave, level, best, isNewBest, upgrades: [{ name, icon, level }] }
export function showBanner(text, ms = 1400)         // big fading centred text
export function setMuted(muted)                     // updates #mute-btn icon (🔊 / 🔇)
```

## input.js (A)

```js
export const input = {
  left: false, right: false, thrust: false,          // keyboard: ←/A, →/D, ↑/W
  stick: { active: false, x: 0, y: 0 },              // touch joystick, x/y in -1..1, magnitude ≤ 1
  pausePressed: false,                               // set true on P / Escape keydown; game clears it
}
export function initInput(canvas)
```
Touch / pointer: a **floating joystick** — `pointerdown` anywhere on the canvas places the stick base
there; dragging sets `stick.x/y` = offset / 60px (clamped to unit circle); release → `active=false`,
x=y=0. Only track the first pointer. Mouse drag works the same (handy on desktop). input.js creates
and positions its own two DOM circles (base + knob, `pointer-events:none`, semi-transparent) and
hides them on release. Prevent default on touch so the page never scrolls/zooms. Clear all keys on
window `blur`.

## upgrades.js (C)

```js
export function baseStats() { return {
  fireRate: 3.5,        // volleys per second
  bulletSpeed: 560,     // px/s
  bulletLife: 0.85,     // s
  bulletDamage: 1,
  multishot: 1,         // bullets per volley, fanned 0.16 rad apart, centred on ship angle
  pierce: 0,            // extra asteroids each bullet may pass through
  rearGun: 0,           // bullets also fired straight backwards per volley
  thrust: 280, maxSpeed: 330, turnSpeed: 4.2,
  maxHull: 3,
  shieldMax: 0, shieldRecharge: 9,       // shield charges; seconds to regain one charge
  magnetRadius: 115,
  orbitals: 0, orbitalDamage: 1, orbitalRadius: 48, orbitalSpeed: 3.2,   // rad/s
  missiles: 0, missileInterval: 2.4, missileDamage: 2,                   // missiles per salvo
  novaLevel: 0, novaInterval: 7, novaRadius: 150, novaDamage: 2,
  xpGain: 1,
}}

export const UPGRADES = [ /* each: */ {
  id: 'rapid',            // unique kebab/lower id
  name: 'Rapid Fire',
  icon: '⚡',              // single emoji
  rarity: 'common',       // 'common' | 'rare' | 'epic'
  maxLevel: 5,
  desc: (nextLevel) => '+20% fire rate',   // text describing what taking level `nextLevel` gives
  apply: (stats, game) => { stats.fireRate *= 1.2 },
}, ... ]
```
The required set (ids fixed; tune numbers if you must, keep the spirit):

| id | name | rarity | max | effect per level |
|---|---|---|---|---|
| rapid | Rapid Fire | common | 5 | fireRate ×1.2 |
| damage | Heavy Rounds | common | 5 | bulletDamage +1 |
| velocity | Railgun Barrel | common | 4 | bulletSpeed ×1.15, bulletLife ×1.1 |
| engine | Ion Engine | common | 4 | thrust ×1.15, maxSpeed ×1.12, turnSpeed ×1.1 |
| magnet | Tractor Beam | common | 4 | magnetRadius ×1.4 |
| hull | Reinforced Hull | common | 4 | maxHull +1 and heal: `game.ship.hull = min(hull+1, maxHull)` |
| multishot | Spread Shot | rare | 4 | multishot +1 |
| pierce | Piercing Rounds | rare | 3 | pierce +1 |
| rear | Rear Turret | rare | 2 | rearGun +1 |
| shield | Deflector Shield | rare | 3 | shieldMax +1, shieldRecharge ×0.85; also give a charge now: `game.ship.shield = min(shield+1, shieldMax)` |
| greed | Stardust Greed | rare | 3 | xpGain ×1.25 |
| orbit | Orbital Blades | epic | 4 | orbitals +1 (from level 3, also orbitalDamage +1) |
| missiles | Seeker Missiles | epic | 4 | missiles +1, missileInterval ×0.9 |
| nova | Nova Pulse | epic | 3 | novaLevel +1; levels 2–3: novaInterval ×0.8, novaRadius ×1.2, novaDamage +1 |

```js
export function rollChoices(levels, n = 3, rng = Math.random)
  // levels: { [id]: currentLevel } (missing = 0). Returns up to n DISTINCT upgrade defs not yet at
  // maxLevel, picked by weighted random: common 60, rare 30, epic 12. If fewer than n are available,
  // return what's left. If none are left, return [] (game then just heals 1 hull instead).
export function applyUpgrade(id, stats, levels, game)
  // levels[id] = (levels[id]||0)+1, then UPGRADES def.apply(stats, game). Throws on unknown id.
export function getUpgrade(id)       // the def or undefined
export function xpForLevel(level)    // XP needed to go from `level` to level+1: Math.round(4 + level*3 + level*level*0.5)
```
`game` passed to apply is the game object (only `game.ship.hull` / `game.ship.shield` and
`game.stats` are touched). `apply` must not throw if `game` is null (guard it).

## entities.js (B)

All entities are plain objects. Functions mutate in place. `world = {w,h}`.

```js
export function wrap(o, world)                  // wrap o.x/o.y with margin o.radius so things slide off-screen before reappearing
export function dist2(a, b)                     // squared distance (wrap-unaware is fine)

// --- ship ---
export function createShip(x, y, stats)
  // { x, y, vx:0, vy:0, angle: -Math.PI/2 (pointing up), radius: 12,
  //   hull: stats.maxHull, shield: stats.shieldMax, shieldTimer: 0, invuln: 0,
  //   fireTimer: 0, missileTimer: 0, novaTimer: 0, thrusting: false, alive: true }
export function updateShip(ship, input, stats, dt, world)
  // Steering. Touch: if input.stick.active and |stick| > 0.2 → rotate toward atan2(stick.y, stick.x)
  //   at stats.turnSpeed*1.6 rad/s (shortest way, no overshoot); thrust if |stick| > 0.35 with force
  //   stats.thrust * |stick|. Keyboard: left/right rotate at stats.turnSpeed, thrust adds stats.thrust.
  // Physics: velocity clamped to stats.maxSpeed, drag v *= Math.pow(0.55, dt) (gentle glide), wrap.
  // Timers: invuln -= dt (≥0). Shield regen: if shield < stats.shieldMax, shieldTimer += dt; when
  //   ≥ stats.shieldRecharge → shield += 1, shieldTimer = 0.
  // Sets ship.thrusting. Does NOT fire (game.js does).
export function drawShip(ctx, ship, stats, time)
  // Neon cyan triangle, flame flicker when thrusting, blinks while invuln > 0 (skip ~every other 0.1s),
  // blue circle if shield > 0 (one ring per charge, slightly larger each). Draw nothing if !alive.

// --- bullets (player only) ---
export function createBullet(x, y, angle, stats, inheritVx = 0, inheritVy = 0)
  // { x, y, vx, vy (stats.bulletSpeed along angle + inherit*0.5), life: stats.bulletLife, radius: 2.5,
  //   damage: stats.bulletDamage, pierceLeft: stats.pierce, hitIds: [], dead: false }
export function updateBullet(b, dt, world)      // move, wrap, life -= dt, dead when life ≤ 0
export function drawBullets(ctx, bullets)       // short yellow streaks along velocity, one glow pass

// --- asteroids ---
export const ASTEROID_SIZES = {
  3: { radius: 44, hp: 3, score: 20,  gems: 3 },
  2: { radius: 26, hp: 2, score: 50,  gems: 2 },
  1: { radius: 14, hp: 1, score: 100, gems: 1 },
}
export function createAsteroid(x, y, size, speedMul = 1, vx, vy)
  // { id (unique incrementing int), x, y, vx, vy (random dir, speed rand(35,85)*speedMul when vx/vy
  //   undefined), size, radius, hp, maxHp, angle, spin (rand ±1.2 rad/s), shape: number[] (10–14
  //   jagged radius multipliers 0.75–1.15), hitFlash: 0, orbitCd: 0, dead: false }
  // hp scales: hp = ASTEROID_SIZES[size].hp + Math.floor((speedMul-1)*3)
export function splitAsteroid(a, speedMul = 1)  // [] for size 1, else 2 children size-1 at a.x/y,
                                                // velocities = parent's ± a perpendicular kick, ×1.2
export function updateAsteroid(a, dt, world)    // move, spin, wrap, hitFlash -= dt, orbitCd -= dt
export function drawAsteroid(ctx, a)            // jagged polygon, fill #1a1636, stroke #b9a7ff,
                                                // white flash while hitFlash > 0; small hp cracks optional

// --- XP gems ---
export function createGem(x, y, value = 1)      // { x, y, vx, vy (small random scatter), value, radius: 4, life: 20, dead:false }
export function updateGem(g, ship, stats, dt, world)
  // if ship.alive and within stats.magnetRadius → accelerate strongly toward ship (reach it quickly);
  // else slow down (drag). life -= dt; dead when life ≤ 0. Blink in last 3 s. Collection is game.js's job.
export function drawGems(ctx, gems, time)       // green diamonds, gentle pulse

// --- missiles ---
export function createMissile(x, y, angle, stats)
  // { x, y, angle, speed: 260, turn: 5 (rad/s), life: 3, radius: 4, damage: stats.missileDamage, dead:false, targetId:null }
export function updateMissile(m, asteroids, dt, world)
  // pick nearest live asteroid as target if none/dead, turn toward it at m.turn, accelerate to 420 px/s, wrap, life
export function drawMissiles(ctx, missiles)     // orange dart + tiny trail

// --- orbitals ---
export function orbitalPositions(ship, stats, time)
  // → [{ x, y, radius: 7 }] × stats.orbitals, evenly spaced at stats.orbitalRadius, rotating at stats.orbitalSpeed
export function drawOrbitals(ctx, ship, stats, time)   // magenta spinning blades

// --- particles & rings ---
export function burst(particles, x, y, color, count = 12, speed = 160)  // pushes spark particles
export function ring(particles, x, y, maxRadius, color, duration = 0.45) // pushes an expanding ring
export function updateParticles(particles, dt)  // advance & remove dead IN PLACE (swap-remove/filter into same array)
export function drawParticles(ctx, particles)   // sparks fade out; rings expand with fading stroke
// Cap particles at ~600 (drop oldest/new ones beyond).

// --- background ---
export function createStars(world, count = 140) // [{ x, y, z (0.2..1 depth), tw (twinkle phase) }]
export function drawStars(ctx, stars, world, ship, time)  // tiny dots, parallax offset from ship position * z * 0.05, twinkle
```

## audio.js (B)

```js
export const sfx = {
  unlock(),          // create/resume AudioContext; call from first user gesture (safe to call repeatedly)
  setMuted(bool), isMuted(),   // persist to localStorage 'sb-muted'
  shoot(), hit(), explode(size /*1..3*/), pickup(), levelUp(), pick(), hurt(), shieldHit(),
  missile(), nova(), wave(), gameOver(),
}
```
Short synthesized blips/noise bursts (oscillators + filtered noise buffer, envelopes). Master gain
~0.35. `shoot` fires several times a second: keep it very quiet and short, and rate-limit it to
≤ 12 per second. `pickup` rate-limited and pitch rising slightly with rapid successive pickups
(resets after 0.4 s). Every method is a silent no-op before unlock or while muted, and never throws.

## game.js + main.js (D)

```js
// game.js
export function createGame({ canvas, ui, input, sfx })  // returns the game object below
// game = { state: 'title'|'playing'|'upgrade'|'pause'|'over', world, ship, stats, levels,
//          asteroids, bullets, gems, missiles, particles, stars, score, wave, level, xp, best,
//          start(), pause(), resume(), quitToTitle(), toggleMute(), debug: { levelUp(), killShip(), clearWave() } }
```
main.js imports everything, builds the game, calls `initUI` with handlers mapping to game methods
(onStart/onRestart → `sfx.unlock(); game.start()`), `initInput(canvas)`, sets `window.__game = game`,
starts the `requestAnimationFrame` loop (owned by game.js; it runs always so the title screen shows
drifting asteroids + stars behind the overlay).

Rules game.js implements:
- `start()`: reset stats (baseStats), levels {}, score 0, wave 0, level 1, xp 0, ship at centre,
  clear arrays, state 'playing', `ui.showScreen('playing')`, begin wave 1.
- Wave n: spawn `3 + n` large asteroids (+1 medium per wave from wave 4) at random edge positions
  ≥ 220 px from the ship; speedMul = 1 + 0.07*(n-1). Banner "WAVE n", `sfx.wave()`. When no
  asteroids remain, after 1.5 s start the next wave (+ bonus score 100*n).
- Firing (only state 'playing', ship alive): fireTimer -= dt; when ≤ 0 → volley: `multishot` bullets
  fanned around ship.angle from the nose, plus `rearGun` bullets backwards; fireTimer += 1/fireRate.
  `sfx.shoot()` once per volley.
- Missiles: if stats.missiles > 0, missileTimer counts; each salvo fires `missiles` missiles fanned
  ±0.5 rad from the nose. Nova: if novaLevel > 0, every novaInterval damage all asteroids within
  novaRadius of the ship by novaDamage, `ring()` effect, `sfx.nova()`, small push outward.
- Collisions (circle vs circle): bullet↔asteroid (skip ids in hitIds; on hit push id, damage,
  pierceLeft-- or dead), missile↔asteroid (missile dies, small ring), orbital↔asteroid (damage
  orbitalDamage when a.orbitCd ≤ 0, then a.orbitCd = 0.35), ship↔asteroid (only if invuln ≤ 0).
- Damaging an asteroid: hp -= dmg, hitFlash = 0.08, `sfx.hit()`; at hp ≤ 0: dead, score +=
  ASTEROID_SIZES.score, drop `gems` gems, burst particles, `sfx.explode(size)`, push splitAsteroid
  children (same wave speedMul).
- Ship hit: if shield > 0 → shield -= 1, shieldTimer = 0, invuln = 1.0, `sfx.shieldHit()`, ring;
  else hull -= 1, invuln = 2.0, `sfx.hurt()`, screen shake (0.3 s, 8 px), red flash. Also bounce the
  asteroid away. hull ≤ 0 → ship.alive = false, big burst, `sfx.gameOver()`, after 1.4 s state
  'over', update best (localStorage 'sb-best'), `ui.showGameOver(...)`.
- Gems: collected when within ship.radius + 10 → xp += value * stats.xpGain, `sfx.pickup()`. While
  xp ≥ xpForLevel(level): xp -= that, level++, queue a level-up. Pending level-ups are shown one at a
  time: state 'upgrade', `sfx.levelUp()`, `ui.showUpgradeChoices(choices, onPick)` where choices come
  from rollChoices mapped to {id,name,icon,rarity,level,maxLevel,desc: def.desc(level+1)}. onPick →
  applyUpgrade, `sfx.pick()`, next pending or back to 'playing' (+0.6 s invuln). If rollChoices
  returns [] → heal 1 hull, no screen.
- States 'upgrade' / 'pause' / 'over' freeze simulation (still render). 'title' simulates only
  asteroids + stars (no ship). `input.pausePressed` toggles pause in 'playing'/'pause'.
  Auto-pause when the page becomes hidden (visibilitychange).
- Render order: clear `#070b1a`, stars, gems, asteroids, bullets, missiles, orbitals, ship,
  particles, red hurt flash overlay. Screen shake = translate before world drawing.
- `ui.updateHUD` every frame (it is cheap). Resize handler keeps canvas = window size × dpr.

## tools/smoke.ts (E)

Bun script using `playwright-core` (`import { chromium } from 'playwright-core'`). Chromium path:
`process.env.CHROME_PATH` or the newest `~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell`.
`BASE` env (default `http://127.0.0.1:8780`). Phone context 390×844 @2x, `hasTouch: true, isMobile: true`.
Collect console errors + page errors. Steps, saving `tools/out/NN-name.png`:
1. load → `01-title.png`; 2. click #start-btn, wait 2 s → `02-play.png`;
3. drag a touch joystick (mouse down at 120,600 → move to 180,560 over steps, hold 1.5 s, up) → `03-steer.png`;
4. `window.__game.debug.levelUp()` → wait for #upgrade-screen visible → `04-upgrade.png`; click first `.upgrade-card` → assert state 'playing';
5. `debug.clearWave()` wait 2.5 s → assert wave ≥ 2 → `05-wave2.png`;
6. press 'p' → assert state 'pause' → `06-pause.png`; click #resume-btn;
7. `debug.killShip()` wait 2.5 s → assert #gameover-screen visible → `07-gameover.png`;
8. desktop context 1280×800 load + start → `08-desktop.png`.
Print PASS/FAIL per step and all console errors; exit code 1 on any failure or console error.
