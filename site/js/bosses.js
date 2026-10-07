// Boss encounters (chunk Q). Acts only through game.api and game fields.
// Glow budget: each boss draw makes at most 2 shadowBlur draws (one in practice). Everything else
// uses fake glow (wide, low-alpha strokes under the crisp line). Gradients are cached, not rebuilt.

const TAU = Math.PI * 2;
const ENRAGE_MUL = 1.35;
// entrance: spawn 560–720 px from the ship, fly in at 240 px/s until within 380 px (or 3 s)
const ENTER_SPEED = 240;
const ENTER_STOP = 380;
const ENTER_MAX_T = 3;
const ENTER_MIN = 560;
const ENTER_MAX = 720;

export const BOSS_NAMES = {
  mother: 'The Mother Rock',
  stormeye: 'Storm Eye',
  horizon: 'Event Horizon',
  glacier: 'Glacier King',
  phoenix: 'Ember Phoenix',
};

const STATS = {
  mother: { radius: 92, hp: 260 },
  stormeye: { radius: 66, hp: 300 },
  horizon: { radius: 78, hp: 380 },
  glacier: { radius: 100, hp: 450 },
  phoenix: { radius: 64, hp: 520 },
};

let nextBossId = 1000000;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}
function safeDt(dt) {
  if (!Number.isFinite(dt) || dt < 0) return 0;
  return dt > 0.05 ? 0.05 : dt;
}
function worldSize(game) {
  const w = game && game.world;
  return {
    w: w && Number.isFinite(w.w) ? w.w : 1500,
    h: w && Number.isFinite(w.h) ? w.h : 1500,
  };
}
function shipAlive(game) {
  return !!(game && game.ship && game.ship.alive);
}
function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
function sfxCall(game, name) {
  const s = game && game.api && game.api.sfx;
  if (s && typeof s[name] === 'function') s[name]();
}
function spawnRock(game, x, y, size, opts) {
  const api = game.api;
  if (api && typeof api.spawnAsteroid === 'function') api.spawnAsteroid(x, y, size, opts);
}
function spawnShard(game, x, y, vx, vy) {
  spawnRock(game, x, y, 1, { kind: 'shard', transient: true, vx, vy });
}

// Keep the boss circle inside the arena; reflect the outward velocity with factor 0.9.
function bounce(b, world) {
  const r = b.radius;
  const loX = r;
  const hiX = world.w - r;
  const loY = r;
  const hiY = world.h - r;
  if (hiX < loX) b.x = world.w / 2;
  else if (b.x < loX) { b.x = loX; if (b.vx < 0) b.vx = -b.vx * 0.9; }
  else if (b.x > hiX) { b.x = hiX; if (b.vx > 0) b.vx = -b.vx * 0.9; }
  if (hiY < loY) b.y = world.h / 2;
  else if (b.y < loY) { b.y = loY; if (b.vy < 0) b.vy = -b.vy * 0.9; }
  else if (b.y > hiY) { b.y = hiY; if (b.vy > 0) b.vy = -b.vy * 0.9; }
}

// Entrance point: inside the arena, 560–720 px from the ship. Prefers a point whose whole circle is
// outside the visible camera rect (tier 2), then one whose centre is outside it (tier 1), else any.
function entrancePoint(game, r, world) {
  const ship = game && game.ship;
  const sx = ship && Number.isFinite(ship.x) ? ship.x : world.w / 2;
  const sy = ship && Number.isFinite(ship.y) ? ship.y : world.h / 2;
  const cam = game && game.cam;
  const view = game && game.view;
  const z = game && game.zoom > 0 ? game.zoom : 1;
  const hasCam = !!(cam && view && Number.isFinite(cam.x) && Number.isFinite(cam.y) &&
    Number.isFinite(view.w) && Number.isFinite(view.h));
  const vw = hasCam ? view.w / z : 0;
  const vh = hasCam ? view.h / z : 0;
  const lo = r;
  const hiX = world.w - r;
  const hiY = world.h - r;
  if (hiX < lo || hiY < lo) return { x: world.w / 2, y: world.h / 2 };
  let best = null;
  let bestTier = -1;
  let seen = 0;
  for (let i = 0; i < 48; i++) {
    const a = (i + Math.random()) * (TAU / 48);
    const dist = rand(ENTER_MIN, ENTER_MAX);
    const x = sx + Math.cos(a) * dist;
    const y = sy + Math.sin(a) * dist;
    if (x < lo || x > hiX || y < lo || y > hiY) continue;
    let tier = 0;
    if (hasCam) {
      if (x + r < cam.x || x - r > cam.x + vw || y + r < cam.y || y - r > cam.y + vh) tier = 2;
      else if (x < cam.x || x > cam.x + vw || y < cam.y || y > cam.y + vh) tier = 1;
    }
    if (tier > bestTier) {
      bestTier = tier;
      best = [x, y];
      seen = 1;
    } else if (tier === bestTier) {
      seen++;
      if (Math.random() * seen < 1) best = [x, y];
    }
  }
  if (!best) {
    // no valid ring point (ship hard against an edge): clamp a point toward the arena centre
    const a = Math.atan2(world.h / 2 - sy, world.w / 2 - sx);
    best = [
      clamp(sx + Math.cos(a) * ENTER_MIN, lo, hiX),
      clamp(sy + Math.sin(a) * ENTER_MIN, lo, hiY),
    ];
  }
  return { x: best[0], y: best[1] };
}

