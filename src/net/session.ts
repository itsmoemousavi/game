import { Command, DRAFT_ORDER, Draft, HeroId, LANE_IDS, PlayerSlot, Team, World, stateHash } from '../sim';
import type { BotDifficulty } from '../sim';
import type { Link } from './link';

/**
 * Multiplayer. Every phone runs the same match; only players' commands travel.
 *
 * Guests send their commands to the host. Ten times a second the host bundles everything it has into
 * a numbered "turn" and sends it to everyone, itself included. Each phone may only simulate up to the
 * last turn it has, applying each turn's commands at the same tick, so all stay identical. Fingerprints
 * are compared every few seconds to catch any drift. The host's clock sets the pace: a slow phone falls
 * behind by itself and catches up, without holding the others back.
 */
export const TICKS_PER_TURN = 3;
const TURN_MS = 100;
/** A guest silent this long counts as gone: their hero goes inactive at base. */
const SILENT_MS = 8000;
const PINGS_MS = 1000;
const HASH_EVERY = 90;
/** Pauses each player may start per match. */
export const PAUSES_PER_PLAYER = 3;
const HUMAN_BY_NAME = /^.{1,14}$/;

export interface LobbyPlayer {
  id: number;
  name: string;
}
export interface LobbyState {
  code: string;
  players: LobbyPlayer[];
  /** Seats: 0-2 Blue, 3-5 Red, lanes in order. A player's id, or null for a bot. */
  seats: (number | null)[];
  difficulty: BotDifficulty;
}
export interface MatchInfo {
  seed: number;
  slots: PlayerSlot[];
  /** Which seat each player is in. */
  seats: (number | null)[];
}
/** Who sits in a seat for the draft: a team's first human bans for it. */
export const humanSeats = (seats: (number | null)[]): boolean[][] => [seats.slice(0, 3).map((s) => s !== null), seats.slice(3).map((s) => s !== null)];
const seatIndex = (team: Team, seat: number) => team * 3 + seat;

/** What a seat's owner is told to do during the draft. */
export function buildSlots(d: Draft, state: LobbyState): PlayerSlot[] {
  const slots: PlayerSlot[] = [];
  for (const team of [0, 1] as Team[]) {
    d.picks[team].forEach((heroId: HeroId, seat) => {
      const human = state.seats[seatIndex(team, seat)] !== null;
      const lane = LANE_IDS[seat];
      slots.push(human ? { team, heroId, controller: 'human', lane } : { team, heroId, controller: 'bot', lane, difficulty: state.difficulty });
    });
  }
  return slots;
}

/** The draft on the host's phone: the real one, telling everyone each choice. */
export class HostDraft extends Draft {
  onChoice: (id: HeroId | null) => void = () => {};
  override choose(id: HeroId | null): boolean {
    const ok = super.choose(id);
    if (ok) this.onChoice(id);
    return ok;
  }
}
/** The draft on a guest's phone: it asks the host, and shows what the host decides. */
export class GuestDraft extends Draft {
  ask: (id: HeroId | null) => void = () => {};
  override choose(id: HeroId | null): boolean {
    this.ask(id);
    return true;
  }
  applyChoice(id: HeroId | null, timeLeft: number) {
    super.choose(id);
    this.timeLeft = timeLeft;
  }
  override update(dt: number) {
    this.timeLeft = Math.max(0, this.timeLeft - dt);
  }
}

interface Turn {
  n: number;
  cmds: Command[];
}

/** What both kinds of session offer the game. */
export abstract class Session {
  abstract readonly isHost: boolean;
  /** The lobby changed. */
  onLobby: (s: LobbyState) => void = () => {};
  onDraftStart: (d: Draft, mySeat: number) => void = () => {};
  /** The match is ready to build. Call `ready()` once it's on screen. */
  onMatch: (info: MatchInfo, mySeat: number, catchUp: boolean) => void = () => {};
  onPause: (paused: boolean, by: string) => void = () => {};
  onNote: (text: string) => void = () => {};
  /** The session is over (host gone, or we left). */
  onEnd: (why: string) => void = () => {};
  /** Devices have drifted apart. */
  onDesync: (tick: number) => void = () => {};

