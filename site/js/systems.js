// Sector hazard systems (chunk Q). Acts only through game.api and game fields.

const TAU = Math.PI * 2;
const STRIKE_R = 70;
const TELE_TIME = 1.3;
const BOLT_TIME = 0.45;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
// Polyline from a flattened [x0,y0,x1,y1,...] array (path only; caller strokes).
function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1]);
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
    w: w && Number.isFinite(w.w) ? w.w : 1300,
    h: w && Number.isFinite(w.h) ? w.h : 1700,
  };
}
function shipAlive(game) {
  return !!(game && game.ship && game.ship.alive);
}
function sfxCall(game, name) {
  const s = game && game.api && game.api.sfx;
  if (s && typeof s[name] === 'function') s[name]();
}
// Normalised [0,1] screen-space particle -> world coords (cam-relative), so particles stay on screen.
function visibleSize(game) {
  const z = game.zoom || 1;
  return { vw: game.view.w / z, vh: game.view.h / z };
}

// Dots that differ only in alpha are batched: one fill per alpha bucket, not one per dot.
// Glow is always fake (wide low-alpha strokes or 'lighter' passes), never shadowBlur.
const MOTE_ALPHAS = [0.24, 0.32, 0.4];

function noop() {}

// ---------- none (belt): dust motes ----------

function createNone(game) {
  const { w, h } = worldSize(game);
  const motes = [];
  for (let i = 0; i < 50; i++) {
    motes.push({
      x: rand(0, w), y: rand(0, h),
      vx: rand(-8, 8), vy: rand(-8, 8),
      r: rand(0.8, 1.8), bk: Math.floor(Math.random() * MOTE_ALPHAS.length),
    });
  }
  return {
    id: 'none',
    name: 'Asteroid Belt',
    mods: { drag: 0.55, thrustMul: 1, turnMul: 1, gemValueMul: 1, visibility: null },
    update(g, dt) {
      const d = safeDt(dt);
      const s = worldSize(g);
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        m.x += m.vx * d;
        m.y += m.vy * d;
        if (m.x < 0) m.x += s.w; else if (m.x > s.w) m.x -= s.w;
        if (m.y < 0) m.y += s.h; else if (m.y > s.h) m.y -= s.h;
      }
    },
    drawBack(ctx) {
      ctx.save();
      ctx.fillStyle = '#9aa6d6';
      for (let k = 0; k < MOTE_ALPHAS.length; k++) {
        ctx.globalAlpha = MOTE_ALPHAS[k];
        ctx.beginPath();
        for (let i = 0; i < motes.length; i++) {
          const m = motes[i];
          if (m.bk !== k) continue;
          ctx.moveTo(m.x + m.r, m.y);
          ctx.arc(m.x, m.y, m.r, 0, TAU);
        }
        ctx.fill();
      }
      ctx.restore();
    },
    drawFront: noop,
    drawScreen: noop,
  };
}

// ---------- storm: lightning strike zones ----------

