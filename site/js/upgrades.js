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
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const UPGRADES = [
  {
    id: 'rapid',
    name: 'Rapid Fire',
    icon: '⚡',
    rarity: 'common',
    maxLevel: 5,
    desc: () => 'Fire rate +20%',
    apply: (stats) => { stats.fireRate *= 1.2; },
  },
  {
    id: 'damage',
    name: 'Heavy Rounds',
    icon: '💢',
    rarity: 'common',
    maxLevel: 5,
    desc: (n) => `Bullets hit for ${1 + n} damage`,
    apply: (stats) => { stats.bulletDamage += 1; },
  },
  {
    id: 'velocity',
    name: 'Railgun Barrel',
    icon: '💨',
    rarity: 'common',
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
    maxLevel: 4,
    desc: () => 'Gems pulled in from 40% farther',
    apply: (stats) => { stats.magnetRadius *= 1.4; },
  },
  {
    id: 'hull',
    name: 'Reinforced Hull',
    icon: '🔧',
    rarity: 'common',
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
    maxLevel: 4,
    desc: (n) => `Volleys fire ${1 + n} bullets, fanned out`,
    apply: (stats) => { stats.multishot += 1; },
  },
  {
    id: 'pierce',
    name: 'Piercing Rounds',
    icon: '🏹',
    rarity: 'rare',
    maxLevel: 3,
    desc: (n) => `Bullets pass through ${plural(n, 'extra asteroid')}`,
    apply: (stats) => { stats.pierce += 1; },
  },
  {
    id: 'rear',
    name: 'Rear Turret',
    icon: '🔙',
    rarity: 'rare',
    maxLevel: 2,
    desc: (n) => `Also fire ${plural(n, 'bullet')} straight back`,
    apply: (stats) => { stats.rearGun += 1; },
  },
  {
    id: 'shield',
    name: 'Deflector Shield',
    icon: '🛡️',
    rarity: 'rare',
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
    maxLevel: 3,
    desc: () => 'Gems give 25% more XP',
    apply: (stats) => { stats.xpGain *= 1.25; },
  },
  {
    id: 'orbit',
    name: 'Orbital Blades',
    icon: '🌀',
    rarity: 'epic',
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
];

const WEIGHTS = { common: 60, rare: 30, epic: 12 };

export function rollChoices(levels, n = 3, rng = Math.random) {
  const pool = UPGRADES.filter((u) => (levels[u.id] || 0) < u.maxLevel);
  const picks = [];
  while (picks.length < n && pool.length > 0) {
    const total = pool.reduce((sum, u) => sum + WEIGHTS[u.rarity], 0);
    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= WEIGHTS[pool[idx].rarity];
      if (r < 0) break;
    }
    picks.push(...pool.splice(idx, 1));
  }
  return picks;
}

export function getUpgrade(id) {
  return UPGRADES.find((u) => u.id === id);
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
