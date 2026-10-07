// Headless-Chromium flow test for Stardust Breaker v2 (star map, sectors, bosses, unlocks). Needs the server running.
//
//   bun tools/smoke.ts          BASE env: default http://127.0.0.1:8780, CHROME_PATH overrides the binary
//
// Steps 01-11 share one phone context (390x844) because the star-map unlocks carry from step 09 to step 10 onward.
// Step 12 is a separate desktop context. Saves tools/out/NN-name.png and prints PASS/FAIL per step.
// Exit 1 on any failed step or console/page error.
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

// Real mouse click on the centre of a visible element. Star-map cards pulse, so Playwright's own click can stall.
async function tap(page: Page, sel: string, timeout = 3000) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`${sel} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
async function shipAndCam(page: Page): Promise<Ship & { cx: number; cy: number }> {
  const s = await page.evaluate(() => {
    const g = (window as any).__game;
    return g?.ship ? { x: g.ship.x, y: g.ship.y, angle: g.ship.angle, cx: g.cam.x, cy: g.cam.y } : null;
  });
  if (!s) throw new Error('window.__game.ship missing');
  return s;
}

async function rerolls(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__game.rerolls as number);
}

async function loadGame(page: Page) {
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 15000 });
  await page.waitForFunction(() => !!(window as any).__game, null, { timeout: 10000 }).catch(() => {
    throw new Error('window.__game never appeared (module error? see console errors)');
  });
}

// Star-map cards are rendered by ui.js into #map-sectors. The card is the direct child of #map-sectors that holds
// the sector name. It is tagged data-smoke="<key>" so later steps can find it again.
type MapCard = { locked: boolean; text: string };
async function mapCard(page: Page, name: string, key: string): Promise<MapCard> {
  const info = await page.evaluate(([n, k]: [string, string]) => {
    const box = document.querySelector('#map-sectors');
    if (!box) return null;
    const holds = (e: Element) => (e.textContent ?? '').includes(n);
    const innermost = [...box.querySelectorAll('*')].filter(holds).filter(e => ![...e.children].some(holds));
    const hit = innermost[0];
    if (!hit) return null;
    let card: Element = hit;
    while (card.parentElement && card.parentElement !== box) card = card.parentElement;
    card.setAttribute('data-smoke', k);
    const cardText = (card.textContent ?? '').replace(/\s+/g, ' ').trim();
    const cls = card.getAttribute('class') ?? '';
    return { text: cardText, locked: /locked/i.test(cls) || /LOCKED|🔒/.test(cardText) };
  }, [name, key] as [string, string]);
  if (!info) throw new Error(`no star-map card for "${name}" in #map-sectors`);
  return info;
}