function createStorm(game) {
  const { w, h } = worldSize(game);
  const clouds = [];
  for (let i = 0; i < 12; i++) {
    clouds.push({
      x: rand(0, w), y: rand(0, h), r: rand(120, 240),
      speed: rand(8, 20), dir: rand(-0.3, 0.3) + (Math.random() < 0.5 ? 0 : Math.PI),
      lobes: [rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6)],
    });
  }
  const zones = [];
  let cd = 3;
  let flicker = 0;
  let flickerCd = rand(0.5, 2);
  let flash = 0; // white flash ring fade (drawFront)
  let time = 0;

  function interval(g) {
    return Math.max(2.5, 6 - 0.3 * (g.wave || 1));
  }

  function spawnBatch(g) {
    const ship = g.ship;
    const s = worldSize(g);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const ang = rand(0, TAU);
      const dist = rand(0, 320);
      const x = clamp(ship.x + Math.cos(ang) * dist, STRIKE_R, s.w - STRIKE_R);
      const y = clamp(ship.y + Math.sin(ang) * dist, STRIKE_R, s.h - STRIKE_R);
      zones.push({ x, y, t: 0, bolt: null, age: 0, seed: rand(0, 100) });
    }
    sfxCall(g, 'warning');
  }

  function strike(g, z) {
    const api = g.api;
    const top = g.cam ? g.cam.y : z.y - 600;
    // jagged bolt points, flattened [x0,y0,x1,y1,...] from the top of the view down to the zone
    const pts = [];
    const segs = 9;
    for (let i = 0; i <= segs; i++) {
      const f = i / segs;
      const jit = i === 0 || i === segs ? 0 : rand(-18, 18) * (1 - f * 0.5);
      pts.push(z.x + jit, top + (z.y - top) * f);
    }
    z.bolt = pts;
    z.age = 0;
    const ship = g.ship;
    if (ship && ship.alive && Math.hypot(ship.x - z.x, ship.y - z.y) < STRIKE_R) {
      api.hurtShip(z.x, z.y);
    }
    const rocks = g.asteroids || [];
    const n = rocks.length;
    for (let i = 0; i < n; i++) {
      const a = rocks[i];
      if (!a || a.dead) continue;
      if (Math.hypot(a.x - z.x, a.y - z.y) < STRIKE_R + (a.radius || 0)) {
        api.damageAsteroid(a, 3);
      }
    }
    api.ring(z.x, z.y, STRIKE_R, '#ffffff', 0.35);
    api.shake(0.25, 5);
    sfxCall(g, 'lightning');
    flash = 1;
  }

  return {
    id: 'storm',
    name: 'Ion Storm',
    mods: { drag: 0.55, thrustMul: 1, turnMul: 1, gemValueMul: 1.5, visibility: null },
    update(g, dt) {
      const d = safeDt(dt);
      time += d;
      flash = Math.max(0, flash - d * 4);
      if (shipAlive(g)) {
        cd -= d;
        if (cd <= 0) {
          spawnBatch(g);
          cd += interval(g);
        }
      }
      // telegraphs always resolve; new batches only spawn while the ship is alive
      for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        if (!z.bolt) {
          z.t += d;
          if (z.t >= TELE_TIME) strike(g, z);
        } else {
          z.age += d;
          if (z.age > BOLT_TIME) zones.splice(i, 1);
        }
      }
      // cloud drift + flicker
      const s = worldSize(g);
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        c.x += Math.cos(c.dir) * c.speed * d;
        c.y += Math.sin(c.dir) * c.speed * d;
        if (c.x < -300) c.x += s.w + 600; else if (c.x > s.w + 300) c.x -= s.w + 600;
        if (c.y < -300) c.y += s.h + 600; else if (c.y > s.h + 300) c.y -= s.h + 600;
      }
      flickerCd -= d;
      if (flickerCd <= 0) {
        flicker = rand(0.1, 0.22);
        flickerCd = rand(0.6, 2.4);
      }
      flicker = Math.max(0, flicker - d);
    },
    onWave() {},
    drawBack(ctx, g) {
      const s = worldSize(g);
      ctx.save();
      ctx.fillStyle = 'rgba(70, 30, 120, 0.2)';
      ctx.beginPath();
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        for (let j = 0; j < 3; j++) {
          const lx = c.x + c.lobes[j] * c.r;
          const ly = c.y + c.lobes[(j + 1) % 3] * c.r * 0.5;
          ctx.moveTo(lx + c.r * 0.6, ly);
          ctx.arc(lx, ly, c.r * 0.6, 0, TAU);
        }
      }
      ctx.fill();
      if (flicker > 0) {
        ctx.globalAlpha = flicker;
        ctx.fillStyle = '#b8a9ff';
        ctx.fillRect(0, 0, s.w, s.h);
      }
      ctx.restore();
    },
    drawFront(ctx, g, time2) {
      ctx.save();
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        if (!z.bolt) {
          const p = z.t / TELE_TIME;
          const pulse = 1 + 0.06 * Math.sin((time2 || 0) * 14 + z.seed);
          ctx.globalAlpha = 0.35 + 0.4 * p;
          ctx.strokeStyle = '#b8a9ff';
          ctx.lineWidth = 2 + p * 2;
          ctx.beginPath();
          ctx.arc(z.x, z.y, STRIKE_R * pulse, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 0.1 + 0.1 * p;
          ctx.fillStyle = '#b8a9ff';
          ctx.fill();
          // crackle
          ctx.globalAlpha = 0.5 + 0.4 * p;
          ctx.beginPath();
          for (let k = 0; k < 2; k++) {
            const a0 = rand(0, TAU);
            const r0 = rand(10, STRIKE_R * 0.8);
            ctx.moveTo(z.x + Math.cos(a0) * r0, z.y + Math.sin(a0) * r0);
            ctx.lineTo(z.x + Math.cos(a0 + 0.2) * (r0 + 10), z.y + Math.sin(a0 + 0.2) * (r0 + 10));
            ctx.lineTo(z.x + Math.cos(a0 + 0.1) * (r0 + 18), z.y + Math.sin(a0 + 0.1) * (r0 + 18));
          }
          ctx.stroke();
        } else {
          // fake glow: wide faint lilac under a white core
          const f = clamp(1 - z.age / BOLT_TIME, 0, 1);
          ctx.lineJoin = 'round';
          tracePoly(ctx, z.bolt);
          ctx.globalAlpha = f * 0.3;
          ctx.strokeStyle = '#b8a9ff';
          ctx.lineWidth = 10;
          ctx.stroke();
          tracePoly(ctx, z.bolt);
          ctx.globalAlpha = f;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
      if (flash > 0) {
        ctx.globalAlpha = flash * 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < zones.length; i++) {
          const z = zones[i];
          if (!z.bolt) continue;
          ctx.moveTo(z.x + STRIKE_R, z.y);
          ctx.arc(z.x, z.y, STRIKE_R, 0, TAU);
        }
        ctx.fill();
      }
      ctx.restore();
    },
    drawScreen: noop,
  };
}