// Jagged crack polylines in unit-radius coordinates (used by the Mother Rock).
function makeCracks(n) {
  const cracks = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i * TAU) / n + rand(-0.2, 0.2);
    const pts = [];
    for (let k = 1; k <= 4; k++) {
      const rr = 0.2 * k + rand(0, 0.07);
      const a = a0 + rand(-0.22, 0.22) * k;
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    cracks.push(pts);
  }
  return cracks;
}

// Flattened jagged bolt from the sky (y - 700) down to (x, y).
function makeBolt(x, y) {
  const pts = [];
  const segs = 10;
  for (let i = 0; i <= segs; i++) {
    const f = i / segs;
    const jit = i === 0 || i === segs ? 0 : rand(-22, 22);
    pts.push(x + jit, y - 700 + 700 * f);
  }
  return pts;
}

// ---------- creation ----------

export function createBoss(type, game, hpMul = 1) {
  const kind = STATS[type] ? type : 'mother';
  const base = STATS[kind];
  const world = worldSize(game);
  const mul = Number.isFinite(hpMul) && hpMul > 0 ? hpMul : 1;
  const hp = Math.max(1, Math.round(base.hp * mul));
  const p = entrancePoint(game, base.radius, world);
  const b = {
    id: nextBossId++,
    isBoss: true,
    type: kind,
    name: BOSS_NAMES[kind],
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    radius: base.radius,
    hp,
    maxHp: hp,
    hitFlash: 0,
    dead: false,
    t: 0,
    phase: 'enter', // 'enter' (flying in, no attacks) -> 'live'
    enterT: 0,
    enraged: false,
    cd: 0,
    seed: rand(0, 100),
  };
  const ship = game && game.ship;
  if (kind === 'mother') {
    b.cd = 3.2;
    b.lumps = [];
    for (let i = 0; i < 26; i++) b.lumps.push(rand(0.9, 1.08));
    b.cracks = makeCracks(6);
  } else if (kind === 'stormeye') {
    b.theta = ship ? Math.atan2(b.y - ship.y, b.x - ship.x) : 0;
    b.cd = 2.6;
    b.strikeCd = 2.6;
    b.strike = null;
    b.bolt = null;
    b.ringOff = 0;
  } else if (kind === 'horizon') {
    b.phi = Math.atan2(b.y - world.h / 2, b.x - world.w / 2);
    b.cd = 3;
    b.spin = 0;
  } else if (kind === 'glacier') {
    const a = rand(0, TAU);
    b.vx = Math.cos(a) * 90;
    b.vy = Math.sin(a) * 90;
    b.cd = 2.8;
    b.crystalCd = 6;
  } else if (kind === 'phoenix') {
    b.state = 'rest';
    b.timer = 1.2;
    b.dirX = 1;
    b.dirY = 0;
    b.face = 0;
    b.wake = 0;
    b.wakeT = 0;
  }
  return b;
}

// ---------- entrance ----------

// Fly toward the ship at ENTER_SPEED until within ENTER_STOP (or ENTER_MAX_T passes). No attacks, no
// shards, no hurtShip. Velocity points at the ship so the normal behaviour can pick it up smoothly.
function updEnter(b, game, world, d) {
  const ship = game.ship;
  b.enterT += d;
  const sx = ship && Number.isFinite(ship.x) ? ship.x : world.w / 2;
  const sy = ship && Number.isFinite(ship.y) ? ship.y : world.h / 2;
  const dx = sx - b.x;
  const dy = sy - b.y;
  const dist = Math.hypot(dx, dy);
  // the half-pixel tolerance stops float overshoot (380.0000001) from stalling the boss at the stop ring
  if (dist <= ENTER_STOP + 0.5 || b.enterT >= ENTER_MAX_T) {
    settleEntry(b, game, world);
    return;
  }
  const ux = dx / dist;
  const uy = dy / dist;
  const step = Math.min(ENTER_SPEED * d, dist - ENTER_STOP);
  b.vx = ux * ENTER_SPEED;
  b.vy = uy * ENTER_SPEED;
  b.x += ux * step;
  b.y += uy * step;
  bounce(b, world);
  if (b.type === 'phoenix') b.face = Math.atan2(uy, ux);
}

