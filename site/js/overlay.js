// Screen-space overlays: off-screen threat arrows and the radar.
// Both draw in CSS px (game.js sets ctx.setTransform(dpr,0,0,dpr,0,0) before calling them).

const ARROW_MAX = 14;
const ARROW_RANGE = 900;     // world px: consider rocks this close to the ship
const APPROACH_RANGE = 450;  // world px: approaching rocks this close turn red
const EDGE_INSET = 18;
const HUD_BAND = 64;         // top band reserved for the HUD

const RADAR_SIZE = 92;
const RADAR_RIGHT = 104;     // panel's left edge = view.w - RADAR_RIGHT
const RADAR_TOP = 70;        // below the HUD buttons
const RADAR_PAD = 6;

const RED = '#ff4d6d';
const LILAC = '#b9a7ff';
const GOLD = '#ffd166';
const CYAN = '#4df3ff';
const ORANGE = '#ff7a3d';
const ICE = '#9fe8ff';

const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Threat candidates for the current frame (rebuilt each call; small).
let threats = [];

function gather(list, isBoss, game, cam, zoom, vw, vh) {
  if (!list) return;
  const ship = game.ship;
  const camR = cam.x + vw;
  const camB = cam.y + vh;
  const range2 = ARROW_RANGE * ARROW_RANGE;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o || o.dead) continue;
    const r = o.radius || 0;
    // Skip anything whose circle touches the visible world rectangle.
    if (o.x + r >= cam.x && o.x - r <= camR && o.y + r >= cam.y && o.y - r <= camB) continue;
    const dx = o.x - ship.x;
    const dy = o.y - ship.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > range2) continue;
    // Approaching: velocity points at the ship (rock->ship dot velocity > 0) and it is close.
    const approaching = d2 <= APPROACH_RANGE * APPROACH_RANGE
      && ((o.vx || 0) * -dx + (o.vy || 0) * -dy) > 0;
    threats.push({ d2, x: o.x, y: o.y, r, boss: isBoss, approaching, dx, dy });
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Chevron whose tip sits at (px, py) and points along unit vector (ux, uy).
function chevronPath(ctx, px, py, ux, uy, s) {
  const nx = -uy;
  const ny = ux;
  const bx = px - ux * s * 1.1;
  const by = py - uy * s * 1.1;
  ctx.moveTo(px, py);
  ctx.lineTo(bx + nx * s * 0.7, by + ny * s * 0.7);
  ctx.lineTo(px - ux * s * 0.6, py - uy * s * 0.6);
  ctx.lineTo(bx - nx * s * 0.7, by - ny * s * 0.7);
  ctx.closePath();
}

export function drawThreatArrows(ctx, game) {
  const view = game.view;
  const ship = game.ship;
  if (!view || !ship) return;
  const zoom = game.zoom || 1;
  const cam = game.cam || { x: 0, y: 0 };
  const vw = view.w / zoom;
  const vh = view.h / zoom;

  threats = [];
  gather(game.asteroids, false, game, cam, zoom, vw, vh);
  gather(game.bosses, true, game, cam, zoom, vw, vh);
  if (!threats.length) return;
  threats.sort((a, b) => a.d2 - b.d2);
  const count = Math.min(ARROW_MAX, threats.length);

  // Arrow area: inset from the edges, below the HUD band.
  const L = EDGE_INSET;
  const R = view.w - EDGE_INSET;
  const T = HUD_BAND + 10;
  const B = view.h - EDGE_INSET;

  // Ship's screen position, clamped into the arrow area as the ray origin.
  const sx0 = (ship.x - cam.x) * zoom;
  const sy0 = (ship.y - cam.y) * zoom;
  const ox = clamp(sx0, L, R);
  const oy = clamp(sy0, T, B);

  const time = game.time || 0;
  const pulse = 0.5 + 0.5 * Math.sin(time * 5);

  ctx.save();

  // Two fill batches (lilac, red), plus boss rings drawn after.
  for (let pass = 0; pass < 2; pass++) {
    const wantApproach = pass === 1;
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const c = threats[i];
      if (c.approaching !== wantApproach) continue;
      const geom = edgePoint(c, sx0, sy0, ox, oy, L, R, T, B, zoom, cam);
      chevronPath(ctx, geom.px, geom.py, geom.ux, geom.uy, geom.s);
      any = true;
    }
    if (!any) continue;
    ctx.globalAlpha = wantApproach ? 1 : 0.55;
    ctx.fillStyle = wantApproach ? RED : LILAC;
    ctx.fill();
  }

  // Bosses: gold pulsing ring around the chevron.
  ctx.globalAlpha = 1;
  for (let i = 0; i < count; i++) {
    const c = threats[i];
    if (!c.boss) continue;
    const geom = edgePoint(c, sx0, sy0, ox, oy, L, R, T, B, zoom, cam);
    const cxr = geom.px - geom.ux * geom.s * 0.55;
    const cyr = geom.py - geom.uy * geom.s * 0.55;
    ctx.globalAlpha = 0.45 + 0.45 * pulse;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cxr, cyr, geom.s * 1.6, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
}

