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
  | 'click'
  | 'ping'
  | 'victory'
  | 'defeat';

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