// End of entrance: seed the per-type state from where the boss actually is, so the pattern eases in
// (stormeye radius and horizon radius ease toward their rings) instead of snapping.
function settleEntry(b, game, world) {
  b.phase = 'live';
  b.spd = Math.hypot(b.vx, b.vy); // glacier eases its speed down from the flight speed
  const ship = game.ship;
  if (b.type === 'horizon') {
    const cx = world.w / 2;
    const cy = world.h / 2;
    b.phi = Math.atan2(b.y - cy, b.x - cx);
    b.orbitR = Math.hypot(b.x - cx, b.y - cy);
  } else if (b.type === 'stormeye') {
    const sx = ship ? ship.x : world.w / 2;
    const sy = ship ? ship.y : world.h / 2;
    b.theta = Math.atan2(b.y - sy, b.x - sx);
    b.orbitR = Math.hypot(b.x - sx, b.y - sy);
  }
}

// ---------- per-type updates ----------

function updMother(b, game, world, d, mul, alive) {
  const ship = game.ship;
  const speed = 40 * mul;
  if (alive) {
    const dx = ship.x - b.x;
    const dy = ship.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const k = Math.min(1, 1.2 * d);
      b.vx += ((dx / dist) * speed - b.vx) * k;
      b.vy += ((dy / dist) * speed - b.vy) * k;
    }
  } else {
    const k = Math.min(1, 0.6 * d);
    b.vx -= b.vx * k;
    b.vy -= b.vy * k;
  }
  b.x += b.vx * d;
  b.y += b.vy * d;
  bounce(b, world);
  if (!alive) return;
  b.cd -= d;
  if (b.cd <= 0) {
    b.cd += b.enraged ? 2.4 : 3.2;
    const n = b.enraged ? 3 : 2;
    const base = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = base + (i * TAU) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      spawnRock(game, b.x + c * (b.radius + 30), b.y + s * (b.radius + 30), 2, {
        vx: c * 110,
        vy: s * 110,
      });
    }
  }
}

function updStormeye(b, game, world, d, mul, alive) {
  const ship = game.ship;
  const R = 300;
  if (b.orbitR === undefined) b.orbitR = R;
  b.orbitR += (R - b.orbitR) * (1 - Math.exp(-1.5 * d)); // ease onto the ring after entering
  const px = b.x;
  const py = b.y;
  // orbit the ship (or the arena centre when the ship is dead, so it keeps moving)
  let cx = world.w / 2;
  let cy = world.h / 2;
  let rate = 0.2;
  if (alive) {
    cx = ship.x;
    cy = ship.y;
    rate = 0.6 * mul;
  }
  b.theta = (b.theta || 0) + rate * d;
  b.x = cx + Math.cos(b.theta) * b.orbitR;
  b.y = cy + Math.sin(b.theta) * b.orbitR;
  bounce(b, world);
  if (d > 0) {
    b.vx = (b.x - px) / d;
    b.vy = (b.y - py) / d;
  }
  if (!alive) {
    b.strike = null;
    b.bolt = null;
    return;
  }
  // shard ring
  b.cd -= d;
  if (b.cd <= 0) {
    b.cd += 2.6;
    const n = b.enraged ? 12 : 8;
    b.ringOff = (b.ringOff || 0) + 0.25;
    for (let i = 0; i < n; i++) {
      const a = b.ringOff + (i * TAU) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      spawnShard(game, b.x + c * (b.radius + 8), b.y + s * (b.radius + 8), c * 210, s * 210);
    }
  }
  // enraged: telegraphed lightning on the ship's position
  if (b.enraged) {
    if (b.strikeCd === undefined) b.strikeCd = 2.6;
    b.strikeCd -= d;
    if (b.strikeCd <= 0 && !b.strike) {
      b.strikeCd += 2.6;
      b.strike = { x: ship.x, y: ship.y, t: 0 };
    }
  }
  if (b.strike) {
    b.strike.t += d;
    if (b.strike.t >= 1.2) {
      const s = b.strike;
      b.strike = null;
      if (Math.hypot(ship.x - s.x, ship.y - s.y) < 70) game.api.hurtShip(s.x, s.y);
      b.bolt = { x: s.x, y: s.y, t: 0, pts: makeBolt(s.x, s.y) };
      game.api.ring(s.x, s.y, 70, '#ffffff', 0.3);
      game.api.shake(0.2, 4);
      sfxCall(game, 'lightning');
    }
  }
  if (b.bolt) {
    b.bolt.t += d;
    if (b.bolt.t > 0.3) b.bolt = null;
  }
}

