/**
 * Sound effects, synthesized at runtime with the Web Audio API (oscillators + filtered
 * noise). No audio files, so nothing to license and nothing to download. Each recipe
 * is a few lines; tweak freely or swap in recorded sounds later.
 *
 * Browsers only allow audio after a user gesture, so `unlock()` is called on taps.
 *
 * The game respects the phone's silent switch: on iPhone, Web Audio is muted while the
 * ring/silent switch is on, which is what we want. The in-game Sound setting mutes it too.
 */
export type SoundName =
  | 'swing'
  | 'hit'
  | 'shoot'
  | 'tower'
  | 'creep'
  | 'cast'
  | 'charge'
  | 'slam'
  | 'arrow'
  | 'storm'
  | 'fire'
  | 'explosion'
  | 'heal'
  | 'meteor'
  | 'stun'
  | 'coin'
  | 'levelUp'
  | 'heroDeath'
  | 'collapse'
  | 'teleport'
  | 'deny'
  | 'rune'
  | 'buyback'
  | 'glyph'
  | 'ward'
  | 'roar'
  | 'revive'
  | 'purchase'
  | 'itemDrop'
  | 'itemPickUp'
  | 'click'
  | 'ping'
  | 'victory'
  | 'defeat'
  | 'stomp'
  | 'hammerAttack'
  | 'shieldCharge'
  | 'shieldBash'
  | 'quakeCharge'
  | 'earthsplitter'
  | 'ironClang'
  | 'armorFall'
  | 'tpChannel'
  | 'step'
  | 'treeStep'
  | 'bowShot'
  | 'arrowHit'
  | 'piercingShot'
  | 'critPing'
  | 'arrowRain'
  | 'fireBolt'
  | 'fireHit'
  | 'fireballCast'
  | 'fireBlast'
  | 'mendFlame'
  | 'meteorFall'
  | 'meteorImpact'
  | 'daggerSlash'
  | 'shadowStep'
  | 'vanish'
  | 'execute'
  | 'woodPunch'
  | 'rootSnare'
  | 'rootsErupt'
  | 'barkSkin'
  | 'overgrowth'
  | 'waterBolt'
  | 'splash'
  | 'tidalWave'
  | 'brineVeil'
  | 'maelstrom'
  | 'treeFall'
  | 'bodyFall'
  | 'frostNova';

type Recipe = (s: Sfx, v: number) => void;