// ---------- gravity: central well with accretion disk ----------

const WELL_R = 1100;
const CORE_R = 44;

function createGravity(game) {
  const s = worldSize(game);
  const cx = s.w / 2;
  const cy = s.h / 2;
  const DISK_R = 620;
  const TILT = -0.42;
  const ARMS = 3;
  let diskGrad = null; // built once: the disc is drawn in a fixed local space, so it never changes

  function pull(o, k, dt) {
    const dx = cx - o.x;
    const dy = cy - o.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) return d;
    const f = clamp(1 - d / WELL_R, 0, 1);
    const a = k * f * dt;
    o.vx += (dx / d) * a;
    o.vy += (dy / d) * a;
    return d;
  }

  return {
    id: 'gravity',
    name: 'Gravity Well',
    mods: { drag: 0.55, thrustMul: 1, turnMul: 1, gemValueMul: 1, visibility: null },
    update(g, dt) {
      const d = safeDt(dt);
      const ship = g.ship;
      if (ship && ship.alive) {
        const dist = pull(ship, 150, d);
        if (dist < CORE_R + (ship.radius || 0)) {
          g.api.hurtShip(cx, cy);
          const ux = dist > 1e-3 ? (ship.x - cx) / dist : 1;
          const uy = dist > 1e-3 ? (ship.y - cy) / dist : 0;
          ship.vx += ux * 1200 * d;
          ship.vy += uy * 1200 * d;
        }
      }
      const rocks = g.asteroids || [];
      const nr = rocks.length;
      for (let i = 0; i < nr; i++) {
        const a = rocks[i];
        if (!a || a.dead) continue;
        const dist = pull(a, 110, d);
        if (dist < CORE_R) g.api.damageAsteroid(a, 9999);
      }
      const gems = g.gems || [];
      for (let i = 0; i < gems.length; i++) {
        const gem = gems[i];
        if (!gem || gem.dead) continue;
        pull(gem, 260, d);
      }
    },
    onWave() {},
    drawBack(ctx, g, time) {
      const t = time || 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(TILT);
      ctx.scale(1, 0.38);
      // disk glow (gradient cached on first use)
      if (!diskGrad) {
        diskGrad = ctx.createRadialGradient(0, 0, CORE_R * 0.8, 0, 0, DISK_R);
        diskGrad.addColorStop(0, 'rgba(255, 90, 209, 0.6)');
        diskGrad.addColorStop(0.35, 'rgba(140, 60, 255, 0.3)');
        diskGrad.addColorStop(1, 'rgba(40, 10, 80, 0)');
      }
      ctx.fillStyle = diskGrad;
      ctx.beginPath();
      ctx.arc(0, 0, DISK_R, 0, TAU);
      ctx.fill();
      // rings
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const r = 80 + i * 105;
        ctx.strokeStyle = i % 2 ? 'rgba(180, 120, 255, 0.35)' : 'rgba(255, 90, 209, 0.3)';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.stroke();
      }
      // spiral streaks, rotating
      ctx.save();
      ctx.rotate(t * 0.6);
      ctx.strokeStyle = 'rgba(176, 124, 255, 0.45)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let arm = 0; arm < ARMS; arm++) {
        const base = (arm * TAU) / ARMS;
        for (let i = 0; i <= 14; i++) {
          const r = CORE_R + 30 + i * 36;
          const th = base + i * 0.24;
          const x = Math.cos(th) * r;
          const y = Math.sin(th) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
      ctx.restore();
      // black core with bright rim (not squashed)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, CORE_R, 0, TAU);
      ctx.fillStyle = '#000000';
      ctx.fill();
      // fake glow: wide faint magenta halo under the bright rim
      ctx.strokeStyle = '#ff5ad1';
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffb3e6';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    },
    drawFront: noop,
    drawScreen: noop,
  };
}