// On the map: tap an open sector card and wait for the run to start.
async function startSectorFromMap(page: Page, name: string, key: string) {
  await expectVisible(page, '#map-screen');
  const card = await mapCard(page, name, key);
  check(!card.locked, `"${name}" card is locked`);
  await tap(page, `#map-sectors [data-smoke="${key}"]`);
  await expectState(page, 'playing');
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
    await expectVisible(page, '#start-btn');
    await shot(page, '01-title');
    loaded = true;
  });

  await step('02 PLAY opens the star map: belt open, storm locked', async () => {
    need(loaded);
    await page.click('#start-btn', { timeout: 3000 });
    await expectVisible(page, '#map-screen');
    const belt = await mapCard(page, 'Asteroid Belt', 'belt');
    const storm = await mapCard(page, 'Ion Storm', 'storm');
    check(!belt.locked, 'Asteroid Belt card is locked, expected open');
    check(storm.locked, 'Ion Storm card is open, expected locked before any clear');
    await shot(page, '02-map');
    return 'belt open, storm locked';
  });

  await step('03 tapping the belt card starts Asteroid Belt', async () => {
    need(loaded);
    await startSectorFromMap(page, 'Asteroid Belt', 'belt');
    await expectVisible(page, '#hud');
    const hud = await text(page, '#hud-sector');
    check(hud.includes('Asteroid Belt'), `#hud-sector says "${hud}", expected "Asteroid Belt"`);
    await settlePlaying(page);
    // debug-only: random rock collisions must not end the run early (killShip still works while invincible)
    await page.evaluate(() => (window as any).__game.debug.setInvincible(true));
    await page.waitForTimeout(1500); // let the first wave arrive
    await shot(page, '03-play');
  });

  await step('04 touch joystick steers the ship and the camera follows', async () => {
    need(loaded);
    await settlePlaying(page);
    const a = await shipAndCam(page);
    try {
      await page.mouse.move(120, 600);
      await page.mouse.down();
      await page.mouse.move(180, 560, { steps: 12 });
      await page.waitForTimeout(1500);
      await shot(page, '04-steer');
    } finally {
      await page.mouse.up();
    }
    const b = await shipAndCam(page);
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    const camMoved = Math.hypot(b.cx - a.cx, b.cy - a.cy);
    check(moved > 5, `ship moved only ${moved.toFixed(1)} px (${a.x.toFixed(0)},${a.y.toFixed(0)} -> ${b.x.toFixed(0)},${b.y.toFixed(0)})`);
    check(camMoved > 5, `camera moved only ${camMoved.toFixed(1)} px while the ship moved ${moved.toFixed(0)} px`);
    return `ship ${moved.toFixed(0)} px, cam ${camMoved.toFixed(0)} px`;
  });

  await step('05 level-up shows 3 cards; reroll swaps them; a pick resumes play', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.evaluate(() => (window as any).__game.debug.levelUp());
    await expectVisible(page, '#upgrade-screen');
    // Cards ignore taps for 250 ms after they appear; the pop-in animation also needs to settle.
    await page.waitForTimeout(400);
    await shot(page, '05-upgrade');
    const cards = await page.locator('.upgrade-card').count();
    check(cards === 3, `${cards} upgrade cards shown, expected 3`);
    const meta = await text(page, '#upgrade-meta');
    check(/UPGRADES\s*\d+\s*\/\s*6/.test(meta), `#upgrade-meta says "${meta}", expected "UPGRADES n/6"`);

    const before = await rerolls(page);
    const label = await text(page, '#reroll-btn');
    let note: string;
    if (before > 0) {
      check(label.includes(`(${before})`), `#reroll-btn says "${label}", expected the count (${before})`);
      await page.evaluate(() => { (window as any).__smokeCard = document.querySelector('.upgrade-card'); });
      await page.click('#reroll-btn', { timeout: 3000 });
      await page.waitForFunction((n: number) => (window as any).__game.rerolls === n, before - 1, { timeout: 3000 })
        .catch(async () => {
          const now = await rerolls(page);
          throw new Error(`rerolls is ${now} after reroll, expected ${before - 1}`);
        });
      await page.waitForFunction(() => {
        const old = (window as any).__smokeCard;
        const now = document.querySelector('.upgrade-card');
        return !!now && (!old || !old.isConnected || now.textContent !== old.textContent);
      }, null, { timeout: 3000 }).catch(() => {
        throw new Error('upgrade cards did not re-render after reroll');
      });
      const after = await text(page, '#reroll-btn');
      check(after.includes(`(${before - 1})`), `#reroll-btn says "${after}" after reroll, expected (${before - 1})`);
      await page.waitForTimeout(300); // the re-rendered cards ignore taps for 250 ms
      note = `rerolls ${before} -> ${before - 1}`;
    } else {
      check(await page.evaluate(() => (document.querySelector('#reroll-btn') as HTMLButtonElement | null)?.disabled === true),
        '#reroll-btn is enabled with 0 rerolls left');
      note = 'no rerolls left, button disabled';
    }
    await page.locator('.upgrade-card').first().click({ timeout: 3000 });
    await expectState(page, 'playing');
    return note;
  });

  await step('06 clearing a wave starts wave 2', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.evaluate(() => (window as any).__game.debug.clearWave());
    await page.waitForFunction(() => (window as any).__game.wave >= 2, null, { timeout: 6000 }).catch(async () => {
      const now = await page.evaluate(() => (window as any).__game.wave);
      throw new Error(`wave is ${now} 6 s after clearWave, expected >= 2`);
    });
    const wave = await page.evaluate(() => (window as any).__game.wave);
    await shot(page, '06-wave2');
    return `wave ${wave}`;
  });

  await step('07 P pauses and the resume button continues', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.keyboard.press('p');
    try {
      await expectState(page, 'pause', 2000);
      await expectVisible(page, '#pause-screen');
      await shot(page, '07-pause');
    } finally {
      if (await page.evaluate(visibleExpr('#pause-screen'))) await tap(page, '#resume-btn');
    }
    await expectState(page, 'playing', 3000);
  });

  await step('08 skipToBoss shows the boss bar with one boss', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.evaluate(() => (window as any).__game.debug.skipToBoss());
    await expectVisible(page, '#boss-bar', 6000);
    await page.waitForFunction(() => (window as any).__game.bosses?.length === 1, null, { timeout: 6000 }).catch(async () => {
      const now = await page.evaluate(() => (window as any).__game.bosses?.length);
      throw new Error(`bosses.length is ${now}, expected 1`);
    });
    const name = await text(page, '#boss-name');
    check(name.length > 0, '#boss-name is empty');
    await shot(page, '08-boss');
    return name;
  });

  await step('09 killBoss clears the sector: victory screen with an unlock chip', async () => {
    need(loaded);
    await settlePlaying(page);
    await page.evaluate(() => (window as any).__game.debug.killBoss());
    await expectState(page, 'victory', 6000);
    await expectVisible(page, '#victory-screen');
    const news = await page.evaluate(() => (document.querySelector('#victory-unlocks')?.textContent ?? '').match(/NEW/g)?.length ?? 0);
    check(news >= 1, `#victory-unlocks shows ${news} NEW chips, expected >= 1`);
    await shot(page, '09-victory');
    return `${news} NEW unlock chip(s)`;
  });

  await step('10 victory STAR MAP: the storm sector is now open', async () => {
    need(loaded);
    await tap(page, '#victory-map-btn');
    await expectState(page, 'map');
    await expectVisible(page, '#map-screen');
    const storm = await mapCard(page, 'Ion Storm', 'storm');
    check(!storm.locked, 'Ion Storm still locked after clearing Asteroid Belt');
    await shot(page, '10-map-storm');
  });

  await step('11 storm run: killShip shows game over; STAR MAP returns to the map', async () => {
    need(loaded);
    await startSectorFromMap(page, 'Ion Storm', 'storm');
    const hud = await text(page, '#hud-sector');
    check(hud.includes('Ion Storm'), `#hud-sector says "${hud}", expected "Ion Storm"`);
    await settlePlaying(page);
    await page.evaluate(() => (window as any).__game.debug.killShip());
    await expectVisible(page, '#gameover-screen', 5000);
    const stats = await text(page, '#gameover-stats');
    check(stats.length > 0, '#gameover-stats is empty');
    await shot(page, '11-gameover');
    await tap(page, '#gameover-map-btn');
    await expectState(page, 'map');
    await expectVisible(page, '#map-screen');
  });

  await step('12 desktop 1280x800: belt run plays', async () => {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    try {
      const dp = await desk.newPage();
      listen(dp);
      await loadGame(dp);
      await dp.click('#start-btn', { timeout: 3000 });
      await startSectorFromMap(dp, 'Asteroid Belt', 'belt');
      await expectVisible(dp, '#hud');
      await dp.waitForTimeout(1000);
      await shot(dp, '12-desktop');
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