function updHorizon(b, game, world, d, mul, alive) {
  const cx = world.w / 2;
  const cy = world.h / 2;
  const Rt = Math.min(world.w, world.h) * 0.22;
  if (b.orbitR === undefined) b.orbitR = Rt;
  // ease the orbit radius onto the ring (smooth drift back after entering, never a teleport)
  b.orbitR += (Rt - b.orbitR) * (1 - Math.exp(-1.2 * d));
  const px = b.x;
  const py = b.y;
  b.phi = (b.phi || 0) + 0.15 * mul * d;
  b.x = cx + Math.cos(b.phi) * b.orbitR;
  b.y = cy + Math.sin(b.phi) * b.orbitR;
  bounce(b, world);
  if (d > 0) {
    b.vx = (b.x - px) / d;
    b.vy = (b.y - py) / d;
  }
  if (!alive) return;
  const ship = game.ship;
  // gravitational pull on the ship
  const dx = b.x - ship.x;
  const dy = b.y - ship.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 1 && dist < 1400) {
    const a = 90 * d;
    ship.vx += (dx / dist) * a;
    ship.vy += (dy / dist) * a;
  }
  // 4-arm rotating spiral burst
  b.cd -= d;
  if (b.cd <= 0) {
    b.cd += b.enraged ? 2.2 : 3.0;
    b.spin = (b.spin || 0) + 0.5;
    for (let arm = 0; arm < 4; arm++) {
      for (let j = 0; j < 6; j++) {
        const a = b.spin + (arm * TAU) / 4 + j * 0.22;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const sp = 150 + j * 22;
        spawnShard(game, b.x + c * (b.radius + 8), b.y + s * (b.radius + 8), c * sp, s * sp);
      }
    }
  }
}

function updGlacier(b, game, world, d, mul, alive) {
  const want = 90 * mul;
  if (b.spd === undefined) b.spd = want;
  b.spd += (want - b.spd) * (1 - Math.exp(-2 * d)); // speed eases (enrage, or leaving the entrance)
  let mag = Math.hypot(b.vx, b.vy);
  if (mag < 1) {
    const a = rand(0, TAU);
    b.vx = Math.cos(a);
    b.vy = Math.sin(a);
    mag = 1;
  }
  b.vx = (b.vx / mag) * b.spd;
  b.vy = (b.vy / mag) * b.spd;
  b.x += b.vx * d;
  b.y += b.vy * d;
  bounce(b, world);
  if (!alive) return;
  const ship = game.ship;
  b.cd -= d;
  if (b.cd <= 0) {
    b.cd += 2.8;
    const aim = Math.atan2(ship.y - b.y, ship.x - b.x);
    for (let k = 0; k < 5; k++) {
      const a = aim + (k - 2) * 0.15;
      const c = Math.cos(a);
      const s = Math.sin(a);
      spawnShard(game, b.x + c * (b.radius + 8), b.y + s * (b.radius + 8), c * 240, s * 240);
    }
  }
  if (b.enraged) {
    if (b.crystalCd === undefined) b.crystalCd = 6;
    b.crystalCd -= d;
    if (b.crystalCd <= 0) {
      b.crystalCd += 6;
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU);
        const c = Math.cos(a);
        const s = Math.sin(a);
        spawnRock(game, b.x + c * (b.radius + 30), b.y + s * (b.radius + 30), 2, {
          kind: 'crystal',
          vx: c * 80,
          vy: s * 80,
        });
      }
    }
  }
}

function updPhoenix(b, game, world, d, mul, alive) {
  const period = b.enraged ? 1.6 : 2.4;
  const restDur = Math.max(0.1, period - 1.5);

  if (b.state === 'dash') {
    b.x += b.vx * d;
    b.y += b.vy * d;
    bounce(b, world);
    // wake: 6 shards left behind, one every 0.1 s
    b.wakeT += d;
    while (b.wakeT >= 0.1 && b.wake < 6) {
      b.wakeT -= 0.1;
      b.wake++;
      const a = rand(0, TAU);
      spawnShard(game, b.x, b.y, Math.cos(a) * 60, Math.sin(a) * 60);
    }
    b.timer -= d;
    if (b.timer <= 0) {
      while (b.wake < 6) {
        b.wake++;
        const a = rand(0, TAU);
        spawnShard(game, b.x, b.y, Math.cos(a) * 60, Math.sin(a) * 60);
      }
      b.state = 'rest';
      b.timer = restDur;
    }
    return;
  }

  // hover: velocity damps out, position holds
  const k = Math.exp(-6 * d);
  b.vx *= k;
  b.vy *= k;
  b.x += b.vx * d;
  b.y += b.vy * d;
  bounce(b, world);

  if (!alive) {
    // no telegraphs against a dead ship: cancel and freeze the cycle
    if (b.state === 'tele') {
      b.state = 'rest';
      b.timer = restDur;
    }
    return;
  }

  const ship = game.ship;
  if (b.state === 'rest') {
    const want = Math.atan2(ship.y - b.y, ship.x - b.x);
    b.face += wrapAngle(want - b.face) * Math.min(1, 4 * d);
  }
  b.timer -= d;
  if (b.state === 'rest' && b.timer <= 0) {
    const dx = ship.x - b.x;
    const dy = ship.y - b.y;
    const dist = Math.hypot(dx, dy) || 1;
    b.dirX = dx / dist;
    b.dirY = dy / dist;
    b.face = Math.atan2(b.dirY, b.dirX);
    b.state = 'tele';
    b.timer = 0.9;
  } else if (b.state === 'tele' && b.timer <= 0) {
    const sp = 700 * mul;
    b.state = 'dash';
    b.timer = 0.6;
    b.wake = 0;
    b.wakeT = 0;
    b.vx = b.dirX * sp;
    b.vy = b.dirY * sp;
  }
}

