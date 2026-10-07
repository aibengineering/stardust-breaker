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

// Bounded world. mode: 'bounce' (reflect outward velocity, x0.9), 'clamp' (stop at the edge),
// 'kill' (dead once the circle is fully outside the world).
export function bounds(o, world, mode) {
  const r = o.radius || 0;
  if (mode === 'kill') {
    if (o.x + r < 0 || o.x - r > world.w || o.y + r < 0 || o.y - r > world.h) o.dead = true;
    return;
  }
  const bounce = mode === 'bounce';
  if (o.x - r < 0) {
    o.x = r;
    if (o.vx < 0) o.vx = bounce ? -o.vx * 0.9 : 0;
  } else if (o.x + r > world.w) {
    o.x = world.w - r;
    if (o.vx > 0) o.vx = bounce ? -o.vx * 0.9 : 0;
  }
  if (o.y - r < 0) {
    o.y = r;
    if (o.vy < 0) o.vy = bounce ? -o.vy * 0.9 : 0;
  } else if (o.y + r > world.h) {
    o.y = world.h - r;
    if (o.vy > 0) o.vy = bounce ? -o.vy * 0.9 : 0;
  }
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

export function updateShip(ship, input, stats, dt, world, mods = {}) {
  const stick = input.stick;
  const mag = stick.active ? Math.hypot(stick.x, stick.y) : 0;
  const drag0 = mods.drag !== undefined ? mods.drag : 0.55;
  const thrustMul = mods.thrustMul !== undefined ? mods.thrustMul : 1;
  const turnSpeed = stats.turnSpeed * (mods.turnMul !== undefined ? mods.turnMul : 1);

  if (mag > 0.2) turnToward(ship, Math.atan2(stick.y, stick.x), turnSpeed * 1.6 * dt);
  if (input.left) ship.angle -= turnSpeed * dt;
  if (input.right) ship.angle += turnSpeed * dt;
  ship.angle = normAngle(ship.angle);

  let power = input.thrust ? 1 : 0;
  if (mag > 0.35 && mag > power) power = mag;
  ship.thrusting = power > 0;
  if (power > 0) {
    const a = stats.thrust * thrustMul * power * dt;
    ship.vx += Math.cos(ship.angle) * a;
    ship.vy += Math.sin(ship.angle) * a;
  }

  const sp = Math.hypot(ship.vx, ship.vy);
  if (sp > stats.maxSpeed) {
    const k = stats.maxSpeed / sp;
    ship.vx *= k;
    ship.vy *= k;
  }
  const drag = Math.pow(drag0, dt);
  ship.vx *= drag;
  ship.vy *= drag;

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  bounds(ship, world, 'clamp');

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
    // Shield rings: a wide faint halo under each crisp ring (no shadowBlur).
    ctx.strokeStyle = SHIELD;
    for (let i = 0; i < shields; i++) {
      const alpha = 0.65 + 0.2 * Math.sin(time * 4 + i * 1.3);
      ctx.beginPath();
      ctx.arc(0, 0, r + 9 + i * 5, 0, TAU);
      ctx.globalAlpha = alpha * 0.25;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const blink = ship.invuln > 0 && Math.floor(time * 10) % 2 === 0;
  if (!blink) {
    ctx.rotate(ship.angle);

    if (ship.thrusting) {
      const len = r * (1.1 + 0.35 * Math.sin(time * 53) + 0.2 * Math.sin(time * 29 + 1));
      // Flame halo (wide, faint), then the flame itself.
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = ORANGE;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.85);
      ctx.lineTo(-r * 0.5 - len * 1.4, 0);
      ctx.lineTo(-r * 0.5, r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.45);
      ctx.lineTo(-r * 0.5 - len * 1.1, 0);
      ctx.lineTo(-r * 0.5, r * 0.45);
      ctx.closePath();
      ctx.fill();
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
    // The ship's one shadowed draw per frame (hull fill + outline share it).
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(77, 243, 255, 0.15)';
    ctx.fill();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// --- bullets (player only) ---

// opts (all optional): { damage, pierce, speed, life, radius, color, kind }
// kind: 'bullet' | 'lance' | 'rail' | 'frost' | 'drone'
export function createBullet(x, y, angle, stats, inheritVx = 0, inheritVy = 0, opts = {}) {
  const kind = opts.kind || 'bullet';
  const speed = opts.speed !== undefined ? opts.speed : stats.bulletSpeed;
  return {
    x, y,
    vx: Math.cos(angle) * speed + inheritVx * 0.5,
    vy: Math.sin(angle) * speed + inheritVy * 0.5,
    life: opts.life !== undefined ? opts.life : stats.bulletLife,
    radius: opts.radius !== undefined ? opts.radius : (kind === 'rail' ? 5 : 2.5),
    damage: opts.damage !== undefined ? opts.damage : stats.bulletDamage,
    pierceLeft: opts.pierce !== undefined ? opts.pierce : stats.pierce,
    color: opts.color || null,
    kind,
    hitIds: [],
    dead: false,
  };
}

export function updateBullet(b, dt, world) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  bounds(b, world, 'kill');
  b.life -= dt;
  if (b.life <= 0) b.dead = true;
}

// Per-kind look: tail = fraction of velocity drawn behind the bullet; one batch (one glow) per kind.
const BULLET_STYLES = {
  bullet: { tail: 0.035, glow: YELLOW, outer: YELLOW, width: 3, core: '#fffbe0', coreWidth: 1 },
  lance: { tail: 0.07, glow: CYAN, outer: '#bff9ff', width: 2.5, core: '#ffffff', coreWidth: 1 },
  rail: { tail: 0.12, glow: '#ffd166', outer: '#fff4c2', width: 5, core: '#ffffff', coreWidth: 1.5 },
  frost: { tail: 0.03, glow: '#9fe8ff', outer: '#9fe8ff', width: 2.5, core: '#e8fbff', coreWidth: 0.8 },
};
const BULLET_KINDS = ['bullet', 'lance', 'rail', 'frost'];

export function drawBullets(ctx, bullets) {
  if (!bullets.length) return;
  ctx.save();
  ctx.lineCap = 'round';

  for (const kind of BULLET_KINDS) {
    const st = BULLET_STYLES[kind];
    let any = false;
    ctx.beginPath();
    for (const b of bullets) {
      if (b.dead || (b.kind || 'bullet') !== kind || b.color) continue;
      ctx.moveTo(b.x - b.vx * st.tail, b.y - b.vy * st.tail);
      ctx.lineTo(b.x, b.y);
      any = true;
    }
    if (!any) continue;
    // Fake glow: the same path as a wide faint stroke, then the crisp outer and core.
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = st.glow;
    ctx.lineWidth = st.width * 3.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = st.outer;
    ctx.lineWidth = st.width;
    ctx.stroke();
    ctx.strokeStyle = st.core;
    ctx.lineWidth = st.coreWidth;
    ctx.stroke();
  }

  // Drone shots: small magenta dots, one batch.
  ctx.fillStyle = MAGENTA;
  ctx.beginPath();
  let anyDrone = false;
  for (const b of bullets) {
    if (b.dead || b.kind !== 'drone' || b.color) continue;
    ctx.moveTo(b.x + 2.2, b.y);
    ctx.arc(b.x, b.y, 2.2, 0, TAU);
    anyDrone = true;
  }
  if (anyDrone) ctx.fill();

  // Bullets with a custom colour (opts.color): drawn individually (rare), with a fake glow.
  for (const b of bullets) {
    if (b.dead || !b.color) continue;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.035, b.y - b.vy * 0.035);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = b.radius * 3.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = b.radius * 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

// --- asteroids ---

export const ASTEROID_SIZES = {
  3: { radius: 44, hp: 3, score: 20, gems: 3 },
  2: { radius: 26, hp: 2, score: 50, gems: 2 },
  1: { radius: 14, hp: 1, score: 100, gems: 1 },
};

let nextAsteroidId = 1;

// kind: 'rock' | 'crystal' | 'shard' | 'comet' (see brief). shard/comet ignore size.
export function createAsteroid(x, y, size, speedMul = 1, vx, vy, kind = 'rock') {
  if (kind === 'shard') size = 1;
  else if (kind === 'comet') size = 2;
  const def = ASTEROID_SIZES[size];
  if (vx === undefined || vy === undefined) {
    const dir = rand(0, TAU);
    const sp = rand(35, 85) * speedMul;
    vx = Math.cos(dir) * sp;
    vy = Math.sin(dir) * sp;
  }
  const n = kind === 'shard' ? 4 : 10 + Math.floor(Math.random() * 5);
  const shape = new Array(n);
  for (let i = 0; i < n; i++) shape[i] = rand(0.75, 1.15);
  let radius = def.radius;
  let hp = def.hp + Math.floor((speedMul - 1) * 3);
  if (kind === 'shard') {
    radius = 9;
    hp = 1;
  } else if (kind === 'comet') {
    radius = 22;
    hp = 3;
  }
  return {
    id: nextAsteroidId++,
    x, y, vx, vy,
    size,
    kind,
    radius,
    hp,
    maxHp: hp,
    angle: rand(0, TAU),
    spin: rand(-1.2, 1.2),
    shape,
    hitFlash: 0,
    orbitCd: 0,
    life: kind === 'shard' ? 5 : Infinity,
    transient: kind === 'shard',
    dead: false,
  };
}

// score / gems awarded when a rock of any kind is destroyed.
export function rockRewards(a) {
  if (a.kind === 'shard') return { score: 0, gems: 0 };
  if (a.kind === 'comet') return { score: 150, gems: 2 };
  const def = ASTEROID_SIZES[a.size];
  return def ? { score: def.score, gems: def.gems } : { score: 0, gems: 0 };
}

export function splitAsteroid(a, speedMul = 1) {
  if (a.kind === 'shard' || a.kind === 'comet') return [];
  if (a.size <= 1) return [];
  const size = a.size - 1;
  const kind = a.kind === 'crystal' ? 'crystal' : 'rock';
  if (kind === 'crystal') {
    // Crystals shatter into three, spread evenly around the parent's heading.
    const base = rand(0, TAU);
    const kick = rand(20, 40);
    const out = [];
    for (let k = 0; k < 3; k++) {
      const ang = base + (k * TAU) / 3;
      out.push(createAsteroid(
        a.x, a.y, size, speedMul,
        (a.vx + Math.cos(ang) * kick) * 1.2,
        (a.vy + Math.sin(ang) * kick) * 1.2,
        'crystal',
      ));
    }
    return out;
  }
  const heading = Math.atan2(a.vy, a.vx);
  const px = -Math.sin(heading);
  const py = Math.cos(heading);
  const kick = rand(20, 40);
  return [1, -1].map(sign => createAsteroid(
    a.x, a.y, size, speedMul,
    (a.vx + sign * px * kick) * 1.2,
    (a.vy + sign * py * kick) * 1.2,
    kind,
  ));
}

const COMET_TURN = 0.9;      // rad/s
const COMET_MIN_SPEED = 120; // px/s

export function updateAsteroid(a, dt, world, ship = null) {
  if (a.kind === 'shard') {
    a.life -= dt;
    if (a.life <= 0) a.dead = true;
  }

  if (a.kind === 'comet') {
    // Steer toward the ship at a capped turn rate, keeping speed (never below the minimum).
    let sp = Math.hypot(a.vx, a.vy);
    if (sp < COMET_MIN_SPEED) sp = COMET_MIN_SPEED;
    let heading = Math.atan2(a.vy, a.vx);
    if (ship && ship.alive) {
      const want = Math.atan2(ship.y - a.y, ship.x - a.x);
      const diff = normAngle(want - heading);
      const step = Math.min(COMET_TURN * dt, Math.abs(diff));
      heading += Math.sign(diff) * step;
    }
    a.vx = Math.cos(heading) * sp;
    a.vy = Math.sin(heading) * sp;
  }

  a.x += a.vx * dt;
  a.y += a.vy * dt;
  a.angle += a.spin * dt;
  bounds(a, world, 'bounce');
  a.hitFlash = Math.max(0, a.hitFlash - dt);
  a.orbitCd = Math.max(0, a.orbitCd - dt);
}

function drawShard(ctx, a) {
  // Sharp white-cyan diamond, spinning, no cracks.
  const r = a.radius;
  const flash = a.hitFlash > 0;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.7);
  ctx.lineTo(r * 0.7, 0);
  ctx.lineTo(0, r * 1.7);
  ctx.lineTo(-r * 0.7, 0);
  ctx.closePath();
  ctx.fillStyle = flash ? '#ffffff' : '#e6feff';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawComet(ctx, a) {
  // Orange-red head with a fiery tail trailing opposite the velocity.
  const flash = a.hitFlash > 0;
  const sp = Math.hypot(a.vx, a.vy) || 1;
  const ux = -a.vx / sp;
  const uy = -a.vy / sp;
  const px = -uy;
  const py = ux;
  const r = a.radius;
  const len = r * 3.2;
  const hw = r * 0.55;

  ctx.save();
  // Tail: outer haze then a brighter inner core, both as single fills.
  ctx.fillStyle = '#ff7a3d';
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(a.x + px * hw * 1.4, a.y + py * hw * 1.4);
  ctx.lineTo(a.x + ux * len * 1.2, a.y + uy * len * 1.2);
  ctx.lineTo(a.x - px * hw * 1.4, a.y - py * hw * 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd08a';
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(a.x + px * hw * 0.5, a.y + py * hw * 0.5);
  ctx.lineTo(a.x + ux * len * 0.7, a.y + uy * len * 0.7);
  ctx.lineTo(a.x - px * hw * 0.5, a.y - py * hw * 0.5);
  ctx.closePath();
  ctx.fill();

  // Head: a wide faint halo, then the crisp head.
  ctx.beginPath();
  ctx.arc(a.x, a.y, r * 1.1, 0, TAU);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ff7a3d';
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = flash ? '#ffffff' : '#ff7a3d';
  ctx.beginPath();
  ctx.arc(a.x, a.y, r * 0.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = flash ? '#ffffff' : '#ffd0a0';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export function drawAsteroid(ctx, a) {
  if (a.kind === 'shard') return drawShard(ctx, a);
  if (a.kind === 'comet') return drawComet(ctx, a);

  const n = a.shape.length;
  const step = TAU / n;
  const flash = a.hitFlash > 0;
  const crystal = a.kind === 'crystal';

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
  ctx.fillStyle = flash ? '#ffffff' : (crystal ? '#10283a' : ASTEROID_FILL);
  ctx.fill();
  ctx.strokeStyle = flash ? '#ffffff' : (crystal ? '#9fe8ff' : ASTEROID_STROKE);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  if (crystal && !flash) {
    // Inner facet lines from the centre to alternate vertices.
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) {
      const ang = a.angle + i * step;
      const r = a.radius * a.shape[i];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + Math.cos(ang) * r * 0.9, a.y + Math.sin(ang) * r * 0.9);
    }
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#9fe8ff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

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

// Stardust homing: after this age, gems outside the magnet ring drift toward the ship.
const GEM_HOME_AGE = 2.5;     // s
const GEM_HOME_RANGE = 520;   // px
const GEM_HOME_SPEED = 160;   // px/s target speed toward the ship
const GEM_HOME_RANGE2 = GEM_HOME_RANGE * GEM_HOME_RANGE;

export function createGem(x, y, value = 1) {
  return {
    x, y,
    vx: rand(-30, 30),
    vy: rand(-30, 30),
    value,
    radius: 4,
    life: 20,
    age: 0,
    dead: false,
  };
}

export function updateGem(g, ship, stats, dt, world) {
  const dx = ship.x - g.x;
  const dy = ship.y - g.y;
  const d2 = dx * dx + dy * dy;
  const magnet = stats.magnetRadius;
  g.age = (g.age || 0) + dt;

  if (ship.alive && d2 < magnet * magnet) {
    // Strong magnet inside magnetRadius (wins over homing).
    const d = Math.sqrt(d2) || 1;
    const speed = 300 + 300 * (1 - d / magnet);
    const k = Math.min(1, 10 * dt);
    g.vx += (dx / d * speed - g.vx) * k;
    g.vy += (dy / d * speed - g.vy) * k;
  } else {
    const drag = Math.pow(0.1, dt);
    g.vx *= drag;
    g.vy *= drag;
    if (ship.alive && g.age > GEM_HOME_AGE && d2 < GEM_HOME_RANGE2) {
      // Gentle homing: blend velocity toward a slow cruise speed aimed at the ship.
      const d = Math.sqrt(d2) || 1;
      const k = Math.min(1, 3 * dt);
      g.vx += (dx / d * GEM_HOME_SPEED - g.vx) * k;
      g.vy += (dy / d * GEM_HOME_SPEED - g.vy) * k;
    }
  }

  g.x += g.vx * dt;
  g.y += g.vy * dt;
  bounds(g, world, 'clamp');
  g.life -= dt;
  if (g.life <= 0) g.dead = true;
}

export function drawGems(ctx, gems, time) {
  if (!gems.length) return;
  ctx.save();
  ctx.fillStyle = GREEN;

  // Pass 1: wide faint diamonds as the glow. Pass 2: crisp diamonds. One path each.
  for (let pass = 0; pass < 2; pass++) {
    const grow = pass === 0 ? 1.9 : 1;
    ctx.globalAlpha = pass === 0 ? 0.22 : 1;
    ctx.beginPath();
    for (const g of gems) {
      if (g.dead) continue;
      if (g.life < 3 && Math.floor(time * 8) % 2 === 0) continue;
      const s = g.radius * 1.4 * grow * (1 + 0.18 * Math.sin(time * 5 + g.x * 0.05 + g.y * 0.03));
      ctx.moveTo(g.x, g.y - s);
      ctx.lineTo(g.x + s * 0.7, g.y);
      ctx.lineTo(g.x, g.y + s);
      ctx.lineTo(g.x - s * 0.7, g.y);
      ctx.closePath();
    }
    ctx.fill();
  }
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

// targets: any array of { id, x, y, dead } (asteroids and/or bosses)
export function updateMissile(m, targets, dt, world) {
  const target = liveTarget(m, targets);
  if (target) turnToward(m, Math.atan2(target.y - m.y, target.x - m.x), m.turn * dt);

  m.speed += (420 - m.speed) * Math.min(1, 3 * dt);

  const trail = m.trail;
  const p = trail.length >= TRAIL_MAX ? trail.shift() : { x: 0, y: 0 };
  p.x = m.x;
  p.y = m.y;
  trail.push(p);

  m.x += Math.cos(m.angle) * m.speed * dt;
  m.y += Math.sin(m.angle) * m.speed * dt;
  bounds(m, world, 'kill');

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
  // All missile heads share the one shadowed fill.
  ctx.fill();
  ctx.shadowBlur = 0;
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

  // Blades: one path, a wide faint halo stroke underneath, then the crisp fill (no shadowBlur).
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
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = MAGENTA;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = MAGENTA;
  ctx.fill();

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

// Stars live in screen space (CSS px). Parallax: offset = -cam * z * 0.25, wrapped mod view.
export function createStars(view, count = 160) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * view.w,
      y: Math.random() * view.h,
      z: rand(0.2, 1),
      tw: rand(0, TAU),
    });
  }
  return stars;
}

export function drawStars(ctx, stars, view, cam, time) {
  const cx = cam ? cam.x : 0;
  const cy = cam ? cam.y : 0;
  ctx.save();
  ctx.fillStyle = '#cfe0ff';
  for (const s of stars) {
    const x = mod(s.x - cx * s.z * 0.25, view.w);
    const y = mod(s.y - cy * s.z * 0.25, view.h);
    const size = 0.8 + s.z * 1.2;
    ctx.globalAlpha = s.z * (0.6 + 0.4 * Math.sin(time * 1.8 + s.tw));
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  ctx.restore();
}

// Rounded-rect path built from arcTo (no roundRect dependency).
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// World-space arena edge: glowing 2 px rounded rect, gentle pulse, dashed corner brackets.
export function drawWorldBorder(ctx, world, color, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 2);
  const W = world.w;
  const H = world.h;
  ctx.save();

  // Border line: a wide faint halo, then the crisp 2 px line (same path, no shadowBlur).
  const borderAlpha = 0.55 + 0.25 * pulse;
  ctx.strokeStyle = color;
  roundRectPath(ctx, 0, 0, W, H, 28);
  ctx.globalAlpha = borderAlpha * 0.35;
  ctx.lineWidth = 10 + 4 * pulse;
  ctx.stroke();
  ctx.globalAlpha = borderAlpha;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dashed corner brackets just inside each corner.
  const L = 56;
  const inset = 8;
  ctx.globalAlpha = 0.7 + 0.3 * pulse;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 7]);
  ctx.lineDashOffset = -time * 20;
  ctx.beginPath();
  // top-left
  ctx.moveTo(inset + L, inset); ctx.lineTo(inset, inset); ctx.lineTo(inset, inset + L);
  // top-right
  ctx.moveTo(W - inset - L, inset); ctx.lineTo(W - inset, inset); ctx.lineTo(W - inset, inset + L);
  // bottom-right
  ctx.moveTo(W - inset - L, H - inset); ctx.lineTo(W - inset, H - inset); ctx.lineTo(W - inset, H - inset - L);
  // bottom-left
  ctx.moveTo(inset + L, H - inset); ctx.lineTo(inset, H - inset); ctx.lineTo(inset, H - inset - L);
  ctx.stroke();

  ctx.restore();
}