  state: LobbyState = { code: '', players: [], seats: [null, null, null, null, null, null], difficulty: 'normal' };
  myId = 0;
  paused = false;
  protected turns = new Map<number, Command[]>();
  protected lastTurn = -1;

  /** How many more ticks this phone is allowed to simulate. */
  ticksAvailable(w: World): number {
    return (this.lastTurn + 1) * TICKS_PER_TURN - w.tick;
  }
  /** Call just before each step: hands the world this turn's commands. */
  beforeStep(w: World) {
    if (w.tick % TICKS_PER_TURN !== 0) return;
    const n = w.tick / TICKS_PER_TURN;
    const cmds = this.turns.get(n);
    if (cmds) w.receive(cmds);
    if (!this.isHost) this.turns.delete(n);
  }
  /** Call just after each step. */
  afterStep(w: World) {
    if (w.tick % HASH_EVERY === 0) this.onHash(w.tick, stateHash(w));
  }
  protected abstract onHash(tick: number, hash: number): void;
  /** Our player's command, from the game. */
  abstract send(cmd: Command): void;
  /** Run often (timers on a schedule, sending). */
  abstract update(now: number): void;
  abstract sit(seat: number): void;
  abstract ready(): void;
  abstract setPaused(on: boolean): void;
  abstract leave(): void;
  abstract attachWorld(w: World): void;
  get mySeat() {
    return this.state.seats.indexOf(this.myId);
  }
}

interface Guest {
  id: number;
  token: string;
  link: Link | null;
  lastSeen: number;
  /** Their hero stands inactive at base. */
  away: boolean;
  ready: boolean;
  pauses: number;
}

export class HostSession extends Session {
  readonly isHost = true;
  private guests: Guest[] = [];
  private nextId = 2;
  private inbox: Command[] = [];
  private nextTurnAt = 0;
  private started = false;
  private info: MatchInfo | null = null;
  private world: World | null = null;
  private hashes = new Map<number, number>();
  private myPauses = 0;
  private draft: HostDraft | null = null;
  desynced = false;
  /** How many fingerprints have been checked against ours. */
  comparisons = 0;
  private readyWaitUntil = 0;
  private iAmReady = false;

  constructor(
    code: string,
    name: string,
    private seed = (Date.now() & 0xffffff) + 1,
  ) {
    super();
    this.myId = 1;
    this.state = { code, players: [{ id: 1, name }], seats: [1, null, null, null, null, null], difficulty: 'normal' };
  }

  /** A new connection. They introduce themselves first. */
  addLink(link: Link) {
    link.onMessage = (raw) => {
      const m = raw as { t: string; token?: string; name?: string };
      if (m.t === 'hello') this.hello(link, m.token ?? '', m.name ?? 'Player');
    };
  }

  private hello(link: Link, token: string, name: string) {
    let g = this.guests.find((x) => x.token === token);
    if (g) {
      // Back after dropping out.
      g.link?.close();
      g.link = link;
      g.lastSeen = performance.now();
    } else {
      if (this.info || this.draft) {
        link.send({ t: 'refused', why: 'That game has already started' });
        return;
      }
      if (this.state.players.length >= 6) {
        link.send({ t: 'refused', why: 'That game is full' });
        return;
      }
      g = { id: this.nextId++, token, link, lastSeen: performance.now(), away: false, ready: false, pauses: 0 };
      this.guests.push(g);
      this.state.players.push({ id: g.id, name: HUMAN_BY_NAME.test(name) ? name : 'Player' });
      this.state.seats[this.freeSeat()] = g.id;
    }
    const guest = g;
    link.onMessage = (raw) => this.fromGuest(guest, raw as Record<string, never>);
    link.onClose = () => this.dropped(guest, link);
    link.send({ t: 'welcome', id: guest.id });
    if (this.info) {
      // Rejoining: replay the whole match so far, then carry on with everyone.
      const turns: [number, Command[]][] = [];
      this.turns.forEach((cmds, n) => {
        if (cmds.length) turns.push([n, cmds]);
      });
      link.send({ t: 'catchup', info: this.info, state: this.state, turns, last: this.lastTurn, paused: this.paused });
      this.setAway(guest, false);
    } else this.lobby();
  }

