const TAU = Math.PI * 2;
const MAX_PARTICLES = 600;
const TRAIL_MAX = 8;

const CYAN = '#4df3ff';
const YELLOW = '#ffe66d';
const ASTEROID_FILL = '#1a1636';
const ASTEROID_STROKE = '#b9a7ff';
const GREEN = '#5dff9b';
const ORANGE = '#ff9f43';
const MAGENTA = '#ff5ad1';
const SHIELD = '#6db8ff';

const rand = (a, b) => a + Math.random() * (b - a);

function normAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function turnToward(obj, target, maxStep) {
  const diff = normAngle(target - obj.angle);
  if (Math.abs(diff) <= maxStep) obj.angle = target;
  else obj.angle += Math.sign(diff) * maxStep;
  obj.angle = normAngle(obj.angle);
}

const mod = (v, m) => ((v % m) + m) % m;

export function wrap(o, world) {
  const r = o.radius || 0;
  if (o.x < -r) o.x += world.w + 2 * r;
  else if (o.x > world.w + r) o.x -= world.w + 2 * r;
  if (o.y < -r) o.y += world.h + 2 * r;
  else if (o.y > world.h + r) o.y -= world.h + 2 * r;
}

export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// --- ship ---

export function createShip(x, y, stats) {
  return {
    x, y, vx: 0, vy: 0,
    angle: -Math.PI / 2,
    radius: 12,
    hull: stats.maxHull,
    shield: stats.shieldMax,
    shieldTimer: 0,
    invuln: 0,
    fireTimer: 0,
    missileTimer: 0,
    novaTimer: 0,
    thrusting: false,
    alive: true,
  };
}

export function updateShip(ship, input, stats, dt, world) {
  const stick = input.stick;
  const mag = stick.active ? Math.hypot(stick.x, stick.y) : 0;

  if (mag > 0.2) turnToward(ship, Math.atan2(stick.y, stick.x), stats.turnSpeed * 1.6 * dt);
  if (input.left) ship.angle -= stats.turnSpeed * dt;
  if (input.right) ship.angle += stats.turnSpeed * dt;
  ship.angle = normAngle(ship.angle);

  let power = input.thrust ? 1 : 0;
  if (mag > 0.35 && mag > power) power = mag;
  ship.thrusting = power > 0;
  if (power > 0) {
    const a = stats.thrust * power * dt;
    ship.vx += Math.cos(ship.angle) * a;
    ship.vy += Math.sin(ship.angle) * a;
  }

  const sp = Math.hypot(ship.vx, ship.vy);
  if (sp > stats.maxSpeed) {
    const k = stats.maxSpeed / sp;
    ship.vx *= k;
    ship.vy *= k;
  }
  const drag = Math.pow(0.55, dt);
  ship.vx *= drag;
  ship.vy *= drag;

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  wrap(ship, world);

  ship.invuln = Math.max(0, ship.invuln - dt);
  if (ship.shield < stats.shieldMax) {
    ship.shieldTimer += dt;
    if (ship.shieldTimer >= stats.shieldRecharge) {
      ship.shield += 1;
      ship.shieldTimer = 0;
    }
  } else {
    ship.shieldTimer = 0;
  }
}

