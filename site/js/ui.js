const $ = (id) => document.getElementById(id);

const dom = {
  hud: $('hud'),
  score: $('hud-score'),
  wave: $('hud-wave'),
  level: $('hud-level'),
  xpFill: $('hud-xp-fill'),
  hull: $('hud-hull'),
  sector: $('hud-sector'),
  muteBtn: $('mute-btn'),
  banner: $('banner'),
  best: $('title-best'),
  upgradeCards: $('upgrade-cards'),
  upgradeSlots: $('upgrade-slots'),
  upgradeMeta: $('upgrade-meta'),
  reroll: $('reroll-btn'),
  gameoverStats: $('gameover-stats'),
  gameoverUpgrades: $('gameover-upgrades'),
  mapSectors: $('map-sectors'),
  victoryStats: $('victory-stats'),
  victoryUnlocks: $('victory-unlocks'),
  bossBar: $('boss-bar'),
  bossName: $('boss-name'),
  bossHp: $('boss-hp'),
  bossFill: $('boss-hp-fill'),
  intro: $('sector-intro'),
  introName: $('sector-intro-name'),
  introTag: $('sector-intro-tag'),
};

const SCREENS = {
  title: $('title-screen'),
  map: $('map-screen'),
  upgrade: $('upgrade-screen'),
  pause: $('pause-screen'),
  gameover: $('gameover-screen'),
  victory: $('victory-screen'),
};

const HUD_SCREENS = new Set(['playing', 'upgrade', 'pause']);
const PICK_LOCK_MS = 250;
const MAP_LOCK_MS = 400;
const RARITY_NAMES = new Set(['common', 'rare', 'epic', 'legendary']);

const shown = { score: NaN, wave: NaN, level: NaN, xp: '', pips: '', sector: '', boss: NaN };

