// Secondary weapons and evolution behaviours (BRIEF: weapons.js (R)).
// game.js runs only the main gun and bullet collisions; everything else lives here.
// Damage, spawns, rings, bursts, shake and sfx always go through game.api.
import {
  createMissile, updateMissile, drawMissiles,
  orbitalPositions, drawOrbitals, dist2,
} from './entities.js';

const TAU = Math.PI * 2;
const ORANGE = '#ff9f43';
const MAGENTA = '#ff5ad1';
const GOLD = '#ffd166';
const CYAN = '#4df3ff';
const LILAC = '#b8a9ff';
const VIOLET = '#8a5cff';

const ORBIT_CD = 0.35;
const CLUSTER_R = 70;
const CLUSTER_DMG = 2;
const CHAIN_LIFE = 0.15;
const BOMB_TICK = 0.25;
const BOMB_AHEAD = 180;
const BOMB_SPREAD = 56;
const BOMB_PULL = 160;
const BLACKSTAR_DET_DMG = 6;
const BLACKSTAR_DET_PAD = 40;
const HIVE_INTERVAL = 2.5;
const DRONE_ORBIT = 56;
const DRONE_SPIN = 0.9;
const SINGULARITY_R = 150;
const SINGULARITY_PULL = 120;
const AEGIS_R = 170;
const AEGIS_DMG = 4;
const NOVA_PUSH = 60;

const rand = (a, b) => a + Math.random() * (b - a);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const posNum = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);

function freshState() {
  return { lv: {}, drones: [], bombs: [], missileT: 0, novaT: 0, bombT: 0, spin: 0, time: 0 };
}

export function resetWeapons(game) {
  game.weaponState = freshState();
  game.fx = [];
}

// game.js may hand us {} after a reset; rebuild lazily so we never throw on odd state.
function stateOf(game) {
  if (!game.weaponState || !game.weaponState.lv) game.weaponState = freshState();
  if (!Array.isArray(game.fx)) game.fx = [];
  return game.weaponState;
}

function sfx(game, name) {
  const s = game.api && game.api.sfx;
  if (s && typeof s[name] === 'function') s[name]();
}

// True only on the frame a weapon goes from unowned (0) to owned. Records the level seen.
function levelRose(state, key, level) {
  const prev = state.lv[key] || 0;
  state.lv[key] = level;
  return prev <= 0 && level > 0;
}

function compactInPlace(arr) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o.dead) arr[w++] = o;
  }
  arr.length = w;
}

const missileInterval = (s) => Math.max(0.15, num(s.missileInterval, 2.4));
const novaInterval = (s) => Math.max(0.5, num(s.novaInterval, 7));
const bombInterval = (s) => Math.max(0.5, num(s.bombInterval, 6));
const bombLife = (s) => posNum(s.bombDuration, 2);
const droneRate = (s) => posNum(s.droneFireRate, 1.6);

// Damage every live target within `radius` of (cx, cy); rocks (not bosses) get pushed outward.
// `targets` is a captured array; length is read once so api pushes can't extend the loop.
function blast(game, cx, cy, radius, dmg, targets, push) {
  const api = game.api;
  const r2 = radius * radius;
  const n = targets.length;
  for (let i = 0; i < n; i++) {
    const t = targets[i];
    if (t.dead) continue;
    const dx = t.x - cx;
    const dy = t.y - cy;
    if (dx * dx + dy * dy > r2) continue;
    if (dmg > 0) api.damageTarget(t, dmg);
    if (push && !t.dead && !t.isBoss) {
      const d = Math.hypot(dx, dy) || 1;
      t.vx += (dx / d) * NOVA_PUSH;
      t.vy += (dy / d) * NOVA_PUSH;
    }
  }
}

// --- per-frame update ---