  /** The team with fewer players first, top lane first. */
  private freeSeat(): number {
    const n = (t: number) => this.state.seats.slice(t * 3, t * 3 + 3).filter((s) => s !== null).length;
    const first = n(0) <= n(1) ? 0 : 3;
    for (const base of [first, first === 0 ? 3 : 0]) for (let i = base; i < base + 3; i++) if (this.state.seats[i] === null) return i;
    return 0;
  }

  private lobby() {
    this.toAll({ t: 'lobby', state: this.state });
    this.onLobby(this.state);
  }
  private toAll(msg: unknown) {
    for (const g of this.guests) g.link?.send(msg);
  }

  private fromGuest(g: Guest, m: Record<string, unknown>) {
    g.lastSeen = performance.now();
    if (g.away && this.info) this.setAway(g, false);
    switch (m.t) {
      case 'cmds':
        // A player can only command their own hero.
        for (const c of m.cmds as Command[]) if (this.heroOf(g.id) === c.unitId && (c.type as string) !== 'setAway') this.inbox.push(c);
        break;
      case 'sit':
        this.seatPlayer(g.id, m.seat as number);
        break;
      case 'draft':
        this.draftChoice(g.id, m.id as HeroId | null);
        break;
      case 'ready':
        g.ready = true;
        this.maybeStart();
        break;
      case 'pause':
        this.pauseBy(g.id, m.on as boolean, g);
        break;
      case 'hash':
        this.compare(m.tick as number, m.hash as number);
        break;
      case 'leave':
        this.dropped(g, g.link);
        break;
    }
  }

  private heroOf(playerId: number): number {
    const seat = this.state.seats.indexOf(playerId);
    return this.world && seat >= 0 ? this.world.heroes[seat].id : -1;
  }

  private dropped(g: Guest, link: Link | null) {
    if (g.link !== link) return; // an old connection, already replaced
    g.link = null;
    if (this.info || this.draft) {
      if (this.info) this.setAway(g, true);
      return;
    }
    // Still in the lobby: their seat is free again.
    const i = this.state.seats.indexOf(g.id);
    if (i >= 0) this.state.seats[i] = null;
    this.state.players = this.state.players.filter((p) => p.id !== g.id);
    this.guests = this.guests.filter((x) => x !== g);
    this.lobby();
  }

  private setAway(g: Guest, away: boolean) {
    if (g.away === away) return;
    g.away = away;
    const unitId = this.heroOf(g.id);
    if (unitId >= 0) this.inbox.push({ type: 'setAway', unitId, away });
    const name = this.state.players.find((p) => p.id === g.id)?.name ?? 'A player';
    this.note(away ? `${name} left: their hero stays at base` : `${name} is back`);
  }
  private note(text: string) {
    this.toAll({ t: 'note', text });
    this.onNote(text);
  }

  private seatPlayer(id: number, seat: number) {
    if (this.draft || this.info || seat < 0 || seat > 5 || this.state.seats[seat] !== null) return;
    this.state.seats[this.state.seats.indexOf(id)] = null;
    this.state.seats[seat] = id;
    this.lobby();
  }
  sit(seat: number) {
    this.seatPlayer(1, seat);
  }
  setDifficulty(d: BotDifficulty) {
    this.state.difficulty = d;
    this.lobby();
  }

  /** The host starts the match: on to the draft. */
  startDraft() {
    if (this.draft || this.info) return;
    const mySeat = this.mySeat;
    const d = new HostDraft({ team: (mySeat < 3 ? 0 : 1) as Team, seat: mySeat % 3 }, DRAFT_ORDER, Math.random, humanSeats(this.state.seats));
    d.onChoice = (id) => this.toAll({ t: 'choice', id, timeLeft: d.timeLeft });
    this.draft = d;
    this.toAll({ t: 'draft', state: this.state });
    this.onDraftStart(d, mySeat);
  }

