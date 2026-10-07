# STARDUST BREAKER v2 — the contract

Every agent reads this first. It is the single source of truth for file ownership, module
interfaces, object shapes, DOM ids and numbers. If you need something not listed, keep it private to
your file. If something here seems wrong, implement it as written and say so in your final report.

v1 (in git history) was a single endless arena. **v2 adds a star map of sectors, a bigger arena with
a following camera, sector hazards ("systems"), bosses, new weapons, evolutions and build limits.**
Most v1 code stays; files are extended, not rewritten, unless this brief says so.

## The game

Phone-first neon Asteroids-style shooter with roguelite level-ups. Plain JS ES modules, Canvas 2D,
WebAudio, no build step, no dependencies, no external assets. Served from `site/` (static).

- Ship **auto-fires**; steer with a floating touch joystick (drag anywhere) or arrows/WASD.
- Shot asteroids split and drop green **stardust gems**; XP → level-up → pick 1 of 3 cards.
- **Star map:** PLAY opens a map of 6 sectors. Each sector has its own hazard system and a boss.
  Clear N waves, then the boss wave. Beating the boss **clears the sector**: it unlocks the next
  sector and adds new upgrades/evolutions to the card pool for all future runs (saved in
  localStorage). Then the player can keep going (endless overtime in that sector) or return to the map.
- **Bigger arena:** the arena is larger than the screen; the camera follows the ship. The arena is
  **bounded** (no wrap-around): rocks bounce off the glowing border, the ship is stopped by it.
  Off-screen rocks get **edge arrows**, and a small **radar** shows the whole arena.