// ---------- update entry point ----------

export function updateBoss(boss, game, dt) {
  if (!boss || boss.dead || !game) return;
  const d = safeDt(dt);
  boss.t = (boss.t || 0) + d;
  boss.hitFlash = Math.max(0, (boss.hitFlash || 0) - d);
  if (!boss.enraged && boss.hp <= boss.maxHp * 0.5) {
    boss.enraged = true;
    if (game.api && typeof game.api.banner === 'function') {
      game.api.banner(boss.name + ' ENRAGED', 2000);
    }
    sfxCall(game, 'enrage');
  }
  const world = worldSize(game);
  if (boss.phase === 'enter') {
    updEnter(boss, game, world, d);
    return;
  }
  const alive = shipAlive(game);
  const mul = boss.enraged ? ENRAGE_MUL : 1;
  switch (boss.type) {
    case 'stormeye': updStormeye(boss, game, world, d, mul, alive); break;
    case 'horizon': updHorizon(boss, game, world, d, mul, alive); break;
    case 'glacier': updGlacier(boss, game, world, d, mul, alive); break;
    case 'phoenix': updPhoenix(boss, game, world, d, mul, alive); break;
    case 'mother':
    default: updMother(boss, game, world, d, mul, alive); break;
  }
}

// ---------- drawing (world space) ----------

const WHITE = '#ffffff';

// Gradients depend only on radius and colour state, so each is built once and reused.
const gradCache = new Map();
function cachedGradient(key, make) {
  let g = gradCache.get(key);
  if (!g) {
    g = make();
    gradCache.set(key, g);
  }
  return g;
}

function pulse(t, speed, phase = 0) {
  return 0.5 + 0.5 * Math.sin(t * speed + phase);
}

function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
}