export function updateWeapons(game, dt) {
  const state = stateOf(game);
  const ship = game.ship;
  if (!(dt >= 0)) return;
  if (!ship || !ship.alive) {
    updateFx(game, dt);
    return;
  }
  state.time = num(game.time, state.time + dt);
  const targets = game.api.targets();
  updateMissiles(game, state, dt, targets);
  updateNova(game, state, dt, targets);
  updateOrbitals(game, state, dt, targets);
  updateBombs(game, state, dt, targets);
  updateDrones(game, state, dt);
  updateFx(game, dt);
}

// --- missiles (moved from v1 game.js) ---

function fireSalvo(game, n) {
  const ship = game.ship;
  const stats = game.stats;
  const nx = ship.x + Math.cos(ship.angle) * ship.radius;
  const ny = ship.y + Math.sin(ship.angle) * ship.radius;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    game.missiles.push(createMissile(nx, ny, ship.angle + t * 0.5, stats));
  }
  sfx(game, 'missile');
}

function clusterHit(game, m, hit, targets) {
  const api = game.api;
  const r2 = CLUSTER_R * CLUSTER_R;
  const n = targets.length;
  for (let j = 0; j < n; j++) {
    const t = targets[j];
    if (t === hit || t.dead) continue;
    if (dist2(t, m) > r2) continue;
    api.damageTarget(t, CLUSTER_DMG);
  }
  api.ring(m.x, m.y, CLUSTER_R, ORANGE, 0.35);
  game.fx.push({ type: 'cluster', x: m.x, y: m.y, r: CLUSTER_R, life: 0.35, maxLife: 0.35 });
}

function updateMissiles(game, state, dt, targets) {
  const stats = game.stats;
  const api = game.api;
  const count = Math.floor(num(stats.missiles, 0));
  if (levelRose(state, 'missiles', count)) state.missileT = missileInterval(stats);

  if (count > 0) {
    state.missileT -= dt;
    if (state.missileT <= 0) {
      state.missileT = missileInterval(stats);
      fireSalvo(game, count);
    }
  }

  const missiles = game.missiles;
  const world = game.world;
  const nm = missiles.length;
  for (let i = 0; i < nm; i++) {
    const m = missiles[i];
    if (m.dead) continue;
    updateMissile(m, targets, dt, world);
    if (m.dead) continue;
    const nt = targets.length;
    for (let j = 0; j < nt; j++) {
      const t = targets[j];
      if (t.dead) continue;
      const r = m.radius + t.radius;
      if (dist2(m, t) > r * r) continue;
      m.dead = true;
      api.damageTarget(t, m.damage);
      if (stats.evoCluster) clusterHit(game, m, t, targets);
      else api.ring(m.x, m.y, 18, ORANGE, 0.25);
      break;
    }
  }
  compactInPlace(missiles);
}

// --- nova (moved from v1 game.js) ---

function updateNova(game, state, dt, targets) {
  const stats = game.stats;
  const ship = game.ship;
  const level = Math.max(0, Math.floor(num(stats.novaLevel, 0)));
  if (levelRose(state, 'nova', level)) state.novaT = novaInterval(stats);
  if (level <= 0) return;

  state.novaT -= dt;
  if (state.novaT > 0) return;
  state.novaT = novaInterval(stats);
  const radius = posNum(stats.novaRadius, 150);
  blast(game, ship.x, ship.y, radius, num(stats.novaDamage, 0), targets, true);
  game.api.ring(ship.x, ship.y, radius, MAGENTA, 0.5);
  sfx(game, 'nova');
}

// --- orbitals (moved from v1 game.js) + Singularity pull ---

