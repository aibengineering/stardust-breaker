// Stardust Breaker v2: the game object, run flow, camera, collisions, rendering and debug hooks.
// Systems, bosses, weapons and overlays reach the game only through game.api (BRIEF.md).
import {
  createShip, updateShip, drawShip,
  createBullet, updateBullet, drawBullets,
  ASTEROID_SIZES, createAsteroid, rockRewards, splitAsteroid, updateAsteroid, drawAsteroid,
  createGem, updateGem, drawGems,
  burst, ring, updateParticles, drawParticles,
  createStars, drawStars, drawWorldBorder, bounds, dist2,
} from './entities.js';
import {
  baseStats, rollChoices, applyUpgrade, getUpgrade, xpForLevel, slotsUsed, MAX_SLOTS,
} from './upgrades.js';
import {
  SECTORS, getSector, loadProgress, saveProgress, isSectorOpen, cardPool,
  clearSector, rerollsFor, waveSpec, bossFor, bossHpMul,
} from './sectors.js';
import { createSystem } from './systems.js';
import { BOSS_NAMES, createBoss, updateBoss, drawBoss } from './bosses.js';
import * as weapons from './weapons.js';
import { drawThreatArrows, drawRadar } from './overlay.js';

const BG = '#070b1a';
const CYAN = '#4df3ff';
const HURT = '#ff4d6d';
const SHIELD = '#6db8ff';
const GOLD = '#ffd166';
const MAGENTA = '#ff5ad1';
const ROCK_STROKE = '#b9a7ff';
const YELLOW = '#ffe66d';

const MAX_GEMS = 300;
const DT_MAX = 0.05;
const DPR_CAP = 2;
const DPR_CAP_LARGE = 1.5; // large desktop windows: keep the backing store affordable
const LARGE_VIEW_PX = 1000000; // CSS px² above which DPR_CAP_LARGE applies
const SPAWN_MIN_DIST = 420;
const SPAWN_AIM = 0.5; // spawned rocks head toward the ship within ±SPAWN_AIM rad
const SPAWN_TRIES = 12;
const DEATH_DELAY = 1.4;
const CLEAR_DELAY = 1.5;
const INTRO_DELAY = 2.7; // wave 1 (and its banner) waits for the sector intro, which hides at 2.6 s
const VICTORY_DELAY = 1.5;
const GEM_REACH = 10;
const UPGRADE_INVULN = 0.6;
const SHAKE_TIME = 0.3;
const SHAKE_PX = 8;
const HURT_TIME = 0.25;
const TITLE_ROCKS = 6;
const ROCK_PUSH = 120;
const SHIP_KNOCK = 260;
const BOSS_PUSH = 420;
const BOSS_REACH = 0.9;
const RAIL_EVERY = 5;
const RAIL_SPEED = 1.4;
const ENDLESS_BOSS_EVERY = 5;
const BOSS_GEMS = 20;
const BOSS_SCORE = 5000;
const CAM_RATE = 0.0005;
const CARDS = 3;
const CULL_PAD = 80; // world units of margin past the view edge before an asteroid is skipped by render

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Debug FPS overlay: only when the URL contains fps=1. Never throws.
function readFpsFlag() {
  try {
    return String(location.search).includes('fps=1');
  } catch {
    return false;
  }
}
const FPS_WINDOW = 0.5; // seconds over which the FPS counter is averaged

// In-place compaction: keeps live items, no splice inside loops.
function compact(arr) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o.dead) arr[w++] = o;
  }
  arr.length = w;
}

function clampZoom(view) {
  return clamp(Math.min(view.w, view.h) / 480, 0.75, 1);
}