// Fake glow: a wide faint halo, then the crisp ring. No shadowBlur.
function drawEnrageAura(ctx, b, t, color) {
  if (!b.enraged) return;
  const p = pulse(t, 6);
  const rr = b.radius * (1.18 + 0.05 * p);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.12 + 0.1 * p;
  ctx.lineWidth = 14 + 6 * p;
  ctx.beginPath();
  ctx.arc(0, 0, rr, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.35 + 0.35 * p;
  ctx.lineWidth = 4 + 3 * p;
  ctx.beginPath();
  ctx.arc(0, 0, rr, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// --- Mother Rock: lumpy rock, magma glow, glowing cracks ---

function lumpPath(ctx, b) {
  const r = b.radius;
  const lumps = b.lumps;
  const n = lumps.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i * TAU) / n;
    const rr = r * lumps[i];
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawMother(ctx, b, t, flash) {
  const r = b.radius;
  const p = pulse(t, 2.2, b.seed);
  const edge = flash ? WHITE : b.enraged ? '#ff8fa3' : '#b9a7ff';
  const crackCol = flash ? WHITE : b.enraged ? '#ff3355' : '#ff5ad1';
  ctx.save();
  ctx.translate(b.x, b.y);
  // body
  lumpPath(ctx, b);
  ctx.fillStyle = flash ? WHITE : '#1a1636';
  ctx.fill();
  // magma glow clipped to the body
  ctx.save();
  lumpPath(ctx, b);
  ctx.clip();
  const g = cachedGradient(`mo|${r}|${flash ? 1 : 0}|${b.enraged ? 1 : 0}`, () => {
    const gr = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 0.95);
    gr.addColorStop(0, flash ? WHITE : b.enraged ? 'rgba(255, 60, 90, 0.7)' : 'rgba(255, 122, 61, 0.55)');
    gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
    return gr;
  });
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.6 + 0.4 * p;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
  // rim
  lumpPath(ctx, b);
  ctx.lineWidth = 5;
  ctx.strokeStyle = edge;
  ctx.stroke();
  // glowing cracks: one batched path, the single shadow pass of this boss
  const cracks = b.cracks;
  const count = b.enraged ? cracks.length : 4;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = crackCol;
  ctx.shadowColor = crackCol;
  ctx.shadowBlur = 14;
  ctx.globalAlpha = 0.6 + 0.4 * p;
  ctx.beginPath();
  for (let c = 0; c < count && c < cracks.length; c++) {
    const pts = cracks[c];
    ctx.moveTo(pts[0].x * r, pts[0].y * r);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x * r, pts[k].y * r);
  }
  ctx.stroke();
  ctx.restore();
  drawEnrageAura(ctx, b, t, '#ff4d6d');
}

// --- Storm Eye: crackling eye orb, telegraphed strike ---

function drawStormeyeTelegraph(ctx, b, t) {
  if (b.strike) {
    const s = b.strike;
    const p = clamp(s.t / 1.2, 0, 1);
    ctx.save();
    ctx.strokeStyle = '#b8a9ff';
    ctx.fillStyle = 'rgba(184, 169, 255, 0.18)';
    ctx.lineWidth = 2 + 3 * p;
    ctx.globalAlpha = 0.35 + 0.5 * p;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 70 * (1 + 0.06 * pulse(t, 16)), 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(4, 70 * (1 - p)), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  if (b.bolt) {
    const f = clamp(1 - b.bolt.t / 0.3, 0, 1);
    const pts = b.bolt.pts;
    ctx.save();
    ctx.lineJoin = 'round';
    // fake glow: wide lilac under a white core
    tracePoly(ctx, pts);
    ctx.globalAlpha = 0.3 * f;
    ctx.strokeStyle = '#b8a9ff';
    ctx.lineWidth = 14;
    ctx.stroke();
    tracePoly(ctx, pts);
    ctx.globalAlpha = f;
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }
}

function drawStormeye(ctx, b, t, flash) {
  const r = b.radius;
  const enr = b.enraged;
  const edge = flash ? WHITE : enr ? '#ff4d6d' : '#b8a9ff';
  ctx.save();
  ctx.translate(b.x, b.y);
  // sphere
  const g = cachedGradient(`se|${r}|${flash ? 1 : 0}`, () => {
    const gr = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
    gr.addColorStop(0, flash ? WHITE : '#f3eeff');
    gr.addColorStop(0.45, flash ? WHITE : '#7c63d6');
    gr.addColorStop(1, flash ? WHITE : '#120a2a');
    return gr;
  });
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  // rim with fake glow (wide faint pass under the crisp one)
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.strokeStyle = edge;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 4;
  ctx.stroke();
  // iris and pupil
  const eyeR = r * 0.5;
  const ig = cachedGradient(`si|${r}|${flash ? 1 : 0}|${enr ? 1 : 0}`, () => {
    const gr = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, eyeR);
    gr.addColorStop(0, WHITE);
    gr.addColorStop(0.6, flash ? WHITE : '#b8a9ff');
    gr.addColorStop(1, flash ? WHITE : enr ? '#ff4d6d' : '#5b3fb0');
    return gr;
  });
  ctx.beginPath();
  ctx.arc(0, 0, eyeR, 0, TAU);
  ctx.fillStyle = ig;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.16, 0, TAU);
  ctx.fillStyle = '#05020f';
  ctx.fill();
  // crackling arcs around the eye (re-jittered each frame): the one shadow pass of this boss
  const nArcs = enr ? 5 : 3;
  ctx.strokeStyle = flash ? WHITE : enr ? '#ffd1dc' : '#e9e2ff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#b8a9ff';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  for (let i = 0; i < nArcs; i++) {
    const a0 = Math.random() * TAU;
    for (let seg = 0; seg < 5; seg++) {
      const a = a0 + seg * 0.22 + rand(-0.08, 0.08);
      const rr = eyeR * 1.1 + (seg % 2 ? 14 : -4) + rand(0, 10);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (seg === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
  drawEnrageAura(ctx, b, t, '#ff4d6d');
}

// --- Event Horizon: dark disc, magenta photon ring, lensing arc ---

function drawHorizon(ctx, b, t, flash) {
  const r = b.radius;
  const enr = b.enraged;
  const ring = flash ? WHITE : enr ? '#ff4d6d' : '#ff5ad1';
  const p = pulse(t, enr ? 7 : 3, b.seed);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = flash ? WHITE : '#050308';
  ctx.fill();
  // photon ring: the one shadow pass of this boss
  ctx.lineWidth = 6;
  ctx.strokeStyle = ring;
  ctx.shadowColor = ring;
  ctx.shadowBlur = 22;
  ctx.globalAlpha = 0.85 + 0.15 * p;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.03, 0, TAU);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = flash ? WHITE : '#ffd6f2';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.97, 0, TAU);
  ctx.stroke();
  // lensing highlight: bright front arc and dimmer back arc, rotating
  const spin = t * (enr ? 2.2 : 1.1);
  ctx.lineWidth = 4;
  ctx.strokeStyle = flash ? WHITE : '#ffb3e6';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.1, spin, spin + 0.9);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.1, spin + Math.PI, spin + Math.PI + 0.5);
  ctx.stroke();
  ctx.restore();
  drawEnrageAura(ctx, b, t, '#ff4d6d');
}