function updateOrbitals(game, state, dt, targets) {
  const stats = game.stats;
  const ship = game.ship;
  const api = game.api;
  const n = targets.length;
  // asteroids tick their own orbitCd in entities.updateAsteroid; bosses need it done here
  for (let i = 0; i < n; i++) {
    const t = targets[i];
    if (t.isBoss && t.orbitCd > 0) t.orbitCd = Math.max(0, t.orbitCd - dt);
  }

  const count = Math.floor(num(stats.orbitals, 0));
  if (count <= 0) return;

  const orbs = orbitalPositions(ship, stats, state.time);
  const dmg = num(stats.orbitalDamage, 1);
  for (const o of orbs) {
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (t.dead || t.orbitCd > 0) continue;
      const r = o.radius + t.radius;
      if (dist2(t, o) > r * r) continue;
      api.damageTarget(t, dmg);
      t.orbitCd = ORBIT_CD;
    }
  }

  // Singularity Blades: rocks near the ship are pulled onto the blade ring (bosses are not moved)
  if (stats.evoSingularity) {
    const R = num(stats.orbitalRadius, 48);
    const r2 = SINGULARITY_R * SINGULARITY_R;
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (t.dead || t.isBoss) continue;
      const dx = t.x - ship.x;
      const dy = t.y - ship.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      const e = d - R;
      if (e === 0) continue;
      const k = (-Math.sign(e) * SINGULARITY_PULL * dt) / d;
      t.vx += dx * k;
      t.vy += dy * k;
    }
  }
}

// --- gravity bombs (Gravity Bomb / Black Star) ---

function dropBombs(game, state, count) {
  const ship = game.ship;
  const world = game.world;
  const stats = game.stats;
  const ax = ship.x + Math.cos(ship.angle) * BOMB_AHEAD;
  const ay = ship.y + Math.sin(ship.angle) * BOMB_AHEAD;
  const px = -Math.sin(ship.angle);
  const py = Math.cos(ship.angle);
  const life = bombLife(stats);
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * BOMB_SPREAD;
    let x = ax + px * off;
    let y = ay + py * off;
    if (world && world.w > 0) x = Math.min(world.w, Math.max(0, x));
    if (world && world.h > 0) y = Math.min(world.h, Math.max(0, y));
    state.bombs.push({ x, y, t: 0, life, tick: BOMB_TICK, dead: false, black: Boolean(stats.evoBlackstar) });
  }
}

function detonateBlackStar(game, b, targets, radius) {
  const api = game.api;
  const r = radius + BLACKSTAR_DET_PAD;
  blast(game, b.x, b.y, r, BLACKSTAR_DET_DMG, targets, false);
  api.ring(b.x, b.y, r, GOLD, 0.8);
  api.shake(0.35, 10);
  game.fx.push({ type: 'boom', x: b.x, y: b.y, r, life: 0.5, maxLife: 0.5 });
}

function updateBombs(game, state, dt, targets) {
  const stats = game.stats;
  const api = game.api;
  const count = Math.floor(num(stats.bombs, 0));
  if (levelRose(state, 'bombs', count)) state.bombT = bombInterval(stats);

  if (count > 0) {
    state.bombT -= dt;
    if (state.bombT <= 0) {
      state.bombT = bombInterval(stats);
      dropBombs(game, state, count);
    }
  }

  const radius = posNum(stats.bombRadius, 170);
  const r2 = radius * radius;
  const dmg = num(stats.bombDamage, 1);
  const bombs = state.bombs;
  const nb = bombs.length;
  for (let i = 0; i < nb; i++) {
    const b = bombs[i];
    if (b.dead) continue;
    const black = b.black; // fixed at drop time, so the detonation matches what was dropped
    const pull = BOMB_PULL * (black ? 2 : 1);
    b.t += dt;
    b.tick -= dt;
    const tickNow = b.tick <= 0;
    if (tickNow) b.tick = BOMB_TICK;

    const nt = targets.length;
    for (let j = 0; j < nt; j++) {
      const t = targets[j];
      if (t.dead) continue;
      const dx = b.x - t.x;
      const dy = b.y - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (!t.isBoss) {
        const d = Math.sqrt(d2) || 1;
        t.vx += (dx / d) * pull * dt;
        t.vy += (dy / d) * pull * dt;
      }
      if (tickNow && dmg > 0) api.damageTarget(t, dmg);
    }

    if (b.t >= b.life) {
      b.dead = true;
      if (black) detonateBlackStar(game, b, targets, radius);
      else api.ring(b.x, b.y, radius * 0.5, VIOLET, 0.4);
    }
  }
  compactInPlace(bombs);
}