export function drawShip(ctx, ship, stats, time) {
  if (!ship.alive) return;
  const r = ship.radius;
  const shields = Math.floor(ship.shield);

  ctx.save();
  ctx.translate(ship.x, ship.y);

  if (shields > 0) {
    ctx.shadowColor = SHIELD;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = SHIELD;
    ctx.lineWidth = 2;
    for (let i = 0; i < shields; i++) {
      ctx.globalAlpha = 0.65 + 0.2 * Math.sin(time * 4 + i * 1.3);
      ctx.beginPath();
      ctx.arc(0, 0, r + 9 + i * 5, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  const blink = ship.invuln > 0 && Math.floor(time * 10) % 2 === 0;
  if (!blink) {
    ctx.rotate(ship.angle);

    if (ship.thrusting) {
      const len = r * (1.1 + 0.35 * Math.sin(time * 53) + 0.2 * Math.sin(time * 29 + 1));
      ctx.shadowColor = ORANGE;
      ctx.shadowBlur = 10;
      ctx.fillStyle = ORANGE;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.45);
      ctx.lineTo(-r * 0.5 - len * 1.1, 0);
      ctx.lineTo(-r * 0.5, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.2);
      ctx.lineTo(-r * 0.5 - len * 0.6, 0);
      ctx.lineTo(-r * 0.5, r * 0.2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(r * 1.3, 0);
    ctx.lineTo(-r * 0.9, r * 0.85);
    ctx.lineTo(-r * 0.9, -r * 0.85);
    ctx.closePath();
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(77, 243, 255, 0.15)';
    ctx.fill();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  ctx.restore();
}

// --- bullets (player only) ---

export function createBullet(x, y, angle, stats, inheritVx = 0, inheritVy = 0) {
  return {
    x, y,
    vx: Math.cos(angle) * stats.bulletSpeed + inheritVx * 0.5,
    vy: Math.sin(angle) * stats.bulletSpeed + inheritVy * 0.5,
    life: stats.bulletLife,
    radius: 2.5,
    damage: stats.bulletDamage,
    pierceLeft: stats.pierce,
    hitIds: [],
    dead: false,
  };
}

export function updateBullet(b, dt, world) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  wrap(b, world);
  b.life -= dt;
  if (b.life <= 0) b.dead = true;
}

export function drawBullets(ctx, bullets) {
  if (!bullets.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const b of bullets) {
    if (b.dead) continue;
    ctx.moveTo(b.x - b.vx * 0.035, b.y - b.vy * 0.035);
    ctx.lineTo(b.x, b.y);
  }
  ctx.shadowColor = YELLOW;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fffbe0';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// --- asteroids ---

export const ASTEROID_SIZES = {
  3: { radius: 44, hp: 3, score: 20, gems: 3 },
  2: { radius: 26, hp: 2, score: 50, gems: 2 },
  1: { radius: 14, hp: 1, score: 100, gems: 1 },
};

let nextAsteroidId = 1;

export function createAsteroid(x, y, size, speedMul = 1, vx, vy) {
  const def = ASTEROID_SIZES[size];
  if (vx === undefined || vy === undefined) {
    const dir = rand(0, TAU);
    const sp = rand(35, 85) * speedMul;
    vx = Math.cos(dir) * sp;
    vy = Math.sin(dir) * sp;
  }
  const n = 10 + Math.floor(Math.random() * 5);
  const shape = new Array(n);
  for (let i = 0; i < n; i++) shape[i] = rand(0.75, 1.15);
  const hp = def.hp + Math.floor((speedMul - 1) * 3);
  return {
    id: nextAsteroidId++,
    x, y, vx, vy,
    size,
    radius: def.radius,
    hp,
    maxHp: hp,
    angle: rand(0, TAU),
    spin: rand(-1.2, 1.2),
    shape,
    hitFlash: 0,
    orbitCd: 0,
    dead: false,
  };
}

export function splitAsteroid(a, speedMul = 1) {
  if (a.size <= 1) return [];
  const heading = Math.atan2(a.vy, a.vx);
  const px = -Math.sin(heading);
  const py = Math.cos(heading);
  const kick = rand(20, 40);
  const size = a.size - 1;
  return [1, -1].map(sign => createAsteroid(
    a.x, a.y, size, speedMul,
    (a.vx + sign * px * kick) * 1.2,
    (a.vy + sign * py * kick) * 1.2,
  ));
}

export function updateAsteroid(a, dt, world) {
  a.x += a.vx * dt;
  a.y += a.vy * dt;
  a.angle += a.spin * dt;
  wrap(a, world);
  a.hitFlash = Math.max(0, a.hitFlash - dt);
  a.orbitCd = Math.max(0, a.orbitCd - dt);
}

export function drawAsteroid(ctx, a) {
  const n = a.shape.length;
  const step = TAU / n;
  const flash = a.hitFlash > 0;

  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const r = a.radius * a.shape[i];
    const ang = a.angle + i * step;
    const x = a.x + Math.cos(ang) * r;
    const y = a.y + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = flash ? '#ffffff' : ASTEROID_FILL;
  ctx.fill();
  ctx.strokeStyle = flash ? '#ffffff' : ASTEROID_STROKE;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const damage = a.maxHp - a.hp;
  if (damage > 0) {
    ctx.beginPath();
    for (let k = 0; k < damage; k++) {
      const idx = (k * 5 + 2) % n;
      const ang = a.angle + idx * step;
      const r = a.radius * a.shape[idx];
      ctx.moveTo(a.x + Math.cos(ang) * r * 0.25, a.y + Math.sin(ang) * r * 0.25);
      ctx.lineTo(a.x + Math.cos(ang + 0.5) * r * 0.85, a.y + Math.sin(ang + 0.5) * r * 0.85);
    }
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = ASTEROID_STROKE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

// --- XP gems ---

export function createGem(x, y, value = 1) {
  return {
    x, y,
    vx: rand(-30, 30),
    vy: rand(-30, 30),
    value,
    radius: 4,
    life: 20,
    dead: false,
  };
}

export function updateGem(g, ship, stats, dt, world) {
  const dx = ship.x - g.x;
  const dy = ship.y - g.y;
  const d2 = dx * dx + dy * dy;
  const magnet = stats.magnetRadius;

  if (ship.alive && d2 < magnet * magnet) {
    const d = Math.sqrt(d2) || 1;
    const speed = 300 + 300 * (1 - d / magnet);
    const k = Math.min(1, 10 * dt);
    g.vx += (dx / d * speed - g.vx) * k;
    g.vy += (dy / d * speed - g.vy) * k;
  } else {
    const drag = Math.pow(0.1, dt);
    g.vx *= drag;
    g.vy *= drag;
  }

  g.x += g.vx * dt;
  g.y += g.vy * dt;
  wrap(g, world);
  g.life -= dt;
  if (g.life <= 0) g.dead = true;
}

export function drawGems(ctx, gems, time) {
  if (!gems.length) return;
  ctx.save();
  ctx.fillStyle = GREEN;
  ctx.shadowColor = GREEN;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  for (const g of gems) {
    if (g.dead) continue;
    if (g.life < 3 && Math.floor(time * 8) % 2 === 0) continue;
    const s = g.radius * 1.4 * (1 + 0.18 * Math.sin(time * 5 + g.x * 0.05 + g.y * 0.03));
    ctx.moveTo(g.x, g.y - s);
    ctx.lineTo(g.x + s * 0.7, g.y);
    ctx.lineTo(g.x, g.y + s);
    ctx.lineTo(g.x - s * 0.7, g.y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

// --- missiles ---

export function createMissile(x, y, angle, stats) {
  return {
    x, y, angle,
    speed: 260,
    turn: 5,
    life: 3,
    radius: 4,
    damage: stats.missileDamage,
    dead: false,
    targetId: null,
    trail: [],
  };
}

function liveTarget(m, asteroids) {
  if (m.targetId !== null) {
    for (const a of asteroids) {
      if (a.id === m.targetId && !a.dead) return a;
    }
  }
  let best = null;
  let bestD = Infinity;
  for (const a of asteroids) {
    if (a.dead) continue;
    const d = dist2(m, a);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  m.targetId = best ? best.id : null;
  return best;
}

export function updateMissile(m, asteroids, dt, world) {
  const target = liveTarget(m, asteroids);
  if (target) turnToward(m, Math.atan2(target.y - m.y, target.x - m.x), m.turn * dt);

  m.speed += (420 - m.speed) * Math.min(1, 3 * dt);

  const trail = m.trail;
  const p = trail.length >= TRAIL_MAX ? trail.shift() : { x: 0, y: 0 };
  p.x = m.x;
  p.y = m.y;
  trail.push(p);

  m.x += Math.cos(m.angle) * m.speed * dt;
  m.y += Math.sin(m.angle) * m.speed * dt;
  wrap(m, world);

  m.life -= dt;
  if (m.life <= 0) m.dead = true;
}

export function drawMissiles(ctx, missiles) {
  if (!missiles.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  for (const m of missiles) {
    if (m.dead) continue;
    const tr = m.trail;
    const n = tr.length;
    let px = 0;
    let py = 0;
    for (let i = 0; i <= n; i++) {
      const x = i < n ? tr[i].x : m.x;
      const y = i < n ? tr[i].y : m.y;
      if (i === 0 || (x - px) * (x - px) + (y - py) * (y - py) > 6400) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      px = x;
      py = y;
    }
  }
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.shadowColor = ORANGE;
  ctx.shadowBlur = 10;
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  for (const m of missiles) {
    if (m.dead) continue;
    const c = Math.cos(m.angle);
    const s = Math.sin(m.angle);
    ctx.moveTo(m.x + c * 9, m.y + s * 9);
    ctx.lineTo(m.x - c * 6 - s * 4.5, m.y - s * 6 + c * 4.5);
    ctx.lineTo(m.x - c * 6 + s * 4.5, m.y - s * 6 - c * 4.5);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

// --- orbitals ---

export function orbitalPositions(ship, stats, time) {
  const n = stats.orbitals;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = time * stats.orbitalSpeed + (i * TAU) / n;
    out.push({
      x: ship.x + Math.cos(a) * stats.orbitalRadius,
      y: ship.y + Math.sin(a) * stats.orbitalRadius,
      radius: 7,
    });
  }
  return out;
}

export function drawOrbitals(ctx, ship, stats, time) {
  if (!ship.alive || stats.orbitals <= 0) return;
  const positions = orbitalPositions(ship, stats, time);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 90, 209, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, stats.orbitalRadius, 0, TAU);
  ctx.stroke();

  ctx.shadowColor = MAGENTA;
  ctx.shadowBlur = 10;
  ctx.fillStyle = MAGENTA;
  ctx.beginPath();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const rot = time * 9 + i * 0.7;
    for (let k = 0; k < 8; k++) {
      const r = k % 2 === 0 ? 9 : 3.5;
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
  for (const p of positions) {
    ctx.moveTo(p.x + 2.5, p.y);
    ctx.arc(p.x, p.y, 2.5, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
}

// --- particles & rings ---

function capParticles(particles) {
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
}

export function burst(particles, x, y, color, count = 12, speed = 160) {
  for (let i = 0; i < count; i++) {
    const ang = rand(0, TAU);
    const sp = speed * rand(0.4, 1);
    const life = rand(0.35, 0.7);
    particles.push({
      type: 'spark',
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life,
      maxLife: life,
      color,
      size: rand(1.5, 3),
    });
  }
  capParticles(particles);
}

export function ring(particles, x, y, maxRadius, color, duration = 0.45) {
  particles.push({
    type: 'ring',
    x, y,
    r: 0,
    maxR: maxRadius,
    life: duration,
    maxLife: duration,
    color,
  });
  capParticles(particles);
}

export function updateParticles(particles, dt) {
  let w = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) continue;
    if (p.type === 'ring') {
      const t = 1 - p.life / p.maxLife;
      p.r = p.maxR * (1 - (1 - t) * (1 - t));
    } else {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = Math.pow(0.2, dt);
      p.vx *= k;
      p.vy *= k;
    }
    particles[w++] = p;
  }
  particles.length = w;
}

export function drawParticles(ctx, particles) {
  if (!particles.length) return;
  ctx.save();
  for (const p of particles) {
    const a = p.life / p.maxLife;
    if (p.type === 'ring') {
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1 + 2 * a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.stroke();
    } else {
      const s = p.size * (0.4 + 0.6 * a);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  }
  ctx.restore();
}

// --- background ---

export function createStars(world, count = 140) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * world.w,
      y: Math.random() * world.h,
      z: rand(0.2, 1),
      tw: rand(0, TAU),
    });
  }
  return stars;
}

export function drawStars(ctx, stars, world, ship, time) {
  const sx = ship ? ship.x : world.w / 2;
  const sy = ship ? ship.y : world.h / 2;
  ctx.save();
  ctx.fillStyle = '#cfe0ff';
  for (const s of stars) {
    const x = mod(s.x - sx * s.z * 0.05, world.w);
    const y = mod(s.y - sy * s.z * 0.05, world.h);
    const size = 0.8 + s.z * 1.2;
    ctx.globalAlpha = s.z * (0.6 + 0.4 * Math.sin(time * 1.8 + s.tw));
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  ctx.restore();
}