// --- Glacier King: faceted ice crown ---

function glacierSpikePath(ctx, n, r, rim, spikeMul, parity) {
  for (let k = parity; k < n; k += 2) {
    const a0 = (k * TAU) / n;
    const a1 = ((k + 1) * TAU) / n;
    const am = (a0 + a1) / 2;
    const tipR = r * (k % 2 ? 1.22 : 1.42) * spikeMul;
    ctx.moveTo(Math.cos(a0) * rim, Math.sin(a0) * rim);
    ctx.lineTo(Math.cos(am) * tipR, Math.sin(am) * tipR);
    ctx.lineTo(Math.cos(a1) * rim, Math.sin(a1) * rim);
    ctx.closePath();
  }
}

function drawGlacier(ctx, b, t, flash) {
  const r = b.radius;
  const enr = b.enraged;
  const n = 8;
  const rim = r * 0.82;
  const spikeMul = enr ? 1.22 : 1;
  const ice = flash ? WHITE : '#9fe8ff';
  const deep = flash ? WHITE : '#3fa9d6';
  ctx.save();
  ctx.translate(b.x, b.y);
  // spikes: two batched fills (alternating colours, no shadow)
  for (let parity = 0; parity < 2; parity++) {
    ctx.beginPath();
    glacierSpikePath(ctx, n, r, rim, spikeMul, parity);
    ctx.globalAlpha = parity ? 0.9 : 0.7;
    ctx.fillStyle = parity ? ice : deep;
    ctx.fill();
  }
  // all spike outlines in one path: the one shadow pass of this boss
  ctx.globalAlpha = 1;
  ctx.beginPath();
  glacierSpikePath(ctx, n, r, rim, spikeMul, 0);
  glacierSpikePath(ctx, n, r, rim, spikeMul, 1);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = flash ? WHITE : '#e8fbff';
  ctx.shadowColor = enr ? '#e8fbff' : '#9fe8ff';
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // body disc with inner facets
  ctx.beginPath();
  ctx.arc(0, 0, rim, 0, TAU);
  ctx.fillStyle = flash ? WHITE : '#10283a';
  ctx.fill();
  ctx.strokeStyle = ice;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = (k * TAU) / n;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * rim * 0.95, Math.sin(a) * rim * 0.95);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  // frosty core
  const g = cachedGradient(`gl|${r}|${flash ? 1 : 0}`, () => {
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rim * 0.6);
    gr.addColorStop(0, flash ? WHITE : 'rgba(232, 251, 255, 0.6)');
    gr.addColorStop(1, 'rgba(232, 251, 255, 0)');
    return gr;
  });
  ctx.beginPath();
  ctx.arc(0, 0, rim * 0.6, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  // crown ring
  ctx.beginPath();
  ctx.arc(0, 0, rim, 0, TAU);
  ctx.lineWidth = 3;
  ctx.strokeStyle = flash ? WHITE : '#e8fbff';
  ctx.stroke();
  ctx.restore();
  drawEnrageAura(ctx, b, t, '#9fe8ff');
}

// --- Ember Phoenix: flaming wings, body, head ---

function drawPhoenixTelegraph(ctx, b, t, flash) {
  if (b.state !== 'tele') return;
  const p = clamp(1 - b.timer / 0.9, 0, 1);
  const L = 900;
  ctx.save();
  ctx.setLineDash([22, 12]);
  ctx.lineDashOffset = -t * 80;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x + b.dirX * L, b.y + b.dirY * L);
  // fake glow: wide faint dashed underlay, then the crisp dashed line
  ctx.strokeStyle = '#ff7a3d';
  ctx.globalAlpha = (0.35 + 0.6 * p) * 0.25;
  ctx.lineWidth = (4 + 10 * p) * 3;
  ctx.stroke();
  ctx.strokeStyle = flash ? WHITE : '#ffd166';
  ctx.globalAlpha = 0.35 + 0.6 * p;
  ctx.lineWidth = 4 + 10 * p;
  ctx.stroke();
  ctx.restore();
}

