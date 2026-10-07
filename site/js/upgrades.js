export function baseStats() {
  return {
    fireRate: 3.5,
    bulletSpeed: 560,
    bulletLife: 0.85,
    bulletDamage: 1,
    multishot: 1,
    pierce: 0,
    rearGun: 0,
    thrust: 280,
    maxSpeed: 330,
    turnSpeed: 4.2,
    maxHull: 3,
    shieldMax: 0,
    shieldRecharge: 9,
    magnetRadius: 115,
    orbitals: 0,
    orbitalDamage: 1,
    orbitalRadius: 48,
    orbitalSpeed: 3.2,
    missiles: 0,
    missileInterval: 2.4,
    missileDamage: 2,
    novaLevel: 0,
    novaInterval: 7,
    novaRadius: 150,
    novaDamage: 2,
    xpGain: 1,
    chainChance: 0,
    chainTargets: 0,
    chainRange: 170,
    bombs: 0,
    bombInterval: 6,
    bombRadius: 170,
    bombDamage: 1,
    bombDuration: 2,
    frostShards: 0,
    drones: 0,
    droneFireRate: 1.6,
    droneDamage: 1,
    droneRange: 360,
    evoPrism: false,
    evoRail: false,
    evoTempest: false,
    evoCluster: false,
    evoSingularity: false,
    evoBlackstar: false,
    evoAegis: false,
    evoHive: false,
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const MAX_SLOTS = 6;

export const UPGRADES = [
  {
    id: 'rapid',
    name: 'Rapid Fire',
    icon: '⚡',
    rarity: 'common',
    kind: 'passive',
    maxLevel: 5,
    desc: () => 'Fire rate +20%',
    apply: (stats) => { stats.fireRate *= 1.2; },
  },
  {
    id: 'damage',
    name: 'Heavy Rounds',
    icon: '💢',
    rarity: 'common',
    kind: 'passive',
    maxLevel: 5,
    desc: (n) => `Bullets hit for ${1 + n} damage`,
    apply: (stats) => { stats.bulletDamage += 1; },
  },
  {
    id: 'velocity',
    name: 'Railgun Barrel',
    icon: '💨',
    rarity: 'common',
    kind: 'passive',
    maxLevel: 4,
    desc: () => 'Bullets 15% faster, reach 10% farther',
    apply: (stats) => {
      stats.bulletSpeed *= 1.15;
      stats.bulletLife *= 1.1;
    },
  },
  {
    id: 'engine',
    name: 'Ion Engine',
    icon: '🔥',
    rarity: 'common',
    kind: 'passive',
    maxLevel: 4,
    desc: () => 'Thrust +15%, top speed +12%, turn +10%',
    apply: (stats) => {
      stats.thrust *= 1.15;
      stats.maxSpeed *= 1.12;
      stats.turnSpeed *= 1.1;
    },
  },
  {
    id: 'magnet',
    name: 'Tractor Beam',
    icon: '🧲',
    rarity: 'common',
    kind: 'passive',
    maxLevel: 4,
    desc: () => 'Gems pulled in from 40% farther',
    apply: (stats) => { stats.magnetRadius *= 1.4; },
  },
  {
    id: 'hull',
    name: 'Reinforced Hull',
    icon: '🔧',
    rarity: 'common',
    kind: 'passive',
    maxLevel: 4,
    desc: () => 'Max hull +1 and repair 1 hull',
    apply: (stats, game) => {
      stats.maxHull += 1;
      const ship = game?.ship;
      if (ship) ship.hull = Math.min(ship.hull + 1, stats.maxHull);
    },
  },
  {
    id: 'multishot',
    name: 'Spread Shot',
    icon: '✨',
    rarity: 'rare',
    kind: 'passive',
    maxLevel: 4,
    desc: (n) => `Volleys fire ${1 + n} bullets, fanned out`,
    apply: (stats) => { stats.multishot += 1; },
  },
  {
    id: 'pierce',
    name: 'Piercing Rounds',
    icon: '🏹',
    rarity: 'rare',
    kind: 'passive',
    maxLevel: 3,
    desc: (n) => `Bullets pass through ${plural(n, 'extra asteroid')}`,
    apply: (stats) => { stats.pierce += 1; },
  },
  {
    id: 'rear',
    name: 'Rear Turret',
    icon: '🔙',
    rarity: 'rare',
    kind: 'weapon',
    maxLevel: 2,
    desc: (n) => `Also fire ${plural(n, 'bullet')} straight back`,
    apply: (stats) => { stats.rearGun += 1; },
  },
  {
    id: 'shield',
    name: 'Deflector Shield',
    icon: '🛡️',
    rarity: 'rare',
    kind: 'passive',
    maxLevel: 3,
    desc: () => 'Shield +1 charge, recharges 15% faster',
    apply: (stats, game) => {
      stats.shieldMax += 1;
      stats.shieldRecharge *= 0.85;
      const ship = game?.ship;
      if (ship) ship.shield = Math.min(ship.shield + 1, stats.shieldMax);
    },
  },
  {
    id: 'greed',
    name: 'Stardust Greed',
    icon: '💎',
    rarity: 'rare',
    kind: 'passive',
    maxLevel: 3,
    desc: () => 'Gems give 25% more XP',
    apply: (stats) => { stats.xpGain *= 1.25; },
  },
  {
    id: 'orbit',
    name: 'Orbital Blades',
    icon: '🌀',
    rarity: 'epic',
    kind: 'weapon',
    maxLevel: 4,
    desc: (n) => {
      if (n === 1) return 'A blade orbits your ship';
      if (n === 2) return '+1 blade, 2 orbiting in total';
      return '+1 blade, blades hit harder';
    },
    apply: (stats) => {
      stats.orbitals += 1;
      // apply() gets no level argument; orbitals equals the level for this upgrade.
      if (stats.orbitals >= 3) stats.orbitalDamage += 1;
    },
  },
  {
    id: 'missiles',
    name: 'Seeker Missiles',
    icon: '🎯',
    rarity: 'epic',
    kind: 'weapon',
    maxLevel: 4,
    desc: (n) => `Homing missiles: ${n} per salvo, every ${(2.4 * 0.9 ** n).toFixed(1)}s`,
    apply: (stats) => {
      stats.missiles += 1;
      stats.missileInterval *= 0.9;
    },
  },
  {
    id: 'nova',
    name: 'Nova Pulse',
    icon: '💥',
    rarity: 'epic',
    kind: 'weapon',
    maxLevel: 3,
    desc: (n) => {
      if (n === 1) return 'Every 7s, a shockwave blasts nearby rocks';
      if (n === 2) return 'Every 5.6s, wider blast (r 180), +1 damage';
      return 'Every 4.5s, wider blast (r 216), +1 damage';
    },
    apply: (stats) => {
      stats.novaLevel += 1;
      // apply() gets no level argument; novaLevel equals the level for this upgrade.
      if (stats.novaLevel >= 2) {
        stats.novaInterval *= 0.8;
        stats.novaRadius *= 1.2;
        stats.novaDamage += 1;
      }
    },
  },
  {
    id: 'chain',
    name: 'Arc Coil',
    icon: '🌩️',
    rarity: 'epic',
    kind: 'weapon',
    maxLevel: 4,
    desc: (n = 1) => `${Math.round((0.15 + 0.1 * n) * 100)}% to arc to ${1 + n} nearby targets`,
    apply: (stats) => {
      // Level is inferred from the stats (chainTargets starts at 0), as in orbit/nova above.
      if (stats.chainTargets === 0) {
        stats.chainChance = 0.25;
        stats.chainTargets = 2;
      } else {
        stats.chainChance += 0.1;
        stats.chainTargets += 1;
      }
    },
  },
  {
    id: 'gravbomb',
    name: 'Gravity Bomb',
    icon: '⚫',
    rarity: 'epic',
    kind: 'weapon',
    maxLevel: 3,
    desc: (n = 1) => {
      if (n === 1) return 'Drops a bomb that pulls rocks into it';
      if (n === 2) return 'Bombs drop faster and pull from wider';
      return 'Bombs drop faster, wider and hit for 2';
    },
    apply: (stats) => {
      // bombs equals the level for this upgrade.
      stats.bombs += 1;
      if (stats.bombs >= 2) {
        stats.bombInterval *= 0.85;
        stats.bombRadius += 15;
      }
      if (stats.bombs >= 3) stats.bombDamage += 1;
    },
  },
  {
    id: 'frost',
    name: 'Frost Shards',
    icon: '❄️',
    rarity: 'rare',
    kind: 'weapon',
    maxLevel: 3,
    desc: (n = 1) => `Destroyed rocks fire ${n + 1} frost shards`,
    apply: (stats) => {
      stats.frostShards = stats.frostShards > 0 ? stats.frostShards + 1 : 2;
    },
  },
  {
    id: 'drone',
    name: 'Wingman Drone',
    icon: '🛸',
    rarity: 'epic',
    kind: 'weapon',
    maxLevel: 3,
    desc: (n = 1) => {
      if (n === 1) return 'A drone hovers by your ship and shoots rocks';
      if (n === 2) return '2 drones, firing faster';
      return '3 drones, firing faster and harder';
    },
    apply: (stats) => {
      // drones equals the level for this upgrade.
      stats.drones += 1;
      stats.droneFireRate += 0.4;
      if (stats.drones >= 3) stats.droneDamage += 1;
    },
  },
  {
    id: 'overcharge',
    name: 'Overcharge',
    icon: '🔋',
    rarity: 'common',
    kind: 'overflow',
    maxLevel: 99,
    desc: () => 'Bullets +8% damage, fire rate +5%',
    apply: (stats) => {
      stats.bulletDamage *= 1.08;
      stats.fireRate *= 1.05;
    },
  },
  {
    id: 'prism',
    name: 'Prism Lance',
    icon: '🔱',
    rarity: 'legendary',
    kind: 'evolution',
    maxLevel: 1,
    requires: ['multishot', 'pierce'],
    desc: () => 'Bullets become lances that pierce everything',
    apply: (stats) => {
      stats.evoPrism = true;
      stats.pierce += 99;
      stats.bulletLife *= 1.3;
    },
  },
  {
    id: 'railstorm',
    name: 'Railstorm',
    icon: '☄️',
    rarity: 'legendary',
    kind: 'evolution',
    maxLevel: 1,
    requires: ['rapid', 'damage'],
    desc: () => 'Fire rate +40%; every 5th volley adds a rail',
    apply: (stats) => {
      stats.evoRail = true;
      stats.fireRate *= 1.4;
      stats.bulletSpeed *= 1.25;
    },
  },
  {
    id: 'tempest',
    name: 'Tempest',
    icon: '🌪️',
    rarity: 'legendary',
    kind: 'evolution',
    maxLevel: 1,
    requires: ['chain', 'velocity'],
    desc: () => 'Every hit arcs lightning, +2 targets, +60 range',
    apply: (stats) => {
      stats.evoTempest = true;
      stats.chainChance = 1;
      stats.chainTargets += 2;
      stats.chainRange += 60;
    },
  },
  {
    id: 'swarm',
    name: 'Cluster Swarm',
    icon: '🎆',
    rarity: 'legendary',
    kind: 'evolution',
    maxLevel: 1,
    requires: ['missiles', 'nova'],
    desc: () => 'Missiles fire 30% faster and explode in clusters',
    apply: (stats) => {
      stats.evoCluster = true;
      stats.missileInterval *= 0.7;
    },
  },
  {
    id: 'singularity',
    name: 'Singularity Blades',
    icon: '🌌',
    rarity: 'legendary',
    kind: 'evolution',
    maxLevel: 1,
    requires: ['orbit', 'magnet'],
    desc: () => 'Blades orbit wider, hit twice as hard, pull rocks',
    apply: (stats) => {
      stats.evoSingularity = true;
      stats.orbitalRadius += 18;
      stats.orbitalDamage *= 2;
    },
  },
  {
    id: 'blackstar',
    name: 'Black Star',
    icon: '🌑',
    rarity: 'legendary',
    kind: 'evolution',
    maxLevel: 1,
    requires: ['gravbomb', 'nova'],
    desc: () => 'Gravity bombs last longer and detonate at the end',
    apply: (stats) => {
      stats.evoBlackstar = true;
      stats.bombDuration = 3.5;
    },
  },
  {
    id: 'aegis',
    name: 'Aegis Core',
    icon: '🔰',
    rarity: 'legendary',
    kind: 'evolution',
    maxLevel: 1,
    requires: ['shield', 'hull'],
    desc: () => 'Shield recharges 2.5x faster; breaking it blasts',
    apply: (stats) => {
      stats.evoAegis = true;
      stats.shieldRecharge *= 0.4;
    },
  },
  {
    id: 'hivemind',
    name: 'Hivemind',
    icon: '🐝',
    rarity: 'legendary',
    kind: 'evolution',
    maxLevel: 1,
    requires: ['drone', 'missiles'],
    desc: () => 'Each drone also launches a homing missile',
    apply: (stats) => {
      stats.evoHive = true;
    },
  },
];

const WEIGHTS = { common: 60, rare: 30, epic: 12 };

export function getUpgrade(id) {
  return UPGRADES.find((u) => u.id === id);
}

// Number of build slots used: owned weapons and passives (evolutions and overcharge are free).
export function slotsUsed(levels) {
  const lv = levels || {};
  return UPGRADES.filter((d) => (d.kind === 'weapon' || d.kind === 'passive') && (lv[d.id] || 0) > 0).length;
}

// Weighted pick of one index from items (weights by rarity). Always returns a valid index.
function weightedIndex(items, rng) {
  const weight = (d) => WEIGHTS[d.rarity] || 1;
  const total = items.reduce((sum, d) => sum + weight(d), 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weight(items[i]);
    if (r < 0) return i;
  }
  return items.length - 1;
}

export function rollChoices(levels, n = 3, rng = Math.random, opts = {}) {
  const lv = levels || {};
  const pool = opts?.pool ?? null;
  const maxSlots = opts?.maxSlots ?? MAX_SLOTS;
  const inPool = (id) => pool === null || (Array.isArray(pool) ? pool.includes(id) : pool.has(id));
  const owned = (d) => (lv[d.id] || 0) > 0;
  const limit = Math.max(0, Math.floor(Number(n)) || 0);
  const picks = [];
  if (limit === 0) return picks;

  // 1. Evolution: one random eligible evolution goes first.
  const evos = UPGRADES.filter((d) => {
    if (d.kind !== 'evolution' || !inPool(d.id) || owned(d)) return false;
    const [baseId, partnerId] = d.requires || [];
    const base = getUpgrade(baseId);
    return !!base && lv[base.id] >= base.maxLevel && (lv[partnerId] || 0) >= 1;
  });
  if (evos.length > 0) picks.push(evos[Math.floor(rng() * evos.length) % evos.length]);

  // 2. Normal weapons/passives, weighted without replacement. Slots are re-checked after each pick
  //    so a roll never adds more new upgrades than the build has room for.
  let used = slotsUsed(lv);
  const cands = UPGRADES.filter(
    (d) => (d.kind === 'weapon' || d.kind === 'passive') && inPool(d.id) && (lv[d.id] || 0) < d.maxLevel,
  );
  while (picks.length < limit) {
    const eligible = cands.filter((d) => owned(d) || used < maxSlots);
    if (eligible.length === 0) break;
    const chosen = eligible[weightedIndex(eligible, rng)];
    cands.splice(cands.indexOf(chosen), 1);
    if (!owned(chosen)) used += 1;
    picks.push(chosen);
  }

  // 3. Filler: overcharge when the roll is still short.
  if (picks.length < limit) {
    const oc = getUpgrade('overcharge');
    if (oc && inPool(oc.id) && (lv[oc.id] || 0) < oc.maxLevel && !picks.includes(oc)) picks.push(oc);
  }
  return picks;
}

// Picks beyond maxLevel are ignored so a stale card can't over-level an upgrade.
export function applyUpgrade(id, stats, levels, game) {
  const def = getUpgrade(id);
  if (!def) throw new Error(`Unknown upgrade: ${id}`);
  const level = levels[id] || 0;
  if (level >= def.maxLevel) return;
  levels[id] = level + 1;
  def.apply(stats, game);
}

export function xpForLevel(level) {
  return Math.round(4 + level * 3 + level * level * 0.5);
}
