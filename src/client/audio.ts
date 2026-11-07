/**
 * Sound effects: short recordings in public/sfx, picked by the owner by ear (scripts/sounds/picks.json), all leveled to
 * the same loudness. They're all loaded and decoded before the start menu, so nothing waits on the
 * network or a decoder when a sound is needed.
 *
 * Browsers only allow audio after a user gesture, so `unlock()` is called on taps.
 *
 * The game respects the phone's silent switch: on iPhone, Web Audio is muted while the
 * ring/silent switch is on, which is what we want. The in-game Sound setting mutes it too.
 */
export const SOUND_NAMES = [
  'hit', 'shoot', 'tower', 'creep', 'cast', 'slam', 'fireBlast', 'heal', 'coin', 'levelUp', 'collapse', 'teleport',
  'deny', 'rune', 'buyback', 'glyph', 'ward', 'roar', 'revive', 'purchase', 'itemDrop', 'itemPickUp', 'click', 'clockTick', 'clockTock', 'clockGo',
  'ping', 'feralBond', 'aegis', 'rebuke', 'sanctuary', 'galeStep', 'hawkMark', 'boltStorm', 'wardenDeath', 'morraShot', 'matchHorn', 'deathSong', 'respawn', 'endSong', 'shrineBoom', 'salve', 'bowShot', 'piercingShot', 'critPing', 'arrowRain', 'fireBolt', 'fireballCast',
  'mendFlame', 'meteorFall', 'meteorImpact', 'daggerSlash', 'shadowStep', 'vanish', 'execute', 'woodPunch', 'rootSnare', 'rootsErupt', 'barkSkin',
  'overgrowth', 'waterBolt', 'tidalWave', 'brineVeil', 'maelstrom', 'zap', 'bellToll', 'frostNova', 'stoneCrumble',
  'wardenPunch', 'impStab', 'hammerAttack', 'shieldCharge', 'shieldBash', 'quakeCharge', 'earthsplitter', 'ironClang', 'armorFall', 'tpChannel',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** The announcer's lines, in public/sfx/voice (see docs/ANNOUNCER-LINES.md). */
export const VOICE_NAMES = [
  'battle_begins', 'battle_soon', 'blazing', 'double_kill', 'enemy_bot_barracks_fallen',
  'enemy_bot_tower_fallen', 'enemy_mega_creeps', 'enemy_mid_barracks_fallen', 'enemy_mid_tower_fallen', 'enemy_shrine_tower_fallen',
  'enemy_top_barracks_fallen', 'enemy_top_tower_fallen', 'first_blood', 'hot_streak', 'inferno',
  'legendary', 'not_enough_mana', 'on_cooldown', 'shutdown', 'team_wipe',
  'triple_kill', 'warden_fallen', 'your_barracks_attacked', 'your_bot_barracks_fallen', 'your_bot_tower_attacked',
  'your_bot_tower_fallen', 'your_mega_creeps', 'your_mid_barracks_fallen', 'your_mid_tower_attacked', 'your_mid_tower_fallen',
  'your_shrine_attacked', 'your_shrine_tower_attacked', 'your_shrine_tower_fallen', 'your_top_barracks_fallen', 'your_top_tower_attacked',
  'your_top_tower_fallen',
] as const;
export type VoiceName = (typeof VOICE_NAMES)[number];

declare const __VERSION__: string;

const SIMULTANEOUS_LOADS = 8;
/** Louder sounds than this many at once only make mud (and each one costs battery). */
const MAX_VOICES = 24;
const MAX_SAME_SOUND = 3;
/** The hit of an impact sound is its loudest moment within this long of its start. */
const IMPACT_WINDOW = 0.4;

interface Sample {
  buffer: AudioBuffer;
  /** Where the sound really begins: some browsers leave a few milliseconds of encoder silence in front. */
  offset: number;
  /** Seconds from `offset` to the loudest moment of its opening, which is where a hit is heard. */
  impact: number;
}

interface Voice {
  name: SoundName;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples = new Map<string, Sample>();
  private voices: Voice[] = [];
  private last = new Map<SoundName, number>();
  private unlockedOnce = false;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('sfx-muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  private start() {
    if (this.ctx) return this.ctx;
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    // 'interactive' asks the device for the shortest delay it can do.
    this.ctx = new C({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    // Keeps a big fight, with many sounds at once, from distorting.
    const safety = this.ctx.createDynamicsCompressor();
    safety.threshold.value = -8;
    safety.ratio.value = 10;
    safety.attack.value = 0.002;
    safety.release.value = 0.15;
    this.master.connect(safety).connect(this.ctx.destination);
    return this.ctx;
  }

  /** Fetch and decode every sound. Never rejects: a sound that fails stays silent. */
  async load(onProgress: (done: number, total: number) => void = () => {}) {
    const ctx = this.start();
    if (!ctx) return;
    const queue = [...SOUND_NAMES.map((n) => [n, `sfx/${n}.mp3`]), ...VOICE_NAMES.map((n) => [n, `sfx/voice/${n}.mp3`])];
    const total = queue.length;
    let done = 0;
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const [name, file] = item;
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}${file}?v=${__VERSION__}`);
          const data = await res.arrayBuffer();
          const buffer = await new Promise<AudioBuffer>((ok, fail) => void ctx.decodeAudioData(data, ok, fail));
          const d = buffer.getChannelData(0);
          let first = 0;
          while (first < d.length && Math.abs(d[first]) < 0.0005) first++;
          if (first >= d.length) first = 0;
          let peak = first;
          const end = Math.min(d.length, first + IMPACT_WINDOW * buffer.sampleRate);
          for (let i = first; i < end; i++) if (Math.abs(d[i]) > Math.abs(d[peak])) peak = i;
          this.samples.set(name, { buffer, offset: first / buffer.sampleRate, impact: (peak - first) / buffer.sampleRate });
        } catch (err) {
          console.warn('Sound unavailable', name, err);
        }
        onProgress(++done, total);
      }
    };
    await Promise.all(Array.from({ length: SIMULTANEOUS_LOADS }, worker));
  }

  /** Must be called from a user gesture (tap/click). Cheap to call repeatedly. */
  unlock() {
    const ctx = this.start();
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    if (!this.unlockedOnce) {
      // iPhones only fully open the audio output once something has played inside a gesture.
      this.unlockedOnce = true;
      const blip = ctx.createBufferSource();
      blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      blip.connect(ctx.destination);
      blip.start();
    }
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

  /**
   * Play a sound at volume 0..1, `delay` seconds from now (timed by the audio clock, so it lands exactly).
   * If the audio isn't running right now the sound is skipped: queued, it would come out late.
   * Returns a handle for `stop`.
   */
  play(name: SoundName, volume = 1, delay = 0, skip = 0): Voice | null {
    const ctx = this.ctx;
    if (this.muted || !ctx || ctx.state !== 'running' || volume <= 0.02) return null;
    const sample = this.samples.get(name);
    if (!sample) return null;
    const now = ctx.currentTime;
    // Repeats of the same sound within 45 ms are merged.
    if (now + delay - (this.last.get(name) ?? -1) < 0.045) return null;
    const same = this.voices.filter((v) => v.name === name);
    if (same.length >= MAX_SAME_SOUND || this.voices.length >= MAX_VOICES) return null;
    this.last.set(name, now + delay);
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, volume);
    src.connect(gain).connect(this.master!);
    const voice: Voice = { name, src, gain };
    this.voices.push(voice);
    src.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice);
      gain.disconnect();
    };
    src.start(now + delay, sample.offset + skip);
    return voice;
  }

  /**
   * Play an impact sound so its hit is heard `hitIn` seconds from now. Its build-up plays first; if
   * there isn't time for all of it, the start is left out rather than the hit coming late.
   */
  playHit(name: SoundName, volume: number, hitIn: number): Voice | null {
    const wait = hitIn - (this.samples.get(name)?.impact ?? 0);
    return this.play(name, volume, Math.max(0, wait), Math.max(0, -wait));
  }

  /** The audio clock, seconds. It stands still while the audio is suspended. */
  get clock(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * Speak an announcer line at full volume, outside the limit on how many sounds play at once (a big fight must not
   * cut the voice). Returns how long it lasts, or 0 if it couldn't play.
   */
  speak(name: VoiceName): number {
    const ctx = this.ctx;
    const sample = this.samples.get(name);
    if (this.muted || !ctx || ctx.state !== 'running' || !sample) return 0;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.connect(this.master!);
    src.onended = () => src.disconnect();
    src.start(ctx.currentTime, sample.offset);
    return sample.buffer.duration - sample.offset;
  }

  /** Fade a playing sound away quickly (a teleport that was cancelled). */
  stop(voice: Voice | null | undefined) {
    if (!voice || !this.ctx) return;
    const now = this.ctx.currentTime;
    voice.gain.gain.setTargetAtTime(0, now, 0.05);
    try {
      voice.src.stop(now + 0.3);
    } catch {
      /* already over */
    }
  }
}
