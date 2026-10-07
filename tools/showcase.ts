// Headless-Chromium showcase + balance probe for Stardust Breaker v2. Needs the server running.
//
//   bun tools/showcase.ts       BASE env: default http://127.0.0.1:8780, CHROME_PATH overrides the binary
//                               BALANCE_RUNS env: number of bot runs in the balance probe (default 1)
//
// Every run is a fresh phone context (390x844) on BASE/?unlockall=1 with a clean localStorage.
//   (a) sectors: for each of the 6 sectors, a sector scene (sector-<id>.png) and a boss scene after skipToBoss
//       (boss-<id>.png). Each scene prints its FPS (rAF count over 2 s, measured while the stick is held); FAIL < 20.
//   (b) evolutions: in the belt, grant the base upgrade to max + its partner at 1 + the evolution, then 3 s
//       (evo-<id>.png). Asserts the evolution's stats flag is set.
//   (c) balance probe (informational): a bot plays the belt, not invincible, for up to 180 s. It reports the time
//       to the first boss, and whether it won (victory) or died. A console error or a bot that cannot act is a FAIL.
// Saves tools/out/*.png. Prints PASS/FAIL per step. Exit 1 on any FAIL or console/page error.
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = (process.env.BASE ?? 'http://127.0.0.1:8780').replace(/\/$/, '');
const BALANCE_RUNS = Number(process.env.BALANCE_RUNS ?? 1);
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

// Visible = in the DOM, no `hidden` attribute, non-zero box. A string so it works for evaluate and waitForFunction.
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

async function text(page: Page, sel: string): Promise<string> {
  return (await page.evaluate((s: string) => document.querySelector(s)?.textContent ?? '', sel)).replace(/\s+/g, ' ').trim();
}

// A natural XP level-up can open the upgrade screen at any moment, and the debug hooks only act in state 'playing'.
// Pick the first card to close it; cards ignore taps for 250 ms after opening, so wait 300 ms first.
async function settlePlaying(page: Page) {
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(visibleExpr('#upgrade-screen')))) break;
    await page.waitForTimeout(300);
    await page.locator('.upgrade-card').first().click({ timeout: 3000 });
  }
  await expectState(page, 'playing', 3000);
}

async function loadGame(page: Page) {
  await page.goto(`${base}/?unlockall=1`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForFunction(() => !!(window as any).__game, null, { timeout: 10000 }).catch(() => {
    throw new Error('window.__game never appeared (module error? see console errors)');
  });
}

// Fresh page on ?unlockall=1, debug.startSector(id), invincible, and xp pinned at 0 so that no level-up opens
// the upgrade screen over a scene. Invincibility is set after the start, because start resets it.
async function startSectorRun(page: Page, id: string) {
  await loadGame(page);
  await page.evaluate((s: string) => (window as any).__game.debug.startSector(s), id);
  await expectState(page, 'playing');
  await expectVisible(page, '#hud');
  await settlePlaying(page);
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.debug.setInvincible(true);
    (window as any).__showcaseXpPin = setInterval(() => { if (g.state === 'playing') g.xp = 0; }, 4);
  });
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

// Joystick: pointer goes down here; the knob offset from here is the stick (RANGE 60 px in input.js).
const ORIGIN = { x: 195, y: 640 };

// Gentle circle on the stick (30 px knob radius) for about `ms`: the ship turns and drifts. Always releases.
async function gentleStick(page: Page, ms: number) {
  const steps = Math.max(1, Math.round(ms / 100));
  await page.mouse.move(ORIGIN.x, ORIGIN.y);
  await page.mouse.down();
  try {
    for (let i = 0; i <= steps; i++) {
      const a = (i / 30) * Math.PI * 1.6;
      await page.mouse.move(ORIGIN.x + 30 * Math.cos(a), ORIGIN.y + 30 * Math.sin(a));
      await page.waitForTimeout(100);
    }
  } finally {
    await page.mouse.up().catch(() => {});
  }
}

// Frames over 2 s, measured inside the page with requestAnimationFrame. Start it, then move the stick while it runs.
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

// Runs the stick for `ms` while measuring FPS over the first 2 s of it.
async function scene(page: Page, ms: number): Promise<number> {
  const fpsP = page.evaluate(FPS_EXPR) as Promise<number>;
  await gentleStick(page, ms);
  const fps = await fpsP;
  check(fps >= 20, `FPS ${fps.toFixed(1)} < 20`);
  return fps;
}

// --- (a) sectors ---

type Sector = { id: string; name: string; boss: string[] };

