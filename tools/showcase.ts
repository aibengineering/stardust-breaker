// Headless-Chromium weapon showcase + balance probe for Stardust Breaker. Needs the server running (bun server.ts).
//
//   bun tools/showcase.ts       BASE env: default http://127.0.0.1:8780, CHROME_PATH overrides the binary
//
// Part 1: one fresh run per loadout (invincible, upgrades granted via debug.grant), saves
//         tools/out/showcase-*.png, asserts no console errors, prints FPS (FAIL below 20).
// Part 2: balance probe, non-invincible runs (idle, then two bot runs). Informational only, except that
//         a console error during a run is a FAIL.
// Exit 1 on console/page errors, a missing expected element/state, or FPS < 20.
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = (process.env.BASE ?? 'http://127.0.0.1:8780').replace(/\/$/, '');
const outDir = join(import.meta.dir, 'out');
mkdirSync(outDir, { recursive: true });

const errors: string[] = [];
let passed = 0;
let failed = 0;

const reason = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0];

function check(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error(msg);
}

// Same PASS/FAIL style as smoke.ts. A step also fails if it produced console/page errors.
async function step(name: string, fn: () => Promise<string | void>) {
  const mark = errors.length;
  let note: string | void;
  try {
    note = await fn();
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${reason(e)}`);
    return;
  }
  await new Promise(r => setTimeout(r, 150)); // let trailing console events arrive
  const fresh = errors.slice(mark);
  if (fresh.length) {
    failed++;
    console.log(`FAIL ${name}: console error: ${reason(fresh[0])}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`);
    return;
  }
  passed++;
  console.log(`PASS ${name}${note ? ` (${note})` : ''}`);
}

function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), '.cache/ms-playwright');
  const found = existsSync(root)
    ? readdirSync(root).filter(d => d.startsWith('chromium_headless_shell')).sort()
        .map(d => join(root, d, 'chrome-headless-shell-linux64/chrome-headless-shell')).filter(existsSync).pop()
    : undefined;
  if (!found) throw new Error('no chrome-headless-shell under ~/.cache/ms-playwright (set CHROME_PATH)');
  return found;
}

// Evaluated in the page; a string so the same predicate works for evaluate and waitForFunction.
const visibleExpr = (sel: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el || el.hidden) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
})()`;

async function expectVisible(page: Page, sel: string, timeout = 5000) {
  await page.waitForFunction(visibleExpr(sel), null, { timeout }).catch(() => {
    throw new Error(`${sel} not visible within ${timeout} ms`);
  });
}

async function expectState(page: Page, want: string, timeout = 5000) {
  await page.waitForFunction((w: string) => (window as any).__game?.state === w, want, { timeout }).catch(async () => {
    const now = await page.evaluate(() => (window as any).__game?.state ?? '(no __game)').catch(() => '?');
    throw new Error(`state is '${now}', expected '${want}' within ${timeout} ms`);
  });
}

async function loadGame(page: Page) {
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForFunction(() => !!(window as any).__game, null, { timeout: 10000 }).catch(() => {
    throw new Error('window.__game never appeared (module error? see console errors)');
  });
}

// Fresh run: reload, press PLAY. invincible is reset by start(), so callers set it afterwards.
async function startRun(page: Page) {
  await loadGame(page);
  await page.click('#start-btn', { timeout: 3000 });
  await expectState(page, 'playing');
  await expectVisible(page, '#hud');
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(outDir, `${name}.png`) });

function listen(page: Page) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
}

async function phoneContext(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  listen(page);
  return { ctx, page };
}

// Joystick: pointer goes down here; knob offsets from here are the stick (RANGE 60 px in input.js).
const ORIGIN = { x: 195, y: 640 };

// Upgrade ids and maxLevel, copied from site/js/upgrades.js.
const ALL_AT_MAX: [string, number][] = [
  ['rapid', 5], ['damage', 5], ['velocity', 4], ['engine', 4], ['magnet', 4], ['hull', 4],
  ['multishot', 4], ['pierce', 3], ['rear', 2], ['shield', 3], ['greed', 3],
  ['orbit', 4], ['missiles', 4], ['nova', 3],
];

type Loadout = {
  key: string;
  title: string;
  grants: [string, number][];
  wait?: 'missiles' | 'nova';
  shieldCheck?: boolean;
};