  private draftChoice(playerId: number, id: HeroId | null) {
    const d = this.draft;
    const step = d?.current;
    if (!d || !step) return;
    const seat = this.state.seats.indexOf(playerId);
    if (seat < 0 || (seat < 3 ? 0 : 1) !== step.team) return;
    const own = seat % 3;
    const mine = step.kind === 'ban' ? humanSeats(this.state.seats)[step.team].indexOf(true) === own : d.picks[step.team].length === own;
    if (mine) d.choose(id);
  }

  /** The draft is over on the host's phone. */
  draftDone(d: Draft): MatchInfo {
    this.info = { seed: this.seed, slots: buildSlots(d, this.state), seats: this.state.seats };
    this.draft = null;
    this.toAll({ t: 'match', info: this.info });
    this.readyWaitUntil = performance.now() + 30000;
    return this.info;
  }
  attachWorld(w: World) {
    this.world = w;
    w.netSend = (c) => this.send(c);
  }
  /** The host's own match is on screen. */
  ready() {
    this.iAmReady = true;
    this.maybeStart();
  }
  private maybeStart() {
    if (this.started || !this.iAmReady || !this.info) return;
    const waiting = this.guests.some((g) => g.link && !g.ready);
    if (waiting && performance.now() < this.readyWaitUntil) return;
    this.started = true;
    this.nextTurnAt = performance.now();
  }

  send(cmd: Command) {
    this.inbox.push(cmd);
  }

  update(now: number) {
    this.maybeStart();
    if (this.info) {
      for (const g of this.guests) if (g.link && !g.away && now - g.lastSeen > SILENT_MS) this.setAway(g, true);
    }
    if (!this.started || this.paused) return;
    // A long stall (phone locked): carry on from now rather than rushing out every missed turn.
    if (now - this.nextTurnAt > 1000) this.nextTurnAt = now;
    while (now >= this.nextTurnAt) {
      this.nextTurnAt += TURN_MS;
      const turn: Turn = { n: this.lastTurn + 1, cmds: this.inbox };
      this.inbox = [];
      this.lastTurn = turn.n;
      this.turns.set(turn.n, turn.cmds);
      this.toAll({ t: 'turn', n: turn.n, c: turn.cmds.length ? turn.cmds : undefined });
    }
  }

  private pauseBy(id: number, on: boolean, g: Guest | null) {
    if (on === this.paused) return;
    const name = this.state.players.find((p) => p.id === id)?.name ?? 'A player';
    if (on) {
      const used = g ? g.pauses : this.myPauses;
      if (used >= PAUSES_PER_PLAYER) {
        if (g) g.link?.send({ t: 'note', text: 'You have used all your pauses' });
        else this.onNote('You have used all your pauses');
        return;
      }
      if (g) g.pauses++;
      else this.myPauses++;
    }
    this.paused = on;
    if (!on) this.nextTurnAt = performance.now();
    this.toAll({ t: 'paused', on, by: name });
    this.onPause(on, name);
  }
  setPaused(on: boolean) {
    this.pauseBy(1, on, null);
  }

  protected onHash(tick: number, hash: number) {
    this.hashes.set(tick, hash);
    this.hashes.delete(tick - HASH_EVERY * 200);
  }
  private compare(tick: number, hash: number) {
    const mine = this.hashes.get(tick);
    if (mine === undefined) return;
    this.comparisons++;
    if (mine === hash || this.desynced) return;
    this.desynced = true;
    this.toAll({ t: 'desync', tick });
    this.onDesync(tick);
  }

  leave() {
    this.toAll({ t: 'end', why: 'The host left the game' });
    for (const g of this.guests) g.link?.close();
    this.onEnd('');
  }
}

