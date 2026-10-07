import {
  createShip, updateShip, drawShip,
  createBullet, updateBullet, drawBullets,
  ASTEROID_SIZES, createAsteroid, splitAsteroid, updateAsteroid, drawAsteroid,
  createGem, updateGem, drawGems,
  createMissile, updateMissile, drawMissiles,
  orbitalPositions, drawOrbitals,
  burst, ring, updateParticles, drawParticles,
  createStars, drawStars, dist2,
} from './entities.js';
import {
  baseStats, rollChoices, applyUpgrade, getUpgrade, xpForLevel,
} from './upgrades.js';

const BG = '#070b1a';
const CYAN = '#4df3ff';
const HURT = '#ff4d6d';
const SHIELD = '#6db8ff';
const ORANGE = '#ff9f43';
const MAGENTA = '#ff5ad1';
const ASTEROID_STROKE = '#b9a7ff';

const BEST_KEY = 'sb-best';
const MAX_GEMS = 300;
const DT_MAX = 0.05;
const DPR_CAP = 2;
const SPAWN_CLEAR = 220;
const DEATH_DELAY = 1.4;
const CLEAR_DELAY = 1.5;
const GEM_PICKUP_RANGE = 10;
const UPGRADE_INVULN = 0.6;
const SHAKE_TIME = 0.3;
const SHAKE_PX = 8;
const HURT_TIME = 0.25;
const TITLE_ASTEROIDS = 6;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function readBest() {
  try {
    const v = Number(globalThis.localStorage?.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

function writeBest(v) {
  try {
    globalThis.localStorage?.setItem(BEST_KEY, String(v));
  } catch {
    // storage unavailable; best score still lasts for this session
  }
}

// In-place compaction: keeps live items, no splice inside loops.
function compact(arr) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o.dead) arr[w++] = o;
  }
  arr.length = w;
}