const LOADOUTS: Loadout[] = [
  { key: 'orbit', title: 'a) orbit x4', grants: [['orbit', 4]] },
  { key: 'missiles', title: 'b) missiles x4', grants: [['missiles', 4]], wait: 'missiles' },
  { key: 'nova', title: 'c) nova x3', grants: [['nova', 3]], wait: 'nova' },
  {
    key: 'guns', title: 'd) multishot x4, rear x2, rapid x5, pierce x3',
    grants: [['multishot', 4], ['rear', 2], ['rapid', 5], ['pierce', 3]],
  },
  { key: 'shield', title: 'e) shield x3, hull x4', grants: [['shield', 3], ['hull', 4]], shieldCheck: true },
  { key: 'everything', title: 'f) every upgrade at maxLevel', grants: ALL_AT_MAX, shieldCheck: true },
];

// Frames over 2 s, measured inside the page with requestAnimationFrame.
const FPS_EXPR = `new Promise(res => {
  let n = 0;
  const t0 = performance.now();
  const f = () => {
    n++;
    const dt = performance.now() - t0;
    if (dt < 2000) requestAnimationFrame(f);
    else res(n * 1000 / dt);
  };
  requestAnimationFrame(f);
})`;

async function runLoadout(page: Page, lo: Loadout): Promise<string> {
  await startRun(page);

  const hooks = await page.evaluate(() => {
    const d = (window as any).__game?.debug;
    return typeof d?.grant === 'function' && typeof d?.setInvincible === 'function';
  });
  check(hooks, 'window.__game.debug.grant / setInvincible missing');

  await page.evaluate((grants: [string, number][]) => {
    const g = (window as any).__game;
    g.debug.setInvincible(true);
    for (const [id, n] of grants) g.debug.grant(id, n);
    // A level-up would open the upgrade screen over the showcase, adding cards nobody asked for.
    // Pin xp at 0 so only the granted loadout is on screen (gems never reach the 10 xp needed).
    (window as any).__showcaseXpPin = setInterval(() => { if (g.state === 'playing') g.xp = 0; }, 4);
  }, lo.grants);

  const levels = await page.evaluate(() => ({ ...(window as any).__game.levels }));
  for (const [id, n] of lo.grants) {
    check(levels[id] === n, `grant ${id} x${n} not applied (levels.${id} = ${levels[id] ?? 0})`);
  }

  let note = '';
  try {
    // Gentle joystick drag: a 30 px knob circle over ~3 s, so the ship turns and drifts.
    await page.mouse.move(ORIGIN.x, ORIGIN.y);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) {
      const a = (i / 30) * Math.PI * 1.6;
      await page.mouse.move(ORIGIN.x + 30 * Math.cos(a), ORIGIN.y + 30 * Math.sin(a));
      await page.waitForTimeout(100);
    }

    if (lo.wait === 'missiles') {
      await page.waitForFunction(() => ((window as any).__game.missiles?.length ?? 0) > 0, null, { timeout: 6000 })
        .catch(() => { throw new Error('no missile in flight within 6 s'); });
    }
    if (lo.wait === 'nova') {
      await page.waitForFunction(
        () => (window as any).__game.particles.some((p: any) => p.type === 'ring' && p.maxR >= 140),
        null,
        { timeout: 10000 },
      ).catch(() => { throw new Error('no nova ring (maxR >= 140) within 10 s'); });
    }

    if (lo.shieldCheck) {
      const s = await page.evaluate(() => {
        const g = (window as any).__game;
        return { shield: g.ship.shield, maxHull: g.stats.maxHull, hull: g.ship.hull };
      });
      check(s.shield === 3, `ship.shield is ${s.shield}, expected 3`);
      check(s.maxHull === 7, `stats.maxHull is ${s.maxHull}, expected 7`);
      await page.waitForTimeout(150); // HUD refreshes once per frame
      const pips = await page.evaluate(() => {
        const q = (sel: string) => document.querySelectorAll(sel).length;
        return {
          hull: q('#hud-hull .pip.hull'), hullOn: q('#hud-hull .pip.hull.on'),
          shield: q('#hud-hull .pip.shield'), shieldOn: q('#hud-hull .pip.shield.on'),
        };
      });
      check(pips.hull === 7 && pips.shield === 3, `HUD pips: ${pips.hull} hull / ${pips.shield} shield, expected 7 / 3`);
      check(pips.shieldOn === 3, `HUD shows ${pips.shieldOn} shield pips lit, expected 3`);
      check(pips.hullOn === 7, `HUD shows ${pips.hullOn} hull pips lit, expected 7`);
    }

    check(!(await page.evaluate(visibleExpr('#upgrade-screen'))), 'upgrade screen opened during the showcase');
    await shot(page, `showcase-${lo.key}`);

    const fps = await page.evaluate(FPS_EXPR) as number;
    note = `${fps.toFixed(1)} fps (headless, indicative)`;
    check(fps >= 20, `FPS ${fps.toFixed(1)} < 20`);
  } finally {
    await page.mouse.up().catch(() => {});
    await page.evaluate(() => clearInterval((window as any).__showcaseXpPin)).catch(() => {});
  }
  return note;
}