// --- chain arcs (Arc Coil / Tempest) ---

// Jagged polyline through flat [x0,y0,x1,y1,...] points, jittered at ~12 px steps.
function jagged(pts) {
  const out = [pts[0], pts[1]];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const steps = Math.max(1, Math.ceil(len / 12));
    for (let s = 1; s <= steps; s++) {
      if (s === steps) {
        out.push(bx, by);
      } else {
        const f = s / steps;
        const j = rand(-9, 9);
        out.push(ax + dx * f + nx * j, ay + dy * f + ny * j);
      }
    }
  }
  return out;
}

export function onBulletHit(game, bullet, target) {
  const stats = game.stats;
  const chance = num(stats.chainChance, 0);
  const maxHops = Math.floor(num(stats.chainTargets, 0));
  if (!target || !(chance > 0) || !(maxHops > 0)) return;
  if (Math.random() >= chance) return;
  stateOf(game);

  const api = game.api;
  const range = posNum(stats.chainRange, 170);
  const r2 = range * range;
  const dmg = num(bullet && bullet.damage, 0);
  const visited = new Set([target]);
  const pts = [target.x, target.y];
  let ox = target.x;
  let oy = target.y;
  for (let hop = 0; hop < maxHops; hop++) {
    const list = api.targets();
    const n = list.length;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const t = list[i];
      if (t.dead || visited.has(t)) continue;
      const dx = t.x - ox;
      const dy = t.y - oy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && d2 < bestD) {
        bestD = d2;
        best = t;
      }
    }
    if (!best) break;
    visited.add(best);
    if (dmg > 0) api.damageTarget(best, dmg);
    pts.push(best.x, best.y);
    ox = best.x;
    oy = best.y;
  }

  if (pts.length > 2) {
    game.fx.push({ type: 'arc', pts: jagged(pts), life: CHAIN_LIFE, maxLife: CHAIN_LIFE });
    sfx(game, 'lightning');
  }
}

// --- frost shards ---

const FROST_CAP = 60;

// Live frost bullets in game.bullets (kind 'frost'). Used to stop frost chains from spamming.
function frostAlive(game) {
  const bullets = game.bullets;
  if (!Array.isArray(bullets)) return 0;
  let count = 0;
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    if (b && b.kind === 'frost' && !b.dead) count++;
  }
  return count;
}

export function onKill(game, rock) {
  const stats = game.stats;
  const n = Math.floor(num(stats.frostShards, 0));
  if (!rock || n <= 0) return;
  // boss shards and transient rocks (comets, system spawns) never trigger frost
  if (rock.kind === 'shard' || rock.transient) return;
  if (frostAlive(game) > FROST_CAP) return;
  const base = rand(0, TAU);
  const dmg = num(stats.bulletDamage, 1);
  for (let i = 0; i < n; i++) {
    const ang = base + (i * TAU) / n + rand(-0.2, 0.2);
    game.api.fireBullet(rock.x, rock.y, ang, { kind: 'frost', damage: dmg, speed: 420, life: 0.55, pierce: 0 });
  }
}

// --- wingman drones (Hivemind adds missiles) ---

function syncDrones(game, state) {
  const stats = game.stats;
  const ship = game.ship;
  const want = Math.max(0, Math.floor(num(stats.drones, 0)));
  const rate = droneRate(stats);
  while (state.drones.length < want) {
    state.drones.push({
      x: ship.x,
      y: ship.y,
      fireCd: 1 / rate,
      hiveCd: HIVE_INTERVAL,
      phase: rand(0, TAU),
    });
  }
  if (state.drones.length > want) state.drones.length = want;
}