const SECTORS: Sector[] = [
  { id: 'belt', name: 'Asteroid Belt', boss: ['mother'] },
  { id: 'storm', name: 'Ion Storm', boss: ['stormeye'] },
  { id: 'gravity', name: 'Gravity Well', boss: ['horizon'] },
  { id: 'ice', name: 'Ice Field', boss: ['glacier'] },
  { id: 'ember', name: 'Ember Nebula', boss: ['phoenix'] },
  // deep: the boss after skipToBoss is the first of the rotation
  { id: 'deep', name: 'The Deep', boss: ['mother', 'stormeye', 'horizon', 'glacier', 'phoenix'] },
];

async function sectorScene(page: Page, sec: Sector): Promise<string> {
  await startSectorRun(page, sec.id);
  const hud = await text(page, '#hud-sector');
  check(hud.includes(sec.name), `#hud-sector says "${hud}", expected "${sec.name}"`);
  const fps = await scene(page, 4000);
  await shot(page, `sector-${sec.id}`);
  return `${fps.toFixed(1)} fps (headless, indicative)`;
}

// The boss spawns away from the ship; it may need a few seconds to drift or fly into the view.
const BOSS_ON_SCREEN = () => {
  const g = (window as any).__game;
  const b = (g.bosses ?? []).find((x: any) => !x.dead);
  if (!b) return false;
  const sx = (b.x - g.cam.x) * g.zoom;
  const sy = (b.y - g.cam.y) * g.zoom;
  return sx > 0 && sx < g.view.w && sy > 0 && sy < g.view.h;
};

async function bossScene(page: Page, sec: Sector): Promise<string> {
  await settlePlaying(page);
  await page.evaluate(() => (window as any).__game.debug.skipToBoss());
  await expectVisible(page, '#boss-bar', 6000);
  await page.waitForFunction(() => (window as any).__game.bosses?.length === 1, null, { timeout: 6000 }).catch(async () => {
    const now = await page.evaluate(() => (window as any).__game.bosses?.length);
    throw new Error(`bosses.length is ${now}, expected 1`);
  });
  const type = await page.evaluate(() => (window as any).__game.bosses[0].type as string);
  check(sec.boss.includes(type), `boss type "${type}", expected ${sec.boss.join(' / ')}`);
  const onScreen = await page.waitForFunction(BOSS_ON_SCREEN, null, { timeout: 8000 }).then(() => true, () => false);
  const fps = await scene(page, 4000);
  await shot(page, `boss-${sec.id}`);
  return `${fps.toFixed(1)} fps (headless, indicative), boss ${type}${onScreen ? '' : ', NOT on screen after 8 s'}`;
}

async function sectorRun(browser: Browser, sec: Sector) {
  const { ctx, page } = await phoneContext(browser);
  try {
    await step(`sector ${sec.id}: ${sec.name}`, () => sectorScene(page, sec));
    await step(`boss ${sec.id}: after skipToBoss`, () => bossScene(page, sec));
    await page.evaluate(() => clearInterval((window as any).__showcaseXpPin)).catch(() => {});
  } finally {
    await ctx.close();
  }
}

// --- (b) evolutions ---

// Evolution -> [base upgrade granted to its max, partner granted at 1, stats flag]. Each evolution requires
// requires: [base, partner] in upgrades.js. Max levels are the upgrade table's max values.
type Evo = { id: string; name: string; base: [string, number]; partner: string; flag: string };

const EVOLUTIONS: Evo[] = [
  { id: 'prism', name: 'Prism Lance', base: ['multishot', 4], partner: 'pierce', flag: 'evoPrism' },
  { id: 'railstorm', name: 'Railstorm', base: ['rapid', 5], partner: 'damage', flag: 'evoRail' },
  { id: 'tempest', name: 'Tempest', base: ['chain', 4], partner: 'velocity', flag: 'evoTempest' },
  { id: 'swarm', name: 'Cluster Swarm', base: ['missiles', 4], partner: 'nova', flag: 'evoCluster' },
  { id: 'singularity', name: 'Singularity Blades', base: ['orbit', 4], partner: 'magnet', flag: 'evoSingularity' },
  { id: 'blackstar', name: 'Black Star', base: ['gravbomb', 3], partner: 'nova', flag: 'evoBlackstar' },
  { id: 'aegis', name: 'Aegis Core', base: ['shield', 3], partner: 'hull', flag: 'evoAegis' },
  { id: 'hivemind', name: 'Hivemind', base: ['drone', 3], partner: 'missiles', flag: 'evoHive' },
];