// Calls a handler if it was supplied (lets older main.js wiring keep working).
function call(handlers, name, ...args) {
  const fn = handlers[name];
  if (typeof fn === 'function') fn(...args);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmt(n) {
  return Math.floor(n).toLocaleString('en-US');
}

let H = {};

export function initUI(handlers) {
  H = handlers || {};
  // PLAY opens the star map (v2); falls back to the v1 onStart if no map handler is wired.
  $('start-btn').addEventListener('click', () => (H.onMapOpen ? call(H, 'onMapOpen') : call(H, 'onStart')));
  $('restart-btn').addEventListener('click', () => call(H, 'onRestart'));
  $('pause-btn').addEventListener('click', () => call(H, 'onPause'));
  $('resume-btn').addEventListener('click', () => call(H, 'onResume'));
  $('quit-btn').addEventListener('click', () => call(H, 'onQuit'));
  dom.muteBtn.addEventListener('click', () => call(H, 'onToggleMute'));
  $('map-back-btn').addEventListener('click', () => call(H, 'onMapBack'));
  $('continue-btn').addEventListener('click', () => call(H, 'onContinue'));
  $('victory-map-btn').addEventListener('click', () => call(H, 'onVictoryMap'));
  $('gameover-map-btn').addEventListener('click', () => call(H, 'onGameOverMap'));
  dom.reroll.addEventListener('click', () => {
    if (dom.reroll.disabled) return;
    call(H, 'onReroll');
  });
}

export function showScreen(name) {
  for (const node of Object.values(SCREENS)) node.hidden = true;
  if (SCREENS[name]) SCREENS[name].hidden = false;
  dom.hud.hidden = !HUD_SCREENS.has(name);
  if (name !== 'playing') hideSectorIntroNow();
}

export function setBest(best) {
  dom.best.textContent = fmt(best);
}

function renderPips(h) {
  const hull = Array.from({ length: h.maxHull }, (_, i) => el('span', i < h.hull ? 'pip hull on' : 'pip hull'));
  const shield = Array.from({ length: h.shieldMax }, (_, i) => el('span', i < h.shield ? 'pip shield on' : 'pip shield'));
  dom.hull.replaceChildren(...hull, ...shield);
  dom.hull.setAttribute('aria-label', `Hull ${h.hull} of ${h.maxHull}, shield ${h.shield} of ${h.shieldMax}`);
}

export function updateHUD(h) {
  if (h.score !== shown.score) {
    shown.score = h.score;
    dom.score.textContent = fmt(h.score);
    dom.score.classList.remove('bump');
    void dom.score.offsetWidth;
    dom.score.classList.add('bump');
  }
  if (h.wave !== shown.wave) {
    shown.wave = h.wave;
    dom.wave.textContent = `WAVE ${h.wave}`;
  }
  if (h.level !== shown.level) {
    shown.level = h.level;
    dom.level.textContent = `LV ${h.level}`;
  }
  const pct = h.xpNext > 0 ? Math.min(100, Math.max(0, (h.xp / h.xpNext) * 100)) : 0;
  const xp = pct.toFixed(1);
  if (xp !== shown.xp) {
    shown.xp = xp;
    dom.xpFill.style.width = `${xp}%`;
  }
  const pips = `${h.hull}/${h.maxHull}/${h.shield}/${h.shieldMax}`;
  if (pips !== shown.pips) {
    shown.pips = pips;
    renderPips(h);
  }
  if (typeof h.sector === 'string' && h.sector !== shown.sector) {
    shown.sector = h.sector;
    dom.sector.textContent = h.sector;
  }
}

function buildCard(c, index) {
  const rarity = RARITY_NAMES.has(c.rarity) ? c.rarity : 'common';
  const legendary = rarity === 'legendary';
  const card = el('button', `upgrade-card rarity-${rarity}`);
  card.type = 'button';
  card.dataset.id = c.id;
  card.style.animationDelay = `${index * 70}ms`;

  const pips = el('span', 'uc-pips');
  const max = Math.min(c.maxLevel || 1, 12);
  for (let i = 0; i < max; i++) pips.append(el('span', i <= c.level ? 'uc-pip on' : 'uc-pip'));

  const head = el('span', 'uc-head');
  head.append(el('span', 'uc-name', c.name), el('span', 'uc-rarity', legendary ? 'LEGENDARY' : rarity.toUpperCase()));

  const foot = el('span', 'uc-foot');
  const levelText = legendary ? 'MAX' : c.level === 0 ? 'NEW' : `Lv ${c.level} → ${c.level + 1}`;
  foot.append(el('span', 'uc-level', levelText), pips);

  const main = el('span', 'uc-main');
  main.append(head, el('span', 'uc-desc', c.desc));
  if (legendary) {
    const parts = Array.isArray(c.requires) ? c.requires.filter(Boolean).join(' + ') : '';
    main.append(el('span', 'uc-requires', parts ? `requires ${parts}` : 'requires 2 upgrades'));
    main.append(el('span', 'uc-evo-tag', 'EVOLUTION'));
  }
  main.append(foot);

  card.append(el('span', 'uc-icon', c.icon), main);
  return card;
}

export function showUpgradeChoices(choices, onPick, meta = {}) {
  const openedAt = performance.now();
  let picked = false;
  dom.upgradeCards.replaceChildren(
    ...choices.map((c, i) => {
      const card = buildCard(c, i);
      card.addEventListener('click', () => {
        if (picked || performance.now() - openedAt < PICK_LOCK_MS) return;
        picked = true;
        onPick(c.id);
      });
      return card;
    }),
  );

  const rerolls = Math.max(0, Number(meta.rerolls) || 0);
  dom.reroll.textContent = `⟳ REROLL (${rerolls})`;
  dom.reroll.disabled = rerolls <= 0;
  if (typeof meta.slotsUsed === 'number' && typeof meta.slotsMax === 'number') {
    dom.upgradeSlots.textContent = `UPGRADES ${meta.slotsUsed}/${meta.slotsMax}`;
    dom.upgradeSlots.classList.toggle('is-full', meta.slotsUsed >= meta.slotsMax);
  }
  showScreen('upgrade');
}

function statCell(label, value, { wide = false, badge = false } = {}) {
  const cell = el('div', wide ? 'stat stat-wide' : 'stat');
  const valueNode = el('div', 'stat-value', String(value));
  if (badge) valueNode.append(el('span', 'badge', 'NEW BEST'));
  cell.append(el('div', 'stat-label', label), valueNode);
  return cell;
}

export function showGameOver(s) {
  dom.gameoverStats.replaceChildren(
    statCell('SCORE', fmt(s.score), { wide: true }),
    statCell('WAVE', s.wave),
    statCell('LEVEL', s.level),
    statCell('BEST', fmt(s.best), { badge: s.isNewBest }),
  );

  const chips = s.upgrades.map((u) => {
    const chip = el('span', 'chip');
    chip.append(el('span', 'chip-icon', u.icon), el('span', 'chip-name', u.name), el('span', 'chip-lv', `Lv ${u.level}`));
    return chip;
  });
  if (chips.length === 0) chips.push(el('span', 'chip chip-empty', 'No upgrades taken'));
  dom.gameoverUpgrades.replaceChildren(...chips);

  showScreen('gameover');
}

export function showBanner(text, ms = 1400) {
  const b = dom.banner;
  b.textContent = text;
  b.style.setProperty('--banner-ms', `${ms}ms`);
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}

export function setMuted(muted) {
  dom.muteBtn.textContent = muted ? '🔇' : '🔊';
  dom.muteBtn.setAttribute('aria-pressed', String(muted));
  dom.muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
}

// ---------- v2: star map ----------

const STATUS = {
  locked: { label: '🔒 LOCKED', cls: 'badge-locked' },
  open: { label: 'OPEN', cls: '' },
  new: { label: 'NEW', cls: 'badge-new' },
  cleared: { label: '✓ CLEARED', cls: 'badge-cleared' },
};

// Each sector is a row: the number badge sits in the left gutter (joined to its neighbours by the
// route line drawn in CSS) and the card sits to its right. Returns { row, card }.
function buildSectorCard(s, index) {
  const status = STATUS[s.status] ? s.status : 'locked';
  const locked = status === 'locked';
  const row = el('div', `sector-row is-${status}`);
  row.style.setProperty('--sc-delay', `${index * 50}ms`);
  if (s.accent) row.style.setProperty('--sc', s.accent);

  const card = el('button', `sector-card is-${status}`);
  card.type = 'button';
  card.dataset.id = s.id;
  if (locked) {
    card.disabled = true;
    card.setAttribute('aria-disabled', 'true');
  }
  card.setAttribute('aria-label', `Sector ${s.index}: ${s.name}, ${STATUS[status].label.replace(/^🔒\s*/, '')}`);

  const num = el('span', 'sc-num', String(s.index));
  num.setAttribute('aria-hidden', 'true');
  const title = el('span', 'sc-title');
  title.append(el('span', 'sc-name', s.name), el('span', 'sc-tag', s.tagline));
  const badge = el('span', `sc-badge ${STATUS[status].cls}`.trim(), STATUS[status].label);
  const top = el('span', 'sc-top');
  top.append(title, badge);

  const boss = el('span', 'sc-boss', 'BOSS ');
  boss.append(el('b', '', s.bossName || '???'));

  const foot = el('span', 'sc-foot');
  const rewards = el('span', 'sc-rewards');
  const chips = Array.isArray(s.rewards) ? s.rewards.slice(0, 4) : [];
  for (const r of chips) {
    const chip = el('span', 'sc-reward');
    chip.append(el('i', '', r.icon || '•'), el('span', '', r.name));
    rewards.append(chip);
  }
  const best = el('span', 'sc-best');
  if (!locked && s.best > 0) {
    best.append('BEST ', el('b', '', fmt(s.best)));
  }
  foot.append(rewards, best);

  card.append(top, boss, foot);
  row.append(num, card);
  return { row, card };
}

export function showMap(sectors) {
  let chosen = false;
  const list = Array.isArray(sectors) ? sectors : [];
  dom.mapSectors.replaceChildren(
    ...list.map((s, i) => {
      const { row, card } = buildSectorCard(s, i);
      card.addEventListener('click', () => {
        if (chosen || card.disabled) return;
        chosen = true;
        call(H, 'onSelectSector', s.id);
      });
      return row;
    }),
  );
  dom.mapSectors.scrollTop = 0;
  showScreen('map');
}

// ---------- v2: sector cleared ----------

export function showVictory(v) {
  const kicker = $('victory-screen').querySelector('.victory-kicker');
  if (kicker) kicker.textContent = `✦ ${v.sectorName || 'SECTOR'} ✦`;

  const bossCell = statCell('BOSS DEFEATED', v.bossName || '—', { wide: true });
  const valueNode = bossCell.querySelector('.stat-value');
  if (valueNode) valueNode.style.fontSize = '20px';
  dom.victoryStats.replaceChildren(
    statCell('SCORE', fmt(v.score || 0), { wide: true }),
    statCell('WAVE', v.wave ?? 0),
    statCell('LEVEL', v.level ?? 1),
    bossCell,
  );

  const unlocks = Array.isArray(v.unlocks) ? v.unlocks : [];
  const chips = unlocks.map((u) => {
    const label = u.kind === 'sector' ? `New sector: ${u.name}` : u.name;
    const chip = el('span', `chip chip-new${u.kind === 'evolution' ? ' chip-kind-evolution' : ''}`);
    chip.append(el('span', 'chip-icon', u.icon || '✦'), el('span', 'chip-name', label), el('span', 'chip-tag', 'NEW'));
    return chip;
  });
  if (chips.length === 0) chips.push(el('span', 'chip chip-empty', 'Already cleared'));
  dom.victoryUnlocks.replaceChildren(...chips);

  showScreen('victory');
}

// ---------- v2: boss bar ----------

export function showBossBar(name) {
  dom.bossName.textContent = name || '';
  dom.bossFill.style.width = '100%';
  dom.bossBar.hidden = false;
  shown.boss = 1;
}

export function updateBossBar(frac) {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
  const q = Math.round(f * 1000) / 1000;
  if (q === shown.boss) return;
  const dropped = q < shown.boss;
  shown.boss = q;
  dom.bossFill.style.width = `${(q * 100).toFixed(1)}%`;
  if (dropped && !dom.bossBar.hidden) {
    // restart the shake and flash on every hit that lowers the bar
    dom.bossBar.classList.remove('shake');
    dom.bossHp.classList.remove('flash');
    void dom.bossBar.offsetWidth;
    dom.bossBar.classList.add('shake');
    dom.bossHp.classList.add('flash');
  }
}

export function hideBossBar() {
  dom.bossBar.hidden = true;
  dom.bossBar.classList.remove('shake');
  dom.bossHp.classList.remove('flash');
  shown.boss = NaN;
}

// ---------- v2: sector intro (decorative; pointer-events none, hides itself after ~2.6 s) ----------

const INTRO_MS = 2600;
let introTimer = 0;

function hideSectorIntroNow() {
  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = 0;
  }
  dom.intro.hidden = true;
}

export function showSectorIntro(name, tagline, accent) {
  if (accent) {
    dom.intro.style.setProperty('--sector', accent);
    dom.sector.style.setProperty('--sector', accent);
    dom.bossBar.style.setProperty('--sector', accent);
  }
  dom.introName.textContent = name || '';
  dom.introTag.textContent = tagline || '';
  // toggling hidden restarts the CSS fade on every call
  hideSectorIntroNow();
  dom.intro.hidden = false;
  introTimer = setTimeout(hideSectorIntroNow, INTRO_MS);
}