function updateDrones(game, state, dt) {
  const stats = game.stats;
  const ship = game.ship;
  const api = game.api;
  syncDrones(game, state);
  // Hivemind just picked: every drone starts its missile cooldown instead of launching at once.
  if (levelRose(state, 'evoHive', stats.evoHive ? 1 : 0)) {
    for (const d of state.drones) d.hiveCd = HIVE_INTERVAL;
  }
  const n = state.drones.length;
  if (n === 0) return;

  state.spin += DRONE_SPIN * dt;
  const rate = droneRate(stats);
  const range = posNum(stats.droneRange, 360);
  const dmg = num(stats.droneDamage, 1);
  const hive = Boolean(stats.evoHive);
  const k = Math.min(1, 8 * dt);
  for (let i = 0; i < n; i++) {
    const d = state.drones[i];
    const a = state.spin + (i * TAU) / n;
    const tx = ship.x + Math.cos(a) * DRONE_ORBIT;
    const ty = ship.y + Math.sin(a) * DRONE_ORBIT;
    d.x += (tx - d.x) * k;
    d.y += (ty - d.y) * k;

    d.fireCd -= dt;
    if (d.fireCd <= 0) {
      const t = api.nearestTarget(d.x, d.y, range);
      if (t) {
        api.fireBullet(d.x, d.y, Math.atan2(t.y - d.y, t.x - d.x), {
          kind: 'drone', damage: dmg, speed: 520, life: 0.8,
        });
        d.fireCd = 1 / rate;
      } else {
        d.fireCd = 0.1; // no target in range: poll again shortly
      }
    }

    if (hive) {
      d.hiveCd -= dt;
      if (d.hiveCd <= 0) {
        d.hiveCd = HIVE_INTERVAL;
        game.missiles.push(createMissile(d.x, d.y, ship.angle + rand(-0.6, 0.6), stats));
        sfx(game, 'missile');
      }
    }
  }
}

// --- transient fx (arcs, cluster blasts, black star detonations): expire by time ---

function updateFx(game, dt) {
  const fx = game.fx;
  let w = 0;
  for (let i = 0; i < fx.length; i++) {
    const f = fx[i];
    f.life -= dt;
    if (f.life > 0) fx[w++] = f;
  }
  fx.length = w;
}

// --- shield break (Aegis Core) ---

export function onShieldBreak(game) {
  const stats = game.stats;
  const ship = game.ship;
  if (!stats.evoAegis || !ship) return;
  stateOf(game);
  const targets = game.api.targets();
  blast(game, ship.x, ship.y, AEGIS_R, AEGIS_DMG, targets, true);
  game.api.ring(ship.x, ship.y, AEGIS_R, GOLD, 0.6);
  sfx(game, 'nova');
}

// --- drawing (world space; every function saves/restores ctx state) ---

export function drawWeapons(ctx, game, time) {
  const stats = game.stats;
  const ship = game.ship;
  const state = game.weaponState;
  drawMissiles(ctx, game.missiles || []);
  if (ship && ship.alive && num(stats.orbitals, 0) > 0) {
    if (stats.evoSingularity) drawBlades(ctx, game, time);
    else drawOrbitals(ctx, ship, stats, time);
  }
  if (state && state.bombs && state.bombs.length) drawBombs(ctx, game, state.bombs, time);
  if (state && state.drones && state.drones.length) drawDrones(ctx, state.drones, time);
  if (game.fx && game.fx.length) drawFx(ctx, game.fx);
}

