import { UPGRADES, getUpgrade } from './upgrades.js';

const SAVE_KEY = 'sb-progress-v2';
const SECTOR_ICON = '🪐';

export const SECTORS = [
  {
    id: 'belt',
    name: 'Asteroid Belt',
    tagline: 'Where it all began. Rocks. Lots of rocks.',
    tier: 1,
    waves: 5,
    system: 'none',
    systemParams: {},
    boss: 'mother',
    arena: { w: 1300, h: 1700 },
    bg: '#070b1a',
    accent: '#4df3ff',
    rockKind: 'rock',
    rewards: { upgrades: ['missiles', 'nova'], evolutions: ['prism', 'railstorm'] },
    next: 'storm',
  },
  {
    id: 'storm',
    name: 'Ion Storm',
    tagline: 'Lightning strikes where the air crackles. Stardust is supercharged.',
    tier: 2,
    waves: 6,
    system: 'storm',
    systemParams: {},
    boss: 'stormeye',
    arena: { w: 1400, h: 1800 },
    bg: '#0b0820',
    accent: '#b8a9ff',
    rockKind: 'rock',
    rewards: { upgrades: ['chain'], evolutions: ['tempest', 'swarm'] },
    next: 'gravity',
  },
  {
    id: 'gravity',
    name: 'Gravity Well',
    tagline: 'A black hole at the centre drags everything in — including you.',
    tier: 3,
    waves: 6,
    system: 'gravity',
    systemParams: {},
    boss: 'horizon',
    arena: { w: 1500, h: 1500 },
    bg: '#06060f',
    accent: '#ff5ad1',
    rockKind: 'rock',
    rewards: { upgrades: ['gravbomb'], evolutions: ['singularity', 'blackstar'] },
    next: 'ice',
  },
  {
    id: 'ice',
    name: 'Ice Field',
    tagline: 'Frictionless drift. Crystal rocks shatter into three.',
    tier: 4,
    waves: 7,
    system: 'ice',
    systemParams: {},
    boss: 'glacier',
    arena: { w: 1500, h: 1900 },
    bg: '#061420',
    accent: '#9fe8ff',
    rockKind: 'crystal',
    rewards: { upgrades: ['frost', 'drone'], evolutions: ['aegis'] },
    next: 'ember',
  },
  {
    id: 'ember',
    name: 'Ember Nebula',
    tagline: 'Darkness and homing comets. Trust your radar.',
    tier: 5,
    waves: 7,
    system: 'ember',
    systemParams: {},
    boss: 'phoenix',
    arena: { w: 1500, h: 1900 },
    bg: '#120806',
    accent: '#ff7a3d',
    rockKind: 'rock',
    rewards: { upgrades: [], evolutions: ['hivemind'] },
    next: 'deep',
  },
  {
    id: 'deep',
    name: 'The Deep',
    tagline: 'Every hazard. Every boss. No end.',
    tier: 6,
    waves: Infinity,
    system: 'chaos',
    systemParams: {},
    boss: null,
    bosses: ['mother', 'stormeye', 'horizon', 'glacier', 'phoenix'],
    arena: { w: 1600, h: 2000 },
    bg: '#04040a',
    accent: '#ffd166',
    rockKind: 'rock',
    rewards: { upgrades: [], evolutions: [] },
    next: null,
  },
];

export const BASE_POOL = [
  'rapid',
  'damage',
  'velocity',
  'engine',
  'magnet',
  'hull',
  'multishot',
  'pierce',
  'rear',
  'shield',
  'greed',
  'orbit',
  'overcharge',
];

export function getSector(id) {
  return SECTORS.find((s) => s.id === id) || null;
}

function freshProgress() {
  return { cleared: {}, best: {}, unlockAll: false };
}

// True when the last loadProgress() granted unlockAll only because of `?unlockall=1` (session-only:
// saveProgress must not persist it). Set by loadProgress, read by saveProgress.
let urlUnlock = false;