export function createGame({ canvas, ui, input, sfx }) {
  const ctx = canvas.getContext('2d');
  const world = { w: 0, h: 0 };
  const stats = baseStats();
  const levels = {};
  let dpr = 1;
  let time = 0;
  let pendingLevelUps = 0;
  let deathTimer = 0;
  let clearTimer = null;
  let shakeTimer = 0;
  let hurtTimer = 0;
  let waveSpeedMul = 1;
  let lastFrame = null;
  let errorReported = false;
  let invincible = false; // debug only: ship ignores asteroid collisions

  const game = {
    state: 'title',
    world,
    ship: null,
    stats,
    levels,
    asteroids: [],
    bullets: [],
    gems: [],
    missiles: [],
    particles: [],
    stars: [],
    score: 0,
    wave: 0,
    level: 1,
    xp: 0,
    best: readBest(),
    start,
    pause,
    resume,
    quitToTitle,
    toggleMute,
    debug: { levelUp, killShip, clearWave, grant, setInvincible },
  };

  // --- setup ---

  function resize() {
    dpr = Math.min(globalThis.devicePixelRatio || 1, DPR_CAP);
    const changed = world.w !== window.innerWidth || world.h !== window.innerHeight;
    world.w = window.innerWidth;
    world.h = window.innerHeight;
    canvas.width = Math.round(world.w * dpr);
    canvas.height = Math.round(world.h * dpr);
    // stars were scattered over the old size; regenerate so they cover the new one
    if (changed) game.stars = createStars(world);
    const s = game.ship;
    if (s) {
      s.x = clamp(s.x, s.radius, Math.max(s.radius, world.w - s.radius));
      s.y = clamp(s.y, s.radius, Math.max(s.radius, world.h - s.radius));
    }
  }

  function resetStick() {
    input.cancel?.();
    input.stick.active = false;
    input.stick.x = 0;
    input.stick.y = 0;
  }

  function spawnTitleField() {
    game.asteroids = [];
    for (let i = 0; i < TITLE_ASTEROIDS; i++) {
      const size = i % 2 === 0 ? 3 : 2;
      game.asteroids.push(createAsteroid(rand(0, world.w), rand(0, world.h), size, 0.5));
    }
  }

  // Edge spawn, drifting inward; prefers a spot at least SPAWN_CLEAR px from the ship.
  function spawnWaveAsteroid(size, speedMul) {
    const ship = game.ship;
    const r = ASTEROID_SIZES[size].radius;
    let x = 0;
    let y = 0;
    let inward = 0;
    for (let tries = 0; tries < 12; tries++) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { x = rand(0, world.w); y = -r; inward = Math.PI / 2; }
      else if (side === 1) { x = rand(0, world.w); y = world.h + r; inward = -Math.PI / 2; }
      else if (side === 2) { x = -r; y = rand(0, world.h); inward = 0; }
      else { x = world.w + r; y = rand(0, world.h); inward = Math.PI; }
      if (dist2({ x, y }, ship) >= SPAWN_CLEAR * SPAWN_CLEAR) break;
    }
    const dir = inward + rand(-0.7, 0.7);
    const sp = rand(35, 85) * speedMul;
    return createAsteroid(x, y, size, speedMul, Math.cos(dir) * sp, Math.sin(dir) * sp);
  }

  function startWave(n) {
    game.wave = n;
    waveSpeedMul = 1 + 0.07 * (n - 1);
    clearTimer = null;
    for (let i = 0; i < 3 + n; i++) game.asteroids.push(spawnWaveAsteroid(3, waveSpeedMul));
    for (let i = 0; i < Math.max(0, n - 3); i++) game.asteroids.push(spawnWaveAsteroid(2, waveSpeedMul));
    ui.showBanner(`WAVE ${n}`);
    sfx.wave();
  }

  // --- lifecycle ---

  function start() {
    Object.assign(stats, baseStats());
    for (const id of Object.keys(levels)) delete levels[id];
    game.score = 0;
    game.wave = 0;
    game.level = 1;
    game.xp = 0;
    pendingLevelUps = 0;
    invincible = false;
    deathTimer = 0;
    clearTimer = null;
    shakeTimer = 0;
    hurtTimer = 0;
    game.asteroids = [];
    game.bullets = [];
    game.gems = [];
    game.missiles = [];
    game.particles = [];
    game.ship = createShip(world.w / 2, world.h / 2, stats);
    resetStick();
    game.state = 'playing';
    ui.showScreen('playing');
    startWave(1);
  }

  function pause() {
    if (game.state !== 'playing' || !game.ship.alive) return;
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
    game.state = 'title';
    if (game.ship) game.ship.alive = false;
    game.bullets = [];
    game.gems = [];
    game.missiles = [];
    game.particles = [];
    pendingLevelUps = 0;
    clearTimer = null;
    resetStick();
    spawnTitleField();
    ui.setBest(game.best);
    ui.showScreen('title');
  }

  function toggleMute() {
    sfx.unlock();
    sfx.setMuted(!sfx.isMuted());
    ui.setMuted(sfx.isMuted());
  }

  // --- progression ---

  function checkLevelUps() {
    while (game.xp >= xpForLevel(game.level)) {
      game.xp -= xpForLevel(game.level);
      game.level += 1;
      pendingLevelUps += 1;
    }
  }

  // Shows the next upgrade screen. Returns true if one is open, false if none is pending.
  function openNextUpgrade() {
    while (pendingLevelUps > 0) {
      pendingLevelUps -= 1;
      const picks = rollChoices(levels, 3);
      if (picks.length === 0) {
        const s = game.ship;
        s.hull = Math.min(s.hull + 1, stats.maxHull);
        continue;
      }
      showChoices(picks);
      return true;
    }
    return false;
  }

  function showChoices(picks) {
    game.state = 'upgrade';
    resetStick();
    sfx.levelUp();
    const choices = picks.map((def) => {
      const cur = levels[def.id] || 0;
      return {
        id: def.id,
        name: def.name,
        icon: def.icon,
        rarity: def.rarity,
        level: cur,
        maxLevel: def.maxLevel,
        desc: def.desc(cur + 1),
      };
    });
    ui.showUpgradeChoices(choices, onPick);
  }

  // Applies one upgrade level; shared by the upgrade cards and the debug grant().
  function applyPick(id) {
    applyUpgrade(id, stats, levels, game);
    const lv = levels[id] || 0;
    // First pick of a timed weapon: start its cooldown instead of firing at once.
    if (id === 'missiles' && lv === 1) game.ship.missileTimer = stats.missileInterval;
    if (id === 'nova' && lv === 1) game.ship.novaTimer = stats.novaInterval;
  }

  function onPick(id) {
    if (game.state !== 'upgrade') return;
    applyPick(id);
    game.ship.invuln = Math.max(game.ship.invuln, UPGRADE_INVULN);
    sfx.pick();
    if (!openNextUpgrade()) {
      game.state = 'playing';
      ui.showScreen('playing');
    }
  }

  // --- combat ---

  function addGem(x, y, value) {
    const gems = game.gems;
    if (gems.length >= MAX_GEMS) {
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
    a.hp -= dmg;
    a.hitFlash = 0.08;
    sfx.hit();
    if (a.hp > 0) return;
    a.dead = true;
    const def = ASTEROID_SIZES[a.size];
    game.score += def.score;
    for (let i = 0; i < def.gems; i++) addGem(a.x + rand(-6, 6), a.y + rand(-6, 6), 1);
    burst(game.particles, a.x, a.y, ASTEROID_STROKE, 12, 160);
    sfx.explode(a.size);
    for (const c of splitAsteroid(a, waveSpeedMul)) game.asteroids.push(c);
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

  function finishGameOver() {
    game.state = 'over';
    pendingLevelUps = 0;
    const score = game.score;
    const isNewBest = score > game.best && score > 0;
    if (isNewBest) {
      game.best = score;
      writeBest(game.best);
    }
    ui.setBest(game.best);
    const upgrades = Object.keys(levels)
      .filter((id) => levels[id] > 0)
      .map((id) => {
        const def = getUpgrade(id);
        return { name: def.name, icon: def.icon, level: levels[id] };
      });
    ui.showGameOver({
      score,
      wave: game.wave,
      level: game.level,
      best: game.best,
      isNewBest,
      upgrades,
    });
  }

  function hitShip(a) {
    const s = game.ship;
    const dx = a.x - s.x;
    const dy = a.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    a.vx += (dx / d) * 120;
    a.vy += (dy / d) * 120;
    if (s.shield > 0) {
      s.shield -= 1;
      s.shieldTimer = 0;
      s.invuln = 1.0;
      sfx.shieldHit();
      ring(game.particles, s.x, s.y, s.radius + 40, SHIELD, 0.4);
      return;
    }
    s.hull -= 1;
    s.invuln = 2.0;
    sfx.hurt();
    shakeTimer = SHAKE_TIME;
    hurtTimer = HURT_TIME;
    burst(game.particles, s.x, s.y, HURT, 14, 180);
    if (s.hull <= 0) destroyShip();
  }

  function fireVolley() {
    const s = game.ship;
    const interval = 1 / stats.fireRate;
    s.fireTimer = Math.max(s.fireTimer + interval, 0);
    const nx = s.x + Math.cos(s.angle) * s.radius * 1.3;
    const ny = s.y + Math.sin(s.angle) * s.radius * 1.3;
    const n = stats.multishot;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.16;
      game.bullets.push(createBullet(nx, ny, s.angle + off, stats, s.vx, s.vy));
    }
    const bx = s.x - Math.cos(s.angle) * s.radius;
    const by = s.y - Math.sin(s.angle) * s.radius;
    const m = stats.rearGun;
    for (let i = 0; i < m; i++) {
      const off = (i - (m - 1) / 2) * 0.16;
      game.bullets.push(createBullet(bx, by, s.angle + Math.PI + off, stats, s.vx, s.vy));
    }
    sfx.shoot();
  }

  function updateFiring(dt) {
    const s = game.ship;
    s.fireTimer -= dt;
    if (s.fireTimer <= 0) fireVolley();
  }

  function updateMissileLauncher(dt) {
    const s = game.ship;
    if (stats.missiles <= 0) return;
    s.missileTimer -= dt;
    if (s.missileTimer > 0) return;
    s.missileTimer = stats.missileInterval;
    const n = stats.missiles;
    const nx = s.x + Math.cos(s.angle) * s.radius;
    const ny = s.y + Math.sin(s.angle) * s.radius;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      game.missiles.push(createMissile(nx, ny, s.angle + t * 0.5, stats));
    }
    sfx.missile();
  }

  function updateNova(dt) {
    const s = game.ship;
    if (stats.novaLevel <= 0) return;
    s.novaTimer -= dt;
    if (s.novaTimer > 0) return;
    s.novaTimer = stats.novaInterval;
    const r2 = stats.novaRadius * stats.novaRadius;
    const list = game.asteroids;
    const n = list.length; // children spawned by this blast are not hit by it
    for (let i = 0; i < n; i++) {
      const a = list[i];
      if (a.dead || dist2(a, s) > r2) continue;
      damageAsteroid(a, stats.novaDamage);
      if (!a.dead) {
        const dx = a.x - s.x;
        const dy = a.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        a.vx += (dx / d) * 60;
        a.vy += (dy / d) * 60;
      }
    }
    ring(game.particles, s.x, s.y, stats.novaRadius, MAGENTA, 0.5);
    sfx.nova();
  }

  function collide() {
    const s = game.ship;
    const asteroids = game.asteroids;

    // bullets vs asteroids (pierce: a bullet may pass through several, never the same one twice)
    for (const b of game.bullets) {
      if (b.dead) continue;
      const n = asteroids.length;
      for (let i = 0; i < n; i++) {
        const a = asteroids[i];
        if (a.dead || b.hitIds.includes(a.id)) continue;
        const r = b.radius + a.radius;
        if (dist2(a, b) > r * r) continue;
        b.hitIds.push(a.id);
        damageAsteroid(a, b.damage);
        if (b.pierceLeft > 0) {
          b.pierceLeft -= 1;
        } else {
          b.dead = true;
          break;
        }
      }
    }

    // missiles vs asteroids
    for (const m of game.missiles) {
      if (m.dead) continue;
      const n = asteroids.length;
      for (let i = 0; i < n; i++) {
        const a = asteroids[i];
        if (a.dead) continue;
        const r = m.radius + a.radius;
        if (dist2(a, m) > r * r) continue;
        damageAsteroid(a, m.damage);
        m.dead = true;
        ring(game.particles, m.x, m.y, 18, ORANGE, 0.25);
        break;
      }
    }

    if (s.alive) {
      // orbitals vs asteroids
      if (stats.orbitals > 0) {
        const orbs = orbitalPositions(s, stats, time);
        const n = asteroids.length;
        for (const o of orbs) {
          for (let i = 0; i < n; i++) {
            const a = asteroids[i];
            if (a.dead || a.orbitCd > 0) continue;
            const r = o.radius + a.radius;
            if (dist2(a, o) > r * r) continue;
            damageAsteroid(a, stats.orbitalDamage);
            a.orbitCd = 0.35;
          }
        }
      }

      // ship vs asteroids
      if (s.invuln <= 0 && !invincible) {
        const n = asteroids.length;
        for (let i = 0; i < n; i++) {
          const a = asteroids[i];
          if (a.dead) continue;
          const r = s.radius + a.radius * 0.8;
          if (dist2(a, s) > r * r) continue;
          hitShip(a);
          break;
        }
      }

      // gems
      const reach = s.radius + GEM_PICKUP_RANGE;
      for (const g of game.gems) {
        if (g.dead || dist2(g, s) >= reach * reach) continue;
        g.dead = true;
        game.xp += g.value * stats.xpGain;
        sfx.pickup();
      }
      checkLevelUps();
    }
  }

  function updateWaves(dt) {
    if (game.asteroids.length > 0) return;
    if (clearTimer === null) {
      clearTimer = CLEAR_DELAY;
      game.score += 100 * game.wave;
    }
    clearTimer -= dt;
    if (clearTimer <= 0) startWave(game.wave + 1);
  }

  // --- frame ---

  function update(dt) {
    time += dt;
    shakeTimer = Math.max(0, shakeTimer - dt);
    hurtTimer = Math.max(0, hurtTimer - dt);

    if (game.state === 'title') {
      input.pausePressed = false;
      for (const a of game.asteroids) updateAsteroid(a, dt, world);
      return;
    }

    if (input.pausePressed) {
      input.pausePressed = false;
      if (game.state === 'playing') pause();
      else if (game.state === 'pause') resume();
    }
    if (game.state === 'upgrade' || game.state === 'pause' || game.state === 'over') return;

    const s = game.ship;
    if (s.alive) {
      updateShip(s, input, stats, dt, world);
      updateFiring(dt);
      updateMissileLauncher(dt);
      updateNova(dt);
    } else {
      deathTimer -= dt;
    }

    for (const b of game.bullets) updateBullet(b, dt, world);
    for (const m of game.missiles) updateMissile(m, game.asteroids, dt, world);
    for (const a of game.asteroids) updateAsteroid(a, dt, world);
    for (const g of game.gems) updateGem(g, s, stats, dt, world);
    updateParticles(game.particles, dt);

    collide();

    compact(game.bullets);
    compact(game.missiles);
    compact(game.asteroids);
    compact(game.gems);

    if (s.alive) updateWaves(dt);

    if (!s.alive && deathTimer <= 0) {
      finishGameOver();
      return;
    }

    // only open upgrades for a living ship (a gem can level up on the same frame as a fatal hit)
    if (game.state === 'playing' && s.alive && pendingLevelUps > 0) openNextUpgrade();
  }

  function render() {
    const s = game.ship;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, world.w, world.h);

    ctx.save();
    if (shakeTimer > 0) {
      const amp = SHAKE_PX * (shakeTimer / SHAKE_TIME);
      ctx.translate(rand(-amp, amp), rand(-amp, amp));
    }
    drawStars(ctx, game.stars, world, game.state === 'title' ? null : s, time);
    drawGems(ctx, game.gems, time);
    for (const a of game.asteroids) drawAsteroid(ctx, a);
    drawBullets(ctx, game.bullets);
    drawMissiles(ctx, game.missiles);
    drawOrbitals(ctx, s, stats, time);
    drawShip(ctx, s, stats, time);
    drawParticles(ctx, game.particles);
    ctx.restore();

    if (hurtTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35 * (hurtTimer / HURT_TIME);
      ctx.fillStyle = HURT;
      ctx.fillRect(0, 0, world.w, world.h);
      ctx.restore();
    }
  }

  function updateHUDFrame() {
    if (game.state === 'title') return;
    const s = game.ship;
    ui.updateHUD({
      score: game.score,
      wave: game.wave,
      level: game.level,
      xp: game.xp,
      xpNext: xpForLevel(game.level),
      hull: Math.max(0, s.hull),
      maxHull: stats.maxHull,
      shield: Math.floor(s.shield),
      shieldMax: stats.shieldMax,
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    try {
      const dt = lastFrame === null ? 0 : clamp((now - lastFrame) / 1000, 0, DT_MAX);
      lastFrame = now;
      update(dt);
      render();
      updateHUDFrame();
    } catch (err) {
      if (!errorReported) {
        errorReported = true;
        console.error('Stardust Breaker: frame error (loop keeps running):', err);
      }
    }
  }

  // --- debug hooks (used by tools/smoke.ts) ---

  function levelUp() {
    if (game.state !== 'playing') return;
    game.xp += Math.max(0, xpForLevel(game.level) - game.xp);
    checkLevelUps();
  }

  function killShip() {
    if (game.state !== 'playing' || !game.ship.alive) return;
    game.ship.hull = 0;
    destroyShip();
  }

  function clearWave() {
    if (game.state !== 'playing') return;
    game.asteroids = [];
  }

  // Applies upgrade `id` `times` times, like picking its card, but opens no screen.
  function grant(id, times = 1) {
    if (game.state !== 'playing' || !getUpgrade(id)) return;
    for (let i = 0; i < times; i++) applyPick(id);
  }

  function setInvincible(on) {
    invincible = Boolean(on);
  }

  // --- boot ---

  resize(); // also creates the starfield
  window.addEventListener('resize', resize);
  game.ship = createShip(world.w / 2, world.h / 2, stats);
  game.ship.alive = false;
  spawnTitleField();
  ui.setBest(game.best);
  ui.showScreen('title');
  requestAnimationFrame(frame);

  return game;
}