async function evoScene(page: Page, evo: Evo): Promise<string> {
  await startSectorRun(page, 'belt');
  const [baseId, baseMax] = evo.base;
  await settlePlaying(page);
  await page.evaluate(([b, bMax, p, e]: [string, number, string, string]) => {
    const g = (window as any).__game;
    g.debug.grant(b, bMax);
    g.debug.grant(p, 1);
    g.debug.grant(e, 1);
  }, [baseId, baseMax, evo.partner, evo.id] as [string, number, string, string]);

  const got = await page.evaluate(([b, p, e, flag]: [string, string, string, string]) => {
    const g = (window as any).__game;
    return { base: g.levels[b] ?? 0, partner: g.levels[p] ?? 0, evo: g.levels[e] ?? 0, flag: g.stats[flag] === true };
  }, [baseId, evo.partner, evo.id, evo.flag] as [string, string, string, string]);
  check(got.base === baseMax, `${baseId} is level ${got.base}, expected ${baseMax}`);
  check(got.partner === 1, `${evo.partner} is level ${got.partner}, expected 1`);
  check(got.evo === 1, `${evo.id} is level ${got.evo}, expected 1`);
  check(got.flag, `stats.${evo.flag} is not true after granting ${evo.id}`);

  const fps = await scene(page, 3000);
  await shot(page, `evo-${evo.id}`);
  return `${evo.name}, ${fps.toFixed(1)} fps (headless, indicative)`;
}

async function evoRun(browser: Browser, evo: Evo) {
  const { ctx, page } = await phoneContext(browser);
  try {
    await step(`evo ${evo.id}: ${evo.name}`, () => evoScene(page, evo));
    await page.evaluate(() => clearInterval((window as any).__showcaseXpPin)).catch(() => {});
  } finally {
    await ctx.close();
  }
}

// --- (c) balance probe ---

type Snap = {
  state: string;
  wave: number;
  level: number;
  score: number;
  phase: string;
  maxHull: number;
  ship: { x: number; y: number; alive: boolean; hull: number } | null;
  targets: { x: number; y: number; r: number }[];
  bossCount: number;
  upgradeOpen: boolean;
  evoCards: number;
  levels: Record<string, number>;
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
    const live = (o: any) => !o.dead;
    const s = g.ship;
    return {
      state: g.state,
      wave: g.wave,
      level: g.level,
      score: g.score,
      phase: g.phase,
      maxHull: g.stats?.maxHull ?? 0,
      ship: s ? { x: s.x, y: s.y, alive: !!s.alive, hull: s.hull } : null,
      targets: [...(g.asteroids ?? []), ...(g.bosses ?? [])].filter(live)
        .map((t: any) => ({ x: t.x, y: t.y, r: t.radius })),
      bossCount: (g.bosses ?? []).filter(live).length,
      upgradeOpen: open('#upgrade-screen'),
      evoCards: document.querySelectorAll('.upgrade-card.rarity-legendary').length,
      levels: { ...g.levels },
    };
  });
}

const KEEP_AWAY = 140; // px of clear space, edge to edge, the bot keeps from every target
const CHASE_MAG = 45; // stick px (of 60): thrust toward the nearest target
const FLEE_MAG = 55; // stick px: thrust away from the targets that are too close

// World coordinates, no wrap-around (the arena is bounded). Chase the nearest target while it is farther than
// KEEP_AWAY; inside KEEP_AWAY, thrust away from every target that is too close.
function steer(ship: NonNullable<Snap['ship']>, targets: Snap['targets']): { dir: number; mag: number } | null {
  if (targets.length === 0) return null;
  let fx = 0;
  let fy = 0;
  let bestGap = Infinity;
  let best = { dx: 0, dy: 0 };
  for (const t of targets) {
    const dx = t.x - ship.x;
    const dy = t.y - ship.y;
    const dist = Math.hypot(dx, dy) || 1;
    const gap = dist - t.r;
    if (gap < bestGap) { bestGap = gap; best = { dx, dy }; }
    if (gap < KEEP_AWAY) {
      const push = (KEEP_AWAY - gap) / KEEP_AWAY;
      fx -= (dx / dist) * push;
      fy -= (dy / dist) * push;
    }
  }
  if (bestGap < KEEP_AWAY) return { dir: Math.atan2(fy, fx), mag: FLEE_MAG };
  return { dir: Math.atan2(best.dy, best.dx), mag: CHASE_MAG };
}

type BotState = { holding: boolean };

async function botTick(page: Page, s: Snap, st: BotState) {
  if (s.upgradeOpen || s.state === 'upgrade') {
    if (st.holding) { await page.mouse.up(); st.holding = false; }
    await page.waitForTimeout(300); // cards ignore taps for 250 ms after they appear
    // An evolution card if one is offered, else the first card.
    const pick = s.evoCards > 0 ? '.upgrade-card.rarity-legendary' : '.upgrade-card';
    await page.locator(pick).first().click({ timeout: 2000 });
    return;
  }
  if (s.state !== 'playing' || !s.ship) return;
  // A card tap releases the stick (pointerup), so press it again after every upgrade screen.
  if (!st.holding) {
    await page.mouse.move(ORIGIN.x, ORIGIN.y);
    await page.mouse.down();
    st.holding = true;
  }
  const c = s.ship.alive ? steer(s.ship, s.targets) : null;
  const dir = c?.dir ?? 0;
  const mag = c?.mag ?? 0;
  await page.mouse.move(ORIGIN.x + mag * Math.cos(dir), ORIGIN.y + mag * Math.sin(dir));
}