export class GuestSession extends Session {
  readonly isHost = false;
  private outbox: Command[] = [];
  private lastPing = 0;
  private lastFlush = 0;
  private draft: GuestDraft | null = null;
  /** Set while rebuilding a match we dropped out of: how far to replay at full speed. */
  catchingUp = false;
  matchInfo: MatchInfo | null = null;

  constructor(
    private link: Link,
    readonly token: string,
    private name: string,
  ) {
    super();
    this.attach(link);
  }

  /** Reconnected after a drop. */
  reconnect(link: Link) {
    this.link = link;
    this.attach(link);
  }
  onLinkLost: () => void = () => {};

  private attach(link: Link) {
    link.onMessage = (raw) => this.fromHost(raw as Record<string, never>);
    link.onClose = () => {
      if (this.link === link) this.onLinkLost();
    };
    link.send({ t: 'hello', token: this.token, name: this.name });
  }

  private fromHost(m: Record<string, unknown>) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id as number;
        break;
      case 'refused':
        this.onEnd(m.why as string);
        break;
      case 'lobby':
        this.state = m.state as LobbyState;
        this.onLobby(this.state);
        break;
      case 'draft': {
        this.state = m.state as LobbyState;
        const seat = this.mySeat;
        const d = new GuestDraft({ team: (seat < 3 ? 0 : 1) as Team, seat: seat % 3 }, DRAFT_ORDER, Math.random, humanSeats(this.state.seats));
        d.ask = (id) => this.link.send({ t: 'draft', id });
        this.draft = d;
        this.onDraftStart(d, seat);
        break;
      }
      case 'choice':
        this.draft?.applyChoice(m.id as HeroId | null, m.timeLeft as number);
        break;
      case 'match':
        this.matchInfo = m.info as MatchInfo;
        this.onMatch(this.matchInfo, this.mySeat, false);
        break;
      case 'catchup': {
        this.state = m.state as LobbyState;
        this.matchInfo = m.info as MatchInfo;
        this.turns.clear();
        for (const [n, cmds] of m.turns as [number, Command[]][]) this.turns.set(n, cmds);
        this.lastTurn = m.last as number;
        this.paused = m.paused as boolean;
        this.catchingUp = true;
        this.onMatch(this.matchInfo, this.mySeat, true);
        break;
      }
      case 'turn':
        this.lastTurn = Math.max(this.lastTurn, m.n as number);
        if (m.c) this.turns.set(m.n as number, m.c as Command[]);
        break;
      case 'paused':
        this.paused = m.on as boolean;
        this.onPause(this.paused, m.by as string);
        break;
      case 'note':
        this.onNote(m.text as string);
        break;
      case 'desync':
        this.onDesync(m.tick as number);
        break;
      case 'end':
        this.onEnd(m.why as string);
        break;
    }
  }

  attachWorld(w: World) {
    w.netSend = (c) => this.send(c);
  }
  send(cmd: Command) {
    // Only the newest joystick direction matters.
    if (cmd.type === 'moveDir') {
      const i = this.outbox.findIndex((c) => c.type === 'moveDir');
      if (i >= 0) this.outbox.splice(i, 1);
    }
    this.outbox.push(cmd);
  }
  update(now: number) {
    if (this.outbox.length && now - this.lastFlush >= 30) {
      this.link.send({ t: 'cmds', cmds: this.outbox });
      this.outbox = [];
      this.lastFlush = now;
      this.lastPing = now;
    }
    if (now - this.lastPing >= PINGS_MS) {
      this.lastPing = now;
      this.link.send({ t: 'ping' });
    }
  }
  sit(seat: number) {
    this.link.send({ t: 'sit', seat });
  }
  ready() {
    this.link.send({ t: 'ready' });
  }
  setPaused(on: boolean) {
    this.link.send({ t: 'pause', on });
  }
  protected onHash(tick: number, hash: number) {
    this.link.send({ t: 'hash', tick, hash });
  }
  leave() {
    this.link.send({ t: 'leave' });
    this.link.close();
    this.onEnd('');
  }
}