const RECIPES: Record<SoundName, Recipe> = {
  swing: (s, v) => s.noise(0.09, 0.35 * v, 'bandpass', 2400, 900),
  hit: (s, v) => {
    s.tone('sine', 160, 60, 0.12, 0.5 * v);
    s.noise(0.06, 0.25 * v, 'lowpass', 1800);
  },
  shoot: (s, v) => s.tone('triangle', 900, 380, 0.08, 0.18 * v),
  tower: (s, v) => {
    s.tone('sawtooth', 220, 90, 0.18, 0.16 * v);
    s.noise(0.12, 0.18 * v, 'lowpass', 900);
  },
  creep: (s, v) => s.noise(0.05, 0.08 * v, 'bandpass', 1400, 700),
  cast: (s, v) => s.tone('triangle', 320, 880, 0.16, 0.25 * v),
  charge: (s, v) => {
    s.noise(0.3, 0.35 * v, 'bandpass', 500, 2200);
    s.tone('square', 110, 70, 0.25, 0.12 * v);
  },
  slam: (s, v) => {
    s.tone('sine', 90, 35, 0.6, 0.8 * v);
    s.noise(0.5, 0.5 * v, 'lowpass', 700, 120);
  },
  arrow: (s, v) => s.noise(0.25, 0.3 * v, 'highpass', 3000, 6000),
  storm: (s, v) => {
    for (let i = 0; i < 6; i++) s.noise(0.12, 0.18 * v, 'highpass', 4000, 2500, i * 0.12);
  },
  fire: (s, v) => {
    s.noise(0.35, 0.35 * v, 'lowpass', 1500, 400);
    s.tone('sawtooth', 140, 80, 0.3, 0.08 * v);
  },
  explosion: (s, v) => {
    s.noise(0.45, 0.55 * v, 'lowpass', 1200, 150);
    s.tone('sine', 110, 40, 0.4, 0.45 * v);
  },
  heal: (s, v) => [660, 880, 1100].forEach((f, i) => s.tone('sine', f, f, 0.18, 0.18 * v, i * 0.07)),
  meteor: (s, v) => s.tone('sawtooth', 900, 120, 1.4, 0.12 * v),
  stun: (s, v) => {
    s.tone('square', 1200, 1200, 0.08, 0.08 * v);
    s.tone('square', 1800, 1800, 0.08, 0.06 * v, 0.06);
  },
  itemDrop: (s, v) => {
    s.noise(0.08, 0.2 * v, 'lowpass', 900, 300);
    s.tone('triangle', 330, 180, 0.12, 0.16 * v);
  },
  itemPickUp: (s, v) => {
    s.tone('triangle', 520, 880, 0.1, 0.18 * v);
    s.noise(0.05, 0.08 * v, 'highpass', 3000);
  },
  coin: (s, v) => {
    s.tone('sine', 1320, 1320, 0.07, 0.18 * v);
    s.tone('sine', 1760, 1760, 0.14, 0.18 * v, 0.06);
  },
  levelUp: (s, v) => [523, 659, 784, 1046].forEach((f, i) => s.tone('triangle', f, f, 0.22, 0.25 * v, i * 0.08)),
  heroDeath: (s, v) => {
    s.tone('sawtooth', 420, 70, 0.8, 0.22 * v);
    s.noise(0.3, 0.2 * v, 'lowpass', 600);
  },
  collapse: (s, v) => {
    s.noise(1.4, 0.7 * v, 'lowpass', 900, 60);
    s.tone('sine', 70, 30, 1.2, 0.6 * v);
  },
  teleport: (s, v) => {
    s.tone('sine', 400, 1600, 0.6, 0.18 * v);
    s.tone('sine', 600, 2400, 0.6, 0.1 * v, 0.05);
  },
  deny: (s, v) => s.tone('square', 300, 200, 0.15, 0.15 * v),
  rune: (s, v) => [988, 1319, 1568, 1976].forEach((f, i) => s.tone('sine', f, f, 0.15, 0.16 * v, i * 0.05)),
  buyback: (s, v) => [392, 494, 587, 784].forEach((f) => s.tone('triangle', f, f, 0.7, 0.12 * v)),
  glyph: (s, v) => {
    s.tone('sine', 220, 440, 0.5, 0.3 * v);
    s.tone('sine', 660, 660, 0.6, 0.12 * v, 0.1);
  },
  ward: (s, v) => s.tone('sine', 700, 500, 0.12, 0.2 * v),
  roar: (s, v) => {
    s.tone('sawtooth', 110, 55, 1.2, 0.35 * v);
    s.noise(1, 0.35 * v, 'lowpass', 500, 150);
  },
  revive: (s, v) => [330, 440, 554, 659, 880].forEach((f, i) => s.tone('sine', f, f, 0.3, 0.15 * v, i * 0.07)),
  purchase: (s, v) => {
    s.tone('sine', 1500, 1500, 0.06, 0.15 * v);
    s.tone('sine', 2000, 2000, 0.12, 0.15 * v, 0.05);
  },
  click: (s, v) => s.tone('sine', 900, 700, 0.04, 0.12 * v),
  ping: (s, v) => {
    s.tone('sine', 1180, 1180, 0.09, 0.2 * v);
    s.tone('sine', 1580, 1580, 0.12, 0.2 * v, 0.09);
  },
  victory: (s, v) => [523, 659, 784, 1046, 1318].forEach((f, i) => s.tone('triangle', f, f, 0.4, 0.25 * v, i * 0.15)),
  defeat: (s, v) => [392, 349, 311, 262].forEach((f, i) => s.tone('triangle', f, f, 0.5, 0.22 * v, i * 0.22)),
  // ---- shared
  /** A light footstep on dirt. */
  step: (s, v) => s.noise(0.06, 0.12 * v, 'lowpass', 900, 300),
  /** A body (cloth and leather) hitting the ground. */
  bodyFall: (s, v) => {
    s.tone('sine', 110, 50, 0.25, 0.4 * v);
    s.noise(0.25, 0.25 * v, 'lowpass', 1200, 250);
  },
  // ---- Vexa
  /** Bowstring twang and the arrow's hiss. */
  bowShot: (s, v) => {
    s.tone('triangle', 190, 150, 0.12, 0.28 * v);
    s.tone('sine', 380, 300, 0.08, 0.1 * v);
    s.noise(0.16, 0.12 * v, 'highpass', 5000, 3000, 0.02);
  },
  /** Arrowhead thunking into a target. */
  arrowHit: (s, v) => {
    s.tone('sine', 220, 90, 0.08, 0.25 * v);
    s.noise(0.05, 0.15 * v, 'bandpass', 1800, 900);
  },
  /** Piercing Arrow: a heavy draw creak, a loud snap and a long whistle. */
  piercingShot: (s, v) => {
    s.tone('triangle', 150, 110, 0.2, 0.35 * v);
    s.noise(0.08, 0.25 * v, 'bandpass', 1500, 600);
    s.tone('sine', 1800, 900, 0.45, 0.08 * v, 0.03);
    s.noise(0.45, 0.18 * v, 'highpass', 6000, 2500, 0.03);
  },
  /** Hunter's Rhythm critical shot: a bright ping. */
  critPing: (s, v) => {
    s.tone('sine', 1320, 1320, 0.18, 0.12 * v, 0.02);
    s.tone('sine', 1980, 1980, 0.14, 0.08 * v, 0.05);
  },
  /** Arrow Storm: a volley loosed upward, then a hail of whistles and thuds. */
  arrowRain: (s, v) => {
    s.tone('triangle', 170, 130, 0.15, 0.3 * v);
    for (let i = 0; i < 9; i++) {
      s.noise(0.18, 0.08 * v, 'highpass', 4500 + i * 300, 2500, 0.35 + i * 0.28);
      s.tone('sine', 160, 80, 0.06, 0.12 * v, 0.5 + i * 0.28);
    }
  },
  // ---- Orin
  /** A small fire bolt whooshing out. */
  fireBolt: (s, v) => {
    s.noise(0.2, 0.22 * v, 'bandpass', 600, 2000);
    s.tone('sawtooth', 160, 90, 0.15, 0.05 * v);
  },
  /** Fire bolt hitting: a crackle. */
  fireHit: (s, v) => {
    s.noise(0.15, 0.2 * v, 'bandpass', 2400, 800);
    for (let i = 0; i < 3; i++) s.noise(0.02, 0.1 * v, 'highpass', 3000, 3000, 0.03 + i * 0.04);
  },
  /** Fireball launched: a roaring rush of flame. */
  fireballCast: (s, v) => {
    s.noise(0.5, 0.4 * v, 'bandpass', 300, 1800);
    s.tone('sawtooth', 110, 70, 0.4, 0.1 * v);
  },
  /** Fireball bursting. */
  fireBlast: (s, v) => {
    s.tone('sine', 90, 35, 0.5, 0.6 * v);
    s.noise(0.5, 0.45 * v, 'lowpass', 3000, 300);
    for (let i = 0; i < 4; i++) s.noise(0.03, 0.12 * v, 'highpass', 3500, 3500, 0.1 + i * 0.07);
  },
  /** Mending Flame: a warm rising chime with a soft crackle. */
  mendFlame: (s, v) => {
    [523, 659, 784].forEach((f, i) => s.tone('sine', f, f * 1.01, 0.4, 0.13 * v, i * 0.08));
    s.noise(0.5, 0.06 * v, 'bandpass', 2500, 1500);
  },
  /** Cataclysm called: a deep rumble and a falling whistle as the meteor comes down. */
  meteorFall: (s, v) => {
    s.tone('sine', 1400, 180, 1.2, 0.09 * v);
    s.noise(1.2, 0.25 * v, 'bandpass', 3000, 300);
    s.tone('sawtooth', 45, 70, 1.2, 0.12 * v);
  },
  /** Cataclysm impact: a huge boom and rolling fire. */
  meteorImpact: (s, v) => {
    s.tone('sine', 60, 22, 1.4, 1.0 * v);
    s.noise(0.4, 0.7 * v, 'lowpass', 4000, 400);
    s.noise(1.6, 0.4 * v, 'bandpass', 800, 150, 0.1);
    for (let i = 0; i < 6; i++) s.noise(0.04, 0.15 * v, 'highpass', 2500, 2500, 0.08 + i * 0.09);
  },
  // ---- Syl
  /** A quick dagger slash. */
  daggerSlash: (s, v) => {
    s.noise(0.09, 0.3 * v, 'bandpass', 3000, 6500);
    s.tone('triangle', 2400, 1800, 0.05, 0.06 * v, 0.05);
  },
  /** Shadow Lunge: a dark rushing swoosh. */
  shadowStep: (s, v) => {
    s.noise(0.3, 0.35 * v, 'bandpass', 400, 2400);
    s.tone('sine', 300, 90, 0.3, 0.15 * v);
    s.noise(0.1, 0.25 * v, 'bandpass', 3500, 6500, 0.22);
  },
  /** Veil: a soft hissing poof. */
  vanish: (s, v) => {
    s.noise(0.45, 0.25 * v, 'lowpass', 2500, 300);
    s.tone('sine', 600, 150, 0.4, 0.08 * v);
  },
  /** Execution: two sharp cuts and a heavy thud. */
  execute: (s, v) => {
    s.noise(0.08, 0.35 * v, 'bandpass', 3500, 7000, 0.12);
    s.noise(0.08, 0.35 * v, 'bandpass', 4000, 7500, 0.2);
    s.tone('sine', 110, 40, 0.35, 0.6 * v, 0.2);
    s.tone('square', 900, 600, 0.12, 0.05 * v, 0.2);
  },
  // ---- Grom
  /** A heavy wooden footstep with a creak. */
  treeStep: (s, v) => {
    s.tone('sine', 65, 40, 0.2, 0.4 * v);
    s.noise(0.08, 0.1 * v, 'lowpass', 600, 200);
    s.tone('sawtooth', 180, 140, 0.12, 0.025 * v, 0.03);
  },
  /** A wooden fist swing, then a heavy knock as it lands. */
  woodPunch: (s, v) => {
    s.noise(0.16, 0.2 * v, 'bandpass', 500, 1500);
    s.tone('sine', 150, 55, 0.2, 0.55 * v, 0.2);
    s.tone('triangle', 380, 300, 0.07, 0.12 * v, 0.2);
  },
  /** Root Snare: a fist pounding the ground. */
  rootSnare: (s, v) => {
    s.tone('sine', 90, 35, 0.35, 0.6 * v, 0.08);
    s.noise(0.2, 0.3 * v, 'lowpass', 1500, 300, 0.08);
  },
  /** Roots tearing out of the ground: cracking wood and a rumble. */
  rootsErupt: (s, v) => {
    s.noise(0.5, 0.35 * v, 'lowpass', 900, 150);
    for (let i = 0; i < 6; i++) s.noise(0.03, 0.18 * v, 'bandpass', 1400 + i * 200, 900, i * 0.05);
    s.tone('sawtooth', 120, 70, 0.3, 0.06 * v);
  },
  /** Bark Skin: wood creaking as it hardens. */
  barkSkin: (s, v) => {
    s.tone('sawtooth', 140, 95, 0.5, 0.06 * v);
    s.tone('sawtooth', 210, 160, 0.4, 0.04 * v, 0.1);
    s.noise(0.3, 0.1 * v, 'bandpass', 900, 500);
  },
  /** Overgrowth: a roar, then the whole ground bursting with roots. */
  overgrowth: (s, v) => {
    s.tone('sawtooth', 90, 60, 0.6, 0.18 * v);
    s.noise(0.6, 0.3 * v, 'bandpass', 300, 900);
    s.tone('sine', 55, 25, 1.0, 0.8 * v, 0.15);
    s.noise(1.0, 0.45 * v, 'lowpass', 1200, 120, 0.15);
    for (let i = 0; i < 8; i++) s.noise(0.03, 0.15 * v, 'bandpass', 1500, 900, 0.18 + i * 0.06);
  },
  /** Grom falling like a tree: a long creak, then a crash. */
  treeFall: (s, v) => {
    s.tone('sawtooth', 160, 70, 1.0, 0.07 * v);
    s.tone('sine', 70, 28, 0.6, 0.8 * v, 1.0);
    s.noise(0.6, 0.45 * v, 'lowpass', 2200, 200, 1.0);
  },
  // ---- Kaela
  /** A water bolt: a liquid blip. */
  waterBolt: (s, v) => {
    s.tone('sine', 500, 1100, 0.1, 0.18 * v);
    s.noise(0.12, 0.08 * v, 'bandpass', 1800, 900);
  },
  /** A splash. */
  splash: (s, v) => {
    s.noise(0.25, 0.25 * v, 'bandpass', 1500, 500);
    s.tone('sine', 700, 1200, 0.06, 0.08 * v);
  },
  /** Tidal Wave: rushing surf. */
  tidalWave: (s, v) => {
    s.noise(1.0, 0.4 * v, 'bandpass', 500, 1600);
    s.noise(1.0, 0.18 * v, 'highpass', 3000, 5000);
  },
  /** Brine Veil: bubbles and a soft chime. */
  brineVeil: (s, v) => {
    for (let i = 0; i < 6; i++) s.tone('sine', 500 + i * 140, 900 + i * 160, 0.06, 0.08 * v, i * 0.05);
    s.tone('sine', 880, 880, 0.4, 0.08 * v, 0.1);
  },
  /** Maelstrom: a swirling, churning roar of water. */
  maelstrom: (s, v) => {
    s.noise(3.5, 0.3 * v, 'bandpass', 300, 900);
    s.noise(3.5, 0.12 * v, 'highpass', 2500, 4000);
    s.tone('sine', 60, 90, 3.5, 0.15 * v);
  },
  /** Frost Horn: a cold blast, a crackle of ice. */
  frostNova: (s, v) => {
    s.noise(0.5, 0.35 * v, 'highpass', 2500, 6000);
    s.tone('sine', 1400, 600, 0.4, 0.08 * v);
    for (let i = 0; i < 5; i++) s.tone('triangle', 2600 + i * 300, 2400, 0.05, 0.05 * v, 0.05 + i * 0.05);
  },
  // ---- Brakk
  /** A heavy armored footstep. */
  stomp: (s, v) => {
    s.tone('sine', 75, 45, 0.16, 0.35 * v);
    s.noise(0.08, 0.12 * v, 'lowpass', 500, 200);
  },
  /** Hammer swing whoosh, then the heavy crunch of the hit as it lands. */
  hammerAttack: (s, v) => {
    s.noise(0.14, 0.28 * v, 'bandpass', 700, 2200);
    s.tone('sine', 140, 50, 0.22, 0.6 * v, 0.17);
    s.noise(0.12, 0.38 * v, 'lowpass', 2200, 400, 0.17);
    s.tone('square', 420, 260, 0.06, 0.07 * v, 0.17);
  },
  /** Armor rattle and rushing air as Brakk charges. */
  shieldCharge: (s, v) => {
    s.noise(0.4, 0.38 * v, 'bandpass', 380, 1800);
    s.tone('sawtooth', 90, 60, 0.35, 0.12 * v);
    for (let i = 0; i < 4; i++) s.noise(0.04, 0.12 * v, 'highpass', 4500, 4500, i * 0.07);
  },
  /** Metal shield slamming into someone: a clang with a dull thump. */
  shieldBash: (s, v) => {
    s.tone('square', 640, 520, 0.18, 0.12 * v);
    s.tone('triangle', 1280, 1100, 0.3, 0.1 * v);
    s.tone('sine', 120, 50, 0.2, 0.55 * v);
    s.noise(0.08, 0.3 * v, 'lowpass', 2500, 600);
  },
  /** Earthsplitter wind-up: a rising rumble as Brakk leaps. */
  quakeCharge: (s, v) => {
    s.tone('sawtooth', 50, 110, 0.6, 0.18 * v);
    s.noise(0.6, 0.3 * v, 'lowpass', 200, 900);
  },
  /** Earthsplitter impact: a deep boom, cracking rock and a rolling rumble. */
  earthsplitter: (s, v) => {
    s.tone('sine', 70, 28, 1.1, 0.95 * v);
    s.noise(0.25, 0.6 * v, 'lowpass', 3500, 500);
    for (let i = 0; i < 5; i++) s.noise(0.06, 0.25 * v, 'highpass', 1800, 1200, 0.05 + i * 0.06);
    s.noise(1.4, 0.45 * v, 'lowpass', 400, 80, 0.1);
  },
  /** Iron Hide kicking in: a ringing metallic clang. */
  ironClang: (s, v) => {
    s.tone('triangle', 880, 860, 0.5, 0.16 * v);
    s.tone('sine', 1320, 1300, 0.4, 0.1 * v);
    s.tone('sine', 1975, 1950, 0.3, 0.06 * v);
  },
  /** A heavy armored body hitting the ground. */
  armorFall: (s, v) => {
    s.tone('sine', 90, 40, 0.35, 0.6 * v);
    s.noise(0.3, 0.35 * v, 'lowpass', 1500, 300);
    s.tone('square', 500, 350, 0.08, 0.06 * v, 0.05);
  },
  /** Teleport channel starting: a shimmering hum that rises. */
  tpChannel: (s, v) => {
    s.tone('sine', 220, 880, 2.8, 0.1 * v);
    s.tone('triangle', 330, 1320, 2.8, 0.05 * v);
    s.noise(2.8, 0.06 * v, 'bandpass', 2000, 6000);
  },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<SoundName, number>();
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('sfx-muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  /** Must be called from a user gesture (tap/click). Cheap to call repeatedly. */
  unlock() {
    if (this.ctx && this.ctx.state === 'running') return;
    if (!this.ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  /** For debugging on a phone: 'running' means sound can play. */
  get state(): string {
    return this.ctx?.state ?? 'not started';
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('sfx-muted', m ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }

  /** Play a sound at volume 0..1. Repeats of the same sound within 45 ms are merged. */
  play(name: SoundName, volume = 1) {
    if (this.muted || !this.ctx || volume <= 0.02) return;
    const now = this.ctx.currentTime;
    const prev = this.last.get(name) ?? -1;
    if (now - prev < 0.045) return;
    this.last.set(name, now);
    RECIPES[name](this, Math.min(1, volume));
  }

  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.015, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1 = f0, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = filter;
    flt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