async function runShowcase(browser: Browser) {
  const { ctx, page } = await phoneContext(browser);
  try {
    for (const lo of LOADOUTS) {
      await step(`showcase ${lo.key}: ${lo.title}`, () => runLoadout(page, lo));
    }
  } finally {
    await ctx.close();
  }
}

// --- balance probe ---

type Snap = {
  state: string;
  wave: number;
  level: number;
  score: number;
  maxHull: number;
  levels: Record<string, number>;
  ship: { x: number; y: number; angle: number; alive: boolean; hull: number } | null;
  world: { w: number; h: number };
  asteroids: { x: number; y: number; r: number }[];
  upgradeOpen: boolean;
};

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const open = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el || el.hidden) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const s = g.ship;
    return {
      state: g.state,
      wave: g.wave,
      level: g.level,
      score: g.score,
      maxHull: g.stats.maxHull,
      levels: { ...g.levels },
      ship: s ? { x: s.x, y: s.y, angle: s.angle, alive: s.alive, hull: s.hull } : null,
      world: { w: g.world.w, h: g.world.h },
      asteroids: g.asteroids.filter((a: any) => !a.dead).map((a: any) => ({ x: a.x, y: a.y, r: a.radius })),
      upgradeOpen: open('#upgrade-screen'),
    };
  });
}

// Shortest signed offset on a wrapping axis.
const wrapD = (d: number, size: number) => ((((d + size / 2) % size) + size) % size) - size / 2;
const SAFE_GAP = 120; // px of clear space the bot keeps from asteroid edges
const FACE_MAG = 18; // stick px: turns toward target, below the 0.35 thrust threshold
const FLEE_MAG = 50; // stick px: turns away and thrusts

// Face the nearest asteroid; if any is closer than SAFE_GAP, thrust away from all of them.
function steerTarget(s: NonNullable<Snap['ship']>, world: Snap['world'], asteroids: Snap['asteroids']) {
  let fx = 0;
  let fy = 0;
  let nearest = Infinity;
  let nd: [number, number] = [0, 0];
  for (const a of asteroids) {
    const dx = wrapD(a.x - s.x, world.w);
    const dy = wrapD(a.y - s.y, world.h);
    const dist = Math.hypot(dx, dy) || 1;
    const gap = dist - a.r;
    if (gap < nearest) { nearest = gap; nd = [dx, dy]; }
    if (gap < SAFE_GAP) {
      const push = (SAFE_GAP - gap) / SAFE_GAP;
      fx -= (dx / dist) * push;
      fy -= (dy / dist) * push;
    }
  }
  if (nearest === Infinity) return { dir: s.angle, mag: 0 };
  if (nearest < SAFE_GAP) return { dir: Math.atan2(fy, fx), mag: FLEE_MAG };
  return { dir: Math.atan2(nd[1], nd[0]), mag: FACE_MAG };
}

async function botTick(page: Page, s: Snap, st: { holding: boolean }) {
  if (s.upgradeOpen) {
    if (st.holding) { await page.mouse.up(); st.holding = false; }
    await page.waitForTimeout(300); // cards ignore taps for 250 ms after they appear
    if (await page.evaluate(visibleExpr('#upgrade-screen'))) {
      await page.locator('.upgrade-card').first().click({ timeout: 2000 });
    }
    return;
  }
  if (s.state !== 'playing' || !s.ship) return;
  // A card tap releases the stick (pointerup), so press it again after every upgrade screen.
  if (!st.holding) {
    await page.mouse.move(ORIGIN.x, ORIGIN.y);
    await page.mouse.down();
    st.holding = true;
  }
  const { dir, mag } = s.ship.alive ? steerTarget(s.ship, s.world, s.asteroids) : { dir: 0, mag: 0 };
  await page.mouse.move(ORIGIN.x + mag * Math.cos(dir), ORIGIN.y + mag * Math.sin(dir));
}