type Row = { run: string; result: string; bossAt: string; wave: number; level: number; score: number; cards: number; hull: string; upgrades: string };

const LIMIT = 180;

const timelineLine = (t: number, s: Snap) =>
  `  t=${String(Math.round(t)).padStart(3)}s  ${s.state.padEnd(8)} alive=${s.ship?.alive ? 'yes' : 'no '}  ` +
  `wave=${s.wave} level=${s.level} score=${s.score} hull=${s.ship?.hull ?? '-'}/${s.maxHull}`;

const upgradesTaken = (levels: Record<string, number>) =>
  Object.entries(levels).filter(([, v]) => v > 0).map(([k, v]) => `${k} x${v}`).join(', ') || 'none';

async function balanceRun(browser: Browser, n: number): Promise<Row> {
  const label = `bot #${n}`;
  const { ctx, page } = await phoneContext(browser);
  const mark = errors.length;
  const st: BotState = { holding: false };
  let last: Snap | null = null;
  let result = 'no result';
  let bossAt: number | null = null;
  let cards = 0;
  let wasOpen = false;
  console.log(`\n== balance: ${label} (belt, not invincible, up to ${LIMIT} s) ==`);
  try {
    await loadGame(page);
    await page.evaluate(() => (window as any).__game.debug.startSector('belt'));
    await expectState(page, 'playing');
    await expectVisible(page, '#hud');
    const t0 = Date.now();
    let nextReport = 10;
    for (;;) {
      const t = (Date.now() - t0) / 1000;
      const s = await snap(page);
      last = s;
      if (s.upgradeOpen && !wasOpen) cards++;
      wasOpen = s.upgradeOpen;
      if (bossAt === null && s.bossCount > 0) {
        bossAt = t;
        console.log(`${timelineLine(t, s)}  <- boss on the field (${s.phase})`);
      }
      if (t >= nextReport) {
        console.log(timelineLine(t, s));
        nextReport += 10;
      }
      if (s.state === 'victory') {
        result = `VICTORY at ${t.toFixed(1)} s`;
        console.log(`${timelineLine(t, s)}  <- victory`);
        break;
      }
      if (s.state === 'over') {
        result = `died at ${t.toFixed(1)} s`;
        console.log(`${timelineLine(t, s)}  <- game over`);
        break;
      }
      if (t >= LIMIT) {
        result = `alive at ${LIMIT} s (time limit)`;
        break;
      }
      await botTick(page, s, st);
      await page.waitForTimeout(100);
    }
  } catch (e) {
    failed++;
    result = `bot error: ${reason(e)}`;
    console.log(`FAIL balance ${label}: ${reason(e)}`);
  } finally {
    await page.mouse.up().catch(() => {});
    await ctx.close();
  }
  const fresh = errors.slice(mark);
  if (fresh.length) {
    failed++;
    console.log(`FAIL balance ${label}: console error: ${reason(fresh[0])}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`);
  }
  const s = last;
  return {
    run: label,
    result,
    bossAt: bossAt === null ? 'never' : `${bossAt.toFixed(1)} s`,
    wave: s?.wave ?? 0,
    level: s?.level ?? 0,
    score: s?.score ?? 0,
    cards,
    hull: s?.ship ? `${s.ship.hull}/${s.maxHull}` : '-',
    upgrades: upgradesTaken(s?.levels ?? {}),
  };
}

async function runBalance(browser: Browser) {
  const rows: Row[] = [];
  for (let n = 1; n <= BALANCE_RUNS; n++) rows.push(await balanceRun(browser, n));
  console.log('\nBALANCE SUMMARY (informational)');
  const cols: (keyof Row)[] = ['run', 'result', 'bossAt', 'wave', 'level', 'score', 'cards', 'hull', 'upgrades'];
  const width = (c: keyof Row) => Math.max(c.length, ...rows.map(r => String(r[c]).length));
  const fmtRow = (get: (c: keyof Row) => string) => cols.map(c => get(c).padEnd(width(c))).join('  ');
  console.log(fmtRow(c => c));
  console.log(fmtRow(c => '-'.repeat(width(c))));
  for (const r of rows) console.log(fmtRow(c => String(r[c])));
}

async function runAll(browser: Browser) {
  for (const sec of SECTORS) await sectorRun(browser, sec);
  for (const evo of EVOLUTIONS) await evoRun(browser, evo);
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
