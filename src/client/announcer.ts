import type { GameEvent, Team, Unit, World } from '../sim';
import type { VoiceName } from './audio';

/** Silence between two lines, seconds. */
const GAP = 0.2;
/** A line still waiting after this long is old news and is dropped. */
const STALE = 10;
/** One building's "under attack" line says it again only after this many seconds of match time. */
const ATTACK_REPEAT = 30;
/** "Not enough mana" and "Not ready yet" when someone keeps tapping. */
const REFUSED_REPEAT = 3;

/** Who goes first when lines are waiting. */
const BATTLE = 5;
const KILL = 4;
const BUILDING = 3;
const ATTACKED = 2;

interface Line {
  line: VoiceName;
  rank: number;
  at: number;
  /** The building an "under attack" line is about: dropped if that building falls first. */
  building?: string;
}

/** Anything that can speak a line and say how long it lasts (0 if it couldn't). */
export interface Voice {
  readonly clock: number;
  speak(line: VoiceName): number;
}

/** Spoken lines for one kill, matching the banner in `hud.announce`. */
export function killLines(e: { firstBlood: boolean; multi: number; streak: number; shutdown: number }): VoiceName[] {
  const lines: VoiceName[] = [];
  if (e.firstBlood) lines.push('first_blood');
  if (e.multi >= 3) lines.push('triple_kill');
  else if (e.multi === 2) lines.push('double_kill');
  else if (e.streak >= 6) lines.push('legendary');
  else if (e.streak === 5) lines.push('inferno');
  else if (e.streak === 4) lines.push('blazing');
  else if (e.streak === 3) lines.push('hot_streak');
  if (e.shutdown > 0) lines.push('shutdown');
  return lines;
}

/** The repeat timer's key: each tower has its own; two barracks or Shrine towers side by side share one. */
function buildingKey(u: Unit): string | null {
  const s = u.structure;
  if (!s) return null;
  if (s.tier === 'tower1' || s.tier === 'tower2' || s.tier === 'tower3') return `tower${u.id}`;
  if (s.tier === 'barracks') return `barracks-${u.team}-${s.lane}`;
  if (s.tier === 'shrineTower') return `shrineTower-${u.team}`;
  if (s.tier === 'shrine') return `shrine-${u.team}`;
  return null;
}

function attackedLine(u: Unit): VoiceName | null {
  const s = u.structure!;
  if (s.tier === 'tower1' || s.tier === 'tower2' || s.tier === 'tower3') return `your_${s.lane}_tower_attacked` as VoiceName;
  if (s.tier === 'barracks') return 'your_barracks_attacked';
  if (s.tier === 'shrineTower') return 'your_shrine_tower_attacked';
  if (s.tier === 'shrine') return 'your_shrine_attacked';
  return null;
}

function fallenLine(u: Unit, team: Team): VoiceName | null {
  const s = u.structure!;
  const side = u.team === team ? 'your' : 'enemy';
  if (s.tier === 'tower1' || s.tier === 'tower2' || s.tier === 'tower3') return `${side}_${s.lane}_tower_fallen` as VoiceName;
  if (s.tier === 'barracks') return `${side}_${s.lane}_barracks_fallen` as VoiceName;
  if (s.tier === 'shrineTower') return `${side}_shrine_tower_fallen` as VoiceName;
  return null;
}

/** The match's voice. Lines never overlap: they wait their turn, most important first. Client only, never in the sim. */
export class Announcer {
  private queue: Line[] = [];
  private speaking: VoiceName | null = null;
  private busyUntil = 0;
  private attackSaid = new Map<string, number>();
  private refusedAt = -99;

  constructor(private voice: Voice) {}

  /** A new match, or the end of one. A line already being spoken finishes. */
  reset() {
    this.queue = [];
    this.attackSaid.clear();
  }

  private say(line: VoiceName, rank: number, building?: string) {
    if (this.queue.some((l) => l.line === line)) return;
    // Two things in the same moment that would say the same words: once is enough.
    if (line === this.speaking && this.voice.clock < this.busyUntil) return;
    this.queue.push({ line, rank, at: this.voice.clock, building });
  }

  /** Call often. Starts the next line once the last one has finished. */
  update() {
    const now = this.voice.clock;
    if (now < this.busyUntil) return;
    this.speaking = null;
    this.queue = this.queue.filter((l) => now - l.at <= STALE);
    while (this.queue.length) {
      let next = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].rank > this.queue[next].rank) next = i;
      const [l] = this.queue.splice(next, 1);
      const seconds = this.voice.speak(l.line);
      if (seconds > 0) {
        this.speaking = l.line;
        this.busyUntil = now + seconds + GAP;
        return;
      }
    }
  }

  /** You tapped a spell that can't go yet. Said only when nothing else is being said. */
  refused(why: 'cooldown' | 'mana') {
    const now = this.voice.clock;
    if (now < this.busyUntil || this.queue.length || now - this.refusedAt < REFUSED_REPEAT) return;
    this.refusedAt = now;
    this.say(why === 'mana' ? 'not_enough_mana' : 'on_cooldown', 1);
  }

  /** After each simulation step. `before` is the match clock before that step. */
  onStep(w: World, before: number, events: GameEvent[], team: Team) {
    if (w.winner !== null) return;
    if (before < -15 && w.time >= -15) this.say('battle_soon', BATTLE);
    if (before < 0 && w.time >= 0) this.say('battle_begins', BATTLE);
    for (const e of events) {
      switch (e.type) {
        case 'attack':
        case 'damage':
          this.onHit(w, w.unit(e.sourceId), w.unit(e.targetId), team);
          break;
        case 'death': {
          const u = w.unit(e.unitId);
          if (u?.structure) this.onFallen(u, team);
          else if (u?.hero) {
            const mates = w.heroes.filter((h) => h.team === u.team);
            if (mates.length >= 3 && mates.every((h) => !h.alive)) this.say('team_wipe', BUILDING);
          }
          break;
        }
        case 'announce':
          for (const l of killLines(e)) this.say(l, KILL);
          break;
        case 'megaCreeps':
          this.say(e.team === team ? 'your_mega_creeps' : 'enemy_mega_creeps', BUILDING);
          break;
        case 'bossKilled':
          // Whoever killed it, both teams hear it.
          this.say('warden_fallen', KILL);
          break;
      }
    }
  }

  private onHit(w: World, source: Unit | undefined, target: Unit | undefined, team: Team) {
    if (!source || !target?.structure || target.team !== team || source.team === team) return;
    const key = buildingKey(target);
    const line = attackedLine(target);
    if (!key || !line) return;
    if (w.time - (this.attackSaid.get(key) ?? -999) < ATTACK_REPEAT) return;
    this.attackSaid.set(key, w.time);
    this.say(line, target.structure.tier === 'shrine' ? BUILDING : ATTACKED, key);
  }

  private onFallen(u: Unit, team: Team) {
    const key = buildingKey(u);
    this.queue = this.queue.filter((l) => l.building !== key);
    const line = fallenLine(u, team);
    if (line) this.say(line, BUILDING);
  }
}