type Row = { run: string; result: string; wave: number; level: number; score: number; hull: string; upgrades: string };

const timelineLine = (t: number, s: Snap) =>
  `  t=${String(Math.round(t)).padStart(3)}s  ${s.state.padEnd(8)} alive=${s.ship?.alive ? 'yes' : 'no '}  ` +
  `wave=${s.wave} level=${s.level} score=${s.score} hull=${s.ship?.hull ?? '-'}/${s.maxHull}`;

const upgradesTaken = (levels: Record<string, number>) =>
  Object.entries(levels).filter(([, v]) => v > 0).map(([k, v]) => `${k} x${v}`).join(', ') || 'none';

async function balanceRun(browser: Browser, kind: 'idle' | 'bot', n: number): Promise<Row> {
  const label = `${kind} #${n}`;
  const { ctx, page } = await phoneContext(browser);
  const mark = errors.length;
  const st = { holding: false };
  let last: Snap | null = null;
  let result = 'no result';
  console.log(`\n== balance: ${label} (not invincible) ==`);
  try {
    await startRun(page);
    const limit = kind === 'idle' ? 60 : 120;
    const t0 = Date.now();
    let nextReport = 10;
    let deathLogged = false;
    for (;;) {
      const t = (Date.now() - t0) / 1000;
      const s = await snap(page);
      last = s;
      if (t >= nextReport) {
        console.log(timelineLine(t, s));
        nextReport += 10;
      }
      if (!deathLogged && s.ship && !s.ship.alive) {
        deathLogged = true;
        console.log(`${timelineLine(t, s)}  <- ship destroyed`);
      }
      if (s.state === 'over') {
        result = `game over at ${t.toFixed(1)}s`;
        console.log(`${timelineLine(t, s)}  <- game over`);
        break;
      }
      if (t >= limit) {
        result = `alive at ${limit}s (time limit)`;
        break;
      }
      if (kind === 'bot') await botTick(page, s, st);
      await page.waitForTimeout(100);
    }
  } finally {
    await page.mouse.up().catch(() => {});
    await ctx.close();
  }
  const fresh = errors.slice(mark);
  if (fresh.length) {
    failed++;
    console.log(`FAIL balance ${label}: console error: ${reason(fresh[0])}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`);
  }
  const s = last!;
  return {
    run: label,
    result,
    wave: s?.wave ?? 0,
    level: s?.level ?? 0,
    score: s?.score ?? 0,
    hull: s?.ship ? `${s.ship.hull}/${s.maxHull}` : '-',
    upgrades: upgradesTaken(s?.levels ?? {}),
  };
}

async function runBalance(browser: Browser) {
  const rows: Row[] = [];
  for (const [kind, n] of [['idle', 1], ['bot', 1], ['bot', 2]] as const) {
    rows.push(await balanceRun(browser, kind, n));
  }
  console.log('\nBALANCE SUMMARY (informational)');
  const cols: (keyof Row)[] = ['run', 'result', 'wave', 'level', 'score', 'hull', 'upgrades'];
  const width = (c: keyof Row) => Math.max(c.length, ...rows.map(r => String(r[c]).length));
  const fmtRow = (get: (c: keyof Row) => string) => cols.map(c => get(c).padEnd(width(c))).join('  ');
  console.log(fmtRow(c => c));
  console.log(fmtRow(c => '-'.repeat(width(c))));
  for (const r of rows) console.log(fmtRow(c => String(r[c])));
}

async function runAll(browser: Browser) {
  await runShowcase(browser);
  await runBalance(browser);
}

async function main() {
  try {
    await fetch(`${base}/`, { signal: AbortSignal.timeout(3000) });
  } catch (e) {
    console.log(`FAIL preflight: cannot reach BASE ${base} (is the server running? bun server.ts) - ${reason(e)}`);
    process.exitCode = 1;
    return;
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath: chromePath() });
    await runAll(browser);
  } catch (e) {
    failed++;
    console.log(`FAIL launch: ${reason(e)}`);
  } finally {
    await browser?.close();
  }

  const unique = [...new Set(errors)];
  if (unique.length) {
    console.log(`\nCONSOLE/PAGE ERRORS (${unique.length}):`);
    for (const e of unique) console.log(`  ${e}`);
  }
  console.log(`\n${passed} passed, ${failed} failed, ${unique.length} console/page errors`);
  process.exitCode = failed || unique.length ? 1 : 0;
}

await main();