function drawPhoenix(ctx, b, t, flash) {
  const r = b.radius;
  const enr = b.enraged;
  const flap = Math.sin(t * (enr ? 11 : 6)) * 0.7;
  const flick = 0.8 + 0.2 * Math.sin(t * 30 + b.seed);
  const Rw = r * 2.1;
  ctx.save();
  if (b.state === 'dash') {
    // fiery streak behind the dash
    ctx.lineCap = 'round';
    ctx.strokeStyle = flash ? WHITE : '#ff7a3d';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = r * 0.8;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.15, b.y - b.vy * 0.15);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.translate(b.x, b.y);
  ctx.rotate(b.face || 0);
  // fake glow halo around the body (two faint lighter ellipses, no blur)
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = enr ? '#ff4d6d' : '#ff7a3d';
  ctx.globalAlpha = 0.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.3, r * 0.85, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.14;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.05, r * 0.66, 0, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // tail flames
  for (let i = 0; i < 3; i++) {
    const dy = (i - 1) * r * 0.25;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, dy - r * 0.12);
    ctx.lineTo(-r * (1.5 + 0.4 * flick * (i === 1 ? 1 : 0.6)), dy);
    ctx.lineTo(-r * 0.6, dy + r * 0.12);
    ctx.closePath();
    ctx.fillStyle = flash ? WHITE : i === 1 ? '#ffd166' : '#ff7a3d';
    ctx.globalAlpha = 0.75;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // wings (radial gradient from the root, so one cached gradient serves any flap angle)
  const wg = cachedGradient(`pw|${r}|${flash ? 1 : 0}`, () => {
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, Rw);
    gr.addColorStop(0, flash ? WHITE : '#ffd166');
    gr.addColorStop(0.6, flash ? WHITE : '#ff7a3d');
    gr.addColorStop(1, flash ? WHITE : '#ff4d6d');
    return gr;
  });
  for (let s = -1; s <= 1; s += 2) {
    const th = s * (Math.PI / 2 + 0.6 - 0.5 * flap);
    const tx = Math.cos(th) * Rw;
    const ty = Math.sin(th) * Rw;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(tx * 0.5 + r * 0.3, ty * 0.55, tx, ty);
    ctx.quadraticCurveTo(tx * 0.6 + r * 0.2, ty * 0.45, r * 0.1, s * r * 0.2);
    ctx.closePath();
    ctx.fillStyle = wg;
    ctx.fill();
    // flame feather tips along the trailing edge
    ctx.fillStyle = flash ? WHITE : '#ffd166';
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const f = 0.55 + k * 0.18;
      const fx = tx * f;
      const fy = ty * f;
      ctx.moveTo(fx + r * 0.15, fy);
      ctx.lineTo(fx - r * 0.25, fy + s * r * 0.3);
      ctx.lineTo(fx - r * 0.05, fy - s * r * 0.05);
    }
    ctx.fill();
  }
  // body: the one shadow pass of this boss
  const bg = cachedGradient(`pb|${r}|${flash ? 1 : 0}`, () => {
    const gr = ctx.createLinearGradient(-r, 0, r, 0);
    gr.addColorStop(0, flash ? WHITE : '#ff4d6d');
    gr.addColorStop(0.5, flash ? WHITE : '#ff7a3d');
    gr.addColorStop(1, flash ? WHITE : '#ffd166');
    return gr;
  });
  ctx.shadowColor = enr ? '#ff4d6d' : '#ff7a3d';
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.95, r * 0.5, 0, 0, TAU);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowBlur = 0;
  // head, beak, eye
  ctx.beginPath();
  ctx.arc(r * 0.7, 0, r * 0.34, 0, TAU);
  ctx.fillStyle = flash ? WHITE : '#ffd166';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(r * 1.0, -r * 0.1);
  ctx.lineTo(r * 1.32, 0);
  ctx.lineTo(r * 1.0, r * 0.1);
  ctx.closePath();
  ctx.fillStyle = flash ? WHITE : '#ff9f43';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r * 0.78, -r * 0.1, r * 0.07, 0, TAU);
  ctx.fillStyle = '#05020f';
  ctx.fill();
  ctx.restore();
  drawEnrageAura(ctx, b, t, enr ? '#ffd166' : '#ff7a3d');
}

// ---------- public draw ----------

export function drawBoss(ctx, boss, time) {
  if (!ctx || !boss) return;
  const t = Number.isFinite(time) ? time : boss.t || 0;
  const flash = (boss.hitFlash || 0) > 0;
  ctx.save();
  switch (boss.type) {
    case 'stormeye':
      drawStormeyeTelegraph(ctx, boss, t);
      drawStormeye(ctx, boss, t, flash);
      break;
    case 'horizon':
      drawHorizon(ctx, boss, t, flash);
      break;
    case 'glacier':
      drawGlacier(ctx, boss, t, flash);
      break;
    case 'phoenix':
      drawPhoenixTelegraph(ctx, boss, t, flash);
      drawPhoenix(ctx, boss, t, flash);
      break;
    case 'mother':
    default:
      drawMother(ctx, boss, t, flash);
      break;
  }
  ctx.restore();
}