// Singularity Blades: larger blades with a violet halo; the orbit ring is drawn too.
function drawBlades(ctx, game, time) {
  const ship = game.ship;
  const stats = game.stats;
  const pts = orbitalPositions(ship, stats, time);
  const n = pts.length;
  ctx.save();

  ctx.strokeStyle = 'rgba(138, 92, 255, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, stats.orbitalRadius, 0, TAU);
  ctx.stroke();

  // fake halo: one batched low-alpha disc per blade (no per-blade gradient)
  ctx.fillStyle = 'rgba(138, 92, 255, 0.2)';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    ctx.moveTo(p.x + 24, p.y);
    ctx.arc(p.x, p.y, 24, 0, TAU);
  }
  ctx.fill();

  const scale = 1.35;
  ctx.shadowColor = MAGENTA;
  ctx.shadowBlur = 12;
  ctx.fillStyle = MAGENTA;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const rot = time * 9 + i * 0.7;
    for (let k = 0; k < 8; k++) {
      const r = (k % 2 === 0 ? 9 : 3.5) * scale;
      const ang = rot + (k * Math.PI) / 4;
      const x = p.x + Math.cos(ang) * r;
      const y = p.y + Math.sin(ang) * r;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    ctx.moveTo(p.x + 3, p.y);
    ctx.arc(p.x, p.y, 3, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
}

// Gravity bombs: a black sphere with a swirling accretion ring; Black Star is bigger and darker.
function drawBombs(ctx, game, bombs, time) {
  const radius = posNum(game.stats.bombRadius, 170);
  const n = bombs.length;
  ctx.save();

  // pass 1: reach indicator and spheres (no glow)
  for (let i = 0; i < n; i++) {
    const b = bombs[i];
    if (b.dead) continue;
    const black = b.black;
    const r = black ? 22 : 13;
    const fade = Math.min(1, Math.max(0, (b.life - b.t) / 0.4));
    ctx.globalAlpha = 0.06 * fade;
    ctx.strokeStyle = VIOLET;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y, radius, 0, TAU);
    ctx.stroke();

    const g = ctx.createRadialGradient(b.x, b.y, r * 0.2, b.x, b.y, r);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.8, '#05020c');
    g.addColorStop(1, black ? '#3a0f4f' : '#2b1f4a');
    ctx.globalAlpha = fade;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, TAU);
    ctx.fill();
  }

  // pass 2: fake glow, batched: one wide faint ring stroke per colour (bombs not fading out only)
  ctx.lineWidth = 5;
  for (let c = 0; c < 2; c++) {
    const black = c === 1;
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = black ? GOLD : MAGENTA;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const b = bombs[i];
      if (b.dead || Boolean(b.black) !== black || b.life - b.t < 0.4) continue;
      const spin = time * 2.2 + i * 1.7;
      const rx = (black ? 22 : 13) * 1.9;
      ctx.moveTo(b.x + Math.cos(spin) * rx, b.y + Math.sin(spin) * rx);
      ctx.ellipse(b.x, b.y, rx, rx * (0.55 / 1.9), spin, 0, TAU);
    }
    ctx.stroke();
  }

  // pass 3: crisp accretion rings and swirl streaks (no shadow)
  for (let i = 0; i < n; i++) {
    const b = bombs[i];
    if (b.dead) continue;
    const black = b.black;
    const r = black ? 22 : 13;
    const fade = Math.min(1, Math.max(0, (b.life - b.t) / 0.4));
    const spin = time * 2.2 + i * 1.7;
    ctx.lineWidth = black ? 2 : 1.5;
    ctx.globalAlpha = (black ? 0.9 : 0.7) * fade;
    ctx.strokeStyle = black ? GOLD : MAGENTA;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, r * 1.9, r * 0.55, spin, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = VIOLET;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, r * 1.45, r * 0.4, -spin * 1.3, 0, TAU);
    ctx.stroke();
    // swirl streaks riding the outer ring
    ctx.fillStyle = black ? GOLD : LILAC;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = spin * 1.5 + (k * TAU) / 4;
      const px = b.x + Math.cos(a) * r * 1.9;
      const py = b.y + Math.sin(a) * r * 0.55;
      ctx.moveTo(px + 1.8, py);
      ctx.arc(px, py, 1.8, 0, TAU);
    }
    ctx.fill();
  }
  ctx.restore();
}

