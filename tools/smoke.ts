// Headless-Chromium smoke test for Stardust Breaker. Needs the server running (bun server.ts).
//
//   bun tools/smoke.ts          BASE env: default http://127.0.0.1:8780, CHROME_PATH overrides the binary
//
// Saves tools/out/NN-name.png and prints PASS/FAIL per step. Exit 1 on any failed step or console error.
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

async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    passed++;
    console.log(`PASS ${name}${note ? ` (${note})` : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${reason(e)}`);
  }
}

function check(ok: unknown, msg: string): asserts ok {
  if (!ok) throw new Error(msg);
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

async function currentState(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__game?.state ?? '');
}

// A natural XP level-up can open the upgrade screen at any moment, and the debug hooks and the P key only act
// in state 'playing'. Pick the first card to close the screen; cards ignore taps for 250 ms after opening, so
// wait 300 ms first. Another pending level-up can reopen the screen, hence up to 5 picks.
async function settlePlaying(page: Page) {
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(visibleExpr('#upgrade-screen')))) break;
    await page.waitForTimeout(300);
    await page.locator('.upgrade-card').first().click({ timeout: 3000 });
  }
  await expectState(page, 'playing', 3000);
}

type Ship = { x: number; y: number; angle: number };
async function shipState(page: Page): Promise<Ship> {
  const s = await page.evaluate(() => {
    const g = (window as any).__game;
    return g?.ship ? { x: g.ship.x, y: g.ship.y, angle: g.ship.angle } : null;
  });
  if (!s) throw new Error('window.__game.ship missing');
  return s;
}

async function loadGame(page: Page) {
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForFunction(() => !!(window as any).__game, null, { timeout: 10000 }).catch(() => {
    throw new Error('window.__game never appeared (module error? see console errors)');
  });
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(outDir, `${name}.png`) });

function listen(page: Page) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
}

async function runSteps(browser: Browser) {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  });
  const page = await phone.newPage();
  listen(page);
  let loaded = false;
  const need = (ok: boolean) => check(ok, 'skipped: page did not load');

  await step('01 title screen loads', async () => {
    await loadGame(page);
    await expectVisible(page, '#title-screen');
    await shot(page, '01-title');
    loaded = true;
  });

  await step('02 start button starts a run', async () => {
    need(loaded);
    await page.click('#start-btn', { timeout: 3000 });
    await expectState(page, 'playing');
    // debug-only: random asteroid collisions must not end the run early (killShip still works while invincible)
    await page.evaluate(() => (window as any).__game.debug.setInvincible(true));
    await expectVisible(page, '#hud');
    await page.waitForTimeout(2000);
    await shot(page, '02-play');
  });

  await step('03 touch joystick steers the ship', async () => {
    need(loaded);
    const a = await shipState(page);
    try {
      await page.mouse.move(120, 600);
      await page.mouse.down();
      await page.mouse.move(180, 560, { steps: 12 });
      await page.waitForTimeout(1500);
      await shot(page, '03-steer');
    } finally {
      await page.mouse.up();
    }
    const b = await shipState(page);
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    const turned = Math.abs(Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle)));
    check(moved > 5 || turned > 0.1,
      `ship neither moved nor turned: before (${a.x.toFixed(0)},${a.y.toFixed(0)}) ${a.angle.toFixed(2)} rad, ` +
      `after (${b.x.toFixed(0)},${b.y.toFixed(0)}) ${b.angle.toFixed(2)} rad`);
    return `moved ${moved.toFixed(0)}px, turned ${turned.toFixed(2)} rad`;
  });

  await step('04 level-up shows upgrade cards; tap one resumes play', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.evaluate(() => (window as any).__game.debug.levelUp());
    await expectVisible(page, '#upgrade-screen');
    // ui.js ignores taps for 250 ms after the cards appear; the pop-in animation also needs to settle
    await page.waitForTimeout(400);
    await shot(page, '04-upgrade');
    await page.locator('.upgrade-card').first().click({ timeout: 3000 });
    await expectState(page, 'playing');
  });

  await step('05 clearing a wave starts wave 2', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.evaluate(() => (window as any).__game.debug.clearWave());
    await page.waitForFunction(() => (window as any).__game.wave >= 2, null, { timeout: 5000 }).catch(() => {});
    const wave = await page.evaluate(() => (window as any).__game.wave);
    check(wave >= 2, `wave is ${wave} after clearWave, expected >= 2`);
    await shot(page, '05-wave2');
    return `wave ${wave}`;
  });

  await step('06 P pauses and the resume button continues', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.keyboard.press('p');
    try {
      await expectState(page, 'pause', 2000);
      await expectVisible(page, '#pause-screen');
      await shot(page, '06-pause');
    } finally {
      if (await page.evaluate(visibleExpr('#pause-screen'))) await page.click('#resume-btn', { timeout: 3000 });
    }
    await expectState(page, 'playing', 3000);
  });

  await step('07 killing the ship shows game over', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.evaluate(() => (window as any).__game.debug.killShip());
    await expectVisible(page, '#gameover-screen', 5000);
    const stats = (await page.textContent('#gameover-stats'))?.trim() ?? '';
    check(stats, '#gameover-stats is empty');
    await shot(page, '07-gameover');
  });

  await step('08 desktop viewport plays', async () => {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    try {
      const dp = await desk.newPage();
      listen(dp);
      await loadGame(dp);
      await dp.click('#start-btn', { timeout: 3000 });
      await expectState(dp, 'playing');
      await dp.waitForTimeout(1000);
      await shot(dp, '08-desktop');
    } finally {
      await desk.close();
    }
  });

  await phone.close();
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
    await runSteps(browser);
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