// ---------- ice: slippery drift, icy shimmer, snow ----------

const ICE_ALPHAS = [0.07, 0.1, 0.13];

function createIce(game) {
  const s = worldSize(game);
  const streaks = [];
  for (let i = 0; i < 16; i++) {
    streaks.push({
      x: rand(0, s.w), y: rand(0, s.h),
      len: rand(120, 260), sp: rand(12, 30),
      a: ICE_ALPHAS[Math.floor(Math.random() * ICE_ALPHAS.length)],
    });
  }
  const flakes = [];
  for (let i = 0; i < 55; i++) {
    flakes.push({
      fx: Math.random(), fy: Math.random(),
      vy: rand(0.02, 0.06), ph: rand(0, TAU), r: rand(1.6, 3.2),
    });
  }
  const DX = -0.35; // streak direction (radians)
  return {
    id: 'ice',
    name: 'Ice Field',
    mods: { drag: 0.85, thrustMul: 1, turnMul: 1.15, gemValueMul: 1, visibility: null },
    update(g, dt) {
      const d = safeDt(dt);
      const sz = worldSize(g);
      const ux = Math.cos(DX);
      const uy = Math.sin(DX);
      for (let i = 0; i < streaks.length; i++) {
        const st = streaks[i];
        st.x += ux * st.sp * d;
        st.y += uy * st.sp * d;
        if (st.x > sz.w + 300) st.x -= sz.w + 600;
        if (st.x < -300) st.x += sz.w + 600;
        if (st.y > sz.h + 300) st.y -= sz.h + 600;
        if (st.y < -300) st.y += sz.h + 600;
      }
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        f.fy += f.vy * d;
        f.ph += d * 0.8;
        f.fx += Math.sin(f.ph) * 0.01 * d;
        if (f.fy > 1) f.fy -= 1;
        f.fx = f.fx - Math.floor(f.fx);
      }
    },
    onWave() {},
    drawBack(ctx, g) {
      ctx.save();
      ctx.strokeStyle = '#9fe8ff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      const ux = Math.cos(DX);
      const uy = Math.sin(DX);
      // one stroke per alpha level instead of one per streak
      for (let k = 0; k < ICE_ALPHAS.length; k++) {
        ctx.globalAlpha = ICE_ALPHAS[k];
        ctx.beginPath();
        for (let i = 0; i < streaks.length; i++) {
          const st = streaks[i];
          if (st.a !== ICE_ALPHAS[k]) continue;
          ctx.moveTo(st.x, st.y);
          ctx.lineTo(st.x - ux * st.len, st.y - uy * st.len);
        }
        ctx.stroke();
      }
      ctx.restore();
    },
    drawFront(ctx, g) {
      const z = g.zoom || 1;
      const { vw, vh } = visibleSize(g);
      ctx.save();
      ctx.fillStyle = '#eaf9ff';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        const x = g.cam.x + f.fx * vw;
        const y = g.cam.y + f.fy * vh;
        const r = f.r / z;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
      ctx.restore();
    },
    drawScreen: noop,
  };
}