// One drone hull as a closed diamond sub-path (caller owns beginPath / fill / stroke).
function droneHull(ctx, d, time) {
  const y = d.y + Math.sin(time * 3 + d.phase) * 2.5;
  ctx.moveTo(d.x, y - 7);
  ctx.lineTo(d.x + 6.3, y);
  ctx.lineTo(d.x, y + 4.2);
  ctx.lineTo(d.x - 6.3, y);
  ctx.closePath();
}

// Wingman drones: small cyan craft with a magenta core, bobbing. Glow is faked with batched wide, faint shapes.
function drawDrones(ctx, drones, time) {
  const n = drones.length;
  ctx.save();
  ctx.lineJoin = 'round';

  // fake glow: one wide faint outline under all hulls
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let i = 0; i < n; i++) droneHull(ctx, drones[i], time);
  ctx.stroke();

  // crisp hulls: one fill and one stroke
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(77, 243, 255, 0.2)';
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) droneHull(ctx, drones[i], time);
  ctx.fill();
  ctx.stroke();

  // cores: one faint halo disc each, then solid cores
  ctx.fillStyle = 'rgba(255, 90, 209, 0.3)';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const d = drones[i];
    const y = d.y + Math.sin(time * 3 + d.phase) * 2.5;
    ctx.moveTo(d.x + 4.5, y);
    ctx.arc(d.x, y, 4.5, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = MAGENTA;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const d = drones[i];
    const y = d.y + Math.sin(time * 3 + d.phase) * 2.5;
    ctx.moveTo(d.x + 2.2, y);
    ctx.arc(d.x, y, 2.2, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
}

// Flat [x0,y0,x1,y1,...] polyline as a sub-path (caller owns beginPath / stroke).
function polyline(ctx, p) {
  ctx.moveTo(p[0], p[1]);
  for (let k = 2; k + 1 < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
}

// Transient fx: chain arcs (lightning, fade over 0.15 s), cluster blasts, black star detonations.
function drawFx(ctx, fx) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const n = fx.length;

  // arcs: fake glow first, one wide faint stroke batched over every arc
  let maxA = 0;
  ctx.strokeStyle = LILAC;
  ctx.lineWidth = 7;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const f = fx[i];
    if (f.type !== 'arc' || f.pts.length < 4) continue;
    const a = Math.max(0, f.life / f.maxLife);
    if (a > maxA) maxA = a;
    polyline(ctx, f.pts);
  }
  ctx.globalAlpha = 0.3 * maxA;
  ctx.stroke();

  // crisp arc cores, each with its own fade
  for (let i = 0; i < n; i++) {
    const f = fx[i];
    if (f.type !== 'arc' || f.pts.length < 4) continue;
    const a = Math.max(0, f.life / f.maxLife);
    ctx.globalAlpha = a;
    ctx.strokeStyle = LILAC;
    ctx.lineWidth = 3;
    ctx.beginPath();
    polyline(ctx, f.pts);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (let i = 0; i < n; i++) {
    const f = fx[i];
    const a = Math.max(0, f.life / f.maxLife);
    const grow = 1 - a;
    if (f.type === 'cluster') {
      const r = f.r * (0.35 + 0.65 * grow);
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = ORANGE;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#fff3b0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const ang = (k * Math.PI) / 4;
        ctx.moveTo(f.x + Math.cos(ang) * r * 0.3, f.y + Math.sin(ang) * r * 0.3);
        ctx.lineTo(f.x + Math.cos(ang) * r, f.y + Math.sin(ang) * r);
      }
      ctx.stroke();
    } else if (f.type === 'boom') {
      const r = f.r * (0.4 + 0.6 * grow);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, 'rgba(255, 209, 102, 0.6)');
      g.addColorStop(1, 'rgba(138, 92, 255, 0)');
      ctx.globalAlpha = a;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}