// Where the chevron for threat c sits: the point where the ray from the ship's (clamped)
// screen position toward the rock leaves the inset area. Returns a fresh small object.
function edgePoint(c, sx0, sy0, ox, oy, L, R, T, B, zoom, cam) {
  const rx = (c.x - cam.x) * zoom;
  const ry = (c.y - cam.y) * zoom;
  let dx = rx - sx0;
  let dy = ry - sy0;
  const dl = Math.hypot(dx, dy) || 1;
  const ux = dx / dl;
  const uy = dy / dl;
  const tx = ux > 1e-6 ? (R - ox) / ux : ux < -1e-6 ? (L - ox) / ux : Infinity;
  const ty = uy > 1e-6 ? (B - oy) / uy : uy < -1e-6 ? (T - oy) / uy : Infinity;
  let t = Math.min(tx, ty);
  if (!Number.isFinite(t) || t < 0) t = 0;
  const px = clamp(ox + ux * t, L, R);
  const py = clamp(oy + uy * t, T, B);
  // Size by rock size (bosses biggest).
  const s = c.boss ? 15 : 7 + Math.min(5, c.r * zoom * 0.12);
  return { px, py, ux, uy, s };
}

// Radar: whole arena, scaled to fit a 92x92 panel that keeps the arena aspect.
export function drawRadar(ctx, game) {
  const view = game.view;
  const world = game.world;
  if (!view || !world || !(world.w > 0) || !(world.h > 0)) return;
  const zoom = game.zoom || 1;
  const cam = game.cam || { x: 0, y: 0 };
  const accent = (game.sector && game.sector.accent) || CYAN;
  const time = game.time || 0;

  const px = view.w - RADAR_RIGHT;
  const py = RADAR_TOP;
  const inner = RADAR_SIZE - 2 * RADAR_PAD;
  const k = Math.min(inner / world.w, inner / world.h);
  const mw = world.w * k;
  const mh = world.h * k;
  const mx = px + (RADAR_SIZE - mw) / 2;
  const my = py + (RADAR_SIZE - mh) / 2;

  ctx.save();

  // Panel.
  roundRectPath(ctx, px, py, RADAR_SIZE, RADAR_SIZE, 12);
  ctx.fillStyle = 'rgba(7, 11, 26, 0.6)';
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Arena outline.
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = LILAC;
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);

  // Everything inside the map area.
  ctx.save();
  ctx.beginPath();
  ctx.rect(mx, my, mw, mh);
  ctx.clip();

  // Visible camera rectangle.
  const vw = view.w / zoom;
  const vh = view.h / zoom;
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + cam.x * k + 0.5, my + cam.y * k + 0.5, vw * k - 1, vh * k - 1);

  // Rocks, batched per colour (shards skipped).
  const asteroids = game.asteroids || [];
  ctx.globalAlpha = 0.9;
  radarDots(ctx, asteroids, mx, my, k, 1.6, LILAC, 'rock');
  radarDots(ctx, asteroids, mx, my, k, 2.4, ORANGE, 'comet');
  radarDots(ctx, asteroids, mx, my, k, 1.8, ICE, 'crystal');

  // Bosses: pulsing gold dots. Wide faint halo pass, then the crisp dots (no shadowBlur).
  const bosses = game.bosses || [];
  const pulse = 0.5 + 0.5 * Math.sin(time * 6);
  const bossR = 3 + pulse * 1.2;
  ctx.fillStyle = GOLD;
  for (let pass = 0; pass < 2; pass++) {
    const r = pass === 0 ? bossR * 2.2 : bossR;
    let anyBoss = false;
    ctx.beginPath();
    for (const b of bosses) {
      if (!b || b.dead) continue;
      ctx.moveTo(mx + b.x * k + r, my + b.y * k);
      ctx.arc(mx + b.x * k, my + b.y * k, r, 0, TAU);
      anyBoss = true;
    }
    if (anyBoss) {
      ctx.globalAlpha = pass === 0 ? 0.25 : 1;
      ctx.fill();
    }
  }

  // Ship: cyan dot with a small halo (drawn last).
  if (game.ship) {
    const sx = mx + game.ship.x * k;
    const sy = my + game.ship.y * k;
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, TAU);
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, TAU);
    ctx.globalAlpha = 1;
    ctx.fill();
  }

  ctx.restore();
  ctx.restore();
}

// One batched fill for asteroids of a given kind ('rock' also matches kind undefined).
function radarDots(ctx, list, mx, my, k, r, color, want) {
  let any = false;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a || a.dead) continue;
    const kind = a.kind || 'rock';
    if (want === 'rock' ? kind !== 'rock' : kind !== want) continue;
    const x = mx + a.x * k;
    const y = my + a.y * k;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
    any = true;
  }
  if (any) ctx.fill();
}