// ---------- ember: darkness with a torch hole, homing comets ----------

const EMBER_VIS = 330;
const FEATHER = 90;

function createEmber(game) {
  const s = worldSize(game);
  const embers = [];
  for (let i = 0; i < 45; i++) {
    embers.push({
      fx: Math.random(), fy: Math.random(),
      vy: rand(0.015, 0.05), ph: rand(0, TAU), r: rand(1, 2.2),
    });
  }
  // embers pulse between alpha 0.1 and 0.7; batch them into a few brightness levels
  const EMBER_LEVELS = 4;
  const levelOf = new Uint8Array(embers.length);
  let cometCd = 4;
  let time = 0;
  return {
    id: 'ember',
    name: 'Ember Nebula',
    mods: { drag: 0.55, thrustMul: 1, turnMul: 1, gemValueMul: 1, visibility: EMBER_VIS },
    update(g, dt) {
      const d = safeDt(dt);
      time += d;
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i];
        e.fy -= e.vy * d;
        e.ph += d * 2;
        e.fx += Math.sin(e.ph) * 0.02 * d;
        if (e.fy < 0) e.fy += 1;
        e.fx = e.fx - Math.floor(e.fx);
      }
      if (!shipAlive(g)) return;
      cometCd -= d;
      if (cometCd <= 0) {
        cometCd += Math.max(3, 7 - 0.4 * (g.wave || 1));
        spawnComet(g);
      }
    },
    onWave() {},
    drawBack(ctx, g, t) {
      const z = g.zoom || 1;
      const { vw, vh } = visibleSize(g);
      const tt = t || time;
      for (let i = 0; i < embers.length; i++) {
        const s = 0.5 + 0.5 * Math.sin(tt * 3 + embers[i].ph); // 0..1
        levelOf[i] = Math.min(EMBER_LEVELS - 1, Math.floor(s * EMBER_LEVELS));
      }
      ctx.save();
      ctx.fillStyle = '#ff7a3d';
      for (let k = 0; k < EMBER_LEVELS; k++) {
        // level k is centred on alpha 0.4 + 0.3 * (2 * (k + 0.5) / EMBER_LEVELS - 1)
        ctx.globalAlpha = 0.4 + 0.3 * (2 * (k + 0.5) / EMBER_LEVELS - 1);
        ctx.beginPath();
        for (let i = 0; i < embers.length; i++) {
          if (levelOf[i] !== k) continue;
          const e = embers[i];
          const x = g.cam.x + e.fx * vw;
          const y = g.cam.y + e.fy * vh;
          const r = e.r / z;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
        }
        ctx.fill();
      }
      ctx.restore();
    },
    drawFront: noop,
    drawScreen(ctx, g) {
      const ship = g.ship;
      if (!ship) return;
      const z = g.zoom || 1;
      const sx = (ship.x - g.cam.x) * z;
      const sy = (ship.y - g.cam.y) * z;
      const R = EMBER_VIS * z;
      const inner = Math.max(0, R - FEATHER);
      const grad = ctx.createRadialGradient(sx, sy, inner, sx, sy, R);
      grad.addColorStop(0, 'rgba(4, 2, 2, 0)');
      grad.addColorStop(1, 'rgba(4, 2, 2, 0.92)');
      ctx.save();
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, g.view.w, g.view.h);
      // gems and comets glow through the darkness: one batched halo pass (wide, faint) then one core
      // pass per kind. No shadowBlur.
      const gems = g.gems || [];
      const rocks = g.asteroids || [];
      const gemHalo = 7;
      ctx.fillStyle = '#5dff9b';
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      for (let i = 0; i < gems.length; i++) {
        const gm = gems[i];
        if (!gm || gm.dead) continue;
        const px = (gm.x - g.cam.x) * z;
        const py = (gm.y - g.cam.y) * z;
        if (px < -10 || py < -10 || px > g.view.w + 10 || py > g.view.h + 10) continue;
        ctx.moveTo(px + gemHalo, py);
        ctx.arc(px, py, gemHalo, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let i = 0; i < gems.length; i++) {
        const gm = gems[i];
        if (!gm || gm.dead) continue;
        const px = (gm.x - g.cam.x) * z;
        const py = (gm.y - g.cam.y) * z;
        if (px < -10 || py < -10 || px > g.view.w + 10 || py > g.view.h + 10) continue;
        ctx.moveTo(px + 3, py);
        ctx.arc(px, py, 3, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = '#ff7a3d';
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      for (let i = 0; i < rocks.length; i++) {
        const a = rocks[i];
        if (!a || a.dead || a.kind !== 'comet') continue;
        const px = (a.x - g.cam.x) * z;
        const py = (a.y - g.cam.y) * z;
        const r = (a.radius || 22) * z * 1.6;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let i = 0; i < rocks.length; i++) {
        const a = rocks[i];
        if (!a || a.dead || a.kind !== 'comet') continue;
        const px = (a.x - g.cam.x) * z;
        const py = (a.y - g.cam.y) * z;
        const r = (a.radius || 22) * z;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, TAU);
      }
      ctx.fill();
      ctx.restore();
    },
  };

  function spawnComet(g) {
    const s = worldSize(g);
    const ship = g.ship;
    const inset = 22;
    const side = Math.floor(Math.random() * 4);
    let ex;
    let ey;
    if (side === 0) { ex = rand(inset, s.w - inset); ey = inset; }
    else if (side === 1) { ex = s.w - inset; ey = rand(inset, s.h - inset); }
    else if (side === 2) { ex = rand(inset, s.w - inset); ey = s.h - inset; }
    else { ex = inset; ey = rand(inset, s.h - inset); }
    const dx = ship.x - ex;
    const dy = ship.y - ey;
    const d = Math.hypot(dx, dy) || 1;
    const sp = 170;
    g.api.spawnAsteroid(ex, ey, 2, {
      kind: 'comet',
      transient: true,
      vx: (dx / d) * sp,
      vy: (dy / d) * sp,
    });
  }
}