// Tolerant of missing, unavailable or corrupt storage. Only known sector ids are kept.
export function loadProgress() {
  const p = freshProgress();
  urlUnlock = false;
  let storedUnlock = false;
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem(SAVE_KEY) : null;
    const data = raw ? JSON.parse(raw) : null;
    if (data && typeof data === 'object') {
      const cleared = data.cleared && typeof data.cleared === 'object' ? data.cleared : {};
      const best = data.best && typeof data.best === 'object' ? data.best : {};
      for (const s of SECTORS) {
        if (cleared[s.id] === true) p.cleared[s.id] = true;
        if (typeof best[s.id] === 'number' && Number.isFinite(best[s.id])) p.best[s.id] = best[s.id];
      }
      storedUnlock = data.unlockAll === true;
      p.unlockAll = storedUnlock;
    }
  } catch {
    // corrupt JSON or storage blocked: start fresh
  }
  try {
    const search = typeof location !== 'undefined' && location && typeof location.search === 'string' ? location.search : '';
    if (new URLSearchParams(search).get('unlockall') === '1') {
      p.unlockAll = true;
      if (!storedUnlock) urlUnlock = true;
    }
  } catch {
    // no usable location
  }
  return p;
}

export function saveProgress(p) {
  if (!p) return;
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        cleared: p.cleared || {},
        best: p.best || {},
        // the ?unlockall=1 flag is session-only; game.debug.unlockAll sets p.unlockAll and persists
        unlockAll: p.unlockAll === true && !urlUnlock,
      }),
    );
  } catch {
    // storage full or blocked: progress just isn't persisted
  }
}

export function isSectorOpen(p, id) {
  if (!getSector(id)) return false;
  if (p?.unlockAll) return true;
  if (id === 'belt') return true;
  const prev = SECTORS.find((s) => s.next === id);
  return !!(prev && p?.cleared?.[prev.id]);
}

export function cardPool(p) {
  if (p?.unlockAll) return new Set(UPGRADES.map((u) => u.id));
  const pool = new Set(BASE_POOL);
  for (const s of SECTORS) {
    if (!p?.cleared?.[s.id]) continue;
    for (const id of s.rewards.upgrades) pool.add(id);
    for (const id of s.rewards.evolutions) pool.add(id);
  }
  return pool;
}

// Marks the sector cleared and saves. Returns only the unlocks this clear newly granted.
export function clearSector(p, id) {
  const s = getSector(id);
  if (!s || !p) return [];
  p.cleared = p.cleared || {};
  if (p.cleared[id]) return [];

  const poolBefore = cardPool(p);
  const sectorWasOpen = s.next ? isSectorOpen(p, s.next) : true;
  p.cleared[id] = true;
  const poolAfter = cardPool(p);

  const unlocks = [];
  const pushCard = (kind, cardId) => {
    const def = getUpgrade(cardId);
    if (def && !poolBefore.has(cardId) && poolAfter.has(cardId)) {
      unlocks.push({ kind, id: cardId, name: def.name, icon: def.icon });
    }
  };
  for (const cardId of s.rewards.upgrades) pushCard('upgrade', cardId);
  for (const cardId of s.rewards.evolutions) pushCard('evolution', cardId);
  if (s.next) {
    const next = getSector(s.next);
    if (next && !sectorWasOpen && isSectorOpen(p, s.next)) {
      unlocks.push({ kind: 'sector', id: next.id, name: next.name, icon: SECTOR_ICON });
    }
  }

  saveProgress(p);
  return unlocks;
}

export function rerollsFor(p) {
  const cleared = SECTORS.filter((s) => p?.cleared?.[s.id]).length;
  return Math.min(5, 2 + cleared);
}

export function waveSpec(sector, n) {
  const tier = sector?.tier ?? 1;
  const large = 2 + n + Math.floor(tier / 2);
  const medium = Math.max(0, n - 2) + (tier >= 3 ? 1 : 0);
  const speedMul = 0.9 + 0.06 * (n - 1) + 0.07 * (tier - 1);
  let kind = sector?.rockKind ?? 'rock';
  if (sector?.id === 'deep') kind = Math.random() < 0.5 ? 'rock' : 'crystal';
  return { large, medium, kind, speedMul };
}

export function bossFor(sector, n) {
  if (sector.bosses && sector.bosses.length > 0) {
    const rot = sector.bosses;
    const idx = ((Math.floor(n / 5) - 1) % rot.length + rot.length) % rot.length;
    return rot[idx];
  }
  return sector.boss;
}

export function bossHpMul(sector, repeat = 0) {
  const tier = sector?.tier ?? 1;
  return (1 + 0.35 * (tier - 1)) * (1 + 0.6 * Math.max(0, repeat || 0));
}