export function createGame({ canvas, ui, input, sfx }) {
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0 };
  const world = { w: 0, h: 0 };
  const cam = { x: 0, y: 0 };
  const stats = baseStats();
  const levels = {};
  const progress = loadProgress();

  let dpr = 1;
  let clock = 0; // real seconds; drives visuals even while the game is frozen
  let lastFrame = null;
  const showFps = readFpsFlag();
  let fpsAcc = 0; // real seconds accumulated in the current FPS window
  let fpsFrames = 0;
  let fpsValue = 0;
  let errorReported = false;
  let invincible = false; // debug only: the ship ignores all damage
  let pendingLevelUps = 0;
  let deathTimer = 0;
  let countdown = null; // seconds until `queued` starts; null when not counting
  let queued = null; // { n, boss, main } the next wave to start
  let pendingVictory = false;
  let victoryTimer = 0;
  let victoryUnlocks = [];
  let lastBossName = '';
  let shakeLeft = 0;
  let shakeSpan = SHAKE_TIME;
  let shakeAmp = 0;
  let hurtTimer = 0;
  let speedMul = 1; // wave speed multiplier, used for splits and spawns
  let bossBarId = null;
  let volleys = 0;
  let runSectorId = null;

  const game = {
    state: 'title',
    view,
    zoom: 1,
    world,
    cam,
    sector: null,
    phase: 'waves',
    system: null,
    ship: null,
    stats,
    levels,
    asteroids: [],
    bosses: [],
    bullets: [],
    gems: [],
    missiles: [],
    particles: [],
    stars: [],
    fx: [],
    weaponState: {},
    score: 0,
    wave: 0,
    level: 1,
    xp: 0,
    time: 0,
    progress,
    rerolls: 0,
    api: null,
    debug: null,
  };

  // ---------- geometry and camera ----------

  function isMenu() {
    return game.state === 'title' || game.state === 'map';
  }

  // Menus: world = view, zoom 1, cam 0. Runs: zoom from the view, arena at least 1.2 visible sizes.
  function applyGeometry() {
    if (isMenu() || !game.sector) {
      game.zoom = 1;
      world.w = view.w;
      world.h = view.h;
      cam.x = 0;
      cam.y = 0;
      return;
    }
    game.zoom = clampZoom(view);
    const arena = game.sector.arena;
    world.w = Math.max(arena.w, Math.ceil((view.w / game.zoom) * 1.2));
    world.h = Math.max(arena.h, Math.ceil((view.h / game.zoom) * 1.2));
  }

  function resize() {
    const changed = view.w !== window.innerWidth || view.h !== window.innerHeight;
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    const cap = view.w * view.h > LARGE_VIEW_PX ? DPR_CAP_LARGE : DPR_CAP;
    dpr = Math.min(globalThis.devicePixelRatio || 1, cap);
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    // stars were scattered over the old size; regenerate so they cover the new one
    if (changed) game.stars = createStars(view);
    applyGeometry();
    if (game.ship) bounds(game.ship, world, 'clamp');
    if (!isMenu()) updateCamera(0, true);
  }

  // Target = ship centred; eased toward it, then clamped to the arena.
  function updateCamera(dt, snap) {
    const s = game.ship;
    if (!s) return;
    const vw = view.w / game.zoom;
    const vh = view.h / game.zoom;
    const maxX = Math.max(0, world.w - vw);
    const maxY = Math.max(0, world.h - vh);
    const tx = clamp(s.x - vw / 2, 0, maxX);
    const ty = clamp(s.y - vh / 2, 0, maxY);
    if (snap) {
      cam.x = tx;
      cam.y = ty;
      return;
    }
    const k = 1 - Math.pow(CAM_RATE, dt);
    cam.x = clamp(cam.x + (tx - cam.x) * k, 0, maxX);
    cam.y = clamp(cam.y + (ty - cam.y) * k, 0, maxY);
  }

  function resetStick() {
    input.cancel?.();
    input.stick.active = false;
    input.stick.x = 0;
    input.stick.y = 0;
  }

  function shake(seconds, px) {
    if (seconds > shakeLeft) {
      shakeLeft = seconds;
      shakeSpan = seconds;
    }
    if (px > shakeAmp) shakeAmp = px;
  }

  // ---------- drifting rocks for the title and map backdrops ----------

  function spawnMenuField() {
    game.asteroids = [];
    for (let i = 0; i < TITLE_ROCKS; i++) {
      const size = i % 2 === 0 ? 3 : 2;
      game.asteroids.push(createAsteroid(rand(0, world.w), rand(0, world.h), size, 0.5));
    }
  }

  // ---------- api: damage, targets, ship ----------

  function addGem(x, y, value = 1) {
    const gems = game.gems;
    if (gems.length >= MAX_GEMS) {
      // full: merge into the newest live gem so value is never lost
      for (let i = gems.length - 1; i >= 0; i--) {
        if (!gems[i].dead) {
          gems[i].value += value;
          return;
        }
      }
      return;
    }
    gems.push(createGem(x, y, value));
  }

  function damageAsteroid(a, dmg) {
    if (!a || a.dead) return;
    a.hp -= dmg;
    a.hitFlash = 0.08;
    sfx.hit();
    if (a.hp > 0) return;
    a.dead = true;
    const reward = rockRewards(a);
    game.score += reward.score;
    for (let i = 0; i < reward.gems; i++) addGem(a.x + rand(-6, 6), a.y + rand(-6, 6), 1);
    burst(game.particles, a.x, a.y, ROCK_STROKE, 12, 160);
    sfx.explode(a.size);
    for (const c of splitAsteroid(a, speedMul)) game.asteroids.push(c);
    weapons.onKill(game, a);
    game.system?.onKill?.(game, a);
  }

  function defeatBoss(b) {
    const tier = game.sector ? game.sector.tier : 1;
    game.score += BOSS_SCORE * tier;
    for (let i = 0; i < BOSS_GEMS; i++) addGem(b.x + rand(-30, 30), b.y + rand(-30, 30), 1);
    burst(game.particles, b.x, b.y, GOLD, 60, 320);
    burst(game.particles, b.x, b.y, MAGENTA, 30, 220);
    ring(game.particles, b.x, b.y, b.radius * 3, GOLD, 0.8);
    ring(game.particles, b.x, b.y, b.radius * 2, MAGENTA, 0.6);
    shake(0.6, 14);
    sfx.bossDie();
    // remaining transient rocks (shards, comets) go with the boss; escorts still count
    for (const a of game.asteroids) if (a.transient) a.dead = true;
    if (b.isMain && game.sector && game.phase === 'boss') {
      lastBossName = b.name;
      victoryUnlocks = clearSector(progress, game.sector.id);
      pendingVictory = true;
      victoryTimer = VICTORY_DELAY;
      countdown = null;
      queued = null;
    }
  }

  function damageBoss(b, dmg) {
    if (!b || b.dead) return;
    b.hp -= dmg;
    b.hitFlash = 0.1;
    sfx.bossHit();
    burst(game.particles, b.x, b.y, YELLOW, 8, 140);
    if (b.hp > 0) return;
    b.hp = 0;
    b.dead = true;
    defeatBoss(b);
  }

  function damageTarget(t, dmg) {
    if (!t) return;
    if (t.isBoss) damageBoss(t, dmg);
    else damageAsteroid(t, dmg);
  }

  // Live rocks and bosses. A fresh array every call, so callers may keep it.
  function targets() {
    const out = [];
    for (const a of game.asteroids) if (!a.dead) out.push(a);
    for (const b of game.bosses) if (!b.dead) out.push(b);
    return out;
  }

  function nearestTarget(x, y, maxDist = Infinity) {
    let best = null;
    let bestD2 = maxDist * maxDist;
    for (const t of targets()) {
      const d2 = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = t;
      }
    }
    return best;
  }

  // Standard hit on the ship. Returns true when the hit landed.
  function hurtShip(fromX, fromY) {
    const s = game.ship;
    if (!s || !s.alive || s.invuln > 0 || invincible) return false;
    const dx = s.x - fromX;
    const dy = s.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    s.vx += (dx / d) * SHIP_KNOCK;
    s.vy += (dy / d) * SHIP_KNOCK;
    if (s.shield > 0) {
      s.shield -= 1;
      s.shieldTimer = 0;
      s.invuln = 1.0;
      sfx.shieldHit();
      ring(game.particles, s.x, s.y, s.radius + 40, SHIELD, 0.4);
      if (s.shield <= 0) weapons.onShieldBreak(game);
      return true;
    }
    s.hull -= 1;
    s.invuln = 2.0;
    sfx.hurt();
    shake(SHAKE_TIME, SHAKE_PX);
    hurtTimer = HURT_TIME;
    burst(game.particles, s.x, s.y, HURT, 14, 180);
    if (s.hull <= 0) destroyShip();
    return true;
  }

  function spawnAsteroid(x, y, size, opts = {}) {
    const a = createAsteroid(x, y, size, opts.speedMul ?? 1, opts.vx, opts.vy, opts.kind || 'rock');
    if (opts.transient) a.transient = true;
    game.asteroids.push(a);
    return a;
  }

  function fireBullet(x, y, angle, opts = {}) {
    const b = createBullet(x, y, angle, stats, opts.inheritVx || 0, opts.inheritVy || 0, opts);
    game.bullets.push(b);
    return b;
  }

  function destroyShip() {
    const s = game.ship;
    s.alive = false;
    s.hull = 0;
    s.invuln = 0;
    s.thrusting = false;
    burst(game.particles, s.x, s.y, CYAN, 40, 260);
    ring(game.particles, s.x, s.y, 110, HURT, 0.6);
    sfx.gameOver();
    deathTimer = DEATH_DELAY;
  }

  game.api = {
    damageAsteroid,
    damageBoss,
    damageTarget,
    targets,
    nearestTarget,
    hurtShip,
    spawnAsteroid,
    addGem,
    burst: (x, y, color, count, speed) => burst(game.particles, x, y, color, count, speed),
    ring: (x, y, radius, color, duration) => ring(game.particles, x, y, radius, color, duration),
    shake,
    banner: (text, ms) => ui.showBanner(text, ms),
    fireBullet,
    sfx,
  };

  // ---------- waves, boss waves, victory ----------

  function bestFor(id) {
    return progress.best[id] || 0;
  }

  function bestOverall() {
    let best = 0;
    for (const v of Object.values(progress.best)) if (v > best) best = v;
    return best;
  }

  // Keeps the best score per sector. Returns true when this run set a new best.
  function recordBest() {
    const s = game.sector;
    if (!s) return false;
    const isNew = game.score > 0 && game.score > bestFor(s.id);
    if (isNew) progress.best[s.id] = Math.floor(game.score);
    saveProgress(progress);
    return isNew;
  }

  function hideBoss() {
    bossBarId = null;
    ui.hideBossBar();
  }

  // Random point on the arena edge, inset by `radius`. Prefers off-screen spots at least
  // SPAWN_MIN_DIST from the ship.
  function edgeSpawn(radius) {
    const s = game.ship;
    const vw = view.w / game.zoom;
    const vh = view.h / game.zoom;
    let x = radius;
    let y = radius;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { x = rand(radius, world.w - radius); y = radius; }
      else if (side === 1) { x = rand(radius, world.w - radius); y = world.h - radius; }
      else if (side === 2) { x = radius; y = rand(radius, world.h - radius); }
      else { x = world.w - radius; y = rand(radius, world.h - radius); }
      const far = !s || dist2({ x, y }, s) >= SPAWN_MIN_DIST * SPAWN_MIN_DIST;
      const offscreen = x < cam.x || x > cam.x + vw || y < cam.y || y > cam.y + vh;
      if (far && offscreen) break;
    }
    return { x, y };
  }

  // Rock drifting from the edge toward the ship (+/- SPAWN_AIM rad); the arena centre if no ship.
  function spawnEdgeRock(size, kind) {
    const p = edgeSpawn(ASTEROID_SIZES[size].radius);
    const s = game.ship;
    const tx = s ? s.x : world.w / 2;
    const ty = s ? s.y : world.h / 2;
    const dir = Math.atan2(ty - p.y, tx - p.x) + rand(-SPAWN_AIM, SPAWN_AIM);
    const sp = rand(35, 85) * speedMul;
    return createAsteroid(p.x, p.y, size, speedMul, Math.cos(dir) * sp, Math.sin(dir) * sp, kind);
  }

  function spawnWave(n) {
    const spec = waveSpec(game.sector, n);
    speedMul = spec.speedMul;
    game.wave = n;
    countdown = null;
    for (let i = 0; i < spec.large; i++) game.asteroids.push(spawnEdgeRock(3, spec.kind));
    for (let i = 0; i < spec.medium; i++) game.asteroids.push(spawnEdgeRock(2, spec.kind));
    ui.showBanner(`WAVE ${n}`);
    sfx.wave();
    game.system?.onWave?.(game, n);
  }

  // Boss wave: the sector's main boss (main = true, ends the sector) or an endless boss.
  function spawnBossWave(n, main) {
    const sector = game.sector;
    const spec = waveSpec(sector, n);
    speedMul = spec.speedMul;
    game.wave = n;
    countdown = null;
    if (main) game.phase = 'boss';
    const repeat = main ? 0 : Math.max(0, Math.floor(n / ENDLESS_BOSS_EVERY) - 1);
    const boss = createBoss(bossFor(sector, n), game, bossHpMul(sector, repeat));
    boss.isMain = main;
    game.bosses.push(boss);
    const escorts = 1 + Math.floor(sector.tier / 2);
    for (let i = 0; i < escorts; i++) game.asteroids.push(spawnEdgeRock(3, spec.kind));
    ui.showBanner('WARNING', 2000);
    sfx.bossSpawn();
    game.system?.onWave?.(game, n);
  }

  // What wave n should be: a regular wave, an endless boss (every 5th) or the sector's main boss.
  function planNext(n) {
    const sector = game.sector;
    if (game.phase === 'waves' && n > sector.waves) return { n, boss: true, main: true };
    if (game.phase === 'endless' && n % ENDLESS_BOSS_EVERY === 0) return { n, boss: true, main: false };
    return { n, boss: false, main: false };
  }

  // A wave clears when no solid rock and no live boss remains (transient rocks don't count).
  function waveCleared() {
    for (const a of game.asteroids) if (!a.dead && !a.transient) return false;
    for (const b of game.bosses) if (!b.dead) return false;
    return true;
  }

  function updateWaves(dt) {
    if (pendingVictory) {
      victoryTimer -= dt;
      if (victoryTimer <= 0) enterVictory();
      return;
    }
    if (countdown !== null) {
      countdown -= dt;
      if (countdown <= 0 && queued) {
        const q = queued;
        queued = null;
        if (q.boss) spawnBossWave(q.n, q.main);
        else spawnWave(q.n);
      }
      return;
    }
    if (game.phase === 'boss' && game.bosses.length > 0) return;
    if (waveCleared()) {
      game.score += 100 * game.wave;
      queued = planNext(game.wave + 1);
      countdown = CLEAR_DELAY;
    }
  }

  function enterVictory() {
    pendingVictory = false;
    const sector = game.sector;
    recordBest();
    game.state = 'victory';
    resetStick();
    hideBoss();
    sfx.victory();
    ui.showVictory({
      sectorName: sector.name,
      score: Math.floor(game.score),
      wave: game.wave,
      level: game.level,
      bossName: lastBossName,
      unlocks: victoryUnlocks,
    });
  }

  // ---------- run flow ----------

  // Menus and resets: no ship, no hazards, no boss, empty run arrays.
  function clearRun() {
    game.ship = createShip(view.w / 2, view.h / 2, stats);
    game.ship.alive = false;
    game.asteroids = [];
    game.bosses = [];
    game.bullets = [];
    game.gems = [];
    game.missiles = [];
    game.particles = [];
    countdown = null;
    queued = null;
    pendingVictory = false;
    pendingLevelUps = 0;
    deathTimer = 0;
    hurtTimer = 0;
    shakeLeft = 0;
    shakeAmp = 0;
    hideBoss();
  }

  function buildMapCards() {
    return SECTORS.map((s, i) => {
      const open = isSectorOpen(progress, s.id);
      const cleared = !!progress.cleared[s.id];
      const best = bestFor(s.id);
      let status = 'locked';
      if (open) status = cleared ? 'cleared' : best > 0 ? 'open' : 'new';
      const rewardIds = [...(s.rewards?.upgrades || []), ...(s.rewards?.evolutions || [])];
      const rewards = rewardIds
        .map((id) => getUpgrade(id))
        .filter(Boolean)
        .map((d) => ({ icon: d.icon, name: d.name }));
      const bossKey = s.boss || (Array.isArray(s.bosses) ? s.bosses[0] : null);
      return {
        id: s.id,
        index: i + 1,
        name: s.name,
        tagline: s.tagline,
        accent: s.accent,
        status,
        best,
        bossName: BOSS_NAMES[bossKey] || '???',
        rewards,
      };
    });
  }

  function openMap() {
    game.state = 'map';
    game.sector = null;
    game.system = null;
    game.phase = 'waves';
    clearRun();
    resetStick();
    applyGeometry();
    spawnMenuField();
    ui.showMap(buildMapCards());
  }

  function toTitle() {
    game.state = 'title';
    game.sector = null;
    game.system = null;
    game.phase = 'waves';
    clearRun();
    resetStick();
    applyGeometry();
    spawnMenuField();
    ui.setBest(bestOverall());
    ui.showScreen('title');
  }

  // Starts a sector run from wave 1 (after a short intro). Returns false for unknown ids.
  function startRun(id) {
    const sector = getSector(id);
    if (!sector) return false;
    runSectorId = id;
    Object.assign(stats, baseStats());
    for (const k of Object.keys(levels)) delete levels[k];
    game.sector = sector;
    game.phase = sector.waves === Infinity ? 'endless' : 'waves';
    game.state = 'playing';
    game.score = 0;
    game.wave = 0;
    game.level = 1;
    game.xp = 0;
    game.time = 0;
    game.rerolls = rerollsFor(progress);
    pendingLevelUps = 0;
    deathTimer = 0;
    hurtTimer = 0;
    shakeLeft = 0;
    shakeAmp = 0;
    pendingVictory = false;
    victoryTimer = 0;
    victoryUnlocks = [];
    lastBossName = '';
    volleys = 0;
    speedMul = 1;
    invincible = false;
    applyGeometry();
    game.asteroids = [];
    game.bosses = [];
    game.bullets = [];
    game.gems = [];
    game.missiles = [];
    game.particles = [];
    const sx = world.w / 2;
    const sy = world.h / 2 + (sector.system === 'gravity' ? 300 : 0);
    game.ship = createShip(sx, sy, stats);
    game.system = createSystem(sector.system, sector.systemParams || {}, game);
    weapons.resetWeapons(game);
    updateCamera(0, true);
    resetStick();
    hideBoss();
    queued = { n: 1, boss: false, main: false };
    countdown = INTRO_DELAY;
    ui.showScreen('playing');
    ui.showSectorIntro(sector.name, sector.tagline, sector.accent);
    return true;
  }

  // Map tap: locked sectors can't be started.
  function selectSector(id) {
    if (!isSectorOpen(progress, id)) return false;
    return startRun(id);
  }

  // Victory -> KEEP GOING: the run continues endlessly from the boss wave.
  function continueRun() {
    if (game.state !== 'victory' || !game.sector) return;
    game.phase = 'endless';
    game.state = 'playing';
    resetStick();
    ui.showScreen('playing');
    // any escorts still alive finish the wave; the normal clear logic queues the next one
    queued = null;
    countdown = null;
  }

  // Game over -> PLAY AGAIN: same sector from wave 1.
  function retry() {
    if (runSectorId) startRun(runSectorId);
  }

  function pause() {
    if (game.state !== 'playing' || !game.ship?.alive) return;
    game.state = 'pause';
    resetStick();
    ui.showScreen('pause');
  }

  function resume() {
    if (game.state !== 'pause') return;
    game.state = 'playing';
    ui.showScreen('playing');
  }

  function quitToTitle() {
    toTitle();
  }

  function toggleMute() {
    sfx.unlock();
    sfx.setMuted(!sfx.isMuted());
    ui.setMuted(sfx.isMuted());
  }

  // ---------- progression: level-ups, cards, rerolls ----------

  function checkLevelUps() {
    while (game.xp >= xpForLevel(game.level)) {
      game.xp -= xpForLevel(game.level);
      game.level += 1;
      pendingLevelUps += 1;
    }
  }

  function choiceOf(def) {
    const cur = levels[def.id] || 0;
    const requires = def.kind === 'evolution' && Array.isArray(def.requires)
      ? def.requires.map((id) => getUpgrade(id)?.name || id)
      : undefined;
    return {
      id: def.id,
      name: def.name,
      icon: def.icon,
      rarity: def.rarity,
      level: cur,
      maxLevel: def.maxLevel,
      desc: def.desc(cur + 1),
      requires,
    };
  }

  function rollCards() {
    return rollChoices(levels, CARDS, Math.random, { pool: cardPool(progress) });
  }

  function showChoices(picks, quiet) {
    game.state = 'upgrade';
    resetStick();
    if (!quiet) sfx.levelUp();
    ui.showUpgradeChoices(picks.map(choiceOf), onPick, {
      rerolls: game.rerolls,
      slotsUsed: slotsUsed(levels),
      slotsMax: MAX_SLOTS,
    });
  }

  // Opens the next upgrade screen. Returns false when no level-up is pending.
  function openNextUpgrade() {
    while (pendingLevelUps > 0) {
      pendingLevelUps -= 1;
      const picks = rollCards();
      if (picks.length === 0) {
        // nothing left to offer: a small heal instead
        const s = game.ship;
        s.hull = Math.min(s.hull + 1, stats.maxHull);
        continue;
      }
      showChoices(picks, false);
      return true;
    }
    return false;
  }

  function onPick(id) {
    if (game.state !== 'upgrade') return;
    const def = getUpgrade(id);
    if (!def) return;
    applyUpgrade(id, stats, levels, game);
    if (def.kind === 'evolution') {
      sfx.evolve();
      ui.showBanner(`EVOLVED: ${def.name}`, 1800);
    } else {
      sfx.pick();
    }
    if (game.ship) game.ship.invuln = Math.max(game.ship.invuln, UPGRADE_INVULN);
    if (!openNextUpgrade()) {
      game.state = 'playing';
      ui.showScreen('playing');
    }
  }

  function reroll() {
    if (game.state !== 'upgrade' || game.rerolls <= 0) return;
    const picks = rollCards();
    if (picks.length === 0) return;
    game.rerolls -= 1;
    sfx.reroll();
    showChoices(picks, true);
  }

  // ---------- death ----------

  function finishGameOver() {
    game.state = 'over';
    pendingLevelUps = 0;
    pendingVictory = false;
    countdown = null;
    queued = null;
    resetStick();
    hideBoss();
    const isNewBest = recordBest();
    const upgrades = Object.keys(levels)
      .filter((id) => levels[id] > 0)
      .map((id) => getUpgrade(id))
      .filter(Boolean)
      .map((def) => ({ name: def.name, icon: def.icon, level: levels[def.id] }));
    ui.showGameOver({
      score: Math.floor(game.score),
      wave: game.wave,
      level: game.level,
      best: bestFor(game.sector.id),
      isNewBest,
      upgrades,
    });
  }

  // ---------- main gun and collisions ----------

  function fireVolley() {
    const s = game.ship;
    const interval = 1 / stats.fireRate;
    s.fireTimer = Math.max(s.fireTimer + interval, 0);
    volleys += 1;
    const kind = stats.evoPrism ? 'lance' : 'bullet';
    const nx = s.x + Math.cos(s.angle) * s.radius * 1.3;
    const ny = s.y + Math.sin(s.angle) * s.radius * 1.3;
    const n = Math.max(1, Math.floor(stats.multishot));
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.16;
      game.bullets.push(createBullet(nx, ny, s.angle + off, stats, s.vx, s.vy, { kind }));
    }
    const bx = s.x - Math.cos(s.angle) * s.radius;
    const by = s.y - Math.sin(s.angle) * s.radius;
    const m = Math.floor(stats.rearGun);
    for (let i = 0; i < m; i++) {
      const off = (i - (m - 1) / 2) * 0.16;
      game.bullets.push(createBullet(bx, by, s.angle + Math.PI + off, stats, s.vx, s.vy, { kind }));
    }
    if (stats.evoRail && volleys % RAIL_EVERY === 0) {
      game.bullets.push(createBullet(nx, ny, s.angle, stats, s.vx, s.vy, {
        kind: 'rail',
        damage: stats.bulletDamage * 5,
        pierce: 99,
        radius: 5,
        speed: stats.bulletSpeed * RAIL_SPEED,
      }));
    }
    sfx.shoot();
  }

  function updateFiring(dt) {
    const s = game.ship;
    s.fireTimer -= dt;
    if (s.fireTimer <= 0) fireVolley();
  }

  // Circle collisions. Missiles, orbitals, bombs, drones and nova live in weapons.js.
  function collide() {
    const s = game.ship;
    const hazard = !invincible && s.invuln <= 0;

    // friendly bullets (gun, frost, drone) vs rocks and bosses; a pierce never hits one target twice
    const list = targets();
    for (const b of game.bullets) {
      if (b.dead) continue;
      for (const t of list) {
        if (t.dead || b.hitIds.includes(t.id)) continue;
        const r = b.radius + t.radius;
        if (dist2(t, b) > r * r) continue;
        b.hitIds.push(t.id);
        damageTarget(t, b.damage);
        weapons.onBulletHit(game, b, t);
        if (b.pierceLeft > 0) {
          b.pierceLeft -= 1;
        } else {
          b.dead = true;
          break;
        }
      }
    }

    if (!s.alive) return;

    // ship vs rocks: the rock bounces away, the ship takes a hit
    if (hazard) {
      for (const a of game.asteroids) {
        if (a.dead) continue;
        const r = s.radius + a.radius * 0.8;
        const d2 = dist2(a, s);
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2) || 1;
        a.vx += ((a.x - s.x) / d) * ROCK_PUSH;
        a.vy += ((a.y - s.y) / d) * ROCK_PUSH;
        game.api.hurtShip(a.x, a.y);
        break;
      }
    }

    // ship vs bosses: contact hurts and throws the ship back hard
    if (hazard) {
      for (const b of game.bosses) {
        if (b.dead) continue;
        const r = s.radius + b.radius * BOSS_REACH;
        const d2 = dist2(b, s);
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2) || 1;
        if (game.api.hurtShip(b.x, b.y)) {
          s.vx += ((s.x - b.x) / d) * BOSS_PUSH;
          s.vy += ((s.y - b.y) / d) * BOSS_PUSH;
        }
        break;
      }
    }

    // gems: pickup adds xp, scaled by the hazard's gem value
    const reach = s.radius + GEM_REACH;
    const gemMul = game.system?.mods?.gemValueMul || 1;
    for (const g of game.gems) {
      if (g.dead || dist2(g, s) >= reach * reach) continue;
      g.dead = true;
      game.xp += g.value * stats.xpGain * gemMul;
      sfx.pickup();
    }
    checkLevelUps();
  }

  // ---------- frame ----------

  function simulate(dt) {
    const s = game.ship;
    const sys = game.system;
    game.time += dt;
    if (s.alive) {
      updateShip(s, input, stats, dt, world, sys.mods);
      updateFiring(dt);
    }
    weapons.updateWeapons(game, dt);
    for (const b of game.bullets) updateBullet(b, dt, world);
    for (const a of game.asteroids) updateAsteroid(a, dt, world, s);
    for (const b of game.bosses) updateBoss(b, game, dt);
    sys.update(game, dt);
    for (const g of game.gems) updateGem(g, s, stats, dt, world);
    updateParticles(game.particles, dt);

    collide();

    compact(game.bullets);
    compact(game.asteroids);
    compact(game.bosses);
    compact(game.gems);

    updateCamera(dt, false);

    if (!s.alive) {
      deathTimer -= dt;
      if (deathTimer <= 0) finishGameOver();
      return;
    }

    updateWaves(dt);

    // only open upgrades for a living ship (a gem can level up on the same frame as a fatal hit)
    if (game.state === 'playing' && pendingLevelUps > 0) openNextUpgrade();
  }

  function update(dt) {
    clock += dt;
    if (shakeLeft > 0) {
      shakeLeft = Math.max(0, shakeLeft - dt);
      if (shakeLeft === 0) shakeAmp = 0;
    }
    hurtTimer = Math.max(0, hurtTimer - dt);

    if (input.pausePressed) {
      input.pausePressed = false;
      if (game.state === 'playing') pause();
      else if (game.state === 'pause') resume();
    }

    if (isMenu()) {
      for (const a of game.asteroids) updateAsteroid(a, dt, world);
      updateParticles(game.particles, dt);
      return;
    }
    // upgrade, pause, victory and over are frozen; only rendering continues
    if (game.state === 'playing') simulate(dt);
  }

  function render() {
    const z = game.zoom;
    const e = dpr * z;
    const t = clock;
    const sys = game.system;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = !isMenu() && game.sector ? game.sector.bg : BG;
    ctx.fillRect(0, 0, view.w, view.h);
    drawStars(ctx, game.stars, view, cam, t);

    // world space; shake is in CSS px, so its offset is scaled by dpr like everything else
    const amp = shakeAmp * (shakeSpan > 0 ? shakeLeft / shakeSpan : 0);
    const shx = amp > 0 ? rand(-amp, amp) : 0;
    const shy = amp > 0 ? rand(-amp, amp) : 0;
    ctx.setTransform(e, 0, 0, e, shx * dpr - cam.x * e, shy * dpr - cam.y * e);
    if (isMenu()) {
      for (const a of game.asteroids) drawAsteroid(ctx, a);
      drawParticles(ctx, game.particles);
    } else {
      sys?.drawBack?.(ctx, game, t);
      drawWorldBorder(ctx, world, game.sector.accent, t);
      drawGems(ctx, game.gems, t);
      // cull asteroids outside the visible world rect: each one costs a shadow fill, so off-screen ones are pure waste
      const vx0 = cam.x - CULL_PAD, vy0 = cam.y - CULL_PAD;
      const vx1 = cam.x + view.w / z + CULL_PAD, vy1 = cam.y + view.h / z + CULL_PAD;
      for (const a of game.asteroids) {
        const r = a.radius || 0;
        if (a.x + r < vx0 || a.x - r > vx1 || a.y + r < vy0 || a.y - r > vy1) continue;
        drawAsteroid(ctx, a);
      }
      for (const b of game.bosses) drawBoss(ctx, b, t);
      drawBullets(ctx, game.bullets);
      weapons.drawWeapons(ctx, game, t);
      drawShip(ctx, game.ship, stats, t);
      drawParticles(ctx, game.particles);
      sys?.drawFront?.(ctx, game, t);
    }

    // screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!isMenu() && game.sector) {
      sys?.drawScreen?.(ctx, game, t);
      drawThreatArrows(ctx, game);
      drawRadar(ctx, game);
    }
    if (hurtTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35 * (hurtTimer / HURT_TIME);
      ctx.fillStyle = HURT;
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.restore();
    }
    if (showFps) drawFpsMeter();
  }

  // Debug overlay (fps=1): smoothed FPS plus entity counts, bottom-left, screen space.
  function drawFpsMeter() {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(
      `${fpsValue} fps  rocks ${game.asteroids.length}  bullets ${game.bullets.length}  particles ${game.particles.length}`,
      12,
      view.h - 12,
    );
    ctx.restore();
  }

  function updateHUDFrame() {
    if (isMenu() || !game.sector || !game.ship) return;
    const s = game.ship;
    ui.updateHUD({
      score: Math.floor(game.score),
      wave: game.wave,
      level: game.level,
      xp: game.xp,
      xpNext: xpForLevel(game.level),
      hull: Math.max(0, s.hull),
      maxHull: stats.maxHull,
      shield: Math.floor(s.shield),
      shieldMax: stats.shieldMax,
      sector: game.sector.name,
    });
  }

  function updateBossBarFrame() {
    const alive = isMenu() ? null : game.bosses.find((b) => !b.dead);
    if (!alive) {
      if (bossBarId !== null) hideBoss();
      return;
    }
    if (bossBarId !== alive.id) {
      bossBarId = alive.id;
      ui.showBossBar(alive.name);
    }
    ui.updateBossBar(alive.hp / alive.maxHp);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    try {
      const real = lastFrame === null ? 0 : (now - lastFrame) / 1000;
      const dt = clamp(real, 0, DT_MAX);
      lastFrame = now;
      if (showFps && real > 0) {
        fpsAcc += real;
        fpsFrames += 1;
        if (fpsAcc >= FPS_WINDOW) {
          fpsValue = Math.round(fpsFrames / fpsAcc);
          fpsAcc = 0;
          fpsFrames = 0;
        }
      }
      update(dt);
      render();
      updateBossBarFrame();
      updateHUDFrame();
    } catch (err) {
      if (!errorReported) {
        errorReported = true;
        console.error('Stardust Breaker: frame error (loop keeps running):', err);
      }
    }
  }

  // ---------- debug hooks (used by tools/smoke.ts and tools/showcase.ts) ----------

  game.debug = {
    levelUp() {
      if (game.state !== 'playing') return;
      game.xp += Math.max(0, xpForLevel(game.level) - game.xp);
      checkLevelUps();
    },
    killShip() {
      if (game.state !== 'playing' || !game.ship.alive) return;
      game.ship.hull = 0;
      destroyShip();
    },
    clearWave() {
      if (game.state !== 'playing') return;
      game.asteroids = [];
    },
    // Applies upgrade `id` `times` times like picking its card, but opens no screen.
    grant(id, times = 1) {
      if (game.state !== 'playing' || !getUpgrade(id)) return;
      for (let i = 0; i < times; i++) applyUpgrade(id, stats, levels, game);
    },
    setInvincible(on) {
      invincible = Boolean(on);
    },
    startSector(id) {
      return startRun(id);
    },
    skipToBoss() {
      if (game.state !== 'playing' || !game.sector) return;
      if (game.bosses.some((b) => !b.dead)) return;
      game.asteroids = [];
      countdown = null;
      queued = null;
      if (game.phase === 'waves') {
        spawnBossWave(game.sector.waves + 1, true);
      } else {
        const n = Math.max(game.wave + 1, Math.ceil((game.wave + 1) / ENDLESS_BOSS_EVERY) * ENDLESS_BOSS_EVERY);
        spawnBossWave(n, false);
      }
    },
    killBoss() {
      for (const b of game.bosses.slice()) {
        if (!b.dead) game.api.damageBoss(b, b.hp);
      }
    },
    unlockAll() {
      progress.unlockAll = true;
      saveProgress(progress);
    },
    resetProgress() {
      progress.cleared = {};
      progress.best = {};
      progress.unlockAll = false;
      saveProgress(progress);
    },
  };

  Object.assign(game, {
    openMap,
    toTitle,
    startRun,
    selectSector,
    continueRun,
    retry,
    reroll,
    pause,
    resume,
    quitToTitle,
    toggleMute,
  });

  // ---------- boot ----------

  resize();
  window.addEventListener('resize', resize);
  toTitle();
  requestAnimationFrame(frame);

  return game;
}