// ---------- chaos (deep): rotating child hazard every 3 waves ----------

const CHAOS_CHILDREN = ['storm', 'gravity', 'ice', 'ember'];

function makeChild(id, params, game) {
  return createSystem(id, params, game);
}

function createChaos(params, game) {
  let child = makeChild(CHAOS_CHILDREN[Math.floor(Math.random() * 4)], params, game);
  let lastWave = -1;

  function switchChild(g) {
    const others = CHAOS_CHILDREN.filter((id) => id !== child.id);
    const next = makeChild(others[Math.floor(Math.random() * others.length)], params, g);
    child = next;
    if (g && g.api && typeof g.api.banner === 'function') {
      g.api.banner('HAZARD: ' + child.name, 2000);
    }
  }

  const mods = {};
  for (const key of ['drag', 'thrustMul', 'turnMul', 'gemValueMul', 'visibility']) {
    Object.defineProperty(mods, key, {
      enumerable: true,
      get() { return child.mods[key]; },
    });
  }

  return {
    id: 'chaos',
    name: 'Chaos',
    mods,
    get child() { return child; },
    update(g, dt) { child.update(g, dt); },
    onWave(g, n) {
      if (n === lastWave) return;
      lastWave = n;
      if (n > 1 && (n - 1) % 3 === 0) switchChild(g);
    },
    onKill(g, rock) {
      if (child.onKill) child.onKill(g, rock);
    },
    drawBack(ctx, g, t) { child.drawBack(ctx, g, t); },
    drawFront(ctx, g, t) { child.drawFront(ctx, g, t); },
    drawScreen(ctx, g, t) { child.drawScreen(ctx, g, t); },
  };
}

// ---------- factory ----------

export function createSystem(id, params = {}, game) {
  const p = params || {};
  switch (id) {
    case 'storm': return createStorm(game);
    case 'gravity': return createGravity(game);
    case 'ice': return createIce(game);
    case 'ember': return createEmber(game);
    case 'chaos': return createChaos(p, game);
    case 'none':
    default:
      return createNone(game);
  }
}
