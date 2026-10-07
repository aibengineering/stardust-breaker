const $ = (id) => document.getElementById(id);

const dom = {
  hud: $('hud'),
  score: $('hud-score'),
  wave: $('hud-wave'),
  level: $('hud-level'),
  xpFill: $('hud-xp-fill'),
  hull: $('hud-hull'),
  muteBtn: $('mute-btn'),
  banner: $('banner'),
  best: $('title-best'),
  upgradeCards: $('upgrade-cards'),
  gameoverStats: $('gameover-stats'),
  gameoverUpgrades: $('gameover-upgrades'),
};

const SCREENS = {
  title: $('title-screen'),
  upgrade: $('upgrade-screen'),
  pause: $('pause-screen'),
  gameover: $('gameover-screen'),
};

const HUD_SCREENS = new Set(['playing', 'upgrade', 'pause']);
const PICK_LOCK_MS = 250;

const shown = { score: NaN, wave: NaN, level: NaN, xp: '', pips: '' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmt(n) {
  return Math.floor(n).toLocaleString('en-US');
}

export function initUI(handlers) {
  $('start-btn').addEventListener('click', () => handlers.onStart());
  $('restart-btn').addEventListener('click', () => handlers.onRestart());
  $('pause-btn').addEventListener('click', () => handlers.onPause());
  $('resume-btn').addEventListener('click', () => handlers.onResume());
  $('quit-btn').addEventListener('click', () => handlers.onQuit());
  dom.muteBtn.addEventListener('click', () => handlers.onToggleMute());
}

export function showScreen(name) {
  for (const node of Object.values(SCREENS)) node.hidden = true;
  if (SCREENS[name]) SCREENS[name].hidden = false;
  dom.hud.hidden = !HUD_SCREENS.has(name);
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
}

function buildCard(c, index) {
  const card = el('button', `upgrade-card rarity-${c.rarity}`);
  card.type = 'button';
  card.dataset.id = c.id;
  card.style.animationDelay = `${index * 70}ms`;

  const pips = el('span', 'uc-pips');
  for (let i = 0; i < c.maxLevel; i++) pips.append(el('span', i <= c.level ? 'uc-pip on' : 'uc-pip'));

  const head = el('span', 'uc-head');
  head.append(el('span', 'uc-name', c.name), el('span', 'uc-rarity', c.rarity.toUpperCase()));

  const foot = el('span', 'uc-foot');
  foot.append(el('span', 'uc-level', c.level === 0 ? 'NEW' : `Lv ${c.level} → ${c.level + 1}`), pips);

  const main = el('span', 'uc-main');
  main.append(head, el('span', 'uc-desc', c.desc), foot);

  card.append(el('span', 'uc-icon', c.icon), main);
  return card;
}

export function showUpgradeChoices(choices, onPick) {
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