- **Build limits:** at most **6 different upgrades** per run (evolutions and Overcharge don't count).
  **Rerolls** per run: 2, +1 per cleared sector, max 5.
- **Evolutions:** when an upgrade is maxed and you own its partner, the next level-up offers its
  golden EVOLUTION card (only if that evolution is unlocked).

### Sectors

| # | id | name | tier | waves | system | boss | arena w×h | clearing unlocks (upgrades / evolutions / sector) |
|---|---|---|---|---|---|---|---|---|
| 1 | belt | Asteroid Belt | 1 | 5 | none | mother | 1300×1700 | missiles, nova / prism, railstorm / storm |
| 2 | storm | Ion Storm | 2 | 6 | storm | stormeye | 1400×1800 | chain / tempest, swarm / gravity |
| 3 | gravity | Gravity Well | 3 | 6 | gravity | horizon | 1500×1500 | gravbomb / singularity, blackstar / ice |
| 4 | ice | Ice Field | 4 | 7 | ice | glacier | 1500×1900 | frost, drone / aegis / ember |
| 5 | ember | Ember Nebula | 5 | 7 | ember | phoenix | 1500×1900 | — / hivemind / deep |
| 6 | deep | The Deep | 6 | endless | chaos | rotating every 5 waves | 1600×2000 | — (endless high score) |

Taglines (shown on the map): belt "Where it all began. Rocks. Lots of rocks." · storm "Lightning
strikes where the air crackles. Stardust is supercharged." · gravity "A black hole at the centre
drags everything in — including you." · ice "Frictionless drift. Crystal rocks shatter into three." ·
ember "Darkness and homing comets. Trust your radar." · deep "Every hazard. Every boss. No end."

**Base card pool** (always available): rapid, damage, velocity, engine, magnet, hull, multishot,
pierce, rear, shield, greed, orbit, overcharge. Everything else is unlocked by clearing sectors.

## Tech rules

- Units: CSS pixels, seconds, radians. Angle 0 = +x, clockwise positive (canvas y down). `dt` ≤ 0.05.
- **view** `{w, h}` = canvas size in CSS px. **zoom** = `clamp(min(view.w, view.h) / 480, 0.75, 1)`
  (a 390 px phone sees ~480 world px across). **Visible world size** = `view.w/zoom × view.h/zoom`.
- **world** `{w, h}` = arena size for the current run: `w = max(sector.arena.w, ceil(view.w/zoom*1.2))`,
  same for h. On title/map screens, world = visible size and cam = (0,0).
- **cam** `{x, y}` = world coords of the top-left of the view. World → screen: `sx = (x - cam.x) * zoom`.
- All world-space drawing functions draw in **world coordinates**; game.js sets the transform
  `ctx.setTransform(dpr*zoom, 0, 0, dpr*zoom, -cam.x*dpr*zoom, -cam.y*dpr*zoom)` (plus shake) first.
  Screen-space functions draw in CSS px after game.js sets `ctx.setTransform(dpr,0,0,dpr,0,0)`.
- Every draw function must leave ctx state as found (save/restore) and reset shadowBlur. Glow
  (shadowBlur) once per batch, never per particle.
- No console.log in shipped code. No errors. Never throw from per-frame code on odd input.
- Colours: bg `#070b1a`, ship cyan `#4df3ff`, bullets yellow `#ffe66d`, rocks `#b9a7ff` on `#1a1636`,
  gems `#5dff9b`, missiles `#ff9f43`, orbitals `#ff5ad1`, hurt `#ff4d6d`, shield `#6db8ff`,
  **legendary/evolution gold `#ffd166`**, lightning `#b8a9ff`/white, ice `#9fe8ff`, ember `#ff7a3d`.

## File map and owners

```
site/js/entities.js   S  (extend)  ship, bullets, rocks (+kinds), gems, missiles, orbitals, particles, stars, border
site/js/overlay.js    S  (new)     screen-space threat arrows + radar
site/js/upgrades.js   P  (extend)  stats, upgrades (+new, +evolutions, +overcharge), slots, rolls
site/js/sectors.js    P  (new)     sector table, wave specs, progress save/load, unlocks
site/js/systems.js    Q  (new)     sector hazard systems
site/js/bosses.js     Q  (new)     the 5 bosses
site/js/weapons.js    R  (new)     secondary weapons + evolution behaviours (missiles, nova, orbitals, chain, bombs, frost, drones)
site/index.html       T  (extend)  DOM (ids below)
site/style.css        T  (extend)
site/js/ui.js         T  (extend)  overlays: map, HUD, boss bar, cards (+evolution, reroll, slots), victory, game over
site/js/audio.js      T  (extend)  new sound effects
site/js/input.js      —  unchanged
site/js/game.js       U  (rewrite) state machine, camera, runs, waves, collisions, api, render order
site/js/main.js       U  (extend)
tools/smoke.ts        V  (rewrite) flow test
tools/showcase.ts     V  (rewrite) sectors/bosses/evolutions screenshots + balance probe
server.ts, input.js   unchanged
```
Never edit a file you don't own. Read the current version of any file you extend first and keep its
existing exports working unless this brief changes them.

---

## THE GAME OBJECT and `game.api` (everyone codes against this)

game.js creates one object; systems, bosses, weapons and overlay receive it. Fields:

```js
game = {
  state,          // 'title' | 'map' | 'playing' | 'upgrade' | 'pause' | 'victory' | 'over'
  view, zoom, world, cam,           // see Tech rules
  sector,         // the sector definition object from sectors.js (null on title/map)
  phase,          // 'waves' | 'boss' | 'endless'   (endless = after clearing, or always in deep)
  system,         // the hazard system object from systems.js (null on title/map)
  ship,           // entities.createShip(...) object
  stats, levels,  // from upgrades.js: stats object, { [upgradeId]: level }
  asteroids, bosses, bullets, gems, missiles, particles, stars,   // arrays (game.js compacts dead items each frame)
  fx,             // array owned by weapons.js for transient weapon visuals; game.js only clears it on run start
  weaponState,    // object owned by weapons.js (timers etc.); game.js resets it to {} on run start
  score, wave, level, xp,
  time,           // seconds since run start (frozen while not 'playing')
  progress,       // object from sectors.loadProgress()
  rerolls,        // rerolls left this run
  api,            // below
  debug,          // see game.js section
}
```
Asteroid objects get `isBoss` undefined; boss objects have `isBoss: true`. Both have `id, x, y, vx, vy,
radius, hp, maxHp, dead, hitFlash`. Bosses use ids ≥ 1,000,000.

```js
game.api = {
  damageAsteroid(a, dmg),  // hp -= dmg, hitFlash, sfx.hit; at hp<=0: dead, score, gems, burst, split,
                           // sfx.explode, then weapons.onKill(game, a) and system.onKill?.(game, a)
  damageBoss(b, dmg),      // hp -= dmg, hitFlash, sfx.bossHit; at hp<=0 → game's boss-defeated flow
  damageTarget(t, dmg),    // t.isBoss ? damageBoss : damageAsteroid
  targets(),               // NEW array of live asteroids + live bosses
  nearestTarget(x, y, maxDist = Infinity),   // nearest live target or null
  hurtShip(fromX, fromY),  // standard hit: no-op if ship dead or invuln>0 or debug-invincible;
                           // shield first (then weapons.onShieldBreak(game)), else hull; knockback away from (fromX,fromY)
  spawnAsteroid(x, y, size, opts = {}),  // opts { vx, vy, kind = 'rock', speedMul = 1, transient = false } → rock (pushed)
  addGem(x, y, value = 1),
  burst(x, y, color, count, speed), ring(x, y, radius, color, duration),
  shake(seconds, px),
  banner(text, ms),
  fireBullet(x, y, angle, opts = {}),    // friendly projectile into game.bullets, see entities.createBullet opts
  sfx,                                   // the audio sfx object
}
```
`transient` rocks (boss shards, system comets) do **not** block wave completion.

---

## entities.js (S) — extend

Keep every existing export. Changes:

**Bounded world** (replaces wrap-around inside the update functions; keep exporting `wrap` for
compatibility):
```js
export function bounds(o, world, mode)   // mode: 'bounce' | 'clamp' | 'kill'
// bounce: if the circle (o.radius) crosses an edge, put it back inside and reflect that velocity
//         component (vx/vy) with factor 0.9. clamp: keep inside, zero the outward velocity component.
// kill: o.dead = true once fully outside the world.
```
- `updateShip(ship, input, stats, dt, world, mods = {})` → `bounds(ship, world, 'clamp')`.
  `mods = { drag = 0.55, thrustMul = 1, turnMul = 1 }` replaces the fixed drag base 0.55 and scales
  thrust / turn speed (the ice system passes drag 0.85 = slippery).
- `updateBullet` → `'kill'`; `updateAsteroid(a, dt, world, ship = null)` → `'bounce'`;
  `updateGem` → `'clamp'`; `updateMissile` → `'kill'`.
- `updateMissile(m, targets, dt, world)`: same as now, but `targets` may include bosses (same fields).

**Bullets:** `createBullet(x, y, angle, stats, inheritVx = 0, inheritVy = 0, opts = {})`;
`opts = { damage, pierce, speed, life, radius, color, kind }` override the stats-derived values.
`kind`: `'bullet'` (default), `'lance'` (long cyan-white streak, Prism), `'rail'` (thick white-gold
beam streak, radius 5), `'frost'` (short ice-blue `#9fe8ff` streak), `'drone'` (small magenta dot).
`drawBullets` draws each kind distinctly (batch per kind).

**Rock kinds:** `createAsteroid(x, y, size, speedMul = 1, vx, vy, kind = 'rock')` adds `kind` and
`life` (Infinity, except shards) and `transient` (false; game api may override).
- `'rock'`: as today.
- `'crystal'`: icy look (fill `#10283a`, stroke `#9fe8ff`, inner facet lines); `splitAsteroid`
  returns **3** crystal children instead of 2.
- `'shard'`: always size 1, radius 9, hp 1, `life = 5` s (dies when it runs out), no split, 0 score,
  0 gems, `transient = true`; drawn as a sharp white-cyan diamond.
- `'comet'`: size 2 radius 22, hp 3, orange/red `#ff7a3d` head with a short fiery tail along its
  velocity; in `updateAsteroid`, if `ship` is given and alive, steers toward the ship at 0.9 rad/s
  keeping its speed (min 120 px/s); no split; score 150, gems 2.
- `ASTEROID_SIZES` unchanged; export `rockRewards(a)` → `{ score, gems }` for any kind
  (shard 0/0, comet 150/2, otherwise ASTEROID_SIZES[size]).
- `splitAsteroid(a, speedMul)` keeps the parent's kind (crystal→crystal), none for shard/comet.

**Background & border (camera-aware):**
- `createStars(view, count = 160)` → stars in screen space `{ x, y, z, tw }`.
- `drawStars(ctx, stars, view, cam, time)` → screen space; parallax: offset = `-cam * z * 0.25`, wrapped mod view.
- `drawWorldBorder(ctx, world, color, time)` → world space; glowing rounded rect at the arena edge
  (2 px line, gentle pulse, dashed corner brackets), colour = sector accent.

## overlay.js (S) — new, screen space

```js
export function drawThreatArrows(ctx, game)
// For live asteroids and bosses whose circle is fully off-screen and within 900 world px of the ship:
// draw a small chevron on the screen edge (inset 18 px; avoid the top 64 px HUD band), pointing at it.
// Size by rock size (bosses biggest, with a pulsing gold ring). Red `#ff4d6d` if it is approaching
// (velocity · (ship - rock) > 0) and within 450 px; otherwise translucent lilac. At most 14 arrows (nearest first).
export function drawRadar(ctx, game)
// Rounded-square radar, 92×92 CSS px (scaled to the arena aspect), top-right at (view.w - 104, 70).
// Translucent dark panel + accent border; the visible-camera rectangle outline; rocks as lilac dots
// (comets orange, crystals ice-blue, shards skipped), bosses as a pulsing gold dot, ship as a cyan dot.
```
Both receive the whole game object (use game.view, cam, zoom, world, ship, asteroids, bosses,
sector?.accent). Allocation-light.

---

## upgrades.js (P) — extend

`baseStats()` keeps all v1 fields and adds:
```js
chainChance: 0, chainTargets: 0, chainRange: 170,
bombs: 0, bombInterval: 6, bombRadius: 170, bombDamage: 1, bombDuration: 2,
frostShards: 0,
drones: 0, droneFireRate: 1.6, droneDamage: 1, droneRange: 360,
evoPrism: false, evoRail: false, evoTempest: false, evoCluster: false,
evoSingularity: false, evoBlackstar: false, evoAegis: false, evoHive: false,
```
Every def gains `kind: 'weapon' | 'passive' | 'evolution' | 'overflow'` (weapons: orbit, missiles,
nova, rear, chain, gravbomb, frost, drone; overflow: overcharge; evolutions below; the rest passive).
Evolutions also get `requires: [baseId, partnerId]`.

New upgrades:

| id | name | icon | rarity | max | per level |
|---|---|---|---|---|---|
| chain | Arc Coil | 🌩️ | epic | 4 | lv1: chainChance 0.25, chainTargets 2; then +0.1 chance, +1 target |
| gravbomb | Gravity Bomb | ⚫ | epic | 3 | bombs +1 (level); lv2+: bombInterval ×0.85, bombRadius +15; lv3: bombDamage +1 |
| frost | Frost Shards | ❄️ | rare | 3 | lv1: frostShards 2; then +1 |
| drone | Wingman Drone | 🛸 | epic | 3 | drones +1, droneFireRate +0.4; lv3: droneDamage +1 |
| overcharge | Overcharge | 🔋 | common | 99 | bulletDamage ×1.08, fireRate ×1.05 (only offered as filler, see rollChoices) |

Evolutions (rarity `'legendary'`, maxLevel 1):

| id | name | icon | requires (base maxed, partner owned) | apply |
|---|---|---|---|---|
| prism | Prism Lance | 🔱 | multishot, pierce | evoPrism = true; pierce += 99; bulletLife ×1.3 |
| railstorm | Railstorm | ☄️ | rapid, damage | evoRail = true; fireRate ×1.4; bulletSpeed ×1.25 |
| tempest | Tempest | 🌪️ | chain, velocity | evoTempest = true; chainChance = 1; chainTargets += 2; chainRange += 60 |
| swarm | Cluster Swarm | 🎆 | missiles, nova | evoCluster = true; missileInterval ×0.7 |
| singularity | Singularity Blades | 🌌 | orbit, magnet | evoSingularity = true; orbitalRadius += 18; orbitalDamage ×2 |
| blackstar | Black Star | 🌑 | gravbomb, nova | evoBlackstar = true; bombDuration = 3.5 |
| aegis | Aegis Core | 🔰 | shield, hull | evoAegis = true; shieldRecharge ×0.4 |
| hivemind | Hivemind | 🐝 | drone, missiles | evoHive = true |

Descriptions (`desc(nextLevel)`) concrete and short (≤ 50 chars), e.g. Prism "Bullets become lances that pierce everything".

```js
export const MAX_SLOTS = 6
export function slotsUsed(levels)   // count of ids with level > 0 whose kind is weapon or passive
export function rollChoices(levels, n = 3, rng = Math.random, opts = {})
// opts = { pool: Set<string> | null (null = everything), maxSlots = MAX_SLOTS }
// 1. Evolution candidates: kind 'evolution', in pool, level 0, levels[requires[0]] >= its maxLevel,
//    levels[requires[1]] >= 1. If any exist, the FIRST returned card is one of them (random).
// 2. Normal candidates: kind weapon/passive, in pool, level < maxLevel, and (already owned OR
//    slotsUsed < maxSlots). Weighted sampling without replacement: common 60, rare 30, epic 12.
// 3. If still fewer than n cards, append 'overcharge' (if in pool and below max).
// Returns defs (distinct). Never empty while overcharge is available.
export function applyUpgrade(id, stats, levels, game)   // unchanged semantics (ignores picks above max)
export function getUpgrade(id), xpForLevel(level)       // unchanged
```

## sectors.js (P) — new

```js
export const SECTORS = [ { id, name, tagline, tier, waves /* number, Infinity for deep */, system,
  systemParams /* {} */, boss /* boss type id; deep: null */, bosses /* deep only: rotation list */,
  arena: { w, h }, bg /* canvas clear colour */, accent /* css colour */, rockKind /* default kind */,
  rewards: { upgrades: [...ids], evolutions: [...ids] }, next /* id of sector unlocked, or null */ }, ...]
// per the Sectors table. bg/accent: belt #070b1a/#4df3ff, storm #0b0820/#b8a9ff, gravity #06060f/#ff5ad1,
// ice #061420/#9fe8ff, ember #120806/#ff7a3d, deep #04040a/#ffd166.
// rockKind: ice 'crystal', others 'rock'. deep.bosses = ['mother','stormeye','horizon','glacier','phoenix'].
export const BASE_POOL = [...]          // the base pool ids listed above
export function getSector(id)
export function loadProgress()          // localStorage 'sb-progress-v2' → { cleared: {id: true}, best: {id: score}, unlockAll: false }
                                        // tolerant of missing/corrupt storage; `?unlockall=1` in location.search sets unlockAll
export function saveProgress(p)         // never throws
export function isSectorOpen(p, id)     // belt always; others when the sector whose `next` is id is cleared; unlockAll → all
export function cardPool(p)             // Set: BASE_POOL + rewards of cleared sectors (everything if unlockAll)
export function clearSector(p, id)      // marks cleared, saves; returns NEW unlocks [{ kind: 'upgrade'|'evolution'|'sector', id, name, icon }]
                                        // (empty array if it was already cleared). Sector icon '🪐'.
export function rerollsFor(p)           // 2 + number of cleared sectors, max 5
export function waveSpec(sector, n)     // → { large, medium, kind, speedMul }
// large = 2 + n + floor(tier/2); medium = max(0, n - 2) + (tier >= 3 ? 1 : 0);
// speedMul = 0.9 + 0.06*(n-1) + 0.07*(tier-1); kind = sector.rockKind, except deep: random of rock/crystal.
export function bossFor(sector, n)      // boss type for the boss at wave n: sector.boss, or deep's rotation[(n/5 - 1) % 5]
export function bossHpMul(sector, repeat) // (1 + 0.35*(tier-1)) * (1 + 0.6*repeat); repeat = how many bosses this run already beat
```
sectors.js may import from upgrades.js (same owner) for reward names/icons.

---

## systems.js (Q) — new

```js
export function createSystem(id, params, game)   // id: 'none'|'storm'|'gravity'|'ice'|'ember'|'chaos'
// returns {
//   id, name,
//   mods: { drag, thrustMul, turnMul, gemValueMul, visibility /* null or world-px radius */ },
//   update(game, dt), onWave?(game, n), onKill?(game, rock),
//   drawBack(ctx, game, time),   // world space, after border, before rocks
//   drawFront(ctx, game, time),  // world space, after ship & particles
//   drawScreen(ctx, game, time), // screen space, before overlay arrows/radar
// }
```
Systems act only through `game.api` and the game fields (never import game.js). Behaviour:
- **none** (belt): faint drifting dust motes in drawBack; mods all default.
- **storm**: every `max(2.5, 6 - 0.3*game.wave)` s create 1–3 strike zones (radius 70) at random points
  within 320 px of the ship (inside the arena). Telegraph 1.3 s: pulsing lilac circle + crackle,
  `sfx.warning()` once. Then strike: jagged lightning bolt from the top of the view + white flash ring;
  `api.hurtShip` if the ship is inside; `api.damageAsteroid(a, 3)` for rocks inside; `sfx.lightning()`;
  small shake. mods.gemValueMul = 1.5. drawBack: dark violet storm clouds slowly drifting + random flicker.
- **gravity**: well at the arena centre. Pull acceleration toward it with falloff
  `k * clamp(1 - d/1100, 0, 1)` where k = 150 (ship), 110 (rocks), 260 (gems). Core radius 44: rocks
  entering it are destroyed via api.damageAsteroid(a, 9999); the ship touching it: api.hurtShip + strong
  outward push. drawBack: rotating accretion disk (magenta/violet gradient rings + spiral streaks) and
  a black core with a bright rim.
- **ice**: mods.drag = 0.85 (slippery), turnMul 1.15. drawBack: soft icy shimmer streaks; drawFront:
  sparse slow snow. (Crystal rocks come from the sector's rockKind.)
- **ember**: mods.visibility = 330. drawScreen: darkness — fill the screen with `rgba(4,2,2,0.92)` except
  a soft radial hole (radius visibility*zoom, feathered 90 px) around the ship's screen position; gems and
  comets drawn again faintly on top so they glow through. Every `max(3, 7 - 0.4*wave)` s spawn a comet
  via `api.spawnAsteroid(edgeX, edgeY, 2, { kind: 'comet', transient: true, vx, vy })` aimed at the ship
  from a random arena edge. drawBack: smouldering ember particles.
- **chaos** (deep): delegates to a child system; every 3 waves (onWave) switches to a random different one
  of storm/gravity/ice/ember and calls `api.banner('HAZARD: ' + child.name)`. mods/draw/update proxy the child.

## bosses.js (Q) — new

```js
export function createBoss(type, game, hpMul = 1)   // spawns at the arena point farthest from the ship (≥ 420 px away)
export function updateBoss(boss, game, dt)          // movement + attacks via game.api; stays inside the arena (bounce)
export function drawBoss(ctx, boss, time)          // world space; big, distinct, readable; white flash while hitFlash > 0
export const BOSS_NAMES = { mother: 'The Mother Rock', stormeye: 'Storm Eye', horizon: 'Event Horizon',
                            glacier: 'Glacier King', phoenix: 'Ember Phoenix' }
// boss object: { id (>= 1e6), isBoss: true, type, name, x, y, vx, vy, radius, hp, maxHp, hitFlash, dead, t, phase, ... }
```
Contact damage is game.js's job (ship vs boss circle → api.hurtShip). Attacks spawn **shards**
(`api.spawnAsteroid(x, y, 1, { kind: 'shard', transient: true, vx, vy })`) or rocks. A boss under 50 % hp
**enrages** (faster, attacks more often) and announces it with `api.banner(name + ' ENRAGED')` once.
- **mother** (radius 92, hp 260): lumpy giant rock with glowing cracks; drifts toward the ship at 40 px/s;
  every 3.2 s births 2 medium rocks from its rim (3 when enraged, every 2.4 s).
- **stormeye** (radius 66, hp 300): crackling eye/orb; circles the ship at ~300 px; every 2.6 s fires a ring
  of 8 shards at 210 px/s; enraged: ring of 12 plus a telegraphed (1.2 s) lightning strike on the
  ship's position (draw it itself; damage via api.hurtShip if still inside radius 70).
- **horizon** (radius 78, hp 380): dark disc with a magenta photon ring; slowly orbits the arena centre;
  pulls the ship toward itself (accel 90); every 3 s fires a 4-arm rotating spiral burst of shards (6 per arm).
- **glacier** (radius 100, hp 450): faceted ice crown; bounces around at 90 px/s; every 2.8 s fires an
  aimed spread of 5 shards; enraged: also spawns 2 medium crystal rocks every 6 s.
- **phoenix** (radius 64, hp 520): fiery bird/wing shape; telegraphs a dash with a 0.9 s glowing line toward
  the ship, then dashes at 700 px/s for 0.6 s leaving 6 transient comets/shards in its wake; repeats every
  2.4 s (1.6 s enraged).
Boss hp = listed hp × hpMul. Movement speeds × 1.35 when enraged.

---

## weapons.js (R) — new

Owns all **secondary** weapons and evolution behaviours. game.js only runs the main gun (forward
volley + rear turret + Railstorm rail) and bullet collisions.

```js
export function resetWeapons(game)               // per run: game.weaponState = {...}, clear game.fx
export function updateWeapons(game, dt)          // only called while state === 'playing' and ship alive
export function drawWeapons(ctx, game, time)     // world space: missiles, orbitals, drones, bombs, arcs/fx
export function onBulletHit(game, bullet, target) // after game.js applied the bullet's damage
export function onKill(game, rock)               // a rock just died (called from api.damageAsteroid)
export function onShieldBreak(game)              // a shield charge was just consumed
```
Use `game.api` for all damage/spawns, `game.api.targets()` / `nearestTarget()` for targeting (bosses
included). Behaviours (read stats each frame, so upgrades apply immediately):
- **Missiles** (move from v1 game.js): if stats.missiles > 0, every missileInterval fire `missiles`
  missiles fanned ±0.5 rad from the nose (entities.createMissile), update with
  `updateMissile(m, api.targets(), dt, world)`, collide with targets (circle), damage `m.damage`, small
  orange ring. **evoCluster**: on hit, also damage every target within 70 px by 2 + ring. First pick
  starts the cooldown (no instant salvo): track the last seen level in weaponState.
- **Nova** (move from v1): novaLevel > 0 → every novaInterval damage targets within novaRadius by
  novaDamage, push rocks outward, magenta ring, sfx.nova.
- **Orbitals** (move from v1): entities.orbitalPositions; per-target cooldown 0.35 s (store on the
  target as `orbitCd`, bosses too). **evoSingularity**: rocks (not bosses) within 150 px of the ship are
  pulled toward the blade ring (accel 120); blades drawn larger with a violet halo.
- **Chain (Arc Coil)**: in onBulletHit, with probability chainChance, arc to up to chainTargets other
  targets within chainRange of the hit point (nearest first, each new hop from the previous target),
  each taking bullet.damage. Draw jagged arcs for 0.15 s in fx; sfx.lightning (rate-limited by audio).
- **Gravity Bomb**: bombs > 0 → every bombInterval drop a bomb 180 px ahead of the ship; for bombDuration
  it pulls rocks within bombRadius (accel 160; ×2 with evoBlackstar) and deals bombDamage to each target
  inside every 0.25 s. Drawn as a black sphere with a swirling ring. **evoBlackstar**: at the end it
  detonates: damage 6 to targets within bombRadius + 40, big ring, shake.
- **Frost Shards**: in onKill, if frostShards > 0, fire that many `api.fireBullet` with
  `{ kind: 'frost', damage: stats.bulletDamage, speed: 420, life: 0.55, pierce: 0 }` in evenly spaced
  random-offset directions from the rock's position.
- **Drones**: `drones` drones hover behind/around the ship (offset circle radius 56, smoothly following),
  each firing at the nearest target within droneRange at droneFireRate with
  `api.fireBullet(..., { kind: 'drone', damage: stats.droneDamage, speed: 520, life: 0.8 })`.
  **evoHive**: each drone also launches one missile every 2.5 s.
- **evoAegis**: in onShieldBreak, nova blast radius 170, damage 4, gold ring, sfx.nova.
- (Prism and Railstorm are bullet properties handled by game.js's main gun.)

---

## index.html / style.css / ui.js (T) — extend

Keep all v1 ids. Add DOM:
```
#hud: add  span#hud-sector (small accent-coloured sector name above/beside the wave text)
div#boss-bar (hidden): span#boss-name + div#boss-hp > div#boss-hp-fill   (top-centre under the HUD, gold/red)
section#map-screen: h2 "STAR MAP", div#map-sectors (cards rendered by ui.js), button#map-back-btn "BACK"
section#victory-screen: h2 "SECTOR CLEARED", div#victory-stats, div#victory-unlocks,
        button#continue-btn "KEEP GOING (ENDLESS)", button#victory-map-btn "STAR MAP"
#upgrade-screen: add  div#upgrade-meta  (slots "UPGRADES 4/6" on the left, button#reroll-btn "⟳ REROLL (2)" on the right)
#gameover-screen: add  button#gameover-map-btn "STAR MAP" (under PLAY AGAIN, ghost style)
div#sector-intro (hidden): big two-line intro (sector name + tagline), fades in/out over ~2.6 s
```
**Star map look:** a vertical "route" of 6 sector cards joined by a glowing dotted line (the route), each
card tinted with its sector accent: number, name, tagline, boss name, reward preview chips (icons + names),
status badge — LOCKED (dim, 🔒, not clickable), NEW (pulsing), CLEARED ✓ with best score. Must fit a 390 px
phone (scrolls vertically if needed); 2 columns not required.

**Evolution cards:** rarity `legendary` → gold `#ffd166` border, animated shimmer, label "EVOLUTION",
desc + a small "requires X + Y" line (choices may carry `requires: [nameA, nameB]`). Overcharge cards
show "Lv n" as normal.

```js
// existing exports keep working; new/changed:
export function initUI(handlers)
//   handlers += { onMapOpen() /* PLAY on title */, onMapBack(), onSelectSector(id), onContinue(),
//                 onVictoryMap(), onGameOverMap(), onReroll() }
//   (onStart is no longer used by PLAY: PLAY calls onMapOpen. onRestart = PLAY AGAIN = retry same sector.)
export function showScreen(name)
//   names += 'map' | 'victory'. HUD visible for playing/upgrade/pause. Boss bar keeps its own visibility.
export function showMap(sectors)
//   sectors: [{ id, index, name, tagline, bossName, accent, status: 'locked'|'open'|'new'|'cleared',
//              best, rewards: [{ icon, name }] }]  → renders #map-sectors and shows 'map'.
//   Tapping an open/new/cleared card calls handlers.onSelectSector(id) (guard double taps).
export function updateHUD(h)       // h += { sector: string }
export function showUpgradeChoices(choices, onPick, meta = {})
//   choice += { requires?: [nameA, nameB] }; rarity may be 'legendary'.
//   meta = { rerolls: number, slotsUsed: number, slotsMax: number }. #reroll-btn shows the count, is
//   disabled at 0, and calls handlers.onReroll() (game.js then calls showUpgradeChoices again).
//   The 250 ms tap guard applies to cards, not the reroll button.
export function showVictory(v)
//   v = { sectorName, bossName, score, wave, level, unlocks: [{ kind, icon, name }] } → 'victory' screen.
//   Unlocks rendered as chips labelled NEW (kind 'sector' → "New sector: <name>"); "Already cleared" text if empty.
export function showBossBar(name), updateBossBar(frac /* 0..1 */), hideBossBar()
export function showSectorIntro(name, tagline, accent)
```

## audio.js (T) — extend

Add to `sfx` (same safety rules: silent before unlock/while muted, never throw):
`bossSpawn()` (deep rising rumble + horn), `bossHit()` (rate-limited ≤ 10/s, dull clank),
`bossDie()` (long explosion + sparkle), `victory()` (short bright fanfare, 4–5 notes),
`lightning()` (rate-limited ≤ 6/s, noise crack), `warning()` (two soft beeps), `evolve()` (shimmering
rising arpeggio), `reroll()` (quick whoosh), `enrage()` (low growl).

---

## game.js + main.js (U) — rewrite game.js, extend main.js

Implements the game object + api above, the run flow, camera, collisions, rendering and debug hooks,
importing entities, overlay, upgrades, sectors, systems, bosses, weapons. Rules:
- **Boot**: state 'title', title backdrop = drifting rocks in a view-sized world (cam 0, zoom 1), stars.
- **PLAY** → state 'map', `ui.showMap(...)` built from SECTORS + progress (status 'new' = open and never
  cleared and no best score). Back → title.
- **startRun(sectorId)**: reset stats/levels/arrays/score/xp/level, `rerolls = rerollsFor(progress)`,
  world from sector arena, ship at arena centre (gravity sector: centre + 300 px down), camera snapped to
  ship, `system = createSystem(...)`, `resetWeapons(game)`, phase 'waves' (deep: 'endless'),
  `ui.showSectorIntro`, then wave 1 after 1.2 s.
- **Waves**: `waveSpec(sector, n)`: spawn rocks at random arena-edge positions (inset by radius) at least
  420 px from the ship and preferably outside the visible area, heading roughly toward the arena centre
  ±0.6 rad. Banner "WAVE n". A wave is clear when no non-transient rock remains → +100×n score, 1.5 s
  later next wave. After the last wave of a sector (n === sector.waves) comes the **boss wave**: phase
  'boss', banner "WARNING", `sfx.bossSpawn()`, `createBoss(bossFor(...), game, bossHpMul(...))`,
  `ui.showBossBar`, plus `1 + floor(tier/2)` large escort rocks. In endless phase a boss comes every 5th wave.
- **Boss defeated**: big burst/rings/shake, `sfx.bossDie()`, score += 5000 × tier, 20 gems, remaining
  transient rocks die. First boss of a sector run in phase 'boss' → `clearSector(progress, id)` → after
  1.5 s state 'victory', `sfx.victory()`, `ui.showVictory(...)`. **Continue** → phase 'endless', next wave.
  **Map** → map. Endless bosses just grant score and continue.
- **Camera**: target = ship − visible/2; `cam += (target − cam) * (1 − 0.0005^dt)`; clamp to the arena
  (centre if the arena is smaller than the view on an axis).
- **Main gun** (v1 logic): volleys of `multishot` fanned 0.16 rad + `rearGun` backward. Bullets get
  `kind 'lance'` when evoPrism. **evoRail**: every 5th volley also fires a rail
  (`{ kind: 'rail', damage: bulletDamage*5, pierce: 99, radius: 5, speed: bulletSpeed*1.4 }`).
- **Collisions** (circle): bullets ↔ targets (asteroids + bosses; hitIds/pierce as v1; then
  `weapons.onBulletHit`), ship ↔ rocks and ship ↔ bosses (api.hurtShip; rocks bounce away; bosses knock
  the ship back hard), gems ↔ ship (xp += value × xpGain × (system.mods.gemValueMul || 1)).
  Missiles/orbitals/bombs/drones/nova are weapons.js's job.
- **Level-ups** as v1, but cards from `rollChoices(levels, 3, Math.random, { pool: cardPool(progress) })`
  mapped to `{ id, name, icon, rarity, level, maxLevel, desc, requires }` (requires = names of the
  evolution's two parts), meta `{ rerolls, slotsUsed: slotsUsed(levels), slotsMax: MAX_SLOTS }`.
  Picking an evolution: `sfx.evolve()`, banner "EVOLVED: <name>". Reroll: if rerolls > 0, rerolls--,
  `sfx.reroll()`, re-roll and re-show. Only open upgrades while the ship is alive.
- **Ship mods**: `updateShip(ship, input, stats, dt, world, system.mods)`.
- **Death** as v1 (1.4 s later state 'over'); best per sector in progress.best (saveProgress);
  game over shows PLAY AGAIN (same sector) and STAR MAP.
- **Render order**: clear with sector.bg (title/map: `#070b1a`) → drawStars (screen) → camera transform
  (+shake) → system.drawBack → drawWorldBorder → gems → rocks → bosses → bullets → drawWeapons → ship →
  particles → system.drawFront → screen transform → system.drawScreen → drawThreatArrows → drawRadar →
  hurt flash. HUD/boss bar updated every frame (cheap).
- **Pause/visibility/resize** as v1 (resize recomputes view, zoom, stars; keeps the arena unless smaller
  than the visible area). `input.pausePressed` toggles pause.
- **Debug hooks** `game.debug`: `levelUp()`, `killShip()`, `clearWave()` (kills all rocks without gems),
  `grant(id, times = 1)`, `setInvincible(bool)` (as v1) and NEW `startSector(id)` (start a run there even if
  locked), `skipToBoss()` (clear rocks, jump straight to the boss wave), `killBoss()` (damage the live
  boss by its hp through api.damageBoss), `unlockAll()` (progress.unlockAll = true, save),
  `resetProgress()`. `window.__game = game` (main.js).
- main.js wires the new ui handlers.

## tools (V) — rewrite smoke.ts and showcase.ts

Same Chromium launch/console-error rules as v1 (read the current files first and keep their helpers,
e.g. settlePlaying). Use a fresh browser context per run (clean localStorage).
**smoke.ts** steps (phone 390×844 unless noted), screenshots `tools/out/NN-name.png`:
01 title visible → 02 PLAY → #map-screen visible; belt card open; storm card locked → 03 tap belt card →
state 'playing', #hud-sector says "Asteroid Belt", setInvincible(true) → 04 joystick drag: ship moves and
`game.cam` changes → 05 levelUp → cards → (if #reroll-btn enabled: tap it, rerolls decreases, cards
re-render) → pick → playing → 06 clearWave → wave 2 → 07 P pauses / resume → 08 skipToBoss → #boss-bar
visible, bosses.length === 1 → 09 killBoss → #victory-screen visible with ≥ 1 unlock chip → 10
#victory-map-btn → map: storm card now open → 11 start storm, killShip → #gameover-screen; tap
#gameover-map-btn → map → 12 desktop 1280×800: start belt, playing. Exit 1 on any failure or console error.
**showcase.ts**: (a) for each sector: fresh page with `?unlockall=1`, `debug.startSector(id)`,
setInvincible, gentle joystick, 4 s → `sector-<id>.png`, then `skipToBoss()`, 4 s → `boss-<id>.png`
(for deep, boss shot after skipToBoss as well), FPS printed (FAIL < 20). (b) evolutions: in belt with
unlockAll, for each evolution grant base to max + partner 1 + the evolution, 3 s → `evo-<id>.png`.
(c) balance probe (informational): bot plays belt for up to 180 s (as v1 bot: face nearest target, keep
> 140 px away, take the first card or an evolution card if present) and reports wave/level/time-to-boss/
victory or death. Print a summary table.
