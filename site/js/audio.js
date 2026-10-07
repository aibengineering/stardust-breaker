const MUTE_KEY = 'sb-muted';
const MASTER_GAIN = 0.35;
const ATTACK = 0.01;
const SHOT_MIN_GAP = 1 / 12;
const PICKUP_MIN_GAP = 0.045;
const PICKUP_STREAK_RESET = 0.4;
const PICKUP_STREAK_MAX = 12;

let ctx = null;
let bus = null;
let noiseBuf = null;
let muted = readStoredMuted();
let lastShotAt = -10;
let lastPickupAt = -10;
let pickupStreak = 0;

function readStoredMuted() {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function live() {
  return ctx !== null && bus !== null && !muted;
}

function tone(freq, t0, dur, type, vol, freqEnd) {
  const t = ctx.currentTime + t0;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(bus);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(t0, dur, vol, filterType, f0, f1, q = 0.7) {
  const t = ctx.currentTime + t0;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, t);
  if (f1) filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + ATTACK);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(bus);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    g.disconnect();
  };
  src.start(t, Math.random() * Math.max(0, noiseBuf.duration - dur));
  src.stop(t + dur + 0.02);
}

const safe = fn => (...args) => {
  try {
    if (live()) fn(...args);
  } catch {
    // audio is non-essential; never let it break the game loop
  }
};

export const sfx = {
  unlock() {
    try {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        bus = ctx.createGain();
        bus.gain.value = MASTER_GAIN;
        bus.connect(comp);
        comp.connect(ctx.destination);
        const data = new Float32Array(Math.floor(ctx.sampleRate));
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        noiseBuf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        noiseBuf.copyToChannel(data, 0);
      }
      if (ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch {
      // no audio available; the game runs silently
    }
  },

  setMuted(m) {
    muted = !!m;
    try {
      globalThis.localStorage?.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // storage unavailable (private mode); mute still applies for this session
    }
  },

  isMuted() {
    return muted;
  },

  shoot: safe(() => {
    const t = ctx.currentTime;
    if (t - lastShotAt < SHOT_MIN_GAP) return;
    lastShotAt = t;
    tone(1040, 0, 0.06, 'triangle', 0.035, 560);
  }),

  hit: safe(() => {
    tone(320, 0, 0.07, 'triangle', 0.08, 180);
  }),

  explode: safe(size => {
    const s = Math.min(3, Math.max(1, Math.round(size) || 1));
    noise(0, 0.12 + 0.1 * s, 0.1 + 0.05 * s, 'lowpass', 1600, 260, 0.8);
    tone(210 - 40 * s, 0, 0.1 + 0.08 * s, 'sine', 0.16 + 0.06 * s, 48);
  }),

  pickup: safe(() => {
    const t = ctx.currentTime;
    const gap = t - lastPickupAt;
    if (gap < PICKUP_MIN_GAP) return;
    pickupStreak = gap > PICKUP_STREAK_RESET ? 0 : Math.min(pickupStreak + 1, PICKUP_STREAK_MAX);
    lastPickupAt = t;
    const f = 880 * Math.pow(2, (pickupStreak * 1.5) / 12);
    tone(f, 0, 0.16, 'sine', 0.12);
    tone(f * 2, 0, 0.1, 'sine', 0.03);
  }),

  levelUp: safe(() => {
    tone(880, 0, 0.3, 'triangle', 0.12);
    tone(880, 0, 0.3, 'sine', 0.04);
    tone(1318.5, 0.1, 0.4, 'triangle', 0.13);
    tone(1318.5, 0.1, 0.4, 'sine', 0.05);
  }),

  pick: safe(() => {
    tone(523.25, 0, 0.1, 'triangle', 0.1);
    tone(783.99, 0.06, 0.16, 'triangle', 0.1);
  }),

  hurt: safe(() => {
    tone(300, 0, 0.35, 'triangle', 0.22, 90);
    noise(0, 0.3, 0.16, 'lowpass', 900, 200);
  }),

  shieldHit: safe(() => {
    tone(1400, 0, 0.18, 'sine', 0.12, 700);
    tone(2100, 0.02, 0.14, 'sine', 0.04, 1050);
  }),

  missile: safe(() => {
    noise(0, 0.25, 0.1, 'bandpass', 600, 1800, 1.2);
    tone(300, 0, 0.2, 'triangle', 0.05, 500);
  }),

  nova: safe(() => {
    tone(200, 0, 0.5, 'sine', 0.2, 60);
    noise(0, 0.5, 0.16, 'lowpass', 3000, 200);
    tone(660, 0.05, 0.35, 'sine', 0.05, 990);
  }),

  wave: safe(() => {
    tone(523.25, 0, 0.18, 'triangle', 0.1);
    tone(659.25, 0.08, 0.18, 'triangle', 0.1);
    tone(783.99, 0.16, 0.22, 'triangle', 0.1);
  }),

  gameOver: safe(() => {
    tone(392, 0, 0.3, 'triangle', 0.14);
    tone(330, 0.22, 0.3, 'triangle', 0.14);
    tone(262, 0.44, 0.5, 'triangle', 0.14);
  }),
};
